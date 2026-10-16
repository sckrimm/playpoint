import assert from "node:assert/strict";
import { test } from "node:test";
import { newDb, DataType } from "pg-mem";
import type { Pool } from "pg";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import { PostgresStrategyRepository } from "../src/database/postgresRepository.js";
import type { StrategyStore } from "../src/database/repository.js";
import type { StrategyConfig } from "../src/types/strategy.js";
import { planProfitWithdrawal, profitAvailability } from "../src/services/profitWithdrawal.js";

const config: StrategyConfig = { executionEnvironment: "TESTNET", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  initialEntryPrice: 100, totalBudget: 100, finalReservePercent: 0,
  buyLevels: [{ dropPercent: 10, budgetPercent: 100 }], sellLevels: [{ gainPercent: 10, allocationPercent: 100 }] };

async function profitable(store: StrategyStore, reinvest = false) {
  const { id } = await store.createStrategy(config);
  await store.initializeBuyLevels(id, config);
  await store.completeBuy(id, 10, 100, 100, 1, "entry");
  await store.completeSell(id, 10, 120, 120, 1, 0, "profit");
  if (reinvest) await store.completeBuy(id, 10, 110, 110, 1, "reinvest");
  await store.setStrategyStatus(id, "PAUSED");
  return id;
}

async function verifyCashAllocation(store: StrategyStore) {
  const id = await profitable(store);
  const before = await store.getById(id);
  const request = await store.beginProfitWithdrawal(id, 2, "cash-request-0001", false);
  assert.equal(request.status, "COMPLETED");
  assert.equal(request.saleAmount, 0);
  assert.equal(request.actualAmount, 2);
  await store.beginProfitWithdrawal(id, 2, "cash-request-0001", false);
  const after = await store.getById(id);
  assert.equal(after.withdrawnProfit, 2);
  assert.equal(after.totalAssetQuantity, before.totalAssetQuantity);
  assert.equal(after.totalSaleProceeds, before.totalSaleProceeds);
  assert.equal(after.realizedProfit, before.realizedProfit);
  assert.equal(await store.countOrders(id), 2);
  assert.equal(profitAvailability(after).realizedAvailable, 18);
  await assert.rejects(store.beginProfitWithdrawal(id, 3, "cash-request-0001", false));
  await assert.rejects(store.beginProfitWithdrawal(id, 19, "cash-request-0002", false));
  const other = await profitable(store);
  await assert.rejects(store.beginProfitWithdrawal(other, 2, "cash-request-0001", false));
  assert.equal((await store.getById(other)).withdrawnProfit, 0);
  await store.setStrategyStatus(id, "ACTIVE");
  await assert.rejects(store.beginProfitWithdrawal(id, 1, "cash-request-0003", false));
}

async function verifyOptionalSale(store: StrategyStore) {
  const id = await profitable(store, true);
  assert.equal(profitAvailability(await store.getById(id)).cashAvailable, 10);
  await assert.rejects(store.beginProfitWithdrawal(id, 15, "sale-request-0001", false));
  const request = await store.beginProfitWithdrawal(id, 15, "sale-request-0001", true);
  assert.equal(request.cashAmount, 10);
  assert.equal(request.saleAmount, 5);
  assert.equal(request.status, "PENDING");
  assert.equal((await store.getById(id)).withdrawnProfit, 0);
  await assert.rejects(store.setStrategyStatus(id, "ACTIVE"));
  await assert.rejects(store.archiveStrategy(id));
  await assert.rejects(store.beginProfitWithdrawal(id, 1, "sale-request-0002", false));
  const retry = await store.beginProfitWithdrawal(id, 15, "sale-request-0001", true);
  assert.equal(retry.isNew, undefined);
  assert.equal(retry.status, "PENDING");
  await store.withdrawProfit(id, 110, 4.99, 4.99 / 110, 0, "extra-sale", request.requestKey);
  await store.withdrawProfit(id, 110, 4.99, 4.99 / 110, 0, "extra-sale", request.requestKey);
  const after = await store.getById(id);
  assert.ok(Math.abs(after.withdrawnProfit - 14.99) < 1e-9);
  assert.ok(Math.abs(after.totalSaleProceeds - 124.99) < 1e-9);
  assert.equal(await store.countOrders(id), 4);
  assert.equal((await store.getProfitWithdrawals(id))[0]!.status, "COMPLETED");
  await store.setStrategyStatus(id, "ACTIVE");
}

test("cash allocation never creates a SELL or charges exchange minimums, and is idempotent", async () => {
  const db = openDatabase(":memory:");
  try { await verifyCashAllocation(new StrategyRepository(db)); } finally { db.close(); }
});

test("optional sale needs consent, blocks competing work and records only actual proceeds once", async () => {
  const db = openDatabase(":memory:");
  try { await verifyOptionalSale(new StrategyRepository(db)); } finally { db.close(); }
});

test("PostgreSQL allocation and pending-sale settlement preserve the same accounting", async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  db.public.registerFunction({ name: "left", args: [DataType.text, DataType.integer], returns: DataType.text, implementation: (value: string, count: number) => value.slice(0, count) });
  // Only unsupported, empty-database legacy backfills are bypassed in this emulator.
  db.public.interceptQueries((sql) => sql.includes("UPDATE bot_strategies SET cycle_purchased_quantity = total_purchased_quantity") || sql.includes("SELECT bot_strategies.id FROM bot_strategies") ? [] : null);
  const Adapter = db.adapters.createPg();
  const store = new PostgresStrategyRepository("", new Adapter.Pool() as unknown as Pool);
  try {
    await store.initialize();
    await verifyCashAllocation(store);
    await verifyOptionalSale(store);
  } finally { await store.close(); }
});

test("unrealized gains, principal and LIVE funds cannot be allocated as profit", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  try {
    const { id } = await store.createStrategy(config);
    await store.completeBuy(id, 10, 100, 50, 0.5, "entry");
    await store.setStrategyStatus(id, "PAUSED");
    const strategy = await store.getById(id);
    assert.equal(profitAvailability(strategy).freeQuote, 50);
    assert.throws(() => planProfitWithdrawal(strategy, 1, false));
    assert.throws(() => planProfitWithdrawal({ ...strategy, executionEnvironment: "LIVE", realizedProfit: 20 }, 1, false));
    await assert.rejects(store.beginProfitWithdrawal(id, 1, "short", false));
    await assert.rejects(store.beginProfitWithdrawal(id, NaN, "invalid-request-001", false));
    await assert.rejects(store.beginProfitWithdrawal(id, 0.001, "invalid-request-002", false));
  } finally { db.close(); }
});

test("pending level and withdrawal requests survive a new repository and block more spending", async () => {
  const db = openDatabase(":memory:");
  let store = new StrategyRepository(db);
  try {
    const id = await profitable(store, true);
    await store.beginProfitWithdrawal(id, 15, "durable-request-001", true);
    store = new StrategyRepository(db);
    assert.equal((await store.getProfitWithdrawals(id))[0]!.status, "PENDING");
    await assert.rejects(store.setStrategyStatus(id, "ACTIVE"));
    await store.cancelProfitWithdrawal(id, "durable-request-001");
    await assert.rejects(store.beginProfitWithdrawal(id, 15, "durable-request-001", true));
    await store.setStrategyStatus(id, "ACTIVE");
    await store.claimLevel(id, "BUY", 10, "in-flight");
    await store.setStrategyStatus(id, "PAUSED");
    await assert.rejects(store.beginProfitWithdrawal(id, 1, "blocked-request-001", false));
  } finally { db.close(); }
});
