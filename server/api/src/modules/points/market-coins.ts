import type { Prisma, PrismaClient } from "@prisma/client";
import { pointRules } from "@playpoint/shared";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type MarketCoinExpiryResult = {
  dryRun: boolean;
  expiredCoins: number;
  expiredLots: number;
};

export function getMarketCoinExpiryDate(date = new Date()) {
  const expiresAt = new Date(date);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + pointRules.marketCoinExpiryDays);
  return expiresAt;
}

export async function addMarketCoins(
  db: DbClient,
  userId: string,
  amount: number,
  options: { referenceId?: string; source: string }
) {
  if (amount <= 0) return;

  await db.marketCoinTransaction.create({
    data: {
      amount,
      expiresAt: getMarketCoinExpiryDate(),
      referenceId: options.referenceId,
      remainingAmount: amount,
      source: options.source,
      type: "earned_conversion",
      userId
    }
  });
}

export async function spendMarketCoins(
  db: Prisma.TransactionClient,
  userId: string,
  amount: number,
  options: { referenceId?: string; source: string }
) {
  if (amount <= 0) return;

  let remainingToSpend = amount;
  const lots = await db.marketCoinTransaction.findMany({
    where: {
      userId,
      remainingAmount: {
        gt: 0
      },
      type: "earned_conversion",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }]
  });

  for (const lot of lots) {
    if (remainingToSpend <= 0) break;
    const spendFromLot = Math.min(lot.remainingAmount, remainingToSpend);
    await db.marketCoinTransaction.update({
      where: {
        id: lot.id
      },
      data: {
        remainingAmount: {
          decrement: spendFromLot
        }
      }
    });
    remainingToSpend -= spendFromLot;
  }

  await db.marketCoinTransaction.create({
    data: {
      amount: -amount,
      referenceId: options.referenceId,
      remainingAmount: 0,
      source: options.source,
      type: "spent_reward",
      userId
    }
  });
}

export async function expireMarketCoins(
  db: PrismaClient,
  options: { dryRun?: boolean; now?: Date } = {}
): Promise<MarketCoinExpiryResult> {
  const dryRun = Boolean(options.dryRun);
  const now = options.now ?? new Date();
  const expiredLots = await db.marketCoinTransaction.findMany({
    where: {
      expiresAt: {
        lte: now
      },
      remainingAmount: {
        gt: 0
      },
      type: "earned_conversion"
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }]
  });

  const expiredCoins = expiredLots.reduce((total, lot) => total + lot.remainingAmount, 0);
  if (dryRun || expiredCoins <= 0) {
    return { dryRun, expiredCoins, expiredLots: expiredLots.length };
  }

  await db.$transaction(async (tx) => {
    for (const lot of expiredLots) {
      await tx.marketCoinTransaction.update({
        where: {
          id: lot.id
        },
        data: {
          remainingAmount: 0
        }
      });

      await tx.marketCoinTransaction.create({
        data: {
          amount: -lot.remainingAmount,
          referenceId: lot.id,
          remainingAmount: 0,
          source: "market_coin_expiry",
          type: "expired",
          userId: lot.userId
        }
      });

      await tx.user.update({
        where: {
          id: lot.userId
        },
        data: {
          marketCoins: {
            decrement: lot.remainingAmount
          }
        }
      });
    }
  });

  return { dryRun, expiredCoins, expiredLots: expiredLots.length };
}
