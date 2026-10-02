import { BinanceExchangeInfoService } from "../binance/binanceExchangeInfoService.js";
import { BinanceMarketHistoryService } from "../binance/binanceMarketHistoryService.js";

type Ticker24h = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
  count: number;
};

export type MarketOpportunity = {
  symbol: string;
  price: number;
  change24hPercent: number;
  quoteVolume24h: number;
  rangePositionPercent: number;
  rsi14: number | null;
  volatility24hPercent: number;
  score: number;
  signal: "WATCH" | "NEUTRAL" | "HIGH_RISK";
  risk: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function calculateRsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index]! - closes[index - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const relativeStrength = (gains / period) / (losses / period);
  return 100 - 100 / (1 + relativeStrength);
}

export class MarketOpportunityService {
  private readonly catalog = new BinanceExchangeInfoService();
  private readonly history = new BinanceMarketHistoryService();
  private cache: { expiresAt: number; items: MarketOpportunity[]; generatedAt: string } | null = null;

  async scan(): Promise<{ items: MarketOpportunity[]; generatedAt: string; methodology: string }> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return { items: this.cache.items, generatedAt: this.cache.generatedAt, methodology: this.methodology() };
    }
    const [symbols, response] = await Promise.all([
      this.catalog.getUsdtSpotSymbols(),
      fetch("https://data-api.binance.vision/api/v3/ticker/24hr", { signal: AbortSignal.timeout(15_000) }),
    ]);
    if (!response.ok) throw new Error(`Binance 24h ticker failed with HTTP ${response.status}`);
    const active = new Set(symbols.map((item) => item.symbol));
    const liquid = (await response.json() as Ticker24h[])
      .filter((item) => active.has(item.symbol) && Number(item.quoteVolume) >= 5_000_000 && Number(item.count) >= 1_000)
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, 30);

    const items = await Promise.all(liquid.map(async (ticker): Promise<MarketOpportunity | null> => {
      try {
        const candles = await this.history.getCandles(ticker.symbol, "1h", 30);
        const closes = candles.map((candle) => candle.close);
        const rsi14 = calculateRsi(closes);
        const price = Number(ticker.lastPrice);
        const high = Number(ticker.highPrice);
        const low = Number(ticker.lowPrice);
        const change = Number(ticker.priceChangePercent);
        const quoteVolume = Number(ticker.quoteVolume);
        if (![price, high, low, change, quoteVolume].every(Number.isFinite) || high <= low) return null;
        const rangePosition = (price - low) / (high - low) * 100;
        const volatility = (high - low) / low * 100;
        if (volatility < 0.5) return null;
        const sma20 = closes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.min(20, closes.length);
        let score = clamp(Math.log10(quoteVolume / 1_000_000) * 8, 0, 25);
        score += rsi14 === null ? 8 : rsi14 >= 38 && rsi14 <= 58 ? 22 : rsi14 >= 30 && rsi14 < 38 ? 16 : rsi14 > 58 && rsi14 <= 68 ? 12 : 4;
        score += rangePosition >= 25 && rangePosition <= 65 ? 20 : rangePosition < 25 ? 13 : 5;
        score += price >= sma20 ? 18 : 8;
        score += change >= -6 && change <= 6 ? 15 : change < -12 || change > 15 ? 2 : 8;
        score -= volatility > 25 ? 12 : volatility > 15 ? 6 : 0;
        score = Math.round(clamp(score, 0, 100));
        const reasons = [
          `24ს ბრუნვა ${(quoteVolume / 1_000_000).toFixed(1)}M USDT`,
          `24ს ცვლილება ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
          `დიაპაზონის ${rangePosition.toFixed(0)}%-ზე`,
          rsi14 === null ? "RSI მონაცემი არასაკმარისია" : `RSI(14) ${rsi14.toFixed(1)}`,
          price >= sma20 ? "ფასი 20-საათიან საშუალოზე მაღლაა" : "ფასი 20-საათიან საშუალოზე დაბლაა",
        ];
        return {
          symbol: ticker.symbol, price, change24hPercent: change, quoteVolume24h: quoteVolume,
          rangePositionPercent: rangePosition, rsi14, volatility24hPercent: volatility, score,
          signal: score >= 70 ? "WATCH" : score >= 55 ? "NEUTRAL" : "HIGH_RISK",
          risk: volatility > 20 || Math.abs(change) > 15 ? "HIGH" : volatility > 10 ? "MEDIUM" : "LOW",
          reasons,
        };
      } catch { return null; }
    }));
    const ranked = items.filter((item): item is MarketOpportunity => item !== null)
      .sort((a, b) => b.score - a.score).slice(0, 15);
    const generatedAt = new Date().toISOString();
    this.cache = { items: ranked, generatedAt, expiresAt: Date.now() + 5 * 60_000 };
    return { items: ranked, generatedAt, methodology: this.methodology() };
  }

  private methodology(): string {
    return "ქულა აერთიანებს ლიკვიდობას, RSI(14)-ს, 24-საათიან დიაპაზონს, 20-საათიან საშუალოს, ცვლილებასა და ვოლატილობას; ეს არ არის მოგების გარანტია ან ფინანსური რჩევა.";
  }
}
