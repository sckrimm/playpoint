import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { pointRules } from "@playpoint/shared";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { env } from "../env";
import {
  createOtpCode,
  createSessionToken,
  hashOtp,
  hashSessionToken,
  isHashMatch,
  normalizePhone,
  requireSession
} from "../modules/auth/auth.helpers";
import { awardDailyLoginBonus, getDailyLoginProgress, type DailyLoginProgress } from "../modules/points/daily-login";
import { awardProfileCompletionBonusIfReady } from "../modules/points/profile-completion";
import { grantXpForPointAward, type LevelProgress } from "../modules/points/progression";
import { verifyAppleIdToken, verifyGoogleIdToken, type VerifiedSocialIdentity } from "../modules/auth/social.helpers";
import { ensureReferralCode } from "../modules/referrals/referral.helpers";

const requestOtpSchema = z.object({
  phone: z.string().min(6).max(24)
});

const verifyOtpSchema = z.object({
  code: z.string().regex(/^\d{4,6}$/),
  displayName: z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N}_ ]+$/u).optional(),
  phone: z.string().min(6).max(24)
});

const socialAuthSchema = z.object({
  idToken: z.string().min(20)
});

const emailVerificationSchema = z.object({
  email: z.string().email().max(160)
});

const verifyEmailSchema = emailVerificationSchema.extend({
  code: z.string().regex(/^\d{4,6}$/)
});

function defaultDisplayName(phone: string) {
  return `Player ${phone.slice(-4)}`;
}

function fallbackSocialDisplayName(identity: VerifiedSocialIdentity) {
  const source = identity.name || identity.email?.split("@")[0] || `Player ${identity.providerUserId.slice(-4)}`;
  const normalized = source.replace(/[^\p{L}\p{N}_ ]/gu, " ").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 24) || `Player ${identity.providerUserId.slice(-4)}`;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function createUniqueDisplayName(tx: Prisma.TransactionClient, preferredName: string) {
  const baseName = preferredName.trim().slice(0, 24) || "Player";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 ? "" : ` ${attempt + 1}`;
    const candidate = `${baseName.slice(0, 24 - suffix.length)}${suffix}`;
    const existingUser = await tx.user.findUnique({ where: { displayName: candidate }, select: { id: true } });
    if (!existingUser) return candidate;
  }

  return `Player ${crypto.randomUUID().slice(0, 8)}`;
}

