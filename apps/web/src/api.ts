import type { GameId, GameResult, Reward } from "@playpoint/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4000";

export type ApiUser = {
  id: string;
  avatarUrl: string | null;
  birthDate: string | null;
  coins: number;
  displayName: string;
  email: string | null;
  emailVerifiedAt: string | null;
  interests: string[];
  level: number;
  phone: string | null;
  phoneVerifiedAt: string | null;
  passwordSetAt: string | null;
  referralCode: string | null;
  referredById: string | null;
  role: "admin" | "user";
  lifetimeScore: number;
  marketCoins: number;
  seasonScore: number;
  totalPoints: number;
  totalXp: number;
  xp: number;
};

export type ApiAdminEconomy = {
  recentConversions: Array<{
    id: string;
    convertedAt: string;
    marketCoinsAwarded: number;
    scoreConverted: number;
    seasonKey: string;
    seasonScoreBefore: number;
    user: { displayName: string; id: string };
  }>;
  recentMarketCoinTransactions: Array<{
    id: string;
    amount: number;
    createdAt: string;
    expiresAt: string | null;
    remainingAmount: number;
    source: string | null;
    type: "earned_conversion" | "expired" | "spent_reward";
    user: { displayName: string; id: string };
  }>;
  recentRewardClaims: Array<{
    id: string;
    createdAt: string;
    pointsSpent: number;
    status: string;
    reward: { title: string };
    user: { displayName: string; id: string };
  }>;
  recentUsers: Array<{
    createdAt: string;
    displayName: string;
    id: string;
    marketCoins: number;
    role: "admin" | "user";
    seasonScore: number;
  }>;
  summary: {
    rewardClaimsCount: number;
    rewardsCount: number;
    totalGameScore: number;
    totalLifetimeScore: number;
    totalMarketCoins: number;
    totalMarketCoinsEarned: number;
    totalMarketCoinsExpired: number;
    totalMarketCoinsSpent: number;
    totalSeasonScore: number;
    totalXp: number;
    usersCount: number;
  };
  topUsers: Array<{
    displayName: string;
    id: string;
    marketCoins: number;
    seasonScore: number;
  }>;
};

export type ApiReward = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  imageUrl: string | null;
  category: Reward["category"];
  active?: boolean;
  claimedCount: number;
  expiresAt?: string | null;
  quantity: number;
  requiredPoints: number;
  brand: {
    id: string;
    logoUrl: string | null;
    name: string;
  };
  auditLogs?: Array<{
    adminUserId: string;
    changes: Record<string, unknown>;
    createdAt: string;
    id: string;
  }>;
};

export type ApiAdminRewardPayload = {
  active: boolean;
  brandLogoUrl?: string | null;
  brandName: string;
  category: Reward["category"];
  description?: string | null;
  expiresAt?: string | null;
  imageUrl?: string | null;
  quantity: number;
  requiredPoints: number;
  slug: string;
  title: string;
};

export type ApiAdminUserSummary = Pick<
  ApiUser,
  | "avatarUrl"
  | "displayName"
  | "email"
  | "emailVerifiedAt"
  | "id"
  | "level"
  | "marketCoins"
  | "phone"
  | "phoneVerifiedAt"
  | "role"
  | "seasonScore"
  | "totalXp"
  | "xp"
> & {
  createdAt: string;
};

export type ApiAdminUserDetail = {
  auditLogs: Array<{
    action: "manual_adjustment" | "role_change";
    adminUserId: string;
    createdAt: string;
    id: string;
    metadata: Record<string, unknown> | null;
    targetUserId: string;
  }>;
  user: ApiAdminUserSummary & {
    birthDate: string | null;
    interests: string[];
    lifetimeScore: number;
    referralCode: string | null;
    referredById: string | null;
    totalPoints: number;
    attempts: Array<{
      id: string;
      status: "started" | "finished" | "abandoned" | "rejected";
      startedAt: string;
      finishedAt: string | null;
      game: { slug: string; title: string };
    }>;
    marketCoinTransactions: Array<{
      id: string;
      amount: number;
      createdAt: string;
      source: string | null;
      type: "earned_conversion" | "expired" | "spent_reward";
    }>;
    pointBonuses: Array<{
      id: string;
      awardedAt: string;
      points: number;
      reason: string;
    }>;
    rewardClaims: Array<{
      id: string;
      createdAt: string;
      pointsSpent: number;
      status: string;
      reward: { title: string };
    }>;
    scores: Array<{
      id: string;
      createdAt: string;
      playPoints: number;
      rawScore: number;
      suspiciousReason: string | null;
      verificationStatus: "pending" | "verified" | "suspicious";
      game: { slug: string; title: string };
    }>;
  };
};

