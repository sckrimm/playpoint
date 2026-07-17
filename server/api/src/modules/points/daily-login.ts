import type { Prisma, PrismaClient, User } from "@prisma/client";
import { pointRules } from "@playpoint/shared";
import { grantXpForPointAward, type LevelProgress } from "./progression";

type DbClient = Prisma.TransactionClient | PrismaClient;

export type DailyLoginProgress = {
  cycleProgress: number;
  pointsPerDay: number;
  todayClaimed: boolean;
  totalClaims: number;
  weekDays: Array<{
    claimed: boolean;
    index: number;
  }>;
};

function bonusDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" });
}

function dailyAwardKey(date = new Date()) {
  return `daily-login:${bonusDateKey(date)}`;
}

function buildProgress(totalClaims: number, todayClaimed: boolean): DailyLoginProgress {
  const cycleProgress = totalClaims > 0 && totalClaims % 7 === 0 ? 7 : totalClaims % 7;

  return {
    cycleProgress,
    pointsPerDay: pointRules.dailyLoginBonus,
    todayClaimed,
    totalClaims,
    weekDays: Array.from({ length: 7 }, (_, index) => ({
      claimed: index < cycleProgress,
      index: index + 1
    }))
  };
}

export async function getDailyLoginProgress(db: DbClient, userId: string) {
  const todayAwardKey = dailyAwardKey();
  const [totalClaims, todayBonus] = await Promise.all([
    db.pointBonus.count({
      where: {
        reason: "daily_login",
        userId
      }
    }),
    db.pointBonus.findUnique({
      where: {
        userId_awardKey: {
          awardKey: todayAwardKey,
          userId
        }
      },
      select: { id: true }
    })
  ]);

  return buildProgress(totalClaims, Boolean(todayBonus));
}

export async function awardDailyLoginBonus(db: DbClient, userId: string): Promise<{
  awardedToday: boolean;
  levelProgress: LevelProgress | null;
  progress: DailyLoginProgress;
  user: User;
}> {
  const todayAwardKey = dailyAwardKey();
  const dailyBonus = await db.pointBonus.findUnique({
    where: {
      userId_awardKey: {
        awardKey: todayAwardKey,
        userId
      }
    },
    select: { id: true }
  });

  if (dailyBonus) {
    const [user, progress] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: userId } }),
      getDailyLoginProgress(db, userId)
    ]);

    return {
      awardedToday: false,
      levelProgress: null,
      progress,
      user
    };
  }

  await db.pointBonus.create({
    data: {
      awardKey: todayAwardKey,
      points: pointRules.dailyLoginBonus,
      reason: "daily_login",
      userId
    }
  });

  let user = await db.user.update({
    where: { id: userId },
    data: {
      totalPoints: {
        increment: pointRules.dailyLoginBonus
      }
    }
  });
  const xpResult = await grantXpForPointAward(db, userId);
  user = xpResult.user;
  const progress = await getDailyLoginProgress(db, userId);

  return {
    awardedToday: true,
    levelProgress: xpResult.progress,
    progress,
    user
  };
}
