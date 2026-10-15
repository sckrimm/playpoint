import assert from "node:assert/strict";
import { test } from "node:test";
import { filterEnvironment, hasLiveAccess, hasTestnetAccess, parseEnvironment } from "../src/auth/liveAccess.js";
import type { StrategyRecord } from "../src/types/strategy.js";

test("LIVE access is denied by default and explicitly granted independently of login", () => {
  assert.equal(hasLiveAccess(null), false);
  assert.equal(hasLiveAccess({ id: 2, username: "friend", role: "USER" }), false);
  assert.equal(hasLiveAccess({ id: 2, username: "friend", role: "USER", liveAccess: false }), false);
  assert.equal(hasLiveAccess({ id: 2, username: "friend", role: "USER", liveAccess: true }), true);
  assert.equal(hasLiveAccess({ id: 1, username: "owner", role: "ADMIN" }), true);
  assert.equal(hasTestnetAccess({ id: 2, username: "friend", role: "USER" }), false);
  assert.equal(hasTestnetAccess({ id: 2, username: "friend", role: "USER", testnetAccess: true }), true);
  assert.equal(hasTestnetAccess({ id: 1, username: "owner", role: "ADMIN" }), true);
});

test("environment views do not mix LIVE, TESTNET and simulation or expose LIVE without permission", () => {
  const strategies = ["SIMULATION", "TESTNET", "LIVE"].map((executionEnvironment, id) => ({ id, executionEnvironment })) as StrategyRecord[];
  assert.deepEqual(filterEnvironment(strategies, null, false).map((strategy) => strategy.id), [0, 1]);
  assert.deepEqual(filterEnvironment(strategies, "LIVE", false), []);
  assert.deepEqual(filterEnvironment(strategies, "LIVE", true).map((strategy) => strategy.id), [2]);
  assert.deepEqual(filterEnvironment(strategies, "TESTNET", true).map((strategy) => strategy.id), [1]);
  assert.deepEqual(filterEnvironment(strategies, "SIMULATION", true).map((strategy) => strategy.id), [0]);
  assert.deepEqual(filterEnvironment(strategies, null, false, false).map((strategy) => strategy.id), [0]);
  assert.equal(parseEnvironment(null), null);
  assert.equal(parseEnvironment("LIVE"), "LIVE");
  assert.throws(() => parseEnvironment("other"));
});
