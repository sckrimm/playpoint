import Fastify from "fastify";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env";
import { prisma } from "./db/prisma";
import { registerAdminRoutes } from "./routes/admin.routes";
import { registerAuthRoutes } from "./routes/auth.routes";
import { registerGameRoutes } from "./routes/games.routes";
import { registerHealthRoutes } from "./routes/health.routes";
import { registerLeaderboardRoutes } from "./routes/leaderboard.routes";
import { registerMeRoutes } from "./routes/me.routes";
import { registerRewardRoutes } from "./routes/rewards.routes";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const webDistPath = path.resolve(currentDir, "../../../apps/web/dist");
const webIndexPath = path.join(webDistPath, "index.html");
const botInternalUrl = `http://127.0.0.1:${process.env.BOT_INTERNAL_PORT ?? "4173"}`;

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function getWebAssetPath(requestPath: string) {
  let decodedPath = "/";

  try {
    decodedPath = decodeURIComponent(requestPath.split("?")[0] ?? "/");
  } catch {
    decodedPath = "/";
  }

  const normalizedPath = path
    .normalize(decodedPath)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const candidatePath = path.join(webDistPath, normalizedPath);

  if (!candidatePath.startsWith(webDistPath)) {
    return null;
  }

  return candidatePath;
}

export function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV !== "test"
  });

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, body)
  );

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

  app.all("/bot", async (_request, reply) => reply.redirect("/bot/", 308));
  app.all("/bot/*", async (request, reply) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && !["host", "content-length", "connection"].includes(name)) {
        headers.set(name, Array.isArray(value) ? value.join(",") : value);
      }
    }
    const hasBody = !["GET", "HEAD"].includes(request.method);
    const proxyBody = !hasBody || request.body === undefined
      ? undefined
      : typeof request.body === "string" || request.body instanceof Buffer
        ? request.body
        : JSON.stringify(request.body);
    const upstream = await fetch(`${botInternalUrl}${request.url}`, {
      method: request.method,
      headers,
      body: proxyBody,
      redirect: "manual",
    });
    const contentType = upstream.headers.get("content-type");
    const location = upstream.headers.get("location");
    const setCookie = upstream.headers.get("set-cookie");
    const cacheControl = upstream.headers.get("cache-control");
    if (contentType) reply.type(contentType);
    if (location) reply.header("location", location);
    if (setCookie) reply.header("set-cookie", setCookie);
    if (cacheControl) reply.header("cache-control", cacheControl);
    reply.code(upstream.status);
    return reply.send(Buffer.from(await upstream.arrayBuffer()));
  });

  app.get("/*", async (request, reply) => {
    const assetPath = getWebAssetPath(request.url);

    if (assetPath) {
      try {
        const assetStat = await stat(assetPath);
        if (assetStat.isFile()) {
          const extension = path.extname(assetPath).toLowerCase();
          return reply.type(mimeTypes[extension] ?? "application/octet-stream").send(await readFile(assetPath));
        }
      } catch {
        // Fall back to the SPA entry below.
      }
    }

    try {
      return reply.type("text/html; charset=utf-8").send(await readFile(webIndexPath));
    } catch {
      return reply.code(404).send({ message: "Web build not found. Run npm run build before starting the app." });
    }
  });

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
