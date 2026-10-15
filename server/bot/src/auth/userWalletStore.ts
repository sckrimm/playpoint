import type { Pool, PoolClient } from "pg";
import { fiatCurrency, moneyMinor } from "../services/exchangeRateService.js";
import type { DashboardUser } from "./userAuthStore.js";

export class UserWalletStore {
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bot_user_wallets (
        user_id BIGINT PRIMARY KEY REFERENCES bot_users(id), simulation_credit_minor BIGINT NOT NULL DEFAULT 100000,
        assigned_minor BIGINT NOT NULL DEFAULT 0, assigned_currency TEXT NOT NULL DEFAULT 'GEL', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bot_simulation_allocations (
        strategy_id BIGINT PRIMARY KEY REFERENCES bot_strategies(id), user_id BIGINT NOT NULL REFERENCES bot_users(id),
        budget_minor BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_wallet_audit (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES bot_users(id), actor_id BIGINT REFERENCES bot_users(id),
        operation TEXT NOT NULL, amount_minor BIGINT NOT NULL, currency TEXT NOT NULL,
        previous_minor BIGINT, request_key TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bot_wallet_migrations (name TEXT PRIMARY KEY);
    `);
  }

  async ensureWallet(userId: number, client: Pool | PoolClient = this.pool): Promise<void> {
    await client.query("INSERT INTO bot_user_wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
  }

  async migrateExistingStrategies(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingMarker = await client.query("SELECT name FROM bot_wallet_migrations WHERE name = 'simulation-opening'");
      const marker = existingMarker.rows.length ? null : await client.query("INSERT INTO bot_wallet_migrations (name) VALUES ('simulation-opening') ON CONFLICT (name) DO NOTHING RETURNING name");
      if (marker?.rowCount) {
        await client.query("INSERT INTO bot_user_wallets (user_id) SELECT id FROM bot_users ON CONFLICT (user_id) DO NOTHING");
        const existing = await client.query(`SELECT s.id, o.user_id, s.total_budget FROM bot_strategies s
          JOIN bot_strategy_owners o ON o.strategy_id = s.id WHERE s.execution_environment = 'SIMULATION' AND s.status IN ('ACTIVE', 'PAUSED')`);
        for (const row of existing.rows) await client.query(`INSERT INTO bot_simulation_allocations (strategy_id, user_id, budget_minor)
          VALUES ($1, $2, $3) ON CONFLICT (strategy_id) DO NOTHING`, [row.id, row.user_id, Math.round(Number(row.total_budget) * 100)]);
        const wallets = await client.query("SELECT user_id FROM bot_user_wallets");
        for (const row of wallets.rows) {
          const total = await client.query("SELECT COALESCE(SUM(budget_minor), 0) AS allocated FROM bot_simulation_allocations WHERE user_id = $1", [row.user_id]);
          await client.query("UPDATE bot_user_wallets SET simulation_credit_minor = $1 WHERE user_id = $2", [Math.max(100000, Number(total.rows[0].allocated)), row.user_id]);
        }
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async summary(userId: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureWallet(userId, client);
      const result = await client.query("SELECT * FROM bot_user_wallets WHERE user_id = $1 FOR SHARE", [userId]);
      const allocations = await client.query(`SELECT a.strategy_id, a.budget_minor, s.withdrawn_profit FROM bot_simulation_allocations a
        JOIN bot_strategies s ON s.id = a.strategy_id WHERE a.user_id = $1`, [userId]);
      const row = result.rows[0]!;
      const allocatedMinor = allocations.rows.reduce((sum, allocation) => sum + Number(allocation.budget_minor), 0);
      const withdrawnMinor = allocations.rows.reduce((sum, allocation) => sum + Math.floor(Number(allocation.withdrawn_profit) * 100 + 1e-8), 0);
      await client.query("COMMIT");
      return {
        simulation: { credited: Number(row.simulation_credit_minor) / 100, allocated: allocatedMinor / 100,
          available: (Number(row.simulation_credit_minor) + withdrawnMinor - allocatedMinor) / 100,
          strategyIds: allocations.rows.map((allocation) => Number(allocation.strategy_id)) },
        assigned: { amount: Number(row.assigned_minor) / 100, currency: fiatCurrency(row.assigned_currency), updatedAt: row.updated_at },
      };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async fundStrategy(userId: number, strategyId: number, amount: number, update?: () => Promise<void>): Promise<void> {
    const budgetMinor = moneyMinor(amount, false);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureWallet(userId, client);
      const wallet = await client.query("SELECT simulation_credit_minor FROM bot_user_wallets WHERE user_id = $1 FOR UPDATE", [userId]);
      const owned = await client.query(`SELECT s.id FROM bot_strategies s JOIN bot_strategy_owners o ON o.strategy_id = s.id
        WHERE s.id = $1 AND o.user_id = $2 AND s.execution_environment = 'SIMULATION' AND s.status = 'PAUSED'`, [strategyId, userId]);
      if (!owned.rows.length) throw new Error("დაფინანსებისთვის საჭიროა შენი შეჩერებული SIMULATION ბოტი");
      const allocations = await client.query(`SELECT a.strategy_id, a.budget_minor, s.withdrawn_profit FROM bot_simulation_allocations a
        JOIN bot_strategies s ON s.id = a.strategy_id WHERE a.user_id = $1`, [userId]);
      const reserved = allocations.rows.reduce((sum, row) => sum + (Number(row.strategy_id) === strategyId ? 0 : Number(row.budget_minor)), 0);
      const returned = allocations.rows.reduce((sum, row) => sum + Math.floor(Number(row.withdrawn_profit) * 100 + 1e-8), 0);
      const available = Number(wallet.rows[0].simulation_credit_minor) + returned - reserved;
      if (budgetMinor > available) throw new Error(`არასაკმარისი სატესტო USDT; ხელმისაწვდომია ${(available / 100).toFixed(2)}`);
      if (update) await update();
      await client.query(`INSERT INTO bot_simulation_allocations (strategy_id, user_id, budget_minor) VALUES ($1, $2, $3)
        ON CONFLICT (strategy_id) DO UPDATE SET budget_minor = EXCLUDED.budget_minor`, [strategyId, userId, budgetMinor]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async isFunded(userId: number, strategyId: number, budget: number): Promise<boolean> {
    const result = await this.pool.query("SELECT budget_minor FROM bot_simulation_allocations WHERE user_id = $1 AND strategy_id = $2", [userId, strategyId]);
    return result.rows.length === 1 && Number(result.rows[0].budget_minor) >= Math.round(budget * 100);
  }

  async replaceSimulationStrategy<T extends { id: number }>(userId: number, strategyId: number, totalPnl: number, replace: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const wallet = (await client.query("SELECT simulation_credit_minor FROM bot_user_wallets WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
      const allocation = (await client.query("SELECT budget_minor FROM bot_simulation_allocations WHERE user_id = $1 AND strategy_id = $2", [userId, strategyId])).rows[0];
      if (!wallet || !allocation || !Number.isFinite(totalPnl)) throw new Error("სატესტო დაფინანსება ვერ მოიძებნა");
      const other = await client.query(`SELECT a.budget_minor, s.withdrawn_profit FROM bot_simulation_allocations a
        JOIN bot_strategies s ON s.id = a.strategy_id WHERE a.user_id = $1 AND a.strategy_id <> $2`, [userId, strategyId]);
      const credit = Number(wallet.simulation_credit_minor) + Math.round(totalPnl * 100);
      const available = credit + other.rows.reduce((sum, row) => sum + Math.floor(Number(row.withdrawn_profit) * 100 + 1e-8) - Number(row.budget_minor), 0);
      if (Number(allocation.budget_minor) > available) throw new Error("დანაკარგის შემდეგ იმავე ბიუჯეტით განულებისთვის სატესტო USDT არ არის საკმარისი");
      const fresh = await replace();
      await client.query("INSERT INTO bot_strategy_owners (strategy_id, user_id) VALUES ($1, $2) ON CONFLICT (strategy_id) DO NOTHING", [fresh.id, userId]);
      await client.query("UPDATE bot_simulation_allocations SET strategy_id = $1 WHERE strategy_id = $2 AND user_id = $3", [fresh.id, strategyId, userId]);
      await client.query("UPDATE bot_user_wallets SET simulation_credit_minor = $1, updated_at = NOW() WHERE user_id = $2", [credit, userId]);
      await client.query(`INSERT INTO bot_wallet_audit (user_id, actor_id, operation, amount_minor, currency, previous_minor, request_key)
        VALUES ($1, $1, 'SIMULATION_RESET', $2, 'USDT', $3, $4)`, [userId, Math.round(totalPnl * 100), wallet.simulation_credit_minor, `simulation_reset_${strategyId}`]);
      await client.query("COMMIT");
      return fresh;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async history(userId: number) {
    const result = await this.pool.query(`SELECT operation, amount_minor, currency, actor_id, created_at
      FROM bot_wallet_audit WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20`, [userId]);
    return result.rows.map((row) => ({ operation: row.operation, amount: Number(row.amount_minor) / 100,
      currency: row.currency, actorId: Number(row.actor_id), createdAt: row.created_at }));
  }

  async changeBalance(admin: DashboardUser, userId: number, input: { operation: "SIMULATION_CREDIT" | "ASSIGNED_SET"; amount: unknown; currency?: unknown; requestKey: string }): Promise<void> {
    if (admin.role !== "ADMIN") throw new Error("ბალანსს მხოლოდ ადმინისტრატორი მართავს");
    const amount = moneyMinor(input.amount, input.operation === "ASSIGNED_SET");
    const currency = input.operation === "SIMULATION_CREDIT" ? "USDT" : fiatCurrency(input.currency);
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestKey)) throw new Error("დარიცხვის უნიკალური კოდი არასწორია");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureWallet(userId, client);
      const wallet = (await client.query("SELECT * FROM bot_user_wallets WHERE user_id = $1 FOR UPDATE", [userId])).rows[0]!;
      const previous = await client.query("SELECT user_id, operation, amount_minor, currency FROM bot_wallet_audit WHERE request_key = $1", [input.requestKey]);
      if (previous.rows[0]) {
        const row = previous.rows[0];
        if (Number(row.user_id) !== userId || row.operation !== input.operation || Number(row.amount_minor) !== amount || row.currency !== currency) throw new Error("დარიცხვის კოდი უკვე გამოყენებულია სხვა მოთხოვნისთვის");
      } else {
        if (input.operation === "SIMULATION_CREDIT") {
          if (Number(wallet.simulation_credit_minor) + amount > 1_000_000_000_000) throw new Error("სატესტო თანხა დასაშვებ დიაპაზონს სცდება");
          await client.query("UPDATE bot_user_wallets SET simulation_credit_minor = simulation_credit_minor + $1, updated_at = NOW() WHERE user_id = $2", [amount, userId]);
        } else await client.query("UPDATE bot_user_wallets SET assigned_minor = $1, assigned_currency = $2, updated_at = NOW() WHERE user_id = $3", [amount, currency, userId]);
        await client.query(`INSERT INTO bot_wallet_audit (user_id, actor_id, operation, amount_minor, currency, previous_minor, request_key)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`, [userId, admin.id, input.operation, amount, currency,
          input.operation === "SIMULATION_CREDIT" ? wallet.simulation_credit_minor : wallet.assigned_minor, input.requestKey]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
