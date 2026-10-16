import assert from "node:assert/strict";
import { test } from "node:test";
import { auditHistoricalOrders, auditPage, HistoricalAuditGate } from "../src/services/historicalAccountingAudit.js";
import { accountExecution } from "../src/services/orderAccounting.js";
import { BinanceTestnetOrderService, BinanceTestnetOrderError } from "../src/services/binanceTestnetOrderService.js";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import type { OrderRecord, StrategyConfig } from "../src/types/strategy.js";

const config: StrategyConfig = { executionEnvironment: "TESTNET", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  initialEntryPrice: 100, totalBudget: 200, finalReservePercent: 0, buyLevels: [{ dropPercent: 10, budgetPercent: 100 }], sellLevels: [{ gainPercent: 10, allocationPercent: 100 }] };

async function fixture() {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  const { id } = await store.createStrategy(config);
  await store.completeBuy(id, 0, 100, 100, 1, "11");
  await store.completeSell(id, 10, 120, 120, 1, 0, "12");
  await store.setStrategyStatus(id, "PAUSED");
  return { db, store, id, strategy: await store.getById(id), orders: await store.getOrders(id) };
}

const inspect = async (symbol: string, side: "BUY" | "SELL", id: string) => accountExecution(symbol, side, id, "1", side === "BUY" ? "100" : "120",
  [{ price: side === "BUY" ? "100" : "120", qty: "1", quoteQty: side === "BUY" ? "100" : "120", commission: side === "BUY" ? "0.1" : "0.12", commissionAsset: "USDT" }], "MY_TRADES");

test("historical comparison derives fee differences without changing ledger, claims or verification", async () => {
  const { db, store, id, strategy, orders } = await fixture();
  try {
    const before = { strategy, orders, levels: await store.getLevels(id), withdrawals: await store.getProfitWithdrawals(id) };
    const report = await auditHistoricalOrders(strategy, orders, inspect);
    assert.equal(report.readOnly, true);
    assert.deepEqual(report.rows.map((row) => row.externalOrderId), ["11", "12"]);
    assert.deepEqual(report.rows.map((row) => row.status), ["DIFFERENCE", "DIFFERENCE"]);
    assert.equal(report.rows[0]?.difference?.quoteAmount, 0.1);
    assert.equal(report.rows[1]?.difference?.quoteAmount, -0.12);
    assert.ok(Math.abs(report.ledgerProjection!.realizedProfit - 19.78) < 1e-10);
    assert.equal(report.ledgerProjection?.totalAssetQuantity, 0);
    assert.deepEqual({ strategy: await store.getById(id), orders: await store.getOrders(id), levels: await store.getLevels(id), withdrawals: await store.getProfitWithdrawals(id) }, before);
    assert.equal(await store.countUnverifiedCommissions(id), 2);
    await assert.rejects(store.beginProfitWithdrawal(id, 1, "audit-no-profit-unlock", false), /საკომისიო/);
  } finally { db.close(); }
});

test("pagination never presents a partial batch as full strategy profit", async () => {
  const { db, strategy, orders } = await fixture();
  try {
    const first = await auditHistoricalOrders(strategy, orders, inspect, 0, 1);
    assert.equal(first.complete, false);
    assert.equal(first.nextOffset, 1);
    assert.equal(first.ledgerProjection, null);
    assert.equal(first.projectionBlocked, "PARTIAL");
    const last = await auditHistoricalOrders(strategy, orders, inspect, 1, 1);
    assert.equal(last.complete, false);
    assert.equal(last.nextOffset, null);
    assert.equal(last.rows[0]?.externalOrderId, "12");
    assert.equal(last.ledgerProjection, null);
  } finally { db.close(); }
});

test("a one-unit quote precision fee is a real difference, not a rounded match", async () => {
  const { db, strategy, orders } = await fixture();
  try {
    const report = await auditHistoricalOrders(strategy, orders, async (symbol, side, id) => accountExecution(symbol, side, id, "1", side === "BUY" ? "100" : "120",
      [{ price: side === "BUY" ? "100" : "120", qty: "1", commission: "0.00000001", commissionAsset: "USDT" }], "FULL"));
    assert.deepEqual(report.rows.map((row) => row.status), ["DIFFERENCE", "DIFFERENCE"]);
    assert.equal(report.rows[0]?.difference?.quoteAmount, 0.00000001);
  } finally { db.close(); }
});

test("legacy missing IDs and foreign environments never invoke the exchange", async () => {
  const { db, strategy, orders } = await fixture();
  try {
    let calls = 0;
    const rows: OrderRecord[] = [{ ...orders[0]!, externalOrderId: "old-sim-id" }, { ...orders[1]!, executionEnvironment: "SIMULATION" }];
    const report = await auditHistoricalOrders(strategy, rows, async () => { calls++; return null; });
    assert.equal(calls, 0);
    assert.ok(report.rows.every((row) => row.status === "UNSUPPORTED"));
    assert.equal(report.ledgerProjection, null);
  } finally { db.close(); }
});

test("missing exchange history is not guessed from current balances", async () => {
  const { db, strategy, orders } = await fixture();
  try {
    const report = await auditHistoricalOrders(strategy, orders, async () => null);
    assert.ok(report.rows.every((row) => row.status === "MISSING"));
    assert.equal(report.projectionBlocked, "EVIDENCE");
    assert.equal(report.ledgerProjection, null);
  } finally { db.close(); }
});

