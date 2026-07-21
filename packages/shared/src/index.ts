export type GameId = "color-rush" | "memory" | "aim-hit" | "lucky-spin" | "puzzle-run" | "rocket-tap";

export type Game = {
  id: GameId;
  name: string;
  icon: string;
  pointRateLabel: string;
};

export type GameResult = {
  gameId: GameId;
  score: number;
  playPoints: number;
  durationSeconds: number;
  hits?: number;
  misses?: number;
  accuracy?: number;
  maxCombo?: number;
};

export type LeaderboardEntry = {
  rank: number;
  name: string;
  points: number;
};

export type Reward = {
  id: string;
  title: string;
  brand: string;
  points: number;
  category: "food" | "leisure" | "tech" | "gaming";
  image?: string;
  brandLogo?: string;
  quantity?: number;
  remainingQuantity?: number;
};

export const pointRules = {
  registrationBonus: 50,
  dailyLoginBonus: 50,
  emailVerificationBonus: 50,
  phoneVerificationBonus: 50,
  profileCompletionBonus: 500,
  referralSignupBonus: 100,
  referralInviteBonus: 200,
  rewardEngagementBonus: 10,
  xpPerPointAward: 5,
  firstLevelXp: 20,
  firstLevelBonus: 100,
  dailyAttemptsPerGame: 3,
  scoreToPointRatio: 0.01
} as const;

export function getLevelXpRequirement(level: number) {
  return pointRules.firstLevelXp * 2 ** Math.max(0, level - 1);
}

export function getLevelBonusPoints(level: number) {
  return pointRules.firstLevelBonus * 2 ** Math.max(0, level - 1);
}

export const aimHitRules = {
  durationSeconds: 10,
  hitScore: 10,
  missPenalty: 2,
  comboEveryHits: 5,
  comboBonus: 20
} as const;

export const memoryRules = {
  durationSeconds: 10,
  previewSeconds: 2,
  cards: 6,
  hitScore: 25,
  missPenalty: 8,
  completionBonus: 40
} as const;

export const colorRushRules = {
  durationSeconds: 10,
  options: 6,
  hitScore: 12,
  missPenalty: 4,
  comboEveryHits: 4,
  comboBonus: 16
} as const;

export function calculatePlayPoints(score: number) {
  return Math.max(0, Math.floor(score / 10));
}

export const userSummary = {
  displayName: "Giorgi",
  points: 9000,
  dailyRank: 42,
  weeklyRank: 88
} as const;

export const games: Game[] = [
  {
    id: "color-rush",
    name: "Color Rush",
    icon: "/assets/color-rush-icon.png",
    pointRateLabel: "Fast color bonus"
  },
  {
    id: "memory",
    name: "Memory",
    icon: "/assets/memory-icon.png",
    pointRateLabel: "Fast match bonus"
  },
  {
    id: "aim-hit",
    name: "Aim Hit",
    icon: "/assets/aim-hit-icon.png",
    pointRateLabel: "Accuracy bonus"
  },
  {
    id: "lucky-spin",
    name: "Lucky Spin",
    icon: "/assets/lucky-spin-icon.png",
    pointRateLabel: "Timing bonus"
  },
  {
    id: "puzzle-run",
    name: "Puzzle Run",
    icon: "/assets/puzzle-run-icon.png",
    pointRateLabel: "Pattern bonus"
  },
  {
    id: "rocket-tap",
    name: "Rocket Tap",
    icon: "/assets/rocket-tap-icon.png",
    pointRateLabel: "Speed bonus"
  }
];

export const leaderboard: LeaderboardEntry[] = [
  { rank: 1, name: "alex_winner", points: 12840 },
  { rank: 2, name: "mari_gio", points: 11980 },
  { rank: 3, name: "niko_play", points: 10760 },
  { rank: 4, name: "dato_speed", points: 10400 },
  { rank: 5, name: "luka_combo", points: 9850 },
  { rank: 6, name: "ana_rush", points: 9360 },
  { rank: 7, name: "mariam_pro", points: 8720 },
  { rank: 8, name: "saba_hit", points: 8110 },
  { rank: 9, name: "tako_star", points: 7640 },
  { rank: 10, name: "nika_brain", points: 7210 },
  { rank: 11, name: "elene_win", points: 6880 },
  { rank: 12, name: "gio_color", points: 6240 },
  { rank: 13, name: "barbare_go", points: 5710 },
  { rank: 42, name: userSummary.displayName, points: userSummary.points }
];

export const rewards: Reward[] = [
  {
    id: "burger-combo",
    title: "King Burger Combo",
    brand: "Burger Palace",
    points: 500,
    category: "food",
    image: "/assets/reward-burger-photo2.webp"
  },
  {
    id: "cinema-ticket",
    title: "Cinema Ticket",
    brand: "CineClub",
    points: 900,
    category: "leisure",
    image: "/assets/reward-cinema-photo.webp"
  },
  {
    id: "headphones-discount",
    title: "Headphones Discount",
    brand: "TechStore",
    points: 1800,
    category: "tech",
    image: "/assets/reward-headphones-photo.webp"
  },
  {
    id: "coffee-voucher",
    title: "Coffee Voucher",
    brand: "Coffee Lab",
    points: 650,
    category: "food",
    image: "/assets/reward-coffee-photo.webp"
  },
  {
    id: "gaming-gear",
    title: "Gaming Gear Box",
    brand: "GameZone",
    points: 2400,
    category: "gaming",
    image: "/assets/reward-gaming-photo.webp"
  },
  {
    id: "fitness-pass",
    title: "Fitness Day Pass",
    brand: "FitHub",
    points: 1200,
    category: "leisure",
    image: "/assets/reward-fitness-photo.webp"
  }
];
