import { BinanceAccountError, BinanceAccountService } from "./binance/binanceAccountService.js";
import { BinanceExchangeInfoService } from "./binance/binanceExchangeInfoService.js";
import { BinancePriceFeed } from "./binance/binancePriceFeed.js";
import { appConfig } from "./config/env.js";
import { createStore } from "./database/createStore.js";
import { SimulationOrderService } from "./services/simulationOrderService.js";
import { BinanceTestnetOrderService } from "./services/binanceTestnetOrderService.js";
import { StrategyEngine } from "./strategy/strategyEngine.js";
import { strategyRecordToConfig } from "./strategy/strategyConfig.js";
import type { StrategyRecord } from "./types/strategy.js";
import { money } from "./utils/format.js";

const store = await createStore();
const exchangeInfo = new BinanceExchangeInfoService();
const feeds = {
  SIMULATION: new BinancePriceFeed(),
  TESTNET: new BinancePriceFeed("wss://stream.testnet.binance.vision/ws", "Binance Spot Testnet"),
};
const engines = new Map<number, StrategyEngine>();
const strategiesByEnvironment = {
  SIMULATION: new Map<string, StrategyRecord[]>(),
  TESTNET: new Map<string, StrategyRecord[]>(),
};
const lastPersistedAt = new Map<string, number>();

async function syncStrategies(): Promise<void> {
  const active = (await store.listStrategies()).filter((strategy) =>
    strategy.status === "ACTIVE" && strategy.executionEnvironment !== "LIVE");
  const activeIds = new Set(active.map((strategy) => strategy.id));
  for (const id of engines.keys()) if (!activeIds.has(id)) engines.delete(id);

  strategiesByEnvironment.SIMULATION.clear();
  strategiesByEnvironment.TESTNET.clear();
  for (const strategy of active) {
    if (!engines.has(strategy.id)) {
      const orders = strategy.executionEnvironment === "TESTNET"
        ? appConfig.binanceTestnetApiKey && appConfig.binanceTestnetApiSecret
          ? new BinanceTestnetOrderService(appConfig.binanceTestnetApiKey, appConfig.binanceTestnetApiSecret)
          : null
        : new SimulationOrderService();
      if (!orders) {
        console.error(`TESTNET strategy #${strategy.id} skipped: API credentials are not configured`);
        continue;
      }
      const engine = new StrategyEngine(strategyRecordToConfig(strategy, await store.getLevels(strategy.id)), store, orders, false, strategy.id);
      await engine.initialize();
      engines.set(strategy.id, engine);
      const rules = await exchangeInfo.getSymbolRules(strategy.symbol);
      await store.saveSymbolRules(rules);
      console.log(`Watching ${strategy.symbol} strategy #${strategy.id}`);
    }
    const environment = strategy.executionEnvironment as "SIMULATION" | "TESTNET";
    const grouped = strategiesByEnvironment[environment].get(strategy.symbol) ?? [];
    grouped.push(strategy);
    strategiesByEnvironment[environment].set(strategy.symbol, grouped);
  }
  feeds.SIMULATION.setSymbols([...strategiesByEnvironment.SIMULATION.keys()]);
  feeds.TESTNET.setSymbols([...strategiesByEnvironment.TESTNET.keys()]);
}

const accountService = appConfig.binanceApiKey && appConfig.binanceApiSecret
  ? new BinanceAccountService(appConfig.binanceApiKey, appConfig.binanceApiSecret)
  : null;

async function refreshBalances(): Promise<void> {
  if (!accountService) return;
  try {
    await store.saveAccountBalances(await accountService.getBalances());
    await store.saveBinanceConnectionState({
      status: "CONNECTED", message: "Spot ანგარიში დაკავშირებულია მხოლოდ წაკითხვის რეჟიმში", updatedAt: new Date().toISOString(),
    });
    console.log("Binance Spot account balances refreshed");
  } catch (error) {
    const status = error instanceof BinanceAccountError ? error.kind : "ERROR";
    const message = error instanceof BinanceAccountError ? error.message : "Binance account connection failed safely";
    await store.saveBinanceConnectionState({ status, message, updatedAt: new Date().toISOString() });
    console.error(`Read-only account refresh failed [${status}]: ${message}`);
  }
}

if (accountService) {
  await store.saveBinanceConnectionState({
    status: "CONNECTING", message: "მიმდინარეობს Spot ანგარიშთან კავშირი მხოლოდ წაკითხვის რეჟიმში", updatedAt: new Date().toISOString(),
  });
  await refreshBalances();
  setInterval(() => void refreshBalances(), 30_000).unref();
} else {
  await store.saveBinanceConnectionState({
    status: "NOT_CONFIGURED", message: "Binance API მონაცემები გამართული არ არის", updatedAt: new Date().toISOString(),
  });
}

await syncStrategies();
setInterval(() => void syncStrategies().catch((error) =>
  console.error("Strategy subscription sync failed:", error instanceof Error ? error.message : error)), 5_000).unref();

function startFeed(environment: "SIMULATION" | "TESTNET"): void {
  feeds[environment].start(async (symbol, price, eventTime) => {
  const now = Date.now();
  const marketKey = `${environment}:${symbol}`;
  if (now - (lastPersistedAt.get(marketKey) ?? 0) >= 1_000) {
    await store.updateMarketPrice(symbol, price, eventTime);
    lastPersistedAt.set(marketKey, now);
    console.log(`[${environment}] ${symbol} ${money(price)}`);
  }
  for (const strategy of strategiesByEnvironment[environment].get(symbol) ?? []) {
    await engines.get(strategy.id)?.onPrice(price);
  }
  });
}

startFeed("SIMULATION");
startFeed("TESTNET");

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, stopping market feed`);
  feeds.SIMULATION.stop();
  feeds.TESTNET.stop();
  await store.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
