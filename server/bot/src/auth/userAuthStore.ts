import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

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

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });
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
    `);
    const existing = await this.pool.query<{ id: string }>("SELECT id FROM bot_users WHERE username = $1", [adminUsername]);
    let adminId = Number(existing.rows[0]?.id);
    if (!adminId) {
      const password = await hashPassword(adminPassword);
      const created = await this.pool.query<{ id: string }>(`INSERT INTO bot_users
        (username, password_hash, password_salt, role) VALUES ($1, $2, $3, 'ADMIN') RETURNING id`,
      [adminUsername, password.hash, password.salt]);
      adminId = Number(created.rows[0]!.id);
    }
    await this.pool.query(`INSERT INTO bot_strategy_owners (strategy_id, user_id)
      SELECT id, $1 FROM bot_strategies s
      WHERE NOT EXISTS (SELECT 1 FROM bot_strategy_owners o WHERE o.strategy_id = s.id)`, [adminId]);
    await this.pool.query("DELETE FROM bot_user_sessions WHERE expires_at <= NOW()");
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
      ON CONFLICT (strategy_id) DO UPDATE SET user_id = EXCLUDED.user_id`, [strategyId, userId]);
  }

  async assertStrategyAccess(strategyId: number, user: DashboardUser): Promise<void> {
    const result = await this.pool.query("SELECT user_id FROM bot_strategy_owners WHERE strategy_id = $1", [strategyId]);
    if (!result.rows[0] || (user.role !== "ADMIN" && Number(result.rows[0].user_id) !== user.id)) {
      throw new Error("ამ სტრატეგიაზე წვდომა არ გაქვს");
    }
  }

  async filterStrategyIds(ids: number[], user: DashboardUser): Promise<Set<number>> {
    if (user.role === "ADMIN") return new Set(ids);
    if (!ids.length) return new Set();
    const result = await this.pool.query<{ strategy_id: string }>(
      "SELECT strategy_id FROM bot_strategy_owners WHERE user_id = $1 AND strategy_id = ANY($2::bigint[])", [user.id, ids]);
    return new Set(result.rows.map((row) => Number(row.strategy_id)));
  }

  async listUsers(): Promise<Array<DashboardUser & { strategyCount: number }>> {
    const result = await this.pool.query<{ id: string; username: string; role: DashboardUser["role"]; strategy_count: string }>(`SELECT u.id, u.username, u.role,
      COUNT(o.strategy_id)::text AS strategy_count FROM bot_users u
      LEFT JOIN bot_strategy_owners o ON o.user_id = u.id GROUP BY u.id ORDER BY u.created_at`);
    return result.rows.map((row) => ({ id: Number(row.id), username: row.username, role: row.role, strategyCount: Number(row.strategy_count) }));
  }

  async close(): Promise<void> { await this.pool.end(); }
}
