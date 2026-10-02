import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { BinanceExchangeInfoService, type SpotSymbolCatalogItem } from "../binance/binanceExchangeInfoService.js";
import { BinanceMarketHistoryService, type BinanceCandle, type HistoricalPrice } from "../binance/binanceMarketHistoryService.js";
import { appConfig } from "../config/env.js";
import { BUILT_IN_STRATEGY_TEMPLATES, DEFAULT_BUY_LEVELS, validateStrategyConfig } from "../config/strategy.js";
import { createStore } from "../database/createStore.js";
import { SimulationOrderService } from "../services/simulationOrderService.js";
import { BinanceTestnetOrderService } from "../services/binanceTestnetOrderService.js";
import { runStrategyBacktest } from "../services/strategyBacktestService.js";
import type { BuyLevelConfig, OrderRecord, SellLevelConfig, StrategyConfig, StrategyRecord } from "../types/strategy.js";

const port = Number(process.env.DASHBOARD_PORT ?? process.env.PORT ?? 4173);
const publicDir = path.resolve("public");
const basePath = normalizeBasePath(process.env.BASE_PATH ?? "");
const dashboardUsername = process.env.DASHBOARD_USERNAME?.trim() ?? "";
const dashboardPassword = process.env.DASHBOARD_PASSWORD ?? "";
if (process.env.NODE_ENV === "production" && (!dashboardUsername || !dashboardPassword)) {
  throw new Error("Production dashboard requires DASHBOARD_USERNAME and DASHBOARD_PASSWORD");
}
const exchangeInfo = new BinanceExchangeInfoService();
const marketHistory = new BinanceMarketHistoryService();
let catalogCache: { items: SpotSymbolCatalogItem[]; expiresAt: number } | null = null;
const hourlyPriceCache = new Map<string, { value: HistoricalPrice; expiresAt: number }>();

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isAuthorized(request: IncomingMessage): boolean {
  if (!dashboardUsername || !dashboardPassword) return true;
  const header = request.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return secureEqual(decoded.slice(0, separator), dashboardUsername)
      && secureEqual(decoded.slice(separator + 1), dashboardPassword);
  } catch {
    return false;
  }
}

function getTestnetService(): BinanceTestnetOrderService | null {
  return appConfig.binanceTestnetApiKey && appConfig.binanceTestnetApiSecret
    ? new BinanceTestnetOrderService(appConfig.binanceTestnetApiKey, appConfig.binanceTestnetApiSecret)
    : null;
}

function requireTestnetService(): BinanceTestnetOrderService {
  const service = getTestnetService();
  if (!service) throw new Error("TESTNET-ისთვის BINANCE_TESTNET_API_KEY და BINANCE_TESTNET_API_SECRET დაამატე .env ფაილში");
  return service;
}

async function getCatalog(): Promise<SpotSymbolCatalogItem[]> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.items;
  const items = await exchangeInfo.getUsdtSpotSymbols();
  catalogCache = { items, expiresAt: Date.now() + 15 * 60_000 };
  return items;
}

async function getHourlyReference(symbol: string): Promise<HistoricalPrice | null> {
  const cached = hourlyPriceCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const value = await marketHistory.getPriceOneHourAgo(symbol);
    hourlyPriceCache.set(symbol, { value, expiresAt: Date.now() + 60_000 });
    return value;
  } catch (error) {
    console.error(`Hourly price unavailable for ${symbol}:`, error instanceof Error ? error.message : error);
    return cached?.value ?? null;
  }
}

