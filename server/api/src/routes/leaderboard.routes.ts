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
    orderBy: [{ createdAt: "asc" }],
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
    take: 1000
  });

  const players = new Map<
    string,
    {
      avatarUrl: string | null;
      createdAt: Date;
      gameSlug: string;
      gameTitle: string;
      playPoints: number;
      rawScore: number;
      topScore: number;
      userName: string;
    }
  >();

  scores.forEach((score: {
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
    userId: string;
  }) => {
    const existingPlayer = players.get(score.userId);
    if (!existingPlayer) {
      players.set(score.userId, {
        avatarUrl: score.user.avatarUrl,
        createdAt: score.createdAt,
        gameSlug: score.game.slug,
        gameTitle: score.game.title,
        playPoints: score.playPoints,
        rawScore: score.rawScore,
        topScore: score.playPoints,
        userName: score.user.displayName
      });
      return;
    }

    if (score.playPoints > existingPlayer.topScore) {
      existingPlayer.gameSlug = score.game.slug;
      existingPlayer.gameTitle = score.game.title;
      existingPlayer.topScore = score.playPoints;
    }
    existingPlayer.playPoints += score.playPoints;
    existingPlayer.rawScore += score.rawScore;
  });

  return Array.from(players.values())
    .sort((first, second) => second.playPoints - first.playPoints || first.createdAt.getTime() - second.createdAt.getTime())
    .slice(0, 100)
    .map(({ topScore, ...player }, index) => ({
      rank: index + 1,
      ...player
    }));
}

export function registerLeaderboardRoutes(app: FastifyInstance) {
  app.get("/leaderboard/daily", async () => getLeaderboard(startOfToday()));

  app.get("/leaderboard/weekly", async () => getLeaderboard(startOfWeek()));
}
