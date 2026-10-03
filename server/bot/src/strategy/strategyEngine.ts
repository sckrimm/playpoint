import type { OrderExecutionService, StrategyConfig } from "../types/strategy.js";
import type { StrategyStore } from "../database/repository.js";
import { money, quantity } from "../utils/format.js";
import { telegramAlerts } from "../services/telegramAlertService.js";

export class StrategyEngine {
  private evaluationQueue: Promise<void> = Promise.resolve();
  private strategyId: number | null;

  constructor(
    private readonly config: StrategyConfig,
    private readonly repository: StrategyStore,
    private readonly orders: OrderExecutionService,
    private readonly verbose = true,
    strategyId?: number,
  ) {
    this.strategyId = strategyId ?? null;
  }

  async initialize(): Promise<number> {
    if (this.config.executionEnvironment === "LIVE") {
      throw new Error("Safety lock: LIVE execution is disabled");
    }
    if (this.config.executionEnvironment !== this.orders.environment) {
      throw new Error(`Safety lock: ${this.orders.environment} executor cannot run in ${this.config.executionEnvironment}`);
    }
    const strategy = this.strategyId === null
      ? await this.repository.findOrCreate(this.config)
      : await this.repository.getById(this.strategyId);
    this.strategyId = strategy.id;
    await this.repository.initializeBuyLevels(strategy.id, this.config);
    return strategy.id;
  }

  onPrice(price: number): Promise<void> {
    this.evaluationQueue = this.evaluationQueue.then(() => this.evaluate(price));
    return this.evaluationQueue;
  }

  private async evaluate(price: number): Promise<void> {
    if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be a positive number");
    if (this.strategyId === null) throw new Error("Strategy engine is not initialized");
    const strategy = await this.repository.getById(this.strategyId);
    if (this.verbose) console.log(`\n${strategy.symbol} | Current: ${money(price)} | Initial: ${money(strategy.initialEntryPrice)} | Average: ${money(strategy.averageEntryPrice)}`);

    const storedLevels = await this.repository.getLevels(strategy.id);
    const eligibleBuys = storedLevels
      .filter((level) => level.side === "BUY" && price <= level.triggerPrice)
      .sort((a, b) => a.levelPercent - b.levelPercent);

    let executedAny = false;
    for (const level of eligibleBuys) {
      if (!await this.repository.claimLevel(strategy.id, "BUY", level.levelPercent)) continue;
      executedAny = true;
      const levelBudget = strategy.totalBudget - strategy.initialPurchaseAmount;
      const quoteAmount = levelBudget * (level.allocationPercent / 100);
      try {
        const order = await this.orders.buy(strategy.symbol, price, quoteAmount);
        await this.repository.completeBuy(strategy.id, level.levelPercent, order.price, order.quoteAmount, order.assetQuantity, order.orderId);
        void telegramAlerts.send([
          `BUY შესრულდა [${this.orders.environment}]`,
          `${strategy.symbol} · სტრატეგია #${strategy.id}`,
          `დონე: -${level.levelPercent}%`,
          `ფასი: ${money(order.price)}`,
          `თანხა: ${money(order.quoteAmount)}`,
          `მიღებული: ${quantity(order.assetQuantity)} ${strategy.baseAsset}`,
        ].join("\n"));
        console.log([
          "BUY LEVEL TRIGGERED",
          `Level: -${level.levelPercent}% (trigger ${money(level.triggerPrice)})`,
          `Budget allocation: ${level.allocationPercent}%`,
          `[${this.orders.environment}] BUY ${strategy.symbol}: ${money(order.quoteAmount)} at ${money(order.price)}`,
          `Estimated asset received: ${quantity(order.assetQuantity)}`,
        ].join("\n"));
      } catch (error) {
        await this.repository.failLevel(strategy.id, "BUY", level.levelPercent, error);
        const message = error instanceof Error ? error.message : String(error);
        void telegramAlerts.send(`BUY შეცდომა [${this.orders.environment}]\n${strategy.symbol} · სტრატეგია #${strategy.id}\nდონე: -${level.levelPercent}%\n${message}`);
        console.error(`BUY -${level.levelPercent}% failed safely`, message);
      }
    }

    const afterBuys = await this.repository.getById(strategy.id);
    const minimumReserveQuantity = afterBuys.totalPurchasedQuantity * (afterBuys.finalReservePercent / 100);
    const eligibleSells = storedLevels
      .filter((level) => level.side === "SELL" && price >= level.triggerPrice)
      .sort((a, b) => a.levelPercent - b.levelPercent);

    for (const level of eligibleSells) {
      const current = await this.repository.getById(strategy.id);
      const assetQuantity = current.totalPurchasedQuantity * (level.allocationPercent / 100);
      if (assetQuantity <= 0 || current.totalAssetQuantity - assetQuantity + 1e-12 < minimumReserveQuantity) continue;
      if (!await this.repository.claimLevel(strategy.id, "SELL", level.levelPercent)) continue;
      executedAny = true;
      try {
        const order = await this.orders.sell(strategy.symbol, price, assetQuantity);
        await this.repository.completeSell(strategy.id, level.levelPercent, order.price, order.quoteAmount,
          order.assetQuantity, minimumReserveQuantity, order.orderId);
        void telegramAlerts.send([
          `SELL შესრულდა [${this.orders.environment}]`,
          `${strategy.symbol} · სტრატეგია #${strategy.id}`,
          `დონე: +${level.levelPercent}%`,
          `ფასი: ${money(order.price)}`,
          `მიღებული: ${money(order.quoteAmount)}`,
          `გაყიდული: ${quantity(order.assetQuantity)} ${strategy.baseAsset}`,
        ].join("\n"));
        console.log([
          "SELL LEVEL TRIGGERED",
          `Level: +${level.levelPercent}% (trigger ${money(level.triggerPrice)})`,
          `Asset allocation: ${level.allocationPercent}%`,
          `[${this.orders.environment}] SELL ${strategy.symbol}: ${quantity(order.assetQuantity)} at ${money(order.price)}`,
          `Estimated proceeds: ${money(order.quoteAmount)}`,
        ].join("\n"));
      } catch (error) {
        await this.repository.failLevel(strategy.id, "SELL", level.levelPercent, error);
        const message = error instanceof Error ? error.message : String(error);
        void telegramAlerts.send(`SELL შეცდომა [${this.orders.environment}]\n${strategy.symbol} · სტრატეგია #${strategy.id}\nდონე: +${level.levelPercent}%\n${message}`);
        console.error(`SELL +${level.levelPercent}% failed safely`, message);
      }
    }
    if (!executedAny && this.verbose) console.log("No action.");
  }
}
