import { createHash } from "node:crypto";
import { BinanceMarketHistoryService, type BinanceCandle } from "../binance/binanceMarketHistoryService.js";
import type { ExecutedLevelRecord, MarketState, StrategyRecord } from "../types/strategy.js";

export type AnalystRisk = "UNKNOWN" | "NORMAL" | "CAUTION" | "HIGH";
export interface MarketAssessment {
  symbol: string; trend: "UP" | "DOWN" | "RANGE" | "UNKNOWN";
  change24h: number | null; range24h: number | null; volumeChange: number | null;
  asOf: string | null; fetchedAt: string; source: string;
}
export interface AnalystAssessment {
  strategyId: number; symbol: string; environment: StrategyRecord["executionEnvironment"];
  source: "RULES"; generatedAt: string; inputHash: string;
  risk: AnalystRisk; headline: string; summary: string;
  facts: Array<{ code: string; text: string; severity: "INFO" | "CAUTION" | "HIGH" }>;
  metrics: { freeQuote: number | null; pnl: number | null; pnlPercent: number | null; capitalUsedPercent: number | null; price: number | null; priceAt: string | null };
  market: MarketAssessment;
  suggestion: { title: string; reason: string; tradeoff: string };
}
export interface AnalystReview {
  id: number; decision: "NEW" | "ACKNOWLEDGED" | "DISMISSED";
  assessment: AnalystAssessment;
}

export function assessMarket(symbol: string, candles: BinanceCandle[], source: string, now = Date.now()): MarketAssessment {
  const empty: MarketAssessment = { symbol, trend: "UNKNOWN", change24h: null, range24h: null, volumeChange: null, asOf: null, fetchedAt: new Date(now).toISOString(), source };
  const closed = candles.filter((item) => item.time * 1000 + 3_600_000 <= now).sort((a, b) => a.time - b.time);
  const recent = closed.slice(-25);
  if (recent.length < 25 || recent.some((item, index) => ![item.open, item.high, item.low, item.close].every((value) => Number.isFinite(value) && value > 0) ||
    item.high < Math.max(item.open, item.close, item.low) || item.low > Math.min(item.open, item.close, item.high) || (index > 0 && item.time - recent[index - 1]!.time !== 3600))) return empty;
  const last = recent.at(-1)!;
  const asOfMs = last.time * 1000 + 3_600_000;
  if (now - asOfMs > 90 * 60_000) return empty;
  const day = recent.slice(-24);
  const change24h = (last.close / recent[0]!.close - 1) * 100;
  const average = day.slice(-20).reduce((sum, candle) => sum + candle.close, 0) / 20;
  const low = Math.min(...day.map((candle) => candle.low));
  const high = Math.max(...day.map((candle) => candle.high));
  const volumeWindow = closed.slice(-48);
  const volumeValid = volumeWindow.length === 48 && volumeWindow.every((item, index) => Number.isFinite(item.quoteVolume) && item.quoteVolume! >= 0 && (index === 0 || item.time - volumeWindow[index - 1]!.time === 3600));
  const oldVolume = volumeValid ? volumeWindow.slice(0, 24).reduce((sum, item) => sum + item.quoteVolume!, 0) : 0;
  const newVolume = volumeValid ? volumeWindow.slice(24).reduce((sum, item) => sum + item.quoteVolume!, 0) : 0;
  return { ...empty, asOf: new Date(asOfMs).toISOString(), change24h, range24h: (high / low - 1) * 100,
    volumeChange: oldVolume > 0 ? (newVolume / oldVolume - 1) * 100 : null,
    trend: change24h > 1 && last.close > average * 1.005 ? "UP" : change24h < -1 && last.close < average * 0.995 ? "DOWN" : "RANGE" };
}