test("unpriced fees and inconsistent local baselines prevent a net-profit projection", async () => {
  const { db, strategy, orders } = await fixture();
  try {
    const unpriced = await auditHistoricalOrders(strategy, orders, async (symbol, side, id) => {
      const result = await inspect(symbol, side, id);
      result.accounting!.status = "UNPRICED";
      result.accounting!.commissions.push({ asset: "BNB", amount: "0.001" });
      return result;
    });
    assert.ok(unpriced.rows.every((row) => row.status === "UNPRICED"));
    assert.equal(unpriced.ledgerProjection, null);
    const inconsistent = await auditHistoricalOrders({ ...strategy, totalAssetQuantity: 1 }, orders, inspect);
    assert.equal(inconsistent.projectionBlocked, "BASELINE");
    assert.equal(inconsistent.ledgerProjection, null);
  } finally { db.close(); }
});

test("foreign or unavailable evidence stops further exchange requests in the batch", async () => {
  const { db, strategy, orders } = await fixture();
  try {
    for (const foreign of [true, false]) {
      let calls = 0;
      const report = await auditHistoricalOrders(strategy, orders, async (symbol, side, id) => {
        calls++;
        if (!foreign) throw new Error("Private credentials must not be exposed");
        return { ...await inspect(symbol, side, id), orderId: "999" };
      });
      assert.equal(calls, 1);
      assert.deepEqual(report.rows.map((row) => row.status), ["UNAVAILABLE", "SKIPPED"]);
      assert.ok(!JSON.stringify(report).includes("Private credentials"));
    }
  } finally { db.close(); }
});

test("audit rejects active/LIVE bots and malformed or unbounded pages before any lookup", async () => {
  const { db, strategy, orders } = await fixture();
  try {
    let calls = 0;
    const read = async () => { calls++; return null; };
    await assert.rejects(auditHistoricalOrders({ ...strategy, status: "ACTIVE" }, orders, read));
    await assert.rejects(auditHistoricalOrders({ ...strategy, executionEnvironment: "LIVE" }, orders, read));
    for (const [offset, limit] of [[-1, 5], [0, 11], [0, 0], [NaN, 5], [0.1, 5]]) assert.throws(() => auditPage(offset, limit));
    assert.throws(() => auditPage("0", 5));
    assert.equal(calls, 0);
  } finally { db.close(); }
});

test("account-level audit gates reject overlaps, throttle retries and release after failures", async () => {
  let now = 1000;
  const gate = new HistoricalAuditGate(() => now);
  let release!: () => void;
  const running = gate.run("account-a", () => new Promise<void>((resolve) => { release = resolve; }));
  await assert.rejects(gate.run("account-a", async () => 1), /უკვე/);
  assert.equal(await gate.run("account-b", async () => 2), 2);
  release(); await running;
  await assert.rejects(gate.run("account-a", async () => 1), /10/);
  now += 10_001;
  await assert.rejects(gate.run("account-a", async () => { throw new Error("offline"); }), /offline/);
  now += 10_001;
  assert.equal(await gate.run("account-a", async () => 3), 3);
});

test("historical inspection uses only signed GETs and validates exact order ownership", async () => {
  let foreign = false;
  let missingTrades = false;
  let missingOrder = false;
  const requests: string[] = [];
  const service = new BinanceTestnetOrderService("fixture", "fixture-secret", (async (url, init) => {
    const parsed = new URL(String(url));
    requests.push(`${init?.method ?? "GET"} ${parsed.pathname}`);
    let payload: unknown;
    let status = 200;
    if (parsed.pathname.endsWith("/time")) payload = { serverTime: Date.now() };
    else if (parsed.pathname.endsWith("/order")) {
      assert.equal(parsed.searchParams.get("orderId"), "11");
      assert.equal(parsed.searchParams.get("origClientOrderId"), null);
      if (missingOrder) { status = 400; payload = { code: -2013 }; }
      else payload = { orderId: foreign ? 12 : 11, symbol: "BTCUSDT", side: "BUY", status: "FILLED", executedQty: "1", cummulativeQuoteQty: "100" };
    } else if (missingTrades) { status = 400; payload = { code: -2013 }; }
    else payload = [{ id: 1, orderId: 11, symbol: "BTCUSDT", isBuyer: true, price: "100", qty: "1", quoteQty: "100", commission: "0.001", commissionAsset: "BTC" }];
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch);
  const result = await service.inspectHistoricalOrder("BTCUSDT", "BUY", "11");
  assert.equal(result?.assetQuantity, 0.999);
  assert.equal(result?.accounting?.source, "MY_TRADES");
  foreign = true;
  await assert.rejects(service.inspectHistoricalOrder("BTCUSDT", "BUY", "11"));
  foreign = false; missingTrades = true;
  await assert.rejects(service.inspectHistoricalOrder("BTCUSDT", "BUY", "11"), (error: unknown) => error instanceof BinanceTestnetOrderError && error.kind === "UNKNOWN_RESULT");
  missingOrder = true;
  assert.equal(await service.inspectHistoricalOrder("BTCUSDT", "BUY", "11"), null);
  assert.ok(requests.every((request) => request.startsWith("GET")));
});
