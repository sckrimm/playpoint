import "dotenv/config";
import path from "node:path";
import { DEFAULT_BUY_LEVELS, parseSellAllocations, validateStrategyConfig } from "./strategy.js";
import type { StrategyConfig, TradingMode } from "../types/strategy.js";

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a valid number`);
  return value;
}

const tradingMode = (process.env.TRADING_MODE ?? "SIMULATION").toUpperCase() as TradingMode;
if (tradingMode === "LIVE" || !["SIMULATION", "TESTNET"].includes(tradingMode)) {
  throw new Error("Safety lock: TRADING_MODE may only be SIMULATION or TESTNET; LIVE is disabled");
}

export const appConfig = {
  tradingMode,
  binanceApiKey: process.env.BINANCE_API_KEY?.trim() || undefined,
  binanceApiSecret: process.env.BINANCE_API_SECRET?.trim() || undefined,
  binanceTestnetApiKey: process.env.BINANCE_TESTNET_API_KEY?.trim() || undefined,
  binanceTestnetApiSecret: process.env.BINANCE_TESTNET_API_SECRET?.trim() || undefined,
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  databasePath: path.resolve(process.env.DATABASE_PATH ?? "./data/bot.db"),
  strategy: {
    executionEnvironment: tradingMode,
    symbol: (process.env.DEMO_SYMBOL ?? "BTCUSDT").toUpperCase(),
    baseAsset: (process.env.DEMO_SYMBOL ?? "BTCUSDT").toUpperCase().replace(/USDT$/, ""),
    quoteAsset: "USDT",
    initialEntryPrice: numberFromEnv("INITIAL_ENTRY_PRICE", 80_000),
    totalBudget: numberFromEnv("TOTAL_BUDGET", 1_000),
    buyLevels: DEFAULT_BUY_LEVELS,
    sellLevels: parseSellAllocations(process.env.SELL_ALLOCATIONS ?? "25:20,40:20,50:20,70:15,100:15"),
    finalReservePercent: numberFromEnv("FINAL_RESERVE_PERCENT", 10),
  } satisfies StrategyConfig,
};

validateStrategyConfig(appConfig.strategy);
