import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newDb, DataType } from "pg-mem";
import type { Pool } from "pg";
import { accountExecution } from "../src/services/orderAccounting.js";
import { BinanceTestnetOrderService, BinanceTestnetOrderError } from "../src/services/binanceTestnetOrderService.js";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import { PostgresStrategyRepository } from "../src/database/postgresRepository.js";
import { StrategyEngine, needsOrderReconciliation } from "../src/strategy/strategyEngine.js";
import type { StrategyStore } from "../src/database/repository.js";
import type { StrategyConfig, OrderExecutionService } from "../src/types/strategy.js";

const fill = (asset = "USDT", commission = "0.2") => ({ price: "100", qty: "2", quoteQty: "200", commission, commissionAsset: asset });
const execution = (side: "BUY" | "SELL", asset = "USDT", fee = "0.2") => accountExecution("BTCUSDT", side, "1", "2", "200", [fill(asset, fee)], "FULL");
const unknown = (error: unknown) => error instanceof BinanceTestnetOrderError && error.kind === "UNKNOWN_RESULT" && error.noAutoRetry;
const config: StrategyConfig = { executionEnvironment: "TESTNET", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  initialEntryPrice: 100, totalBudget: 500, finalReservePercent: 0,
  buyLevels: [{ dropPercent: 10, budgetPercent: 100 }], sellLevels: [{ gainPercent: 10, allocationPercent: 100 }] };

test("BUY and SELL account for base and quote fees while VWAP stays gross", () => {
  assert.equal(execution("BUY").quoteAmount, 200.2);
  assert.equal(execution("SELL").quoteAmount, 199.8);
  assert.equal(execution("BUY", "BTC", "0.002").assetQuantity, 1.998);
  assert.equal(execution("SELL", "BTC", "0.002").assetQuantity, 2.002);
  assert.equal(execution("BUY", "BTC", "0.002").price, 100);
  assert.equal(execution("SELL").price, 100);
  const bnb = execution("SELL", "BNB", "0.001");
  assert.equal(bnb.accounting?.status, "UNPRICED");
  assert.deepEqual(bnb.accounting?.commissions, [{ asset: "BNB", amount: "0.001" }]);
  assert.equal(execution("BUY", "BNB", "0").accounting?.status, "VERIFIED");
});

test("multiple fills aggregate fees with decimal precision and reject partial or invalid evidence", () => {
  const result = accountExecution("BTCUSDT", "BUY", "3", "3", "300", [fill("BTC", "0.002"), { ...fill(), qty: "1", quoteQty: "100", commission: "0.1" }], "MY_TRADES");
  assert.equal(result.assetQuantity, 2.998);
  assert.equal(result.quoteAmount, 300.1);
  for (const broken of [[], [{ ...fill(), qty: "1" }], [{ ...fill(), commission: "-1" }], [{ ...fill(), commission: "NaN" }], [{ ...fill(), quoteQty: undefined }]]) {
    assert.throws(() => accountExecution("BTCUSDT", "BUY", "1", "2", "200", broken, "MY_TRADES"));
  }
});

function service(trades: unknown | ((url: URL) => unknown), order: object = {}, failTrades = false) {
  const requests: string[] = [];
  const executor = new BinanceTestnetOrderService("key", "secret", (async (url, init) => {
    const parsed = new URL(String(url));
    requests.push(`${init?.method ?? "GET"} ${parsed.pathname}`);
    let payload: unknown = parsed.pathname.endsWith("/time") ? { serverTime: Date.now() }
      : parsed.pathname.endsWith("/exchangeInfo") ? { symbols: [{ filters: [{ filterType: "LOT_SIZE", stepSize: "0.001" }, { filterType: "MIN_NOTIONAL", minNotional: "5" }] }] }
      : parsed.pathname.endsWith("/myTrades") ? typeof trades === "function" ? trades(parsed) : trades
      : { orderId: 1, symbol: "BTCUSDT", side: "BUY", status: "FILLED", executedQty: "2", cummulativeQuoteQty: "200", ...order };
    return new Response(JSON.stringify(payload), { status: failTrades && parsed.pathname.endsWith("/myTrades") ? 500 : 200 });
  }) as typeof fetch);
  return { executor, requests };
}
const trade = (id = 1) => ({ id, orderId: 1, symbol: "BTCUSDT", isBuyer: true, ...fill("BTC", "0.002") });

test("recovery fetches exact order-scoped commissions, including terminal partial fills", async () => {
  const { executor, requests } = service([trade()], { status: "CANCELED" });
  const order = await executor.reconcileOrder("BTCUSDT", "BUY", "client");
  assert.equal(order?.assetQuantity, 1.998);
  assert.equal(order?.accounting?.source, "MY_TRADES");
  assert.ok(requests.every((request) => request.startsWith("GET")));
});

