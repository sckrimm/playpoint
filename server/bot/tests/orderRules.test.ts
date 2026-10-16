import assert from "node:assert/strict";
import { test } from "node:test";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { parseMarketRules, floorMarketQuantity, checkMarketNotional, OrderBelowMinimumError } from "../src/services/orderRules.js";
import { BinanceTestnetOrderService, BinanceTestnetOrderError } from "../src/services/binanceTestnetOrderService.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import { PostgresStrategyRepository } from "../src/database/postgresRepository.js";
import { openDatabase } from "../src/database/database.js";
import { StrategyEngine } from "../src/strategy/strategyEngine.js";
import { SimulationOrderService } from "../src/services/simulationOrderService.js";
import type { StrategyConfig, OrderExecutionService } from "../src/types/strategy.js";

const filters = [
  { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "10000", stepSize: "0.001" },
  { filterType: "MIN_NOTIONAL", minNotional: "5", applyToMarket: true, avgPriceMins: 0 },
];
const response = (body: unknown) => new Response(JSON.stringify(body));

test("market quantities honor both filters with exact decimal flooring, never rounding up", () => {
  const rules = parseMarketRules([...filters, { filterType: "MARKET_LOT_SIZE", minQty: "0.002", maxQty: "100", stepSize: "0.0025" }]);
  assert.equal(rules.stepSize, 0.005);
  assert.equal(floorMarketQuantity(0.01854, rules), 0.015);
  assert.equal(floorMarketQuantity(0.015, rules), 0.015);
  assert.throws(() => floorMarketQuantity(0.0049, rules), OrderBelowMinimumError);
  assert.throws(() => floorMarketQuantity(100.01, rules), /მაქსიმუმ/);
  assert.equal(floorMarketQuantity(0.00000003, parseMarketRules([{ filterType: "LOT_SIZE", stepSize: "0.00000001" }])), 0.00000003);
  assert.throws(() => parseMarketRules([{ filterType: "LOT_SIZE", stepSize: "0.01", maxQty: "bad" }]));
});

test("market notional checks honor applicability and exact minimum boundary", () => {
  const rules = parseMarketRules([...filters, { filterType: "NOTIONAL", minNotional: "10", maxNotional: "100", applyMinToMarket: false, applyMaxToMarket: true, avgPriceMins: 0 }]);
  checkMarketNotional(0.05, 100, rules);
  assert.throws(() => checkMarketNotional(0.049, 100, rules), OrderBelowMinimumError);
  assert.throws(() => checkMarketNotional(1.001, 100, rules), /მაქსიმ/);
  assert.equal(parseMarketRules([{ ...filters[0]! }, { ...filters[1]!, applyToMarket: false }]).minNotional, 0);
});

