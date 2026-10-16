import type { OrderRecord, StrategyRecord } from "../types/strategy.js";

export function periodPerformance(strategy: StrategyRecord, orders: OrderRecord[], currentPnl: number | null,
  referencePrice: number | null, targetTime: number, cashWithdrawals: Array<{ amount: number; createdAt: string }> = []) {
  if (currentPnl === null || !Number.isFinite(currentPnl)) return null;
  if (Date.parse(strategy.createdAt) > targetTime) {
    return { change: currentPnl, startingEquity: strategy.totalBudget,
      percent: strategy.totalBudget > 0 ? currentPnl / strategy.totalBudget * 100 : null, sinceCreated: true };
  }
  let quantity = 0;
  let invested = 0;
  let proceeds = 0;
  let withdrawn = 0;
  for (const withdrawal of cashWithdrawals) {
    if (Date.parse(withdrawal.createdAt) <= targetTime) withdrawn += withdrawal.amount;
  }
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
  if (quantity > 1e-12 && (referencePrice === null || !Number.isFinite(referencePrice) || referencePrice <= 0)) return null;
  const previousPnl = Math.max(0, quantity) * (referencePrice ?? 0) + proceeds - invested;
  const startingEquity = strategy.totalBudget + previousPnl - withdrawn;
  const change = currentPnl - previousPnl;
  return { change, startingEquity, percent: startingEquity > 0 ? change / startingEquity * 100 : null, sinceCreated: false };
}