export type ApiAdminAdjustmentPayload = {
  amount: number;
  currency: "market_coin" | "season_score" | "xp";
  note: string;
};

export type ApiAdminCampaign = {
  id: string;
  title: string;
  status: "active" | "completed" | "draft" | "paused";
  rulesText: string | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
  brand: {
    id: string;
    logoUrl: string | null;
    name: string;
  };
  games: Array<{
    game: {
      id: string;
      slug: string;
      title: string;
    };
  }>;
  rewards: Array<{
    reward: {
      id: string;
      slug: string;
      title: string;
    };
  }>;
};

export type ApiAdminCampaignOptions = {
  games: Array<{
    active: boolean;
    id: string;
    slug: string;
    title: string;
  }>;
  rewards: Array<{
    active: boolean;
    brand: { name: string };
    id: string;
    slug: string;
    title: string;
  }>;
};

export type ApiAdminCampaignPayload = {
  brandLogoUrl?: string | null;
  brandName: string;
  endsAt: string;
  gameIds: string[];
  rewardIds: string[];
  rulesText?: string | null;
  startsAt: string;
  status: ApiAdminCampaign["status"];
  title: string;
};

export type ApiAdminGame = {
  active: boolean;
  comingSoon: boolean;
  dailyAttemptLimit: number;
  description: string | null;
  iconUrl: string | null;
  id: string;
  pointRatio: number | null;
  scoringRule: unknown;
  slug: string;
  sortOrder: number;
  title: string;
  updatedAt: string;
};

export type ApiGameCatalogItem = ApiAdminGame;

export type ApiAdminGamePayload = {
  active: boolean;
  comingSoon: boolean;
  dailyAttemptLimit: number;
  description?: string | null;
  iconUrl?: string | null;
  pointRatio?: number | null;
  scoringRule?: string | null;
  sortOrder: number;
  title: string;
};

export type ApiRewardClaim = {
  id: string;
  pointsSpent: number;
  status: string;
  createdAt: string;
  reward: ApiReward;
};

export type ApiLeaderboardEntry = {
  rank: number;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  gameTitle: string;
  gameSlug: GameId | "bonus";
  rawScore: number;
  playPoints: number;
  createdAt: string;
};

export type ApiDailyLoginProgress = {
  cycleProgress: number;
  pointsPerDay: number;
  todayClaimed: boolean;
  totalClaims: number;
  weekDays: Array<{
    claimed: boolean;
    index: number;
  }>;
};

export type ApiLevelProgress = {
  level: number;
  levelBonusPoints: number;
  progressPercent: number;
  xp: number;
  xpAwarded: number;
  xpRequired: number;
  levelUps: Array<{
    bonusPoints: number;
    level: number;
  }>;
};

export type ApiProfileCompletion = {
  awarded: boolean;
  percent: number;
  rewardPoints: number;
  tasks: Array<{
    completed: boolean;
    key: "avatar" | "birthDate" | "displayName" | "email" | "interests" | "password" | "phone";
    label: string;
  }>;
};

export type ApiWalletHistoryItem = {
  id: string;
  amount: number;
  createdAt: string;
  currency: "market_coin" | "season_score";
  expiresAt: string | null;
  source: string | null;
  type: "earned_conversion" | "expired" | "game_score" | "point_bonus" | "spent_reward";
};

export type ApiSeasonConversionNotice = {
  id: string;
  convertedAt: string;
  marketCoinsAwarded: number;
  scoreConverted: number;
  seasonKey: string;
  seasonScoreBefore: number;
};

export type ApiAuthPayload = {
  dailyLogin?: {
    awardedToday: boolean;
    levelProgress: ApiLevelProgress | null;
    points: number;
    progress: ApiDailyLoginProgress;
  };
  isNewUser: boolean;
  token: string;
  user: ApiUser;
};

export type ApiMe = {
  user: ApiUser;
  gameHistory: Array<{
    id: string;
    createdAt: string;
    gameSlug: GameId;
    gameTitle: string;
    playPoints: number;
    rawScore: number;
  }>;
  stats: {
    dailyLogin: ApiDailyLoginProgress;
    levelProgress: ApiLevelProgress;
    profileCompletion: ApiProfileCompletion;
    referralCount: number;
    dailyRank: number | null;
    gameAttempts: Array<{
      attemptsLeft: number;
      dailyAttemptLimit: number;
      gameSlug: GameId;
      usedAttempts: number;
    }>;
    gamesPlayed: number;
    rewardEngagements: string[];
    weeklyRank: number | null;
  };
  rewardClaims: ApiRewardClaim[];
  wallet: {
    expiringMarketCoins: number;
    history: ApiWalletHistoryItem[];
    latestConversion: ApiSeasonConversionNotice | null;
  };
};