test("tiny BUY and floored SELL stay local and send no order", async () => {
  const requests: string[] = [];
  const service = new BinanceTestnetOrderService("key", "secret", (async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${url}`);
    return response({ symbols: [{ symbol: "BTCUSDT", status: "TRADING", filters }] });
  }) as typeof fetch);
  await assert.rejects(service.buy("BTCUSDT", 100, 4.99), OrderBelowMinimumError);
  await assert.rejects(service.sell("BTCUSDT", 100, 0.04999), OrderBelowMinimumError);
  assert.equal(requests.length, 1); // Cached rules; no time sync, signed request or POST.
  assert.ok(requests.every((url) => url.startsWith("GET ") && url.includes("/exchangeInfo")));
});

test("SELL uses the required average window and a mismatched window fails closed", async () => {
  let mins = 5;
  let posts = 0;
  const service = new BinanceTestnetOrderService("key", "secret", (async (url, init) => {
    if (init?.method === "POST") posts++;
    return String(url).includes("/exchangeInfo")
      ? response({ symbols: [{ filters: [filters[0], { ...filters[1], avgPriceMins: 5 }] }] })
      : response({ mins, price: "90" });
  }) as typeof fetch);
  await assert.rejects(service.sell("BTCUSDT", 110, 0.05), OrderBelowMinimumError);
  mins = 1;
  await assert.rejects(service.sell("BTCUSDT", 110, 0.05), (error: unknown) => error instanceof BinanceTestnetOrderError && error.kind === "TEMPORARY");
  assert.equal(posts, 0);
});

const config: StrategyConfig = {
  executionEnvironment: "TESTNET", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  initialEntryPrice: 100, totalBudget: 100, finalReservePercent: 0,
  buyLevels: [{ dropPercent: 10, budgetPercent: 100 }],
  sellLevels: [{ gainPercent: 10, allocationPercent: 10 }, { gainPercent: 20, allocationPercent: 90 }],
};

test("a tiny SELL is deferred without pausing, spamming, consuming its level or blocking a larger SELL", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  const simulation = new SimulationOrderService();
  let tinyCalls = 0;
  let largeCalls = 0;
  let eligible = false;
  const messages: string[] = [];
  const orders: OrderExecutionService = { environment: "TESTNET", buy: simulation.buy.bind(simulation),
    sell: async (symbol, price, qty) => {
      if (qty < 0.2) {
        tinyCalls++;
        if (!eligible) throw new OrderBelowMinimumError("Below minimum");
      } else largeCalls++;
      return simulation.sell(symbol, price, qty);
    } };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async (message) => { messages.push(message); return true; });
    const id = await engine.initialize();
    await engine.onPrice(90, new Date(now));
    await engine.onPrice(125, new Date(now));
    const deferred = (await store.getLevels(id)).find((level) => level.side === "SELL" && level.levelPercent === 10)!;
    assert.equal(deferred.status, "WAITING");
    assert.equal(deferred.clientOrderId, null);
    assert.match(deferred.errorMessage!, /^\[ORDER_DEFERRED\]/);
    assert.equal((await store.getById(id)).status, "ACTIVE");
    assert.equal(largeCalls, 1);
    await engine.onPrice(125, new Date(now));
    assert.equal(tinyCalls, 1);
    now += 60_001;
    await engine.onPrice(125, new Date(now));
    assert.equal(tinyCalls, 2);
    assert.equal(messages.filter((message) => message.includes("Below minimum")).length, 1);
    // Durable reason survives a worker restart; no duplicate alert or larger SELL.
    const restarted = new StrategyEngine(config, new StrategyRepository(db), orders, false, id, async (message) => { messages.push(message); return true; });
    await restarted.initialize();
    await restarted.onPrice(125, new Date(now));
    assert.equal(messages.filter((message) => message.includes("Below minimum")).length, 1);
    eligible = true;
    now += 60_001;
    await restarted.onPrice(125, new Date(now));
    assert.equal(largeCalls, 1);
    assert.equal(await store.countOrders(id), 3);
    assert.ok((await store.getLevels(id)).filter((level) => level.side === "SELL").every((level) => level.status === "EXECUTED"));
  } finally { db.close(); }
});

test("a tiny BUY defers without consuming budget and other BUY levels can execute", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  const simulation = new SimulationOrderService();
  const orders: OrderExecutionService = { environment: "TESTNET", sell: simulation.sell.bind(simulation),
    buy: async (symbol, price, quote) => {
      if (quote < 5) throw new OrderBelowMinimumError("BUY below minimum");
      return simulation.buy(symbol, price, quote);
    } };
  try {
    const engine = new StrategyEngine({ ...config, buyLevels: [{ dropPercent: 10, budgetPercent: 1 }, { dropPercent: 20, budgetPercent: 99 }] }, store, orders, false, undefined, async () => false);
    const id = await engine.initialize();
    await engine.onPrice(80, new Date());
    assert.equal((await store.getById(id)).status, "ACTIVE");
    assert.equal((await store.getById(id)).totalInvested, 99);
    assert.equal(await store.countOrders(id), 1);
    assert.equal((await store.getLevels(id)).find((level) => level.side === "BUY" && level.levelPercent === 10)?.status, "WAITING");
  } finally { db.close(); }
});

test("PostgreSQL deferral preserves its reason and cannot release another client's claim", async () => {
  const db = newDb();
  db.public.none(`CREATE TABLE bot_executed_levels (strategy_id BIGINT, side TEXT, level_percent FLOAT, status TEXT,
    error_message TEXT, client_order_id TEXT, execution_started_at TIMESTAMPTZ);
    INSERT INTO bot_executed_levels VALUES (1, 'SELL', 2, 'EXECUTING', NULL, 'owner', NOW());`);
  const Adapter = db.adapters.createPg();
  const pool = new Adapter.Pool() as unknown as Pool;
  const store = new PostgresStrategyRepository("", pool);
  try {
    await store.releaseLevel(1, "SELL", 2, "other", "[ORDER_DEFERRED] min");
    assert.equal((await pool.query("SELECT status FROM bot_executed_levels")).rows[0].status, "EXECUTING");
    await store.releaseLevel(1, "SELL", 2, "owner", "[ORDER_DEFERRED] min");
    const row = (await pool.query("SELECT * FROM bot_executed_levels")).rows[0];
    assert.equal(row.status, "WAITING");
    assert.equal(row.client_order_id, null);
    assert.equal(row.error_message, "[ORDER_DEFERRED] min");
  } finally { await store.close(); }
});
