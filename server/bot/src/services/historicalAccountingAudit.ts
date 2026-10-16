import { Decimal } from "decimal.js";
import type { OrderExecutionResult, OrderRecord, StrategyRecord } from "../types/strategy.js";

type AuditStatus = "MATCH" | "DIFFERENCE" | "UNPRICED" | "MISSING" | "UNSUPPORTED" | "UNAVAILABLE" | "SKIPPED";
export interface AuditRow {
  localId: number;
  externalOrderId: string | null;
  side: "BUY" | "SELL";
  createdAt: string;
  status: AuditStatus;
  stored: { price: number; quoteAmount: number; assetQuantity: number };
  actual: OrderExecutionResult | null;
  difference: { quoteAmount: number; assetQuantity: number } | null;
}

export interface HistoricalAuditReport {
  strategyId: number;
  symbol: string;
  generatedAt: string;
  readOnly: true;
  offset: number;
  limit: number;
  totalOrders: number;
  nextOffset: number | null;
  stale: boolean;
  rows: AuditRow[];
  complete: boolean;
  ledgerProjection: { totalInvested: number; totalSaleProceeds: number; totalAssetQuantity: number; remainingCostBasis: number; realizedProfit: number } | null;
  projectionBlocked: "PARTIAL" | "EVIDENCE" | "BASELINE" | "STALE" | null;
}

export function auditPage(offset: unknown = 0, limit: unknown = 5): { offset: number; limit: number } {
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 ||
    typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("შემოწმების გვერდი არასწორია");
  return { offset, limit };
}

function replay(rows: Array<{ side: "BUY" | "SELL"; quoteAmount: number; assetQuantity: number }>) {
  let quantity = new Decimal(0), cost = new Decimal(0), invested = new Decimal(0), proceeds = new Decimal(0), profit = new Decimal(0);
  for (const row of rows) {
    if (![row.quoteAmount, row.assetQuantity].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Invalid order ledger");
    const qty = new Decimal(row.assetQuantity), quote = new Decimal(row.quoteAmount);
    if (row.side === "BUY") { quantity = quantity.plus(qty); cost = cost.plus(quote); invested = invested.plus(quote); }
    else {
      if (quantity.lte(0) || qty.minus(quantity).gt("0.000000000001")) throw new Error("Incomplete position history");
      const costSold = cost.mul(qty).div(quantity);
      cost = Decimal.max(0, cost.minus(costSold)); quantity = Decimal.max(0, quantity.minus(qty));
      proceeds = proceeds.plus(quote); profit = profit.plus(quote.minus(costSold));
    }
  }
  return { totalInvested: invested.toNumber(), totalSaleProceeds: proceeds.toNumber(), totalAssetQuantity: quantity.toNumber(), remainingCostBasis: cost.toNumber(), realizedProfit: profit.toNumber() };
}

export async function auditHistoricalOrders(strategy: StrategyRecord, orders: OrderRecord[],
  inspect: (symbol: string, side: "BUY" | "SELL", orderId: string) => Promise<OrderExecutionResult | null>, offset = 0, limit = 5): Promise<HistoricalAuditReport> {
  auditPage(offset, limit);
  if (strategy.executionEnvironment !== "TESTNET" || strategy.status !== "PAUSED") throw new Error("შემოწმებისთვის TESTNET ბოტი შეაჩერე");
  // Binance trade/order IDs need not follow insertion time; local ID is the durable ledger order.
  const sorted = [...orders].sort((a, b) => a.id - b.id);
  const batch = sorted.slice(offset, offset + limit);
  const rows: AuditRow[] = [];
  let unavailable = false;
  for (const order of batch) {
    const row: AuditRow = { localId: order.id, externalOrderId: order.externalOrderId ?? null, side: order.side, createdAt: order.createdAt,
      status: "UNSUPPORTED", stored: { price: order.marketPrice, quoteAmount: order.quoteAmount, assetQuantity: order.assetQuantity }, actual: null, difference: null };
    rows.push(row);
    if (order.executionEnvironment !== "TESTNET" || !order.externalOrderId || !/^[1-9]\d*$/.test(order.externalOrderId)) continue;
    if (unavailable) { row.status = "SKIPPED"; continue; }
    try {
      const actual = await inspect(strategy.symbol, order.side, order.externalOrderId);
      if (!actual) { row.status = "MISSING"; continue; }
      if (actual.orderId !== order.externalOrderId || actual.side !== order.side || actual.symbol !== strategy.symbol ||
        !actual.accounting || ![actual.price, actual.quoteAmount, actual.assetQuantity].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Invalid historical execution");
      row.actual = actual;
      row.difference = { quoteAmount: new Decimal(actual.quoteAmount).minus(order.quoteAmount).toNumber(), assetQuantity: new Decimal(actual.assetQuantity).minus(order.assetQuantity).toNumber() };
      row.status = actual.accounting.status === "UNPRICED" ? "UNPRICED"
        : row.difference.quoteAmount !== 0 || row.difference.assetQuantity !== 0 || Math.abs(actual.price - order.marketPrice) > 1e-8 ? "DIFFERENCE" : "MATCH";
    } catch { row.status = "UNAVAILABLE"; unavailable = true; }
  }
  const complete = offset === 0 && batch.length === orders.length;
  const report: HistoricalAuditReport = { strategyId: strategy.id, symbol: strategy.symbol, generatedAt: new Date().toISOString(), readOnly: true,
    offset, limit, totalOrders: orders.length, nextOffset: offset + batch.length < orders.length ? offset + batch.length : null,
    stale: false, rows, complete, ledgerProjection: null, projectionBlocked: complete ? "EVIDENCE" : "PARTIAL" };
  if (!complete || !rows.length || rows.some((row) => !["MATCH", "DIFFERENCE"].includes(row.status))) return report;
  try {
    const baseline = replay(sorted);
    if (Object.entries(baseline).some(([key, value]) => !Number.isFinite(strategy[key as keyof typeof baseline]) || Math.abs(value - strategy[key as keyof typeof baseline]) > (key === "totalAssetQuantity" ? 1e-10 : 1e-6))) {
      report.projectionBlocked = "BASELINE";
      return report;
    }
    report.ledgerProjection = replay(rows.map((row) => row.actual!));
    report.projectionBlocked = null;
  } catch { report.projectionBlocked = "BASELINE"; }
  return report;
}

export class HistoricalAuditGate {
  private active = new Set<string>();
  private retryAt = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  async run<T>(accountKey: string, operation: () => Promise<T>): Promise<T> {
    if (this.active.has(accountKey)) throw new Error("ამ ანგარიშის შემოწმება უკვე მიმდინარეობს");
    if (this.now() < (this.retryAt.get(accountKey) ?? 0)) throw new Error("მოთხოვნების დასაცავად 10 წამი მოიცადე");
    this.active.add(accountKey);
    try { return await operation(); }
    finally { this.active.delete(accountKey); this.retryAt.set(accountKey, this.now() + 10_000); }
  }
}