async function getStrategyState(id: number) {
  const repository = await createStore();
  try {
    const strategy = await repository.getById(id);
    const levels = await repository.getLevels(strategy.id);
    const orders = await repository.getOrders(strategy.id);
    const storedMarket = await repository.getMarketState(strategy.symbol);
    const testnetService = strategy.executionEnvironment === "TESTNET" ? requireTestnetService() : null;
    const testnetPrice = testnetService ? await testnetService.getCurrentPrice(strategy.symbol) : null;
    const market = testnetPrice === null ? storedMarket : {
      symbol: strategy.symbol, price: testnetPrice, eventTime: new Date().toISOString(),
      source: "BINANCE_WEBSOCKET" as const, updatedAt: new Date().toISOString(),
    };
    const symbolRules = await repository.getSymbolRules(strategy.symbol);
    const accountBalances = testnetService
      ? (await testnetService.getBalances()).filter((balance) => [strategy.baseAsset, strategy.quoteAsset].includes(balance.asset))
      : await repository.getAccountBalances([strategy.baseAsset, strategy.quoteAsset]);
    const connection = testnetService
      ? { status: "CONNECTED" as const, message: "Binance Spot Testnet დაკავშირებულია; გამოიყენება მხოლოდ სატესტო თანხა", updatedAt: new Date().toISOString() }
      : await repository.getBinanceConnectionState();
    return {
      tradingMode: appConfig.tradingMode,
      strategy,
      remainingBudget: strategy.totalBudget - strategy.totalInvested,
      progressPercent: (strategy.totalInvested / strategy.totalBudget) * 100,
      levels,
      orders,
      market,
      symbolRules,
      account: { connection, balances: accountBalances },
      generatedAt: new Date().toISOString(),
    };
  } finally {
    await repository.close();
  }
}

async function getStrategiesOverview(archived = false) {
  const repository = await createStore();
  try {
    const strategies = archived ? await repository.listArchivedStrategies() : await repository.listStrategies();
    return await Promise.all(strategies.map(async (strategy) => {
      const market = await repository.getMarketState(strategy.symbol);
      const levels = await repository.getLevels(strategy.id);
      const buyLevels = levels.filter((level) => level.side === "BUY");
      const sellLevels = levels.filter((level) => level.side === "SELL");
      const hourlyReference = market ? await getHourlyReference(strategy.symbol) : null;
      const hourlyPnl = market && hourlyReference
        ? strategy.totalAssetQuantity * (market.price - hourlyReference.price)
        : null;
      const totalPnl = market
        ? strategy.totalAssetQuantity * market.price + strategy.totalSaleProceeds - strategy.totalInvested
        : null;
      return {
        ...strategy,
        market,
        profile: {
          firstBuyDropPercent: buyLevels[0]?.levelPercent ?? null,
          buyLevelCount: buyLevels.length,
          sellLevelCount: sellLevels.length,
        },
        performance: {
          hourlyPnl,
          hourlyPercent: market && hourlyReference ? (market.price / hourlyReference.price - 1) * 100 : null,
          hourlyReferencePrice: hourlyReference?.price ?? null,
          hourlyReferenceAt: hourlyReference?.timestamp ?? null,
          totalPnl,
          totalPnlPercent: totalPnl !== null && strategy.totalInvested > 0
            ? totalPnl / strategy.totalInvested * 100
            : null,
        },
      };
    }));
  } finally {
    await repository.close();
  }
}

function calculateMaximumDrawdown(strategy: StrategyRecord, orders: OrderRecord[], candles: BinanceCandle[]): number | null {
  if (!candles.length) return null;
  const ordered = [...orders].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let cash = strategy.totalBudget;
  let assetQuantity = 0;
  let orderIndex = 0;
  let peakEquity = strategy.totalBudget;
  let maximumDrawdown = 0;
  for (const candle of candles) {
    const candleTime = candle.time * 1_000 + 60 * 60_000;
    while (orderIndex < ordered.length && Date.parse(ordered[orderIndex]!.createdAt) <= candleTime) {
      const order = ordered[orderIndex]!;
      if (order.side === "BUY") {
        cash -= order.quoteAmount;
        assetQuantity += order.assetQuantity;
      } else {
        cash += order.quoteAmount;
        assetQuantity -= order.assetQuantity;
      }
      orderIndex += 1;
    }
    const lowEquity = cash + assetQuantity * candle.low;
    const closeEquity = cash + assetQuantity * candle.close;
    if (peakEquity > 0) maximumDrawdown = Math.max(maximumDrawdown, (peakEquity - lowEquity) / peakEquity * 100);
    peakEquity = Math.max(peakEquity, closeEquity);
  }
  return Math.max(0, maximumDrawdown);
}

