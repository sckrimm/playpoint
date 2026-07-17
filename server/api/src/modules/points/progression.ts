import type { Prisma, PrismaClient, User } from "@prisma/client";
import { getLevelBonusPoints, getLevelXpRequirement, pointRules } from "@playpoint/shared";

type DbClient = Prisma.TransactionClient | PrismaClient;

export type LevelProgress = {
  level: number;
  levelBonusPoints: number;
  progressPercent: number;
  xp: number;
  xpAwarded: number;
  xpRequired: number;
  levelUps: Array<{
    bonusPoints: number;
    level: number;
  }>;
};

export function buildLevelProgress(user: Pick<User, "level" | "xp">, xpAwarded = 0, levelUps: LevelProgress["levelUps"] = []): LevelProgress {
  const xpRequired = getLevelXpRequirement(user.level);

  return {
    level: user.level,
    levelBonusPoints: getLevelBonusPoints(user.level),
    progressPercent: xpRequired > 0 ? Math.min(100, Math.round((user.xp / xpRequired) * 100)) : 0,
    xp: user.xp,
    xpAwarded,
    xpRequired,
    levelUps
  };
}

export async function grantXpForPointAward(
  db: DbClient,
  userId: string
): Promise<{
  progress: LevelProgress;
  user: User;
}> {
  const currentUser = await db.user.findUniqueOrThrow({ where: { id: userId } });
  let nextLevel = currentUser.level;
  let nextXp = currentUser.xp + pointRules.xpPerPointAward;
  let levelBonusTotal = 0;
  const levelUps: LevelProgress["levelUps"] = [];

  while (nextXp >= getLevelXpRequirement(nextLevel)) {
    nextXp -= getLevelXpRequirement(nextLevel);
    nextLevel += 1;
    const bonusPoints = getLevelBonusPoints(nextLevel - 1);
    levelBonusTotal += bonusPoints;
    levelUps.push({
      bonusPoints,
      level: nextLevel
    });
  }

  for (const levelUp of levelUps) {
    await db.pointBonus.create({
      data: {
        awardKey: `level-up:${levelUp.level}`,
        points: levelUp.bonusPoints,
        reason: "level_up",
        userId
      }
    });
  }

  const user = await db.user.update({
    where: { id: userId },
    data: {
      level: nextLevel,
      totalPoints: {
        increment: levelBonusTotal
      },
      totalXp: {
        increment: pointRules.xpPerPointAward
      },
      xp: nextXp
    }
  });

  return {
    progress: buildLevelProgress(user, pointRules.xpPerPointAward, levelUps),
    user
  };
}
