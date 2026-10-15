export const FIAT_CURRENCIES = ["GEL", "USD", "EUR"] as const;
export type FiatCurrency = typeof FIAT_CURRENCIES[number];
export type ExchangeRates = { source: "NBG"; date: string; fetchedAt: string; gelPerUnit: Record<FiatCurrency, number>; stale: boolean };

export function fiatCurrency(value: unknown): FiatCurrency {
  if (!FIAT_CURRENCIES.includes(value as FiatCurrency)) throw new Error("ვალუტა უნდა იყოს GEL, USD ან EUR");
  return value as FiatCurrency;
}

export function moneyMinor(value: unknown, allowZero = true): number {
  const text = String(value ?? "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("თანხა უნდა იყოს არაუარყოფითი რიცხვი, მაქსიმუმ 2 ათწილადით");
  const [whole = "0", fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > 1_000_000_000_000 || (!allowZero && minor === 0)) throw new Error("თანხა დასაშვებ დიაპაზონში არ არის");
  return minor;
}

export function convertFiat(amount: number, from: FiatCurrency, to: FiatCurrency, rates: ExchangeRates): number {
  return Math.round(amount * rates.gelPerUnit[from] / rates.gelPerUnit[to] * 100) / 100;
}

export class ExchangeRateService {
  private cached: ExchangeRates | null = null;
  private pending: Promise<ExchangeRates> | null = null;
  private retryAt = 0;

  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly now = () => Date.now()) {}

  async getRates(): Promise<ExchangeRates> {
    if (this.cached && this.now() - Date.parse(this.cached.fetchedAt) < 60 * 60_000) return this.cached;
    if (this.now() < this.retryAt) {
      if (this.cached && this.now() - Date.parse(this.cached.date) <= 7 * 86_400_000) return { ...this.cached, stale: true };
      throw new Error("ეროვნული ბანკის კურსი დროებით მიუწვდომელია");
    }
    this.pending ??= this.load().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async load(): Promise<ExchangeRates> {
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(this.now()));
      const response = await this.fetchImpl(`https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/?date=${today}`, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error("NBG unavailable");
      const data = await response.json() as Array<{ date: string; currencies: Array<{ code: string; quantity: number; rate: number }> }>;
      const record = data.filter((item) => typeof item.date === "string" && item.date.slice(0, 10) <= today)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!record || this.now() - Date.parse(record.date) > 7 * 86_400_000) throw new Error("NBG date unavailable");
      const gelPerUnit = { GEL: 1, USD: 0, EUR: 0 };
      for (const code of ["USD", "EUR"] as const) {
        const row = record.currencies.find((item) => item.code === code);
        if (!row || !Number.isFinite(row.rate) || row.rate <= 0 || !Number.isFinite(row.quantity) || row.quantity <= 0) throw new Error("NBG rate invalid");
        gelPerUnit[code] = row.rate / row.quantity;
      }
      this.cached = { source: "NBG", date: record.date.slice(0, 10), fetchedAt: new Date(this.now()).toISOString(), gelPerUnit, stale: false };
      return this.cached;
    } catch {
      this.retryAt = this.now() + 60_000;
      if (this.cached && this.now() - Date.parse(this.cached.date) <= 7 * 86_400_000) return { ...this.cached, stale: true };
      throw new Error("ეროვნული ბანკის კურსი დროებით მიუწვდომელია");
    }
  }
}
