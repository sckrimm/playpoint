import { Decimal } from "decimal.js";

export class OrderBelowMinimumError extends Error {
  constructor(message: string, public readonly minimumPrice?: number) { super(message); this.name = "OrderBelowMinimumError"; }
}

export interface TestnetOrderRules {
  stepSize: number;
  minNotional: number;
  maxNotional: number | null;
  avgPriceMins: number;
  quantity: Array<{ min: number; max: number | null; step: number }>;
}

type Filter = { filterType: string; stepSize?: string; minQty?: string; maxQty?: string; minNotional?: string; maxNotional?: string; applyToMarket?: boolean; applyMinToMarket?: boolean; applyMaxToMarket?: boolean; avgPriceMins?: number };

export function parseMarketRules(filters: Filter[]): TestnetOrderRules {
  const lots = filters.filter((item) => ["LOT_SIZE", "MARKET_LOT_SIZE"].includes(item.filterType));
  const quantity = lots.map((item) => ({ min: Number(item.minQty ?? 0), max: Number(item.maxQty ?? 0) === 0 ? null : Number(item.maxQty), step: Number(item.stepSize ?? 0) }));
  if (!lots.some((item) => item.filterType === "LOT_SIZE") || quantity.some((item) => !Number.isFinite(item.min) || item.min < 0 || !Number.isFinite(item.step) || item.step < 0 || (item.max !== null && (!Number.isFinite(item.max) || item.max <= 0 || item.max < item.min)))) throw new Error("სავაჭრო რაოდენობის წესები არასწორია");
  const applicable = filters.filter((item) => (item.filterType === "MIN_NOTIONAL" && item.applyToMarket !== false) || (item.filterType === "NOTIONAL" && (item.applyMinToMarket !== false || item.applyMaxToMarket === true)));
  const minima = applicable.filter((item) => item.filterType === "MIN_NOTIONAL" || item.applyMinToMarket !== false).map((item) => Number(item.minNotional));
  const maxima = applicable.filter((item) => item.filterType === "NOTIONAL" && item.applyMaxToMarket === true).map((item) => Number(item.maxNotional));
  if ([...minima, ...maxima].some((value) => !Number.isFinite(value) || value < 0)) throw new Error("სავაჭრო თანხის წესები არასწორია");
  const windows = [...new Set(applicable.map((item) => Number(item.avgPriceMins ?? 0)))];
  if (windows.some((value) => !Number.isInteger(value) || value < 0) || windows.length > 1) throw new Error("NOTIONAL ფილტრების დროის ფანჯრები შეუთავსებელია");
  const steps = quantity.map((item) => item.step).filter((value) => value > 0);
  if (!steps.length) throw new Error("რაოდენობის ბიჯი ვერ მოიძებნა");
  // LCM on scaled integers honors both LOT_SIZE and MARKET_LOT_SIZE.
  const precision = Math.max(...steps.map((step) => new Decimal(step).decimalPlaces()));
  const scale = new Decimal(10).pow(precision);
  const gcd = (left: bigint, right: bigint): bigint => right === 0n ? left : gcd(right, left % right);
  const combined = steps.map((step) => BigInt(new Decimal(step).mul(scale).toFixed(0))).reduce((left, right) => left / gcd(left, right) * right);
  return { stepSize: new Decimal(combined.toString()).div(scale).toNumber(), minNotional: Math.max(0, ...minima), maxNotional: maxima.length ? Math.min(...maxima) : null,
    avgPriceMins: windows[0] ?? 0, quantity };
}

export function floorMarketQuantity(value: number, rules: TestnetOrderRules): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("სავაჭრო რაოდენობა არასწორია");
  const quantity = new Decimal(value).div(rules.stepSize).floor().mul(rules.stepSize);
  if (quantity.lte(0) || rules.quantity.some((rule) => quantity.lt(rule.min))) throw new OrderBelowMinimumError("რაოდენობა Binance-ის მინიმუმზე ნაკლებია; დონე მოლოდინში რჩება");
  if (rules.quantity.some((rule) => rule.max !== null && quantity.gt(rule.max))) throw new Error("რაოდენობა Binance-ის მაქსიმუმს აღემატება");
  return quantity.toNumber();
}

export function checkMarketNotional(quantity: number, price: number, rules: TestnetOrderRules): void {
  if (!Number.isFinite(price) || price <= 0) throw new Error("სავაჭრო ფასი არასწორია");
  const notional = new Decimal(quantity).mul(price);
  if (notional.lt(rules.minNotional)) throw new OrderBelowMinimumError(`ორდერი ${notional.toFixed(4)} USDT-ია; მინიმუმია ${rules.minNotional} USDT. დონე მოლოდინში რჩება`, new Decimal(rules.minNotional).div(quantity).toNumber());
  if (rules.maxNotional !== null && notional.gt(rules.maxNotional)) throw new Error("ორდერი Binance-ის მაქსიმალურ თანხას აღემატება");
}
