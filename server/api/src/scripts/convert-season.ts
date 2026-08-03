import { prisma } from "../db/prisma";
import { convertSeasonScoreToMarketCoins } from "../modules/points/season-conversion";

function readArgValue(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const seasonKey = readArgValue("season");
  const result = await convertSeasonScoreToMarketCoins(prisma, { dryRun, seasonKey });

  console.log(
    JSON.stringify(
      {
        convertedUsers: result.convertedUsers,
        dryRun: result.dryRun,
        marketCoinsAwarded: result.marketCoinsAwarded,
        seasonKey: result.seasonKey,
        skippedUsers: result.skippedUsers,
        totalSeasonScore: result.totalSeasonScore
      },
      null,
      2
    )
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown season conversion error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
