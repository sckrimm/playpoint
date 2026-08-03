import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireSession } from "../modules/auth/auth.helpers";

const rewardAdminPayloadSchema = z.object({
  active: z.boolean().optional(),
  brandLogoUrl: z.string().trim().optional().nullable(),
  brandName: z.string().trim().min(1),
  category: z.enum(["food", "leisure", "tech", "gaming"]),
  description: z.string().trim().optional().nullable(),
  expiresAt: z.string().trim().optional().nullable(),
  imageUrl: z.string().trim().optional().nullable(),
  quantity: z.number().int().min(0),
  requiredPoints: z.number().int().min(0),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1)
});

const rewardAdminParamsSchema = z.object({
  rewardId: z.string().min(1)
});

const adminUserParamsSchema = z.object({
  userId: z.string().min(1)
});

const adminUserQuerySchema = z.object({
  q: z.string().trim().optional(),
  take: z.coerce.number().int().min(1).max(50).optional()
});

const roleChangeSchema = z.object({
  role: z.enum(["admin", "user"])
});

const manualAdjustmentSchema = z.object({
  amount: z.number().int().refine((value) => value !== 0, "Amount cannot be 0"),
  currency: z.enum(["season_score", "market_coin", "xp"]),
  note: z.string().trim().min(3).max(300)
});

const campaignAdminPayloadSchema = z.object({
  brandLogoUrl: z.string().trim().optional().nullable(),
  brandName: z.string().trim().min(1),
  endsAt: z.string().trim().min(1),
  gameIds: z.array(z.string().min(1)).default([]),
  rewardIds: z.array(z.string().min(1)).default([]),
  rulesText: z.string().trim().optional().nullable(),
  startsAt: z.string().trim().min(1),
  status: z.enum(["draft", "active", "paused", "completed"]),
  title: z.string().trim().min(1)
});

const campaignAdminParamsSchema = z.object({
  campaignId: z.string().min(1)
});

const gameAdminPayloadSchema = z.object({
  active: z.boolean(),
  comingSoon: z.boolean(),
  dailyAttemptLimit: z.number().int().min(0).max(100),
  description: z.string().trim().optional().nullable(),
  iconUrl: z.string().trim().optional().nullable(),
  pointRatio: z.number().min(0).max(100).optional().nullable(),
  scoringRule: z.string().trim().optional().nullable(),
  sortOrder: z.number().int().min(0),
  title: z.string().trim().min(1)
});

const gameAdminParamsSchema = z.object({
  gameId: z.string().min(1)
});

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const auth = await requireSession(request, reply);
  if (!auth) return null;
  if (auth.session.user.role !== "admin") {
    await reply.code(403).send({ message: "Admin access required" });
    return null;
  }
  return auth;
}

