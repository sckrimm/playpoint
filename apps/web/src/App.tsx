import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Brain,
  Camera,
  CircleDollarSign,
  CheckCircle2,
  ChevronDown,
  Coins,
  Gift,
  Gamepad2,
  Home,
  Languages,
  Lock,
  LogOut,
  Loader2,
  MailCheck,
  Mail,
  Medal,
  Moon,
  Pencil,
  Phone,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Timer,
  Target,
  TrendingUp,
  Trophy,
  User,
  Smartphone,
  X
} from "lucide-react";
import {
  type GameId,
  type GameResult,
  type Reward,
  games,
  leaderboard,
  pointRules,
  rewards,
  userSummary
} from "@playpoint/shared";
import { AimHitGame } from "./games/aim-hit/AimHitGame";
import { ApiError, type GameAttemptStart, playpointApi, toReward } from "./api";
import { ColorRushGame } from "./games/color-rush/ColorRushGame";
import { getText, type Language, type TextGetter } from "./i18n";
import { MemoryGame } from "./games/memory/MemoryGame";

type Route =
  | "splash"
  | "phone"
  | "otp"
  | "profile-setup"
  | "home"
  | "game-loading"
  | "game-frame"
  | "score-popup"
  | "leaderboard-daily"
  | "leaderboard-weekly"
  | "rewards"
  | "profile"
  | "edit-profile";

const tokenStorageKey = "playpoint.authToken";
const defaultRoute: Route = window.localStorage.getItem(tokenStorageKey) ? "home" : "splash";
const showDevOtpCode = import.meta.env.DEV;
const formatter = new Intl.NumberFormat("en-US");