export type GameAttemptStart = {
  attemptId: string;
  attemptsLeft: number;
  dailyAttemptLimit: number;
  scoreToken: string;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options: RequestInit & { token?: string } = {}) {
  const headers = new Headers(options.headers);

  if (options.body) {
    headers.set("Content-Type", "application/json");
  }

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(response.status, payload?.message ?? "Request failed");
  }

  return payload as T;
}

function normalizeRewardImageUrl(imageUrl: string | null) {
  if (!imageUrl) return undefined;
  return imageUrl
    .replace(/\/assets\/reward-burger-photo(?:2)?\.(?:png|webp)$/, "/assets/reward-burger-photo2.webp")
    .replace(/\/assets\/(reward-[^/]+-photo)\.png$/, "/assets/$1.webp");
}

function normalizeRewardBrandLogoUrl(brandName: string, logoUrl: string | null) {
  const fallbackLogos: Record<string, string> = {
    "Burger Palace": "/assets/reward-burger.svg",
    "CineClub": "/assets/reward-cinema.svg",
    "Coffee Lab": "/assets/reward-coffee.svg",
    "FitHub": "/assets/reward-fitness.svg",
    "GameZone": "/assets/reward-gaming.svg",
    "TechStore": "/assets/reward-headphones.svg"
  };

  return (
    logoUrl
      ?.replace(/\/assets\/brand-burger-palace\.png$/, "/assets/reward-burger.svg")
      .replace(/\/assets\/brand-cineclub\.png$/, "/assets/reward-cinema.svg")
      .replace(/\/assets\/brand-coffee-lab\.png$/, "/assets/reward-coffee.svg")
      .replace(/\/assets\/brand-fithub\.png$/, "/assets/reward-fitness.svg")
      .replace(/\/assets\/brand-gamezone\.png$/, "/assets/reward-gaming.svg")
      .replace(/\/assets\/brand-tech-store\.png$/, "/assets/reward-headphones.svg") ??
    fallbackLogos[brandName]
  );
}

export function toReward(apiReward: ApiReward): Reward {
  return {
    id: apiReward.slug,
    title: apiReward.title,
    brand: apiReward.brand.name,
    points: apiReward.requiredPoints,
    category: apiReward.category,
    image: normalizeRewardImageUrl(apiReward.imageUrl),
    brandLogo: normalizeRewardBrandLogoUrl(apiReward.brand.name, apiReward.brand.logoUrl),
    quantity: apiReward.quantity,
    remainingQuantity: Math.max(0, apiReward.quantity - apiReward.claimedCount)
  };
}

