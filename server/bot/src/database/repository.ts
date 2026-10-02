import type { AccountBalance, BinanceConnectionState, ExecutedLevelRecord, MarketState, OrderRecord, StrategyConfig, StrategyRecord, StrategyTemplateRecord } from "../types/strategy.js";
import type { SymbolRules } from "../binance/binanceService.js";

export interface StrategyStore {
  initialize(): Promise<void>;
  findOrCreate(config: StrategyConfig): Promise<StrategyRecord>;
  createStrategy(config: StrategyConfig): Promise<StrategyRecord>;
  listStrategies(): Promise<StrategyRecord[]>;
  listArchivedStrategies(): Promise<StrategyRecord[]>;
  updateStrategy(id: number, config: StrategyConfig): Promise<StrategyRecord>;
  setStrategyStatus(id: number, status: "ACTIVE" | "PAUSED"): Promise<StrategyRecord>;
  archiveStrategy(id: number): Promise<StrategyRecord>;
  resetSimulationStrategyById(id: number): Promise<StrategyRecord>;
  listStrategyTemplates(): Promise<StrategyTemplateRecord[]>;
  createStrategyTemplate(template: Omit<StrategyTemplateRecord, "id" | "builtIn" | "createdAt">): Promise<StrategyTemplateRecord>;
  deleteStrategyTemplate(id: number): Promise<void>;
  getById(id: number): Promise<StrategyRecord>;
  initializeBuyLevels(strategyId: number, config: StrategyConfig): Promise<void>;
  getLevels(strategyId: number): Promise<ExecutedLevelRecord[]>;
  claimLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number): Promise<boolean>;
  completeBuy(strategyId: number, levelPercent: number, price: number, quoteAmount: number, assetQuantity: number, externalOrderId: string): Promise<void>;
  completeSell(strategyId: number, levelPercent: number, price: number, quoteAmount: number, assetQuantity: number, minimumReserveQuantity: number, externalOrderId: string): Promise<void>;
  failLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number, error: unknown): Promise<void>;
  countOrders(strategyId: number): Promise<number>;
  getOrders(strategyId: number): Promise<OrderRecord[]>;
  updateMarketPrice(symbol: string, price: number, eventTime: Date): Promise<void>;
  getMarketState(symbol: string): Promise<MarketState | null>;
  saveSymbolRules(rules: SymbolRules): Promise<void>;
  getSymbolRules(symbol: string): Promise<SymbolRules | null>;
  saveAccountBalances(balances: AccountBalance[]): Promise<void>;
  getAccountBalances(assets: string[]): Promise<AccountBalance[]>;
  saveBinanceConnectionState(state: BinanceConnectionState): Promise<void>;
  getBinanceConnectionState(): Promise<BinanceConnectionState | null>;
  resetSimulationStrategy(symbol: string): Promise<number>;
  close(): Promise<void>;
}
