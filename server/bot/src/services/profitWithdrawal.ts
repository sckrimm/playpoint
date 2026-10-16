import type { StrategyRecord } from "../types/strategy.js";

export interface ProfitWithdrawalRequest {
  requestKey: string;
  amount: number;
  cashAmount: number;
  saleAmount: number;
  actualAmount: number;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  isNew?: boolean;
}

export function profitAvailability(strategy: StrategyRecord) {
  const realizedAvailable = Math.max(0, strategy.realizedProfit - strategy.withdrawnProfit);
  const freeQuote = Math.max(0, strategy.totalBudget + strategy.totalSaleProceeds - strategy.totalInvested - strategy.withdrawnProfit);
  return { realizedAvailable, freeQuote, cashAvailable: Math.min(realizedAvailable, freeQuote) };
}

export function planProfitWithdrawal(strategy: StrategyRecord, amount: number, allowSale: boolean) {
  if (strategy.executionEnvironment === "LIVE") throw new Error("LIVE რეჟიმი დაბლოკილია");
  if (strategy.status !== "PAUSED") throw new Error("მოგების აღებამდე სტრატეგია შეაჩერე");
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    throw new Error("თანხა მიუთითე ცენტების სიზუსტით");
  }
  const available = profitAvailability(strategy);
  if (amount > available.realizedAvailable + 1e-8) throw new Error("თანხა რეალიზებულ, ჯერ აუღებელ მოგებას აღემატება");
  const cashAmount = Math.min(amount, available.cashAvailable);
  const saleAmount = Math.max(0, amount - cashAmount);
  if (saleAmount > 1e-8 && !allowSale) throw new Error("თავისუფალი USDT არ კმარა; დამატებითი გაყიდვა ცალკე თანხმობას მოითხოვს");
  return { cashAmount, saleAmount: saleAmount > 1e-8 ? saleAmount : 0 };
}

export function validateProfitRequestKey(key: string) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new Error("მოგების აღების მოთხოვნის იდენტიფიკატორი არასწორია");
}

export function mapProfitRequest(row: Record<string, unknown>): ProfitWithdrawalRequest {
  return { requestKey: String(row.request_key), amount: Number(row.amount), cashAmount: Number(row.cash_amount),
    saleAmount: Number(row.sale_amount), actualAmount: Number(row.actual_amount), status: row.status as ProfitWithdrawalRequest["status"],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(String(row.created_at)).toISOString() };
}
