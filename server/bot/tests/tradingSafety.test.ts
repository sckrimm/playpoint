import assert from "node:assert/strict";
import { test } from "node:test";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import { PostgresStrategyRepository } from "../src/database/postgresRepository.js";
import { StrategyEngine } from "../src/strategy/strategyEngine.js";
import { SimulationOrderService } from "../src/services/simulationOrderService.js";
import { BinanceTestnetOrderService, BinanceTestnetOrderError } from "../src/services/binanceTestnetOrderService.js";
import { isFreshMarketEvent, OrderSubmissionBlockedError } from "../src/services/marketSafety.js";
import type { OrderExecutionService, StrategyConfig } from "../src/types/strategy.js";

const config: StrategyConfig = {
  executionEnvironment: "TESTNET", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  initialEntryPrice: 100, totalBudget: 100, finalReservePercent: 0,
  buyLevels: [{ dropPercent: 10, budgetPercent: 50 }, { dropPercent: 20, budgetPercent: 50 }],
  sellLevels: [{ gainPercent: 10, allocationPercent: 100 }],
};

test("an unfunded virtual account cannot submit orders even if the strategy is active", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  let funded = false;
  try {
    const engine = new StrategyEngine({ ...config, executionEnvironment: "SIMULATION" }, store, new SimulationOrderService(), false,
      undefined, async () => false, async () => funded);
    const id = await engine.initialize();
    await engine.onPrice(90);
    assert.equal(await store.countOrders(id), 0);
    assert.ok((await store.getLevels(id)).every((level) => level.status === "WAITING"));
    funded = true;
    await engine.onPrice(90);
    assert.equal(await store.countOrders(id), 1);
  } finally { db.close(); }
});

test("market safety rejects missing, invalid, stale and future exchange timestamps", () => {
  const now = 100_000;
  for (const time of [undefined, NaN, 69_999, 105_001]) assert.equal(isFreshMarketEvent(time, now), false);
  for (const time of [70_000, now, 105_000]) assert.equal(isFreshMarketEvent(time, now), true);
});

test("TESTNET rejects stale ticks without consuming a level and resumes on a fresh event", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  const orders: OrderExecutionService = { ...new SimulationOrderService(), environment: "TESTNET",
    buy: async (symbol, price, quote) => ({ orderId: "buy-1", side: "BUY", symbol, price, quoteAmount: quote, assetQuantity: quote / price }),
    sell: async () => { throw new Error("Unexpected SELL"); } };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
    const id = await engine.initialize();
    await engine.onPrice(90);
    await engine.onPrice(90, new Date(NaN));
    await engine.onPrice(90, new Date(Date.now() - 31_000));
    await engine.onPrice(90, new Date(Date.now() + 60_000));
    assert.equal(await store.countOrders(id), 0);
    assert.ok((await store.getLevels(id)).every((level) => level.status === "WAITING"));
    await engine.onPrice(90, new Date());
    assert.equal(await store.countOrders(id), 1);
  } finally { db.close(); }
});

test("an API error pauses TESTNET before any additional eligible BUY is submitted", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  let calls = 0;
  const orders: OrderExecutionService = { environment: "TESTNET",
    buy: async () => { calls++; throw new Error("API disconnected"); },
    sell: async () => { throw new Error("Unexpected SELL"); } };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
    const id = await engine.initialize();
    await engine.onPrice(80, new Date());
    await engine.onPrice(80, new Date());
    assert.equal(calls, 1);
    assert.equal((await store.getById(id)).status, "PAUSED");
    assert.equal((await store.getLevels(id)).find((level) => level.levelPercent === 20)?.status, "WAITING");
  } finally { db.close(); }
});

test("temporary failures back off and automatically trade again without pausing", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  let calls = 0;
  const orders: OrderExecutionService = { environment: "TESTNET",
    buy: async (symbol, price, quote) => {
      if (++calls === 1) throw new BinanceTestnetOrderError("TEMPORARY", "offline");
      return { orderId: "recovered", side: "BUY", symbol, price, quoteAmount: quote, assetQuantity: quote / price };
    }, sell: async () => { throw new Error("Unexpected SELL"); } };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
    const id = await engine.initialize();
    await engine.onPrice(90, new Date(now));
    assert.equal((await store.getById(id)).status, "ACTIVE");
    await engine.onPrice(90, new Date(now));
    assert.equal(calls, 1);
    now += 30_001;
    await engine.onPrice(90, new Date(now));
    assert.equal(await store.countOrders(id), 1);
  } finally { db.close(); }
});

