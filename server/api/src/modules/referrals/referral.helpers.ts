import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = Prisma.TransactionClient | PrismaClient;

function createReferralCode() {
  return crypto.randomBytes(5).toString("base64url").replace(/[-_]/g, "").toUpperCase().slice(0, 8);
}

export async function ensureReferralCode(db: DbClient, userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      referralCode: true
    }
  });

  if (user.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const referralCode = createReferralCode();
    try {
      await db.user.update({
        where: { id: userId },
        data: { referralCode }
      });
      return referralCode;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }

  const fallbackCode = `P${userId.slice(-7).toUpperCase()}`;
  await db.user.update({
    where: { id: userId },
    data: { referralCode: fallbackCode }
  });
  return fallbackCode;
}

export async function findReferrerId(db: DbClient, referralCode: string | null | undefined) {
  const normalizedCode = referralCode?.trim().toUpperCase();
  if (!normalizedCode) return null;

  const referrer = await db.user.findUnique({
    where: { referralCode: normalizedCode },
    select: { id: true }
  });

  return referrer?.id ?? null;
}
