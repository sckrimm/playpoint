import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { BinanceExchangeInfoService, type SpotSymbolCatalogItem } from "../binance/binanceExchangeInfoService.js";
import { BinanceMarketHistoryService, type BinanceCandle, type HistoricalPrice } from "../binance/binanceMarketHistoryService.js";
import { appConfig } from "../config/env.js";
import { BUILT_IN_STRATEGY_TEMPLATES, DEFAULT_BUY_LEVELS, validateStrategyConfig } from "../config/strategy.js";
import { createStore } from "../database/createStore.js";
import { SimulationOrderService } from "../services/simulationOrderService.js";
import { BinanceTestnetOrderService } from "../services/binanceTestnetOrderService.js";
import { runStrategyBacktest } from "../services/strategyBacktestService.js";
import { MarketOpportunityService } from "../services/marketOpportunityService.js";
import { CryptoNewsService } from "../services/cryptoNewsService.js";
import type { BuyLevelConfig, OrderRecord, SellLevelConfig, StrategyConfig, StrategyRecord } from "../types/strategy.js";
import { UserAuthStore, type DashboardUser } from "../auth/userAuthStore.js";
import { telegramAlerts } from "../services/telegramAlertService.js";

const port = Number(process.env.DASHBOARD_PORT ?? process.env.PORT ?? 4173);
const publicDir = path.resolve("public");
const lightweightChartsEntry = fileURLToPath(import.meta.resolve("lightweight-charts"));
const lightweightChartsVendorPath = path.join(path.dirname(lightweightChartsEntry), "lightweight-charts.standalone.production.js");
const basePath = normalizeBasePath(process.env.BASE_PATH ?? "");
const dashboardUsername = process.env.DASHBOARD_USERNAME?.trim() ?? "";
const dashboardPassword = process.env.DASHBOARD_PASSWORD ?? "";
const dashboardSessionToken = createHash("sha256")
  .update(`${dashboardUsername}\0${dashboardPassword}`)
  .digest("hex");
const userAuthStore = appConfig.databaseUrl ? new UserAuthStore(appConfig.databaseUrl) : null;
if (process.env.NODE_ENV === "production" && (!dashboardUsername || !dashboardPassword)) {
  throw new Error("Production dashboard requires DASHBOARD_USERNAME and DASHBOARD_PASSWORD");
}
if (userAuthStore) {
  const migrationStore = await createStore();
  await migrationStore.close();
  await userAuthStore.initialize(dashboardUsername, dashboardPassword);
}
const exchangeInfo = new BinanceExchangeInfoService();
const marketHistory = new BinanceMarketHistoryService();
const marketOpportunities = new MarketOpportunityService();
const cryptoNews = new CryptoNewsService();
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

function getCookie(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie?.split(";").map((cookie) => cookie.trim().split("="))
    .find(([cookieName]) => cookieName === name)?.[1];
}

