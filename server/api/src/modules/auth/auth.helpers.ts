import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma";
import { env } from "../../env";

export function normalizePhone(phone: string) {
  const normalized = phone.trim().replace(/[^\d+]/g, "");
  if (normalized.startsWith("+")) return normalized;
  if (normalized.startsWith("995")) return `+${normalized}`;
  if (normalized.startsWith("5") && normalized.length === 9) return `+995${normalized}`;
  return normalized;
}

export function createOtpCode() {
  if (env.OTP_PROVIDER === "mock") return env.OTP_MOCK_CODE;
  return String(crypto.randomInt(1000, 9999));
}

export function hashOtp(phone: string, code: string) {
  return crypto
    .createHash("sha256")
    .update(`${env.JWT_SECRET}:otp:${phone}:${code}`)
    .digest("hex");
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(`${env.JWT_SECRET}:session:${token}`)
    .digest("hex");
}

export function hashScoreToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(`${env.JWT_SECRET}:score:${token}`)
    .digest("hex");
}

export function isHashMatch(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

export function readBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  const token = readBearerToken(request);
  if (!token) {
    await reply.code(401).send({ message: "Missing bearer token" });
    return null;
  }

  const session = await prisma.userSession.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
      expiresAt: {
        gt: new Date()
      }
    },
    include: {
      user: true
    }
  });

  if (!session) {
    await reply.code(401).send({ message: "Invalid or expired session" });
    return null;
  }

  return { session, token };
}
