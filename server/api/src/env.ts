import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://playpoint:playpoint@localhost:5432/playpoint"),
  JWT_SECRET: z.string().min(12).default("dev-secret-change-me"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OTP_EXPOSE_DEV_CODE: z.coerce.boolean().default(true),
  OTP_MOCK_CODE: z.string().regex(/^\d{4,6}$/).default("123456"),
  OTP_PROVIDER: z.enum(["mock", "sms"]).default("mock"),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  PORT: z.coerce.number().int().positive().default(4000),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379")
});

export const env = envSchema.parse(process.env);
