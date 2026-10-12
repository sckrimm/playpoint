import type { OrderRecord, StrategyRecord } from "../types/strategy.js";

export function periodPerformance(strategy: StrategyRecord, orders: OrderRecord[], currentPnl: number | null,
  referencePrice: number | null, targetTime: number) {
  if (currentPnl === null || referencePrice === null || Date.parse(strategy.createdAt) > targetTime) return null;
  let quantity = 0;
  let invested = 0;
  let proceeds = 0;
  let withdrawn = 0;
  for (const order of orders) {
    if (new Date(order.createdAt).getTime() > targetTime) continue;
    if (order.side === "BUY") {
      quantity += order.assetQuantity;
      invested += order.quoteAmount;
    } else {
      quantity -= order.assetQuantity;
      proceeds += order.quoteAmount;
      if (order.levelPercent === 0) withdrawn += order.quoteAmount;
    }
  }
  const previousPnl = Math.max(0, quantity) * referencePrice + proceeds - invested;
  const startingEquity = strategy.totalBudget + previousPnl - withdrawn;
  const change = currentPnl - previousPnl;
  return { change, startingEquity, percent: startingEquity > 0 ? change / startingEquity * 100 : null };
}
