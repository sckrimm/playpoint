import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { hashPassword, requireSession } from "../modules/auth/auth.helpers";
import { getDailyLoginProgress } from "../modules/points/daily-login";
import { awardProfileCompletionBonusIfReady, buildProfileCompletionProgress } from "../modules/points/profile-completion";
import { awardReferralBonuses } from "../modules/points/referral-bonus";
import { buildLevelProgress, type LevelProgress } from "../modules/points/progression";
import { ensureReferralCode, findReferrerId } from "../modules/referrals/referral.helpers";

const profileInterestIds = [
  "food",
  "coffee",
  "cinema",
  "gaming",
  "tech",
  "fitness",
  "music",
  "travel",
  "fashion",
  "sports"
] as const;

const updateMeSchema = z.object({
  avatarUrl: z.string().trim().min(1).max(2000).nullable().optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  displayName: z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N}_ ]+$/u).optional(),
  referralCode: z.string().trim().min(4).max(16).optional(),
  interests: z
    .array(z.enum(profileInterestIds))
    .length(3)
    .refine((items) => new Set(items).size === items.length, "Interests must be unique")
    .optional(),
  password: z.string().min(6).max(72).optional(),
  passwordConfirm: z.string().min(6).max(72).optional()
}).refine((data) => !data.password && !data.passwordConfirm ? true : data.password === data.passwordConfirm, {
  message: "Passwords do not match",
  path: ["passwordConfirm"]
});

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function bonusDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" });
}

async function getRank(userId: string) {
  const rankedUsers = await prisma.user.findMany({
    orderBy: [{ totalPoints: "desc" }, { createdAt: "asc" }],
    select: { id: true },
    take: 1000
  });
  const index = rankedUsers.findIndex((user) => user.id === userId);
  return index >= 0 ? index + 1 : null;
}

