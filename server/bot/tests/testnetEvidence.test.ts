import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newDb, DataType } from "pg-mem";
import type { Pool } from "pg";
import { emptyTestnetEvidence, nextTestnetEvidence } from "../src/services/testnetEvidence.js";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import { PostgresStrategyRepository } from "../src/database/postgresRepository.js";
import type { StrategyStore } from "../src/database/repository.js";
import type { StrategyConfig } from "../src/types/strategy.js";

const config: StrategyConfig = {
  executionEnvironment: "TESTNET", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  initialEntryPrice: 100, totalBudget: 100, finalReservePercent: 0,
  buyLevels: [{ dropPercent: 10, budgetPercent: 100 }],
  sellLevels: [{ gainPercent: 10, allocationPercent: 50 }, { gainPercent: 20, allocationPercent: 50 }],
};

test("48 hours requires fresh continuous samples, never creation age or downtime", () => {
  let evidence = nextTestnetEvidence(emptyTestnetEvidence(), 1_000_000, "worker-a");
  evidence = nextTestnetEvidence(evidence, 1_000_000 + 48 * 3_600_000, "worker-a");
  assert.equal(evidence.observedMs, 0);
  assert.equal(evidence.gapRecoveries, 1);
  for (let i = 0; i < 48 * 360; i++) evidence = nextTestnetEvidence(evidence, evidence.lastObservedMs + 10_000, "worker-a");
  assert.equal(evidence.observedMs, 48 * 3_600_000);
  const restarted = nextTestnetEvidence(evidence, evidence.lastObservedMs + 3_600_000, "worker-b");
  assert.equal(restarted.observedMs, evidence.observedMs);
  assert.equal(restarted.restarts, 1);
  assert.equal(restarted.gapRecoveries, 1);
  assert.deepEqual(nextTestnetEvidence(restarted, restarted.lastObservedMs - 1, "worker-b"), restarted);
});

async function verifyCycles(store: StrategyStore, claim = store.claimLevel.bind(store)): Promise<void> {
  const strategy = await store.createStrategy(config);
  await store.initializeBuyLevels(strategy.id, config);
  for (let cycle = 1; cycle <= 3; cycle++) {
    assert.equal(await claim(strategy.id, "BUY", 10, `buy-${cycle}`), true);
    await store.completeBuy(strategy.id, 10, 90, 90, 1, `buy-${cycle}`);
    assert.equal(await claim(strategy.id, "SELL", 10, `sell-a-${cycle}`), true);
    await store.completeSell(strategy.id, 10, 110, 55, 0.5, 0, `sell-a-${cycle}`);
    assert.equal((await store.getTestnetEvidence(strategy.id)).completedCycles, cycle - 1);
    assert.equal(await claim(strategy.id, "SELL", 20, `sell-b-${cycle}`), true);
    await store.completeSell(strategy.id, 20, 120, 60, 0.5, 0, `sell-b-${cycle}`);
    await store.completeSell(strategy.id, 20, 120, 60, 0.5, 0, `sell-b-${cycle}`);
    assert.equal((await store.getTestnetEvidence(strategy.id)).completedCycles, cycle);
  }
}

test("SQLite counts three entire SELL cycles, not matched order counts, exactly once", async () => {
  const db = openDatabase(":memory:");
  try { await verifyCycles(new StrategyRepository(db)); } finally { db.close(); }
});

test("PostgreSQL counts completed cycles transactionally and retains counters on heartbeat", async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  db.public.registerFunction({ name: "left", args: [DataType.text, DataType.integer], returns: DataType.text, implementation: (value: string, count: number) => value.slice(0, count) });
  // pg-mem cannot plan this legacy correlated backfill; this fixture starts empty.
  db.public.interceptQueries((sql) => sql.includes("UPDATE bot_strategies SET cycle_purchased_quantity = total_purchased_quantity") ||
    sql.includes("SELECT bot_strategies.id FROM bot_strategies") ? [] : null);
  const Adapter = db.adapters.createPg();
  const pool = new Adapter.Pool() as unknown as Pool;
  const store = new PostgresStrategyRepository("", pool);
  try {
    await store.initialize();
    // Seed claimed levels directly: pg-mem does not support claimLevel's correlated guard.
    await verifyCycles(store, async (id, side, percent, clientId) => {
      await pool.query("UPDATE bot_executed_levels SET status = 'EXECUTING', client_order_id = $1 WHERE strategy_id = $2 AND side = $3 AND level_percent = $4", [clientId, id, side, percent]);
      return true;
    });
    const id = (await store.listStrategies())[0]!.id;
    await store.recordTestnetObservation(id, 1_000_000, "worker-a");
    await store.recordTestnetObservation(id, 1_010_000, "worker-a");
    assert.equal((await store.getTestnetEvidence(id)).completedCycles, 3);
    assert.equal((await store.getTestnetEvidence(id)).observedMs, 10_000);
  } finally { await store.close(); }
});

test("restart preserves progress; paused, uncertain and failed periods do not earn observation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "testnet-evidence-"));
  const filename = join(directory, "test.sqlite");
  let db = openDatabase(filename);
  try {
    let store = new StrategyRepository(db);
    const { id } = await store.createStrategy(config);
    await store.initializeBuyLevels(id, config);
    await store.recordTestnetObservation(id, 1_000_000, "worker-a");
    await store.recordTestnetObservation(id, 1_010_000, "worker-a");
    await store.setStrategyStatus(id, "PAUSED");
    await store.recordTestnetObservation(id, 2_000_000, "worker-a");
    assert.equal((await store.getTestnetEvidence(id)).observedMs, 10_000);
    db.close();
    db = openDatabase(filename);
    store = new StrategyRepository(db);
    await store.setStrategyStatus(id, "ACTIVE");
    await store.recordTestnetObservation(id, 3_000_000, "worker-b");
    assert.equal((await store.getTestnetEvidence(id)).restarts, 1);
    assert.equal((await store.getTestnetEvidence(id)).observedMs, 10_000);
    await store.claimLevel(id, "BUY", 10, "uncertain");
    await store.recordTestnetObservation(id, 3_010_000, "worker-b");
    await store.failLevel(id, "BUY", 10, new Error("[NO_AUTO_RETRY] unknown order"));
    await store.recordTestnetObservation(id, 3_020_000, "worker-b");
    assert.equal((await store.getTestnetEvidence(id)).observedMs, 10_000);
    await store.releaseLevel(id, "BUY", 10, "uncertain");
    await store.recordTestnetObservation(id, 4_000_000, "worker-b");
    await store.recordTestnetObservation(id, 4_010_000, "worker-b");
    const evidence = await store.getTestnetEvidence(id);
    assert.equal(evidence.gapRecoveries, 1);
    assert.equal(evidence.observedMs, 20_000);
    const simulation = await store.createStrategy({ ...config, executionEnvironment: "SIMULATION" });
    await store.recordTestnetObservation(simulation.id, 4_000_000, "worker-b");
    assert.deepEqual(await store.getTestnetEvidence(simulation.id), emptyTestnetEvidence());
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
