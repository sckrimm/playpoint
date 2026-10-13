import { appConfig } from "../config/env.js";
import { createStore } from "../database/createStore.js";
import { UserAuthStore } from "./userAuthStore.js";

let initialization: Promise<UserAuthStore | null> | null = null;

export function getRuntimeUsers(): Promise<UserAuthStore | null> {
  initialization ??= (async () => {
    if (!appConfig.databaseUrl) return null;
    const username = process.env.DASHBOARD_USERNAME?.trim() ?? "";
    const password = process.env.DASHBOARD_PASSWORD ?? "";
    if (!username || !password) throw new Error("User accounts require dashboard administrator credentials");
    const migrationStore = await createStore();
    await migrationStore.close();
    const users = new UserAuthStore(appConfig.databaseUrl);
    await users.initialize(username, password);
    return users;
  })();
  return initialization;
}
