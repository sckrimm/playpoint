import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";

async function getLeaderboard() {
  const users = await prisma.user.findMany({
    orderBy: [{ seasonScore: "desc" }, { createdAt: "asc" }],
    select: {
      avatarUrl: true,
      createdAt: true,
      displayName: true,
      id: true,
      seasonScore: true,
      totalPoints: true
    },
    take: 100
  });

  return users.map((user, index) => ({
      rank: index + 1,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      gameSlug: "bonus",
      gameTitle: "Season Score",
      playPoints: user.seasonScore,
      rawScore: user.seasonScore,
      userId: user.id,
      userName: user.displayName
    }));
}

export function registerLeaderboardRoutes(app: FastifyInstance) {
  app.get("/leaderboard/daily", async () => getLeaderboard());

  app.get("/leaderboard/weekly", async () => getLeaderboard());
}
