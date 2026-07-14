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

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", request.headers.origin ?? "*");
    reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
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
