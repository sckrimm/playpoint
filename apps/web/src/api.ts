import type { GameId, GameResult, Reward } from "@playpoint/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4000";

export type ApiUser = {
  id: string;
  avatarUrl: string | null;
  coins: number;
  displayName: string;
  phone: string;
  totalPoints: number;
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
    dailyRank: number | null;
    gameAttempts: Array<{
      attemptsLeft: number;
      dailyAttemptLimit: number;
      gameSlug: GameId;
      usedAttempts: number;
    }>;
    gamesPlayed: number;
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
  return imageUrl?.replace(/\/assets\/(reward-[^/]+-photo)\.png$/, "/assets/$1.webp") ?? undefined;
}

export function toReward(apiReward: ApiReward): Reward {
  return {
    id: apiReward.slug,
    title: apiReward.title,
    brand: apiReward.brand.name,
    points: apiReward.requiredPoints,
    category: apiReward.category,
    image: normalizeRewardImageUrl(apiReward.imageUrl),
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
    return apiFetch<{ isNewUser: boolean; token: string; user: ApiUser }>("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ phone, code })
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
  updateMe(token: string, displayName: string) {
    return apiFetch<ApiMe>("/me", {
      method: "PATCH",
      token,
      body: JSON.stringify({ displayName })
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
      rank: { daily: number | null; weekly: number | null };
      score: GameResult & { rawScore: number; playPoints: number };
      user: Pick<ApiUser, "coins" | "displayName" | "id" | "totalPoints">;
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
  }
};
