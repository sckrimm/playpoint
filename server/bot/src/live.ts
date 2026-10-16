import { BinanceAccountError, BinanceAccountService } from "./binance/binanceAccountService.js";
import { BinanceExchangeInfoService } from "./binance/binanceExchangeInfoService.js";
import { BinancePriceFeed } from "./binance/binancePriceFeed.js";
import { appConfig } from "./config/env.js";
import { createStore } from "./database/createStore.js";
import { SimulationOrderService } from "./services/simulationOrderService.js";
import { BinanceTestnetOrderService } from "./services/binanceTestnetOrderService.js";
import { needsOrderReconciliation, StrategyEngine } from "./strategy/strategyEngine.js";
import { strategyRecordToConfig } from "./strategy/strategyConfig.js";
import type { StrategyRecord } from "./types/strategy.js";
import { money } from "./utils/format.js";
import { telegramAlerts } from "./services/telegramAlertService.js";
import { getRuntimeUsers } from "./auth/runtimeUsers.js";
import { resolveCredentials } from "./auth/accountCredentials.js";
import { createHash, randomUUID } from "node:crypto";
import { isFreshMarketEvent } from "./services/marketSafety.js";
import { hasTestnetAccess } from "./auth/liveAccess.js";

const store = await createStore();
const users = await getRuntimeUsers();
const executorVersions = new Map<number, string>();
const exchangeInfo = new BinanceExchangeInfoService();
const feeds = {
  SIMULATION: new BinancePriceFeed(),
  TESTNET: new BinancePriceFeed("wss://stream.testnet.binance.vision/ws", "Binance Spot Testnet"),
};
const engines = new Map<number, StrategyEngine>();
const workerId = randomUUID();
const lastObservedAt = new Map<number, number>();
const strategiesByEnvironment = {
  SIMULATION: new Map<string, StrategyRecord[]>(),
  TESTNET: new Map<string, StrategyRecord[]>(),
};
const lastPersistedAt = new Map<string, number>();

if (telegramAlerts.configured) {
  void telegramAlerts.send("PlayPoint მონიტორინგი ჩაირთო\nTelegram შეტყობინებები დაკავშირებულია");
} else {
  console.log("Telegram alerts are not configured");
}

