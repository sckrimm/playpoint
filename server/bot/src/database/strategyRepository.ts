import type Database from "better-sqlite3";
import type { AccountBalance, BinanceConnectionState, ExecutedLevelRecord, MarketState, OrderRecord, StrategyConfig, StrategyRecord, StrategyTemplateRecord } from "../types/strategy.js";
import type { StrategyStore } from "./repository.js";
import type { SymbolRules } from "../binance/binanceService.js";

type StrategyRow = {
  id: number; symbol: string; initial_entry_price: number; total_budget: number; initial_purchase_amount: number; final_reserve_percent: number; total_invested: number;
  base_asset: string; quote_asset: string;
  total_purchased_quantity: number; cycle_purchased_quantity: number; total_asset_quantity: number; total_sold_quantity: number;
  total_sale_proceeds: number; realized_profit: number; withdrawn_profit: number; remaining_cost_basis: number;
  average_entry_price: number; status: StrategyRecord["status"];
  execution_environment: StrategyRecord["executionEnvironment"];
  created_at: string; updated_at: string;
};

export class StrategyRepository implements StrategyStore {
  constructor(private readonly db: Database.Database) {}

  async initialize(): Promise<void> {}

  async findOrCreate(config: StrategyConfig): Promise<StrategyRecord> {
    const existing = this.db.prepare(`SELECT * FROM strategies WHERE symbol = ? AND execution_environment = ?
      AND status IN ('ACTIVE', 'PAUSED') ORDER BY id DESC LIMIT 1`)
      .get(config.symbol, config.executionEnvironment) as StrategyRow | undefined;
    if (existing) {
      if (existing.initial_entry_price !== config.initialEntryPrice || existing.total_budget !== config.totalBudget) {
        throw new Error(`Active ${config.symbol} strategy does not match the configured entry price or budget`);
      }
      return this.map(existing);
    }
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO strategies (symbol, base_asset, quote_asset, execution_environment,
        initial_entry_price, total_budget, initial_purchase_amount, final_reserve_percent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(config.symbol, config.baseAsset, config.quoteAsset, config.executionEnvironment,
      config.initialEntryPrice, config.totalBudget, config.initialPurchaseAmount ?? 0, config.finalReservePercent, now, now);
    return this.getById(Number(result.lastInsertRowid));
  }

  async createStrategy(config: StrategyConfig): Promise<StrategyRecord> {
    const now = new Date().toISOString();
    const result = this.db.prepare(`INSERT INTO strategies
      (symbol, base_asset, quote_asset, execution_environment, initial_entry_price,
        total_budget, initial_purchase_amount, final_reserve_percent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(config.symbol, config.baseAsset, config.quoteAsset, config.executionEnvironment,
        config.initialEntryPrice, config.totalBudget, config.initialPurchaseAmount ?? 0, config.finalReservePercent, now, now);
    const strategy = await this.getById(Number(result.lastInsertRowid));
    await this.initializeBuyLevels(strategy.id, config);
    return strategy;
  }

  async listStrategies(): Promise<StrategyRecord[]> {
    const rows = this.db.prepare(`SELECT * FROM strategies WHERE status IN ('ACTIVE', 'PAUSED') ORDER BY created_at DESC`).all() as StrategyRow[];
    return rows.map((row) => this.map(row));
  }

  async listArchivedStrategies(): Promise<StrategyRecord[]> {
    const rows = this.db.prepare("SELECT * FROM strategies WHERE status = 'COMPLETED' ORDER BY updated_at DESC").all() as StrategyRow[];
    return rows.map((row) => this.map(row));
  }

  async updateStrategy(id: number, config: StrategyConfig): Promise<StrategyRecord> {
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(id) as StrategyRow | undefined;
      if (!current) throw new Error(`Strategy ${id} not found`);
      if (current.status !== "PAUSED") throw new Error("რედაქტირებამდე სტრატეგია უნდა შეაჩერო");
      const orderCount = (this.db.prepare("SELECT COUNT(*) AS count FROM orders WHERE strategy_id = ?").get(id) as { count: number }).count;
      if (orderCount > 0) throw new Error("შესრულებული ორდერების მქონე სტრატეგია ვერ დარედაქტირდება; ჯერ გაანულე");
      const touchedLevels = (this.db.prepare("SELECT COUNT(*) AS count FROM executed_levels WHERE strategy_id = ? AND status <> 'WAITING'").get(id) as { count: number }).count;
      if (touchedLevels > 0) throw new Error("დაწყებული დონეების მქონე სტრატეგია ვერ დარედაქტირდება; ჯერ გაანულე");
      this.db.prepare(`UPDATE strategies SET symbol = ?, base_asset = ?, quote_asset = ?,
        initial_entry_price = ?, total_budget = ?, initial_purchase_amount = ?, final_reserve_percent = ?, updated_at = ? WHERE id = ?`)
        .run(config.symbol, config.baseAsset, config.quoteAsset, config.initialEntryPrice,
          config.totalBudget, config.initialPurchaseAmount ?? 0, config.finalReservePercent, new Date().toISOString(), id);
      this.db.prepare("DELETE FROM executed_levels WHERE strategy_id = ?").run(id);
      const insert = this.db.prepare(`INSERT INTO executed_levels
        (strategy_id, side, level_percent, trigger_price, allocation_percent) VALUES (?, ?, ?, ?, ?)`);
      for (const level of config.buyLevels) insert.run(id, "BUY", level.dropPercent,
        config.initialEntryPrice * (1 - level.dropPercent / 100), level.budgetPercent);
      for (const level of config.sellLevels) insert.run(id, "SELL", level.gainPercent,
        config.initialEntryPrice * (1 + level.gainPercent / 100), level.allocationPercent);
    });
    transaction();
    return this.getById(id);
  }

  async setStrategyStatus(id: number, status: "ACTIVE" | "PAUSED"): Promise<StrategyRecord> {
    const result = this.db.prepare(`UPDATE strategies SET status = ?, updated_at = ?
      WHERE id = ? AND status IN ('ACTIVE', 'PAUSED')`).run(status, new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error(`Strategy ${id} is not active or paused`);
    return this.getById(id);
  }

  async archiveStrategy(id: number): Promise<StrategyRecord> {
    const result = this.db.prepare(`UPDATE strategies SET status = 'COMPLETED', updated_at = ?
      WHERE id = ? AND status IN ('ACTIVE', 'PAUSED')`).run(new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error(`Strategy ${id} is not active or paused`);
    return this.getById(id);
  }

  async resetSimulationStrategyById(id: number): Promise<StrategyRecord> {
    let newId = 0;
    this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(id) as StrategyRow | undefined;
      if (!current) throw new Error(`Strategy ${id} not found`);
      if (current.execution_environment !== "SIMULATION") throw new Error("მხოლოდ SIMULATION სტრატეგიის განულებაა შესაძლებელი");
      if (!["ACTIVE", "PAUSED"].includes(current.status)) throw new Error(`Strategy ${id} is already archived`);
      const now = new Date().toISOString();
      this.db.prepare("UPDATE strategies SET status = 'COMPLETED', updated_at = ? WHERE id = ?").run(now, id);
      const result = this.db.prepare(`INSERT INTO strategies
        (symbol, base_asset, quote_asset, execution_environment, initial_entry_price,
          total_budget, initial_purchase_amount, final_reserve_percent, created_at, updated_at)
        VALUES (?, ?, ?, 'SIMULATION', ?, ?, ?, ?, ?, ?)`)
        .run(current.symbol, current.base_asset, current.quote_asset, current.initial_entry_price,
          current.total_budget, current.initial_purchase_amount, current.final_reserve_percent, now, now);
      newId = Number(result.lastInsertRowid);
      this.db.prepare(`INSERT INTO executed_levels
        (strategy_id, side, level_percent, trigger_price, allocation_percent)
        SELECT ?, side, level_percent, trigger_price, allocation_percent
        FROM executed_levels WHERE strategy_id = ?`).run(newId, id);
    })();
    return this.getById(newId);
  }

  async listStrategyTemplates(): Promise<StrategyTemplateRecord[]> {
    const rows = this.db.prepare("SELECT * FROM strategy_templates ORDER BY name").all() as Array<{
      id: number; name: string; buy_levels_json: string; sell_levels_json: string;
      final_reserve_percent: number; created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id, name: row.name, buyLevels: JSON.parse(row.buy_levels_json),
      sellLevels: JSON.parse(row.sell_levels_json), finalReservePercent: row.final_reserve_percent,
      builtIn: false, createdAt: row.created_at,
    }));
  }

  async createStrategyTemplate(template: Omit<StrategyTemplateRecord, "id" | "builtIn" | "createdAt">): Promise<StrategyTemplateRecord> {
    const now = new Date().toISOString();
    const result = this.db.prepare(`INSERT INTO strategy_templates
      (name, buy_levels_json, sell_levels_json, final_reserve_percent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(template.name, JSON.stringify(template.buyLevels), JSON.stringify(template.sellLevels),
        template.finalReservePercent, now, now);
    return { ...template, id: Number(result.lastInsertRowid), builtIn: false, createdAt: now };
  }

  async deleteStrategyTemplate(id: number): Promise<void> {
    const result = this.db.prepare("DELETE FROM strategy_templates WHERE id = ?").run(id);
    if (result.changes !== 1) throw new Error("შაბლონი ვერ მოიძებნა");
  }

  async getById(id: number): Promise<StrategyRecord> {
    const row = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(id) as StrategyRow | undefined;
    if (!row) throw new Error(`Strategy ${id} not found`);
    return this.map(row);
  }

  async initializeBuyLevels(strategyId: number, config: StrategyConfig): Promise<void> {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO executed_levels
      (strategy_id, side, level_percent, trigger_price, allocation_percent) VALUES (?, ?, ?, ?, ?)`);
    const transaction = this.db.transaction(() => {
      for (const level of config.buyLevels) {
        insert.run(strategyId, "BUY", level.dropPercent,
          config.initialEntryPrice * (1 - level.dropPercent / 100), level.budgetPercent);
      }
      for (const level of config.sellLevels) {
        insert.run(strategyId, "SELL", level.gainPercent,
          config.initialEntryPrice * (1 + level.gainPercent / 100), level.allocationPercent);
      }
    });
    transaction();
  }

  async getLevels(strategyId: number): Promise<ExecutedLevelRecord[]> {
    return this.db.prepare(`SELECT id, strategy_id AS strategyId, side, level_percent AS levelPercent,
      trigger_price AS triggerPrice, allocation_percent AS allocationPercent, status,
      error_message AS errorMessage, executed_at AS executedAt,
      client_order_id AS clientOrderId, execution_started_at AS executionStartedAt
      FROM executed_levels WHERE strategy_id = ? ORDER BY side, level_percent`).all(strategyId) as ExecutedLevelRecord[];
  }

  async claimLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number, clientOrderId: string): Promise<boolean> {
    const result = this.db.prepare(`UPDATE executed_levels SET status = 'EXECUTING', error_message = NULL,
      client_order_id = ?, execution_started_at = ?
      WHERE strategy_id = ? AND side = ? AND level_percent = ?
        AND (status = 'WAITING' OR (status = 'FAILED' AND error_message NOT LIKE '[NO_AUTO_RETRY]%'))`)
      .run(clientOrderId, new Date().toISOString(), strategyId, side, levelPercent);
    return result.changes === 1;
  }

  async releaseLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number, clientOrderId: string): Promise<void> {
    this.db.prepare(`UPDATE executed_levels SET status = 'WAITING', error_message = NULL,
      client_order_id = NULL, execution_started_at = NULL
      WHERE strategy_id = ? AND side = ? AND level_percent = ? AND client_order_id = ?
        AND status IN ('EXECUTING', 'FAILED')`).run(strategyId, side, levelPercent, clientOrderId);
  }

  async completeBuy(strategyId: number, levelPercent: number, price: number, quoteAmount: number, assetQuantity: number, externalOrderId: string): Promise<void> {
    const transaction = this.db.transaction(() => {
      const strategy = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(strategyId) as StrategyRow | undefined;
      if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
      const existing = this.db.prepare("SELECT 1 FROM orders WHERE execution_environment = ? AND external_order_id = ?")
        .get(strategy.execution_environment, externalOrderId);
      if (existing) {
        this.db.prepare(`UPDATE executed_levels SET status = 'EXECUTED', executed_at = COALESCE(executed_at, ?), error_message = NULL
          WHERE strategy_id = ? AND side = 'BUY' AND level_percent = ?`).run(new Date().toISOString(), strategyId, levelPercent);
        return;
      }
      const totalInvested = strategy.total_invested + quoteAmount;
      const totalPurchasedQuantity = strategy.total_purchased_quantity + assetQuantity;
      const cyclePurchasedQuantity = strategy.cycle_purchased_quantity + assetQuantity;
      const totalAssetQuantity = strategy.total_asset_quantity + assetQuantity;
      const remainingCostBasis = strategy.remaining_cost_basis + quoteAmount;
      const averageEntryPrice = totalAssetQuantity === 0 ? 0 : remainingCostBasis / totalAssetQuantity;
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE strategies SET total_invested = ?, total_purchased_quantity = ?,
        cycle_purchased_quantity = ?, total_asset_quantity = ?, remaining_cost_basis = ?, average_entry_price = ?, updated_at = ? WHERE id = ?`)
        .run(totalInvested, totalPurchasedQuantity, cyclePurchasedQuantity, totalAssetQuantity, remainingCostBasis, averageEntryPrice, now, strategyId);
      this.db.prepare(`INSERT INTO orders (strategy_id, external_order_id, side, level_percent,
        market_price, quote_amount, asset_quantity, mode, execution_environment, created_at)
        VALUES (?, ?, 'BUY', ?, ?, ?, ?, ?, ?, ?)`)
        .run(strategyId, externalOrderId, levelPercent, price, quoteAmount, assetQuantity,
          strategy.execution_environment, strategy.execution_environment, now);
      this.db.prepare(`UPDATE executed_levels SET status = 'EXECUTED', executed_at = ?, error_message = NULL
        WHERE strategy_id = ? AND side = 'BUY' AND level_percent = ? AND status IN ('EXECUTING', 'FAILED')`)
        .run(now, strategyId, levelPercent);
      const sellState = this.db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'EXECUTED' THEN 1 ELSE 0 END) AS executed
        FROM executed_levels WHERE strategy_id = ? AND side = 'SELL'`)
        .get(strategyId) as { total: number; executed: number | null };
      if (sellState.total > 0 && sellState.executed === sellState.total) {
        this.db.prepare(`UPDATE executed_levels SET status = 'WAITING', executed_at = NULL,
          error_message = NULL, client_order_id = NULL, execution_started_at = NULL
          WHERE strategy_id = ? AND side = 'SELL'`).run(strategyId);
      }
    });
    transaction();
  }

  async completeSell(strategyId: number, levelPercent: number, price: number, quoteAmount: number, assetQuantity: number, minimumReserveQuantity: number, externalOrderId: string): Promise<void> {
    const transaction = this.db.transaction(() => {
      const strategy = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(strategyId) as StrategyRow | undefined;
      if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
      const existing = this.db.prepare("SELECT 1 FROM orders WHERE execution_environment = ? AND external_order_id = ?")
        .get(strategy.execution_environment, externalOrderId);
      if (existing) {
        this.db.prepare(`UPDATE executed_levels SET status = 'EXECUTED', executed_at = COALESCE(executed_at, ?), error_message = NULL
          WHERE strategy_id = ? AND side = 'SELL' AND level_percent = ?`).run(new Date().toISOString(), strategyId, levelPercent);
        return;
      }
      if (assetQuantity > strategy.total_asset_quantity + 1e-12) throw new Error("Cannot sell more asset than the strategy owns");
      const remainingQuantity = Math.max(0, strategy.total_asset_quantity - assetQuantity);
      if (remainingQuantity + 1e-12 < minimumReserveQuantity) throw new Error("Sell would consume the permanent reserve");
      const costBasisSold = assetQuantity * strategy.average_entry_price;
      const remainingCostBasis = Math.max(0, strategy.remaining_cost_basis - costBasisSold);
      const averageEntryPrice = remainingQuantity <= 1e-12 ? 0 : remainingCostBasis / remainingQuantity;
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE strategies SET total_asset_quantity = ?, total_sold_quantity = total_sold_quantity + ?,
        total_sale_proceeds = total_sale_proceeds + ?, realized_profit = realized_profit + ?,
        remaining_cost_basis = ?, average_entry_price = ?, updated_at = ? WHERE id = ?`)
        .run(remainingQuantity, assetQuantity, quoteAmount, quoteAmount - costBasisSold,
          remainingCostBasis, averageEntryPrice, now, strategyId);
      this.db.prepare(`INSERT INTO orders (strategy_id, external_order_id, side, level_percent,
        market_price, quote_amount, asset_quantity, mode, execution_environment, created_at)
        VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?, ?, ?)`)
        .run(strategyId, externalOrderId, levelPercent, price, quoteAmount, assetQuantity,
          strategy.execution_environment, strategy.execution_environment, now);
      this.db.prepare(`UPDATE executed_levels SET status = 'EXECUTED', executed_at = ?, error_message = NULL
        WHERE strategy_id = ? AND side = 'SELL' AND level_percent = ? AND status IN ('EXECUTING', 'FAILED')`)
        .run(now, strategyId, levelPercent);
      const remainingSells = (this.db.prepare(`SELECT COUNT(*) AS count FROM executed_levels
        WHERE strategy_id = ? AND side = 'SELL' AND status <> 'EXECUTED'`).get(strategyId) as { count: number }).count;
      if (remainingSells === 0) {
        this.db.prepare(`UPDATE executed_levels SET status = 'WAITING', executed_at = NULL,
          error_message = NULL, client_order_id = NULL, execution_started_at = NULL
          WHERE strategy_id = ? AND side = 'BUY'`).run(strategyId);
        this.db.prepare(`UPDATE strategies SET cycle_purchased_quantity = 0 WHERE id = ?`).run(strategyId);
      }
    });
    transaction();
  }

  async withdrawProfit(strategyId: number, price: number, quoteAmount: number, assetQuantity: number, minimumReserveQuantity: number, externalOrderId: string): Promise<void> {
    const transaction = this.db.transaction(() => {
      const strategy = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(strategyId) as StrategyRow | undefined;
      if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
      const existing = this.db.prepare("SELECT 1 FROM orders WHERE execution_environment = ? AND external_order_id = ?")
        .get(strategy.execution_environment, externalOrderId);
      if (existing) return;
      const remainingQuantity = strategy.total_asset_quantity - assetQuantity;
      if (assetQuantity <= 0 || remainingQuantity + 1e-12 < minimumReserveQuantity) {
        throw new Error("მოგების აღება მუდმივ რეზერვს შეამცირებს");
      }
      const costBasisSold = assetQuantity * strategy.average_entry_price;
      const remainingCostBasis = Math.max(0, strategy.remaining_cost_basis - costBasisSold);
      const averageEntryPrice = remainingQuantity <= 1e-12 ? 0 : remainingCostBasis / remainingQuantity;
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE strategies SET total_asset_quantity = ?, total_sold_quantity = total_sold_quantity + ?,
        total_sale_proceeds = total_sale_proceeds + ?, realized_profit = realized_profit + ?,
        withdrawn_profit = withdrawn_profit + ?, remaining_cost_basis = ?, average_entry_price = ?, updated_at = ? WHERE id = ?`)
        .run(remainingQuantity, assetQuantity, quoteAmount, quoteAmount - costBasisSold,
          quoteAmount, remainingCostBasis, averageEntryPrice, now, strategyId);
      this.db.prepare(`INSERT INTO orders (strategy_id, external_order_id, side, level_percent,
        market_price, quote_amount, asset_quantity, mode, execution_environment, created_at)
        VALUES (?, ?, 'SELL', 0, ?, ?, ?, ?, ?, ?)`)
        .run(strategyId, externalOrderId, price, quoteAmount, assetQuantity,
          strategy.execution_environment, strategy.execution_environment, now);
    });
    transaction();
  }

  async failLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Unknown order error";
    this.db.prepare(`UPDATE executed_levels SET status = 'FAILED', error_message = ?
      WHERE strategy_id = ? AND side = ? AND level_percent = ? AND status = 'EXECUTING'`)
      .run(message.slice(0, 500), strategyId, side, levelPercent);
  }

  async countOrders(strategyId: number): Promise<number> {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM orders WHERE strategy_id = ?").get(strategyId) as { count: number }).count;
  }

  async getOrders(strategyId: number): Promise<OrderRecord[]> {
    return this.db.prepare(`SELECT id, side, level_percent AS levelPercent, market_price AS marketPrice,
      quote_amount AS quoteAmount, asset_quantity AS assetQuantity,
      execution_environment AS executionEnvironment, created_at AS createdAt
      FROM orders WHERE strategy_id = ? ORDER BY id DESC`).all(strategyId) as OrderRecord[];
  }

  async updateMarketPrice(symbol: string, price: number, eventTime: Date): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO market_state (symbol, price, event_time, source, updated_at)
      VALUES (?, ?, ?, 'BINANCE_WEBSOCKET', ?)
      ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, event_time = excluded.event_time,
      source = excluded.source, updated_at = excluded.updated_at`)
      .run(symbol, price, eventTime.toISOString(), now);
  }

  async getMarketState(symbol: string): Promise<MarketState | null> {
    return (this.db.prepare(`SELECT symbol, price, event_time AS eventTime, source, updated_at AS updatedAt
      FROM market_state WHERE symbol = ?`).get(symbol) as MarketState | undefined) ?? null;
  }

  async saveSymbolRules(rules: SymbolRules): Promise<void> {
    this.db.prepare(`INSERT INTO symbol_rules (symbol, base_asset, quote_asset, min_qty, step_size,
      tick_size, min_notional, status, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET base_asset = excluded.base_asset, quote_asset = excluded.quote_asset,
      min_qty = excluded.min_qty, step_size = excluded.step_size, tick_size = excluded.tick_size,
      min_notional = excluded.min_notional, status = excluded.status, fetched_at = excluded.fetched_at`)
      .run(rules.symbol, rules.baseAsset, rules.quoteAsset, rules.minQty, rules.stepSize,
        rules.tickSize, rules.minNotional, rules.status, rules.fetchedAt);
  }

  async getSymbolRules(symbol: string): Promise<SymbolRules | null> {
    return (this.db.prepare(`SELECT symbol, base_asset AS baseAsset, quote_asset AS quoteAsset,
      min_qty AS minQty, step_size AS stepSize, tick_size AS tickSize,
      min_notional AS minNotional, status, fetched_at AS fetchedAt
      FROM symbol_rules WHERE symbol = ?`).get(symbol) as SymbolRules | undefined) ?? null;
  }

  async saveAccountBalances(balances: AccountBalance[]): Promise<void> {
    const statement = this.db.prepare(`INSERT INTO account_balances (asset, free, locked, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(asset) DO UPDATE SET free = excluded.free,
      locked = excluded.locked, updated_at = excluded.updated_at`);
    this.db.transaction(() => {
      for (const balance of balances) statement.run(balance.asset, balance.free, balance.locked, balance.updatedAt);
    })();
  }

  async getAccountBalances(assets: string[]): Promise<AccountBalance[]> {
    if (assets.length === 0) return [];
    const placeholders = assets.map(() => "?").join(",");
    return this.db.prepare(`SELECT asset, free, locked, updated_at AS updatedAt
      FROM account_balances WHERE asset IN (${placeholders}) ORDER BY asset`).all(...assets) as AccountBalance[];
  }

  async saveBinanceConnectionState(state: BinanceConnectionState): Promise<void> {
    this.db.prepare(`INSERT INTO binance_connection_state (id, status, message, updated_at)
      VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status,
      message = excluded.message, updated_at = excluded.updated_at`)
      .run(state.status, state.message, state.updatedAt);
  }

  async getBinanceConnectionState(): Promise<BinanceConnectionState | null> {
    return (this.db.prepare(`SELECT status, message, updated_at AS updatedAt
      FROM binance_connection_state WHERE id = 1`).get() as BinanceConnectionState | undefined) ?? null;
  }

  async resetSimulationStrategy(symbol: string): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare(`UPDATE strategies SET status = 'COMPLETED', updated_at = ?
      WHERE symbol = ? AND execution_environment = 'SIMULATION' AND status IN ('ACTIVE', 'PAUSED')`)
      .run(now, symbol);
    return result.changes;
  }

  async close(): Promise<void> { this.db.close(); }

  private map(row: StrategyRow): StrategyRecord {
    return {
      id: row.id, symbol: row.symbol, baseAsset: row.base_asset, quoteAsset: row.quote_asset,
      executionEnvironment: row.execution_environment,
      initialEntryPrice: row.initial_entry_price,
      totalBudget: row.total_budget, initialPurchaseAmount: row.initial_purchase_amount,
      finalReservePercent: row.final_reserve_percent, totalInvested: row.total_invested,
      totalPurchasedQuantity: row.total_purchased_quantity,
      cyclePurchasedQuantity: row.cycle_purchased_quantity ?? 0,
      totalAssetQuantity: row.total_asset_quantity, totalSoldQuantity: row.total_sold_quantity,
      totalSaleProceeds: row.total_sale_proceeds, realizedProfit: row.realized_profit,
      withdrawnProfit: row.withdrawn_profit ?? 0,
      remainingCostBasis: row.remaining_cost_basis, averageEntryPrice: row.average_entry_price,
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}
