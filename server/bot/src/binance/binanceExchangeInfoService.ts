import type { SymbolRules } from "./binanceService.js";

type ExchangeFilter = {
  filterType: string;
  minQty?: string;
  stepSize?: string;
  tickSize?: string;
  minNotional?: string;
};

type ExchangeInfoResponse = {
  symbols?: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed?: boolean;
    filters: ExchangeFilter[];
  }>;
};

type TickerPriceResponse = {
  symbol?: string;
  price?: string;
};

export interface SpotSymbolCatalogItem {
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
}

export class BinanceExchangeInfoService {
  async getCurrentPrice(symbol: string): Promise<number> {
    const normalizedSymbol = symbol.toUpperCase();
    const url = new URL("https://data-api.binance.vision/api/v3/ticker/price");
    url.searchParams.set("symbol", normalizedSymbol);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Binance ticker price failed with HTTP ${response.status}`);

    const payload = await response.json() as TickerPriceResponse;
    const price = Number(payload.price);
    if (payload.symbol !== normalizedSymbol || !Number.isFinite(price) || price <= 0) {
      throw new Error(`Binance returned an invalid current price for ${normalizedSymbol}`);
    }
    return price;
  }

  async getUsdtSpotSymbols(): Promise<SpotSymbolCatalogItem[]> {
    const response = await fetch("https://data-api.binance.vision/api/v3/exchangeInfo", {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Binance symbol catalog failed with HTTP ${response.status}`);
    const payload = await response.json() as ExchangeInfoResponse;
    return (payload.symbols ?? [])
      .filter((item) => item.status === "TRADING" && item.isSpotTradingAllowed === true && item.quoteAsset === "USDT")
      .map((item) => ({ symbol: item.symbol, baseAsset: item.baseAsset, quoteAsset: "USDT" as const }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async getSymbolRules(symbol: string): Promise<SymbolRules> {
    const url = new URL("https://data-api.binance.vision/api/v3/exchangeInfo");
    url.searchParams.set("symbol", symbol);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Binance exchangeInfo failed with HTTP ${response.status}`);

    const payload = await response.json() as ExchangeInfoResponse;
    const info = payload.symbols?.[0];
    if (!info || info.symbol !== symbol) throw new Error(`Binance symbol ${symbol} was not found`);

    const priceFilter = info.filters.find((filter) => filter.filterType === "PRICE_FILTER");
    const lotSize = info.filters.find((filter) => filter.filterType === "LOT_SIZE");
    const notional = info.filters.find((filter) => filter.filterType === "NOTIONAL")
      ?? info.filters.find((filter) => filter.filterType === "MIN_NOTIONAL");

    if (!priceFilter?.tickSize || !lotSize?.minQty || !lotSize.stepSize || !notional?.minNotional) {
      throw new Error(`Binance returned incomplete symbol rules for ${symbol}`);
    }
    return {
      symbol: info.symbol,
      baseAsset: info.baseAsset,
      quoteAsset: info.quoteAsset,
      minQty: lotSize.minQty,
      stepSize: lotSize.stepSize,
      tickSize: priceFilter.tickSize,
      minNotional: notional.minNotional,
      status: info.status,
      fetchedAt: new Date().toISOString(),
    };
  }
}