test("uncertain orders block all new trades until reconciliation confirms execution", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  let calls = 0;
  let resolved = false;
  const orders: OrderExecutionService = { environment: "TESTNET",
    buy: async () => { calls++; throw new BinanceTestnetOrderError("UNKNOWN_RESULT", "timeout", true); },
    sell: async () => { throw new Error("Unexpected SELL"); },
    reconcileOrder: async () => {
      if (!resolved) throw new Error("offline");
      return { orderId: "confirmed", side: "BUY", symbol: "BTCUSDT", price: 90, quoteAmount: 50, assetQuantity: 50 / 90 };
    } };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
    const id = await engine.initialize();
    await engine.onPrice(80, new Date(now));
    assert.equal((await store.getById(id)).status, "ACTIVE");
    now += 30_001;
    await engine.onPrice(80, new Date(now));
    assert.equal(calls, 1);
    await engine.reconcilePendingOrders();
    resolved = true;
    now += 60_001;
    await engine.reconcilePendingOrders();
    assert.equal(await store.countOrders(id), 1);
    await engine.onPrice(90, new Date(now));
    assert.equal(calls, 1);
  } finally { db.close(); }
});

test("preflight network failure is retryable and submits no order", async () => {
  const executor = new BinanceTestnetOrderService("key", "secret", (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
  await assert.rejects(executor.buy("BTCUSDT", 90, 50), (error: unknown) => error instanceof BinanceTestnetOrderError && error.kind === "TEMPORARY");
});

test("temporary SELL failure automatically recovers without duplicating a sale", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  const simulation = new SimulationOrderService();
  let sales = 0;
  const orders: OrderExecutionService = { environment: "TESTNET",
    buy: simulation.buy.bind(simulation),
    sell: async (symbol, price, quantity) => {
      if (++sales === 1) throw new BinanceTestnetOrderError("TIMESTAMP_ERROR", "clock skew");
      return simulation.sell(symbol, price, quantity);
    } };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
    const id = await engine.initialize();
    await engine.onPrice(90, new Date(now));
    await engine.onPrice(111, new Date(now));
    assert.equal((await store.getById(id)).status, "ACTIVE");
    await engine.onPrice(111, new Date(now));
    assert.equal(sales, 1);
    now += 30_001;
    await engine.onPrice(111, new Date(now));
    await engine.onPrice(111, new Date(now));
    assert.equal(sales, 2);
    assert.equal(await store.countOrders(id), 2);
  } finally { db.close(); }
});

test("invalid credentials, balance and filter errors still pause instead of looping", async () => {
  for (const kind of ["INVALID_KEY", "INVALID_SIGNATURE", "INSUFFICIENT_BALANCE", "FILTER_REJECTED"] as const) {
    const db = openDatabase(":memory:");
    const store = new StrategyRepository(db);
    const orders: OrderExecutionService = { environment: "TESTNET",
      buy: async () => { throw new BinanceTestnetOrderError(kind, kind); },
      sell: async () => { throw new Error("Unexpected SELL"); } };
    try {
      const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
      const id = await engine.initialize();
      await engine.onPrice(80, new Date());
      assert.equal((await store.getById(id)).status, "PAUSED");
    } finally { db.close(); }
  }
});

test("POST server failures query the same order ID instead of resubmitting", async () => {
  let posts = 0;
  const executor = new BinanceTestnetOrderService("key", "secret", (async (url, init) => {
    if (String(url).includes("/time")) return new Response(JSON.stringify({ serverTime: Date.now() }));
    if (init?.method === "POST") {
      posts++;
      return new Response("{}", { status: 503 });
    }
    assert.equal(new URL(String(url)).searchParams.get("origClientOrderId"), "same-id");
    return new Response(JSON.stringify({ orderId: 1, executedQty: "1", cummulativeQuoteQty: "90", status: "FILLED" }));
  }) as typeof fetch);
  assert.equal((await executor.buy("BTCUSDT", 90, 90, "same-id")).orderId, "1");
  assert.equal(posts, 1);
});

test("rate limits honor Retry-After without sending more requests", async () => {
  let calls = 0;
  const executor = new BinanceTestnetOrderService("key", "secret", (async () => {
    calls++;
    return new Response("{}", { status: 429, headers: { "Retry-After": "600" } });
  }) as typeof fetch);
  await assert.rejects(executor.buy("BTCUSDT", 90, 50), (error: unknown) => error instanceof BinanceTestnetOrderError && error.retryAfterMs >= 600_000);
  await assert.rejects(executor.buy("BTCUSDT", 90, 50));
  assert.equal(calls, 1);
});

