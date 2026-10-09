import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function openDatabase(filename: string): Database.Database {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      base_asset TEXT NOT NULL DEFAULT '',
      quote_asset TEXT NOT NULL DEFAULT 'USDT',
      execution_environment TEXT NOT NULL DEFAULT 'SIMULATION',
      initial_entry_price REAL NOT NULL,
      total_budget REAL NOT NULL,
      initial_purchase_amount REAL NOT NULL DEFAULT 0,
      final_reserve_percent REAL NOT NULL DEFAULT 10,
      total_invested REAL NOT NULL DEFAULT 0,
      total_purchased_quantity REAL NOT NULL DEFAULT 0,
      cycle_purchased_quantity REAL NOT NULL DEFAULT 0,
      total_asset_quantity REAL NOT NULL DEFAULT 0,
      total_sold_quantity REAL NOT NULL DEFAULT 0,
      total_sale_proceeds REAL NOT NULL DEFAULT 0,
      realized_profit REAL NOT NULL DEFAULT 0,
      withdrawn_profit REAL NOT NULL DEFAULT 0,
      remaining_cost_basis REAL NOT NULL DEFAULT 0,
      average_entry_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER NOT NULL REFERENCES strategies(id),
      external_order_id TEXT NOT NULL,
      side TEXT NOT NULL,
      level_percent REAL NOT NULL,
      market_price REAL NOT NULL,
      quote_amount REAL NOT NULL,
      asset_quantity REAL NOT NULL,
      mode TEXT NOT NULL,
      execution_environment TEXT NOT NULL DEFAULT 'SIMULATION',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS executed_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER NOT NULL REFERENCES strategies(id),
      side TEXT NOT NULL,
      level_percent REAL NOT NULL,
      trigger_price REAL NOT NULL,
      allocation_percent REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'WAITING',
      error_message TEXT,
      executed_at TEXT,
      client_order_id TEXT,
      execution_started_at TEXT,
      UNIQUE(strategy_id, side, level_percent)
    );

    CREATE TABLE IF NOT EXISTS market_state (
      symbol TEXT PRIMARY KEY,
      price REAL NOT NULL,
      event_time TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS symbol_rules (
      symbol TEXT PRIMARY KEY,
      base_asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      min_qty TEXT NOT NULL,
      step_size TEXT NOT NULL,
      tick_size TEXT NOT NULL,
      min_notional TEXT NOT NULL,
      status TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_balances (
      asset TEXT PRIMARY KEY,
      free TEXT NOT NULL,
      locked TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS binance_connection_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      buy_levels_json TEXT NOT NULL,
      sell_levels_json TEXT NOT NULL,
      final_reserve_percent REAL NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "strategies", "execution_environment", "TEXT NOT NULL DEFAULT 'SIMULATION'");
  ensureColumn(db, "strategies", "base_asset", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "strategies", "quote_asset", "TEXT NOT NULL DEFAULT 'USDT'");
  ensureColumn(db, "strategies", "final_reserve_percent", "REAL NOT NULL DEFAULT 10");
  ensureColumn(db, "strategies", "initial_purchase_amount", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "strategies", "total_purchased_quantity", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "strategies", "cycle_purchased_quantity", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "strategies", "total_sold_quantity", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "strategies", "total_sale_proceeds", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "strategies", "realized_profit", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "strategies", "withdrawn_profit", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "strategies", "remaining_cost_basis", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "orders", "execution_environment", "TEXT NOT NULL DEFAULT 'SIMULATION'");
  ensureColumn(db, "executed_levels", "allocation_percent", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "executed_levels", "client_order_id", "TEXT");
  ensureColumn(db, "executed_levels", "execution_started_at", "TEXT");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS orders_external_order_unique
    ON orders (execution_environment, external_order_id)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS levels_client_order_unique
    ON executed_levels (client_order_id) WHERE client_order_id IS NOT NULL`);
  db.exec(`
    UPDATE strategies SET quote_asset = 'USDT' WHERE quote_asset = '';
    UPDATE strategies SET base_asset = substr(symbol, 1, length(symbol) - 4)
      WHERE base_asset = '' AND symbol LIKE '%USDT';
    UPDATE strategies SET total_purchased_quantity = total_asset_quantity
      WHERE total_purchased_quantity = 0 AND total_asset_quantity > 0;
    UPDATE strategies SET cycle_purchased_quantity = total_purchased_quantity
      WHERE cycle_purchased_quantity = 0 AND total_purchased_quantity > 0
        AND EXISTS (SELECT 1 FROM executed_levels
          WHERE executed_levels.strategy_id = strategies.id AND side = 'SELL' AND status <> 'EXECUTED');
    UPDATE executed_levels SET status = 'WAITING', executed_at = NULL, error_message = NULL,
      client_order_id = NULL, execution_started_at = NULL
      WHERE side = 'BUY' AND strategy_id IN (
        SELECT strategies.id FROM strategies
        WHERE EXISTS (SELECT 1 FROM executed_levels AS sells
          WHERE sells.strategy_id = strategies.id AND sells.side = 'SELL')
          AND NOT EXISTS (SELECT 1 FROM executed_levels AS pending_sells
            WHERE pending_sells.strategy_id = strategies.id AND pending_sells.side = 'SELL'
              AND pending_sells.status <> 'EXECUTED')
      );
    UPDATE strategies SET remaining_cost_basis = average_entry_price * total_asset_quantity
      WHERE remaining_cost_basis = 0 AND total_asset_quantity > 0;
    UPDATE executed_levels SET allocation_percent = CASE level_percent
      WHEN 15 THEN 10 WHEN 25 THEN 20 WHEN 40 THEN 30 WHEN 60 THEN 40 ELSE allocation_percent END
      WHERE side = 'BUY' AND allocation_percent = 0;
  `);
  return db;
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
