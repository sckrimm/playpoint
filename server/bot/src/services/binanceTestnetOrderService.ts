import { createHmac, randomUUID } from "node:crypto";
import type { AccountBalance, OrderExecutionResult, OrderExecutionService } from "../types/strategy.js";

const TESTNET_BASE_URL = "https://testnet.binance.vision";

type FetchLike = typeof fetch;
type BinanceErrorPayload = { code?: number; msg?: string };
type OrderPayload = BinanceErrorPayload & {
  orderId?: number;
  clientOrderId?: string;
  status?: string;
  side?: "BUY" | "SELL";
  executedQty?: string;
  cummulativeQuoteQty?: string;
  fills?: Array<{ price: string; qty: string; commission: string; commissionAsset: string }>;
};

export type TestnetErrorKind = "INVALID_KEY" | "INVALID_SIGNATURE" | "TIMESTAMP_ERROR" | "ORDER_NOT_FOUND" |
  "RATE_LIMITED" | "INSUFFICIENT_BALANCE" | "FILTER_REJECTED" | "UNKNOWN_RESULT" | "ERROR";

export class BinanceTestnetOrderError extends Error {
  constructor(public readonly kind: TestnetErrorKind, message: string, public readonly noAutoRetry = false) {
    super(noAutoRetry ? `[NO_AUTO_RETRY] ${message}` : message);
    this.name = "BinanceTestnetOrderError";
  }
}