async function syncStrategies(): Promise<void> {
  const monitored = (await store.listStrategies()).filter((strategy) => strategy.executionEnvironment !== "LIVE");
  const retainedIds = new Set<number>();

  strategiesByEnvironment.SIMULATION.clear();
  strategiesByEnvironment.TESTNET.clear();
  for (const strategy of monitored) {
    if (strategy.status !== "ACTIVE" && !(await store.getLevels(strategy.id)).some(needsOrderReconciliation)) continue;
    retainedIds.add(strategy.id);
    const owner = users ? await users.strategyOwner(strategy.id) : null;
    if (users && !owner) continue;
    if (users && owner && strategy.status === "ACTIVE") {
      const allowed = strategy.executionEnvironment === "TESTNET" ? hasTestnetAccess(owner)
        : await users.wallets.isFunded(owner.id, strategy.id, strategy.totalBudget);
      if (!allowed) {
        await store.setStrategyStatus(strategy.id, "PAUSED");
        engines.delete(strategy.id);
        continue;
      }
    }
    let credentials;
    try { credentials = strategy.executionEnvironment === "TESTNET" ? await resolveCredentials(users, owner, "TESTNET") : null; }
    catch { engines.delete(strategy.id); continue; }
    const version = createHash("sha256").update(`${owner?.id ?? 0}:${credentials?.apiKey ?? "simulation"}:${credentials?.apiSecret ?? ""}`).digest("hex");
    if (executorVersions.get(strategy.id) !== version) {
      engines.delete(strategy.id);
      executorVersions.set(strategy.id, version);
    }
    if (!engines.has(strategy.id)) {
      const orders = strategy.executionEnvironment === "TESTNET"
        ? credentials
          ? new BinanceTestnetOrderService(credentials.apiKey, credentials.apiSecret)
          : null
        : new SimulationOrderService();
      if (!orders) {
        console.error(`TESTNET strategy #${strategy.id} skipped: API credentials are not configured`);
        continue;
      }
      const engine = new StrategyEngine(strategyRecordToConfig(strategy, await store.getLevels(strategy.id)), store, orders, false, strategy.id,
        owner?.role === "USER" ? async () => false : (message) => telegramAlerts.send(message),
        users && owner ? async (current) => current.executionEnvironment === "SIMULATION"
          ? users.wallets.isFunded(owner.id, current.id, current.totalBudget)
          : hasTestnetAccess(await users.strategyOwner(current.id)) : undefined);
      await engine.initialize();
      engines.set(strategy.id, engine);
      const rules = await exchangeInfo.getSymbolRules(strategy.symbol);
      await store.saveSymbolRules(rules);
      console.log(`Watching ${strategy.symbol} strategy #${strategy.id}`);
    }
    if (strategy.status !== "ACTIVE") continue;
    const environment = strategy.executionEnvironment as "SIMULATION" | "TESTNET";
    const grouped = strategiesByEnvironment[environment].get(strategy.symbol) ?? [];
    grouped.push(strategy);
    strategiesByEnvironment[environment].set(strategy.symbol, grouped);
  }
  for (const id of engines.keys()) {
    if (!retainedIds.has(id)) {
      engines.delete(id);
      executorVersions.delete(id);
      lastObservedAt.delete(id);
    }
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
    void telegramAlerts.transition("account:read-only", "CONNECTED", "Binance read-only API კავშირი აღდგა");
    console.log("Binance Spot account balances refreshed");
  } catch (error) {
    const status = error instanceof BinanceAccountError ? error.kind : "ERROR";
    const message = error instanceof BinanceAccountError ? error.message : "Binance account connection failed safely";
    await store.saveBinanceConnectionState({ status, message, updatedAt: new Date().toISOString() });
    void telegramAlerts.transition("account:read-only", status, `Binance read-only API შეცდომა [${status}]\n${message}`);
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

let refreshingPersonalAccounts = false;
async function refreshPersonalAccounts(): Promise<void> {
  if (!users || refreshingPersonalAccounts) return;
  refreshingPersonalAccounts = true;
  try {
    for (const user of await users.listUsers()) {
      if (user.role !== "ADMIN" && !user.liveAccess) continue;
      try {
        const credentials = await users.credentials(user.id, "LIVE");
        if (!credentials) continue;
        const balances = await new BinanceAccountService(credentials.apiKey, credentials.apiSecret).getBalances();
        const usdt = balances.find((balance) => balance.asset === "USDT");
        await users.recordAccountBalance(user.id, Number(usdt?.free ?? 0) + Number(usdt?.locked ?? 0));
      } catch { console.error(`Personal account refresh unavailable for user #${user.id}`); }
    }
  } finally { refreshingPersonalAccounts = false; }
}
void refreshPersonalAccounts();
setInterval(() => void refreshPersonalAccounts(), 30_000).unref();

await syncStrategies();
setInterval(() => void syncStrategies().catch((error) =>
  console.error("Strategy subscription sync failed:", error instanceof Error ? error.message : error)), 5_000).unref();
setInterval(() => {
  for (const engine of engines.values()) {
    void engine.reconcilePendingOrders().catch((error) =>
      console.error("Periodic order reconciliation failed:", error instanceof Error ? error.message : error));
  }
}, 60_000).unref();

function startFeed(environment: "SIMULATION" | "TESTNET"): void {
  feeds[environment].start(async (symbol, price, eventTime) => {
  if (!isFreshMarketEvent(eventTime.getTime())) return;
  const now = Date.now();
  const marketKey = `${environment}:${symbol}`;
  if (now - (lastPersistedAt.get(marketKey) ?? 0) >= 1_000) {
    await store.updateMarketPrice(symbol, price, eventTime);
    lastPersistedAt.set(marketKey, now);
    console.log(`[${environment}] ${symbol} ${money(price)}`);
  }
  for (const strategy of strategiesByEnvironment[environment].get(symbol) ?? []) {
    await engines.get(strategy.id)?.onPrice(price, eventTime);
    if (environment === "TESTNET" && engines.has(strategy.id) && now - (lastObservedAt.get(strategy.id) ?? 0) >= 10_000) {
      await store.recordTestnetObservation(strategy.id, now, workerId);
      lastObservedAt.set(strategy.id, now);
    }
  }
  });
}

startFeed("SIMULATION");
startFeed("TESTNET");

async function shutdown(signal: string): Promise<void> {
  await users?.close();
  console.log(`${signal} received, stopping market feed`);
  feeds.SIMULATION.stop();
  feeds.TESTNET.stop();
  await store.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