function isLegacyAuthorized(request: IncomingMessage): boolean {
  if (!dashboardUsername || !dashboardPassword) return true;
  const cookieToken = getCookie(request, "dashboard_session");
  if (cookieToken && secureEqual(cookieToken, dashboardSessionToken)) return true;
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

function loginPage(errorMessage = ""): string {
  const action = `${basePath}/login` || "/login";
  return `<!doctype html>
<html lang="ka">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>შესვლა | Spot Strategy</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #181a21; color: #f4f6f8; padding: 24px; }
    main { width: min(100%, 420px); border: 1px solid #343944; background: #20232b; padding: 32px; border-radius: 8px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 24px; color: #aeb5bf; }
    label { display: block; margin: 16px 0 8px; font-weight: 700; }
    input { width: 100%; border: 1px solid #444b58; border-radius: 6px; padding: 13px 14px; background: #181a21; color: #fff; font: inherit; }
    input:focus { outline: 2px solid #e5b600; outline-offset: 1px; }
    button { width: 100%; margin-top: 24px; border: 0; border-radius: 6px; padding: 13px; background: #f0b90b; color: #16181d; font: inherit; font-weight: 800; cursor: pointer; }
    .error { color: #ff7378; margin: 0 0 12px; }
    a { display: block; margin-top: 18px; color: #f0b90b; text-align: center; }
  </style>
</head>
<body>
  <main>
    <h1>ავტორიზაცია</h1>
    <p>შედი სტრატეგიების სამართავ პანელში</p>
    ${errorMessage ? `<div class="error" role="alert">${errorMessage}</div>` : ""}
    <form method="post" action="${action}">
      <label for="username">მომხმარებელი</label>
      <input id="username" name="username" autocomplete="username" required autofocus>
      <label for="password">პაროლი</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">შესვლა</button>
    </form>
    ${userAuthStore ? `<a href="${basePath}/register">მოწვევის კოდით რეგისტრაცია</a>` : ""}
  </main>
</body>
</html>`;
}

function registerPage(errorMessage = ""): string {
  const action = `${basePath}/register` || "/register";
  return loginPage(errorMessage)
    .replace("შესვლა | Spot Strategy", "რეგისტრაცია | Spot Strategy")
    .replace("<h1>ავტორიზაცია</h1>", "<h1>რეგისტრაცია</h1>")
    .replace("შედი სტრატეგიების სამართავ პანელში", "შექმენი ანგარიში ერთჯერადი მოწვევის კოდით")
    .replace(`<form method="post" action="${basePath}/login">`, `<form method="post" action="${action}">\n      <label for="inviteCode">მოწვევის კოდი</label>\n      <input id="inviteCode" name="inviteCode" required autofocus>`)
    .replace(" required autofocus>", " required>")
    .replace("<button type=\"submit\">შესვლა</button>", "<button type=\"submit\">ანგარიშის შექმნა</button>")
    .replace(/<a href="[^"]+\/register">[\s\S]*?<\/a>/, `<a href="${basePath}/login">უკან შესვლაზე</a>`);
}

async function readFormBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("მოთხოვნა ზედმეტად დიდია");
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
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
  return getHistoricalReference(symbol, 1);
}

async function getHistoricalReference(symbol: string, hours: number): Promise<HistoricalPrice | null> {
  const cacheKey = `${symbol}:${hours}`;
  const cached = hourlyPriceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const value = await marketHistory.getPriceHoursAgo(symbol, hours);
    hourlyPriceCache.set(cacheKey, { value, expiresAt: Date.now() + 60_000 });
    return value;
  } catch (error) {
    console.error(`Hourly price unavailable for ${symbol}:`, error instanceof Error ? error.message : error);
    return cached?.value ?? null;
  }
}

async function ensureStrategyAccess(id: number, user: DashboardUser | null): Promise<void> {
  if (userAuthStore && user) await userAuthStore.assertStrategyAccess(id, user);
}

async function visibleStrategies(strategies: StrategyRecord[], user: DashboardUser | null): Promise<StrategyRecord[]> {
  if (!userAuthStore || !user) return strategies;
  const visibleIds = await userAuthStore.filterStrategyIds(strategies.map((strategy) => strategy.id), user);
  return strategies.filter((strategy) => visibleIds.has(strategy.id));
}

type ReadinessStatus = "OK" | "WAITING" | "WARNING" | "ERROR";

