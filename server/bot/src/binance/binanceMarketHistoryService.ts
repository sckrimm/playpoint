type Kline = [number, string, string, string, string, ...unknown[]];

export type BinanceCandleInterval = "5m" | "1h";

export interface BinanceCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HistoricalPrice {
  price: number;
  timestamp: string;
}

export class BinanceMarketHistoryService {
  async getCandles(symbol: string, interval: BinanceCandleInterval, limit: number): Promise<BinanceCandle[]> {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const params = new URLSearchParams({ symbol, interval, limit: String(safeLimit) });
    const response = await fetch(`https://api.binance.com/api/v3/klines?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Binance candle request failed with HTTP ${response.status}`);
    const payload = await response.json() as Kline[];
    const candles = payload.map((item) => ({
      time: Math.floor(item[0] / 1_000),
      open: Number(item[1]), high: Number(item[2]), low: Number(item[3]), close: Number(item[4]),
    })).filter((item) => [item.open, item.high, item.low, item.close].every((value) => Number.isFinite(value) && value > 0));
    if (!candles.length) throw new Error(`Binance returned no candles for ${symbol}`);
    return candles;
  }

  async getCandlesRange(symbol: string, interval: "1h", startTime: number, endTime: number): Promise<BinanceCandle[]> {
    const candles: BinanceCandle[] = [];
    let cursor = startTime;
    while (cursor < endTime) {
      const params = new URLSearchParams({
        symbol,
        interval,
        startTime: String(cursor),
        endTime: String(endTime),
        limit: "1000",
      });
      const response = await fetch(`https://api.binance.com/api/v3/klines?${params}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`Binance candle request failed with HTTP ${response.status}`);
      const payload = await response.json() as Kline[];
      if (!payload.length) break;
      for (const item of payload) {
        const candle = {
          time: Math.floor(item[0] / 1_000),
          open: Number(item[1]), high: Number(item[2]), low: Number(item[3]), close: Number(item[4]),
        };
        if ([candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)) candles.push(candle);
      }
      const lastOpenTime = Number(payload[payload.length - 1]?.[0]);
      if (!Number.isFinite(lastOpenTime) || payload.length < 1000) break;
      cursor = lastOpenTime + 60 * 60_000;
    }
    if (!candles.length) throw new Error(`Binance returned no candles for ${symbol}`);
    return candles;
  }

  async getPriceOneHourAgo(symbol: string): Promise<HistoricalPrice> {
    const targetTime = Date.now() - 60 * 60_000;
    const params = new URLSearchParams({
      symbol,
      interval: "1m",
      startTime: String(targetTime),
      limit: "1",
    });
    const response = await fetch(`https://api.binance.com/api/v3/klines?${params}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Binance market history request failed with HTTP ${response.status}`);
    const payload = await response.json() as Kline[];
    const candle = payload[0];
    const price = Number(candle?.[4]);
    if (!candle || !Number.isFinite(price) || price <= 0) throw new Error(`Binance returned no hourly reference price for ${symbol}`);
    return { price, timestamp: new Date(candle[0]).toISOString() };
  }
}