export class BinanceTestnetOrderService implements OrderExecutionService {
  readonly environment = "TESTNET" as const;
  private timeOffsetMs = 0;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!apiKey || !apiSecret) throw new Error("Binance Spot Testnet API მონაცემები მითითებული არ არის");
  }

  async buy(symbol: string, _price: number, quoteAmount: number, clientOrderId?: string): Promise<OrderExecutionResult> {
    if (!Number.isFinite(quoteAmount) || quoteAmount <= 0) throw new Error("TESTNET BUY თანხა ნულზე მეტი უნდა იყოს");
    return this.placeMarketOrder(symbol, "BUY", { quoteOrderQty: this.decimal(quoteAmount, 8) }, clientOrderId);
  }

  async sell(symbol: string, _price: number, assetQuantity: number, clientOrderId?: string): Promise<OrderExecutionResult> {
    if (!Number.isFinite(assetQuantity) || assetQuantity <= 0) throw new Error("TESTNET SELL რაოდენობა ნულზე მეტი უნდა იყოს");
    const stepSize = await this.getStepSize(symbol);
    const quantity = this.floorToStep(assetQuantity, stepSize);
    if (quantity <= 0) throw new BinanceTestnetOrderError("FILTER_REJECTED", "გასაყიდი რაოდენობა Binance-ის stepSize-ზე ნაკლებია");
    return this.placeMarketOrder(symbol, "SELL", { quantity: this.decimal(quantity, this.decimals(stepSize)) }, clientOrderId);
  }

  async getBalances(): Promise<AccountBalance[]> {
    await this.syncServerTime();
    const payload = await this.signedRequest("GET", "/api/v3/account", {}) as BinanceErrorPayload & {
      balances?: Array<{ asset: string; free: string; locked: string }>;
    };
    if (!payload.balances) throw new BinanceTestnetOrderError("ERROR", "Spot Testnet-მა ბალანსები არ დააბრუნა");
    const updatedAt = new Date().toISOString();
    return payload.balances.map((balance) => ({ ...balance, updatedAt }));
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const response = await this.fetchImpl(`${TESTNET_BASE_URL}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({})) as BinanceErrorPayload & { price?: string };
    if (!response.ok) throw this.safeError(response.status, payload.code);
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0) throw new BinanceTestnetOrderError("ERROR", "Spot Testnet-მა არასწორი ფასი დააბრუნა");
    return price;
  }

  async reconcileOrder(symbol: string, side: "BUY" | "SELL", clientOrderId: string): Promise<OrderExecutionResult | null> {
    try {
      const payload = await this.findOrder(symbol, clientOrderId);
      const executedQty = Number(payload.executedQty ?? 0);
      const terminalWithoutFill = ["CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"].includes(payload.status ?? "") && executedQty <= 0;
      if (terminalWithoutFill) return null;
      if (payload.status !== "FILLED" && !["CANCELED", "EXPIRED", "EXPIRED_IN_MATCH"].includes(payload.status ?? "")) {
        throw new BinanceTestnetOrderError("UNKNOWN_RESULT", `TESTNET ორდერი ჯერ დასრულებული არ არის (${payload.status ?? "UNKNOWN"})`, true);
      }
      return this.toResult(symbol, side, payload);
    } catch (error) {
      if (error instanceof BinanceTestnetOrderError && error.kind === "ORDER_NOT_FOUND") return null;
      throw error;
    }
  }

  private async placeMarketOrder(symbol: string, side: "BUY" | "SELL", amount: Record<string, string>, requestedClientOrderId?: string): Promise<OrderExecutionResult> {
    await this.syncServerTime();
    const clientOrderId = requestedClientOrderId ?? `bot_${side.toLowerCase()}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const params = { symbol, side, type: "MARKET", newOrderRespType: "FULL", newClientOrderId: clientOrderId, ...amount };
    let payload: OrderPayload;
    try {
      payload = await this.signedRequest("POST", "/api/v3/order", params) as OrderPayload;
    } catch (error) {
      if (error instanceof BinanceTestnetOrderError && error.kind !== "ERROR" && !error.noAutoRetry) throw error;
      payload = await this.findOrder(symbol, clientOrderId).catch(() => {
        throw new BinanceTestnetOrderError("UNKNOWN_RESULT", "TESTNET ორდერის პასუხი გაურკვეველია; დონე ავტომატურად აღარ განმეორდება", true);
      });
    }
    return this.toResult(symbol, side, payload);
  }

  private async findOrder(symbol: string, clientOrderId: string): Promise<OrderPayload> {
    await this.syncServerTime();
    return this.signedRequest("GET", "/api/v3/order", { symbol, origClientOrderId: clientOrderId }) as Promise<OrderPayload>;
  }

  private toResult(symbol: string, side: "BUY" | "SELL", payload: OrderPayload): OrderExecutionResult {
    const executedQty = Number(payload.executedQty);
    const grossQuote = Number(payload.cummulativeQuoteQty);
    if (!payload.orderId || !Number.isFinite(executedQty) || executedQty <= 0 || !Number.isFinite(grossQuote) || grossQuote <= 0) {
      throw new BinanceTestnetOrderError("UNKNOWN_RESULT", "TESTNET ორდერის შესრულებული მოცულობა ვერ დადასტურდა", true);
    }
    const baseAsset = symbol.endsWith("USDT") ? symbol.slice(0, -4) : "";
    const baseCommission = (payload.fills ?? []).filter((fill) => fill.commissionAsset === baseAsset)
      .reduce((sum, fill) => sum + Number(fill.commission || 0), 0);
    const quoteCommission = (payload.fills ?? []).filter((fill) => fill.commissionAsset === "USDT")
      .reduce((sum, fill) => sum + Number(fill.commission || 0), 0);
    return {
      orderId: String(payload.orderId), symbol, side,
      price: grossQuote / executedQty,
      quoteAmount: side === "SELL" ? Math.max(0, grossQuote - quoteCommission) : grossQuote,
      assetQuantity: side === "BUY" ? Math.max(0, executedQty - baseCommission) : executedQty,
    };
  }

  private async signedRequest(method: "GET" | "POST", pathname: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams({ ...params, recvWindow: "5000", timestamp: String(Math.floor(Date.now() + this.timeOffsetMs)) }).toString();
    const signature = createHmac("sha256", this.apiSecret).update(query).digest("hex");
    const response = await this.fetchImpl(`${TESTNET_BASE_URL}${pathname}?${query}&signature=${signature}`, {
      method, headers: { "X-MBX-APIKEY": this.apiKey }, signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({})) as BinanceErrorPayload;
    if (!response.ok) throw this.safeError(response.status, payload.code);
    return payload;
  }

  private async getStepSize(symbol: string): Promise<number> {
    const response = await this.fetchImpl(`${TESTNET_BASE_URL}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({})) as BinanceErrorPayload & {
      symbols?: Array<{ filters: Array<{ filterType: string; stepSize?: string }> }>;
    };
    if (!response.ok) throw this.safeError(response.status, payload.code);
    const stepSize = Number(payload.symbols?.[0]?.filters.find((filter) => filter.filterType === "LOT_SIZE")?.stepSize);
    if (!Number.isFinite(stepSize) || stepSize <= 0) throw new BinanceTestnetOrderError("FILTER_REJECTED", "სიმბოლოს TESTNET stepSize ვერ მოიძებნა");
    return stepSize;
  }

  private async syncServerTime(): Promise<void> {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${TESTNET_BASE_URL}/api/v3/time`, { signal: AbortSignal.timeout(5_000) });
    const payload = await response.json().catch(() => ({})) as BinanceErrorPayload & { serverTime?: number };
    if (!response.ok) throw this.safeError(response.status, payload.code);
    if (!Number.isFinite(payload.serverTime)) throw new BinanceTestnetOrderError("TIMESTAMP_ERROR", "Spot Testnet-მა არასწორი დრო დააბრუნა");
    this.timeOffsetMs = Math.round(payload.serverTime! - (startedAt + (Date.now() - startedAt) / 2));
  }

  private safeError(httpStatus: number, code?: number): BinanceTestnetOrderError {
    if (httpStatus === 418 || httpStatus === 429 || code === -1003) return new BinanceTestnetOrderError("RATE_LIMITED", "Spot Testnet-ის მოთხოვნების ლიმიტი ამოიწურა");
    if (code === -2014 || code === -2015) return new BinanceTestnetOrderError("INVALID_KEY", "Spot Testnet API key, IP ან უფლებები არასწორია");
    if (code === -1022) return new BinanceTestnetOrderError("INVALID_SIGNATURE", "Spot Testnet-მა მოთხოვნის ხელმოწერა უარყო");
    if (code === -1021) return new BinanceTestnetOrderError("TIMESTAMP_ERROR", "Spot Testnet-მა მოთხოვნის დრო უარყო");
    if (code === -2010) return new BinanceTestnetOrderError("INSUFFICIENT_BALANCE", "Spot Testnet ანგარიშზე საკმარისი ბალანსი არ არის");
    if (code === -2013) return new BinanceTestnetOrderError("ORDER_NOT_FOUND", "Spot Testnet-ზე ორდერი ვერ მოიძებნა");
    if (code === -1013) return new BinanceTestnetOrderError("FILTER_REJECTED", "ორდერი Spot Testnet-ის symbol rules-ს არ აკმაყოფილებს");
    return new BinanceTestnetOrderError("ERROR", `Spot Testnet მოთხოვნა ვერ შესრულდა: HTTP ${httpStatus}${code ? ` (code ${code})` : ""}`);
  }

  private floorToStep(value: number, step: number): number { return Math.floor((value + Number.EPSILON) / step) * step; }
  private decimals(value: number): number { return Math.min(12, Math.max(0, (value.toString().split(".")[1] ?? "").length)); }
  private decimal(value: number, decimals: number): string {
    return value.toFixed(decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
}
