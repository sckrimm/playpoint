export const MAX_MARKET_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;

export class OrderSubmissionBlockedError extends Error {
  constructor() {
    super("Order blocked: strategy paused or market event expired before submission");
    this.name = "OrderSubmissionBlockedError";
  }
}

export function isFreshMarketEvent(eventTime: number | undefined, now = Date.now()): boolean {
  return eventTime !== undefined && Number.isFinite(eventTime) &&
    eventTime >= now - MAX_MARKET_AGE_MS && eventTime <= now + MAX_FUTURE_SKEW_MS;
}
