import { appConfig } from "./config/env.js";
import { createStore } from "./database/createStore.js";
import { FakePriceFeed } from "./services/fakePriceFeed.js";
import { SimulationOrderService } from "./services/simulationOrderService.js";
import { StrategyEngine } from "./strategy/strategyEngine.js";
import { money, quantity } from "./utils/format.js";

const DEMO_PRICES_BEFORE_RESTART = [80_000, 75_000, 68_000, 67_000, 61_000, 60_000];
const DEMO_PRICES_AFTER_RESTART = [67_000, 60_000, 59_000, 48_000, 48_000];

async function runFeed(prices: number[]): Promise<void> {
  const repository = await createStore();
  try {
    const engine = new StrategyEngine(appConfig.strategy, repository, new SimulationOrderService());
    await engine.initialize();
    await new FakePriceFeed(prices).start((price) => engine.onPrice(price));
  } finally {
    await repository.close();
  }
}

async function main(): Promise<void> {
  console.log(`${appConfig.strategy.symbol} started in ${appConfig.tradingMode} mode`);
  console.log(`Initial Entry: ${money(appConfig.strategy.initialEntryPrice)} | Budget: ${money(appConfig.strategy.totalBudget)}`);
  await runFeed(DEMO_PRICES_BEFORE_RESTART);
  console.log("\n--- SIMULATED APPLICATION RESTART ---");
  await runFeed(DEMO_PRICES_AFTER_RESTART);

  const repository = await createStore();
  try {
    const strategy = await repository.findOrCreate(appConfig.strategy);
    const levels = await repository.getLevels(strategy.id);
    console.log("\nFINAL STATE");
    console.log(`Orders: ${await repository.countOrders(strategy.id)}`);
    console.log(`Invested: ${money(strategy.totalInvested)}`);
    console.log(`Asset quantity: ${quantity(strategy.totalAssetQuantity)}`);
    console.log(`Weighted average entry: ${money(strategy.averageEntryPrice)}`);
    console.log(`Executed BUY levels: ${levels.filter((level) => level.status === "EXECUTED").map((level) => `-${level.levelPercent}%`).join(", ")}`);
  } finally {
    await repository.close();
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