async function getMePayload(userId: string) {
  const today = startOfToday();
  await ensureReferralCode(prisma, userId);
  const [
    user,
    rewardClaims,
    rewardEngagements,
    profileCompletionBonus,
    gameHistory,
    gamesPlayed,
    dailyRank,
    weeklyRank,
    games,
    rewards,
    attemptsToday,
    dailyLogin,
    referralCount
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        avatarUrl: true,
        birthDate: true,
        coins: true,
        createdAt: true,
        displayName: true,
        email: true,
        emailVerifiedAt: true,
        id: true,
        interests: true,
        level: true,
        phone: true,
        phoneVerifiedAt: true,
        passwordSetAt: true,
        referralCode: true,
        referredById: true,
        role: true,
        totalPoints: true,
        totalXp: true,
        updatedAt: true,
        xp: true
      }
    }),
    prisma.rewardClaim.findMany({
      where: { userId },
      include: {
        reward: {
          include: {
            brand: {
              select: {
                id: true,
                logoUrl: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.pointBonus.findMany({
      where: {
        awardKey: {
          startsWith: `reward-engagement:${bonusDateKey()}`
        },
        userId
      },
      select: {
        awardKey: true
      }
    }),
    prisma.pointBonus.findUnique({
      where: {
        userId_awardKey: {
          awardKey: "profile-completion",
          userId
        }
      },
      select: {
        id: true
      }
    }),
    prisma.score.findMany({
      where: { userId },
      include: {
        game: {
          select: {
            slug: true,
            title: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.score.count({ where: { userId } }),
    getRank(userId),
    getRank(userId),
    prisma.game.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: {
        dailyAttemptLimit: true,
        id: true,
        slug: true
      }
    }),
    prisma.reward.findMany({
      where: { active: true },
      select: {
        id: true,
        slug: true
      }
    }),
    prisma.gameAttempt.groupBy({
      by: ["gameId"],
      where: {
        startedAt: {
          gte: today
        },
        userId
      },
      _count: {
        gameId: true
      }
    }),
    getDailyLoginProgress(prisma, userId),
    prisma.user.count({
      where: {
        referredById: userId
      }
    })
  ]);
  const attemptsByGameId = new Map(attemptsToday.map((attempt) => [attempt.gameId, attempt._count.gameId]));
  const rewardSlugById = new Map(rewards.map((reward) => [reward.id, reward.slug]));

  return {
    user,
    gameHistory: gameHistory.map((score) => ({
      id: score.id,
      createdAt: score.createdAt,
      gameSlug: score.game.slug,
      gameTitle: score.game.title,
      playPoints: score.playPoints,
      rawScore: score.rawScore
    })),
    stats: {
      dailyRank,
      gameAttempts: games.map((game) => {
        const usedAttempts = attemptsByGameId.get(game.id) ?? 0;
        return {
          attemptsLeft: Math.max(0, game.dailyAttemptLimit - usedAttempts),
          dailyAttemptLimit: game.dailyAttemptLimit,
          gameSlug: game.slug,
          usedAttempts
        };
      }),
      dailyLogin,
      levelProgress: buildLevelProgress(user),
      profileCompletion: buildProfileCompletionProgress(user, Boolean(profileCompletionBonus)),
      referralCount,
      rewardEngagements: rewardEngagements
        .map((engagement) => {
          const rewardKey = engagement.awardKey.split(":").at(-1) ?? "";
          return rewardSlugById.get(rewardKey) ?? rewardKey;
        })
        .filter((rewardKey) => rewards.some((reward) => reward.slug === rewardKey)),
      gamesPlayed,
      weeklyRank
    },
    rewardClaims
  };
}

export function registerMeRoutes(app: FastifyInstance) {
  app.get("/me", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;
    return getMePayload(auth.session.userId);
  });

  app.patch("/me", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;

    const parsed = updateMeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid profile payload", issues: parsed.error.issues });

    if (parsed.data.displayName) {
      const existingUser = await prisma.user.findFirst({
        where: {
          displayName: parsed.data.displayName,
          id: {
            not: auth.session.userId
          }
        },
        select: { id: true }
      });

      if (existingUser) return reply.code(409).send({ message: "Display name is already taken" });
    }

    try {
      const updateData: Prisma.UserUpdateInput = {};
      const requestedReferralCode = parsed.data.referralCode?.trim().toUpperCase();
      if ("avatarUrl" in parsed.data) updateData.avatarUrl = parsed.data.avatarUrl;
      if ("birthDate" in parsed.data) updateData.birthDate = parsed.data.birthDate ? new Date(`${parsed.data.birthDate}T00:00:00.000Z`) : null;
      if (parsed.data.displayName) updateData.displayName = parsed.data.displayName;
      if (parsed.data.interests) updateData.interests = parsed.data.interests;
      if (parsed.data.password) {
        updateData.passwordHash = hashPassword(parsed.data.password);
        updateData.passwordSetAt = new Date();
      }

      const result = await prisma.$transaction(async (tx) => {
        let referralLevelProgress: LevelProgress | null = null;
        if (requestedReferralCode) {
          const currentUser = await tx.user.findUniqueOrThrow({
            where: { id: auth.session.userId },
            select: {
              referralCode: true,
              referredById: true
            }
          });
          if (currentUser.referredById) throw new Error("REFERRAL_ALREADY_SET");
          if (currentUser.referralCode === requestedReferralCode) throw new Error("INVALID_REFERRAL_CODE");

          const referrerId = await findReferrerId(tx, requestedReferralCode);
          if (!referrerId || referrerId === auth.session.userId) throw new Error("INVALID_REFERRAL_CODE");
          updateData.referredBy = { connect: { id: referrerId } };
          const referralBonusResult = await awardReferralBonuses(tx, auth.session.userId, referrerId);
          referralLevelProgress = referralBonusResult.inviteeLevelProgress;
        }

        await tx.user.update({
          where: { id: auth.session.userId },
          data: updateData
        });
        const profileCompletionResult = await awardProfileCompletionBonusIfReady(tx, auth.session.userId);
        return {
          ...profileCompletionResult,
          levelProgress: profileCompletionResult.levelProgress ?? referralLevelProgress
        };
      });

      const payload = await getMePayload(auth.session.userId);
      return {
        ...payload,
        levelProgress: result.levelProgress,
        profileCompletion: result.profileCompletion,
        user: result.user
      };
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return reply.code(409).send({ message: "Display name is already taken" });
      }
      if (error instanceof Error && error.message === "INVALID_REFERRAL_CODE") {
        return reply.code(400).send({ message: "Invalid referral code" });
      }
      if (error instanceof Error && error.message === "REFERRAL_ALREADY_SET") {
        return reply.code(409).send({ message: "Referral code is already applied" });
      }
      throw error;
    }
  });

  app.get("/me/reward-claims", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;

    return prisma.rewardClaim.findMany({
      where: { userId: auth.session.userId },
      include: {
        reward: {
          include: {
            brand: {
              select: {
                id: true,
                logoUrl: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  });
}