async function getStrategyComparison(symbol: string) {
  const repository = await createStore();
  try {
    const strategies = (await repository.listStrategies()).filter((strategy) => strategy.symbol === symbol);
    const market = await repository.getMarketState(symbol);
    let candles: BinanceCandle[] = [];
    try { candles = await marketHistory.getCandles(symbol, "1h", 1_000); } catch (error) {
      console.error(`Comparison candles unavailable for ${symbol}:`, error instanceof Error ? error.message : error);
    }
    const comparisons = await Promise.all(strategies.map(async (strategy) => {
      const [levels, orders] = await Promise.all([
        repository.getLevels(strategy.id),
        repository.getOrders(strategy.id),
      ]);
      const firstBuyDropPercent = levels.find((level) => level.side === "BUY")?.levelPercent ?? null;
      const profit = market
        ? strategy.totalAssetQuantity * market.price + strategy.totalSaleProceeds - strategy.totalInvested
        : null;
      return {
        id: strategy.id,
        symbol: strategy.symbol,
        status: strategy.status,
        executionEnvironment: strategy.executionEnvironment,
        firstBuyDropPercent,
        totalBudget: strategy.totalBudget,
        totalInvested: strategy.totalInvested,
        budgetUsedPercent: strategy.totalBudget > 0 ? strategy.totalInvested / strategy.totalBudget * 100 : 0,
        profit,
        profitPercent: profit !== null && strategy.totalInvested > 0 ? profit / strategy.totalInvested * 100 : null,
        maximumDrawdownPercent: calculateMaximumDrawdown(strategy, orders, candles),
        executedOrderCount: orders.length,
        buyOrderCount: orders.filter((order) => order.side === "BUY").length,
        sellOrderCount: orders.filter((order) => order.side === "SELL").length,
      };
    }));
    comparisons.sort((a, b) => (a.firstBuyDropPercent ?? Infinity) - (b.firstBuyDropPercent ?? Infinity));
    return { symbol, marketPrice: market?.price ?? null, comparisons, drawdownHistoryHours: candles.length };
  } finally {
    await repository.close();
  }
}

async function getStrategyBacktests(symbol: string, days: number) {
  const repository = await createStore();
  try {
    const strategies = (await repository.listStrategies()).filter((strategy) => strategy.symbol === symbol);
    const endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60_000;
    const candles = await marketHistory.getCandlesRange(symbol, "1h", startTime, endTime);
    const results = await Promise.all(strategies.map(async (strategy) => {
      const levels = await repository.getLevels(strategy.id);
      const result = runStrategyBacktest({
        totalBudget: strategy.totalBudget,
        initialPurchaseAmount: strategy.initialPurchaseAmount,
        finalReservePercent: strategy.finalReservePercent,
        buyLevels: levels.filter((level) => level.side === "BUY")
          .map((level) => ({ dropPercent: level.levelPercent, budgetPercent: level.allocationPercent })),
        sellLevels: levels.filter((level) => level.side === "SELL")
          .map((level) => ({ gainPercent: level.levelPercent, allocationPercent: level.allocationPercent })),
      }, candles);
      return {
        id: strategy.id,
        symbol: strategy.symbol,
        firstBuyDropPercent: levels.find((level) => level.side === "BUY")?.levelPercent ?? null,
        ...result,
      };
    }));
    results.sort((a, b) => b.profit - a.profit);
    return {
      symbol,
      days,
      candleCount: candles.length,
      from: new Date(candles[0]!.time * 1_000).toISOString(),
      to: new Date(candles[candles.length - 1]!.time * 1_000).toISOString(),
      results,
    };
  } finally {
    await repository.close();
  }
}

