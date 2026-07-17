import type { Prisma, PrismaClient, User } from "@prisma/client";
import { pointRules } from "@playpoint/shared";
import { grantXpForPointAward, type LevelProgress } from "./progression";

type DbClient = Prisma.TransactionClient | PrismaClient;

type ProfileCompletionUser = Pick<
  User,
  "avatarUrl" | "birthDate" | "displayName" | "emailVerifiedAt" | "interests" | "passwordSetAt" | "phoneVerifiedAt"
>;

export type ProfileCompletionProgress = {
  awarded: boolean;
  percent: number;
  rewardPoints: number;
  tasks: Array<{
    completed: boolean;
    key: "avatar" | "birthDate" | "displayName" | "email" | "interests" | "password" | "phone";
    label: string;
  }>;
};

const profileCompletionAwardKey = "profile-completion";

export function buildProfileCompletionProgress(
  user: ProfileCompletionUser,
  awarded = false
): ProfileCompletionProgress {
  const tasks: ProfileCompletionProgress["tasks"] = [
    {
      completed: user.displayName.trim().length >= 3,
      key: "displayName",
      label: "Display name"
    },
    {
      completed: Boolean(user.phoneVerifiedAt),
      key: "phone",
      label: "Phone verified"
    },
    {
      completed: Boolean(user.emailVerifiedAt),
      key: "email",
      label: "Email verified"
    },
    {
      completed: Boolean(user.avatarUrl),
      key: "avatar",
      label: "Avatar"
    },
    {
      completed: user.interests.length === 3,
      key: "interests",
      label: "Interests"
    },
    {
      completed: Boolean(user.birthDate),
      key: "birthDate",
      label: "Birth date"
    },
    {
      completed: Boolean(user.passwordSetAt),
      key: "password",
      label: "Password"
    }
  ];
  const completedCount = tasks.filter((task) => task.completed).length;

  return {
    awarded,
    percent: Math.round((completedCount / tasks.length) * 100),
    rewardPoints: pointRules.profileCompletionBonus,
    tasks
  };
}

export async function awardProfileCompletionBonusIfReady(
  db: DbClient,
  userId: string
): Promise<{
  levelProgress: LevelProgress | null;
  profileCompletion: ProfileCompletionProgress;
  user: User;
}> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      avatarUrl: true,
      birthDate: true,
      displayName: true,
      emailVerifiedAt: true,
      interests: true,
      passwordSetAt: true,
      phoneVerifiedAt: true
    }
  });
  const fullUser = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const existingBonus = await db.pointBonus.findUnique({
    where: {
      userId_awardKey: {
        awardKey: profileCompletionAwardKey,
        userId
      }
    },
    select: { id: true }
  });
  const profileCompletion = buildProfileCompletionProgress(user, Boolean(existingBonus));

  if (existingBonus || profileCompletion.percent < 100) {
    return {
      levelProgress: null,
      profileCompletion,
      user: fullUser
    };
  }

  await db.pointBonus.create({
    data: {
      awardKey: profileCompletionAwardKey,
      points: pointRules.profileCompletionBonus,
      reason: "profile_completion",
      userId
    }
  });

  await db.user.update({
    where: { id: userId },
    data: {
      totalPoints: {
        increment: pointRules.profileCompletionBonus
      }
    }
  });

  const xpResult = await grantXpForPointAward(db, userId);
  const completedUser = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      avatarUrl: true,
      birthDate: true,
      displayName: true,
      emailVerifiedAt: true,
      interests: true,
      passwordSetAt: true,
      phoneVerifiedAt: true
    }
  });

  return {
    levelProgress: xpResult.progress,
    profileCompletion: buildProfileCompletionProgress(completedUser, true),
    user: xpResult.user
  };
}
