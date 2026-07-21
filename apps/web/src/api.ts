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
  totalPoints: number;
  totalXp: number;
  xp: number;
};

export type ApiReward = {
  id: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  category: Reward["category"];
  claimedCount: number;
  quantity: number;
  requiredPoints: number;
  brand: {
    id: string;
    logoUrl: string | null;
    name: string;
  };
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
      user: Pick<ApiUser, "coins" | "displayName" | "id" | "level" | "totalPoints" | "totalXp" | "xp">;
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
      user: Pick<ApiUser, "coins" | "displayName" | "id" | "totalPoints">;
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
      user: Pick<ApiUser, "coins" | "displayName" | "id" | "level" | "totalPoints" | "totalXp" | "xp">;
      won: boolean;
    }>(`/rewards/${rewardId}/engage`, {
      method: "POST",
      token
    });
  }
};
