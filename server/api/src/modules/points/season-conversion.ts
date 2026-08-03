import type { PrismaClient } from "@prisma/client";
import { pointRules } from "@playpoint/shared";
import { addMarketCoins } from "./market-coins";

export type SeasonConversionResult = {
  convertedUsers: number;
  dryRun: boolean;
  marketCoinsAwarded: number;
  seasonKey: string;
  skippedUsers: number;
  totalSeasonScore: number;
};

export function getPreviousSeasonKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const previousMonthIndex = monthIndex === 0 ? 11 : monthIndex - 1;
  const previousMonthYear = monthIndex === 0 ? year - 1 : year;
  return `${previousMonthYear}-${String(previousMonthIndex + 1).padStart(2, "0")}`;
}

export function normalizeSeasonKey(seasonKey?: string) {
  const normalized = seasonKey?.trim();
  if (!normalized) return getPreviousSeasonKey();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) {
    throw new Error("Season key must use YYYY-MM format");
  }
  return normalized;
}

export function calculateMarketCoinsFromSeasonScore(seasonScore: number) {
  const scoreConverted = Math.min(Math.max(0, seasonScore), pointRules.monthlySeasonScoreCap);
  return {
    marketCoinsAwarded: Math.floor(scoreConverted / pointRules.seasonScoreToMarketCoinRatio),
    scoreConverted
  };
}

export async function convertSeasonScoreToMarketCoins(
  db: PrismaClient,
  options: { dryRun?: boolean; seasonKey?: string } = {}
): Promise<SeasonConversionResult> {
  const dryRun = Boolean(options.dryRun);
  const seasonKey = normalizeSeasonKey(options.seasonKey);
  const users = await db.user.findMany({
    where: {
      seasonScore: {
        gt: 0
      }
    },
    select: {
      id: true,
      seasonScore: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  let convertedUsers = 0;
  let skippedUsers = 0;
  let marketCoinsAwarded = 0;
  let totalSeasonScore = 0;

  if (dryRun) {
    for (const user of users) {
      const existingConversion = await db.seasonConversion.findUnique({
        where: {
          userId_seasonKey: {
            seasonKey,
            userId: user.id
          }
        },
        select: {
          id: true
        }
      });
      if (existingConversion) {
        skippedUsers += 1;
        continue;
      }
      const calculated = calculateMarketCoinsFromSeasonScore(user.seasonScore);
      convertedUsers += 1;
      totalSeasonScore += user.seasonScore;
      marketCoinsAwarded += calculated.marketCoinsAwarded;
    }
    return { convertedUsers, dryRun, marketCoinsAwarded, seasonKey, skippedUsers, totalSeasonScore };
  }

  await db.$transaction(async (tx) => {
    for (const user of users) {
      const existingConversion = await tx.seasonConversion.findUnique({
        where: {
          userId_seasonKey: {
            seasonKey,
            userId: user.id
          }
        },
        select: {
          id: true
        }
      });

      if (existingConversion) {
        skippedUsers += 1;
        continue;
      }

      const calculated = calculateMarketCoinsFromSeasonScore(user.seasonScore);
      const conversion = await tx.seasonConversion.create({
        data: {
          conversionRate: pointRules.seasonScoreToMarketCoinRatio,
          marketCoinsAwarded: calculated.marketCoinsAwarded,
          scoreCap: pointRules.monthlySeasonScoreCap,
          scoreConverted: calculated.scoreConverted,
          seasonKey,
          seasonScoreBefore: user.seasonScore,
          userId: user.id
        }
      });

      await addMarketCoins(tx, user.id, calculated.marketCoinsAwarded, {
        referenceId: conversion.id,
        source: `season_conversion:${seasonKey}`
      });

      await tx.user.update({
        where: {
          id: user.id
        },
        data: {
          marketCoins: {
            increment: calculated.marketCoinsAwarded
          },
          seasonScore: 0
        }
      });

      convertedUsers += 1;
      totalSeasonScore += user.seasonScore;
      marketCoinsAwarded += calculated.marketCoinsAwarded;
    }
  });

  return { convertedUsers, dryRun, marketCoinsAwarded, seasonKey, skippedUsers, totalSeasonScore };
}
