import assert from "node:assert/strict";
import { test } from "node:test";
import { newDb, DataType } from "pg-mem";
import type { Pool } from "pg";
import { AnalystMarketService, assessMarket, assessStrategy } from "../src/services/analystService.js";
import type { BinanceCandle } from "../src/binance/binanceMarketHistoryService.js";
import type { StrategyConfig, ExecutedLevelRecord, MarketState } from "../src/types/strategy.js";
import type { StrategyStore } from "../src/database/repository.js";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import { PostgresStrategyRepository } from "../src/database/postgresRepository.js";

const now = Date.UTC(2026, 9, 16, 4, 30);
function candles(direction = 0): BinanceCandle[] {
  const lastHour = Math.floor(now / 3_600_000) - 1;
  return Array.from({ length: 48 }, (_, index) => {
    const close = 100 + index * direction;
    return { time: (lastHour - 47 + index) * 3600, open: close, high: close + 0.5, low: close - 0.5, close, quoteVolume: index < 24 ? 1000 : 2000 };
  });
}
const config: StrategyConfig = { executionEnvironment: "TESTNET", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  initialEntryPrice: 100, totalBudget: 100, finalReservePercent: 10,
  buyLevels: [{ dropPercent: 10, budgetPercent: 100 }], sellLevels: [{ gainPercent: 10, allocationPercent: 90 }] };
const price: MarketState = { symbol: "BTCUSDT", price: 100, eventTime: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), source: "BINANCE_WEBSOCKET" };

test("market pulse uses closed, contiguous candles and actual 24h volume windows", () => {
  const data = candles(1);
  const up = assessMarket("BTCUSDT", data, "fixture", now);
  assert.equal(up.trend, "UP");
  assert.equal(up.volumeChange, 100);
  assert.ok(Math.abs(up.change24h! - (147 / 123 - 1) * 100) < 1e-9);
  const partial = { ...data.at(-1)!, time: Math.floor(now / 3_600_000) * 3600, close: 9999 };
  assert.deepEqual(assessMarket("BTCUSDT", [...data, partial], "fixture", now), up);
  assert.equal(assessMarket("BTCUSDT", candles(-1), "fixture", now).trend, "DOWN");
  assert.equal(assessMarket("BTCUSDT", candles(), "fixture", now).trend, "RANGE");
  assert.equal(assessMarket("BTCUSDT", data.slice(-24), "fixture", now).trend, "UNKNOWN");
  assert.equal(assessMarket("BTCUSDT", data, "fixture", now + 2 * 3_600_000).trend, "UNKNOWN");
  const gap = data.filter((_, index) => index !== 40);
  assert.equal(assessMarket("BTCUSDT", gap, "fixture", now).trend, "UNKNOWN");
  assert.equal(assessMarket("BTCUSDT", data.map((item) => ({ ...item, quoteVolume: 0 })), "fixture", now).volumeChange, null);
  assert.equal(assessMarket("BTCUSDT", data.map((item) => ({ ...item, quoteVolume: undefined })), "fixture", now).volumeChange, null);
});

test("public market requests are deduplicated and isolate TESTNET from real Spot", async () => {
  const calls: boolean[] = [];
  const market = new AnalystMarketService((testnet) => ({ getCandles: async () => { calls.push(testnet); return candles(); } }));
  await Promise.all([market.get("BTCUSDT", "TESTNET"), market.get("BTCUSDT", "TESTNET")]);
  assert.deepEqual(calls, [true]);
  await market.get("BTCUSDT", "SIMULATION");
  assert.deepEqual(calls, [true, false]);
  const unavailable = new AnalystMarketService(() => ({ getCandles: async () => { throw new Error("offline"); } }));
  assert.equal((await unavailable.get("BTCUSDT", "TESTNET")).trend, "UNKNOWN");
});

