import assert from "node:assert/strict";
import { test } from "node:test";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { CredentialVault } from "../src/auth/credentialVault.js";
import { UserAuthStore } from "../src/auth/userAuthStore.js";
import { resolveCredentials } from "../src/auth/accountCredentials.js";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";

test("credential encryption authenticates the user and environment and never stores plaintext", () => {
  const vault = new CredentialVault("ab".repeat(32));
  const credentials = { apiKey: "test-key", apiSecret: "test-secret" };
  const encrypted = vault.encrypt(credentials, 1, "TESTNET");
  assert.ok(!encrypted.includes(credentials.apiSecret));
  assert.deepEqual(vault.decrypt(encrypted, 1, "TESTNET"), credentials);
  assert.throws(() => vault.decrypt(encrypted, 2, "TESTNET"));
  assert.throws(() => vault.decrypt(encrypted, 1, "LIVE"));
  assert.throws(() => new CredentialVault("cd".repeat(32)).decrypt(encrypted, 1, "TESTNET"));
  assert.throws(() => new CredentialVault("").encrypt(credentials, 1, "TESTNET"));
});

test("a member without credentials cannot fall back to the administrator's environment keys", async () => {
  const store = { credentials: async () => null } as unknown as UserAuthStore;
  assert.equal(await resolveCredentials(store, { id: 2, username: "friend", role: "USER" }, "TESTNET"), null);
  assert.equal(await resolveCredentials(store, null, "TESTNET"), null);
  const credentials = { apiKey: "friend-key", apiSecret: "friend-secret" };
  const ownStore = { credentials: async (id: number) => { assert.equal(id, 2); return credentials; } } as unknown as UserAuthStore;
  assert.deepEqual(await resolveCredentials(ownStore, { id: 2, username: "friend", role: "USER" }, "TESTNET"), credentials);
});

