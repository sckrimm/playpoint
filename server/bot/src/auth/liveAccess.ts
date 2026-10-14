import type { DashboardUser } from "./userAuthStore.js";
import type { ExecutionEnvironment, StrategyRecord } from "../types/strategy.js";

export function hasLiveAccess(user: DashboardUser | null): boolean {
  return user?.role === "ADMIN" || user?.liveAccess === true;
}

export function filterEnvironment(strategies: StrategyRecord[], environment: ExecutionEnvironment | null, liveAllowed: boolean): StrategyRecord[] {
  return strategies.filter((strategy) => (liveAllowed || strategy.executionEnvironment !== "LIVE") &&
    (environment === null || strategy.executionEnvironment === environment));
}

export function parseEnvironment(value: string | null): ExecutionEnvironment | null {
  if (value === null) return null;
  if (value !== "SIMULATION" && value !== "TESTNET" && value !== "LIVE") throw new Error("გარემო არასწორია");
  return value;
}