test("missing, stale, future and invalid prices cannot produce a clear verdict", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  try {
    const strategy = await store.createStrategy(config);
    const market = assessMarket("BTCUSDT", candles(), "fixture", now);
    for (const badPrice of [null, { ...price, price: NaN }, { ...price, eventTime: new Date(now - 30_001).toISOString() }, { ...price, eventTime: new Date(now + 5_001).toISOString() }]) {
      const result = assessStrategy(strategy, [], badPrice, market, false, now);
      assert.equal(result.risk, "UNKNOWN");
      assert.equal(result.metrics.pnl, null);
      assert.equal(result.metrics.price, null);
      assert.ok(result.facts.some((fact) => fact.code === "PRICE_STALE"));
    }
    const valid = assessStrategy(strategy, [], price, market, false, now);
    assert.equal(valid.risk, "NORMAL");
    assert.equal(valid.source, "RULES");
    assert.equal("confidence" in valid, false);
    assert.equal("orders" in valid, false);
    assert.equal(assessStrategy({ ...strategy, totalBudget: NaN }, [], price, market, false, now).risk, "UNKNOWN");
  } finally { db.close(); }
});

test("uncertain orders, manual withdrawal, losses and negative cash retain explicit risk reasons", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  try {
    const strategy = await store.createStrategy(config);
    const market = assessMarket("BTCUSDT", candles(), "fixture", now);
    const level = { side: "SELL", levelPercent: 10, status: "FAILED", errorMessage: "[NO_AUTO_RETRY] timeout" } as ExecutedLevelRecord;
    const uncertain = assessStrategy(strategy, [level], price, market, false, now);
    assert.equal(uncertain.risk, "HIGH");
    assert.ok(uncertain.facts.some((fact) => fact.code === "ORDER_UNCERTAIN"));
    assert.ok(assessStrategy(strategy, [], price, market, true, now).facts.some((fact) => fact.code === "ORDER_UNCERTAIN"));
    const loss = assessStrategy({ ...strategy, totalInvested: 120, totalAssetQuantity: 1 }, [], price, market, false, now);
    assert.ok(loss.facts.some((fact) => fact.code === "NEGATIVE_CASH"));
    assert.ok(loss.facts.some((fact) => fact.code === "POSITION_LOSS"));
    const compounded = assessStrategy({ ...strategy, totalInvested: 300, totalSaleProceeds: 280, realizedProfit: 20, remainingCostBasis: 40 }, [], price, market, false, now);
    assert.equal(compounded.metrics.freeQuote, 80);
    assert.ok(compounded.metrics.capitalUsedPercent! < 100);
  } finally { db.close(); }
});

async function verifyHistory(store: StrategyStore) {
  const first = await store.createStrategy(config);
  const second = await store.createStrategy(config);
  const assessment = assessStrategy(first, [], price, assessMarket("BTCUSDT", candles(), "fixture", now), false, now);
  const saved = await store.saveAnalystReview(first.id, assessment);
  assert.equal(saved.decision, "NEW");
  assert.equal((await store.getAnalystReviews(second.id)).length, 0);
  await assert.rejects(store.decideAnalystReview(second.id, saved.id, "DISMISSED"));
  await store.decideAnalystReview(first.id, saved.id, "ACKNOWLEDGED");
  const read = (await store.getAnalystReviews(first.id))[0]!;
  assert.equal(read.decision, "ACKNOWLEDGED");
  assert.deepEqual(read.assessment, assessment);
  assert.deepEqual(await store.getById(first.id), first);
  assert.equal(await store.countOrders(first.id), 0);
}

test("SQLite history and decisions are scoped and do not mutate trading state", async () => {
  const db = openDatabase(":memory:");
  try { await verifyHistory(new StrategyRepository(db)); } finally { db.close(); }
});

test("PostgreSQL history and decisions are scoped and do not mutate trading state", async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  db.public.registerFunction({ name: "left", args: [DataType.text, DataType.integer], returns: DataType.text, implementation: (value: string, count: number) => value.slice(0, count) });
  db.public.interceptQueries((sql) => sql.includes("UPDATE bot_strategies SET cycle_purchased_quantity = total_purchased_quantity") || sql.includes("SELECT bot_strategies.id FROM bot_strategies") ? [] : null);
  const Adapter = db.adapters.createPg();
  const store = new PostgresStrategyRepository("", new Adapter.Pool() as unknown as Pool);
  try { await store.initialize(); await verifyHistory(store); } finally { await store.close(); }
});
