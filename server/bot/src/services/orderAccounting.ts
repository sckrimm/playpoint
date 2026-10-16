import { Decimal } from "decimal.js";
import type { OrderAccounting, OrderExecutionResult } from "../types/strategy.js";

export interface ExecutionFill { price: string; qty: string; commission: string; commissionAsset: string; quoteQty?: string }

function decimal(value: string, positive: boolean): Decimal {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) throw new Error("Invalid execution decimal");
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || (positive ? parsed.lte(0) : parsed.lt(0))) throw new Error("Invalid execution amount");
  return parsed;
}

export function accountExecution(symbol: string, side: "BUY" | "SELL", orderId: string, grossQuantity: string,
  grossQuote: string, fills: ExecutionFill[], source: OrderAccounting["source"]): OrderExecutionResult {
  if (!symbol.endsWith("USDT") || !/^\d+$/.test(orderId) || !fills.length) throw new Error("Incomplete execution identity");
  const quantity = decimal(grossQuantity, true);
  const quote = decimal(grossQuote, true);
  const base = symbol.slice(0, -4);
  let fillQuantity = new Decimal(0);
  let fillQuote = new Decimal(0);
  const fees = new Map<string, Decimal>();
  for (const fill of fills) {
    if (source === "MY_TRADES" && typeof fill.quoteQty !== "string") throw new Error("Missing trade quote amount");
    const qty = decimal(fill.qty, true);
    const price = decimal(fill.price, true);
    const commission = decimal(fill.commission, false);
    if (typeof fill.commissionAsset !== "string" || !/^[A-Z0-9]{1,30}$/.test(fill.commissionAsset)) throw new Error("Invalid commission asset");
    fillQuantity = fillQuantity.plus(qty);
    fillQuote = fillQuote.plus(fill.quoteQty === undefined ? qty.mul(price) : decimal(fill.quoteQty, true));
    fees.set(fill.commissionAsset, (fees.get(fill.commissionAsset) ?? new Decimal(0)).plus(commission));
  }
  // FULL omits per-trade quote rounding; allow at most one quote precision unit per fill.
  const tolerance = source === "FULL" ? new Decimal("0.00000001").mul(fills.length) : new Decimal("0.00000001");
  if (!fillQuantity.eq(quantity) || fillQuote.minus(quote).abs().gt(tolerance)) throw new Error("Incomplete execution fills");
  const baseFee = fees.get(base) ?? new Decimal(0);
  const quoteFee = fees.get("USDT") ?? new Decimal(0);
  const netQuantity = side === "BUY" ? quantity.minus(baseFee) : quantity.plus(baseFee);
  const netQuote = side === "BUY" ? quote.plus(quoteFee) : quote.minus(quoteFee);
  if (netQuantity.lte(0) || netQuote.lte(0)) throw new Error("Invalid net execution");
  const accounting: OrderAccounting = {
    status: [...fees].some(([asset, amount]) => asset !== base && asset !== "USDT" && amount.gt(0)) ? "UNPRICED" : "VERIFIED",
    source, grossQuantity: quantity.toFixed(), grossQuote: quote.toFixed(),
    commissions: [...fees].map(([asset, amount]) => ({ asset, amount: amount.toFixed() })),
  };
  const result = { orderId, symbol, side, price: quote.div(quantity).toNumber(), quoteAmount: netQuote.toNumber(), assetQuantity: netQuantity.toNumber(), accounting };
  if (![result.price, result.quoteAmount, result.assetQuantity].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Execution overflow");
  return result;
}
