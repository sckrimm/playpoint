import { prisma } from "../db/prisma";
import { expireMarketCoins } from "../modules/points/market-coins";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await expireMarketCoins(prisma, { dryRun });

  console.log(
    JSON.stringify(
      {
        dryRun: result.dryRun,
        expiredCoins: result.expiredCoins,
        expiredLots: result.expiredLots
      },
      null,
      2
    )
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown Market Coins expiry error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