test("invites, sessions and strategy ownership isolate two accounts", async () => {
  const previousKey = process.env.BOT_CREDENTIALS_ENCRYPTION_KEY;
  process.env.BOT_CREDENTIALS_ENCRYPTION_KEY = "12".repeat(32);
  // pg-mem otherwise rejects the repeated CREATE TABLE IF NOT EXISTS restart check.
  const db = newDb({ noAstCoverageCheck: true });
  db.public.none(`CREATE TABLE bot_strategies (id BIGSERIAL PRIMARY KEY, symbol TEXT, final_reserve_percent NUMERIC, status TEXT, execution_environment TEXT, updated_at TIMESTAMPTZ, total_budget NUMERIC DEFAULT 0, withdrawn_profit NUMERIC DEFAULT 0);
    CREATE TABLE bot_strategy_templates (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE);
    CREATE TABLE bot_executed_levels (strategy_id BIGINT, status TEXT);
    INSERT INTO bot_strategies (symbol, final_reserve_percent, status, execution_environment) VALUES ('BTCUSDT', 20, 'ACTIVE', 'SIMULATION');`);
  const Adapter = db.adapters.createPg();
  const pool = new Adapter.Pool() as unknown as Pool;
  const users = new UserAuthStore("", pool);
  try {
    await users.initialize("owner", "owner-password-test");
    const admin = (await users.authenticate("owner", "owner-password-test"))!;
    const invitation = await users.createInvite(admin.id);
    const friend = await users.register(invitation.code, "friend", "friend-password-test");
    assert.equal(friend.liveAccess, false);
    assert.equal(friend.testnetAccess, false);
    assert.equal((await users.wallets.summary(friend.id)).simulation.available, 1000);
    await users.saveCredentials(admin.id, "TESTNET", { apiKey: "admin-api-key", apiSecret: "admin-secret" });
    await users.saveCredentials(friend.id, "TESTNET", { apiKey: "friend-api-key", apiSecret: "friend-secret" });
    assert.equal((await users.credentials(friend.id, "TESTNET"))?.apiKey, "friend-api-key");
    assert.equal((await users.credentials(admin.id, "TESTNET"))?.apiKey, "admin-api-key");
    assert.ok(!JSON.stringify(await users.profile(friend)).includes("friend-secret"));
    await users.recordAccountBalance(admin.id, 100);
    await users.recordAccountBalance(friend.id, 200);
    assert.equal(await users.accountBalanceReference(admin.id, new Date()), 100);
    assert.equal(await users.accountBalanceReference(friend.id, new Date()), 200);
    await assert.rejects(users.register(invitation.code, "another", "another-password-test"));
    const token = await users.createSession(friend.id);
    assert.equal((await users.getSession(token))?.id, friend.id);
    await users.revokeSession(token);
    assert.equal(await users.getSession(token), null);
    await assert.rejects(users.assertStrategyAccess(1, friend));
    assert.deepEqual([...await users.filterStrategyIds([1], friend)], []);
    await pool.query("INSERT INTO bot_strategies (symbol, final_reserve_percent, status, execution_environment) VALUES ('SOLUSDT', 20, 'ACTIVE', 'SIMULATION')");
    await users.assignStrategy(2, friend.id);
    assert.deepEqual([...await users.filterStrategyIds([1, 2], admin)], [1]);
    assert.deepEqual([...await users.filterStrategyIds([1, 2], friend)], [2]);
    await assert.rejects(users.assertStrategyAccess(2, admin));
    await users.assertStrategyAccess(2, admin, true);
    await assert.rejects(users.setShared(1, friend.id, true));
    await users.setShared(2, friend.id, true);
    const shared = await users.sharedStrategies();
    assert.equal(shared.length, 1);
    assert.equal(shared[0].username, "friend");
    assert.ok(!("total_budget" in shared[0]) && !("apiKey" in shared[0]));
    const liveToken = await users.createSession(friend.id);
    assert.equal((await users.getSession(liveToken))?.liveAccess, false);
    await assert.rejects(users.setLiveAccess(friend, friend.id, true));
    await users.setLiveAccess(admin, friend.id, true);
    const granted = (await users.getSession(liveToken))!;
    assert.equal(granted.liveAccess, true);
    assert.equal((await users.authenticate("friend", "friend-password-test"))?.liveAccess, true);
    assert.equal((await users.listUsers()).find((user) => user.id === friend.id)?.liveAccess, true);
    await pool.query("INSERT INTO bot_strategies (symbol, status, execution_environment) VALUES ('ETHUSDT', 'ACTIVE', 'LIVE')");
    await users.assignStrategy(3, friend.id);
    await users.assertStrategyAccess(3, granted);
    await users.setLiveAccess(admin, friend.id, false);
    const revoked = (await users.getSession(liveToken))!;
    assert.equal(revoked.liveAccess, false);
    await assert.rejects(users.assertStrategyAccess(3, revoked));
    assert.equal((await pool.query("SELECT status FROM bot_strategies WHERE id = 3")).rows[0].status, "PAUSED");
    assert.equal((await pool.query("SELECT status FROM bot_strategies WHERE id = 2")).rows[0].status, "ACTIVE");
    assert.equal((await users.getSession(await users.createSession(admin.id)))?.liveAccess, true);
    await users.setTestnetAccess(admin, friend.id, true);
    const testnetGranted = (await users.getSession(liveToken))!;
    assert.equal(testnetGranted.testnetAccess, true);
    await pool.query("INSERT INTO bot_strategies (symbol, status, execution_environment) VALUES ('BNBUSDT', 'ACTIVE', 'TESTNET')");
    await users.assignStrategy(4, friend.id);
    await users.assertStrategyAccess(4, testnetGranted);
    await users.setTestnetAccess(admin, friend.id, false);
    const testnetRevoked = (await users.getSession(liveToken))!;
    assert.equal(testnetRevoked.testnetAccess, false);
    await assert.rejects(users.assertStrategyAccess(4, testnetRevoked));
    assert.equal((await pool.query("SELECT status FROM bot_strategies WHERE id = 4")).rows[0].status, "PAUSED");
    await users.wallets.changeBalance(admin, friend.id, { operation: "SIMULATION_CREDIT", amount: 10, requestKey: "restart-credit-0001" });
    await users.initialize("owner", "owner-password-test");
    assert.equal((await users.wallets.summary(friend.id)).simulation.credited, 1010);
    assert.equal((await users.getSession(liveToken))?.testnetAccess, false);
  } finally {
    await users.close();
    if (previousKey === undefined) delete process.env.BOT_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.BOT_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("identical Binance order IDs on separate strategies do not suppress either user's trade", async () => {
  const db = openDatabase(":memory:");
  const store = new StrategyRepository(db);
  const config = { executionEnvironment: "SIMULATION" as const, symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
    initialEntryPrice: 100, totalBudget: 100, finalReservePercent: 20,
    buyLevels: [{ dropPercent: 10, budgetPercent: 100 }], sellLevels: [{ gainPercent: 10, allocationPercent: 80 }] };
  try {
    const a = await store.createStrategy(config);
    const b = await store.createStrategy(config);
    await store.completeBuy(a.id, 0, 100, 100, 1, "same-exchange-id");
    await store.completeBuy(b.id, 0, 100, 100, 1, "same-exchange-id");
    assert.equal((await store.getById(a.id)).totalInvested, 100);
    assert.equal((await store.getById(b.id)).totalInvested, 100);
    await store.completeBuy(b.id, 0, 100, 100, 1, "same-exchange-id");
    assert.equal(await store.countOrders(b.id), 1);
    await store.setStrategyStatus(b.id, "PAUSED");
    assert.equal(await store.claimLevel(b.id, "BUY", 10, "paused-client"), false);
  } finally { db.close(); }
});
