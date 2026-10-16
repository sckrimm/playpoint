import type Database from "better-sqlite3";
import type { AccountBalance, BinanceConnectionState, ExecutedLevelRecord, MarketState, OrderAccounting, OrderRecord, StrategyConfig, StrategyRecord, StrategyTemplateRecord } from "../types/strategy.js";
import type { StrategyStore } from "./repository.js";
import type { SymbolRules } from "../binance/binanceService.js";
import { emptyTestnetEvidence, nextTestnetEvidence, type TestnetEvidence } from "../services/testnetEvidence.js";
import { mapProfitRequest, planProfitWithdrawal, validateProfitRequestKey, type ProfitWithdrawalRequest } from "../services/profitWithdrawal.js";
import type { AnalystAssessment, AnalystReview } from "../services/analystService.js";

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

  async getTestnetEvidence(id: number): Promise<TestnetEvidence> {
    const row = this.db.prepare("SELECT * FROM testnet_evidence WHERE strategy_id = ?").get(id) as Record<string, number | string> | undefined;
    return row ? { observedMs: Number(row.observed_ms), lastObservedMs: Number(row.last_observed_ms), workerId: String(row.worker_id),
      restarts: Number(row.restarts), gapRecoveries: Number(row.gap_recoveries), completedCycles: Number(row.completed_cycles) } : emptyTestnetEvidence();
  }

  async recordTestnetObservation(id: number, now: number, workerId: string): Promise<void> {
    this.db.transaction(() => {
      const strategy = this.db.prepare("SELECT status, execution_environment FROM strategies WHERE id = ?").get(id) as StrategyRow | undefined;
      if (strategy?.status !== "ACTIVE" || strategy.execution_environment !== "TESTNET") return;
      if (this.db.prepare("SELECT 1 FROM executed_levels WHERE strategy_id = ? AND status IN ('FAILED', 'EXECUTING') LIMIT 1").get(id)) return;
      const row = this.db.prepare("SELECT * FROM testnet_evidence WHERE strategy_id = ?").get(id) as Record<string, number | string> | undefined;
      const previous = row ? { observedMs: Number(row.observed_ms), lastObservedMs: Number(row.last_observed_ms), workerId: String(row.worker_id),
        restarts: Number(row.restarts), gapRecoveries: Number(row.gap_recoveries), completedCycles: Number(row.completed_cycles) } : emptyTestnetEvidence();
      const next = nextTestnetEvidence(previous, now, workerId);
      this.db.prepare(`INSERT INTO testnet_evidence (strategy_id, observed_ms, last_observed_ms, worker_id, restarts, gap_recoveries)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(strategy_id) DO UPDATE SET observed_ms = excluded.observed_ms,
        last_observed_ms = excluded.last_observed_ms, worker_id = excluded.worker_id, restarts = excluded.restarts, gap_recoveries = excluded.gap_recoveries`)
        .run(id, next.observedMs, next.lastObservedMs, next.workerId, next.restarts, next.gapRecoveries);
    })();
  }

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
      this.db.prepare("DELETE FROM testnet_evidence WHERE strategy_id = ?").run(id);
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
    this.db.transaction(() => {
      if (status === "ACTIVE" && this.db.prepare("SELECT 1 FROM profit_withdrawals WHERE strategy_id = ? AND status = 'PENDING'").get(id)) {
        throw new Error("მოგების აღების ორდერი ჯერ გადამოწმებას ელოდება");
      }
      const result = this.db.prepare(`UPDATE strategies SET status = ?, updated_at = ?
        WHERE id = ? AND status IN ('ACTIVE', 'PAUSED')`).run(status, new Date().toISOString(), id);
      if (result.changes !== 1) throw new Error(`Strategy ${id} is not active or paused`);
    })();
    return this.getById(id);
  }

  async pauseStrategies(ids: number[]): Promise<number> {
    if (!ids.length) return 0;
    return this.db.prepare(`UPDATE strategies SET status = 'PAUSED', updated_at = ?
      WHERE status = 'ACTIVE' AND id IN (${ids.map(() => "?").join(",")})`)
      .run(new Date().toISOString(), ...ids).changes;
  }

  async archiveStrategy(id: number): Promise<StrategyRecord> {
    this.db.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM profit_withdrawals WHERE strategy_id = ? AND status = 'PENDING'").get(id)) throw new Error("მოგების აღების ორდერი ჯერ გადამოწმებას ელოდება");
      const result = this.db.prepare(`UPDATE strategies SET status = 'COMPLETED', updated_at = ?
        WHERE id = ? AND status IN ('ACTIVE', 'PAUSED')`).run(new Date().toISOString(), id);
      if (result.changes !== 1) throw new Error(`Strategy ${id} is not active or paused`);
    })();
    return this.getById(id);
  }

  async resetSimulationStrategyById(id: number): Promise<StrategyRecord> {
    let newId = 0;
    this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(id) as StrategyRow | undefined;
      if (!current) throw new Error(`Strategy ${id} not found`);
      if (this.db.prepare("SELECT 1 FROM profit_withdrawals WHERE strategy_id = ? AND status = 'PENDING'").get(id)) throw new Error("მოგების აღების ორდერი ჯერ გადამოწმებას ელოდება");
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
        AND EXISTS (SELECT 1 FROM strategies WHERE strategies.id = executed_levels.strategy_id AND strategies.status = 'ACTIVE')
        AND (status = 'WAITING' OR (status = 'FAILED' AND error_message NOT LIKE '[NO_AUTO_RETRY]%'))`)
      .run(clientOrderId, new Date().toISOString(), strategyId, side, levelPercent);
    return result.changes === 1;
  }

  async releaseLevel(strategyId: number, side: "BUY" | "SELL", levelPercent: number, clientOrderId: string, reason?: string): Promise<void> {
    this.db.prepare(`UPDATE executed_levels SET status = 'WAITING', error_message = ?,
      client_order_id = NULL, execution_started_at = NULL
      WHERE strategy_id = ? AND side = ? AND level_percent = ? AND client_order_id = ?
        AND status IN ('EXECUTING', 'FAILED')`).run(reason?.slice(0, 500) ?? null, strategyId, side, levelPercent, clientOrderId);
  }

  async completeBuy(strategyId: number, levelPercent: number, price: number, quoteAmount: number, assetQuantity: number, externalOrderId: string, accounting?: OrderAccounting): Promise<void> {
    const transaction = this.db.transaction(() => {
      const strategy = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(strategyId) as StrategyRow | undefined;
      if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
      const existing = this.db.prepare("SELECT 1 FROM orders WHERE strategy_id = ? AND execution_environment = ? AND external_order_id = ?")
        .get(strategyId, strategy.execution_environment, externalOrderId);
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
      this.saveAccounting(strategyId, externalOrderId, strategy.execution_environment, accounting);
      if (sellState.total > 0 && sellState.executed === sellState.total) {
        this.db.prepare(`UPDATE executed_levels SET status = 'WAITING', executed_at = NULL,
          error_message = NULL, client_order_id = NULL, execution_started_at = NULL
          WHERE strategy_id = ? AND side = 'SELL'`).run(strategyId);
      }
    });
    transaction();
  }

  async completeSell(strategyId: number, levelPercent: number, price: number, quoteAmount: number, assetQuantity: number, minimumReserveQuantity: number, externalOrderId: string, accounting?: OrderAccounting): Promise<void> {
    const transaction = this.db.transaction(() => {
      const strategy = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(strategyId) as StrategyRow | undefined;
      if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
      const existing = this.db.prepare("SELECT 1 FROM orders WHERE strategy_id = ? AND execution_environment = ? AND external_order_id = ?")
        .get(strategyId, strategy.execution_environment, externalOrderId);
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
      this.saveAccounting(strategyId, externalOrderId, strategy.execution_environment, accounting);
      if (remainingSells === 0) {
        if (strategy.execution_environment === "TESTNET") this.db.prepare(`INSERT INTO testnet_evidence (strategy_id, completed_cycles)
          VALUES (?, 1) ON CONFLICT(strategy_id) DO UPDATE SET completed_cycles = completed_cycles + 1`).run(strategyId);
        this.db.prepare(`UPDATE executed_levels SET status = 'WAITING', executed_at = NULL,
          error_message = NULL, client_order_id = NULL, execution_started_at = NULL
          WHERE strategy_id = ? AND side = 'BUY'`).run(strategyId);
        this.db.prepare(`UPDATE strategies SET cycle_purchased_quantity = 0 WHERE id = ?`).run(strategyId);
      }
    });
    transaction();
  }

  async saveAnalystReview(strategyId: number, assessment: AnalystAssessment): Promise<AnalystReview> {
    const result = this.db.prepare("INSERT INTO analyst_reviews (strategy_id, assessment, created_at) VALUES (?, ?, ?)").run(strategyId, JSON.stringify(assessment), assessment.generatedAt);
    this.db.prepare(`DELETE FROM analyst_reviews WHERE strategy_id = ? AND id NOT IN
      (SELECT id FROM analyst_reviews WHERE strategy_id = ? ORDER BY id DESC LIMIT 100)`).run(strategyId, strategyId);
    return { id: Number(result.lastInsertRowid), decision: "NEW", assessment };
  }

  async getAnalystReviews(strategyId: number): Promise<AnalystReview[]> {
    return (this.db.prepare("SELECT id, decision, assessment FROM analyst_reviews WHERE strategy_id = ? ORDER BY id DESC LIMIT 30").all(strategyId) as Array<{ id: number; decision: AnalystReview["decision"]; assessment: string }>)
      .map((row) => ({ id: row.id, decision: row.decision, assessment: JSON.parse(row.assessment) }));
  }

  async decideAnalystReview(strategyId: number, reviewId: number, decision: "ACKNOWLEDGED" | "DISMISSED"): Promise<void> {
    const result = this.db.prepare("UPDATE analyst_reviews SET decision = ? WHERE id = ? AND strategy_id = ?").run(decision, reviewId, strategyId);
    if (result.changes !== 1) throw new Error("შეფასება ვერ მოიძებნა");
  }

  async getProfitWithdrawals(strategyId: number): Promise<ProfitWithdrawalRequest[]> {
    return (this.db.prepare("SELECT * FROM profit_withdrawals WHERE strategy_id = ? ORDER BY created_at").all(strategyId) as Record<string, unknown>[]).map(mapProfitRequest);
  }

  async cancelProfitWithdrawal(strategyId: number, requestKey: string): Promise<void> {
    this.db.prepare("UPDATE profit_withdrawals SET status = 'CANCELLED' WHERE strategy_id = ? AND request_key = ? AND status = 'PENDING'").run(strategyId, requestKey);
  }

  async beginProfitWithdrawal(strategyId: number, amount: number, requestKey: string, allowSale: boolean): Promise<ProfitWithdrawalRequest> {
    validateProfitRequestKey(requestKey);
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(strategyId) as StrategyRow | undefined;
      if (!row) throw new Error("Strategy not found");
      const existing = this.db.prepare("SELECT * FROM profit_withdrawals WHERE request_key = ?").get(requestKey) as Record<string, unknown> | undefined;
      if (existing) {
        if (Number(existing.strategy_id) !== strategyId || Number(existing.amount) !== amount || (Number(existing.sale_amount) > 0 && !allowSale)) throw new Error("მოთხოვნის იდენტიფიკატორი უკვე გამოყენებულია");
        if (existing.status === "CANCELLED") throw new Error("მოთხოვნა გაუქმებულია; თავიდან სცადე");
        return mapProfitRequest(existing);
      }
      if (this.db.prepare("SELECT 1 FROM profit_withdrawals WHERE strategy_id = ? AND status = 'PENDING'").get(strategyId)) throw new Error("წინა მოგების აღება ჯერ გადამოწმებას ელოდება");
      if (this.db.prepare("SELECT 1 FROM executed_levels WHERE strategy_id = ? AND (status = 'EXECUTING' OR (status = 'FAILED' AND error_message LIKE '[NO_AUTO_RETRY]%'))").get(strategyId)) throw new Error("ჯერ გადაამოწმე მიმდინარე ორდერები");
      if (this.db.prepare("SELECT 1 FROM orders WHERE strategy_id = ? AND execution_environment = 'TESTNET' AND commission_status <> 'VERIFIED' LIMIT 1").get(strategyId)) throw new Error("მოგების აღებამდე საკომისიოების გადამოწმებაა საჭირო");
      const plan = planProfitWithdrawal(this.map(row), amount, allowSale);
      const now = new Date().toISOString();
      const status: ProfitWithdrawalRequest["status"] = plan.saleAmount > 0 ? "PENDING" : "COMPLETED";
      this.db.prepare(`INSERT INTO profit_withdrawals (request_key, strategy_id, amount, cash_amount, sale_amount, actual_amount, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(requestKey, strategyId, amount, plan.cashAmount, plan.saleAmount, status === "COMPLETED" ? amount : 0, status, now);
      if (status === "COMPLETED") this.db.prepare("UPDATE strategies SET withdrawn_profit = withdrawn_profit + ?, updated_at = ? WHERE id = ?").run(amount, now, strategyId);
      return { requestKey, amount, ...plan, actualAmount: status === "COMPLETED" ? amount : 0, status, createdAt: now, isNew: true };
    })();
  }

  async withdrawProfit(strategyId: number, price: number, quoteAmount: number, assetQuantity: number, minimumReserveQuantity: number, externalOrderId: string, requestKey?: string, accounting?: OrderAccounting): Promise<void> {
    const transaction = this.db.transaction(() => {
      const strategy = this.db.prepare("SELECT * FROM strategies WHERE id = ?").get(strategyId) as StrategyRow | undefined;
      if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
      const request = requestKey ? this.db.prepare("SELECT * FROM profit_withdrawals WHERE strategy_id = ? AND request_key = ?").get(strategyId, requestKey) as Record<string, unknown> | undefined : undefined;
      if (requestKey && !request) throw new Error("მოგების აღების მოთხოვნა ვერ მოიძებნა");
      if (request?.status === "COMPLETED") return;
      if (request && request.status !== "PENDING") throw new Error("მოთხოვნა გაუქმებულია");
      const cashAmount = Number(request?.cash_amount ?? 0);
      const existing = this.db.prepare("SELECT 1 FROM orders WHERE strategy_id = ? AND execution_environment = ? AND external_order_id = ?")
        .get(strategyId, strategy.execution_environment, externalOrderId);
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
          quoteAmount + cashAmount, remainingCostBasis, averageEntryPrice, now, strategyId);
      this.db.prepare(`INSERT INTO orders (strategy_id, external_order_id, side, level_percent,
        market_price, quote_amount, asset_quantity, mode, execution_environment, created_at)
        VALUES (?, ?, 'SELL', 0, ?, ?, ?, ?, ?, ?)`)
        .run(strategyId, externalOrderId, price, quoteAmount, assetQuantity,
          strategy.execution_environment, strategy.execution_environment, now);
      this.saveAccounting(strategyId, externalOrderId, strategy.execution_environment, accounting);
      if (requestKey) this.db.prepare("UPDATE profit_withdrawals SET status = 'COMPLETED', actual_amount = ?, created_at = ? WHERE request_key = ?").run(quoteAmount + cashAmount, now, requestKey);
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
    const rows = this.db.prepare(`SELECT id, external_order_id AS externalOrderId, side, level_percent AS levelPercent, market_price AS marketPrice,
      quote_amount AS quoteAmount, asset_quantity AS assetQuantity,
      execution_environment AS executionEnvironment, created_at AS createdAt, commission_status AS commissionStatus, accounting
      FROM orders WHERE strategy_id = ? ORDER BY id DESC`).all(strategyId) as Array<Omit<OrderRecord, "accounting"> & { accounting: string | null }>;
    return rows.map((row) => ({ ...row, accounting: row.accounting ? JSON.parse(row.accounting) : null }));
  }

  private saveAccounting(strategyId: number, externalOrderId: string, environment: string, accounting?: OrderAccounting): void {
    this.db.prepare("UPDATE orders SET commission_status = ?, accounting = ? WHERE strategy_id = ? AND external_order_id = ? AND execution_environment = ?")
      .run(accounting?.status ?? "UNVERIFIED", accounting ? JSON.stringify(accounting) : null, strategyId, externalOrderId, environment);
  }

  async countUnverifiedCommissions(strategyId: number): Promise<number> {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM orders WHERE strategy_id = ? AND execution_environment = 'TESTNET' AND commission_status <> 'VERIFIED'")
      .get(strategyId) as { count: number }).count;
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
      const usdt = balances.find((balance) => balance.asset === "USDT");
      if (usdt) {
        const minute = new Date(Math.floor(Date.parse(usdt.updatedAt) / 60_000) * 60_000).toISOString();
        this.db.prepare("INSERT OR IGNORE INTO account_balance_history (recorded_at, balance) VALUES (?, ?)")
          .run(minute, Number(usdt.free) + Number(usdt.locked));
        this.db.prepare("DELETE FROM account_balance_history WHERE recorded_at < ?")
          .run(new Date(Date.now() - 35 * 24 * 60 * 60_000).toISOString());
      }
    })();
  }

  async getAccountBalanceReference(targetTime: Date): Promise<number | null> {
    const row = this.db.prepare(`SELECT balance FROM account_balance_history
      WHERE recorded_at <= ? AND recorded_at >= ? ORDER BY recorded_at DESC LIMIT 1`)
      .get(targetTime.toISOString(), new Date(targetTime.getTime() - 5 * 60_000).toISOString()) as { balance: number } | undefined;
    return row?.balance ?? null;
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
