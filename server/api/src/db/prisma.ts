import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var playpointPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.playpointPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.playpointPrisma = prisma;
}