test("FULL fills avoid extra calls; incomplete fills fall back to validated account trades", async () => {
  const full = service([], { fills: [fill()] });
  assert.equal((await full.executor.buy("BTCUSDT", 100, 200)).quoteAmount, 200.2);
  assert.ok(!full.requests.some((request) => request.endsWith("/myTrades")));
  const partial = service([trade()], { fills: [{ ...fill(), qty: "1" }] });
  assert.equal((await partial.executor.buy("BTCUSDT", 100, 200)).accounting?.source, "MY_TRADES");
});

test("missing, duplicated, foreign, wrong-side or unavailable trade evidence stays locked", async () => {
  for (const trades of [[], [trade(), trade()], [{ ...trade(), orderId: 2 }], [{ ...trade(), symbol: "ETHUSDT" }], [{ ...trade(), isBuyer: false }], [{ ...trade(), qty: "1" }], { code: -2013 }]) {
    await assert.rejects(service(trades).executor.reconcileOrder("BTCUSDT", "BUY", "client"), unknown);
  }
  await assert.rejects(service([], {}, true).executor.buy("BTCUSDT", 100, 200), unknown);
  await assert.rejects(service([trade()], { side: "SELL" }).executor.reconcileOrder("BTCUSDT", "BUY", "client"), unknown);
});

test("recovery paginates by trade ID and validates totals across all pages", async () => {
  let pages = 0;
  const { executor } = service((url: URL) => {
    assert.equal(url.searchParams.get("orderId"), "1");
    if (++pages === 1) return Array.from({ length: 1000 }, (_, index) => ({ ...trade(index), qty: "0.001", quoteQty: "0.1", commission: "0.000001" }));
    assert.equal(url.searchParams.get("fromId"), "1000");
    return [{ ...trade(1000), qty: "1", quoteQty: "100", commission: "0.001" }];
  });
  const result = await executor.reconcileOrder("BTCUSDT", "BUY", "client");
  assert.equal(pages, 2);
  assert.equal(result?.assetQuantity, 1.998);
});

async function verifyLedger(store: StrategyStore) {
  const { id } = await store.createStrategy(config);
  const buy = execution("BUY");
  await store.completeBuy(id, 0, buy.price, buy.quoteAmount, buy.assetQuantity, "entry", buy.accounting);
  await store.completeBuy(id, 0, buy.price, buy.quoteAmount, buy.assetQuantity, "entry", buy.accounting);
  assert.equal((await store.getById(id)).totalInvested, 200.2);
  assert.equal((await store.getOrders(id))[0]?.accounting?.grossQuote, "200");
  assert.equal(await store.countUnverifiedCommissions(id), 0);
  // Fee debits inventory; cost basis uses the total inventory removed, not only sold quantity.
  const sell = accountExecution("BTCUSDT", "SELL", "2", "1", "120", [{ price: "120", qty: "1", commission: "0.001", commissionAsset: "BTC" }], "FULL");
  await store.completeSell(id, 10, sell.price, sell.quoteAmount, sell.assetQuantity, 0, "sale", sell.accounting);
  const after = await store.getById(id);
  assert.ok(Math.abs(after.totalAssetQuantity - 0.999) < 1e-12);
  assert.ok(Math.abs(after.realizedProfit - (120 - 1.001 * 100.1)) < 1e-10);
  const bnb = execution("BUY", "BNB", "0.001");
  await store.completeBuy(id, 10, bnb.price, bnb.quoteAmount, bnb.assetQuantity, "bnb", bnb.accounting);
  assert.equal(await store.countUnverifiedCommissions(id), 1);
  await store.setStrategyStatus(id, "PAUSED");
  await assert.rejects(store.beginProfitWithdrawal(id, 1, `fees-pending-request-${id}`, false), /საკომისიო/);
  const legacy = await store.createStrategy(config);
  await store.completeBuy(legacy.id, 0, 100, 100, 1, "legacy");
  assert.equal(await store.countUnverifiedCommissions(legacy.id), 1);
  assert.equal((await store.getOrders(legacy.id))[0]?.accounting, null);
  // No duplicate operation can retroactively bless an unverified historical ledger.
  await store.completeBuy(legacy.id, 0, 100, 100, 1, "legacy", buy.accounting);
  assert.equal(await store.countUnverifiedCommissions(legacy.id), 1);
}

test("SQLite persists net ledger and raw commission evidence atomically and idempotently", async () => {
  const db = openDatabase(":memory:");
  try { await verifyLedger(new StrategyRepository(db)); } finally { db.close(); }
});