async function getReadinessReport(user: DashboardUser | null) {
  const repository = await createStore();
  try {
    const allStrategies = await visibleStrategies(await repository.listStrategies(), user);
    const testnetStrategies = allStrategies.filter((strategy) => strategy.executionEnvironment === "TESTNET");
    const activeTestnet = testnetStrategies.filter((strategy) => strategy.status === "ACTIVE");
    const checks: Array<{ id: string; label: string; status: ReadinessStatus; detail: string }> = [];
    const testnetService = getTestnetService();

    if (!testnetService) {
      checks.push({ id: "connection", label: "Binance Spot Testnet კავშირი", status: "ERROR", detail: "Testnet API key და secret კონფიგურირებული არ არის" });
    } else {
      try {
        await testnetService.getBalances();
        checks.push({ id: "connection", label: "Binance Spot Testnet კავშირი", status: "OK", detail: "API ავტორიზაცია და USER_DATA წვდომა მუშაობს" });
      } catch (error) {
        checks.push({ id: "connection", label: "Binance Spot Testnet კავშირი", status: "ERROR", detail: error instanceof Error ? error.message : "Testnet კავშირი ვერ დადასტურდა" });
      }
    }

    checks.push(activeTestnet.length
      ? { id: "active-strategy", label: "აქტიური Testnet სტრატეგია", status: "OK", detail: `${activeTestnet.length} აქტიური სტრატეგია მუშაობს` }
      : { id: "active-strategy", label: "აქტიური Testnet სტრატეგია", status: "ERROR", detail: "აქტიური Testnet სტრატეგია არ არის" });

    const liveStrategies = allStrategies.filter((strategy) => strategy.executionEnvironment === "LIVE" && strategy.status === "ACTIVE");
    checks.push(liveStrategies.length === 0
      ? { id: "live-lock", label: "LIVE უსაფრთხოების ჩამკეტი", status: "OK", detail: "რეალურ თანხაზე აქტიური სტრატეგია არ მუშაობს" }
      : { id: "live-lock", label: "LIVE უსაფრთხოების ჩამკეტი", status: "ERROR", detail: `${liveStrategies.length} LIVE სტრატეგია აქტიურია` });

    const strategyReports = await Promise.all(testnetStrategies.map(async (strategy) => {
      const [levels, orders, market] = await Promise.all([
        repository.getLevels(strategy.id), repository.getOrders(strategy.id), repository.getMarketState(strategy.symbol),
      ]);
      const buyCount = orders.filter((order) => order.side === "BUY").length;
      const sellCount = orders.filter((order) => order.side === "SELL").length;
      const completedCycles = Math.min(buyCount, sellCount);
      const failedLevelCount = levels.filter((level) => level.status === "FAILED").length;
      const pendingExecutionCount = levels.filter((level) => level.status === "EXECUTING").length;
      const invalidOrderCount = orders.filter((order) => order.executionEnvironment !== "TESTNET" || order.marketPrice <= 0 || order.quoteAmount <= 0 || order.assetQuantity <= 0).length;
      const observationHours = Math.max(0, (Date.now() - Date.parse(strategy.createdAt)) / 3_600_000);
      const marketAgeMinutes = market ? Math.max(0, (Date.now() - Date.parse(market.updatedAt)) / 60_000) : null;
      const budgetUsedPercent = strategy.totalBudget > 0 ? strategy.totalInvested / strategy.totalBudget * 100 : 0;
      return { id: strategy.id, symbol: strategy.symbol, status: strategy.status, observationHours, orderCount: orders.length,
        buyCount, sellCount, completedCycles, failedLevelCount, pendingExecutionCount, invalidOrderCount, marketAgeMinutes, budgetUsedPercent };
    }));

    const oldestObservation = strategyReports.reduce((maximum, strategy) => Math.max(maximum, strategy.observationHours), 0);
    checks.push(oldestObservation >= 24
      ? { id: "observation", label: "მინიმუმ 24 საათის დაკვირვება", status: "OK", detail: `${oldestObservation.toFixed(1)} საათი დაგროვდა` }
      : { id: "observation", label: "მინიმუმ 24 საათის დაკვირვება", status: "WAITING", detail: `${oldestObservation.toFixed(1)} / 24 საათი` });

    const totalCycles = strategyReports.reduce((sum, strategy) => sum + strategy.completedCycles, 0);
    checks.push(totalCycles >= 3
      ? { id: "cycles", label: "3 სრული BUY → SELL ციკლი", status: "OK", detail: `${totalCycles} სრული ციკლი დადასტურდა` }
      : { id: "cycles", label: "3 სრული BUY → SELL ციკლი", status: "WAITING", detail: `${totalCycles} / 3 სრული ციკლი` });

    const failedCount = strategyReports.reduce((sum, strategy) => sum + strategy.failedLevelCount, 0);
    checks.push(failedCount === 0
      ? { id: "failures", label: "წარუმატებელი დონეები", status: "OK", detail: "FAILED დონე არ დაფიქსირებულა" }
      : { id: "failures", label: "წარუმატებელი დონეები", status: "ERROR", detail: `${failedCount} დონე შეცდომით დასრულდა` });

    const pendingExecutionCount = strategyReports.reduce((sum, strategy) => sum + strategy.pendingExecutionCount, 0);
    checks.push(pendingExecutionCount === 0
      ? { id: "reconciliation", label: "ორდერების reconciliation", status: "OK", detail: "გაურკვეველი ან გაჭედილი ორდერი არ არის" }
      : { id: "reconciliation", label: "ორდერების reconciliation", status: "WARNING", detail: `${pendingExecutionCount} ორდერი Binance-ის დადასტურებას ელოდება` });

    const invalidOrderCount = strategyReports.reduce((sum, strategy) => sum + strategy.invalidOrderCount, 0);
    checks.push(invalidOrderCount === 0
      ? { id: "orders", label: "Testnet ორდერების სისწორე", status: "OK", detail: "გარემო, ფასი, თანხა და რაოდენობა სწორია" }
      : { id: "orders", label: "Testnet ორდერების სისწორე", status: "ERROR", detail: `${invalidOrderCount} საეჭვო ორდერი მოიძებნა` });

    const overBudget = strategyReports.filter((strategy) => strategy.budgetUsedPercent > 100.01);
    checks.push(overBudget.length === 0
      ? { id: "budget", label: "ბიუჯეტის ლიმიტი", status: "OK", detail: "არცერთ სტრატეგიას ბიუჯეტი არ გადაუჭარბებია" }
      : { id: "budget", label: "ბიუჯეტის ლიმიტი", status: "ERROR", detail: `${overBudget.length} სტრატეგიამ ბიუჯეტს გადააჭარბა` });

    const staleMarkets = strategyReports.filter((strategy) => strategy.status === "ACTIVE" && (strategy.marketAgeMinutes === null || strategy.marketAgeMinutes > 10));
    checks.push(staleMarkets.length === 0 && activeTestnet.length > 0
      ? { id: "market", label: "ბაზრის მონაცემების განახლება", status: "OK", detail: "აქტიური სტრატეგიების ფასი ბოლო 10 წუთში განახლდა" }
      : { id: "market", label: "ბაზრის მონაცემების განახლება", status: activeTestnet.length ? "WARNING" : "WAITING", detail: activeTestnet.length ? `${staleMarkets.length} სტრატეგიის ფასი დაგვიანებულია` : "აქტიურ სტრატეგიას ელოდება" });

    const blocking = checks.some((check) => check.status === "ERROR");
    const pending = checks.some((check) => check.status === "WAITING" || check.status === "WARNING");
    return { overall: blocking ? "BLOCKED" : pending ? "OBSERVING" : "READY", checks, strategies: strategyReports, generatedAt: new Date().toISOString() };
  } finally {
    await repository.close();
  }
}

