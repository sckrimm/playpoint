import assert from "node:assert/strict";
import { test } from "node:test";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { UserWalletStore } from "../src/auth/userWalletStore.js";

async function fixture() {
  const db = newDb();
  db.public.none(`CREATE TABLE bot_users (id BIGINT PRIMARY KEY);
    CREATE TABLE bot_strategies (id BIGINT PRIMARY KEY, total_budget NUMERIC, withdrawn_profit NUMERIC DEFAULT 0, execution_environment TEXT DEFAULT 'SIMULATION', status TEXT DEFAULT 'PAUSED');
    CREATE TABLE bot_strategy_owners (strategy_id BIGINT PRIMARY KEY, user_id BIGINT);
    INSERT INTO bot_users (id) VALUES (1), (2), (3);
    INSERT INTO bot_strategies (id, total_budget) VALUES (10,800), (11,300), (12,100);
    INSERT INTO bot_strategy_owners (strategy_id,user_id) VALUES (10,2), (11,2), (12,3);`);
  const Adapter = db.adapters.createPg();
  const pool = new Adapter.Pool() as unknown as Pool;
  const wallets = new UserWalletStore(pool);
  await wallets.initialize();
  return { pool, wallets };
}
const admin = { id: 1, username: "owner", role: "ADMIN" as const };
const member = { id: 2, username: "friend", role: "USER" as const };

test("simulation grants are once per user and bot budgets share the same 1000 USDT", async () => {
  const { pool, wallets } = await fixture();
  try {
    assert.equal((await wallets.summary(2)).simulation.available, 1000);
    await wallets.fundStrategy(2, 10, 800);
    assert.equal((await wallets.summary(2)).simulation.available, 200);
    await assert.rejects(wallets.fundStrategy(2, 11, 300));
    await wallets.fundStrategy(2, 11, 200);
    assert.equal((await wallets.summary(2)).simulation.available, 0);
    await wallets.ensureWallet(2);
    assert.equal((await wallets.summary(2)).simulation.credited, 1000);
    assert.equal((await wallets.summary(3)).simulation.available, 1000);
    await assert.rejects(wallets.fundStrategy(2, 12, 50));
    assert.equal(await wallets.isFunded(2, 10, 800), true);
    assert.equal(await wallets.isFunded(3, 10, 800), false);
  } finally { await pool.end(); }
});

test("admin simulation credits are isolated, audited and idempotent; fiat is a separate balance", async () => {
  const { pool, wallets } = await fixture();
  try {
    const credit = { operation: "SIMULATION_CREDIT" as const, amount: "500.29", requestKey: "simulation-credit-0001" };
    await assert.rejects(wallets.changeBalance(member, 2, credit));
    await wallets.changeBalance(admin, 2, credit);
    await wallets.changeBalance(admin, 2, credit);
    assert.equal((await wallets.summary(2)).simulation.available, 1500.29);
    assert.equal((await wallets.summary(3)).simulation.available, 1000);
    await assert.rejects(wallets.changeBalance(admin, 3, credit));
    await assert.rejects(wallets.changeBalance(admin, 2, { ...credit, amount: -1, requestKey: "simulation-credit-0002" }));
    await wallets.changeBalance(admin, 2, { operation: "ASSIGNED_SET", amount: "250.50", currency: "GEL", requestKey: "assigned-balance-0001" });
    const summary = await wallets.summary(2);
    assert.equal(summary.assigned.amount, 250.5);
    assert.equal(summary.assigned.currency, "GEL");
    assert.equal(summary.simulation.available, 1500.29);
    assert.equal((await wallets.history(2)).length, 2);
    assert.equal((await wallets.summary(3)).assigned.amount, 0);
  } finally { await pool.end(); }
});

test("released simulation profit can fund another bot without crediting it twice", async () => {
  const { pool, wallets } = await fixture();
  try {
    await wallets.fundStrategy(2, 10, 1000);
    await pool.query("UPDATE bot_strategies SET withdrawn_profit = 50 WHERE id = 10");
    await wallets.fundStrategy(2, 11, 50);
    assert.equal((await wallets.summary(2)).simulation.available, 0);
    await assert.rejects(wallets.fundStrategy(2, 11, 51));
    assert.equal((await wallets.summary(2)).simulation.available, 0);
  } finally { await pool.end(); }
});

test("simulation reset transfers its allocation and realizes PnL instead of granting new capital", async () => {
  const { pool, wallets } = await fixture();
  try {
    await wallets.fundStrategy(2, 10, 800);
    await wallets.replaceSimulationStrategy(2, 10, 50, async () => {
      await pool.query("INSERT INTO bot_strategies (id,total_budget) VALUES (20,800)");
      return { id: 20 };
    });
    const wallet = await wallets.summary(2);
    assert.equal(wallet.simulation.credited, 1050);
    assert.equal(wallet.simulation.allocated, 800);
    assert.equal(wallet.simulation.available, 250);
    assert.deepEqual(wallet.simulation.strategyIds, [20]);
    assert.equal(await wallets.isFunded(2, 10, 800), false);
    assert.equal(await wallets.isFunded(2, 20, 800), true);
  } finally { await pool.end(); }
});

test("opening migration preserves existing demo budgets but never repeats a grant on restart", async () => {
  const { pool, wallets } = await fixture();
  try {
    await pool.query("UPDATE bot_strategies SET total_budget = 1500 WHERE id = 10");
    await wallets.migrateExistingStrategies();
    assert.equal((await wallets.summary(2)).simulation.credited, 1800);
    await wallets.changeBalance(admin, 2, { operation: "SIMULATION_CREDIT", amount: 100, requestKey: "migration-credit-0001" });
    await wallets.migrateExistingStrategies();
    assert.equal((await wallets.summary(2)).simulation.credited, 1900);
  } finally { await pool.end(); }
});

test("a reset cannot erase losses to replenish spent virtual money", async () => {
  const { pool, wallets } = await fixture();
  try {
    await wallets.fundStrategy(2, 10, 1000);
    let replaced = false;
    await assert.rejects(wallets.replaceSimulationStrategy(2, 10, -100, async () => { replaced = true; return { id: 20 }; }));
    assert.equal(replaced, false);
    assert.equal((await wallets.summary(2)).simulation.credited, 1000);
    assert.equal((await wallets.summary(2)).simulation.available, 0);
  } finally { await pool.end(); }
});
