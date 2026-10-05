import { XMLParser } from "fast-xml-parser";

export type NewsSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface CryptoNewsItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  originalTitle: string;
  url: string;
  imageUrl: string | null;
  publishedAt: string;
  coins: string[];
  sentiment: NewsSentiment;
  translated: boolean;
}

export interface CryptoNewsDetail {
  id: string;
  content: string;
  translated: boolean;
  expanded: boolean;
}

const feeds = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
] as const;

const coinPatterns: Array<[string, RegExp]> = [
  ["BTC", /\b(bitcoin|btc)\b/i], ["ETH", /\b(ethereum|ether|eth)\b/i],
  ["SOL", /\b(solana|sol)\b/i], ["BNB", /\b(bnb|binance coin)\b/i],
  ["XRP", /\b(xrp|ripple)\b/i], ["DOGE", /\b(dogecoin|doge)\b/i],
  ["ADA", /\b(cardano|ada)\b/i], ["AVAX", /\b(avalanche|avax)\b/i],
  ["LINK", /\b(chainlink|link)\b/i], ["DOT", /\b(polkadot|dot)\b/i],
  ["TRX", /\b(tron|trx)\b/i], ["TON", /\b(toncoin|\bton\b)\b/i],
  ["SUI", /\b(sui)\b/i], ["LTC", /\b(litecoin|ltc)\b/i],
  ["SHIB", /\b(shiba inu|shib)\b/i], ["PEPE", /\b(pepe)\b/i],
];

const positiveWords = /\b(surge|gain|rise|rally|record|approval|approved|launch|growth|bullish|breakout|adoption|partnership)\b/gi;
const negativeWords = /\b(drop|fall|crash|hack|exploit|fraud|lawsuit|ban|bearish|liquidation|loss|stolen|scam|probe)\b/gi;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", cdataPropName: "#text" });
const translationCache = new Map<string, { title: string; summary: string; translated: boolean }>();
const detailTranslationCache = new Map<string, CryptoNewsDetail>();

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" ");
  if (value && typeof value === "object" && "#text" in value) return String((value as { "#text": unknown })["#text"] ?? "");
  return value == null ? "" : String(value);
}

function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return stripHtml(value.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16))));
}

