export interface SymbolRules {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  minQty: string;
  stepSize: string;
  tickSize: string;
  minNotional: string;
  status: string;
  fetchedAt: string;
}

export interface BinanceService {
  getCurrentPrice(symbol: string): Promise<number>;
  getBalance(asset: string): Promise<number>;
  getSymbolRules(symbol: string): Promise<SymbolRules>;
  placeMarketBuy(symbol: string, quoteAmount: number): Promise<never>;
  placeMarketSell(symbol: string, quantity: number): Promise<never>;
}

export class LiveBinanceServiceDisabled implements BinanceService {
  private disabled(): never {
    throw new Error("LIVE Binance access is disabled in iteration one");
  }
  getCurrentPrice(): Promise<number> { return Promise.reject(this.disabled()); }
  getBalance(): Promise<number> { return Promise.reject(this.disabled()); }
  getSymbolRules(): Promise<SymbolRules> { return Promise.reject(this.disabled()); }
  placeMarketBuy(): Promise<never> { return Promise.reject(this.disabled()); }
  placeMarketSell(): Promise<never> { return Promise.reject(this.disabled()); }
}