test("ticks that expire while queued or during preflight never submit an order", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let submissions = 0;
  const orders: OrderExecutionService = { environment: "TESTNET",
    buy: async (symbol, price, quote, _client, canSubmit) => {
      entered();
      await blocked;
      if (!await canSubmit!()) throw new OrderSubmissionBlockedError();
      submissions++;
      return { orderId: `buy-${submissions}`, side: "BUY", symbol, price, quoteAmount: quote, assetQuantity: quote / price };
    }, sell: async () => { throw new Error("Unexpected SELL"); } };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
    const id = await engine.initialize();
    const first = engine.onPrice(90, new Date(now));
    await started;
    const queued = engine.onPrice(80, new Date(now));
    now += 31_000;
    release();
    await Promise.all([first, queued]);
    assert.equal(submissions, 0);
    assert.ok((await store.getLevels(id)).every((level) => level.status === "WAITING"));
    await engine.onPrice(90, new Date(now));
    assert.equal(submissions, 1);
  } finally { db.close(); }
});

test("pause during preflight releases the unsubmitted claim instead of marking it failed", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  let id = 0;
  const orders: OrderExecutionService = { environment: "TESTNET",
    buy: async (_symbol, _price, _quote, _client, canSubmit) => {
      await store.pauseStrategies([id]);
      assert.equal(await canSubmit!(), false);
      throw new OrderSubmissionBlockedError();
    }, sell: async () => { throw new Error("Unexpected SELL"); } };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
    id = await engine.initialize();
    await engine.onPrice(80, new Date());
    assert.equal(await store.countOrders(id), 0);
    assert.ok((await store.getLevels(id)).every((level) => level.status === "WAITING" && level.clientOrderId === null));
  } finally { db.close(); }
});

test("Testnet executor checks the guard after preflight and sends no POST when blocked", async () => {
  const requests: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    if (String(url).includes("/time")) return new Response(JSON.stringify({ serverTime: Date.now() }));
    return new Response(JSON.stringify({ symbols: [{ filters: [
      { filterType: "LOT_SIZE", stepSize: "0.001" }, { filterType: "NOTIONAL", minNotional: "5" },
    ] }] }));
  }) as typeof fetch;
  const executor = new BinanceTestnetOrderService("test-key", "test-secret", fetchImpl);
  await assert.rejects(executor.buy("BTCUSDT", 90, 50, "buy", async () => false), OrderSubmissionBlockedError);
  await assert.rejects(executor.sell("BTCUSDT", 110, 1, "sell", async () => false), OrderSubmissionBlockedError);
  assert.ok(requests.length > 0);
  assert.ok(requests.every((request) => request.startsWith("GET")));
});

test("evaluation recovers after a rejected tick instead of permanently poisoning its queue", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  try {
    const engine = new StrategyEngine({ ...config, executionEnvironment: "SIMULATION" }, store, new SimulationOrderService(), false, undefined, async () => false);
    const id = await engine.initialize();
    await assert.rejects(engine.onPrice(NaN));
    await engine.onPrice(90);
    assert.equal(await store.countOrders(id), 1);
  } finally { db.close(); }
});

test("SQLite bulk pause is scoped, idempotent, preserves holdings and survives a new repository", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  try {
    const own = await store.createStrategy(config);
    const other = await store.createStrategy(config);
    await store.completeBuy(own.id, 0, 100, 20, 0.2, "existing-buy");
    const before = await store.getById(own.id);
    assert.equal(await store.pauseStrategies([own.id]), 1);
    assert.equal(await store.pauseStrategies([own.id]), 0);
    assert.equal(await store.pauseStrategies([]), 0);
    assert.equal((await store.getById(other.id)).status, "ACTIVE");
    const after = await new StrategyRepository(db).getById(own.id);
    assert.equal(after.status, "PAUSED");
    assert.equal(after.totalAssetQuantity, before.totalAssetQuantity);
    assert.equal(await store.countOrders(own.id), 1);
    assert.equal(await store.claimLevel(own.id, "BUY", 10, "paused-buy"), false);
  } finally { db.close(); }
});

test("PostgreSQL bulk pause leaves other accounts and archived strategies untouched", async () => {
  const db = newDb();
  db.public.none(`CREATE TABLE bot_strategies (id BIGINT PRIMARY KEY, status TEXT, updated_at TIMESTAMPTZ);
    INSERT INTO bot_strategies (id, status) VALUES (1, 'ACTIVE'), (2, 'ACTIVE'), (3, 'COMPLETED');`);
  const Adapter = db.adapters.createPg();
  const pool = new Adapter.Pool() as unknown as Pool;
  const store = new PostgresStrategyRepository("", pool);
  try {
    assert.equal(await store.pauseStrategies([1, 3]), 1);
    assert.equal(await store.pauseStrategies([1, 3]), 0);
    assert.equal(await store.pauseStrategies([]), 0);
    const rows = (await pool.query("SELECT id, status FROM bot_strategies ORDER BY id")).rows;
    assert.deepEqual(rows.map((row) => row.status), ["PAUSED", "ACTIVE", "COMPLETED"]);
  } finally { await store.close(); }
});
