import { appConfig } from "../config/env.js";
import type { DashboardUser, UserAuthStore } from "./userAuthStore.js";
import type { BinanceCredentials } from "./credentialVault.js";

export async function resolveCredentials(store: UserAuthStore | null, user: DashboardUser | null,
  environment: "LIVE" | "TESTNET"): Promise<BinanceCredentials | null> {
  if (store && !user) return null;
  if (store && user) {
    const own = await store.credentials(user.id, environment);
    if (own) return own;
    if (user.role !== "ADMIN") return null;
  }
  const apiKey = environment === "TESTNET" ? appConfig.binanceTestnetApiKey : appConfig.binanceApiKey;
  const apiSecret = environment === "TESTNET" ? appConfig.binanceTestnetApiSecret : appConfig.binanceApiSecret;
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}
