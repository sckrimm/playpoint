import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";

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

async function getLeaderboard(since: Date) {
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
    include: {
      game: {
        select: {
          title: true,
          slug: true
        }
      },
      user: {
        select: {
          displayName: true,
          avatarUrl: true
        }
      }
    },
    take: 100
  });

  return scores.map((score: {
    createdAt: Date;
    game: {
      title: string;
      slug: string;
    };
    playPoints: number;
    rawScore: number;
    user: {
      displayName: string;
      avatarUrl: string | null;
    };
  }, index: number) => ({
    rank: index + 1,
    userName: score.user.displayName,
    avatarUrl: score.user.avatarUrl,
    gameTitle: score.game.title,
    gameSlug: score.game.slug,
    rawScore: score.rawScore,
    playPoints: score.playPoints,
    createdAt: score.createdAt
  }));
}

export function registerLeaderboardRoutes(app: FastifyInstance) {
  app.get("/leaderboard/daily", async () => getLeaderboard(startOfToday()));

  app.get("/leaderboard/weekly", async () => getLeaderboard(startOfWeek()));
}
