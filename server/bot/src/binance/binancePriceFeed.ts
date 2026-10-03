import WebSocket from "ws";
import { telegramAlerts } from "../services/telegramAlertService.js";
type MiniTickerMessage = { e: string; E: number; s: string; c: string };
export type MultiPriceHandler = (symbol: string, price: number, eventTime: Date) => Promise<void>;

export class BinancePriceFeed {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;

  private symbols = new Set<string>();
  private requestId = 1;

  constructor(
    private readonly webSocketUrl = "wss://stream.binance.com:9443/ws",
    private readonly label = "Binance Spot",
  ) {}

  start(onPrice: MultiPriceHandler): void {
    this.stopped = false;
    this.watchdogTimer ??= setInterval(() => {
      if (!this.symbols.size || this.socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessageAt <= 45_000) return;
      console.error(`${this.label} WebSocket stale for 45s; reconnecting`);
      this.socket.terminate();
    }, 15_000);
    this.watchdogTimer.unref();
    this.connect(onPrice);
  }

  setSymbols(symbols: string[]): void {
    const next = new Set(symbols.map((symbol) => symbol.toUpperCase()));
    const added = [...next].filter((symbol) => !this.symbols.has(symbol));
    const removed = [...this.symbols].filter((symbol) => !next.has(symbol));
    this.symbols = next;
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (added.length) this.lastMessageAt = Date.now();
      this.sendSubscription("SUBSCRIBE", added);
      this.sendSubscription("UNSUBSCRIBE", removed);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    this.socket?.close();
  }

  private connect(onPrice: MultiPriceHandler): void {
    console.log(`Connecting to ${this.label} multiplex stream`);
    this.socket = new WebSocket(this.webSocketUrl);

    this.socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      this.sendSubscription("SUBSCRIBE", [...this.symbols]);
      console.log(`${this.label} WebSocket connected with ${this.symbols.size} symbol(s)`);
      void telegramAlerts.transition(`feed:${this.label}`, "CONNECTED", `${this.label} ფასის ნაკადი აღდგა`);
    });

    this.socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as MiniTickerMessage | { result: null; id: number };
        if (!("e" in message)) return;
        const price = Number(message.c);
        if (message.e !== "24hrMiniTicker" || !this.symbols.has(message.s) || !Number.isFinite(price) || price <= 0) return;
        this.lastMessageAt = Date.now();
        void onPrice(message.s, price, new Date(message.E)).catch((error) =>
          console.error(`${this.label} price processing failed:`, error instanceof Error ? error.message : error));
      } catch (error) {
        console.error("Malformed Binance message:", error instanceof Error ? error.message : error);
      }
    });

    this.socket.on("error", (error) => console.error(`${this.label} WebSocket error:`, error.message));
    this.socket.on("close", () => {
      this.socket = null;
      if (!this.stopped) {
        void telegramAlerts.transition(`feed:${this.label}`, "DISCONNECTED", `${this.label} ფასის ნაკადი გაითიშა\nბოტი ავტომატურად ცდილობს აღდგენას`);
        this.scheduleReconnect(onPrice);
      }
    });
  }

  private sendSubscription(method: "SUBSCRIBE" | "UNSUBSCRIBE", symbols: string[]): void {
    if (!symbols.length || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      method,
      params: symbols.map((symbol) => `${symbol.toLowerCase()}@miniTicker`),
      id: this.requestId++,
    }));
  }

  private scheduleReconnect(onPrice: MultiPriceHandler): void {
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    console.log(`Binance WebSocket reconnecting in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(() => this.connect(onPrice), delay);
  }
}
