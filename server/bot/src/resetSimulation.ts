import { appConfig } from "./config/env.js";
import { createStore } from "./database/createStore.js";

const confirmed = process.argv.includes("--confirm");
const symbol = process.argv.find((argument) => argument.startsWith("--symbol="))?.split("=")[1]?.toUpperCase();
if (!symbol || !/^[A-Z0-9]{5,20}$/.test(symbol)) {
  console.error("No changes made. Provide an explicit symbol, for example --symbol=BTCUSDT.");
  process.exit(1);
}
if (!confirmed) {
  console.error(`No changes made. To archive the active SIMULATION strategy for ${symbol}, rerun with --confirm.`);
  process.exit(1);
}

const store = await createStore();
try {
  const archived = await store.resetSimulationStrategy(symbol);
  if (archived === 0) {
    console.log(`No active SIMULATION strategy found for ${symbol}.`);
  } else {
    console.log(`Archived ${archived} SIMULATION strategy for ${symbol}.`);
    console.log("Real Binance account balances and TESTNET/LIVE strategy data were not changed.");
    console.log("Restart the live worker to create a fresh SIMULATION strategy.");
  }
} finally {
  await store.close();
}
