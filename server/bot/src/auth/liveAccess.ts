import type { DashboardUser } from "./userAuthStore.js";
import type { ExecutionEnvironment, StrategyRecord } from "../types/strategy.js";

export function hasLiveAccess(user: DashboardUser | null): boolean {
  return user?.role === "ADMIN" || user?.liveAccess === true;
}

export function hasTestnetAccess(user: DashboardUser | null): boolean {
  return user?.role === "ADMIN" || user?.testnetAccess === true;
}

export function filterEnvironment(strategies: StrategyRecord[], environment: ExecutionEnvironment | null, liveAllowed: boolean, testnetAllowed = true): StrategyRecord[] {
  return strategies.filter((strategy) => (liveAllowed || strategy.executionEnvironment !== "LIVE") &&
    (testnetAllowed || strategy.executionEnvironment !== "TESTNET") &&
    (environment === null || strategy.executionEnvironment === environment));
}

export function parseEnvironment(value: string | null): ExecutionEnvironment | null {
  if (value === null) return null;
  if (value !== "SIMULATION" && value !== "TESTNET" && value !== "LIVE") throw new Error("გარემო არასწორია");
  return value;
}
