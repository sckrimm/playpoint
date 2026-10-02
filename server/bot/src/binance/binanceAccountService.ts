import { createHmac } from "node:crypto";
import type { AccountBalance } from "../types/strategy.js";

type BinanceError = { code?: number; msg?: string };
type AccountResponse = BinanceError & { balances?: Array<{ asset: string; free: string; locked: string }> };

export type BinanceAccountErrorKind = "INVALID_KEY" | "INVALID_SIGNATURE" | "TIMESTAMP_ERROR" | "RATE_LIMITED" | "ERROR";

export class BinanceAccountError extends Error {
  constructor(public readonly kind: BinanceAccountErrorKind, message: string) {
    super(message);
    this.name = "BinanceAccountError";
  }
}

export class BinanceAccountService {
  private timeOffsetMs = 0;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async getBalances(): Promise<AccountBalance[]> {
    await this.syncServerTime();
    const timestamp = Math.floor(Date.now() + this.timeOffsetMs);
    const query = `recvWindow=5000&timestamp=${timestamp}`;
    const signature = createHmac("sha256", this.apiSecret).update(query).digest("hex");
    const response = await fetch(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({})) as AccountResponse;
    if (!response.ok || !payload.balances) {
      throw this.safeError(response.status, payload.code);
    }
    const updatedAt = new Date().toISOString();
    return payload.balances.map((balance) => ({ ...balance, updatedAt }));
  }

  private safeError(httpStatus: number, code?: number): BinanceAccountError {
    if (httpStatus === 418 || httpStatus === 429 || code === -1003) {
      return new BinanceAccountError("RATE_LIMITED", "Binance-ის მოთხოვნების ლიმიტი ამოიწურა; ბალანსის განახლება ავტომატურად განმეორდება");
    }
    if (code === -2014 || code === -2015) {
      return new BinanceAccountError("INVALID_KEY", "Binance API გასაღები, IP შეზღუდვა ან წაკითხვის უფლება არასწორია");
    }
    if (code === -1022) {
      return new BinanceAccountError("INVALID_SIGNATURE", "Binance-მა მოთხოვნის ხელმოწერა უარყო");
    }
    if (code === -1021) {
      return new BinanceAccountError("TIMESTAMP_ERROR", "Binance-მა მოთხოვნის დროის ნიშნული უარყო");
    }
    const codeSuffix = Number.isFinite(code) ? ` (code ${code})` : "";
    return new BinanceAccountError("ERROR", `Binance ანგარიშის მოთხოვნა ვერ შესრულდა: HTTP ${httpStatus}${codeSuffix}`);
  }

  private async syncServerTime(): Promise<void> {
    const startedAt = Date.now();
    const response = await fetch("https://api.binance.com/api/v3/time", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Binance-ის სერვერის დროის მოთხოვნა ვერ შესრულდა: HTTP ${response.status}`);
    const payload = await response.json() as { serverTime?: number };
    if (!Number.isFinite(payload.serverTime)) throw new Error("Binance-მა სერვერის არასწორი დრო დააბრუნა");
    const estimatedLocalTime = startedAt + (Date.now() - startedAt) / 2;
    this.timeOffsetMs = Math.round(payload.serverTime! - estimatedLocalTime);
  }
}
