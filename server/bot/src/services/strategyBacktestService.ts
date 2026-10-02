import type { BinanceCandle } from "../binance/binanceMarketHistoryService.js";
import type { BuyLevelConfig, SellLevelConfig } from "../types/strategy.js";

export interface BacktestConfig {
  totalBudget: number;
  initialPurchaseAmount: number;
  finalReservePercent: number;
  buyLevels: BuyLevelConfig[];
  sellLevels: SellLevelConfig[];
}

export interface BacktestResult {
  initialPrice: number;
  finalPrice: number;
  finalEquity: number;
  profit: number;
  profitPercent: number;
  maximumDrawdownPercent: number;
  totalInvested: number;
  budgetUsedPercent: number;
  buyOrderCount: number;
  sellOrderCount: number;
  remainingAssetQuantity: number;
}

export function runStrategyBacktest(config: BacktestConfig, candles: BinanceCandle[]): BacktestResult {
  if (!candles.length) throw new Error("Backtest requires candle data");
  const initialPrice = candles[0]!.open;
  const buyLevels = config.buyLevels.map((level) => ({ ...level, executed: false }));
  const sellLevels = config.sellLevels.map((level) => ({ ...level, executed: false }));
  const buyBudget = config.totalBudget - config.initialPurchaseAmount;
  let cash = config.totalBudget;
  let totalInvested = 0;
  let totalPurchasedQuantity = 0;
  let assetQuantity = 0;
  let buyOrderCount = 0;
  let sellOrderCount = 0;
  let peakEquity = config.totalBudget;
  let maximumDrawdownPercent = 0;

  const buyAt = (price: number, budgetPercent: number) => {
    const quoteAmount = Math.min(cash, buyBudget * budgetPercent / 100);
    if (quoteAmount <= 0) return;
    const quantity = quoteAmount / price;
    cash -= quoteAmount;
    totalInvested += quoteAmount;
    totalPurchasedQuantity += quantity;
    assetQuantity += quantity;
    buyOrderCount += 1;
  };
  const sellAt = (price: number, allocationPercent: number) => {
    const reserve = totalPurchasedQuantity * config.finalReservePercent / 100;
    const quantity = Math.min(totalPurchasedQuantity * allocationPercent / 100, Math.max(0, assetQuantity - reserve));
    if (quantity <= 0) return;
    assetQuantity -= quantity;
    cash += quantity * price;
    sellOrderCount += 1;
  };

  if (config.initialPurchaseAmount > 0) buyAt(initialPrice, config.initialPurchaseAmount / Math.max(buyBudget, 1) * 100);

  for (const candle of candles) {
    const processBuys = () => {
      for (const level of buyLevels) {
        const trigger = initialPrice * (1 - level.dropPercent / 100);
        if (!level.executed && candle.low <= trigger) {
          buyAt(trigger, level.budgetPercent);
          level.executed = true;
        }
      }
    };
    const processSells = () => {
      for (const level of sellLevels) {
        const trigger = initialPrice * (1 + level.gainPercent / 100);
        if (!level.executed && candle.high >= trigger && assetQuantity > 0) {
          sellAt(trigger, level.allocationPercent);
          level.executed = true;
        }
      }
    };
    if (candle.close >= candle.open) { processBuys(); processSells(); }
    else { processSells(); processBuys(); }
    const equity = cash + assetQuantity * candle.close;
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) maximumDrawdownPercent = Math.max(maximumDrawdownPercent, (peakEquity - equity) / peakEquity * 100);
  }

  const finalPrice = candles[candles.length - 1]!.close;
  const finalEquity = cash + assetQuantity * finalPrice;
  const profit = finalEquity - config.totalBudget;
  return {
    initialPrice,
    finalPrice,
    finalEquity,
    profit,
    profitPercent: config.totalBudget > 0 ? profit / config.totalBudget * 100 : 0,
    maximumDrawdownPercent,
    totalInvested,
    budgetUsedPercent: config.totalBudget > 0 ? totalInvested / config.totalBudget * 100 : 0,
    buyOrderCount,
    sellOrderCount,
    remainingAssetQuantity: assetQuantity,
  };
}