export class AnalystMarketService {
  private cache = new Map<string, { expiresAt: number; value: MarketAssessment }>();
  private pending = new Map<string, Promise<MarketAssessment>>();
  constructor(private readonly historyFor: (testnet: boolean) => Pick<BinanceMarketHistoryService, "getCandles"> = (testnet) =>
    new BinanceMarketHistoryService(testnet ? "https://testnet.binance.vision" : "https://data-api.binance.vision")) {}
  async get(symbol: string, environment: StrategyRecord["executionEnvironment"]): Promise<MarketAssessment> {
    const testnet = environment === "TESTNET";
    const key = `${testnet}:${symbol}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const source = testnet ? "Binance Testnet · 1h" : "Binance Spot · 1h";
    const request = (async () => {
      let value: MarketAssessment;
      try {
        const history = this.historyFor(testnet);
        value = assessMarket(symbol, await history.getCandles(symbol, "1h", 52), source);
      } catch { value = assessMarket(symbol, [], source); }
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { value, expiresAt: Date.now() + (value.trend === "UNKNOWN" ? 60_000 : 300_000) });
      return value;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}

export function assessStrategy(strategy: StrategyRecord, levels: ExecutedLevelRecord[], price: MarketState | null, market: MarketAssessment, pendingProfit = false, now = Date.now()): AnalystAssessment {
  const facts: AnalystAssessment["facts"] = [];
  const add = (code: string, text: string, severity: "INFO" | "CAUTION" | "HIGH") => facts.push({ code, text, severity });
  const priceAge = price ? now - Date.parse(price.eventTime) : NaN;
  const priceFresh = Boolean(price && Number.isFinite(price.price) && price.price > 0 && priceAge >= -5_000 && priceAge <= 30_000);
  const values = [strategy.totalBudget, strategy.totalSaleProceeds, strategy.totalInvested, strategy.withdrawnProfit, strategy.realizedProfit, strategy.remainingCostBasis, strategy.totalAssetQuantity];
  const validLedger = values.every(Number.isFinite) && strategy.totalBudget > 0 &&
    [strategy.totalInvested, strategy.totalSaleProceeds, strategy.withdrawnProfit, strategy.remainingCostBasis, strategy.totalAssetQuantity].every((value) => value >= 0);
  const freeQuote = validLedger ? strategy.totalBudget + strategy.totalSaleProceeds - strategy.totalInvested - strategy.withdrawnProfit : null;
  const capital = validLedger ? strategy.totalBudget + Math.max(0, strategy.realizedProfit - strategy.withdrawnProfit) : 0;
  const pnl = priceFresh && validLedger ? strategy.totalAssetQuantity * price!.price + strategy.totalSaleProceeds - strategy.totalInvested : null;
  const pnlPercent = pnl === null ? null : pnl / strategy.totalBudget * 100;
  const capitalUsedPercent = validLedger && capital > 0 ? Math.max(0, capital - freeQuote!) / capital * 100 : null;
  const uncertain = pendingProfit || levels.some((level) => level.status === "EXECUTING" || (level.status === "FAILED" && level.errorMessage?.startsWith("[NO_AUTO_RETRY]")));
  if (!priceFresh) add("PRICE_STALE", "მიმდინარე ფასი აკლია ან 30 წამზე ძველია", "HIGH");
  if (!validLedger) add("LEDGER_INVALID", "ბიუჯეტის ან პოზიციის მონაცემები არასრულია", "HIGH");
  if (uncertain) add("ORDER_UNCERTAIN", "ორდერის შესრულება ჯერ დასადასტურებელია", "HIGH");
  if (levels.some((level) => level.status === "FAILED")) add("ORDER_FAILED", "სტრატეგიას შეცდომით დასრულებული დონე აქვს", "HIGH");
  if (freeQuote !== null && freeQuote < -0.01) add("NEGATIVE_CASH", "სტრატეგიის თავისუფალი USDT უარყოფითია", "HIGH");
  else if (freeQuote !== null && freeQuote < capital * 0.1) add("LOW_CASH", "სამუშაო კაპიტალის 10%-ზე ნაკლებია თავისუფალი", "CAUTION");
  if (pnlPercent !== null && pnlPercent < -10) add("POSITION_LOSS", "საერთო შედეგი საწყისი ბიუჯეტის -10%-ზე დაბალია", "HIGH");
  if (market.trend === "UNKNOWN") add("HISTORY_MISSING", "საათობრივი ბაზრის ისტორია არასრულია", "CAUTION");
  else {
    add("TREND", market.trend === "UP" ? "24-საათიანი ცვლილება და 20-საათიანი საშუალო აღმავალ მოძრაობას აჩვენებს" : market.trend === "DOWN" ? "24-საათიანი ცვლილება და 20-საათიანი საშუალო დაღმავალ მოძრაობას აჩვენებს" : "აღმავალი ან დაღმავალი ტენდენციის ორივე პირობა არ სრულდება", market.trend === "DOWN" ? "CAUTION" : "INFO");
    if (market.range24h !== null && market.range24h > 10) add("WIDE_RANGE", "24-საათიანი ფასის დიაპაზონი 10%-ს აღემატება", "CAUTION");
    if (market.volumeChange !== null && market.volumeChange < -25) add("VOLUME_WEAK", "დღიური ბრუნვა წინა 24 საათთან შედარებით 25%-ზე მეტით შემცირდა", "CAUTION");
  }
  if (strategy.status === "PAUSED") add("PAUSED", "ბოტი შეჩერებულია; ეს შეფასება ვაჭრობას არ ააქტიურებს", "INFO");
  const risk: AnalystRisk = !priceFresh || !validLedger ? "UNKNOWN" : facts.some((item) => item.severity === "HIGH") ? "HIGH" : facts.some((item) => item.severity === "CAUTION") ? "CAUTION" : "NORMAL";
  const blocked = !priceFresh || !validLedger || uncertain || levels.some((level) => level.status === "FAILED");
  const headline = blocked ? "ჯერ მონაცემები და ორდერები გადაამოწმე" : risk === "HIGH" ? "პოზიციას ყურადღება სჭირდება" : risk === "CAUTION" ? "ახალი შესვლის პირობები გადახედე" : "გამოკვეთილი გაფრთხილება არ ჩანს";
  const suggestion = blocked
    ? { title: "შეამოწმე მიმდინარე მდგომარეობა", reason: "არასრული მონაცემით ან გაურკვეველი ორდერით შესვლის შეფასება შეზღუდულია.", tradeoff: "გადამოწმებისას ბაზრის მოძრაობის ნაწილი შეიძლება გამოტოვო." }
    : risk === "HIGH" || risk === "CAUTION"
      ? { title: "განიხილე ახალი BUY-ის პირობები", reason: "შეფასების მიზეზები აჩვენებს კაპიტალის ან ბაზრის რისკს; პარამეტრები ავტომატურად არ იცვლება.", tradeoff: "უფრო ფრთხილმა შესვლამ შეიძლება სწრაფი აღდგენის ნაწილი გამოტოვოს." }
      : { title: "განაგრძე დაკვირვება", reason: "შემოწმებულ პირობებში დამატებითი გაფრთხილება არ გამოვლენილა.", tradeoff: "ეს შეფასება ფასის ზრდას ან მოგებას არ ადასტურებს." };
  const summary = facts.filter((item) => item.severity !== "INFO").slice(0, 2).map((item) => item.text).join(". ") || "ფასი ახალია, ორდერების გაურკვევლობა არ ჩანს. სტრატეგია შენს წესებზეა დამოკიდებული.";
  const fingerprint = { strategy, levels: levels.map(({ side, levelPercent, status }) => ({ side, levelPercent, status })), price: priceFresh ? price?.price : null, market };
  return { strategyId: strategy.id, symbol: strategy.symbol, environment: strategy.executionEnvironment, source: "RULES", generatedAt: new Date(now).toISOString(),
    inputHash: createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex"), risk, headline, summary, facts, suggestion, market,
    metrics: { freeQuote, pnl, pnlPercent, capitalUsedPercent, price: priceFresh ? price!.price : null, priceAt: price?.eventTime ?? null } };
}

