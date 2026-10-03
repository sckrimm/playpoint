import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type Database from "better-sqlite3";
import { openDatabase } from "../src/database/database.js";
import { StrategyRepository } from "../src/database/strategyRepository.js";
import { BinanceTestnetOrderError, BinanceTestnetOrderService } from "../src/services/binanceTestnetOrderService.js";
import { SimulationOrderService } from "../src/services/simulationOrderService.js";
import { StrategyEngine } from "../src/strategy/strategyEngine.js";
import type { OrderExecutionService, StrategyConfig } from "../src/types/strategy.js";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length) databases.pop()!.close();
});

function repository(): StrategyRepository {
  const db = openDatabase(":memory:");
  databases.push(db);
  return new StrategyRepository(db);
}

function config(environment: "SIMULATION" | "TESTNET" = "SIMULATION"): StrategyConfig {
  return {
    executionEnvironment: environment,
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    initialEntryPrice: 100,
    totalBudget: 1_000,
    initialPurchaseAmount: 0,
    finalReservePercent: 20,
    buyLevels: [{ dropPercent: 10, budgetPercent: 100 }],
    sellLevels: [{ gainPercent: 10, allocationPercent: 50 }],
  };
}

describe("order duplication protection", () => {
  test("only one worker can claim a level and only its client ID can release it", async () => {
    const store = repository();
    const strategy = await store.createStrategy(config());

    assert.equal(await store.claimLevel(strategy.id, "BUY", 10, "client-a"), true);
    assert.equal(await store.claimLevel(strategy.id, "BUY", 10, "client-b"), false);
    await store.releaseLevel(strategy.id, "BUY", 10, "wrong-client");
    assert.equal((await store.getLevels(strategy.id))[0]!.status, "EXECUTING");
    await store.releaseLevel(strategy.id, "BUY", 10, "client-a");
    assert.equal((await store.getLevels(strategy.id))[0]!.status, "WAITING");
  });

  test("recording the same exchange order twice does not change balances twice", async () => {
    const store = repository();
    const strategy = await store.createStrategy(config());
    await store.claimLevel(strategy.id, "BUY", 10, "client-a");

    await store.completeBuy(strategy.id, 10, 90, 900, 10, "exchange-1");
    await store.completeBuy(strategy.id, 10, 90, 900, 10, "exchange-1");

    const current = await store.getById(strategy.id);
    assert.equal(current.totalInvested, 900);
    assert.equal(current.totalAssetQuantity, 10);
    assert.equal(await store.countOrders(strategy.id), 1);
  });

  test("strategy engine executes each BUY and SELL level only once", async () => {
    const store = repository();
    const engine = new StrategyEngine(config(), store, new SimulationOrderService(), false);
    const strategyId = await engine.initialize();

    await engine.onPrice(90);
    await engine.onPrice(90);
    await engine.onPrice(111);
    await engine.onPrice(111);

    const orders = await store.getOrders(strategyId);
    assert.equal(orders.filter((order) => order.side === "BUY").length, 1);
    assert.equal(orders.filter((order) => order.side === "SELL").length, 1);
    assert.equal((await store.getLevels(strategyId)).every((level) => level.status === "EXECUTED"), true);
  });

  test("SELL cannot consume the configured permanent reserve", async () => {
    const store = repository();
    const strategy = await store.createStrategy(config());
    await store.claimLevel(strategy.id, "BUY", 10, "buy-client");
    await store.completeBuy(strategy.id, 10, 100, 1_000, 10, "buy-order");

    await assert.rejects(
      store.completeSell(strategy.id, 10, 110, 990, 9, 2, "sell-order"),
      /permanent reserve/,
    );
    assert.equal((await store.getById(strategy.id)).totalAssetQuantity, 10);
    assert.equal(await store.countOrders(strategy.id), 1);
  });

  test("restart reconciliation records a confirmed exchange order exactly once", async () => {
    const store = repository();
    const strategy = await store.createStrategy(config("TESTNET"));
    await store.claimLevel(strategy.id, "BUY", 10, "persisted-client");
    await store.failLevel(strategy.id, "BUY", 10, new Error("[NO_AUTO_RETRY] response lost"));
    const orders: OrderExecutionService = {
      environment: "TESTNET",
      buy: async () => { throw new Error("not used"); },
      sell: async () => { throw new Error("not used"); },
      reconcileOrder: async (_symbol, _side, clientOrderId) => {
        assert.equal(clientOrderId, "persisted-client");
        return { orderId: "exchange-recovered", symbol: "BTCUSDT", side: "BUY", price: 90, quoteAmount: 900, assetQuantity: 10 };
      },
    };

    await new StrategyEngine(config("TESTNET"), store, orders, false, strategy.id).initialize();
    await new StrategyEngine(config("TESTNET"), store, orders, false, strategy.id).initialize();

    assert.equal(await store.countOrders(strategy.id), 1);
    assert.equal((await store.getById(strategy.id)).totalInvested, 900);
    assert.equal((await store.getLevels(strategy.id))[0]!.status, "EXECUTED");
  });
});

describe("Binance reconciliation responses", () => {
  function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  function service(orderResponse: Response): BinanceTestnetOrderService {
    let request = 0;
    const fetchMock: typeof fetch = async () => {
      request += 1;
      return request === 1 ? response({ serverTime: Date.now() }) : orderResponse;
    };
    return new BinanceTestnetOrderService("key", "secret", fetchMock);
  }

  test("returns a filled order", async () => {
    const result = await service(response({
      orderId: 123, status: "FILLED", executedQty: "2", cummulativeQuoteQty: "180",
    })).reconcileOrder("BTCUSDT", "BUY", "client-a");
    assert.deepEqual(result, {
      orderId: "123", symbol: "BTCUSDT", side: "BUY", price: 90, quoteAmount: 180, assetQuantity: 2,
    });
  });

  test("returns null only when Binance confirms no executable order", async () => {
    assert.equal(await service(response({ code: -2013, msg: "Order does not exist" }, 400))
      .reconcileOrder("BTCUSDT", "BUY", "missing"), null);
    assert.equal(await service(response({ orderId: 124, status: "CANCELED", executedQty: "0", cummulativeQuoteQty: "0" }))
      .reconcileOrder("BTCUSDT", "BUY", "canceled"), null);
  });

  test("keeps an open order locked for a later check", async () => {
    await assert.rejects(
      service(response({ orderId: 125, status: "NEW", executedQty: "0", cummulativeQuoteQty: "0" }))
        .reconcileOrder("BTCUSDT", "BUY", "open"),
      (error) => error instanceof BinanceTestnetOrderError && error.kind === "UNKNOWN_RESULT" && error.noAutoRetry,
    );
  });
});