async function createSession(tx: Prisma.TransactionClient, userId: string, token: string, expiresAt: Date) {
  return tx.userSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      expiresAt,
      userId
    }
  });
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/request-otp", async (request, reply) => {
    const parsed = requestOtpSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid phone", issues: parsed.error.issues });

    const phone = normalizePhone(parsed.data.phone);
    const code = createOtpCode();
    const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);
    const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });

    await prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashOtp(phone, code),
        expiresAt,
        purpose: "login",
        userId: user?.id
      }
    });

    return {
      expiresAt,
      expiresInSeconds: env.OTP_TTL_SECONDS,
      ok: true,
      phone,
      ...(env.OTP_EXPOSE_DEV_CODE && env.OTP_PROVIDER === "mock" ? { devCode: code } : {})
    };
  });

  app.post("/auth/verify-otp", async (request, reply) => {
    const parsed = verifyOtpSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid OTP payload", issues: parsed.error.issues });

    const phone = normalizePhone(parsed.data.phone);
    const codeHash = hashOtp(phone, parsed.data.code);
    const otp = await prisma.otpCode.findFirst({
      where: {
        phone,
        purpose: "login",
        usedAt: null,
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!otp || !isHashMatch(otp.codeHash, codeHash)) {
      return reply.code(401).send({ message: "OTP code is invalid or expired" });
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    const result = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { phone } });
      const isNewUser = !existingUser;

      if (parsed.data.displayName) {
        const userWithName = await tx.user.findFirst({
          where: {
            displayName: parsed.data.displayName,
            ...(existingUser ? { id: { not: existingUser.id } } : {})
          },
          select: { id: true }
        });

        if (userWithName) return "DISPLAY_NAME_TAKEN" as const;
      }

      let user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
              phoneVerifiedAt: existingUser.phoneVerifiedAt ?? new Date()
            }
          })
        : await tx.user.create({
            data: {
              phone,
              phoneVerifiedAt: new Date(),
              displayName: parsed.data.displayName ?? defaultDisplayName(phone),
              totalPoints: pointRules.registrationBonus,
              coins: 14
            }
          });

      await ensureReferralCode(tx, user.id);

      if (isNewUser) {
        await tx.pointBonus.create({
          data: {
            awardKey: "registration",
            points: pointRules.registrationBonus,
            reason: "registration",
            userId: user.id
          }
        });
        user = (await grantXpForPointAward(tx, user.id)).user;
      }

      const dailyLoginResult = await awardDailyLoginBonus(tx, user.id);
      const dailyLogin = {
        awardedToday: dailyLoginResult.awardedToday,
        levelProgress: dailyLoginResult.levelProgress,
        progress: dailyLoginResult.progress
      };
      user = dailyLoginResult.user;
      const profileCompletionResult = await awardProfileCompletionBonusIfReady(tx, user.id);
      user = profileCompletionResult.user;
      dailyLogin.levelProgress = profileCompletionResult.levelProgress ?? dailyLogin.levelProgress;

      await tx.otpCode.update({
        where: { id: otp.id },
        data: {
          usedAt: new Date(),
          userId: user.id
        }
      });

      const session = await createSession(tx, user.id, token, expiresAt);

      return { dailyLogin, isNewUser, session, user };
    }).catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return "DISPLAY_NAME_TAKEN" as const;
      }
      throw error;
    });

    if (result === "DISPLAY_NAME_TAKEN") {
      return reply.code(409).send({ message: "Display name is already taken" });
    }

    return {
      token,
      session: {
        expiresAt: result.session.expiresAt,
        id: result.session.id
      },
      isNewUser: result.isNewUser,
      dailyLogin: {
        awardedToday: result.dailyLogin.awardedToday,
        levelProgress: result.dailyLogin.levelProgress,
        points: pointRules.dailyLoginBonus,
        progress: result.dailyLogin.progress
      },
      user: result.user
    };
  });

  async function handleSocialAuth(
    provider: "google" | "apple",
    verifyIdentity: (idToken: string) => Promise<VerifiedSocialIdentity>,
    idToken: string
  ) {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    const identity = await verifyIdentity(idToken);

    return prisma.$transaction(async (tx) => {
      const existingAccount = await tx.authAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider,
            providerUserId: identity.providerUserId
          }
        },
        include: { user: true }
      });

      let isNewUser = false;
      let user = existingAccount?.user ?? null;
      let dailyLogin: { awardedToday: boolean; levelProgress: LevelProgress | null; progress: DailyLoginProgress };

      if (!user) {
        user =
          identity.email && identity.emailVerified
            ? await tx.user.findUnique({ where: { email: identity.email } })
            : null;

        if (!user) {
          isNewUser = true;
          const displayName = await createUniqueDisplayName(tx, fallbackSocialDisplayName(identity));
          user = await tx.user.create({
            data: {
              displayName,
              email: identity.emailVerified ? identity.email : null,
              emailVerifiedAt: identity.emailVerified ? new Date() : null,
              totalPoints: pointRules.registrationBonus,
              coins: 14
            }
          });

          await tx.pointBonus.create({
            data: {
              awardKey: "registration",
              points: pointRules.registrationBonus,
              reason: "registration",
              userId: user.id
            }
          });
          user = (await grantXpForPointAward(tx, user.id)).user;
        } else if (identity.emailVerified && identity.email && !user.email) {
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              email: identity.email,
              emailVerifiedAt: new Date()
            }
          });
        }

        await tx.authAccount.create({
          data: {
            email: identity.email,
            provider,
            providerUserId: identity.providerUserId,
            userId: user.id
          }
        });
      }

      await ensureReferralCode(tx, user.id);

      const dailyLoginResult = await awardDailyLoginBonus(tx, user.id);
      dailyLogin = {
        awardedToday: dailyLoginResult.awardedToday,
        levelProgress: dailyLoginResult.levelProgress,
        progress: dailyLoginResult.progress
      };
      user = dailyLoginResult.user;
      const profileCompletionResult = await awardProfileCompletionBonusIfReady(tx, user.id);
      user = profileCompletionResult.user;
      dailyLogin.levelProgress = profileCompletionResult.levelProgress ?? dailyLogin.levelProgress;

      const session = await createSession(tx, user.id, token, expiresAt);
      return { dailyLogin, isNewUser, session, token, user };
    });
  }

  app.post("/auth/google", async (request, reply) => {
    if (!env.GOOGLE_CLIENT_ID) return reply.code(400).send({ message: "Google login is not configured" });
    const parsed = socialAuthSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid Google auth payload", issues: parsed.error.issues });

    try {
      const result = await handleSocialAuth("google", verifyGoogleIdToken, parsed.data.idToken);
      return {
        token: result.token,
        session: {
          expiresAt: result.session.expiresAt,
          id: result.session.id
        },
        isNewUser: result.isNewUser,
        dailyLogin: {
          awardedToday: result.dailyLogin.awardedToday,
          levelProgress: result.dailyLogin.levelProgress,
          points: pointRules.dailyLoginBonus,
          progress: result.dailyLogin.progress
        },
        user: result.user
      };
    } catch (error) {
      request.log.warn({ err: error }, "Google auth failed");
      return reply.code(401).send({ message: "Google login failed" });
    }
  });

  app.post("/auth/apple", async (request, reply) => {
    if (!env.APPLE_CLIENT_ID) return reply.code(400).send({ message: "Apple login is not configured" });
    const parsed = socialAuthSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid Apple auth payload", issues: parsed.error.issues });

    try {
      const result = await handleSocialAuth("apple", verifyAppleIdToken, parsed.data.idToken);
      return {
        token: result.token,
        session: {
          expiresAt: result.session.expiresAt,
          id: result.session.id
        },
        isNewUser: result.isNewUser,
        dailyLogin: {
          awardedToday: result.dailyLogin.awardedToday,
          levelProgress: result.dailyLogin.levelProgress,
          points: pointRules.dailyLoginBonus,
          progress: result.dailyLogin.progress
        },
        user: result.user
      };
    } catch (error) {
      request.log.warn({ err: error }, "Apple auth failed");
      return reply.code(401).send({ message: "Apple login failed" });
    }
  });

  app.post("/auth/request-email-verification", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;

    const parsed = emailVerificationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid email", issues: parsed.error.issues });

    const email = normalizeEmail(parsed.data.email);
    const existingUser = await prisma.user.findFirst({
      where: {
        email,
        id: {
          not: auth.session.userId
        }
      },
      select: { id: true }
    });

    if (existingUser) return reply.code(409).send({ message: "Email is already used" });

    const code = createOtpCode();
    const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);
    await prisma.otpCode.create({
      data: {
        codeHash: hashOtp(email, code),
        email,
        expiresAt,
        purpose: "email_verify",
        userId: auth.session.userId
      }
    });

    return {
      email,
      expiresAt,
      expiresInSeconds: env.OTP_TTL_SECONDS,
      ok: true,
      ...(env.OTP_EXPOSE_DEV_CODE && env.OTP_PROVIDER === "mock" ? { devCode: code } : {})
    };
  });

  app.post("/auth/verify-email", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;

    const parsed = verifyEmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid email verification payload", issues: parsed.error.issues });

    const email = normalizeEmail(parsed.data.email);
    const codeHash = hashOtp(email, parsed.data.code);
    const otp = await prisma.otpCode.findFirst({
      where: {
        email,
        purpose: "email_verify",
        usedAt: null,
        userId: auth.session.userId,
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!otp || !isHashMatch(otp.codeHash, codeHash)) {
      return reply.code(401).send({ message: "Email verification code is invalid or expired" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const userWithEmail = await tx.user.findFirst({
        where: {
          email,
          id: {
            not: auth.session.userId
          }
        },
        select: { id: true }
      });
      if (userWithEmail) return "EMAIL_TAKEN" as const;

      let user = await tx.user.update({
        where: { id: auth.session.userId },
        data: {
          email,
          emailVerifiedAt: new Date()
        }
      });

      const awardKey = "email-verification";
      const existingBonus = await tx.pointBonus.findUnique({
        where: {
          userId_awardKey: {
            awardKey,
            userId: user.id
          }
        },
        select: { id: true }
      });

      let levelProgress = null;
      if (!existingBonus) {
        await tx.pointBonus.create({
          data: {
            awardKey,
            points: pointRules.emailVerificationBonus,
            reason: "email_verification",
            userId: user.id
          }
        });

        user = await tx.user.update({
          where: { id: user.id },
          data: {
            totalPoints: {
              increment: pointRules.emailVerificationBonus
            }
          }
        });
        const xpResult = await grantXpForPointAward(tx, user.id);
        user = xpResult.user;
        levelProgress = xpResult.progress;
      }

      await tx.otpCode.update({
        where: { id: otp.id },
        data: {
          usedAt: new Date()
        }
      });

      const profileCompletionResult = await awardProfileCompletionBonusIfReady(tx, user.id);
      user = profileCompletionResult.user;
      levelProgress = profileCompletionResult.levelProgress ?? levelProgress;

      return { levelProgress, user };
    });

    if (result === "EMAIL_TAKEN") return reply.code(409).send({ message: "Email is already used" });

    return {
      levelProgress: result.levelProgress,
      ok: true,
      user: result.user
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) return;

    await prisma.userSession.updateMany({
      where: {
        tokenHash: hashSessionToken(auth.token),
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    return { ok: true };
  });
}