function selectAdminUserSummary() {
  return {
    avatarUrl: true,
    createdAt: true,
    displayName: true,
    email: true,
    emailVerifiedAt: true,
    id: true,
    level: true,
    marketCoins: true,
    phone: true,
    phoneVerifiedAt: true,
    role: true,
    seasonScore: true,
    totalXp: true,
    xp: true
  } as const;
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseRequiredDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function includeAdminCampaign() {
  return {
    brand: {
      select: {
        id: true,
        logoUrl: true,
        name: true
      }
    },
    games: {
      include: {
        game: {
          select: {
            id: true,
            slug: true,
            title: true
          }
        }
      }
    },
    rewards: {
      include: {
        reward: {
          select: {
            id: true,
            slug: true,
            title: true
          }
        }
      }
    }
  } as const;
}

function selectAdminGame() {
  return {
    active: true,
    comingSoon: true,
    dailyAttemptLimit: true,
    description: true,
    iconUrl: true,
    id: true,
    pointRatio: true,
    scoringRule: true,
    slug: true,
    sortOrder: true,
    title: true,
    updatedAt: true
  } as const;
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.get("/admin/economy", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const [
      usersCount,
      seasonScoreAggregate,
      gameScoreAggregate,
      marketCoinsAggregate,
      marketCoinsEarnedAggregate,
      marketCoinsSpentAggregate,
      marketCoinsExpiredAggregate,
      rewardsCount,
      rewardClaimsCount,
      recentUsers,
      topUsers,
      recentConversions,
      recentRewardClaims,
      recentMarketCoinTransactions
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.aggregate({ _sum: { seasonScore: true, lifetimeScore: true, totalXp: true } }),
      prisma.score.aggregate({ _sum: { playPoints: true } }),
      prisma.user.aggregate({ _sum: { marketCoins: true } }),
      prisma.marketCoinTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "earned_conversion" }
      }),
      prisma.marketCoinTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "spent_reward" }
      }),
      prisma.marketCoinTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "expired" }
      }),
      prisma.reward.count({ where: { active: true } }),
      prisma.rewardClaim.count(),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          createdAt: true,
          displayName: true,
          id: true,
          marketCoins: true,
          role: true,
          seasonScore: true
        },
        take: 12
      }),
      prisma.user.findMany({
        orderBy: [{ seasonScore: "desc" }, { createdAt: "asc" }],
        select: {
          displayName: true,
          id: true,
          marketCoins: true,
          seasonScore: true
        },
        take: 10
      }),
      prisma.seasonConversion.findMany({
        include: {
          user: {
            select: {
              displayName: true,
              id: true
            }
          }
        },
        orderBy: { convertedAt: "desc" },
        take: 12
      }),
      prisma.rewardClaim.findMany({
        include: {
          reward: {
            select: {
              title: true
            }
          },
          user: {
            select: {
              displayName: true,
              id: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 12
      }),
      prisma.marketCoinTransaction.findMany({
        include: {
          user: {
            select: {
              displayName: true,
              id: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);

    return {
      recentConversions,
      recentMarketCoinTransactions,
      recentRewardClaims,
      recentUsers,
      summary: {
        rewardClaimsCount,
        rewardsCount,
        totalMarketCoinsEarned: marketCoinsEarnedAggregate._sum.amount ?? 0,
        totalMarketCoinsExpired: Math.abs(marketCoinsExpiredAggregate._sum.amount ?? 0),
        totalMarketCoinsSpent: Math.abs(marketCoinsSpentAggregate._sum.amount ?? 0),
        totalLifetimeScore: seasonScoreAggregate._sum.lifetimeScore ?? 0,
        totalGameScore: gameScoreAggregate._sum.playPoints ?? 0,
        totalMarketCoins: marketCoinsAggregate._sum.marketCoins ?? 0,
        totalSeasonScore: seasonScoreAggregate._sum.seasonScore ?? 0,
        totalXp: seasonScoreAggregate._sum.totalXp ?? 0,
        usersCount
      },
      topUsers
    };
  });

  app.get("/admin/rewards", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    return prisma.reward.findMany({
      include: {
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 8
        },
        brand: {
          select: {
            id: true,
            logoUrl: true,
            name: true
          }
        }
      },
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }, { title: "asc" }]
    });
  });

  app.get("/admin/campaigns", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    return prisma.campaign.findMany({
      include: includeAdminCampaign(),
      orderBy: [{ startsAt: "desc" }, { updatedAt: "desc" }]
    });
  });

  app.get("/admin/campaigns/options", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const [games, rewards] = await Promise.all([
      prisma.game.findMany({
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        select: {
          active: true,
          id: true,
          slug: true,
          title: true
        }
      }),
      prisma.reward.findMany({
        orderBy: [{ active: "desc" }, { title: "asc" }],
        select: {
          active: true,
          brand: {
            select: {
              name: true
            }
          },
          id: true,
          slug: true,
          title: true
        }
      })
    ]);

    return { games, rewards };
  });

  app.get("/admin/games", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    return prisma.game.findMany({
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: selectAdminGame()
    });
  });

  app.patch("/admin/games/:gameId", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const params = gameAdminParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid game id", issues: params.error.issues });
    const parsed = gameAdminPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid game payload", issues: parsed.error.issues });

    let scoringRule: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
    if (parsed.data.scoringRule) {
      try {
        scoringRule = JSON.parse(parsed.data.scoringRule) as Prisma.InputJsonValue;
      } catch {
        return reply.code(400).send({ message: "Scoring rule must be valid JSON" });
      }
    }

    return prisma.game.update({
      where: { id: params.data.gameId },
      data: {
        active: parsed.data.active,
        comingSoon: parsed.data.comingSoon,
        dailyAttemptLimit: parsed.data.dailyAttemptLimit,
        description: parsed.data.description || null,
        iconUrl: parsed.data.iconUrl || null,
        pointRatio: parsed.data.pointRatio ?? null,
        scoringRule,
        sortOrder: parsed.data.sortOrder,
        title: parsed.data.title
      },
      select: selectAdminGame()
    });
  });

  app.post("/admin/campaigns", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const parsed = campaignAdminPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid campaign payload", issues: parsed.error.issues });

    const startsAt = parseRequiredDate(parsed.data.startsAt);
    const endsAt = parseRequiredDate(parsed.data.endsAt);
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      return reply.code(400).send({ message: "Invalid campaign dates" });
    }

    const campaign = await prisma.$transaction(async (tx) => {
      const brand = await tx.brand.upsert({
        where: { name: parsed.data.brandName },
        update: {
          active: true,
          logoUrl: parsed.data.brandLogoUrl || null
        },
        create: {
          active: true,
          logoUrl: parsed.data.brandLogoUrl || null,
          monthlyFeeGel: 0,
          name: parsed.data.brandName
        }
      });

      return tx.campaign.create({
        data: {
          brandId: brand.id,
          endsAt,
          games: {
            create: parsed.data.gameIds.map((gameId) => ({ gameId }))
          },
          rewards: {
            create: parsed.data.rewardIds.map((rewardId) => ({ rewardId }))
          },
          rulesText: parsed.data.rulesText || null,
          startsAt,
          status: parsed.data.status,
          title: parsed.data.title
        },
        include: includeAdminCampaign()
      });
    });

    return campaign;
  });

  app.patch("/admin/campaigns/:campaignId", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const params = campaignAdminParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid campaign id", issues: params.error.issues });
    const parsed = campaignAdminPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid campaign payload", issues: parsed.error.issues });

    const startsAt = parseRequiredDate(parsed.data.startsAt);
    const endsAt = parseRequiredDate(parsed.data.endsAt);
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      return reply.code(400).send({ message: "Invalid campaign dates" });
    }

    const campaign = await prisma.$transaction(async (tx) => {
      const brand = await tx.brand.upsert({
        where: { name: parsed.data.brandName },
        update: {
          active: true,
          logoUrl: parsed.data.brandLogoUrl || null
        },
        create: {
          active: true,
          logoUrl: parsed.data.brandLogoUrl || null,
          monthlyFeeGel: 0,
          name: parsed.data.brandName
        }
      });

      await tx.campaignGame.deleteMany({ where: { campaignId: params.data.campaignId } });
      await tx.campaignReward.deleteMany({ where: { campaignId: params.data.campaignId } });

      return tx.campaign.update({
        where: { id: params.data.campaignId },
        data: {
          brandId: brand.id,
          endsAt,
          games: {
            create: parsed.data.gameIds.map((gameId) => ({ gameId }))
          },
          rewards: {
            create: parsed.data.rewardIds.map((rewardId) => ({ rewardId }))
          },
          rulesText: parsed.data.rulesText || null,
          startsAt,
          status: parsed.data.status,
          title: parsed.data.title
        },
        include: includeAdminCampaign()
      });
    });

    return campaign;
  });

  app.get("/admin/users", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const query = adminUserQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "Invalid user query", issues: query.error.issues });

    const q = query.data.q?.trim();
    return prisma.user.findMany({
      where: q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { referralCode: { contains: q, mode: "insensitive" } }
            ]
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      select: selectAdminUserSummary(),
      take: query.data.take ?? 20
    });
  });

  app.get("/admin/users/:userId", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const params = adminUserParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid user id", issues: params.error.issues });

    const user = await prisma.user.findUnique({
      where: { id: params.data.userId },
      select: {
        ...selectAdminUserSummary(),
        birthDate: true,
        interests: true,
        lifetimeScore: true,
        referralCode: true,
        referredById: true,
        totalPoints: true,
        scores: {
          include: {
            game: {
              select: {
                title: true,
                slug: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: 12
        },
        attempts: {
          include: {
            game: {
              select: {
                title: true,
                slug: true
              }
            }
          },
          orderBy: { startedAt: "desc" },
          take: 12
        },
        pointBonuses: {
          orderBy: { awardedAt: "desc" },
          take: 12
        },
        marketCoinTransactions: {
          orderBy: { createdAt: "desc" },
          take: 12
        },
        rewardClaims: {
          include: {
            reward: {
              select: {
                title: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: 12
        }
      }
    });

    if (!user) return reply.code(404).send({ message: "User not found" });

    const auditLogs = await prisma.adminAuditLog.findMany({
      where: { targetUserId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20
    });

    return { auditLogs, user };
  });

  app.patch("/admin/users/:userId/role", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const params = adminUserParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid user id", issues: params.error.issues });
    const parsed = roleChangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid role payload", issues: parsed.error.issues });

    const currentUser = await prisma.user.findUnique({
      where: { id: params.data.userId },
      select: { id: true, role: true }
    });
    if (!currentUser) return reply.code(404).send({ message: "User not found" });

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: params.data.userId },
        data: { role: parsed.data.role },
        select: selectAdminUserSummary()
      });
      await tx.adminAuditLog.create({
        data: {
          action: "role_change",
          adminUserId: auth.session.userId,
          targetUserId: params.data.userId,
          metadata: {
            from: currentUser.role,
            to: parsed.data.role
          }
        }
      });
      return user;
    });

    return { user: updatedUser };
  });

  app.post("/admin/users/:userId/adjustments", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const params = adminUserParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid user id", issues: params.error.issues });
    const parsed = manualAdjustmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid adjustment payload", issues: parsed.error.issues });

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: params.data.userId },
        select: {
          id: true,
          marketCoins: true,
          seasonScore: true,
          totalPoints: true,
          lifetimeScore: true,
          totalXp: true,
          xp: true
        }
      });
      if (!user) return null;

      const amount = parsed.data.amount;
      if (parsed.data.currency === "season_score") {
        await tx.user.update({
          where: { id: user.id },
          data: {
            lifetimeScore: Math.max(0, user.lifetimeScore + amount),
            seasonScore: Math.max(0, user.seasonScore + amount),
            totalPoints: Math.max(0, user.totalPoints + amount)
          }
        });
      }

      if (parsed.data.currency === "market_coin") {
        const nextMarketCoins = Math.max(0, user.marketCoins + amount);
        await tx.user.update({
          where: { id: user.id },
          data: { marketCoins: nextMarketCoins }
        });
        await tx.marketCoinTransaction.create({
          data: {
            amount,
            remainingAmount: amount > 0 ? amount : 0,
            source: "admin_adjustment",
            type: amount > 0 ? "earned_conversion" : "spent_reward",
            userId: user.id
          }
        });
      }

      if (parsed.data.currency === "xp") {
        await tx.user.update({
          where: { id: user.id },
          data: {
            totalXp: Math.max(0, user.totalXp + amount),
            xp: Math.max(0, user.xp + amount)
          }
        });
      }

      await tx.adminAuditLog.create({
        data: {
          action: "manual_adjustment",
          adminUserId: auth.session.userId,
          targetUserId: user.id,
          metadata: {
            amount,
            currency: parsed.data.currency,
            note: parsed.data.note
          }
        }
      });

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: selectAdminUserSummary()
      });
    });

    if (!result) return reply.code(404).send({ message: "User not found" });
    return { user: result };
  });

  app.post("/admin/rewards", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const parsed = rewardAdminPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid reward payload", issues: parsed.error.issues });

    const data = parsed.data;
    const brand = await prisma.brand.upsert({
      where: { name: data.brandName },
      update: {
        active: true,
        logoUrl: data.brandLogoUrl || null
      },
      create: {
        active: true,
        logoUrl: data.brandLogoUrl || null,
        monthlyFeeGel: 0,
        name: data.brandName
      }
    });

    return prisma.reward.create({
      data: {
        active: data.active ?? true,
        brandId: brand.id,
        category: data.category,
        description: data.description || null,
        expiresAt: parseOptionalDate(data.expiresAt),
        imageUrl: data.imageUrl || null,
        quantity: data.quantity,
        requiredPoints: data.requiredPoints,
        slug: data.slug,
        title: data.title
      },
      include: {
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 8
        },
        brand: {
          select: {
            id: true,
            logoUrl: true,
            name: true
          }
        }
      }
    });
  });

  app.patch("/admin/rewards/:rewardId", async (request, reply) => {
    const auth = await requireAdmin(request, reply);
    if (!auth) return;

    const params = rewardAdminParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid reward id", issues: params.error.issues });

    const parsed = rewardAdminPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid reward payload", issues: parsed.error.issues });

    const data = parsed.data;
    const brand = await prisma.brand.upsert({
      where: { name: data.brandName },
      update: {
        active: true,
        logoUrl: data.brandLogoUrl || null
      },
      create: {
        active: true,
        logoUrl: data.brandLogoUrl || null,
        monthlyFeeGel: 0,
        name: data.brandName
      }
    });

    const currentReward = await prisma.reward.findUnique({
      where: { id: params.data.rewardId },
      select: {
        active: true,
        quantity: true,
        requiredPoints: true
      }
    });
    if (!currentReward) return reply.code(404).send({ message: "Reward not found" });

    return prisma.$transaction(async (tx) => {
      const updatedReward = await tx.reward.update({
        where: { id: params.data.rewardId },
        data: {
          active: data.active ?? true,
          brandId: brand.id,
          category: data.category,
          description: data.description || null,
          expiresAt: parseOptionalDate(data.expiresAt),
          imageUrl: data.imageUrl || null,
          quantity: data.quantity,
          requiredPoints: data.requiredPoints,
          slug: data.slug,
          title: data.title
        },
        include: {
          auditLogs: {
            orderBy: { createdAt: "desc" },
            take: 8
          },
          brand: {
            select: {
              id: true,
              logoUrl: true,
              name: true
            }
          }
        }
      });

      const changes: Record<string, { from: boolean | number; to: boolean | number }> = {};
      if (currentReward.active !== updatedReward.active) {
        changes.active = { from: currentReward.active, to: updatedReward.active };
      }
      if (currentReward.quantity !== updatedReward.quantity) {
        changes.quantity = { from: currentReward.quantity, to: updatedReward.quantity };
      }
      if (currentReward.requiredPoints !== updatedReward.requiredPoints) {
        changes.requiredPoints = { from: currentReward.requiredPoints, to: updatedReward.requiredPoints };
      }

      if (Object.keys(changes).length > 0) {
        await tx.rewardAuditLog.create({
          data: {
            adminUserId: auth.session.userId,
            changes,
            rewardId: updatedReward.id
          }
        });
      }

      return updatedReward;
    });
  });
}