function splitTranslationChunks(value: string, maxLength = 430): string[] {
  const sentences = value.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) chunks.push(current);
      for (let offset = 0; offset < sentence.length; offset += maxLength) chunks.push(sentence.slice(offset, offset + maxLength));
      current = "";
    } else if (!current || current.length + sentence.length + 1 <= maxLength) {
      current = current ? `${current} ${sentence}` : sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateText(value: string): Promise<{ text: string; translated: boolean }> {
  const chunks = splitTranslationChunks(value.slice(0, 1_500));
  if (!chunks.length) return { text: value, translated: false };
  try {
    const translated: string[] = [];
    for (const chunk of chunks) {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", chunk);
      url.searchParams.set("langpair", "en|ka");
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
      const payload = await response.json() as { responseData?: { translatedText?: string } };
      const result = payload.responseData?.translatedText?.trim();
      if (!result) throw new Error("Empty translation");
      translated.push(result);
    }
    return { text: translated.join("\n\n"), translated: true };
  } catch {
    return { text: value, translated: false };
  }
}

function findArticleBody(html: string): string {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const root = JSON.parse(match[1] ?? "null") as unknown;
      const queue: unknown[] = [root];
      while (queue.length) {
        const value = queue.shift();
        if (Array.isArray(value)) queue.push(...value);
        else if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          if (typeof record.articleBody === "string" && record.articleBody.length > 500) return decodeHtml(record.articleBody);
          queue.push(...Object.values(record));
        }
      }
    } catch { /* Some publishers emit invalid JSON-LD. */ }
  }
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html;
  const paragraphs = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => decodeHtml(match[1] ?? ""))
    .filter((paragraph) => paragraph.length >= 45);
  return paragraphs.join("\n\n");
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function findImage(item: Record<string, unknown>): string | null {
  const media = item["media:content"] ?? item.enclosure ?? item["media:thumbnail"];
  const candidate = Array.isArray(media) ? media[0] : media;
  if (candidate && typeof candidate === "object" && "@_url" in candidate) return String((candidate as { "@_url": unknown })["@_url"]);
  const html = text(item.description ?? item["content:encoded"]);
  return html.match(/<img[^>]+src=["']([^"']+)/i)?.[1] ?? null;
}

function sentimentFor(value: string): NewsSentiment {
  const positive = value.match(positiveWords)?.length ?? 0;
  const negative = value.match(negativeWords)?.length ?? 0;
  if (positive > negative) return "POSITIVE";
  if (negative > positive) return "NEGATIVE";
  return "NEUTRAL";
}

async function translate(title: string, summary: string): Promise<{ title: string; summary: string; translated: boolean }> {
  const key = `${title}\n${summary}`;
  const cached = translationCache.get(key);
  if (cached) return cached;
  try {
    const separator = " __NEWS_SUMMARY__ ";
    const query = `${title}${separator}${summary.slice(0, 420)}`;
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", query);
    url.searchParams.set("langpair", "en|ka");
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
    const payload = await response.json() as { responseData?: { translatedText?: string } };
    const translatedText = payload.responseData?.translatedText?.trim();
    if (!translatedText) throw new Error("Empty translation");
    const parts = translatedText.split(/__\s*NEWS[\s_]*(?:SUMMARY|SUMMER)[\s_]*__|__ სიახლეების შეჯამება __/i);
    const result = parts.length > 1
      ? { title: (parts[0] ?? translatedText).trim(), summary: parts.slice(1).join(" ").trim(), translated: true }
      : { title: translatedText, summary, translated: true };
    translationCache.set(key, result);
    return result;
  } catch {
    return { title, summary, translated: false };
  }
}

export class CryptoNewsService {
  private cache: { items: CryptoNewsItem[]; expiresAt: number; generatedAt: string } | null = null;
  private originalItems = new Map<string, { url: string; summary: string }>();

  async detail(id: string): Promise<CryptoNewsDetail | null> {
    await this.latest();
    const cached = detailTranslationCache.get(id);
    if (cached) return cached;
    const original = this.originalItems.get(id);
    if (!original) return null;
    let sourceText = original.summary;
    try {
      const response = await fetch(original.url, { headers: { "User-Agent": "Mozilla/5.0 PlaypointCryptoNews/1.0" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const extracted = findArticleBody(await response.text());
        if (extracted.length > sourceText.length) sourceText = extracted;
      }
    } catch { /* RSS content remains the fallback. */ }
    const localized = await translateText(sourceText);
    const localizedFallback = this.cache?.items.find((item) => item.id === id)?.summary ?? original.summary;
    const detail = {
      id,
      content: localized.translated ? localized.text : localizedFallback,
      translated: localized.translated,
      expanded: localized.translated && sourceText.length > original.summary.length,
    };
    detailTranslationCache.set(id, detail);
    return detail;
  }

  async latest(): Promise<{ items: CryptoNewsItem[]; generatedAt: string; sources: string[] }> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return { items: this.cache.items, generatedAt: this.cache.generatedAt, sources: feeds.map((feed) => feed.source) };
    }
    const feedResults = await Promise.allSettled(feeds.map(async (feed) => {
      const response = await fetch(feed.url, { headers: { "User-Agent": "PlaypointCryptoNews/1.0" }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`${feed.source} HTTP ${response.status}`);
      const parsed = parser.parse(await response.text()) as { rss?: { channel?: { item?: Array<Record<string, unknown>> | Record<string, unknown> } } };
      return toArray(parsed.rss?.channel?.item).slice(0, 12).map((item) => ({ feed, item }));
    }));
    const rawItems = feedResults.flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .map(({ feed, item }) => {
        const title = stripHtml(text(item.title));
        const summary = stripHtml(text(item.description ?? item["content:encoded"])).slice(0, 520);
        const url = text(item.link || item.guid);
        const publishedAt = new Date(text(item.pubDate || item.isoDate || item.published) || Date.now()).toISOString();
        return { source: feed.source, title, summary, url, publishedAt, imageUrl: findImage(item) };
      })
      .filter((item) => item.title && item.url)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

    const seen = new Set<string>();
    const unique = rawItems.filter((item) => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 18);

    const items: CryptoNewsItem[] = [];
    for (let index = 0; index < unique.length; index += 3) {
      const batch = unique.slice(index, index + 3);
      const translated = await Promise.all(batch.map((item) => translate(item.title, item.summary)));
      batch.forEach((item, batchIndex) => {
        const combined = `${item.title} ${item.summary}`;
        const localized = translated[batchIndex] ?? { title: item.title, summary: item.summary, translated: false };
        const id = Buffer.from(item.url).toString("base64url").slice(0, 32);
        this.originalItems.set(id, { url: item.url, summary: item.summary });
        items.push({
          id, source: item.source,
          title: localized.title, summary: localized.summary,
          originalTitle: item.title, url: item.url, imageUrl: item.imageUrl,
          publishedAt: item.publishedAt, coins: coinPatterns.filter(([, pattern]) => pattern.test(combined)).map(([symbol]) => symbol),
          sentiment: sentimentFor(combined), translated: localized.translated,
        });
      });
    }
    const generatedAt = new Date().toISOString();
    this.cache = { items, generatedAt, expiresAt: Date.now() + 10 * 60_000 };
    return { items, generatedAt, sources: feeds.map((feed) => feed.source) };
  }
}