test("an existing SQLite database gains evidence columns without rewriting balances or history", async () => {
  const directory = mkdtempSync(join(tmpdir(), "commission-migration-"));
  let db = openDatabase(join(directory, "old.sqlite"));
  try {
    const store = new StrategyRepository(db);
    const { id } = await store.createStrategy(config);
    await store.completeBuy(id, 0, 100, 100, 1, "historical-entry");
    const before = await store.getById(id);
    db.exec("ALTER TABLE orders DROP COLUMN accounting; ALTER TABLE orders DROP COLUMN commission_status;");
    db.close();
    db = openDatabase(join(directory, "old.sqlite"));
    const migrated = new StrategyRepository(db);
    assert.deepEqual(await migrated.getById(id), before);
    const orders = await migrated.getOrders(id);
    assert.equal(orders.length, 1);
    assert.equal(orders[0]?.quoteAmount, 100);
    assert.equal(orders[0]?.assetQuantity, 1);
    assert.equal(orders[0]?.accounting, null);
    assert.equal(orders[0]?.commissionStatus, "UNVERIFIED");
    assert.equal(await migrated.countUnverifiedCommissions(id), 1);
  } finally { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("PostgreSQL persists the same net ledger and commission evidence", async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerEquivalentType({ name: "float8", equivalentTo: DataType.float, isValid: () => true });
  db.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  db.public.registerFunction({ name: "left", args: [DataType.text, DataType.integer], returns: DataType.text, implementation: (value: string, count: number) => value.slice(0, count) });
  db.public.interceptQueries((sql) => sql.includes("UPDATE bot_strategies SET cycle_purchased_quantity = total_purchased_quantity") || sql.includes("SELECT bot_strategies.id FROM bot_strategies") ? [] : null);
  const Adapter = db.adapters.createPg();
  const store = new PostgresStrategyRepository("", new Adapter.Pool() as unknown as Pool);
  try { await store.initialize(); await store.initialize(); await verifyLedger(store); } finally { await store.close(); }
});

test("a database failure after a confirmed fill locks the level instead of resubmitting", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  let calls = 0;
  const result = execution("BUY");
  const orders: OrderExecutionService = { environment: "TESTNET", buy: async () => { calls++; return result; }, sell: async () => { throw new Error("Unexpected sale"); }, reconcileOrder: async () => result };
  try {
    const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
    const id = await engine.initialize();
    db.exec("CREATE TRIGGER fail_evidence BEFORE UPDATE OF accounting ON orders BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
    await engine.onPrice(90, new Date(now));
    assert.equal((await store.getById(id)).totalInvested, 0);
    assert.equal(await store.countOrders(id), 0);
    assert.ok((await store.getLevels(id)).some(needsOrderReconciliation));
    now += 60_001;
    await engine.onPrice(90, new Date(now));
    assert.equal(calls, 1);
    db.exec("DROP TRIGGER fail_evidence");
    await engine.reconcilePendingOrders();
    await engine.onPrice(90, new Date(now));
    assert.equal(calls, 1);
    assert.equal(await store.countOrders(id), 1);
    assert.equal(await store.countUnverifiedCommissions(id), 0);
  } finally { db.close(); }
});

test("unverified commissions prevent profit compounding without stopping principal-funded BUYs", async () => {
  for (const verified of [false, true]) {
    const db = openDatabase(":memory:");
    const store = new StrategyRepository(db);
    let requested = 0;
    const orders: OrderExecutionService = { environment: "TESTNET", buy: async (symbol, price, quote) => {
      requested = quote;
      return { orderId: "new-entry", symbol, side: "BUY", price, quoteAmount: quote, assetQuantity: quote / price };
    }, sell: async () => { throw new Error("Unexpected sale"); } };
    try {
      const engine = new StrategyEngine(config, store, orders, false, undefined, async () => false);
      const id = await engine.initialize();
      await store.completeBuy(id, 0, 100, 200, 2, "entry", execution("BUY", "USDT", "0").accounting);
      await store.claimLevel(id, "SELL", 10, "sale-client");
      const sale = accountExecution("BTCUSDT", "SELL", "2", "2", "240", [{ price: "120", qty: "2", commission: verified ? "0" : "0.001", commissionAsset: "BNB" }], "FULL");
      await store.completeSell(id, 10, sale.price, sale.quoteAmount, sale.assetQuantity, 0, "sale", sale.accounting);
      await engine.onPrice(90, new Date());
      assert.equal(requested, verified ? 540 : 500);
      assert.equal((await store.getById(id)).status, "ACTIVE");
    } finally { db.close(); }
  }
});