async function getStrategyState(id: number, user: DashboardUser | null = null) {
  await ensureStrategyAccess(id, user);
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
    const totalPnl = market
      ? strategy.totalAssetQuantity * market.price + strategy.totalSaleProceeds - strategy.totalInvested
      : null;
    const availableProfit = totalPnl === null ? null : Math.max(0, totalPnl - strategy.withdrawnProfit);
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
      profitWithdrawal: { totalPnl, availableProfit, withdrawnProfit: strategy.withdrawnProfit },
      generatedAt: new Date().toISOString(),
    };
  } finally {
    await repository.close();
  }
}

async function withdrawStrategyProfit(id: number, body: unknown, user: DashboardUser | null) {
  await ensureStrategyAccess(id, user);
  const repository = await createStore();
  try {
    const strategy = await repository.getById(id);
    if (strategy.executionEnvironment === "LIVE") throw new Error("LIVE რეჟიმი დაბლოკილია");
    if (strategy.totalAssetQuantity <= 0) throw new Error("გასაყიდი აქტივი არ არის");
    const testnetService = strategy.executionEnvironment === "TESTNET" ? requireTestnetService() : null;
    const storedMarket = await repository.getMarketState(strategy.symbol);
    const price = testnetService
      ? await testnetService.getCurrentPrice(strategy.symbol)
      : storedMarket?.price ?? await exchangeInfo.getCurrentPrice(strategy.symbol);
    const totalPnl = strategy.totalAssetQuantity * price + strategy.totalSaleProceeds - strategy.totalInvested;
    const availableProfit = Math.max(0, totalPnl - strategy.withdrawnProfit);
    const requested = Number((body as { amount?: unknown }).amount ?? availableProfit);
    if (!Number.isFinite(requested) || requested <= 0) throw new Error("ასაღები თანხა ნულზე მეტი უნდა იყოს");
    if (requested > availableProfit + 0.00000001) {
      throw new Error(`ხელმისაწვდომი მოგება არის ${availableProfit.toFixed(2)} USDT`);
    }
    const minimumReserveQuantity = strategy.totalPurchasedQuantity * strategy.finalReservePercent / 100;
    const sellableQuantity = Math.max(0, strategy.totalAssetQuantity - minimumReserveQuantity);
    const assetQuantity = requested / price;
    if (assetQuantity > sellableQuantity + 1e-12) throw new Error("მოგების აღება მუდმივ რეზერვს შეამცირებს");
    const order = await (testnetService ?? new SimulationOrderService()).sell(strategy.symbol, price, assetQuantity);
    await repository.withdrawProfit(strategy.id, order.price, order.quoteAmount, order.assetQuantity,
      minimumReserveQuantity, order.orderId);
    void telegramAlerts.send(`მოგების აღება [${strategy.executionEnvironment}]\n${strategy.symbol} · სტრატეგია #${strategy.id}\nმიღებული: ${order.quoteAmount.toFixed(2)} ${strategy.quoteAsset}\nგაყიდული: ${order.assetQuantity} ${strategy.baseAsset}`);
    return await repository.getById(strategy.id);
  } finally {
    await repository.close();
  }
}

