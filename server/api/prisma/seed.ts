import { PrismaClient } from "@prisma/client";
import { games, leaderboard, rewards } from "@playpoint/shared";

const prisma = new PrismaClient();

function daysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  const brands = await Promise.all([
    prisma.brand.upsert({
      where: { name: "Burger Palace" },
      update: {},
      create: {
        name: "Burger Palace",
        logoUrl: "/assets/brand-burger-palace.png",
        packageType: "basic",
        monthlyFeeGel: 1000,
        contactName: "Pilot Manager"
      }
    }),
    prisma.brand.upsert({
      where: { name: "Coffee Lab" },
      update: {},
      create: {
        name: "Coffee Lab",
        logoUrl: "/assets/brand-coffee-lab.png",
        packageType: "plus",
        monthlyFeeGel: 1500,
        contactName: "Pilot Manager"
      }
    }),
    prisma.brand.upsert({
      where: { name: "TechStore" },
      update: {},
      create: {
        name: "TechStore",
        logoUrl: "/assets/brand-tech-store.png",
        packageType: "plus",
        monthlyFeeGel: 1500,
        contactName: "Pilot Manager"
      }
    }),
    prisma.brand.upsert({
      where: { name: "CineClub" },
      update: {},
      create: {
        name: "CineClub",
        logoUrl: "/assets/brand-cineclub.png",
        packageType: "basic",
        monthlyFeeGel: 1000
      }
    }),
    prisma.brand.upsert({
      where: { name: "GameZone" },
      update: {},
      create: {
        name: "GameZone",
        logoUrl: "/assets/brand-gamezone.png",
        packageType: "premium",
        monthlyFeeGel: 2500
      }
    }),
    prisma.brand.upsert({
      where: { name: "FitHub" },
      update: {},
      create: {
        name: "FitHub",
        logoUrl: "/assets/brand-fithub.png",
        packageType: "basic",
        monthlyFeeGel: 1000
      }
    })
  ]);

  const brandByName = new Map(brands.map((brand) => [brand.name, brand]));

  const campaign = await prisma.campaign.upsert({
    where: { id: "seed-weekly-campaign" },
    update: {},
    create: {
      id: "seed-weekly-campaign",
      title: "Weekly Challenge",
      status: "active",
      startsAt: daysFromNow(-2),
      endsAt: daysFromNow(5),
      brandId: brandByName.get("Coffee Lab")!.id
    }
  });

  await Promise.all(
    games.map((game, index) =>
      prisma.game.upsert({
        where: { slug: game.id },
        update: {
          title: game.name,
          iconUrl: game.icon,
          active: true,
          sortOrder: index
        },
        create: {
          slug: game.id,
          title: game.name,
          description: game.pointRateLabel,
          iconUrl: game.icon,
          active: true,
          sortOrder: index,
          dailyAttemptLimit: 3,
          scoringRule: {
            scoreToPointFormula: "floor(rawScore / 10)"
          }
        }
      })
    )
  );

  await Promise.all([
    prisma.banner.upsert({
      where: { id: "seed-home-banner" },
      update: {},
      create: {
        id: "seed-home-banner",
        title: "Home Campaign Banner",
        placement: "home",
        imageUrl: "/assets/hero-arena.png",
        clickUrl: "https://playpoint.local/campaign/weekly",
        startsAt: daysFromNow(-2),
        endsAt: daysFromNow(5),
        brandId: brandByName.get("Coffee Lab")!.id,
        campaignId: campaign.id
      }
    }),
    prisma.banner.upsert({
      where: { id: "seed-loading-banner" },
      update: {},
      create: {
        id: "seed-loading-banner",
        title: "Game Loading Sponsor",
        placement: "game_loading",
        imageUrl: "/assets/hero-arena.png",
        startsAt: daysFromNow(-2),
        endsAt: daysFromNow(5),
        brandId: brandByName.get("GameZone")!.id,
        campaignId: campaign.id
      }
    }),
    prisma.banner.upsert({
      where: { id: "seed-leaderboard-banner" },
      update: {},
      create: {
        id: "seed-leaderboard-banner",
        title: "Leaderboard Sponsor",
        placement: "leaderboard",
        imageUrl: "/assets/hero-arena.png",
        startsAt: daysFromNow(-2),
        endsAt: daysFromNow(5),
        brandId: brandByName.get("TechStore")!.id,
        campaignId: campaign.id
      }
    })
  ]);

  await Promise.all(
    rewards.map((reward) =>
      prisma.reward.upsert({
        where: { slug: reward.id },
        update: {
          title: reward.title,
          imageUrl: reward.image,
          requiredPoints: reward.points,
          active: true
        },
        create: {
          slug: reward.id,
          title: reward.title,
          imageUrl: reward.image,
          category: reward.category,
          requiredPoints: reward.points,
          quantity: 50,
          expiresAt: daysFromNow(30),
          brandId: brandByName.get(reward.brand)!.id
        }
      })
    )
  );

  const seededUsers = await Promise.all(
    leaderboard.map((entry, index) =>
      prisma.user.upsert({
        where: { phone: `+99555500${String(index + 1).padStart(4, "0")}` },
        update: {
          displayName: entry.name,
          totalPoints: entry.points
        },
        create: {
          phone: `+99555500${String(index + 1).padStart(4, "0")}`,
          displayName: entry.name,
          totalPoints: entry.points,
          coins: 14
        }
      })
    )
  );

  const seededGames = await prisma.game.findMany({ orderBy: { sortOrder: "asc" } });
  await prisma.score.deleteMany({
    where: {
      userId: {
        in: seededUsers.map((user) => user.id)
      },
      attemptId: null
    }
  });

  await Promise.all(
    seededUsers.map((user, index) => {
      const game = seededGames[index % seededGames.length];
      const points = Math.max(100, user.totalPoints);
      return prisma.score.create({
        data: {
          rawScore: points * 10,
          playPoints: points,
          durationSeconds: 10,
          hits: 12 + index,
          misses: index % 4,
          accuracy: 80 + (index % 18),
          maxCombo: 3 + (index % 8),
          verificationStatus: "verified",
          userId: user.id,
          gameId: game.id
        }
      });
    })
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
