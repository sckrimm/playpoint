import type { ExecutedLevelRecord, StrategyConfig, StrategyRecord } from "../types/strategy.js";

export function strategyRecordToConfig(strategy: StrategyRecord, levels: ExecutedLevelRecord[]): StrategyConfig {
  return {
    executionEnvironment: strategy.executionEnvironment,
    symbol: strategy.symbol,
    baseAsset: strategy.baseAsset,
    quoteAsset: strategy.quoteAsset,
    initialEntryPrice: strategy.initialEntryPrice,
    totalBudget: strategy.totalBudget,
    initialPurchaseAmount: strategy.initialPurchaseAmount,
    buyLevels: levels.filter((level) => level.side === "BUY")
      .map((level) => ({ dropPercent: level.levelPercent, budgetPercent: level.allocationPercent })),
    sellLevels: levels.filter((level) => level.side === "SELL")
      .map((level) => ({ gainPercent: level.levelPercent, allocationPercent: level.allocationPercent })),
    finalReservePercent: strategy.finalReservePercent,
  };
}
