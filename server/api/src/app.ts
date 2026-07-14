import Fastify from "fastify";
import { env } from "./env";
import { prisma } from "./db/prisma";
import { registerAuthRoutes } from "./routes/auth.routes";
import { registerGameRoutes } from "./routes/games.routes";
import { registerHealthRoutes } from "./routes/health.routes";
import { registerLeaderboardRoutes } from "./routes/leaderboard.routes";
import { registerMeRoutes } from "./routes/me.routes";
import { registerRewardRoutes } from "./routes/rewards.routes";

export function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV !== "test"
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerGameRoutes(app);
  registerRewardRoutes(app);
  registerLeaderboardRoutes(app);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
