import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireSession } from "../modules/auth/auth.helpers";

const updateMeSchema = z.object({
  avatarUrl: z.string().url().nullable().optional(),
  displayName: z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N}_ ]+$/u).optional()
});

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
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
  const [user, rewardClaims, gameHistory, gamesPlayed, dailyRank, weeklyRank, games, attemptsToday] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        avatarUrl: true,
        coins: true,
        createdAt: true,
        displayName: true,
        id: true,
        phone: true,
        role: true,
        totalPoints: true,
        updatedAt: true
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
    })
  ]);
  const attemptsByGameId = new Map(attemptsToday.map((attempt) => [attempt.gameId, attempt._count.gameId]));

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
      await prisma.user.update({
        where: { id: auth.session.userId },
        data: parsed.data
      });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return reply.code(409).send({ message: "Display name is already taken" });
      }
      throw error;
    }

    return getMePayload(auth.session.userId);
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