function AnimatedPoints({
  value,
  suffix = ""
}: {
  value: number;
  suffix?: string;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const currentValue = useRef(0);

  useEffect(() => {
    const startValue = currentValue.current;
    const difference = value - startValue;
    const duration = Math.min(1200, Math.max(520, Math.abs(difference) * 0.08));
    const startTime = window.performance.now();
    let frameId = 0;

    const tick = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + difference * easedProgress);
      currentValue.current = nextValue;
      setDisplayValue(nextValue);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      currentValue.current = value;
      setDisplayValue(value);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return (
    <span className="animated-points">
      {formatter.format(displayValue)}
      {suffix}
    </span>
  );
}

const coinPackages = [
  { id: "starter", coins: 14, price: "₾1.99", label: "Starter" },
  { id: "boost", coins: 30, price: "₾3.99", label: "Boost" },
  { id: "player", coins: 65, price: "₾7.99", label: "Player" },
  { id: "pro", coins: 140, price: "₾14.99", label: "Pro" },
  { id: "champion", coins: 320, price: "₾29.99", label: "Champion" },
  { id: "legend", coins: 720, price: "₾59.99", label: "Legend" }
];

type RankedLeaderboardEntry = {
  rank: number;
  name: string;
  points: number;
  isCurrentUser?: boolean;
};

type AttemptsLeftByGame = Record<GameId, number>;

const screenMap: Record<Route, string> = {
  splash: "prototype/screens/splash",
  phone: "prototype/screens/phone-login",
  otp: "prototype/screens/otp-verification",
  "profile-setup": "prototype/screens/profile-setup",
  home: "prototype/screens/home",
  "game-loading": "prototype/screens/game-loading",
  "game-frame": "prototype/screens/game-frame",
  "score-popup": "prototype/screens/score-popup",
  "leaderboard-daily": "prototype/screens/leaderboard-daily",
  "leaderboard-weekly": "prototype/screens/leaderboard-weekly",
  rewards: "prototype/screens/rewards",
  profile: "prototype/screens/profile",
  "edit-profile": "prototype/screens/edit-profile"
};

function readRoute(): Route {
  const route = window.location.hash.replace("#/", "") as Route;
  return route in screenMap ? route : defaultRoute;
}

function buildLeaderboard(userName: string, userPoints: number): RankedLeaderboardEntry[] {
  const normalizedUserName = userName.trim() || userSummary.displayName;
  const basePlayers = leaderboard
    .filter((player) => player.name !== userSummary.displayName && player.name !== normalizedUserName)
    .map((player) => ({
      name: player.name,
      points: player.points
    }));

  return [...basePlayers, { name: normalizedUserName, points: userPoints, isCurrentUser: true }]
    .sort((first, second) => second.points - first.points)
    .map((player, index) => ({
      ...player,
      rank: index + 1
    }));
}

function getApiErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Network request failed";
}

function toRankedLeaderboard(
  entries: Awaited<ReturnType<typeof playpointApi.getLeaderboard>>,
  currentUserName: string
): RankedLeaderboardEntry[] {
  return entries.map((entry) => ({
    rank: entry.rank,
    name: entry.userName,
    points: entry.playPoints,
    isCurrentUser: entry.userName === currentUserName
  }));
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [authToken, setAuthToken] = useState<string>(() => window.localStorage.getItem(tokenStorageKey) ?? "");
  const [phoneValue, setPhoneValue] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [devOtpCode, setDevOtpCode] = useState("");
  const [profileName, setProfileName] = useState<string>(userSummary.displayName);
  const [userPoints, setUserPoints] = useState<number>(userSummary.points);
  const [userCoins, setUserCoins] = useState<number>(14);
  const [gamesPlayed, setGamesPlayed] = useState<number>(0);
  const [attemptsLeftByGame, setAttemptsLeftByGame] = useState<AttemptsLeftByGame>({
    "aim-hit": pointRules.dailyAttemptsPerGame,
    "color-rush": pointRules.dailyAttemptsPerGame,
    memory: pointRules.dailyAttemptsPerGame
  });
  const [dailyRank, setDailyRank] = useState<number | null>(null);
  const [weeklyRank, setWeeklyRank] = useState<number | null>(null);
  const [language, setLanguage] = useState<Language>("ka");
  const [darkMode, setDarkMode] = useState(false);
  const [purchasedRewards, setPurchasedRewards] = useState<Reward[]>([]);
  const [rewardCatalog, setRewardCatalog] = useState<Reward[]>(rewards);
  const [otpValue, setOtpValue] = useState("");
  const [selectedGameId, setSelectedGameId] = useState<GameId>("aim-hit");
  const [currentAttempt, setCurrentAttempt] = useState<GameAttemptStart | null>(null);
  const [lastGameResult, setLastGameResult] = useState<GameResult>({
    gameId: "aim-hit",
    score: 0,
    playPoints: 0,
    durationSeconds: 10,
    hits: 0,
    misses: 0,
    accuracy: 0,
    maxCombo: 0
  });
  const [dailyLeaderboard, setDailyLeaderboard] = useState<RankedLeaderboardEntry[]>(() =>
    buildLeaderboard(userSummary.displayName, userSummary.points)
  );
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<RankedLeaderboardEntry[]>(() =>
    buildLeaderboard(userSummary.displayName, userSummary.points)
  );
  const [apiBusy, setApiBusy] = useState(false);
  const rankedLeaderboard = route === "leaderboard-weekly" ? weeklyLeaderboard : dailyLeaderboard;
  const userRank =
    (route === "leaderboard-weekly" ? weeklyRank : dailyRank) ??
    rankedLeaderboard.find((player) => player.isCurrentUser)?.rank ??
    rankedLeaderboard.length;
  const text = useMemo<TextGetter>(() => (key) => getText(language, key), [language]);

  const applyMePayload = (payload: Awaited<ReturnType<typeof playpointApi.getMe>>) => {
    setProfileName(payload.user.displayName);
    setUserPoints(payload.user.totalPoints);
    setUserCoins(payload.user.coins);
    setGamesPlayed(payload.stats.gamesPlayed);
    setDailyRank(payload.stats.dailyRank);
    setWeeklyRank(payload.stats.weeklyRank);
    setAttemptsLeftByGame((currentAttempts) => {
      const nextAttempts = { ...currentAttempts };
      payload.stats.gameAttempts.forEach((attempt) => {
        nextAttempts[attempt.gameSlug] = attempt.attemptsLeft;
      });
      return nextAttempts;
    });
    setPurchasedRewards(payload.rewardClaims.map((claim) => toReward(claim.reward)));
  };

  const refreshAccount = async (token = authToken) => {
    if (!token) return;
    const [me, rewardsPayload, dailyPayload, weeklyPayload] = await Promise.all([
      playpointApi.getMe(token),
      playpointApi.getRewards(),
      playpointApi.getLeaderboard("daily"),
      playpointApi.getLeaderboard("weekly")
    ]);
    applyMePayload(me);
    setRewardCatalog(rewardsPayload.map(toReward));
    setDailyLeaderboard(toRankedLeaderboard(dailyPayload, me.user.displayName));
    setWeeklyLeaderboard(toRankedLeaderboard(weeklyPayload, me.user.displayName));
  };

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!authToken) return;

    let ignore = false;
    setApiBusy(true);
    refreshAccount(authToken)
      .catch((error: unknown) => {
        if (ignore) return;
        window.localStorage.removeItem(tokenStorageKey);
        setAuthToken("");
        window.alert(getApiErrorMessage(error));
        navigate("splash");
      })
      .finally(() => {
        if (!ignore) setApiBusy(false);
      });

    return () => {
      ignore = true;
    };
  }, [authToken]);

  const navigate = (nextRoute: Route) => {
    window.location.hash = `/${nextRoute}`;
    setRoute(nextRoute);
  };

  const requestOtp = async () => {
    try {
      setApiBusy(true);
      const payload = await playpointApi.requestOtp(phoneValue);
      setVerifiedPhone(payload.phone);
      setDevOtpCode(payload.devCode ?? "");
      setOtpValue("");
      navigate("otp");
    } catch (error: unknown) {
      window.alert(getApiErrorMessage(error));
    } finally {
      setApiBusy(false);
    }
  };

  const verifyOtp = async () => {
    try {
      setApiBusy(true);
      const payload = await playpointApi.verifyOtp(verifiedPhone || phoneValue, otpValue);
      window.localStorage.setItem(tokenStorageKey, payload.token);
      setAuthToken(payload.token);
      setProfileName(payload.user.displayName);
      setUserPoints(payload.user.totalPoints);
      setUserCoins(payload.user.coins);
      navigate("profile-setup");
    } catch (error: unknown) {
      window.alert(getApiErrorMessage(error));
    } finally {
      setApiBusy(false);
    }
  };

  const finishProfileSetup = async () => {
    if (!authToken) {
      navigate("phone");
      return;
    }

    try {
      setApiBusy(true);
      const payload = await playpointApi.updateMe(authToken, profileName);
      applyMePayload(payload);
      await refreshAccount(authToken);
      navigate("home");
    } catch (error: unknown) {
      window.alert(getApiErrorMessage(error));
    } finally {
      setApiBusy(false);
    }
  };

  const selectGame = async (gameId: GameId) => {
    if (!authToken) {
      navigate("phone");
      return;
    }

    try {
      setApiBusy(true);
      const attempt = await playpointApi.startGame(authToken, gameId);
      setSelectedGameId(gameId);
      setCurrentAttempt(attempt);
      setAttemptsLeftByGame((currentAttempts) => ({
        ...currentAttempts,
        [gameId]: attempt.attemptsLeft
      }));
      navigate("game-loading");
    } catch (error: unknown) {
      window.alert(getApiErrorMessage(error));
    } finally {
      setApiBusy(false);
    }
  };

  const finishGame = async (result: GameResult) => {
    if (!authToken || !currentAttempt) {
      window.alert("Game attempt was not started");
      navigate("home");
      return;
    }

    try {
      setApiBusy(true);
      const payload = await playpointApi.finishGame(authToken, result.gameId, currentAttempt, result);
      const syncedResult = {
        ...result,
        playPoints: payload.score.playPoints
      };
      setLastGameResult(syncedResult);
      setUserPoints(payload.user.totalPoints);
      setUserCoins(payload.user.coins);
      setDailyRank(payload.rank.daily);
      setWeeklyRank(payload.rank.weekly);
      setCurrentAttempt(null);
      await refreshAccount(authToken);
      navigate("score-popup");
    } catch (error: unknown) {
      window.alert(getApiErrorMessage(error));
      navigate("home");
    } finally {
      setApiBusy(false);
    }
  };

  const claimReward = async (reward: Reward) => {
    if (!authToken) {
      navigate("phone");
      return false;
    }

    try {
      setApiBusy(true);
      const payload = await playpointApi.claimReward(authToken, reward.id);
      setUserPoints(payload.user.totalPoints);
      setUserCoins(payload.user.coins);
      await refreshAccount(authToken);
      return true;
    } catch (error: unknown) {
      window.alert(getApiErrorMessage(error));
      return false;
    } finally {
      setApiBusy(false);
    }
  };

  const restartRegistration = () => {
    if (authToken) {
      playpointApi.logout(authToken).catch(() => undefined);
    }
    window.localStorage.removeItem(tokenStorageKey);
    setAuthToken("");
    setPhoneValue("");
    setVerifiedPhone("");
    setDevOtpCode("");
    setProfileName(userSummary.displayName);
    setUserPoints(userSummary.points);
    setUserCoins(14);
    setGamesPlayed(0);
    setAttemptsLeftByGame({
      "aim-hit": pointRules.dailyAttemptsPerGame,
      "color-rush": pointRules.dailyAttemptsPerGame,
      memory: pointRules.dailyAttemptsPerGame
    });
    setDailyRank(null);
    setWeeklyRank(null);
    setPurchasedRewards([]);
    setRewardCatalog(rewards);
    setDailyLeaderboard(buildLeaderboard(userSummary.displayName, userSummary.points));
    setWeeklyLeaderboard(buildLeaderboard(userSummary.displayName, userSummary.points));
    setOtpValue("");
    setSelectedGameId("aim-hit");
    setCurrentAttempt(null);
    setLastGameResult({
      gameId: "aim-hit",
      score: 0,
      playPoints: 0,
      durationSeconds: 10,
      hits: 0,
      misses: 0,
      accuracy: 0,
      maxCombo: 0
    });
    navigate("splash");
  };

  const showChrome = !["splash", "phone", "otp", "profile-setup", "game-loading"].includes(route);

  return (
    <div className={darkMode ? "app-shell dark-mode" : "app-shell"}>
      <main className="phone-shell" aria-label="PlayPoint web MVP">
        {showChrome ? (
          <TopBar
            route={route}
            text={text}
            userCoins={userCoins}
            userPoints={userPoints}
            onNavigate={navigate}
          />
        ) : null}

        <div className={showChrome ? "screen-content" : "screen-content auth-content"}>
          {route === "splash" ? <SplashPage text={text} onNavigate={navigate} /> : null}
          {route === "phone" ? (
            <PhonePage
              disabled={apiBusy}
              phoneValue={phoneValue}
              setPhoneValue={setPhoneValue}
              text={text}
              onRequestOtp={requestOtp}
            />
          ) : null}
          {route === "otp" ? (
            <OtpPage
              devOtpCode={devOtpCode}
              disabled={apiBusy}
              phone={verifiedPhone || phoneValue}
              text={text}
              otpValue={otpValue}
              setOtpValue={setOtpValue}
              onNavigate={navigate}
              onVerifyOtp={verifyOtp}
            />
          ) : null}
          {route === "profile-setup" ? (
            <ProfileSetupPage
              disabled={apiBusy}
              profileName={profileName}
              setProfileName={setProfileName}
              text={text}
              onFinish={finishProfileSetup}
            />
          ) : null}
          {route === "home" ? (
            <HomePage
              leaderboardEntries={rankedLeaderboard}
              attemptsLeftByGame={attemptsLeftByGame}
              rewardCatalog={rewardCatalog}
              text={text}
              userCoins={userCoins}
              onBuyCoins={(coins) => setUserCoins((currentCoins) => currentCoins + coins)}
              onNavigate={navigate}
              onSelectGame={selectGame}
            />
          ) : null}
          {route === "game-loading" ? (
            <GameLoadingPage text={text} selectedGameId={selectedGameId} onNavigate={navigate} />
          ) : null}
          {route === "game-frame" ? (
            <GameFramePage
              language={language}
              text={text}
              selectedGameId={selectedGameId}
              onNavigate={navigate}
              onFinish={finishGame}
            />
          ) : null}
          {route === "score-popup" ? (
            <ScorePopupPage
              result={lastGameResult}
              text={text}
              userPoints={userPoints}
              userRank={userRank}
              onNavigate={navigate}
              onPlayAgain={selectGame}
            />
          ) : null}
          {route === "leaderboard-daily" ? (
            <LeaderboardPage
              scope="daily"
              leaderboardEntries={rankedLeaderboard}
              text={text}
              userRank={userRank}
              onNavigate={navigate}
            />
          ) : null}
          {route === "leaderboard-weekly" ? (
            <LeaderboardPage
              scope="weekly"
              leaderboardEntries={rankedLeaderboard}
              text={text}
              userRank={userRank}
              onNavigate={navigate}
            />
          ) : null}
          {route === "rewards" ? (
            <RewardsPage
              purchasedRewards={purchasedRewards}
              rewards={rewardCatalog}
              text={text}
              userPoints={userPoints}
              onClaimReward={claimReward}
            />
          ) : null}
          {route === "profile" ? (
            <ProfilePage
              darkMode={darkMode}
              language={language}
              profileName={profileName}
              purchasedRewards={purchasedRewards}
              setDarkMode={setDarkMode}
              setLanguage={setLanguage}
              text={text}
              userCoins={userCoins}
              userPoints={userPoints}
              userRank={userRank}
              gamesPlayed={gamesPlayed}
              lastGameResult={lastGameResult}
              onNavigate={navigate}
              onLogout={restartRegistration}
            />
          ) : null}
          {route === "edit-profile" ? (
            <EditProfilePage
              profileName={profileName}
              text={text}
              userPoints={userPoints}
              setProfileName={setProfileName}
              onSaveProfile={async (nextName) => {
                if (!authToken) return;
                const payload = await playpointApi.updateMe(authToken, nextName);
                applyMePayload(payload);
                await refreshAccount(authToken);
              }}
              onNavigate={navigate}
            />
          ) : null}
        </div>

        {showChrome ? <BottomNav route={route} text={text} onNavigate={navigate} /> : null}
      </main>
    </div>
  );
}

