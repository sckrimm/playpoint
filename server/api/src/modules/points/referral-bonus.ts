import type { Prisma, PrismaClient } from "@prisma/client";
import { pointRules } from "@playpoint/shared";
import { grantXpForPointAward, type LevelProgress } from "./progression";

type DbClient = Prisma.TransactionClient | PrismaClient;

type ReferralBonusResult = {
  inviteeLevelProgress: LevelProgress | null;
  referrerLevelProgress: LevelProgress | null;
};

async function awardReferralPoints(
  db: DbClient,
  userId: string,
  awardKey: string,
  points: number,
  reason: "referral_signup" | "referral_invite"
) {
  const existingBonus = await db.pointBonus.findUnique({
    where: {
      userId_awardKey: {
        awardKey,
        userId
      }
    },
    select: { id: true }
  });

  if (existingBonus) return null;

  await db.pointBonus.create({
    data: {
      awardKey,
      points,
      reason,
      userId
    }
  });

  await db.user.update({
    where: { id: userId },
    data: {
      totalPoints: {
        increment: points
      }
    }
  });

  return grantXpForPointAward(db, userId);
}

export async function awardReferralBonuses(
  db: DbClient,
  inviteeUserId: string,
  referrerUserId: string
): Promise<ReferralBonusResult> {
  const inviteeBonus = await awardReferralPoints(
    db,
    inviteeUserId,
    `referral-signup:${referrerUserId}`,
    pointRules.referralSignupBonus,
    "referral_signup"
  );
  const referrerBonus = await awardReferralPoints(
    db,
    referrerUserId,
    `referral-invite:${inviteeUserId}`,
    pointRules.referralInviteBonus,
    "referral_invite"
  );

  return {
    inviteeLevelProgress: inviteeBonus?.progress ?? null,
    referrerLevelProgress: referrerBonus?.progress ?? null
  };
}
