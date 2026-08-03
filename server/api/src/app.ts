import Fastify from "fastify";
import { env } from "./env";
import { prisma } from "./db/prisma";
import { registerAdminRoutes } from "./routes/admin.routes";
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
  registerAdminRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const message =
      error.message.includes("does not exist in the current database") ||
      error.message.includes("Invalid `prisma.")
        ? "Database schema is not synced. Run Prisma db push and restart the API."
        : env.NODE_ENV === "production"
          ? "Internal server error"
          : error.message;

    return reply.code(500).send({ message });
  });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
