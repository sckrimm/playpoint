import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { CredentialVault, type BinanceCredentials } from "./credentialVault.js";

const scrypt = promisify(scryptCallback);

export type DashboardUser = {
  id: number;
  username: string;
  role: "ADMIN" | "USER";
};

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")): Promise<{ hash: string; salt: string }> {
  const derived = await scrypt(password, salt, 64) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

async function verifyPassword(password: string, salt: string, expectedHex: string): Promise<boolean> {
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class UserAuthStore {
  private readonly pool: Pool;
  readonly vault = new CredentialVault();

  constructor(connectionString: string, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });
  }

  async initialize(adminUsername: string, adminPassword: string): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bot_users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bot_user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES bot_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bot_invites (
        code_hash TEXT PRIMARY KEY,
        created_by BIGINT NOT NULL REFERENCES bot_users(id),
        expires_at TIMESTAMPTZ NOT NULL,
        used_by BIGINT REFERENCES bot_users(id),
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bot_strategy_owners (
        strategy_id BIGINT PRIMARY KEY REFERENCES bot_strategies(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES bot_users(id) ON DELETE CASCADE,
        is_shared BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bot_user_credentials (
        user_id BIGINT NOT NULL REFERENCES bot_users(id) ON DELETE CASCADE,
        environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TESTNET')),
        encrypted_credentials TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, environment)
      );
      CREATE TABLE IF NOT EXISTS bot_user_balance_history (
        user_id BIGINT NOT NULL REFERENCES bot_users(id) ON DELETE CASCADE,
        recorded_at TIMESTAMPTZ NOT NULL, balance NUMERIC NOT NULL,
        PRIMARY KEY (user_id, recorded_at)
      );
      ALTER TABLE bot_users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE bot_strategy_templates ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES bot_users(id);
    `);
    const existing = await this.pool.query<{
      id: string;
      role: DashboardUser["role"];
      password_hash: string;
      password_salt: string;
    }>("SELECT id, role, password_hash, password_salt FROM bot_users WHERE username = $1", [adminUsername]);
    const existingAdmin = existing.rows[0];
    let adminId = Number(existingAdmin?.id);
    if (!adminId) {
      const password = await hashPassword(adminPassword);
      const created = await this.pool.query<{ id: string }>(`INSERT INTO bot_users
        (username, password_hash, password_salt, role) VALUES ($1, $2, $3, 'ADMIN') RETURNING id`,
      [adminUsername, password.hash, password.salt]);
      adminId = Number(created.rows[0]!.id);
    } else if (existingAdmin && (existingAdmin.role !== "ADMIN" || !await verifyPassword(adminPassword, existingAdmin.password_salt, existingAdmin.password_hash))) {
      const password = await hashPassword(adminPassword);
      await this.pool.query(`UPDATE bot_users SET password_hash = $2, password_salt = $3, role = 'ADMIN' WHERE id = $1`,
        [adminId, password.hash, password.salt]);
      await this.pool.query("DELETE FROM bot_user_sessions WHERE user_id = $1", [adminId]);
    }
    await this.pool.query(`INSERT INTO bot_strategy_owners (strategy_id, user_id)
      SELECT s.id, $1::bigint FROM bot_strategies s LEFT JOIN bot_strategy_owners o ON o.strategy_id = s.id
      WHERE o.strategy_id IS NULL ON CONFLICT (strategy_id) DO NOTHING`, [adminId]);
    await this.pool.query("DELETE FROM bot_user_sessions WHERE expires_at <= NOW()");
    await this.pool.query("UPDATE bot_strategy_templates SET owner_user_id = $1 WHERE owner_user_id IS NULL", [adminId]);
    await this.pool.query("ALTER TABLE bot_strategy_templates DROP CONSTRAINT IF EXISTS bot_strategy_templates_name_key");
    await this.pool.query("CREATE UNIQUE INDEX IF NOT EXISTS bot_templates_owner_name_unique ON bot_strategy_templates (owner_user_id, name)");
  }

  async authenticate(username: string, password: string): Promise<DashboardUser | null> {
    const result = await this.pool.query<{ id: string; username: string; role: DashboardUser["role"]; password_hash: string; password_salt: string }>(
      "SELECT id, username, role, password_hash, password_salt FROM bot_users WHERE username = $1", [username.trim()]);
    const row = result.rows[0];
    if (!row || !await verifyPassword(password, row.password_salt, row.password_hash)) return null;
    return { id: Number(row.id), username: row.username, role: row.role };
  }

  async createSession(userId: number): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.pool.query(`INSERT INTO bot_user_sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')`, [hashToken(token), userId]);
    return token;
  }

  async getSession(token: string | undefined): Promise<DashboardUser | null> {
    if (!token) return null;
    const result = await this.pool.query<{ id: string; username: string; role: DashboardUser["role"] }>(`SELECT u.id, u.username, u.role
      FROM bot_user_sessions s JOIN bot_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`, [hashToken(token)]);
    const row = result.rows[0];
    return row ? { id: Number(row.id), username: row.username, role: row.role } : null;
  }

  async createInvite(adminId: number): Promise<{ code: string; expiresAt: string }> {
    const code = randomBytes(9).toString("base64url").toUpperCase();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    await this.pool.query(`INSERT INTO bot_invites (code_hash, created_by, expires_at) VALUES ($1, $2, $3)`,
      [hashToken(code), adminId, expiresAt]);
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async register(inviteCode: string, username: string, password: string): Promise<DashboardUser> {
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("მომხმარებლის სახელი უნდა იყოს 3-32 სიმბოლო");
    if (password.length < 10) throw new Error("პაროლი მინიმუმ 10 სიმბოლო უნდა იყოს");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invite = await client.query<{ code_hash: string }>(`SELECT code_hash FROM bot_invites
        WHERE code_hash = $1 AND used_by IS NULL AND expires_at > NOW() FOR UPDATE`, [hashToken(inviteCode.trim().toUpperCase())]);
      if (!invite.rows[0]) throw new Error("მოწვევის კოდი არასწორია, გამოყენებულია ან ვადა გაუვიდა");
      const credentials = await hashPassword(password);
      const created = await client.query<{ id: string; username: string; role: DashboardUser["role"] }>(`INSERT INTO bot_users
        (username, password_hash, password_salt, role) VALUES ($1, $2, $3, 'USER') RETURNING id, username, role`,
      [username, credentials.hash, credentials.salt]);
      const user = created.rows[0]!;
      await client.query("UPDATE bot_invites SET used_by = $1, used_at = NOW() WHERE code_hash = $2",
        [user.id, invite.rows[0].code_hash]);
      await client.query("COMMIT");
      return { id: Number(user.id), username: user.username, role: user.role };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async assignStrategy(strategyId: number, userId: number): Promise<void> {
    await this.pool.query(`INSERT INTO bot_strategy_owners (strategy_id, user_id) VALUES ($1, $2)
      ON CONFLICT (strategy_id) DO NOTHING`, [strategyId, userId]);
  }

  async assertStrategyAccess(strategyId: number, user: DashboardUser, readOnly = false): Promise<void> {
    const result = await this.pool.query("SELECT user_id FROM bot_strategy_owners WHERE strategy_id = $1", [strategyId]);
    if (!result.rows[0] || (Number(result.rows[0].user_id) !== user.id && !(readOnly && user.role === "ADMIN"))) {
      throw new Error("ამ სტრატეგიაზე წვდომა არ გაქვს");
    }
  }

  async filterStrategyIds(ids: number[], user: DashboardUser): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const result = await this.pool.query<{ strategy_id: string }>(
      "SELECT strategy_id FROM bot_strategy_owners WHERE user_id = $1", [user.id]);
    const requested = new Set(ids);
    return new Set(result.rows.map((row) => Number(row.strategy_id)).filter((id) => requested.has(id)));
  }

  async listUsers(): Promise<Array<DashboardUser & { strategyCount: number }>> {
    const result = await this.pool.query<{ id: string; username: string; role: DashboardUser["role"]; strategy_count: string }>(`SELECT u.id, u.username, u.role,
      COUNT(o.strategy_id)::text AS strategy_count FROM bot_users u
      LEFT JOIN bot_strategy_owners o ON o.user_id = u.id GROUP BY u.id ORDER BY u.created_at`);
    return result.rows.map((row) => ({ id: Number(row.id), username: row.username, role: row.role, strategyCount: Number(row.strategy_count) }));
  }

  async close(): Promise<void> { await this.pool.end(); }

  async strategyOwner(strategyId: number): Promise<DashboardUser | null> {
    const result = await this.pool.query(`SELECT u.id, u.username, u.role FROM bot_strategy_owners o
      JOIN bot_users u ON u.id = o.user_id WHERE o.strategy_id = $1`, [strategyId]);
    const row = result.rows[0];
    return row ? { id: Number(row.id), username: row.username, role: row.role } : null;
  }

  async credentials(userId: number, environment: "LIVE" | "TESTNET"): Promise<BinanceCredentials | null> {
    const result = await this.pool.query("SELECT encrypted_credentials FROM bot_user_credentials WHERE user_id = $1 AND environment = $2", [userId, environment]);
    return result.rows[0] ? this.vault.decrypt(result.rows[0].encrypted_credentials, userId, environment) : null;
  }

  async saveCredentials(userId: number, environment: "LIVE" | "TESTNET", credentials: BinanceCredentials): Promise<void> {
    const encrypted = this.vault.encrypt(credentials, userId, environment);
    await this.pool.query(`INSERT INTO bot_user_credentials (user_id, environment, encrypted_credentials) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, environment) DO UPDATE SET encrypted_credentials = EXCLUDED.encrypted_credentials, updated_at = NOW()`, [userId, environment, encrypted]);
  }

  async profile(user: DashboardUser) {
    const result = await this.pool.query("SELECT display_name FROM bot_users WHERE id = $1", [user.id]);
    const keys = await this.pool.query("SELECT environment, updated_at FROM bot_user_credentials WHERE user_id = $1", [user.id]);
    return { ...user, displayName: result.rows[0]?.display_name ?? "", encryptionReady: this.vault.configured,
      credentials: keys.rows.map((row) => ({ environment: row.environment, updatedAt: row.updated_at })) };
  }

  async saveProfile(userId: number, displayName: string): Promise<void> {
    if (displayName.length > 60) throw new Error("სახელი მაქსიმუმ 60 სიმბოლო უნდა იყოს");
    await this.pool.query("UPDATE bot_users SET display_name = $2 WHERE id = $1", [userId, displayName]);
  }

  async setShared(strategyId: number, userId: number, shared: boolean): Promise<void> {
    const result = await this.pool.query("UPDATE bot_strategy_owners SET is_shared = $3 WHERE strategy_id = $1 AND user_id = $2", [strategyId, userId, shared]);
    if (result.rowCount !== 1) throw new Error("მხოლოდ შენი სტრატეგიის გაზიარება შეგიძლია");
  }

  async sharedStrategies() {
    const result = await this.pool.query(`SELECT s.id, s.symbol, s.final_reserve_percent::double precision AS "finalReservePercent", u.username,
      u.display_name AS "displayName" FROM bot_strategy_owners o JOIN bot_strategies s ON s.id = o.strategy_id
      JOIN bot_users u ON u.id = o.user_id WHERE o.is_shared = TRUE ORDER BY o.created_at DESC`);
    return result.rows;
  }

  async strategySharing(strategyId: number): Promise<boolean> {
    const result = await this.pool.query("SELECT is_shared FROM bot_strategy_owners WHERE strategy_id = $1", [strategyId]);
    return result.rows[0]?.is_shared ?? false;
  }

  async templateIds(userId: number): Promise<Set<number>> {
    const result = await this.pool.query("SELECT id FROM bot_strategy_templates WHERE owner_user_id = $1", [userId]);
    return new Set(result.rows.map((row) => Number(row.id)));
  }

  async assignTemplate(templateId: number, userId: number): Promise<void> {
    await this.pool.query("UPDATE bot_strategy_templates SET owner_user_id = $2 WHERE id = $1", [templateId, userId]);
  }

  async assertCredentialChangeAllowed(userId: number, environment: "LIVE" | "TESTNET"): Promise<void> {
    const result = await this.pool.query(`SELECT s.id FROM bot_strategies s JOIN bot_strategy_owners o ON o.strategy_id = s.id
      WHERE o.user_id = $1 AND s.execution_environment = $2 AND s.status <> 'COMPLETED'
      AND (s.status = 'ACTIVE' OR EXISTS (SELECT 1 FROM bot_executed_levels l
        WHERE l.strategy_id = s.id AND (l.status = 'EXECUTING' OR
          (l.status = 'FAILED' AND l.client_order_id IS NOT NULL AND l.error_message LIKE '[NO_AUTO_RETRY]%')))) LIMIT 1`, [userId, environment]);
    if (result.rows[0]) throw new Error("გასაღებების შეცვლამდე ამ გარემოს ბოტები შეაჩერე და მიმდინარე ორდერების დასრულებას დაელოდე");
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (token) await this.pool.query("DELETE FROM bot_user_sessions WHERE token_hash = $1", [hashToken(token)]);
  }

  async recordAccountBalance(userId: number, balance: number): Promise<void> {
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await this.pool.query(`INSERT INTO bot_user_balance_history (user_id, recorded_at, balance)
      VALUES ($1, $2, $3) ON CONFLICT (user_id, recorded_at) DO NOTHING`, [userId, minute, balance]);
    await this.pool.query("DELETE FROM bot_user_balance_history WHERE user_id = $1 AND recorded_at < NOW() - INTERVAL '35 days'", [userId]);
  }

  async accountBalanceReference(userId: number, target: Date): Promise<number | null> {
    const result = await this.pool.query(`SELECT balance FROM bot_user_balance_history
      WHERE user_id = $1 AND recorded_at <= $2 AND recorded_at >= $3 ORDER BY recorded_at DESC LIMIT 1`,
    [userId, target, new Date(target.getTime() - 5 * 60_000)]);
    return result.rows[0] ? Number(result.rows[0].balance) : null;
  }
}
