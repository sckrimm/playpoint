export type ExecutionEnvironment = "SIMULATION" | "TESTNET" | "LIVE";
export type TradingMode = ExecutionEnvironment;
export type StrategyStatus = "ACTIVE" | "PAUSED" | "COMPLETED";
export type LevelSide = "BUY" | "SELL";
export type ExecutionStatus = "WAITING" | "EXECUTING" | "EXECUTED" | "FAILED";

export interface BuyLevelConfig {
  dropPercent: number;
  budgetPercent: number;
}

export interface SellLevelConfig {
  gainPercent: number;
  allocationPercent: number;
}

export interface StrategyTemplateRecord {
  id: number | null;
  name: string;
  buyLevels: BuyLevelConfig[];
  sellLevels: SellLevelConfig[];
  finalReservePercent: number;
  builtIn: boolean;
  createdAt: string | null;
}

export interface StrategyConfig {
  executionEnvironment: ExecutionEnvironment;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  initialEntryPrice: number;
  totalBudget: number;
  initialPurchaseAmount?: number;
  finalReservePercent: number;
  buyLevels: BuyLevelConfig[];
  sellLevels: SellLevelConfig[];
}

export interface StrategyRecord {
  id: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  executionEnvironment: ExecutionEnvironment;
  initialEntryPrice: number;
  totalBudget: number;
  initialPurchaseAmount: number;
  finalReservePercent: number;
  totalInvested: number;
  totalPurchasedQuantity: number;
  totalAssetQuantity: number;
  totalSoldQuantity: number;
  totalSaleProceeds: number;
  realizedProfit: number;
  remainingCostBasis: number;
  averageEntryPrice: number;
  status: StrategyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutedLevelRecord {
  id: number;
  strategyId: number;
  side: LevelSide;
  levelPercent: number;
  triggerPrice: number;
  allocationPercent: number;
  status: ExecutionStatus;
  errorMessage: string | null;
  executedAt: string | null;
}

export interface OrderExecutionResult {
  orderId: string;
  symbol: string;
  side: LevelSide;
  price: number;
  quoteAmount: number;
  assetQuantity: number;
}

export interface OrderExecutionService {
  readonly environment: Exclude<ExecutionEnvironment, "LIVE">;
  buy(symbol: string, price: number, quoteAmount: number): Promise<OrderExecutionResult>;
  sell(symbol: string, price: number, assetQuantity: number): Promise<OrderExecutionResult>;
}

export type SimulatedOrderResult = OrderExecutionResult;

export interface OrderRecord {
  id: number;
  side: LevelSide;
  levelPercent: number;
  marketPrice: number;
  quoteAmount: number;
  assetQuantity: number;
  executionEnvironment: ExecutionEnvironment;
  createdAt: string;
}

export interface MarketState {
  symbol: string;
  price: number;
  eventTime: string;
  source: "BINANCE_WEBSOCKET";
  updatedAt: string;
}

export interface AccountBalance {
  asset: string;
  free: string;
  locked: string;
  updatedAt: string;
}

export type BinanceConnectionStatus = "NOT_CONFIGURED" | "CONNECTING" | "CONNECTED" | "INVALID_KEY" | "INVALID_SIGNATURE" | "TIMESTAMP_ERROR" | "RATE_LIMITED" | "ERROR";

export interface BinanceConnectionState {
  status: BinanceConnectionStatus;
  message: string;
  updatedAt: string;
}
