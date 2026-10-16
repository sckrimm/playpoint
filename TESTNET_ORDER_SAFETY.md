# TESTNET Order Minimums and Remaining Audit

## Implemented

- Fetch and cache TESTNET symbol rules for five minutes. Never substitute production symbol rules.
- Floor MARKET quantities using decimal arithmetic and a common multiple of both enabled LOT_SIZE and MARKET_LOT_SIZE steps. Enforce their min/max quantities.
- Respect market applicability of MIN_NOTIONAL and NOTIONAL. SELL preflight uses Binance avgPrice when a positive averaging window is required; an unavailable or mismatched window is a retryable preflight failure.
- A pre-submission below-minimum BUY or SELL releases only its matching client claim to WAITING with a durable `[ORDER_DEFERRED]` reason. No exchange order has been sent.
- Retry that level at most once a minute per worker. Other eligible levels continue. On restart, immediate recheck is safe; the saved reason suppresses repeated minimum notifications.
- Never enlarge quantities, merge levels, change percentages or consume reserves to meet a minimum. A level may remain waiting indefinitely if it cannot meet exchange minimums.
- Show the deferred reason below the level in the dashboard.
- Ambiguous order results remain locked for reconciliation. Invalid credentials, balance failures, actual exchange filter rejections and other serious errors retain existing pause behavior.
- LIVE remains disabled. Already-paused strategies are not automatically reactivated or historically rewritten by this update.

Preflight cannot guarantee acceptance: the exchange applies its own live reference prices and rules. A later filter rejection is not silently retried as if no execution were possible.

## Fee Audit Follow-Up

Source inspection initially found:

1. BUY base-asset commissions are deducted, but quote-asset commissions are not added to cash spent.
2. SELL quote-asset commissions are deducted, but base-asset commissions are not added to inventory debited.
3. Third-asset commissions, such as BNB, are not recorded or valued.
4. GET order reconciliation normally lacks fills; current conversion can therefore omit commissions after recovery.

The subsequent commission-accounting update addresses new and recovered executions; see [ORDER_ACCOUNTING.md](ORDER_ACCOUNTING.md). Historical account reconciliation and third-asset valuation still block a claim of fully audited net profit. Legacy history is not silently rewritten.

## Verification Scope

Automated tests cover decimal boundaries, both quantity filters, market applicability, no POST for tiny orders, average-window checks, per-level retry, continuing other levels, persistence across worker recreation, alert deduplication and PostgreSQL claim isolation. This does not constitute authenticated production verification, 48-hour TESTNET evidence or a LIVE trading trial.
