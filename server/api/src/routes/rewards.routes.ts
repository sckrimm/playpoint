import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireSession } from "../modules/auth/auth.helpers";

const rewardParamsSchema = z.object({
  rewardId: z.string().min(1)
});

export function registerRewardRoutes(app: FastifyInstance) {
  app.get("/rewards", async () => {
    return prisma.reward.findMany({
      where: { active: true },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
            logoUrl: true
          }
        }
      },
      orderBy: [{ requiredPoints: "asc" }, { title: "asc" }]
    });
  });

  app.post("/rewards/:rewardId/claim", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;

    const params = rewardParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid reward id", issues: params.error.issues });

    const reward = await prisma.reward.findFirst({
      where: {
        OR: [{ id: params.data.rewardId }, { slug: params.data.rewardId }]
      },
      include: {
        brand: {
          select: {
            id: true,
            logoUrl: true,
            name: true
          }
        }
      }
    });

    if (!reward || !reward.active) {
      return reply.code(404).send({ message: "Reward not found or inactive" });
    }

    if (reward.expiresAt && reward.expiresAt <= new Date()) {
      return reply.code(410).send({ message: "Reward is expired" });
    }

    if (reward.claimedCount >= reward.quantity) {
      return reply.code(409).send({ message: "Reward is out of stock" });
    }

    const existingClaim = await prisma.rewardClaim.findUnique({
      where: {
        userId_rewardId: {
          rewardId: reward.id,
          userId: auth.session.userId
        }
      }
    });

    if (existingClaim) {
      return reply.code(409).send({ message: "Reward already claimed" });
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.session.userId },
      select: {
        totalPoints: true
      }
    });

    if (user.totalPoints < reward.requiredPoints) {
      return reply.code(402).send({
        currentPoints: user.totalPoints,
        message: "Not enough points",
        requiredPoints: reward.requiredPoints
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedReward = await tx.reward.updateMany({
        where: {
          id: reward.id,
          active: true,
          claimedCount: {
            lt: reward.quantity
          },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        data: {
          claimedCount: {
            increment: 1
          }
        }
      });

      if (updatedReward.count !== 1) {
        throw new Error("REWARD_UNAVAILABLE");
      }

      const updatedUser = await tx.user.updateMany({
        where: {
          id: auth.session.userId,
          totalPoints: {
            gte: reward.requiredPoints
          }
        },
        data: {
          totalPoints: {
            decrement: reward.requiredPoints
          }
        }
      });

      if (updatedUser.count !== 1) {
        throw new Error("NOT_ENOUGH_POINTS");
      }

      const claim = await tx.rewardClaim.create({
        data: {
          pointsSpent: reward.requiredPoints,
          rewardId: reward.id,
          status: "approved",
          userId: auth.session.userId
        },
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
        }
      });

      const refreshedUser = await tx.user.findUniqueOrThrow({
        where: { id: auth.session.userId },
        select: {
          coins: true,
          displayName: true,
          id: true,
          totalPoints: true
        }
      });

      return { claim, user: refreshedUser };
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "REWARD_UNAVAILABLE") return "REWARD_UNAVAILABLE" as const;
      if (error instanceof Error && error.message === "NOT_ENOUGH_POINTS") return "NOT_ENOUGH_POINTS" as const;
      throw error;
    });

    if (result === "REWARD_UNAVAILABLE") {
      return reply.code(409).send({ message: "Reward is no longer available" });
    }

    if (result === "NOT_ENOUGH_POINTS") {
      return reply.code(402).send({ message: "Not enough points" });
    }

    return result;
  });
}
