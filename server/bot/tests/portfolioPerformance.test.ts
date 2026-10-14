import assert from "node:assert/strict";
import { test } from "node:test";
import { periodPerformance } from "../src/services/portfolioPerformance.js";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import type { OrderRecord, StrategyRecord } from "../src/types/strategy.js";

const target = Date.parse("2026-10-10T12:00:00Z");
const strategy = { totalBudget: 200, createdAt: "2026-10-01T12:00:00Z" } as StrategyRecord;
const buy: OrderRecord = { id: 1, side: "BUY", levelPercent: 10, marketPrice: 10, quoteAmount: 100,
  assetQuantity: 10, executionEnvironment: "SIMULATION", createdAt: "2026-10-09T12:00:00Z" };

test("period return reconstructs the old position rather than applying price changes to today's holdings", () => {
  const laterBuy = { ...buy, id: 2, quoteAmount: 50, assetQuantity: 5, createdAt: "2026-10-11T12:00:00Z" };
  // At the boundary: 10 assets worth 120, plus 100 cash = 220 equity.
  const result = periodPerformance(strategy, [laterBuy, buy], 50, 12, target)!;
  assert.equal(result.change, 30);
  assert.equal(result.startingEquity, 220);
  assert.ok(Math.abs(result.percent! - 30 / 220 * 100) < 1e-10);
});

test("historical profit withdrawal is excluded from the starting working balance", () => {
  const withdrawal: OrderRecord = { ...buy, id: 2, side: "SELL", levelPercent: 0, quoteAmount: 24, assetQuantity: 2 };
  const result = periodPerformance(strategy, [buy, withdrawal], 40, 12, target)!;
  assert.equal(result.startingEquity, 196);
  assert.equal(result.change, 20);
});

test("an existing position with missing historical price has no fabricated return", () => {
  assert.equal(periodPerformance(strategy, [buy], 50, null, target), null);
});

test("a new bot contributes its real return since creation without requiring pre-creation prices", () => {
  const recent = { ...strategy, createdAt: "2026-10-11T12:00:00Z" };
  const result = periodPerformance(recent, [], 50, null, target)!;
  assert.equal(result.change, 50);
  assert.equal(result.startingEquity, 200);
  assert.equal(result.percent, 25);
  assert.equal(result.sinceCreated, true);
  assert.equal(periodPerformance(recent, [], null, null, target), null);
});

test("a strategy still holding cash at the boundary needs no historical coin price", () => {
  const result = periodPerformance(strategy, [{ ...buy, createdAt: "2026-10-11T12:00:00Z" }], 10, null, target)!;
  assert.equal(result.change, 10);
  assert.equal(result.startingEquity, 200);
  assert.equal(result.percent, 5);
});

test("account history keeps one sample per minute and refuses missing or stale references", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  try {
    const now = Date.now();
    const reference = new Date(Math.floor((now - 24 * 60 * 60_000) / 60_000) * 60_000);
    await store.saveAccountBalances([{ asset: "USDT", free: "100", locked: "20", updatedAt: reference.toISOString() }]);
    await store.saveAccountBalances([{ asset: "USDT", free: "105", locked: "20", updatedAt: reference.toISOString() }]);
    assert.equal(await store.getAccountBalanceReference(reference), 120);
    assert.equal(await store.getAccountBalanceReference(new Date(reference.getTime() - 1)), null);
    assert.equal(await store.getAccountBalanceReference(new Date(reference.getTime() + 10 * 60_000)), null);
  } finally { db.close(); }
});