async function getStrategiesOverview(archived = false, user: DashboardUser | null = null) {
  const repository = await createStore();
  try {
    const allStrategies = archived ? await repository.listArchivedStrategies() : await repository.listStrategies();
    const strategies = await visibleStrategies(allStrategies, user);
    return await Promise.all(strategies.map(async (strategy) => {
      const market = await repository.getMarketState(strategy.symbol);
      const levels = await repository.getLevels(strategy.id);
      const buyLevels = levels.filter((level) => level.side === "BUY");
      const sellLevels = levels.filter((level) => level.side === "SELL");
      const hourlyReference = market ? await getHourlyReference(strategy.symbol) : null;
      const dailyReference = market ? await getHistoricalReference(strategy.symbol, 24) : null;
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
          dailyPnl: market && dailyReference ? strategy.totalAssetQuantity * (market.price - dailyReference.price) : null,
          dailyPercent: market && dailyReference ? (market.price / dailyReference.price - 1) * 100 : null,
          dailyReferencePrice: dailyReference?.price ?? null,
          dailyReferenceAt: dailyReference?.timestamp ?? null,
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

async function getStrategyComparison(symbol: string, user: DashboardUser | null) {
  const repository = await createStore();
  try {
    const strategies = (await visibleStrategies(await repository.listStrategies(), user)).filter((strategy) => strategy.symbol === symbol);
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

async function getStrategyBacktests(symbol: string, days: number, user: DashboardUser | null) {
  const repository = await createStore();
  try {
    const strategies = (await visibleStrategies(await repository.listStrategies(), user)).filter((strategy) => strategy.symbol === symbol);
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

async function updateStrategy(id: number, body: unknown, user: DashboardUser | null) {
  await ensureStrategyAccess(id, user);
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

async function createStrategy(body: unknown, user: DashboardUser | null) {
  const input = body as Record<string, unknown>;
  const symbol = String(input.symbol ?? "").toUpperCase();
  const totalBudget = Number(input.totalBudget);
  const initialPurchaseAmount = Number(input.initialPurchaseAmount ?? 0);
  const executionEnvironment = String(input.executionEnvironment ?? "SIMULATION").toUpperCase();
  if (executionEnvironment === "LIVE") throw new Error("LIVE რეჟიმი უსაფრთხოების მიზნით დაბლოკილია");
  if (executionEnvironment !== "SIMULATION" && executionEnvironment !== "TESTNET") throw new Error("გარემო უნდა იყოს SIMULATION ან TESTNET");
  if (userAuthStore && user?.role !== "ADMIN" && executionEnvironment === "TESTNET") {
    throw new Error("TESTNET ჩაირთვება პირადი API გასაღებების დამატების შემდეგ; ამ ეტაპზე გამოიყენე SIMULATION");
  }
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
    if (userAuthStore && user) await userAuthStore.assignStrategy(strategy.id, user.id);
    await repository.saveSymbolRules(rules);
    if (initialPurchaseAmount > 0) {
      const currentPrice = testnetService
        ? await testnetService.getCurrentPrice(symbol) : await exchangeInfo.getCurrentPrice(symbol);
      const order = await (testnetService ?? new SimulationOrderService()).buy(symbol, currentPrice, initialPurchaseAmount);
      await repository.completeBuy(strategy.id, 0, order.price, order.quoteAmount, order.assetQuantity, order.orderId);
      void telegramAlerts.send(`საწყისი BUY [${executionEnvironment}]\n${symbol} · სტრატეგია #${strategy.id}\nფასი: ${order.price}\nთანხა: ${order.quoteAmount.toFixed(2)} ${catalogItem.quoteAsset}`);
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

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string, user: DashboardUser | null): Promise<boolean> {
  if (request.method === "GET" && pathname === "/api/session") {
    json(response, 200, { user: user ?? { username: dashboardUsername, role: "ADMIN" } });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/market-opportunities") {
    json(response, 200, await marketOpportunities.scan());
    return true;
  }
  if (request.method === "GET" && pathname === "/api/news") {
    json(response, 200, await cryptoNews.latest());
    return true;
  }
  if (request.method === "GET" && pathname === "/api/readiness") {
    json(response, 200, await getReadinessReport(user));
    return true;
  }
  if (request.method === "GET" && pathname === "/api/telegram/status") {
    json(response, 200, telegramAlerts.getStatus());
    return true;
  }
  if (request.method === "POST" && pathname === "/api/telegram/test") {
    const sent = await telegramAlerts.send("PlayPoint სატესტო შეტყობინება\nTelegram კავშირი გამართულად მუშაობს");
    json(response, 200, { sent, ...telegramAlerts.getStatus() });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/admin/invites") {
    if (!userAuthStore || user?.role !== "ADMIN") throw new Error("მხოლოდ ადმინისტრატორს შეუძლია მოწვევის შექმნა");
    json(response, 201, { invite: await userAuthStore.createInvite(user.id) });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/admin/users") {
    if (!userAuthStore || user?.role !== "ADMIN") throw new Error("მხოლოდ ადმინისტრატორს აქვს მომხმარებლების ნახვის უფლება");
    json(response, 200, { users: await userAuthStore.listUsers() });
    return true;
  }
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
    json(response, 200, { strategies: await getStrategiesOverview(false, user) });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/strategies/archived") {
    json(response, 200, { strategies: await getStrategiesOverview(true, user) });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/strategies/comparison") {
    const requestUrl = new URL(request.url ?? pathname, "http://localhost");
    const symbol = String(requestUrl.searchParams.get("symbol") ?? "").toUpperCase();
    if (!/^[A-Z0-9]+USDT$/.test(symbol)) throw new Error("შედარებისთვის სწორი USDT სიმბოლო აირჩიე");
    json(response, 200, await getStrategyComparison(symbol, user));
    return true;
  }
  if (request.method === "GET" && pathname === "/api/strategies/backtest") {
    const requestUrl = new URL(request.url ?? pathname, "http://localhost");
    const symbol = String(requestUrl.searchParams.get("symbol") ?? "").toUpperCase();
    const days = Number(requestUrl.searchParams.get("days") ?? 30);
    if (!/^[A-Z0-9]+USDT$/.test(symbol)) throw new Error("Backtest-ისთვის სწორი USDT სიმბოლო აირჩიე");
    if (![30, 90, 365].includes(days)) throw new Error("Backtest-ის პერიოდი უნდა იყოს 30, 90 ან 365 დღე");
    json(response, 200, await getStrategyBacktests(symbol, days, user));
    return true;
  }
  if (request.method === "POST" && pathname === "/api/strategies") {
    json(response, 201, { strategy: await createStrategy(await readJson(request), user) });
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
      await ensureStrategyAccess(strategyId, user);
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
    json(response, 200, await getStrategyState(Number(detailMatch[1]), user));
    return true;
  }
  if (request.method === "PATCH" && detailMatch) {
    json(response, 200, { strategy: await updateStrategy(Number(detailMatch[1]), await readJson(request), user) });
    return true;
  }
  const statusMatch = pathname.match(/^\/api\/strategies\/(\d+)\/status$/);
  if (request.method === "PATCH" && statusMatch) {
    const body = await readJson(request) as { status?: string };
    if (body.status !== "ACTIVE" && body.status !== "PAUSED") throw new Error("სტატუსი უნდა იყოს ACTIVE ან PAUSED");
    const repository = await createStore();
    try {
      await ensureStrategyAccess(Number(statusMatch[1]), user);
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
      await ensureStrategyAccess(Number(resetMatch[1]), user);
      let strategy = await repository.resetSimulationStrategyById(Number(resetMatch[1]));
      if (userAuthStore && user) await userAuthStore.assignStrategy(strategy.id, user.id);
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
  const withdrawMatch = pathname.match(/^\/api\/strategies\/(\d+)\/withdraw-profit$/);
  if (request.method === "POST" && withdrawMatch) {
    json(response, 200, { strategy: await withdrawStrategyProfit(Number(withdrawMatch[1]), await readJson(request), user) });
    return true;
  }
  const archiveMatch = pathname.match(/^\/api\/strategies\/(\d+)\/archive$/);
  if (request.method === "POST" && archiveMatch) {
    const repository = await createStore();
    try {
      await ensureStrategyAccess(Number(archiveMatch[1]), user);
      json(response, 200, { strategy: await repository.archiveStrategy(Number(archiveMatch[1])) });
    } finally {
      await repository.close();
    }
    return true;
  }
  if (request.method === "GET" && pathname === "/api/state") {
    const strategies = await getStrategiesOverview(false, user);
    if (!strategies[0]) throw new Error("სტრატეგია ჯერ არ არსებობს");
    json(response, 200, await getStrategyState(strategies[0].id, user));
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
  const loginPath = `${basePath}/login` || "/login";
  const registerPath = `${basePath}/register` || "/register";
  if (rawPathname === healthPath || (!basePath && rawPathname === "/health")) {
    return json(response, 200, { status: "ok", service: "binance-strategy-dashboard" });
  }
  if (basePath && rawPathname === basePath) {
    response.writeHead(308, { Location: `${basePath}/` });
    return response.end();
  }
  if (basePath && !rawPathname.startsWith(`${basePath}/`)) return response.writeHead(404).end("ვერ მოიძებნა");
  if (rawPathname === loginPath && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(loginPage());
  }
  if (rawPathname === loginPath && request.method === "POST") {
    try {
      const form = await readFormBody(request);
      const username = form.get("username") ?? "";
      const password = form.get("password") ?? "";
      const user = userAuthStore ? await userAuthStore.authenticate(username, password) : null;
      const legacyValid = !userAuthStore && secureEqual(username, dashboardUsername) && secureEqual(password, dashboardPassword);
      if (user || legacyValid) {
        const cookiePath = `${basePath}/` || "/";
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        const token = userAuthStore && user ? await userAuthStore.createSession(user.id) : dashboardSessionToken;
        response.writeHead(303, {
          Location: cookiePath,
          "Set-Cookie": `dashboard_session=${token}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`,
          "Cache-Control": "no-store",
        });
        return response.end();
      }
    } catch {
      // Invalid form data is shown as a regular login failure.
    }
    response.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(loginPage("მომხმარებელი ან პაროლი არასწორია"));
  }
  if (rawPathname === registerPath && request.method === "GET" && userAuthStore) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(registerPage());
  }
  if (rawPathname === registerPath && request.method === "POST" && userAuthStore) {
    try {
      const form = await readFormBody(request);
      const user = await userAuthStore.register(form.get("inviteCode") ?? "", form.get("username") ?? "", form.get("password") ?? "");
      const token = await userAuthStore.createSession(user.id);
      const cookiePath = `${basePath}/` || "/";
      const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      response.writeHead(303, { Location: cookiePath, "Set-Cookie": `dashboard_session=${token}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=604800${secure}` });
      return response.end();
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(registerPage(error instanceof Error ? error.message : "რეგისტრაცია ვერ შესრულდა"));
    }
  }
  const currentUser = userAuthStore ? await userAuthStore.getSession(getCookie(request, "dashboard_session")) : null;
  if (userAuthStore ? !currentUser : !isLegacyAuthorized(request)) {
    response.writeHead(303, { Location: loginPath, "Cache-Control": "no-store" });
    return response.end();
  }
  const pathname = basePath ? rawPathname.slice(basePath.length) || "/" : rawPathname;
  try {
    if (pathname.startsWith("/api/") && await handleApi(request, response, pathname, currentUser)) return;
    if (pathname.startsWith("/api/")) return json(response, 404, { error: "API მისამართი ვერ მოიძებნა" });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : "უცნობი შეცდომა" });
  }

  if (pathname === "/vendor/lightweight-charts.js") {
    return fs.readFile(lightweightChartsVendorPath, (error, data) => {
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

setInterval(() => void getReadinessReport(null).then((report) => {
  const message = report.overall === "READY"
    ? "Testnet მზადყოფნა: READY\nყველა აუცილებელი შემოწმება გავლილია"
    : report.overall === "BLOCKED"
      ? "Testnet მზადყოფნა დაიბლოკა\nგახსენი მზადყოფნის მონიტორი დეტალებისთვის"
      : "Testnet დაკვირვება გრძელდება";
  return telegramAlerts.transition("readiness:overall", report.overall, message);
}).catch((error) => console.error("Readiness alert check failed:", error instanceof Error ? error.message : error)), 60_000).unref();