async function updateStrategy(id: number, body: unknown) {
  const input = body as Record<string, unknown>;
  const symbol = String(input.symbol ?? "").toUpperCase();
  const initialEntryPrice = Number(input.initialEntryPrice);
  const totalBudget = Number(input.totalBudget);
  const initialPurchaseAmount = Number(input.initialPurchaseAmount ?? 0);
  if (!Number.isFinite(initialEntryPrice) || initialEntryPrice <= 0) throw new Error("საწყისი შესვლის ფასი ნულზე მეტი უნდა იყოს");
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) throw new Error("სრული ბიუჯეტი ნულზე მეტი უნდა იყოს");
  const catalogItem = (await getCatalog()).find((item) => item.symbol === symbol);
  if (!catalogItem) throw new Error(`${symbol || "სიმბოლო"} აქტიური Spot USDT წყვილი არ არის`);
  const repository = await createStore();
  try {
    const current = await repository.getById(id);
    const levels = await repository.getLevels(id);
    const config: StrategyConfig = {
      executionEnvironment: current.executionEnvironment,
      symbol,
      baseAsset: catalogItem.baseAsset,
      quoteAsset: catalogItem.quoteAsset,
      initialEntryPrice,
      totalBudget,
      initialPurchaseAmount,
      buyLevels: parseBuyLevels(input.buyLevels) ?? levels.filter((level) => level.side === "BUY")
        .map((level) => ({ dropPercent: level.levelPercent, budgetPercent: level.allocationPercent })),
      sellLevels: parseSellLevels(input.sellLevels) ?? levels.filter((level) => level.side === "SELL")
        .map((level) => ({ gainPercent: level.levelPercent, allocationPercent: level.allocationPercent })),
      finalReservePercent: input.finalReservePercent === undefined
        ? current.finalReservePercent : Number(input.finalReservePercent),
    };
    validateStrategyConfig(config);
    const strategy = await repository.updateStrategy(id, config);
    await repository.saveSymbolRules(await exchangeInfo.getSymbolRules(symbol));
    return strategy;
  } finally {
    await repository.close();
  }
}

async function createStrategy(body: unknown) {
  const input = body as Record<string, unknown>;
  const symbol = String(input.symbol ?? "").toUpperCase();
  const totalBudget = Number(input.totalBudget);
  const initialPurchaseAmount = Number(input.initialPurchaseAmount ?? 0);
  const executionEnvironment = String(input.executionEnvironment ?? "SIMULATION").toUpperCase();
  if (executionEnvironment === "LIVE") throw new Error("LIVE რეჟიმი უსაფრთხოების მიზნით დაბლოკილია");
  if (executionEnvironment !== "SIMULATION" && executionEnvironment !== "TESTNET") throw new Error("გარემო უნდა იყოს SIMULATION ან TESTNET");
  const testnetService = executionEnvironment === "TESTNET" ? requireTestnetService() : null;
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) throw new Error("სრული ბიუჯეტი ნულზე მეტი უნდა იყოს");
  const catalogItem = (await getCatalog()).find((item) => item.symbol === symbol);
  if (!catalogItem) throw new Error(`${symbol || "სიმბოლო"} აქტიური Spot USDT წყვილი არ არის`);
  const hasInitialEntryPrice = input.initialEntryPrice !== undefined && input.initialEntryPrice !== null && input.initialEntryPrice !== "";
  const initialEntryPrice = hasInitialEntryPrice
    ? Number(input.initialEntryPrice)
    : testnetService ? await testnetService.getCurrentPrice(symbol) : await exchangeInfo.getCurrentPrice(symbol);
  if (!Number.isFinite(initialEntryPrice) || initialEntryPrice <= 0) throw new Error("საწყისი შესვლის ფასი ნულზე მეტი უნდა იყოს");
  const rules = await exchangeInfo.getSymbolRules(symbol);
  const buyLevels = parseBuyLevels(input.buyLevels) ?? DEFAULT_BUY_LEVELS;
  const sellLevels = parseSellLevels(input.sellLevels) ?? appConfig.strategy.sellLevels;
  const finalReservePercent = input.finalReservePercent === undefined
    ? appConfig.strategy.finalReservePercent : Number(input.finalReservePercent);
  const config: StrategyConfig = {
    executionEnvironment,
    symbol,
    baseAsset: catalogItem.baseAsset,
    quoteAsset: catalogItem.quoteAsset,
    initialEntryPrice,
    totalBudget,
    initialPurchaseAmount,
    buyLevels,
    sellLevels,
    finalReservePercent,
  };
  validateStrategyConfig(config);
  const repository = await createStore();
  try {
    let strategy = await repository.createStrategy(config);
    await repository.saveSymbolRules(rules);
    if (initialPurchaseAmount > 0) {
      const currentPrice = testnetService
        ? await testnetService.getCurrentPrice(symbol) : await exchangeInfo.getCurrentPrice(symbol);
      const order = await (testnetService ?? new SimulationOrderService()).buy(symbol, currentPrice, initialPurchaseAmount);
      await repository.completeBuy(strategy.id, 0, order.price, order.quoteAmount, order.assetQuantity, order.orderId);
      strategy = await repository.getById(strategy.id);
    }
    return strategy;
  } finally {
    await repository.close();
  }
}

