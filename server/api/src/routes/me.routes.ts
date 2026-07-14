import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireSession } from "../modules/auth/auth.helpers";

const updateMeSchema = z.object({
  avatarUrl: z.string().url().nullable().optional(),
  displayName: z.string().trim().min(1).max(60).optional()
});

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek() {
  const date = startOfToday();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

async function getRank(userId: string, since: Date) {
  const scores = await prisma.score.findMany({
    where: {
      createdAt: {
        gte: since
      },
      verificationStatus: {
        not: "suspicious"
      }
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      createdAt: true,
      playPoints: true,
      userId: true
    },
    take: 1000
  });

  const players = new Map<string, { createdAt: Date; playPoints: number }>();
  scores.forEach((score) => {
    const existingPlayer = players.get(score.userId);
    if (!existingPlayer) {
      players.set(score.userId, {
        createdAt: score.createdAt,
        playPoints: score.playPoints
      });
      return;
    }

    existingPlayer.playPoints += score.playPoints;
  });

  const rankedPlayers = Array.from(players.entries()).sort(
    ([, first], [, second]) => second.playPoints - first.playPoints || first.createdAt.getTime() - second.createdAt.getTime()
  );
  const index = rankedPlayers.findIndex(([rankedUserId]) => rankedUserId === userId);
  return index >= 0 ? index + 1 : null;
}

async function getMePayload(userId: string) {
  const today = startOfToday();
  const [user, rewardClaims, gamesPlayed, dailyRank, weeklyRank, games, attemptsToday] = await Promise.all([
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
    prisma.score.count({ where: { userId } }),
    getRank(userId, today),
    getRank(userId, startOfWeek()),
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

    await prisma.user.update({
      where: { id: auth.session.userId },
      data: parsed.data
    });

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
