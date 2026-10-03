class TelegramAlertService {
  private readonly token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  private readonly chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  private readonly states = new Map<string, string>();

  get configured(): boolean {
    return Boolean(this.token && this.chatId);
  }

  async send(message: string): Promise<void> {
    if (!this.token || !this.chatId) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text: message, disable_web_page_preview: true }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.error("Telegram alert failed:", error instanceof Error ? error.message : error);
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
