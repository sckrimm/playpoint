import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) return;

      const separatorIndex = trimmedLine.indexOf("=");
      if (separatorIndex < 0) return;

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) return;

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    });
}

loadLocalEnv();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://playpoint:playpoint@localhost:5432/playpoint"),
  APPLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  JWT_SECRET: z.string().min(12).default("dev-secret-change-me"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OTP_EXPOSE_DEV_CODE: z.coerce.boolean().default(false),
  OTP_MOCK_CODE: z.string().regex(/^\d{4,6}$/).default("123456"),
  OTP_PROVIDER: z.enum(["mock", "sms"]).default("mock"),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  PORT: z.coerce.number().int().positive().default(4000),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379")
});

export const env = envSchema.parse(process.env);