export const playpointApi = {
  requestOtp(phone: string) {
    return apiFetch<{ devCode?: string; expiresAt: string; expiresInSeconds: number; ok: true; phone: string }>(
      "/auth/request-otp",
      {
        method: "POST",
        body: JSON.stringify({ phone })
      }
    );
  },
  verifyOtp(phone: string, code: string) {
    return apiFetch<ApiAuthPayload>("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ phone, code })
    });
  },
  loginWithGoogle(idToken: string) {
    return apiFetch<ApiAuthPayload>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken })
    });
  },
  loginWithApple(idToken: string) {
    return apiFetch<ApiAuthPayload>("/auth/apple", {
      method: "POST",
      body: JSON.stringify({ idToken })
    });
  },
  requestEmailVerification(token: string, email: string) {
    return apiFetch<{ devCode?: string; email: string; expiresAt: string; expiresInSeconds: number; ok: true }>(
      "/auth/request-email-verification",
      {
        method: "POST",
        token,
        body: JSON.stringify({ email })
      }
    );
  },
  verifyEmail(token: string, email: string, code: string) {
    return apiFetch<{ levelProgress?: ApiLevelProgress | null; ok: true; user: ApiUser }>("/auth/verify-email", {
      method: "POST",
      token,
      body: JSON.stringify({ email, code })
    });
  },
  logout(token: string) {
    return apiFetch<{ ok: true }>("/auth/logout", {
      method: "POST",
      token
    });
  },
  getMe(token: string) {
    return apiFetch<ApiMe>("/me", { token });
  },
  getGames() {
    return apiFetch<ApiGameCatalogItem[]>("/games");
  },
  getAdminEconomy(token: string) {
    return apiFetch<ApiAdminEconomy>("/admin/economy", { token });
  },
  getAdminRewards(token: string) {
    return apiFetch<ApiReward[]>("/admin/rewards", { token });
  },
  createAdminReward(token: string, reward: ApiAdminRewardPayload) {
    return apiFetch<ApiReward>("/admin/rewards", {
      method: "POST",
      token,
      body: JSON.stringify(reward)
    });
  },
  updateAdminReward(token: string, rewardId: string, reward: ApiAdminRewardPayload) {
    return apiFetch<ApiReward>(`/admin/rewards/${rewardId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(reward)
    });
  },
  getAdminUsers(token: string, query = "") {
    return apiFetch<ApiAdminUserSummary[]>(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`, { token });
  },
  getAdminUser(token: string, userId: string) {
    return apiFetch<ApiAdminUserDetail>(`/admin/users/${userId}`, { token });
  },
  updateAdminUserRole(token: string, userId: string, role: ApiUser["role"]) {
    return apiFetch<{ user: ApiAdminUserSummary }>(`/admin/users/${userId}/role`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ role })
    });
  },
  createAdminUserAdjustment(token: string, userId: string, adjustment: ApiAdminAdjustmentPayload) {
    return apiFetch<{ user: ApiAdminUserSummary }>(`/admin/users/${userId}/adjustments`, {
      method: "POST",
      token,
      body: JSON.stringify(adjustment)
    });
  },
  getAdminCampaigns(token: string) {
    return apiFetch<ApiAdminCampaign[]>("/admin/campaigns", { token });
  },
  getAdminCampaignOptions(token: string) {
    return apiFetch<ApiAdminCampaignOptions>("/admin/campaigns/options", { token });
  },
  createAdminCampaign(token: string, campaign: ApiAdminCampaignPayload) {
    return apiFetch<ApiAdminCampaign>("/admin/campaigns", {
      method: "POST",
      token,
      body: JSON.stringify(campaign)
    });
  },
  updateAdminCampaign(token: string, campaignId: string, campaign: ApiAdminCampaignPayload) {
    return apiFetch<ApiAdminCampaign>(`/admin/campaigns/${campaignId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(campaign)
    });
  },
  getAdminGames(token: string) {
    return apiFetch<ApiAdminGame[]>("/admin/games", { token });
  },
  updateAdminGame(token: string, gameId: string, game: ApiAdminGamePayload) {
    return apiFetch<ApiAdminGame>(`/admin/games/${gameId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(game)
    });
  },
  updateMe(
    token: string,
    profile: {
      avatarUrl?: string | null;
      birthDate?: string | null;
      displayName?: string;
      referralCode?: string;
      interests?: string[];
      password?: string;
      passwordConfirm?: string;
    }
  ) {
    return apiFetch<ApiMe>("/me", {
      method: "PATCH",
      token,
      body: JSON.stringify(profile)
    });
  },
  getRewards() {
    return apiFetch<ApiReward[]>("/rewards");
  },
  getLeaderboard(scope: "daily" | "weekly") {
    return apiFetch<ApiLeaderboardEntry[]>(`/leaderboard/${scope}`);
  },
  startGame(token: string, gameId: GameId) {
    return apiFetch<GameAttemptStart>(`/games/${gameId}/start`, {
      method: "POST",
      token
    });
  },
  finishGame(token: string, gameId: GameId, attempt: GameAttemptStart, result: GameResult) {
    return apiFetch<{
      levelProgress: ApiLevelProgress;
      rank: { daily: number | null; weekly: number | null };
      score: GameResult & { rawScore: number; playPoints: number };
      user: Pick<ApiUser, "coins" | "displayName" | "id" | "level" | "lifetimeScore" | "marketCoins" | "seasonScore" | "totalPoints" | "totalXp" | "xp">;
    }>(`/games/${gameId}/finish`, {
      method: "POST",
      token,
      body: JSON.stringify({
        accuracy: result.accuracy,
        attemptId: attempt.attemptId,
        durationSeconds: result.durationSeconds,
        hits: result.hits,
        maxCombo: result.maxCombo,
        misses: result.misses,
        rawScore: result.score,
        scoreToken: attempt.scoreToken
      })
    });
  },
  claimReward(token: string, rewardId: string) {
    return apiFetch<{
      claim: ApiRewardClaim;
      user: Pick<ApiUser, "coins" | "displayName" | "id" | "lifetimeScore" | "marketCoins" | "seasonScore" | "totalPoints">;
    }>(`/rewards/${rewardId}/claim`, {
      method: "POST",
      token
    });
  },
  engageReward(token: string, rewardId: string) {
    return apiFetch<{
      alreadyAwarded: boolean;
      levelProgress: ApiLevelProgress | null;
      points: number;
      rewardId: string;
      user: Pick<ApiUser, "coins" | "displayName" | "id" | "level" | "lifetimeScore" | "marketCoins" | "seasonScore" | "totalPoints" | "totalXp" | "xp">;
      won: boolean;
    }>(`/rewards/${rewardId}/engage`, {
      method: "POST",
      token
    });
  }
};
