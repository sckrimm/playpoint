class TelegramAlertService {
  private readonly token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  private readonly chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  private readonly states = new Map<string, string>();
  private lastError: string | null = null;
  private lastSentAt: string | null = null;

  get configured(): boolean {
    return Boolean(this.token && this.chatId);
  }

  getStatus(): { configured: boolean; lastError: string | null; lastSentAt: string | null } {
    return { configured: this.configured, lastError: this.lastError, lastSentAt: this.lastSentAt };
  }

  async send(message: string): Promise<boolean> {
    if (!this.token || !this.chatId) {
      this.lastError = "TELEGRAM_BOT_TOKEN ან TELEGRAM_CHAT_ID ვერ მოიძებნა";
      return false;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text: message, disable_web_page_preview: true }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { description?: string };
      if (!response.ok) throw new Error(payload.description ?? `HTTP ${response.status}`);
      this.lastError = null;
      this.lastSentAt = new Date().toISOString();
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("Telegram alert failed:", this.lastError);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async transition(key: string, state: string, message: string, notifyInitial = false): Promise<void> {
    const previous = this.states.get(key);
    this.states.set(key, state);
    if (previous === state || (previous === undefined && !notifyInitial)) return;
    await this.send(message);
  }
}

export const telegramAlerts = new TelegramAlertService();
