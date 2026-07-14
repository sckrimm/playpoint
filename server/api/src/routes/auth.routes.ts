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

const requestOtpSchema = z.object({
  phone: z.string().min(6).max(24)
});

const verifyOtpSchema = z.object({
  code: z.string().regex(/^\d{4,6}$/),
  displayName: z.string().trim().min(1).max(60).optional(),
  phone: z.string().min(6).max(24)
});

function defaultDisplayName(phone: string) {
  return `Player ${phone.slice(-4)}`;
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
      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: parsed.data.displayName ? { displayName: parsed.data.displayName } : {}
          })
        : await tx.user.create({
            data: {
              phone,
              displayName: parsed.data.displayName ?? defaultDisplayName(phone),
              totalPoints: pointRules.registrationBonus,
              coins: 14
            }
          });

      await tx.otpCode.update({
        where: { id: otp.id },
        data: {
          usedAt: new Date(),
          userId: user.id
        }
      });

      const session = await tx.userSession.create({
        data: {
          tokenHash: hashSessionToken(token),
          expiresAt,
          userId: user.id
        }
      });

      return { session, user };
    });

    return {
      token,
      session: {
        expiresAt: result.session.expiresAt,
        id: result.session.id
      },
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
