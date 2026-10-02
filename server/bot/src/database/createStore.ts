import { appConfig } from "../config/env.js";
import { openDatabase } from "./database.js";
import { PostgresStrategyRepository } from "./postgresRepository.js";
import type { StrategyStore } from "./repository.js";
import { StrategyRepository } from "./strategyRepository.js";

export async function createStore(): Promise<StrategyStore> {
  const store: StrategyStore = appConfig.databaseUrl
    ? new PostgresStrategyRepository(appConfig.databaseUrl)
    : new StrategyRepository(openDatabase(appConfig.databasePath));
  await store.initialize();
  return store;
}