function parseBuyLevels(value: unknown): BuyLevelConfig[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) throw new Error("BUY დონეები არასწორია");
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return { dropPercent: Number(row.dropPercent), budgetPercent: Number(row.budgetPercent) };
  });
}

function parseSellLevels(value: unknown): SellLevelConfig[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) throw new Error("SELL დონეები არასწორია");
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return { gainPercent: Number(row.gainPercent), allocationPercent: Number(row.allocationPercent) };
  });
}

async function getStrategyTemplates() {
  const repository = await createStore();
  try {
    return [...BUILT_IN_STRATEGY_TEMPLATES, ...await repository.listStrategyTemplates()];
  } finally {
    await repository.close();
  }
}

async function createStrategyTemplate(body: unknown) {
  const input = body as Record<string, unknown>;
  const name = String(input.name ?? "").trim();
  if (name.length < 2 || name.length > 60) throw new Error("შაბლონის სახელი 2-60 სიმბოლო უნდა იყოს");
  const buyLevels = parseBuyLevels(input.buyLevels);
  const sellLevels = parseSellLevels(input.sellLevels);
  const finalReservePercent = Number(input.finalReservePercent);
  if (!buyLevels || !sellLevels) throw new Error("BUY და SELL დონეები აუცილებელია");
  validateStrategyConfig({
    executionEnvironment: "SIMULATION", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
    initialEntryPrice: 1, totalBudget: 1, buyLevels, sellLevels, finalReservePercent,
  });
  const repository = await createStore();
  try {
    return await repository.createStrategyTemplate({ name, buyLevels, sellLevels, finalReservePercent });
  } finally {
    await repository.close();
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw new Error("მოთხოვნის მონაცემები მეტისმეტად დიდია");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (request.method === "GET" && pathname === "/api/strategy-templates") {
    json(response, 200, { templates: await getStrategyTemplates() });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/strategy-templates") {
    json(response, 201, { template: await createStrategyTemplate(await readJson(request)) });
    return true;
  }
  const templateDeleteMatch = pathname.match(/^\/api\/strategy-templates\/(\d+)$/);
  if (request.method === "DELETE" && templateDeleteMatch) {
    const repository = await createStore();
    try {
      await repository.deleteStrategyTemplate(Number(templateDeleteMatch[1]));
      json(response, 200, { deleted: true });
    } finally {
      await repository.close();
    }
    return true;
  }
  if (request.method === "GET" && pathname === "/api/symbols") {
    json(response, 200, { symbols: await getCatalog() });
    return true;
  }
  const symbolPriceMatch = pathname.match(/^\/api\/symbols\/([A-Z0-9]+)\/price$/i);
  if (request.method === "GET" && symbolPriceMatch) {
    const symbol = symbolPriceMatch[1]!.toUpperCase();
    const catalogItem = (await getCatalog()).find((item) => item.symbol === symbol);
    if (!catalogItem) throw new Error(`${symbol} აქტიური Spot USDT წყვილი არ არის`);
    const requestUrl = new URL(request.url ?? pathname, "http://localhost");
    const environment = requestUrl.searchParams.get("environment")?.toUpperCase();
    if (environment === "LIVE") throw new Error("LIVE რეჟიმი უსაფრთხოების მიზნით დაბლოკილია");
    const price = environment === "TESTNET"
      ? await requireTestnetService().getCurrentPrice(symbol) : await exchangeInfo.getCurrentPrice(symbol);
    json(response, 200, { symbol, price, source: environment === "TESTNET" ? "BINANCE_TESTNET" : "BINANCE" });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/strategies") {
    json(response, 200, { strategies: await getStrategiesOverview() });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/strategies/archived") {
    json(response, 200, { strategies: await getStrategiesOverview(true) });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/strategies/comparison") {
    const requestUrl = new URL(request.url ?? pathname, "http://localhost");
    const symbol = String(requestUrl.searchParams.get("symbol") ?? "").toUpperCase();
    if (!/^[A-Z0-9]+USDT$/.test(symbol)) throw new Error("შედარებისთვის სწორი USDT სიმბოლო აირჩიე");
    json(response, 200, await getStrategyComparison(symbol));
    return true;
  }
  if (request.method === "GET" && pathname === "/api/strategies/backtest") {
    const requestUrl = new URL(request.url ?? pathname, "http://localhost");
    const symbol = String(requestUrl.searchParams.get("symbol") ?? "").toUpperCase();
    const days = Number(requestUrl.searchParams.get("days") ?? 30);
    if (!/^[A-Z0-9]+USDT$/.test(symbol)) throw new Error("Backtest-ისთვის სწორი USDT სიმბოლო აირჩიე");
    if (![30, 90, 365].includes(days)) throw new Error("Backtest-ის პერიოდი უნდა იყოს 30, 90 ან 365 დღე");
    json(response, 200, await getStrategyBacktests(symbol, days));
    return true;
  }
  if (request.method === "POST" && pathname === "/api/strategies") {
    json(response, 201, { strategy: await createStrategy(await readJson(request)) });
    return true;
  }
  const chartMatch = pathname.match(/^\/api\/strategies\/(\d+)\/chart$/);
  if (request.method === "GET" && chartMatch) {
    const strategyId = Number(chartMatch[1]);
    const requestUrl = new URL(request.url ?? pathname, "http://localhost");
    const range = requestUrl.searchParams.get("range") ?? "7d";
    const chartOptions = range === "24h"
      ? { interval: "5m" as const, limit: 288 }
      : range === "30d" ? { interval: "1h" as const, limit: 720 } : { interval: "1h" as const, limit: 168 };
    const repository = await createStore();
    try {
      const strategy = await repository.getById(strategyId);
      json(response, 200, {
        symbol: strategy.symbol,
        range: ["24h", "7d", "30d"].includes(range) ? range : "7d",
        interval: chartOptions.interval,
        candles: await marketHistory.getCandles(strategy.symbol, chartOptions.interval, chartOptions.limit),
      });
    } finally {
      await repository.close();
    }
    return true;
  }
  const detailMatch = pathname.match(/^\/api\/strategies\/(\d+)$/);
  if (request.method === "GET" && detailMatch) {
    json(response, 200, await getStrategyState(Number(detailMatch[1])));
    return true;
  }
  if (request.method === "PATCH" && detailMatch) {
    json(response, 200, { strategy: await updateStrategy(Number(detailMatch[1]), await readJson(request)) });
    return true;
  }
  const statusMatch = pathname.match(/^\/api\/strategies\/(\d+)\/status$/);
  if (request.method === "PATCH" && statusMatch) {
    const body = await readJson(request) as { status?: string };
    if (body.status !== "ACTIVE" && body.status !== "PAUSED") throw new Error("სტატუსი უნდა იყოს ACTIVE ან PAUSED");
    const repository = await createStore();
    try {
      json(response, 200, { strategy: await repository.setStrategyStatus(Number(statusMatch[1]), body.status) });
    } finally {
      await repository.close();
    }
    return true;
  }
  const resetMatch = pathname.match(/^\/api\/strategies\/(\d+)\/reset$/);
  if (request.method === "POST" && resetMatch) {
    const repository = await createStore();
    try {
      let strategy = await repository.resetSimulationStrategyById(Number(resetMatch[1]));
      if (strategy.initialPurchaseAmount > 0) {
        const currentPrice = await exchangeInfo.getCurrentPrice(strategy.symbol);
        const order = await new SimulationOrderService().buy(strategy.symbol, currentPrice, strategy.initialPurchaseAmount);
        await repository.completeBuy(strategy.id, 0, currentPrice, strategy.initialPurchaseAmount, order.assetQuantity, order.orderId);
        strategy = await repository.getById(strategy.id);
      }
      json(response, 201, { strategy });
    } finally {
      await repository.close();
    }
    return true;
  }
  const archiveMatch = pathname.match(/^\/api\/strategies\/(\d+)\/archive$/);
  if (request.method === "POST" && archiveMatch) {
    const repository = await createStore();
    try {
      json(response, 200, { strategy: await repository.archiveStrategy(Number(archiveMatch[1])) });
    } finally {
      await repository.close();
    }
    return true;
  }
  if (request.method === "GET" && pathname === "/api/state") {
    const strategies = await getStrategiesOverview();
    if (!strategies[0]) throw new Error("სტრატეგია ჯერ არ არსებობს");
    json(response, 200, await getStrategyState(strategies[0].id));
    return true;
  }
  return false;
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  const rawPathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const healthPath = `${basePath}/health` || "/health";
  if (rawPathname === healthPath || (!basePath && rawPathname === "/health")) {
    return json(response, 200, { status: "ok", service: "binance-strategy-dashboard" });
  }
  if (basePath && rawPathname === basePath) {
    response.writeHead(308, { Location: `${basePath}/` });
    return response.end();
  }
  if (basePath && !rawPathname.startsWith(`${basePath}/`)) return response.writeHead(404).end("ვერ მოიძებნა");
  if (!isAuthorized(request)) {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Spot Strategy Dashboard"', "Content-Type": "text/plain; charset=utf-8" });
    return response.end("ავტორიზაცია საჭიროა");
  }
  const pathname = basePath ? rawPathname.slice(basePath.length) || "/" : rawPathname;
  try {
    if (pathname.startsWith("/api/") && await handleApi(request, response, pathname)) return;
    if (pathname.startsWith("/api/")) return json(response, 404, { error: "API მისამართი ვერ მოიძებნა" });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : "უცნობი შეცდომა" });
  }

  if (pathname === "/vendor/lightweight-charts.js") {
    const vendorPath = path.resolve("node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js");
    return fs.readFile(vendorPath, (error, data) => {
      if (error) return response.writeHead(404).end("ვერ მოიძებნა");
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" });
      response.end(data);
    });
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(publicDir, `.${requestedPath}`);
  if (!filePath.startsWith(`${publicDir}${path.sep}`)) return response.writeHead(403).end("წვდომა აკრძალულია");
  fs.readFile(filePath, (error, data) => {
    if (error) return response.writeHead(404).end("ვერ მოიძებნა");
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream" });
    response.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Dashboard: http://127.0.0.1:${port}${basePath || "/"}`);
  console.log(`Mode: ${appConfig.tradingMode} | Database: ${appConfig.databaseUrl ? "PostgreSQL" : appConfig.databasePath}`);
});