function TopBar({
  route,
  text,
  userCoins,
  userPoints,
  onNavigate
}: {
  route: Route;
  text: TextGetter;
  userCoins: number;
  userPoints: number;
  onNavigate: (route: Route) => void;
}) {
  const title = useMemo(() => {
    if (route === "leaderboard-daily" || route === "leaderboard-weekly") return text("route.leaderboard");
    if (route === "rewards") return text("route.rewards");
    if (route === "profile") return text("route.profile");
    if (route === "edit-profile") return text("route.editProfile");
    if (route === "game-frame") return text("route.game");
    if (route === "score-popup") return text("route.result");
    return "PlayPoint";
  }, [route, text]);

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{screenMap[route]}</p>
        <h1>{title}</h1>
      </div>
      <div className="topbar-wallet">
        <button className="coin-pill" type="button" onClick={() => onNavigate("profile")}>
          <Coins size={18} />
          {formatter.format(userCoins)}
        </button>
        <button className="points-pill" type="button" onClick={() => onNavigate("profile")}>
          <Sparkles size={18} />
          <AnimatedPoints value={userPoints} suffix=" pts" />
        </button>
      </div>
    </header>
  );
}

function BottomNav({ route, text, onNavigate }: { route: Route; text: TextGetter; onNavigate: (route: Route) => void }) {
  const items = [
    { route: "home" as const, label: text("nav.home"), icon: Home },
    { route: "leaderboard-daily" as const, label: text("nav.ranks"), icon: Medal },
    { route: "rewards" as const, label: text("nav.rewards"), icon: Gift },
    { route: "profile" as const, label: text("nav.me"), icon: User }
  ];

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          route === item.route ||
          (item.route === "leaderboard-daily" && route === "leaderboard-weekly");
        return (
          <button
            className={active ? "active" : ""}
            key={item.route}
            type="button"
            onClick={() => onNavigate(item.route)}
          >
            <Icon size={20} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function SplashPage({ text, onNavigate }: { text: TextGetter; onNavigate: (route: Route) => void }) {
  return (
    <section className="splash-screen" onClick={() => onNavigate("phone")}>
      <div className="ambient-glow glow-a" />
      <div className="ambient-glow glow-b" />
      <div className="decor-icons" aria-hidden="true">
        <Star className="decor-star" size={48} />
        <Gift className="decor-gift" size={56} />
        <Trophy className="decor-trophy" size={40} />
        <Gamepad2 className="decor-gamepad" size={64} />
      </div>
      <div className="splash-main">
        <div className="app-mark">
          <Gamepad2 size={74} fill="currentColor" />
        </div>
        <h1>PlayPoint</h1>
      </div>
      <p>{text("app.tagline")}</p>
      <div className="splash-dots" aria-label="Loading">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function PhonePage({
  disabled,
  phoneValue,
  setPhoneValue,
  text,
  onRequestOtp
}: {
  disabled: boolean;
  phoneValue: string;
  setPhoneValue: (value: string) => void;
  text: TextGetter;
  onRequestOtp: () => void;
}) {
  return (
    <section className="onboarding-page phone-page">
      <header className="onboarding-logo">PlayPoint</header>
      <main className="onboarding-main">
        <div className="phone-hero">
          <div className="phone-hero-icon">
            <Smartphone size={52} />
          </div>
        </div>

        <div className="onboarding-copy">
          <h1>{text("phone.title")}</h1>
          <p>{text("phone.subtitle")}</p>
        </div>

        <div className="phone-form">
          <div className="phone-row">
            <button className="country-select" type="button">
              +995
              <ChevronDown size={20} />
            </button>
            <input
              className="phone-number-input"
              inputMode="tel"
              maxLength={12}
              placeholder="5XX XX XX XX"
              value={phoneValue}
              onChange={(event) => setPhoneValue(event.target.value)}
            />
          </div>
          <button className="primary-action" type="button" disabled={disabled || phoneValue.trim().length < 6} onClick={onRequestOtp}>
            {text("phone.continue")}
          </button>
        </div>

        <div className="social-section">
          <div className="divider-label">
            <span />
            {text("phone.social")}
            <span />
          </div>
          <div className="social-actions">
            <button type="button" aria-label="Continue with Google">G</button>
            <button type="button" aria-label="Continue with Apple"></button>
          </div>
        </div>
      </main>
      <footer className="onboarding-footer">
        {text("phone.terms")} <br />
        <a href="#terms">{text("phone.termsLink")}</a> {text("common.and")} <a href="#privacy">{text("phone.privacyLink")}</a>
      </footer>
    </section>
  );
}

function OtpPage({
  devOtpCode,
  disabled,
  phone,
  text,
  otpValue,
  setOtpValue,
  onNavigate,
  onVerifyOtp
}: {
  devOtpCode: string;
  disabled: boolean;
  phone: string;
  text: TextGetter;
  otpValue: string;
  setOtpValue: (value: string) => void;
  onNavigate: (route: Route) => void;
  onVerifyOtp: () => void;
}) {
  const otpLength = 6;
  const digits = otpValue.padEnd(otpLength, " ").slice(0, otpLength).split("");

  return (
    <section className="onboarding-page otp-page">
      <header className="focused-header">
        <button className="icon-action" type="button" aria-label="Go back" onClick={() => onNavigate("phone")}>
          <ArrowLeft size={20} />
        </button>
        <strong>PlayPoint</strong>
        <span />
      </header>

      <main className="otp-main">
        <div className="otp-hero">
          <div className="otp-glow" />
          <div className="otp-icon-card">
            <MailCheck size={82} />
          </div>
        </div>

        <div className="otp-copy">
          <h1>{text("otp.title")}</h1>
          <p>
            {text("otp.subtitle")} <strong>{phone || "+995 5** *** 21"}</strong>
          </p>
          {showDevOtpCode && devOtpCode ? <p className="otp-help">Test OTP: {devOtpCode}</p> : null}
        </div>

        <div className="otp-cluster" aria-label="OTP code">
          {digits.map((digit, index) => (
            <input
              key={`otp-slot-${index}`}
              inputMode="numeric"
              maxLength={1}
              value={digit.trim()}
              onChange={(event) => {
                const next = [...digits];
                next[index] = event.target.value.replace(/\D/g, "").slice(0, 1) || " ";
                setOtpValue(next.join("").replace(/\s/g, "").slice(0, otpLength));
              }}
            />
          ))}
        </div>

        <div className="otp-timer">
          <span>
            <Timer size={18} />
            01:59
          </span>
          <button type="button" disabled>
            {text("otp.resend")}
          </button>
        </div>

        <button className="primary-action" type="button" disabled={disabled || otpValue.length < otpLength} onClick={onVerifyOtp}>
          {text("otp.confirm")}
        </button>
        <p className="otp-help">{text("otp.help")}</p>
      </main>
    </section>
  );
}

function ProfileSetupPage({
  disabled,
  profileName,
  setProfileName,
  text,
  onFinish
}: {
  disabled: boolean;
  profileName: string;
  setProfileName: (value: string) => void;
  text: TextGetter;
  onFinish: () => Promise<void>;
}) {
  const [showSuccess, setShowSuccess] = useState(false);

  const finishSetup = () => {
    setShowSuccess(true);
    window.setTimeout(() => {
      onFinish().finally(() => setShowSuccess(false));
    }, 900);
  };

  return (
    <section className="profile-setup-page">
      <header className="setup-header">
        <strong>PlayPoint</strong>
        <span>{text("setup.header")}</span>
      </header>

      <main className="setup-main">
        <section className="setup-welcome">
          <h1>{text("setup.title")}</h1>
          <p>{text("setup.subtitle")}</p>
        </section>

        <section className="setup-card">
          <div className="setup-orb orb-a" />
          <div className="setup-orb orb-b" />
          <div className="avatar-upload">
            <User size={52} />
            <button type="button" aria-label="Upload avatar">
              <Camera size={20} />
            </button>
          </div>
          <button className="skip-photo" type="button">
            {text("setup.skipPhoto")}
          </button>

          <label className="field-label" htmlFor="displayName">
            {text("setup.name")}
          </label>
          <div className="edit-field">
            <input
              id="displayName"
              className="text-input"
              placeholder={text("setup.namePlaceholder")}
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
            />
            <Pencil size={18} />
          </div>

          <div className="bonus-strip">
            <Sparkles size={18} />
            {text("setup.bonusPrefix")} {pointRules.registrationBonus} {text("setup.bonusSuffix")}
          </div>
        </section>

        <div className="setup-actions">
          <button className="primary-action" type="button" disabled={disabled || !profileName.trim()} onClick={finishSetup}>
            {text("setup.finish")}
            <ArrowLeft className="arrow-forward" size={18} />
          </button>
          <p>{text("setup.note")}</p>
        </div>
      </main>

      {showSuccess ? (
        <div className="success-overlay" role="status">
          <div className="success-modal">
            <CheckCircle2 size={58} />
            <h2>{text("setup.successTitle")}</h2>
            <p>{text("setup.successText")}</p>
            <div className="success-progress"><span /></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HomePage({
  leaderboardEntries,
  attemptsLeftByGame,
  rewardCatalog,
  text,
  userCoins,
  onBuyCoins,
  onNavigate,
  onSelectGame
}: {
  leaderboardEntries: RankedLeaderboardEntry[];
  attemptsLeftByGame: AttemptsLeftByGame;
  rewardCatalog: Reward[];
  text: TextGetter;
  userCoins: number;
  onBuyCoins: (coins: number) => void;
  onNavigate: (route: Route) => void;
  onSelectGame: (gameId: GameId) => void;
}) {
  const [coinModalOpen, setCoinModalOpen] = useState(false);
  const gameIcons: Record<GameId, typeof Gamepad2> = {
    "color-rush": Sparkles,
    memory: Brain,
    "aim-hit": Target
  };

  return (
    <>
      <section className="hero-banner">
        <div>
          <span>{text("home.sponsored")}</span>
          <h2>{text("home.dailyChallenge")}</h2>
          <p>{text("home.dailyChallengeText")}</p>
        </div>
        <button type="button" onClick={() => onSelectGame("aim-hit")}>
          <Play size={18} />
          {text("common.play")}
        </button>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>{text("home.games")}</h2>
          <span>{pointRules.dailyAttemptsPerGame} {text("home.attemptsPerDay")}</span>
        </div>
        <div className="game-grid">
          {games.map((game) => {
            const Icon = gameIcons[game.id];
            const attemptsLeft = attemptsLeftByGame[game.id] ?? pointRules.dailyAttemptsPerGame;
            return (
            <article className="game-card" key={game.id}>
              <span className="game-attempt-badge">{attemptsLeft} ცდა</span>
              <div className="game-icon">
                <Icon size={24} />
              </div>
              <h3>{game.name}</h3>
              <p>{game.pointRateLabel}</p>
              <button type="button" disabled={attemptsLeft <= 0} onClick={() => onSelectGame(game.id)}>
                {text("common.play")}
              </button>
            </article>
            );
          })}
        </div>
      </section>

      <section className="section split">
        <article className="panel panel-clickable" onClick={() => onNavigate("leaderboard-daily")}>
          <div className="panel-title">
            <Trophy size={20} />
            <h2>{text("home.dailyRanks")}</h2>
          </div>
          <LeaderboardList entries={leaderboardEntries} limit={3} />
        </article>

        <article className="panel panel-clickable" onClick={() => onNavigate("rewards")}>
          <div className="panel-title">
            <Gift size={20} />
            <h2>{text("home.rewards")}</h2>
          </div>
          <RewardList rewards={rewardCatalog} limit={2} />
        </article>
      </section>

      <section className="section coin-shop-card">
        <div>
          <span className="coin-shop-kicker">{text("home.wallet")}</span>
          <h2>{text("home.buyCoins")}</h2>
          <p>{text("home.buyCoinsText")}</p>
        </div>
        <button type="button" onClick={() => setCoinModalOpen(true)}>
          <Coins size={18} />
          <strong>{formatter.format(userCoins)}</strong>
          <span>{text("common.buy")}</span>
        </button>
      </section>

      {coinModalOpen ? (
        <div className="coin-modal-backdrop" role="presentation">
          <section className="coin-modal" role="dialog" aria-modal="true" aria-labelledby="coin-modal-title">
            <header>
              <div>
                <span>{text("home.coinStore")}</span>
                <h2 id="coin-modal-title">{text("home.coinModalTitle")}</h2>
              </div>
              <button type="button" onClick={() => setCoinModalOpen(false)} aria-label="Close coin store">
                <X size={20} />
              </button>
            </header>
            <div className="coin-package-grid">
              {coinPackages.map((pack) => (
                <button
                  className="coin-package"
                  key={pack.id}
                  type="button"
                  onClick={() => {
                    onBuyCoins(pack.coins);
                    setCoinModalOpen(false);
                  }}
                >
                  <span>{pack.label}</span>
                  <strong>
                    <Coins size={18} />
                    {formatter.format(pack.coins)}
                  </strong>
                  <em>{pack.price}</em>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <section className="section info-strip">
        <ShieldCheck size={20} />
        <p>{text("home.info")}</p>
      </section>
    </>
  );
}

function GameLoadingPage({
  text,
  selectedGameId,
  onNavigate
}: {
  text: TextGetter;
  selectedGameId: GameId;
  onNavigate: (route: Route) => void;
}) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);
    const startedAt = Date.now();
    const durationMs = 1800;

    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const nextProgress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setProgress(nextProgress);

      if (nextProgress >= 100) {
        window.clearInterval(progressTimer);
        window.setTimeout(() => onNavigate("game-frame"), 160);
      }
    }, 40);

    return () => window.clearInterval(progressTimer);
  }, [onNavigate, selectedGameId]);

  const selectedGame = games.find((game) => game.id === selectedGameId) || games[2];

  return (
    <section className="loading-screen">
      <div className="game-loader-orb">
        <Loader2 className="spin" size={44} />
        <span>{progress}%</span>
      </div>
      <h1>{text("loading.title")}</h1>
      <h2>{selectedGame.name}</h2>
      <p>{text("loading.sponsor")}</p>
      <div className="progress-track">
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="loading-steps">
        <span className={progress >= 25 ? "active" : ""}>{text("loading.assets")}</span>
        <span className={progress >= 55 ? "active" : ""}>{text("loading.rules")}</span>
        <span className={progress >= 85 ? "active" : ""}>{text("loading.ready")}</span>
      </div>
      <div className="tip-card">
        {text("loading.tip")}
      </div>
    </section>
  );
}

function GameFramePage({
  language,
  text,
  selectedGameId,
  onNavigate,
  onFinish
}: {
  language: Language;
  text: TextGetter;
  selectedGameId: GameId;
  onNavigate: (route: Route) => void;
  onFinish: (result: GameResult) => void | Promise<void>;
}) {
  const selectedGame = games.find((game) => game.id === selectedGameId) || games[2];

  return (
    <section className="game-frame">
      <div className="game-hud">
        <button className="icon-action" type="button" onClick={() => onNavigate("home")}>
          <ArrowLeft size={20} />
        </button>
        <strong>{selectedGame.name}</strong>
        <span>{selectedGameId === "aim-hit" || selectedGameId === "memory" || selectedGameId === "color-rush" ? "10s" : "Soon"}</span>
      </div>
      {selectedGameId === "aim-hit" ? (
        <AimHitGame language={language} onFinish={onFinish} />
      ) : selectedGameId === "memory" ? (
        <MemoryGame language={language} onFinish={onFinish} />
      ) : selectedGameId === "color-rush" ? (
        <ColorRushGame language={language} onFinish={onFinish} />
      ) : (
        <>
          <div className="play-area">
            <Target size={72} />
            <p>{selectedGame.name} {text("game.soon")}</p>
          </div>
          <button className="primary-action" type="button" onClick={() => onNavigate("home")}>
            {text("game.back")}
          </button>
        </>
      )}
    </section>
  );
}

function ScorePopupPage({
  result,
  text,
  userPoints,
  userRank,
  onNavigate,
  onPlayAgain
}: {
  result: GameResult;
  text: TextGetter;
  userPoints: number;
  userRank: number;
  onNavigate: (route: Route) => void;
  onPlayAgain: (gameId: GameId) => void | Promise<void>;
}) {
  const selectedGame = games.find((game) => game.id === result.gameId) || games[2];

  return (
    <section className="score-modal">
      <Trophy size={64} />
      <h1>{text("score.title")}</h1>
      <p className="score-game-name">{selectedGame.name}</p>
      <div className="score-grid">
        <div>
          <span>{text("score.finalScore")}</span>
          <strong>{formatter.format(result.score)}</strong>
        </div>
        <div>
          <span>{text("score.pointsEarned")}</span>
          <strong>+{result.playPoints}</strong>
        </div>
      </div>
      <div className="score-breakdown">
        <span>{text("score.hits")}: {result.hits ?? 0}</span>
        <span>{text("score.misses")}: {result.misses ?? 0}</span>
        <span>{text("score.accuracy")}: {result.accuracy ?? 0}%</span>
        <span>{text("score.maxCombo")}: x{result.maxCombo ?? 0}</span>
      </div>
      <div className="rank-update">{text("score.globalRank")} #{userRank}</div>
      <div className="score-total-points">
        <AnimatedPoints value={userPoints} suffix=" pts" /> {text("score.totalBalance")}
      </div>
      <button className="primary-action" type="button" onClick={() => onPlayAgain(result.gameId)}>
        <RotateCcw size={18} />
        {text("score.playAgain")}
      </button>
      <div className="two-actions">
        <button type="button" onClick={() => onNavigate("leaderboard-daily")}>
          {text("nav.ranks")}
        </button>
        <button type="button" onClick={() => onNavigate("home")}>
          {text("nav.home")}
        </button>
      </div>
    </section>
  );
}

function LeaderboardPage({
  scope,
  leaderboardEntries,
  text,
  userRank,
  onNavigate
}: {
  scope: "daily" | "weekly";
  leaderboardEntries: RankedLeaderboardEntry[];
  text: TextGetter;
  userRank: number;
  onNavigate: (route: Route) => void;
}) {
  const [showAllRanks, setShowAllRanks] = useState(false);
  const podiumEntries = leaderboardEntries.slice(0, 3);
  const listEntries = leaderboardEntries.slice(3);
  const visibleEntries = listEntries.length > 0 ? listEntries : leaderboardEntries;
  const collapsedListLimit = listEntries.length > 0 ? 7 : 10;
  const visibleLimit = showAllRanks ? visibleEntries.length : collapsedListLimit;
  const podiumOrder = [podiumEntries[1], podiumEntries[0], podiumEntries[2]].filter(Boolean);

  return (
    <section className="section leaderboard-screen">
      <div className="tabs">
        <button
          className={scope === "daily" ? "active" : ""}
          type="button"
          onClick={() => onNavigate("leaderboard-daily")}
        >
          {text("leaderboard.daily")}
        </button>
        <button
          className={scope === "weekly" ? "active" : ""}
          type="button"
          onClick={() => onNavigate("leaderboard-weekly")}
        >
          {text("leaderboard.weekly")}
        </button>
      </div>
      <section className="leaderboard-podium" aria-label="Top players">
        {podiumOrder.map((player) => (
          <article className={`podium-player rank-${player.rank}`} key={`${player.rank}-${player.name}`}>
            <div className="podium-avatar">
              <User size={player.rank === 1 ? 34 : 26} />
              <strong>{player.rank}</strong>
            </div>
            <h3>{player.name}</h3>
            <p>{formatter.format(player.points)}</p>
          </article>
        ))}
      </section>
      <article className="leaderboard-card">
        <div className="leaderboard-card-title">
          <div>
            <Trophy size={20} />
            <h2>{scope === "daily" ? text("leaderboard.dailyTitle") : text("leaderboard.weeklyTitle")}</h2>
          </div>
          <span>#{userRank}</span>
        </div>
        <LeaderboardList entries={visibleEntries} limit={visibleLimit} />
        {visibleEntries.length > collapsedListLimit ? (
          <button className="leaderboard-more-button" type="button" onClick={() => setShowAllRanks((value) => !value)}>
            {showAllRanks ? text("leaderboard.less") : `${text("leaderboard.more")} (${visibleEntries.length - collapsedListLimit})`}
          </button>
        ) : null}
      </article>
      <div className="sponsor-card">
        <span>{text("leaderboard.presentedBy")}</span>
        <strong>{scope === "daily" ? "Coffee Lab" : "TechStore"}</strong>
        <p>
          {scope === "weekly" ? text("leaderboard.weeklyPrize") : text("leaderboard.dailyPrize")}
          {" "}{text("leaderboard.currentRank")} #{userRank}.
        </p>
      </div>
    </section>
  );
}

function RewardsPage({
  purchasedRewards,
  rewards,
  text,
  userPoints,
  onClaimReward
}: {
  purchasedRewards: Reward[];
  rewards: Reward[];
  text: TextGetter;
  userPoints: number;
  onClaimReward: (reward: Reward) => Promise<boolean>;
}) {
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null);
  const [claimingRewardId, setClaimingRewardId] = useState<string | null>(null);
  const alreadyPurchased = selectedReward
    ? purchasedRewards.some((reward) => reward.id === selectedReward.id)
    : false;
  const selectedOutOfStock = selectedReward?.remainingQuantity === 0;
  const canClaimSelected = selectedReward ? userPoints >= selectedReward.points && !alreadyPurchased && !selectedOutOfStock : false;

  return (
    <section className="section">
      <div className="section-heading">
        <h2>{text("rewards.title")}</h2>
        <span><AnimatedPoints value={userPoints} suffix=" pts" /></span>
      </div>
      <div className="tabs">
        <button className="active" type="button">{text("common.all")}</button>
        <button type="button">{text("common.food")}</button>
        <button type="button">{text("common.tech")}</button>
        <button type="button">{text("common.gaming")}</button>
      </div>
      <div className="rewards-grid">
        {rewards.map((reward) => (
          <article className={`reward-card reward-${reward.id}`} key={reward.id}>
            <div className="reward-visual">
              {reward.image ? <img src={reward.image} alt="" /> : <Gift size={34} />}
              {typeof reward.remainingQuantity === "number" ? (
                <span className="reward-stock-badge">{reward.remainingQuantity} left</span>
              ) : null}
            </div>
            <h3>{reward.title}</h3>
            <p>{reward.brand}</p>
            <strong>{reward.points} pts</strong>
            <button
              type="button"
              disabled={
                purchasedRewards.some((purchasedReward) => purchasedReward.id === reward.id) ||
                reward.remainingQuantity === 0
              }
              onClick={() => setSelectedReward(reward)}
            >
              {purchasedRewards.some((purchasedReward) => purchasedReward.id === reward.id)
                ? text("common.owned")
                : reward.remainingQuantity === 0
                  ? "Sold out"
                  : text("common.claim")}
            </button>
          </article>
        ))}
      </div>
      {selectedReward ? (
        <div className="claim-modal-backdrop" role="presentation">
          <section className="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-modal-title">
            <button className="claim-close" type="button" onClick={() => setSelectedReward(null)} aria-label="Close">
              <X size={20} />
            </button>
            <div className={`claim-preview reward-${selectedReward.id}`}>
              {selectedReward.image ? <img src={selectedReward.image} alt="" /> : <Gift size={42} />}
            </div>
            <h2 id="claim-modal-title">{text("rewards.confirmTitle")}</h2>
            <p>
              {selectedReward.title} {text("rewards.confirmCost")} <strong>{formatter.format(selectedReward.points)} pts</strong>.
            </p>
            {alreadyPurchased ? <span className="claim-warning">{text("rewards.alreadyPurchased")}</span> : null}
            {!alreadyPurchased && userPoints < selectedReward.points ? (
              <span className="claim-warning">{text("rewards.notEnough")}</span>
            ) : null}
            {selectedOutOfStock ? <span className="claim-warning">This reward is out of stock</span> : null}
            <div className="claim-actions">
              <button type="button" onClick={() => setSelectedReward(null)}>
                {text("common.no")}
              </button>
              <button
                type="button"
                disabled={!canClaimSelected || claimingRewardId === selectedReward.id}
                onClick={async () => {
                  setClaimingRewardId(selectedReward.id);
                  if (await onClaimReward(selectedReward)) {
                    setSelectedReward(null);
                  }
                  setClaimingRewardId(null);
                }}
              >
                {text("common.yes")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ProfilePage({
  darkMode,
  language,
  profileName,
  purchasedRewards,
  setDarkMode,
  setLanguage,
  text,
  userCoins,
  userPoints,
  userRank,
  gamesPlayed,
  lastGameResult,
  onNavigate,
  onLogout
}: {
  darkMode: boolean;
  language: Language;
  profileName: string;
  purchasedRewards: Reward[];
  setDarkMode: (value: boolean) => void;
  setLanguage: (value: Language) => void;
  text: TextGetter;
  userCoins: number;
  userPoints: number;
  userRank: number;
  gamesPlayed: number;
  lastGameResult: GameResult;
  onNavigate: (route: Route) => void;
  onLogout: () => void;
}) {
  return (
    <section className="profile-screen">
      <section className="profile-hero">
        <button className="profile-avatar-wrap" type="button" onClick={() => onNavigate("edit-profile")}>
          <div className="profile-avatar-gradient">
            <div className="profile-avatar">
              <User size={44} />
            </div>
          </div>
          <span className="profile-edit-badge">
            <Pencil size={16} />
          </span>
        </button>
        <h2>{profileName || text("profile.fallbackName")}</h2>
        <p>{text("profile.player")} #88219</p>
      </section>

      <section className="profile-preferences" aria-label="Profile preferences">
        <div className="profile-language-card">
          <span className="preference-icon">{darkMode ? <Moon size={20} /> : <Sun size={20} />}</span>
          <div>
            <strong>{text("profile.darkMode")}</strong>
            <div className="language-segment" role="group" aria-label="Dark mode">
              <button className={!darkMode ? "active" : ""} type="button" onClick={() => setDarkMode(false)}>
                OFF
              </button>
              <button className={darkMode ? "active" : ""} type="button" onClick={() => setDarkMode(true)}>
                ON
              </button>
            </div>
          </div>
        </div>
        <div className="profile-language-card">
          <span className="preference-icon"><Languages size={20} /></span>
          <div>
            <strong>{text("profile.language")}</strong>
            <div className="language-segment" role="group" aria-label="Language">
              <button className={language === "ka" ? "active" : ""} type="button" onClick={() => setLanguage("ka")}>
                KA
              </button>
              <button className={language === "en" ? "active" : ""} type="button" onClick={() => setLanguage("en")}>
                EN
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="profile-stats-bento">
        <article className="balance-card">
          <div>
            <p>{text("profile.balance")}</p>
            <div className="balance-total-row">
              <h3><AnimatedPoints value={userPoints} /></h3>
              <span>
                <TrendingUp size={16} />
                +{lastGameResult.playPoints} {text("profile.lastGame")}
              </span>
            </div>
            <div className="balance-coin-row">
              <Coins size={18} />
              <strong>{formatter.format(userCoins)}</strong>
              <small>{text("profile.coin")}</small>
            </div>
          </div>
          <div className="balance-icon">
            <CircleDollarSign size={48} />
          </div>
          <div className="balance-orb" />
        </article>
        <article className="mini-stat-card">
          <Medal size={26} />
          <p>{text("profile.rating")}</p>
          <h4>#{userRank}</h4>
        </article>
        <article className="mini-stat-card">
          <Gamepad2 size={26} />
          <p>{text("profile.games")}</p>
          <h4>{formatter.format(gamesPlayed)}</h4>
        </article>
      </section>

      <section className="profile-section-block">
        <div className="profile-section-title">
          <h3>{text("profile.myPrizes")}</h3>
          <button type="button" onClick={() => onNavigate("rewards")}>{text("common.all")}</button>
        </div>
        <div className="profile-list">
          {purchasedRewards.length > 0 ? (
            purchasedRewards.map((reward) => (
              <ProfileRewardItem
                active
                icon={reward.image ? <img src={reward.image} alt="" /> : <Gift size={22} />}
                key={reward.id}
                rewardId={reward.id}
                title={reward.title}
                meta={`${reward.brand} • ${formatter.format(reward.points)} pts`}
                status={text("common.active")}
              />
            ))
          ) : (
            <div className="profile-empty-state">
              <Gift size={22} />
              <span>{text("profile.emptyPrizes")}</span>
            </div>
          )}
        </div>
      </section>

      <section className="profile-section-block">
        <h3>{text("profile.gameHistory")}</h3>
        <div className="history-card">
          <HistoryItem icon={<BadgeCheck size={20} />} title="Daily Trivia" time={text("profile.today")} points="+50 pts" result={text("profile.won")} tone="positive" />
          <HistoryItem icon={<Gamepad2 size={20} />} title="Speed Clicker" time={text("profile.yesterday")} points="+120 pts" result={text("profile.newRecord")} tone="positive" />
          <HistoryItem icon={<Brain size={20} />} title="Memory Match" time="15 May, 12:00" points="-10 pts" result={text("profile.entryFee")} tone="negative" />
        </div>
        <button className="more-button" type="button">{text("leaderboard.more")}</button>
      </section>

      <section className="profile-logout-section">
        <button type="button" onClick={onLogout}>
          <LogOut size={20} />
          {text("profile.logout")}
        </button>
      </section>
    </section>
  );
}

function EditProfilePage({
  profileName,
  text,
  userPoints,
  setProfileName,
  onSaveProfile,
  onNavigate
}: {
  profileName: string;
  text: TextGetter;
  userPoints: number;
  setProfileName: (value: string) => void;
  onSaveProfile: (name: string) => Promise<void>;
  onNavigate: (route: Route) => void;
}) {
  const [email, setEmail] = useState("giorgi.m@example.ge");
  const [saved, setSaved] = useState(false);

  const saveProfile = async () => {
    await onSaveProfile(profileName);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <section className="edit-profile-screen">
      <header className="edit-profile-header">
        <div>
          <button type="button" onClick={() => onNavigate("profile")} aria-label="Go back">
            <ArrowLeft size={20} />
          </button>
          <h1>{text("edit.title")}</h1>
        </div>
        <span><AnimatedPoints value={userPoints} suffix=" pts" /></span>
      </header>

      <main className="edit-profile-main">
        <section className="edit-avatar-section">
          <div className="edit-avatar">
            <User size={58} />
            <button aria-label="Edit Profile Picture" type="button">
              <Pencil size={18} />
            </button>
          </div>
          <p>{text("edit.photo")}</p>
        </section>

        <form className="edit-form" onSubmit={(event) => event.preventDefault()}>
          <EditField
            icon={<User size={20} />}
            id="name"
            label={text("edit.name")}
            value={profileName}
            onChange={setProfileName}
            placeholder={text("edit.namePlaceholder")}
          />
          <EditField
            disabled
            icon={<Phone size={20} />}
            id="phone"
            label={text("edit.phone")}
            value="+995 555 12 34 56"
            onChange={() => undefined}
            trailing={<Lock size={16} />}
            hint={text("edit.phoneHint")}
          />
          <EditField
            icon={<Mail size={20} />}
            id="email"
            label={text("edit.email")}
            value={email}
            onChange={setEmail}
            placeholder="email@example.com"
            type="email"
          />
        </form>

        <div className="security-card">
          <div>
            <ShieldCheck size={22} />
          </div>
          <section>
            <h4>{text("edit.securityTitle")}</h4>
            <p>{text("edit.securityText")}</p>
          </section>
        </div>
      </main>

      <footer className="edit-save-footer">
        <button type="button" className={saved ? "saved" : ""} onClick={saveProfile}>
          <span>{saved ? text("edit.saved") : text("edit.save")}</span>
          <CheckCircle2 size={18} />
        </button>
      </footer>
    </section>
  );
}

function ProfileRewardItem({
  icon,
  title,
  meta,
  status,
  rewardId,
  active = false
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  status: string;
  rewardId?: string;
  active?: boolean;
}) {
  return (
    <article className="profile-list-item">
      <div className={`${active ? "item-icon active" : "item-icon"}${rewardId ? ` reward-${rewardId}` : ""}`}>
        {icon}
      </div>
      <div>
        <h4>{title}</h4>
        <p>{meta}</p>
      </div>
      <span className={active ? "status-pill active" : "status-pill"}>{status}</span>
    </article>
  );
}

function HistoryItem({
  icon,
  title,
  time,
  points,
  result,
  tone
}: {
  icon: ReactNode;
  title: string;
  time: string;
  points: string;
  result: string;
  tone: "positive" | "negative";
}) {
  return (
    <article className="history-item">
      <div className="history-icon">{icon}</div>
      <div>
        <h4>{title}</h4>
        <p>{time}</p>
      </div>
      <div className="history-score">
        <strong className={tone}>{points}</strong>
        <span>{result}</span>
      </div>
    </article>
  );
}

function EditField({
  icon,
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  trailing,
  hint
}: {
  icon: ReactNode;
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  trailing?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="edit-field-block">
      <label htmlFor={id}>{label}</label>
      <div className={disabled ? "edit-input-wrap disabled" : "edit-input-wrap"}>
        {icon}
        <input
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          readOnly={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {trailing}
      </div>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

function LeaderboardList({
  entries,
  limit = entries.length
}: {
  entries: RankedLeaderboardEntry[];
  limit?: number;
}) {
  return (
    <div className="leaderboard-list">
      {entries.slice(0, limit).map((player) => (
        <div className={player.isCurrentUser ? "rank-row current-user" : "rank-row"} key={`${player.rank}-${player.name}`}>
          <strong>{player.rank}</strong>
          <span>{player.name}</span>
          <em>{formatter.format(player.points)}</em>
        </div>
      ))}
    </div>
  );
}

function RewardList({ rewards, limit = rewards.length }: { rewards: Reward[]; limit?: number }) {
  return (
    <div className="reward-list">
      {rewards.slice(0, limit).map((reward) => (
        <div className="reward-row" key={reward.id}>
          <span>{reward.brand}</span>
          <strong>{reward.points} pts</strong>
        </div>
      ))}
    </div>
  );
}
