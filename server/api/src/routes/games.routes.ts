import type { FastifyInstance } from "fastify";
import { calculatePlayPoints } from "@playpoint/shared";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { createSessionToken, hashScoreToken, requireSession } from "../modules/auth/auth.helpers";

const gameParamsSchema = z.object({
  gameId: z.string().min(1)
});

const finishGameSchema = z.object({
  accuracy: z.number().int().min(0).max(100).optional(),
  attemptId: z.string().min(1),
  durationSeconds: z.number().int().min(1).max(120),
  hits: z.number().int().min(0).optional(),
  maxCombo: z.number().int().min(0).optional(),
  misses: z.number().int().min(0).optional(),
  rawScore: z.number().int().min(0).max(1_000_000),
  scoreToken: z.string().min(16)
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

async function getUserRank(userId: string, since: Date) {
  const scores = await prisma.score.findMany({
    where: {
      createdAt: {
        gte: since
      },
      verificationStatus: {
        not: "suspicious"
      }
    },
    orderBy: [{ playPoints: "desc" }, { createdAt: "asc" }],
    select: {
      userId: true
    },
    take: 500
  });

  const index = scores.findIndex((score) => score.userId === userId);
  return index >= 0 ? index + 1 : null;
}

export function registerGameRoutes(app: FastifyInstance) {
  app.get("/games", async () => {
    return prisma.game.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" }
    });
  });

  app.get("/mvp/home", async () => {
    const [games, leaderboard, rewards] = await Promise.all([
      prisma.game.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        take: 3
      }),
      prisma.score.findMany({
        orderBy: [{ playPoints: "desc" }, { createdAt: "asc" }],
        include: {
          user: {
            select: {
              displayName: true,
              avatarUrl: true
            }
          }
        },
        take: 3
      }),
      prisma.reward.findMany({
        where: { active: true },
        include: {
          brand: {
            select: {
              name: true,
              logoUrl: true
            }
          }
        },
        orderBy: { requiredPoints: "asc" },
        take: 2
      })
    ]);

    return {
      games,
      leaderboard: leaderboard.map((score: {
        user: {
          displayName: string;
          avatarUrl: string | null;
        };
        playPoints: number;
      }, index: number) => ({
        rank: index + 1,
        name: score.user.displayName,
        avatarUrl: score.user.avatarUrl,
        points: score.playPoints
      })),
      rewards
    };
  });

  app.post("/games/:gameId/start", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;

    const params = gameParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid game id", issues: params.error.issues });

    const game = await prisma.game.findUnique({
      where: { slug: params.data.gameId }
    });

    if (!game || !game.active) {
      return reply.code(404).send({ message: "Game not found or inactive" });
    }

    const attemptsToday = await prisma.gameAttempt.count({
      where: {
        gameId: game.id,
        startedAt: {
          gte: startOfToday()
        },
        userId: auth.session.userId
      }
    });

    if (attemptsToday >= game.dailyAttemptLimit) {
      return reply.code(429).send({
        attemptsLeft: 0,
        dailyAttemptLimit: game.dailyAttemptLimit,
        message: "Daily attempt limit reached"
      });
    }

    const scoreToken = createSessionToken();
    const attempt = await prisma.gameAttempt.create({
      data: {
        gameId: game.id,
        scoreToken: hashScoreToken(scoreToken),
        status: "started",
        userId: auth.session.userId
      }
    });

    return {
      attemptId: attempt.id,
      attemptsLeft: Math.max(0, game.dailyAttemptLimit - attemptsToday - 1),
      dailyAttemptLimit: game.dailyAttemptLimit,
      game: {
        id: game.id,
        slug: game.slug,
        title: game.title
      },
      scoreToken
    };
  });

  app.post("/games/:gameId/finish", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;

    const params = gameParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid game id", issues: params.error.issues });

    const body = finishGameSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Invalid score payload", issues: body.error.issues });

    const attempt = await prisma.gameAttempt.findFirst({
      where: {
        id: body.data.attemptId,
        userId: auth.session.userId
      },
      include: {
        game: true,
        score: true
      }
    });

    if (!attempt || attempt.game.slug !== params.data.gameId) {
      return reply.code(404).send({ message: "Game attempt not found" });
    }

    if (attempt.status !== "started" || attempt.score) {
      return reply.code(409).send({ message: "Game attempt is already finished" });
    }

    if (attempt.scoreToken !== hashScoreToken(body.data.scoreToken)) {
      return reply.code(401).send({ message: "Invalid score token" });
    }

    const playPoints = calculatePlayPoints(body.data.rawScore);
    const result = await prisma.$transaction(async (tx) => {
      const score = await tx.score.create({
        data: {
          accuracy: body.data.accuracy,
          attemptId: attempt.id,
          durationSeconds: body.data.durationSeconds,
          gameId: attempt.gameId,
          hits: body.data.hits,
          maxCombo: body.data.maxCombo,
          misses: body.data.misses,
          playPoints,
          rawScore: body.data.rawScore,
          userId: auth.session.userId,
          verificationStatus: "verified"
        }
      });

      await tx.gameAttempt.update({
        where: { id: attempt.id },
        data: {
          finishedAt: new Date(),
          status: "finished"
        }
      });

      const user = await tx.user.update({
        where: { id: auth.session.userId },
        data: {
          totalPoints: {
            increment: playPoints
          }
        },
        select: {
          coins: true,
          displayName: true,
          id: true,
          totalPoints: true
        }
      });

      return { score, user };
    });

    const [dailyRank, weeklyRank] = await Promise.all([
      getUserRank(auth.session.userId, startOfToday()),
      getUserRank(auth.session.userId, startOfWeek())
    ]);

    return {
      rank: {
        daily: dailyRank,
        weekly: weeklyRank
      },
      score: result.score,
      user: result.user
    };
  });
}
