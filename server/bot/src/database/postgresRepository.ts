import { Pool, type PoolClient } from "pg";
import type { AccountBalance, BinanceConnectionState, ExecutedLevelRecord, MarketState, OrderRecord, StrategyConfig, StrategyRecord, StrategyTemplateRecord } from "../types/strategy.js";
import type { StrategyStore } from "./repository.js";
import type { SymbolRules } from "../binance/binanceService.js";

type PgStrategyRow = {
  id: number; symbol: string; initial_entry_price: string; total_budget: string; initial_purchase_amount: string; final_reserve_percent: string; total_invested: string;
  base_asset: string; quote_asset: string;
  total_purchased_quantity: string; cycle_purchased_quantity: string; total_asset_quantity: string; total_sold_quantity: string;
  total_sale_proceeds: string; realized_profit: string; withdrawn_profit: string; remaining_cost_basis: string;
  average_entry_price: string; status: StrategyRecord["status"];
  execution_environment: StrategyRecord["executionEnvironment"];
  created_at: Date; updated_at: Date;
};

export class PostgresStrategyRepository implements StrategyStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5 });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bot_strategies (
        id BIGSERIAL PRIMARY KEY, symbol TEXT NOT NULL, base_asset TEXT NOT NULL DEFAULT '',
        quote_asset TEXT NOT NULL DEFAULT 'USDT',
        execution_environment TEXT NOT NULL DEFAULT 'SIMULATION', initial_entry_price NUMERIC NOT NULL,
        total_budget NUMERIC NOT NULL, initial_purchase_amount NUMERIC NOT NULL DEFAULT 0,
        final_reserve_percent NUMERIC NOT NULL DEFAULT 10,
        total_invested NUMERIC NOT NULL DEFAULT 0,
        total_purchased_quantity NUMERIC NOT NULL DEFAULT 0, cycle_purchased_quantity NUMERIC NOT NULL DEFAULT 0,
        total_asset_quantity NUMERIC NOT NULL DEFAULT 0,
        total_sold_quantity NUMERIC NOT NULL DEFAULT 0, total_sale_proceeds NUMERIC NOT NULL DEFAULT 0,
        realized_profit NUMERIC NOT NULL DEFAULT 0, withdrawn_profit NUMERIC NOT NULL DEFAULT 0,
        remaining_cost_basis NUMERIC NOT NULL DEFAULT 0,
        average_entry_price NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_orders (
        id BIGSERIAL PRIMARY KEY, strategy_id BIGINT NOT NULL REFERENCES bot_strategies(id),
        external_order_id TEXT NOT NULL, side TEXT NOT NULL, level_percent NUMERIC NOT NULL,
        market_price NUMERIC NOT NULL, quote_amount NUMERIC NOT NULL, asset_quantity NUMERIC NOT NULL,
        mode TEXT NOT NULL, execution_environment TEXT NOT NULL DEFAULT 'SIMULATION', created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_executed_levels (
        id BIGSERIAL PRIMARY KEY, strategy_id BIGINT NOT NULL REFERENCES bot_strategies(id),
        side TEXT NOT NULL, level_percent NUMERIC NOT NULL, trigger_price NUMERIC NOT NULL,
        status TEXT NOT NULL DEFAULT 'WAITING', error_message TEXT, executed_at TIMESTAMPTZ,
        allocation_percent NUMERIC NOT NULL DEFAULT 0, client_order_id TEXT,
        execution_started_at TIMESTAMPTZ,
        UNIQUE(strategy_id, side, level_percent)
      );
      CREATE TABLE IF NOT EXISTS bot_market_state (
        symbol TEXT PRIMARY KEY, price NUMERIC NOT NULL, event_time TIMESTAMPTZ NOT NULL,
        source TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_symbol_rules (
        symbol TEXT PRIMARY KEY, base_asset TEXT NOT NULL, quote_asset TEXT NOT NULL,
        min_qty TEXT NOT NULL, step_size TEXT NOT NULL, tick_size TEXT NOT NULL,
        min_notional TEXT NOT NULL, status TEXT NOT NULL, fetched_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_account_balances (
        asset TEXT PRIMARY KEY, free TEXT NOT NULL, locked TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_binance_connection_state (
        id INTEGER PRIMARY KEY CHECK (id = 1), status TEXT NOT NULL,
        message TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_strategy_templates (
        id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        buy_levels_json JSONB NOT NULL, sell_levels_json JSONB NOT NULL,
        final_reserve_percent NUMERIC NOT NULL DEFAULT 10,
        created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
      );
    `);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS execution_environment TEXT NOT NULL DEFAULT 'SIMULATION'`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS base_asset TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS quote_asset TEXT NOT NULL DEFAULT 'USDT'`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS final_reserve_percent NUMERIC NOT NULL DEFAULT 10`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS initial_purchase_amount NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS total_purchased_quantity NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS cycle_purchased_quantity NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS total_sold_quantity NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS total_sale_proceeds NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS realized_profit NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS withdrawn_profit NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_strategies ADD COLUMN IF NOT EXISTS remaining_cost_basis NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_orders ADD COLUMN IF NOT EXISTS execution_environment TEXT NOT NULL DEFAULT 'SIMULATION'`);
    await this.pool.query(`ALTER TABLE bot_executed_levels ADD COLUMN IF NOT EXISTS allocation_percent NUMERIC NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE bot_executed_levels ADD COLUMN IF NOT EXISTS client_order_id TEXT`);
    await this.pool.query(`ALTER TABLE bot_executed_levels ADD COLUMN IF NOT EXISTS execution_started_at TIMESTAMPTZ`);
    await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS bot_orders_external_order_unique
      ON bot_orders (execution_environment, external_order_id)`);
    await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS bot_levels_client_order_unique
      ON bot_executed_levels (client_order_id) WHERE client_order_id IS NOT NULL`);
    await this.pool.query(`UPDATE bot_strategies SET quote_asset = 'USDT' WHERE quote_asset = ''`);
    await this.pool.query(`UPDATE bot_strategies SET base_asset = LEFT(symbol, LENGTH(symbol) - 4)
      WHERE base_asset = '' AND symbol LIKE '%USDT'`);
    await this.pool.query(`UPDATE bot_strategies SET total_purchased_quantity = total_asset_quantity
      WHERE total_purchased_quantity = 0 AND total_asset_quantity > 0`);
    await this.pool.query(`UPDATE bot_strategies SET cycle_purchased_quantity = total_purchased_quantity
      WHERE cycle_purchased_quantity = 0 AND total_purchased_quantity > 0
        AND EXISTS (SELECT 1 FROM bot_executed_levels
          WHERE bot_executed_levels.strategy_id = bot_strategies.id AND side = 'SELL' AND status <> 'EXECUTED')`);
    await this.pool.query(`UPDATE bot_executed_levels SET status = 'WAITING', executed_at = NULL,
      error_message = NULL, client_order_id = NULL, execution_started_at = NULL
      WHERE side = 'BUY' AND strategy_id IN (
        SELECT bot_strategies.id FROM bot_strategies
        WHERE EXISTS (SELECT 1 FROM bot_executed_levels AS sells
          WHERE sells.strategy_id = bot_strategies.id AND sells.side = 'SELL')
          AND NOT EXISTS (SELECT 1 FROM bot_executed_levels AS pending_sells
            WHERE pending_sells.strategy_id = bot_strategies.id AND pending_sells.side = 'SELL'
              AND pending_sells.status <> 'EXECUTED')
      )`);
    await this.pool.query(`UPDATE bot_strategies SET remaining_cost_basis = average_entry_price * total_asset_quantity
      WHERE remaining_cost_basis = 0 AND total_asset_quantity > 0`);
    await this.pool.query(`UPDATE bot_executed_levels SET allocation_percent = CASE level_percent
      WHEN 15 THEN 10 WHEN 25 THEN 20 WHEN 40 THEN 30 WHEN 60 THEN 40 ELSE allocation_percent END
      WHERE side = 'BUY' AND allocation_percent = 0`);
  }

  async findOrCreate(config: StrategyConfig): Promise<StrategyRecord> {
    const existing = await this.pool.query<PgStrategyRow>(`SELECT * FROM bot_strategies
      WHERE symbol = $1 AND execution_environment = $2 AND status IN ('ACTIVE', 'PAUSED')
      ORDER BY id DESC LIMIT 1`, [config.symbol, config.executionEnvironment]);
    if (existing.rows[0]) {
      const strategy = this.map(existing.rows[0]);
      if (strategy.initialEntryPrice !== config.initialEntryPrice || strategy.totalBudget !== config.totalBudget) {
        throw new Error(`Active ${config.symbol} strategy does not match the configured entry price or budget`);
      }
      return strategy;
    }
    const now = new Date();
    const result = await this.pool.query<PgStrategyRow>(`INSERT INTO bot_strategies
      (symbol, base_asset, quote_asset, execution_environment, initial_entry_price, total_budget,
        initial_purchase_amount, final_reserve_percent, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *`,
      [config.symbol, config.baseAsset, config.quoteAsset, config.executionEnvironment,
        config.initialEntryPrice, config.totalBudget, config.initialPurchaseAmount ?? 0, config.finalReservePercent, now]);
    return this.map(result.rows[0]!);
  }

  async createStrategy(config: StrategyConfig): Promise<StrategyRecord> {
    const now = new Date();
    const result = await this.pool.query<PgStrategyRow>(`INSERT INTO bot_strategies
      (symbol, base_asset, quote_asset, execution_environment, initial_entry_price, total_budget,
        initial_purchase_amount, final_reserve_percent, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *`,
    [config.symbol, config.baseAsset, config.quoteAsset, config.executionEnvironment,
      config.initialEntryPrice, config.totalBudget, config.initialPurchaseAmount ?? 0, config.finalReservePercent, now]);
    const strategy = this.map(result.rows[0]!);
    await this.initializeBuyLevels(strategy.id, config);
    return strategy;
  }

  async listStrategies(): Promise<StrategyRecord[]> {
    const result = await this.pool.query<PgStrategyRow>(`SELECT * FROM bot_strategies
      WHERE status IN ('ACTIVE', 'PAUSED') ORDER BY created_at DESC`);
    return result.rows.map((row) => this.map(row));
  }

  async listArchivedStrategies(): Promise<StrategyRecord[]> {
    const result = await this.pool.query<PgStrategyRow>(`SELECT * FROM bot_strategies
      WHERE status = 'COMPLETED' ORDER BY updated_at DESC`);
    return result.rows.map((row) => this.map(row));
  }

  async updateStrategy(id: number, config: StrategyConfig): Promise<StrategyRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query<PgStrategyRow>("SELECT * FROM bot_strategies WHERE id = $1 FOR UPDATE", [id]);
      const current = currentResult.rows[0];
      if (!current) throw new Error(`Strategy ${id} not found`);
      if (current.status !== "PAUSED") throw new Error("რედაქტირებამდე სტრატეგია უნდა შეაჩერო");
      const orders = await client.query("SELECT 1 FROM bot_orders WHERE strategy_id = $1 LIMIT 1", [id]);
      if (orders.rows[0]) throw new Error("შესრულებული ორდერების მქონე სტრატეგია ვერ დარედაქტირდება; ჯერ გაანულე");
      const touched = await client.query("SELECT 1 FROM bot_executed_levels WHERE strategy_id = $1 AND status <> 'WAITING' LIMIT 1", [id]);
      if (touched.rows[0]) throw new Error("დაწყებული დონეების მქონე სტრატეგია ვერ დარედაქტირდება; ჯერ გაანულე");
      await client.query(`UPDATE bot_strategies SET symbol = $1, base_asset = $2, quote_asset = $3,
        initial_entry_price = $4, total_budget = $5, initial_purchase_amount = $6, final_reserve_percent = $7,
        updated_at = NOW() WHERE id = $8`,
      [config.symbol, config.baseAsset, config.quoteAsset, config.initialEntryPrice,
        config.totalBudget, config.initialPurchaseAmount ?? 0, config.finalReservePercent, id]);
      await client.query("DELETE FROM bot_executed_levels WHERE strategy_id = $1", [id]);
      for (const level of config.buyLevels) {
        await client.query(`INSERT INTO bot_executed_levels
          (strategy_id, side, level_percent, trigger_price, allocation_percent)
          VALUES ($1, 'BUY', $2, $3, $4)`,
        [id, level.dropPercent, config.initialEntryPrice * (1 - level.dropPercent / 100), level.budgetPercent]);
      }
      for (const level of config.sellLevels) {
        await client.query(`INSERT INTO bot_executed_levels
          (strategy_id, side, level_percent, trigger_price, allocation_percent)
          VALUES ($1, 'SELL', $2, $3, $4)`,
        [id, level.gainPercent, config.initialEntryPrice * (1 + level.gainPercent / 100), level.allocationPercent]);
      }
      await client.query("COMMIT");
      return this.getById(id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setStrategyStatus(id: number, status: "ACTIVE" | "PAUSED"): Promise<StrategyRecord> {
    const result = await this.pool.query(`UPDATE bot_strategies SET status = $1, updated_at = NOW()
      WHERE id = $2 AND status IN ('ACTIVE', 'PAUSED')`, [status, id]);
    if (result.rowCount !== 1) throw new Error(`Strategy ${id} is not active or paused`);
    return this.getById(id);
  }

  async archiveStrategy(id: number): Promise<StrategyRecord> {
    const result = await this.pool.query(`UPDATE bot_strategies SET status = 'COMPLETED', updated_at = NOW()
      WHERE id = $1 AND status IN ('ACTIVE', 'PAUSED')`, [id]);
    if (result.rowCount !== 1) throw new Error(`Strategy ${id} is not active or paused`);
    return this.getById(id);
  }

  async resetSimulationStrategyById(id: number): Promise<StrategyRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query<PgStrategyRow>("SELECT * FROM bot_strategies WHERE id = $1 FOR UPDATE", [id]);
      const current = currentResult.rows[0];
      if (!current) throw new Error(`Strategy ${id} not found`);
      if (current.execution_environment !== "SIMULATION") throw new Error("მხოლოდ SIMULATION სტრატეგიის განულებაა შესაძლებელი");
      if (!["ACTIVE", "PAUSED"].includes(current.status)) throw new Error(`Strategy ${id} is already archived`);
      await client.query("UPDATE bot_strategies SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1", [id]);
      const created = await client.query<PgStrategyRow>(`INSERT INTO bot_strategies
        (symbol, base_asset, quote_asset, execution_environment, initial_entry_price,
          total_budget, initial_purchase_amount, final_reserve_percent, created_at, updated_at)
        VALUES ($1, $2, $3, 'SIMULATION', $4, $5, $6, $7, NOW(), NOW()) RETURNING *`,
      [current.symbol, current.base_asset, current.quote_asset, current.initial_entry_price,
        current.total_budget, current.initial_purchase_amount, current.final_reserve_percent]);
      const fresh = created.rows[0]!;
      await client.query(`INSERT INTO bot_executed_levels
        (strategy_id, side, level_percent, trigger_price, allocation_percent)
        SELECT $1, side, level_percent, trigger_price, allocation_percent
        FROM bot_executed_levels WHERE strategy_id = $2`, [fresh.id, id]);
      await client.query("COMMIT");
      return this.map(fresh);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listStrategyTemplates(): Promise<StrategyTemplateRecord[]> {
    const result = await this.pool.query(`SELECT id, name, buy_levels_json, sell_levels_json,
      final_reserve_percent::float8 AS final_reserve_percent, created_at
      FROM bot_strategy_templates ORDER BY name`);
    return result.rows.map((row) => ({
      id: Number(row.id), name: row.name, buyLevels: row.buy_levels_json,
      sellLevels: row.sell_levels_json, finalReservePercent: row.final_reserve_percent,
      builtIn: false, createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async createStrategyTemplate(template: Omit<StrategyTemplateRecord, "id" | "builtIn" | "createdAt">): Promise<StrategyTemplateRecord> {
    const now = new Date();
    const result = await this.pool.query(`INSERT INTO bot_strategy_templates
      (name, buy_levels_json, sell_levels_json, final_reserve_percent, created_at, updated_at)
      VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $5) RETURNING id`,
    [template.name, JSON.stringify(template.buyLevels), JSON.stringify(template.sellLevels),
      template.finalReservePercent, now]);
    return { ...template, id: Number(result.rows[0].id), builtIn: false, createdAt: now.toISOString() };
  }

  async deleteStrategyTemplate(id: number): Promise<void> {
    const result = await this.pool.query("DELETE FROM bot_strategy_templates WHERE id = $1", [id]);
    if (result.rowCount !== 1) throw new Error("შაბლონი ვერ მოიძებნა");
  }

  async getById(id: number, client: Pool | PoolClient = this.pool): Promise<StrategyRecord> {
    const result = await client.query<PgStrategyRow>("SELECT * FROM bot_strategies WHERE id = $1", [id]);
    if (!result.rows[0]) throw new Error(`Strategy ${id} not found`);
    return this.map(result.rows[0]);
  }

  async initializeBuyLevels(strategyId: number, config: StrategyConfig): Promise<void> {
    for (const level of config.buyLevels) {
      await this.pool.query(`INSERT INTO bot_executed_levels
        (strategy_id, side, level_percent, trigger_price, allocation_percent)
        VALUES ($1, 'BUY', $2, $3, $4) ON CONFLICT (strategy_id, side, level_percent) DO NOTHING`,
      [strategyId, level.dropPercent, config.initialEntryPrice * (1 - level.dropPercent / 100), level.budgetPercent]);
    }
    for (const level of config.sellLevels) {
      await this.pool.query(`INSERT INTO bot_executed_levels
        (strategy_id, side, level_percent, trigger_price, allocation_percent)
        VALUES ($1, 'SELL', $2, $3, $4) ON CONFLICT (strategy_id, side, level_percent) DO NOTHING`,
      [strategyId, level.gainPercent, config.initialEntryPrice * (1 + level.gainPercent / 100), level.allocationPercent]);
    }
  }

  async getLevels(strategyId: number): Promise<ExecutedLevelRecord[]> {
    const result = await this.pool.query(`SELECT id, strategy_id AS "strategyId", side,
      level_percent::float8 AS "levelPercent", trigger_price::float8 AS "triggerPrice",
      allocation_percent::float8 AS "allocationPercent", status,
      error_message AS "errorMessage", executed_at AS "executedAt",
      client_order_id AS "clientOrderId", execution_started_at AS "executionStartedAt"
      FROM bot_executed_levels WHERE strategy_id = $1 ORDER BY side, level_percent`, [strategyId]);
    return result.rows;
  }

  async claimLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number, clientOrderId: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE bot_executed_levels SET status = 'EXECUTING', error_message = NULL,
      client_order_id = $4, execution_started_at = NOW()
      WHERE strategy_id = $1 AND side = $2 AND level_percent = $3
        AND (status = 'WAITING' OR (status = 'FAILED' AND error_message NOT LIKE '[NO_AUTO_RETRY]%'))`,
    [strategyId, side, levelPercent, clientOrderId]);
    return result.rowCount === 1;
  }

  async releaseLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number, clientOrderId: string): Promise<void> {
    await this.pool.query(`UPDATE bot_executed_levels SET status = 'WAITING', error_message = NULL,
      client_order_id = NULL, execution_started_at = NULL
      WHERE strategy_id = $1 AND side = $2 AND level_percent = $3 AND client_order_id = $4
        AND status IN ('EXECUTING', 'FAILED')`, [strategyId, side, levelPercent, clientOrderId]);
  }

  async completeBuy(strategyId: number, levelPercent: number, price: number, quoteAmount: number, assetQuantity: number, externalOrderId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<PgStrategyRow>("SELECT * FROM bot_strategies WHERE id = $1 FOR UPDATE", [strategyId]);
      if (!locked.rows[0]) throw new Error(`Strategy ${strategyId} not found`);
      const strategy = this.map(locked.rows[0]);
      const existing = await client.query("SELECT 1 FROM bot_orders WHERE execution_environment = $1 AND external_order_id = $2",
        [strategy.executionEnvironment, externalOrderId]);
      if (existing.rows[0]) {
        await client.query(`UPDATE bot_executed_levels SET status = 'EXECUTED', executed_at = COALESCE(executed_at, NOW()), error_message = NULL
          WHERE strategy_id = $1 AND side = 'BUY' AND level_percent = $2`, [strategyId, levelPercent]);
        await client.query("COMMIT");
        return;
      }
      const totalInvested = strategy.totalInvested + quoteAmount;
      const totalPurchasedQuantity = strategy.totalPurchasedQuantity + assetQuantity;
      const cyclePurchasedQuantity = strategy.cyclePurchasedQuantity + assetQuantity;
      const totalAssetQuantity = strategy.totalAssetQuantity + assetQuantity;
      const remainingCostBasis = strategy.remainingCostBasis + quoteAmount;
      const averageEntryPrice = remainingCostBasis / totalAssetQuantity;
      const now = new Date();
      await client.query(`UPDATE bot_strategies SET total_invested = $1, total_purchased_quantity = $2,
        cycle_purchased_quantity = $3, total_asset_quantity = $4, remaining_cost_basis = $5, average_entry_price = $6,
        updated_at = $7 WHERE id = $8`,
      [totalInvested, totalPurchasedQuantity, cyclePurchasedQuantity, totalAssetQuantity, remainingCostBasis, averageEntryPrice, now, strategyId]);
      await client.query(`INSERT INTO bot_orders (strategy_id, external_order_id, side, level_percent,
        market_price, quote_amount, asset_quantity, mode, execution_environment, created_at)
        VALUES ($1, $2, 'BUY', $3, $4, $5, $6, $7, $7, $8)`,
      [strategyId, externalOrderId, levelPercent, price, quoteAmount, assetQuantity, strategy.executionEnvironment, now]);
      await client.query(`UPDATE bot_executed_levels SET status = 'EXECUTED', executed_at = $1, error_message = NULL
        WHERE strategy_id = $2 AND side = 'BUY' AND level_percent = $3 AND status IN ('EXECUTING', 'FAILED')`,
      [now, strategyId, levelPercent]);
      const sellState = await client.query<{ total: number; executed: number }>(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'EXECUTED')::int AS executed
        FROM bot_executed_levels WHERE strategy_id = $1 AND side = 'SELL'`, [strategyId]);
      if (sellState.rows[0]!.total > 0 && sellState.rows[0]!.executed === sellState.rows[0]!.total) {
        await client.query(`UPDATE bot_executed_levels SET status = 'WAITING', executed_at = NULL,
          error_message = NULL, client_order_id = NULL, execution_started_at = NULL
          WHERE strategy_id = $1 AND side = 'SELL'`, [strategyId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeSell(strategyId: number, levelPercent: number, price: number, quoteAmount: number, assetQuantity: number, minimumReserveQuantity: number, externalOrderId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PgStrategyRow>("SELECT * FROM bot_strategies WHERE id = $1 FOR UPDATE", [strategyId]);
      const row = result.rows[0];
      if (!row) throw new Error(`Strategy ${strategyId} not found`);
      const strategy = this.map(row);
      const existing = await client.query("SELECT 1 FROM bot_orders WHERE execution_environment = $1 AND external_order_id = $2",
        [strategy.executionEnvironment, externalOrderId]);
      if (existing.rows[0]) {
        await client.query(`UPDATE bot_executed_levels SET status = 'EXECUTED', executed_at = COALESCE(executed_at, NOW()), error_message = NULL
          WHERE strategy_id = $1 AND side = 'SELL' AND level_percent = $2`, [strategyId, levelPercent]);
        await client.query("COMMIT");
        return;
      }
      if (assetQuantity > strategy.totalAssetQuantity + 1e-12) throw new Error("Cannot sell more asset than the strategy owns");
      const remainingQuantity = Math.max(0, strategy.totalAssetQuantity - assetQuantity);
      if (remainingQuantity + 1e-12 < minimumReserveQuantity) throw new Error("Sell would consume the permanent reserve");
      const costBasisSold = assetQuantity * strategy.averageEntryPrice;
      const remainingCostBasis = Math.max(0, strategy.remainingCostBasis - costBasisSold);
      const averageEntryPrice = remainingQuantity <= 1e-12 ? 0 : remainingCostBasis / remainingQuantity;
      const now = new Date();
      await client.query(`UPDATE bot_strategies SET total_asset_quantity = $1,
        total_sold_quantity = total_sold_quantity + $2, total_sale_proceeds = total_sale_proceeds + $3,
        realized_profit = realized_profit + $4, remaining_cost_basis = $5,
        average_entry_price = $6, updated_at = $7 WHERE id = $8`,
      [remainingQuantity, assetQuantity, quoteAmount, quoteAmount - costBasisSold,
        remainingCostBasis, averageEntryPrice, now, strategyId]);
      await client.query(`INSERT INTO bot_orders (strategy_id, external_order_id, side, level_percent,
        market_price, quote_amount, asset_quantity, mode, execution_environment, created_at)
        VALUES ($1, $2, 'SELL', $3, $4, $5, $6, $7, $7, $8)`,
      [strategyId, externalOrderId, levelPercent, price, quoteAmount, assetQuantity, strategy.executionEnvironment, now]);
      await client.query(`UPDATE bot_executed_levels SET status = 'EXECUTED', executed_at = $1, error_message = NULL
        WHERE strategy_id = $2 AND side = 'SELL' AND level_percent = $3 AND status IN ('EXECUTING', 'FAILED')`,
      [now, strategyId, levelPercent]);
      const remainingSells = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count
        FROM bot_executed_levels WHERE strategy_id = $1 AND side = 'SELL' AND status <> 'EXECUTED'`, [strategyId]);
      if (remainingSells.rows[0]!.count === 0) {
        await client.query(`UPDATE bot_executed_levels SET status = 'WAITING', executed_at = NULL,
          error_message = NULL, client_order_id = NULL, execution_started_at = NULL
          WHERE strategy_id = $1 AND side = 'BUY'`, [strategyId]);
        await client.query(`UPDATE bot_strategies SET cycle_purchased_quantity = 0 WHERE id = $1`, [strategyId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async withdrawProfit(strategyId: number, price: number, quoteAmount: number, assetQuantity: number, minimumReserveQuantity: number, externalOrderId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PgStrategyRow>("SELECT * FROM bot_strategies WHERE id = $1 FOR UPDATE", [strategyId]);
      const row = result.rows[0];
      if (!row) throw new Error(`Strategy ${strategyId} not found`);
      const strategy = this.map(row);
      const existing = await client.query("SELECT 1 FROM bot_orders WHERE execution_environment = $1 AND external_order_id = $2",
        [strategy.executionEnvironment, externalOrderId]);
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return;
      }
      const remainingQuantity = strategy.totalAssetQuantity - assetQuantity;
      if (assetQuantity <= 0 || remainingQuantity + 1e-12 < minimumReserveQuantity) {
        throw new Error("მოგების აღება მუდმივ რეზერვს შეამცირებს");
      }
      const costBasisSold = assetQuantity * strategy.averageEntryPrice;
      const remainingCostBasis = Math.max(0, strategy.remainingCostBasis - costBasisSold);
      const averageEntryPrice = remainingQuantity <= 1e-12 ? 0 : remainingCostBasis / remainingQuantity;
      const now = new Date();
      await client.query(`UPDATE bot_strategies SET total_asset_quantity = $1,
        total_sold_quantity = total_sold_quantity + $2, total_sale_proceeds = total_sale_proceeds + $3,
        realized_profit = realized_profit + $4, withdrawn_profit = withdrawn_profit + $3,
        remaining_cost_basis = $5, average_entry_price = $6, updated_at = $7 WHERE id = $8`,
      [remainingQuantity, assetQuantity, quoteAmount, quoteAmount - costBasisSold,
        remainingCostBasis, averageEntryPrice, now, strategyId]);
      await client.query(`INSERT INTO bot_orders (strategy_id, external_order_id, side, level_percent,
        market_price, quote_amount, asset_quantity, mode, execution_environment, created_at)
        VALUES ($1, $2, 'SELL', 0, $3, $4, $5, $6, $6, $7)`,
      [strategyId, externalOrderId, price, quoteAmount, assetQuantity, strategy.executionEnvironment, now]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Unknown order error";
    await this.pool.query(`UPDATE bot_executed_levels SET status = 'FAILED', error_message = $1
      WHERE strategy_id = $2 AND side = $3 AND level_percent = $4 AND status = 'EXECUTING'`,
    [message.slice(0, 500), strategyId, side, levelPercent]);
  }

  async countOrders(strategyId: number): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM bot_orders WHERE strategy_id = $1", [strategyId]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async getOrders(strategyId: number): Promise<OrderRecord[]> {
    const result = await this.pool.query(`SELECT id, side, level_percent::float8 AS "levelPercent",
      market_price::float8 AS "marketPrice", quote_amount::float8 AS "quoteAmount",
      asset_quantity::float8 AS "assetQuantity", execution_environment AS "executionEnvironment",
      created_at AS "createdAt"
      FROM bot_orders WHERE strategy_id = $1 ORDER BY id DESC`, [strategyId]);
    return result.rows;
  }

  async updateMarketPrice(symbol: string, price: number, eventTime: Date): Promise<void> {
    await this.pool.query(`INSERT INTO bot_market_state (symbol, price, event_time, source, updated_at)
      VALUES ($1, $2, $3, 'BINANCE_WEBSOCKET', NOW())
      ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, event_time = EXCLUDED.event_time,
      source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`, [symbol, price, eventTime]);
  }

  async getMarketState(symbol: string): Promise<MarketState | null> {
    const result = await this.pool.query(`SELECT symbol, price::float8 AS price,
      event_time AS "eventTime", source, updated_at AS "updatedAt"
      FROM bot_market_state WHERE symbol = $1`, [symbol]);
    const row = result.rows[0];
    if (!row) return null;
    return { ...row, eventTime: new Date(row.eventTime).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() };
  }

  async saveSymbolRules(rules: SymbolRules): Promise<void> {
    await this.pool.query(`INSERT INTO bot_symbol_rules (symbol, base_asset, quote_asset, min_qty,
      step_size, tick_size, min_notional, status, fetched_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (symbol) DO UPDATE SET base_asset = EXCLUDED.base_asset, quote_asset = EXCLUDED.quote_asset,
      min_qty = EXCLUDED.min_qty, step_size = EXCLUDED.step_size, tick_size = EXCLUDED.tick_size,
      min_notional = EXCLUDED.min_notional, status = EXCLUDED.status, fetched_at = EXCLUDED.fetched_at`,
    [rules.symbol, rules.baseAsset, rules.quoteAsset, rules.minQty, rules.stepSize,
      rules.tickSize, rules.minNotional, rules.status, rules.fetchedAt]);
  }

  async getSymbolRules(symbol: string): Promise<SymbolRules | null> {
    const result = await this.pool.query(`SELECT symbol, base_asset AS "baseAsset", quote_asset AS "quoteAsset",
      min_qty AS "minQty", step_size AS "stepSize", tick_size AS "tickSize",
      min_notional AS "minNotional", status, fetched_at AS "fetchedAt"
      FROM bot_symbol_rules WHERE symbol = $1`, [symbol]);
    const row = result.rows[0];
    return row ? { ...row, fetchedAt: new Date(row.fetchedAt).toISOString() } : null;
  }

  async saveAccountBalances(balances: AccountBalance[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const balance of balances) {
        await client.query(`INSERT INTO bot_account_balances (asset, free, locked, updated_at)
          VALUES ($1, $2, $3, $4) ON CONFLICT (asset) DO UPDATE SET free = EXCLUDED.free,
          locked = EXCLUDED.locked, updated_at = EXCLUDED.updated_at`,
        [balance.asset, balance.free, balance.locked, balance.updatedAt]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAccountBalances(assets: string[]): Promise<AccountBalance[]> {
    if (assets.length === 0) return [];
    const result = await this.pool.query(`SELECT asset, free, locked, updated_at AS "updatedAt"
      FROM bot_account_balances WHERE asset = ANY($1::text[]) ORDER BY asset`, [assets]);
    return result.rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() }));
  }

  async saveBinanceConnectionState(state: BinanceConnectionState): Promise<void> {
    await this.pool.query(`INSERT INTO bot_binance_connection_state (id, status, message, updated_at)
      VALUES (1, $1, $2, $3) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
      message = EXCLUDED.message, updated_at = EXCLUDED.updated_at`,
    [state.status, state.message, state.updatedAt]);
  }

  async getBinanceConnectionState(): Promise<BinanceConnectionState | null> {
    const result = await this.pool.query(`SELECT status, message, updated_at AS "updatedAt"
      FROM bot_binance_connection_state WHERE id = 1`);
    const row = result.rows[0];
    return row ? { ...row, updatedAt: new Date(row.updatedAt).toISOString() } : null;
  }

  async resetSimulationStrategy(symbol: string): Promise<number> {
    const result = await this.pool.query(`UPDATE bot_strategies SET status = 'COMPLETED', updated_at = NOW()
      WHERE symbol = $1 AND execution_environment = 'SIMULATION' AND status IN ('ACTIVE', 'PAUSED')`, [symbol]);
    return result.rowCount ?? 0;
  }

  async close(): Promise<void> { await this.pool.end(); }

  private map(row: PgStrategyRow): StrategyRecord {
    return {
      id: Number(row.id), symbol: row.symbol, baseAsset: row.base_asset, quoteAsset: row.quote_asset,
      executionEnvironment: row.execution_environment,
      initialEntryPrice: Number(row.initial_entry_price),
      totalBudget: Number(row.total_budget), initialPurchaseAmount: Number(row.initial_purchase_amount),
      finalReservePercent: Number(row.final_reserve_percent),
      totalInvested: Number(row.total_invested),
      totalPurchasedQuantity: Number(row.total_purchased_quantity),
      cyclePurchasedQuantity: Number(row.cycle_purchased_quantity ?? 0),
      totalAssetQuantity: Number(row.total_asset_quantity), totalSoldQuantity: Number(row.total_sold_quantity),
      totalSaleProceeds: Number(row.total_sale_proceeds), realizedProfit: Number(row.realized_profit),
      withdrawnProfit: Number(row.withdrawn_profit ?? 0),
      remainingCostBasis: Number(row.remaining_cost_basis), averageEntryPrice: Number(row.average_entry_price),
      status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    };
  }
}
