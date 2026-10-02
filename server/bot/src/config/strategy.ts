import type { BuyLevelConfig, SellLevelConfig, StrategyConfig, StrategyTemplateRecord } from "../types/strategy.js";

export const DEFAULT_BUY_LEVELS: BuyLevelConfig[] = [
  { dropPercent: 15, budgetPercent: 10 },
  { dropPercent: 25, budgetPercent: 20 },
  { dropPercent: 40, budgetPercent: 30 },
  { dropPercent: 60, budgetPercent: 40 },
];

const DEFAULT_SELL_LEVELS: SellLevelConfig[] = [
  { gainPercent: 25, allocationPercent: 20 },
  { gainPercent: 40, allocationPercent: 20 },
  { gainPercent: 50, allocationPercent: 20 },
  { gainPercent: 70, allocationPercent: 15 },
  { gainPercent: 100, allocationPercent: 15 },
];

export const BUILT_IN_STRATEGY_TEMPLATES: StrategyTemplateRecord[] = [
  {
    id: null, name: "ადრეული შესვლა (-10%)", builtIn: true, createdAt: null, finalReservePercent: 10,
    buyLevels: [
      { dropPercent: 10, budgetPercent: 10 }, { dropPercent: 20, budgetPercent: 20 },
      { dropPercent: 35, budgetPercent: 30 }, { dropPercent: 50, budgetPercent: 40 },
    ],
    sellLevels: DEFAULT_SELL_LEVELS,
  },
  {
    id: null, name: "სტანდარტული (-15%)", builtIn: true, createdAt: null, finalReservePercent: 10,
    buyLevels: DEFAULT_BUY_LEVELS,
    sellLevels: DEFAULT_SELL_LEVELS,
  },
  {
    id: null, name: "ფრთხილი შესვლა (-25%)", builtIn: true, createdAt: null, finalReservePercent: 10,
    buyLevels: [
      { dropPercent: 25, budgetPercent: 10 }, { dropPercent: 40, budgetPercent: 20 },
      { dropPercent: 60, budgetPercent: 30 }, { dropPercent: 75, budgetPercent: 40 },
    ],
    sellLevels: DEFAULT_SELL_LEVELS,
  },
];

export function validateStrategyConfig(config: StrategyConfig): void {
  if (!/^[A-Z0-9]{5,20}$/.test(config.symbol)) throw new Error("სიმბოლო Binance-ის სწორი წყვილი უნდა იყოს");
  if (!Number.isFinite(config.initialEntryPrice) || config.initialEntryPrice <= 0) throw new Error("საწყისი შესვლის ფასი ნულზე მეტი უნდა იყოს");
  if (!Number.isFinite(config.totalBudget) || config.totalBudget <= 0) throw new Error("სრული ბიუჯეტი ნულზე მეტი უნდა იყოს");
  const initialPurchaseAmount = config.initialPurchaseAmount ?? 0;
  if (!Number.isFinite(initialPurchaseAmount) || initialPurchaseAmount < 0) throw new Error("საწყისი შესყიდვის თანხა უარყოფითი ვერ იქნება");
  if (initialPurchaseAmount >= config.totalBudget) throw new Error("საწყისი შესყიდვა სრულ ბიუჯეტზე ნაკლები უნდა იყოს");

  const buyTotal = config.buyLevels.reduce((sum, level) => sum + level.budgetPercent, 0);
  if (config.buyLevels.length === 0 || config.buyLevels.some((level) =>
    !Number.isFinite(level.dropPercent) || level.dropPercent <= 0 || level.dropPercent >= 100 ||
    !Number.isFinite(level.budgetPercent) || level.budgetPercent <= 0)) {
    throw new Error("BUY დონეები დადებითი უნდა იყოს, ხოლო კლება 100%-ზე ნაკლები");
  }
  if (buyTotal > 100) throw new Error("BUY განაწილებების ჯამი ბიუჯეტის 100%-ს ვერ გადააჭარბებს");
  if (new Set(config.buyLevels.map((level) => level.dropPercent)).size !== config.buyLevels.length) {
    throw new Error("BUY დონეების პროცენტები უნიკალური უნდა იყოს");
  }

  if (config.finalReservePercent < 0 || config.finalReservePercent > 100) {
    throw new Error("საბოლოო რეზერვი 0%-დან 100%-მდე უნდა იყოს");
  }
  const sellTotal = config.sellLevels.reduce((sum, level) => sum + level.allocationPercent, 0);
  if (config.sellLevels.length === 0 || config.sellLevels.some((level) =>
    !Number.isFinite(level.gainPercent) || level.gainPercent <= 0 ||
    !Number.isFinite(level.allocationPercent) || level.allocationPercent <= 0)) {
    throw new Error("SELL დონეები და განაწილებები დადებითი უნდა იყოს");
  }
  if (new Set(config.sellLevels.map((level) => level.gainPercent)).size !== config.sellLevels.length) {
    throw new Error("SELL დონეების პროცენტები უნიკალური უნდა იყოს");
  }
  if (sellTotal > 100 - config.finalReservePercent) {
    throw new Error(`SELL განაწილებები (${sellTotal}%) გასაყიდ ბალანსს (${100 - config.finalReservePercent}%) აჭარბებს`);
  }
}

export function parseSellAllocations(value: string): SellLevelConfig[] {
  if (!value.trim()) return [];
  return value.split(",").map((item) => {
    const [gainRaw, allocationRaw] = item.split(":");
    const gainPercent = Number(gainRaw);
    const allocationPercent = Number(allocationRaw);
    if (!Number.isFinite(gainPercent) || gainPercent <= 0 || !Number.isFinite(allocationPercent) || allocationPercent < 0) {
      throw new Error(`Invalid SELL allocation: ${item}`);
    }
    return { gainPercent, allocationPercent };
  });
}
