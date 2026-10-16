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

## Fee Audit Findings: Still Blocking LIVE Readiness

Source inspection of `BinanceTestnetOrderService.toResult` found:

1. BUY base-asset commissions are deducted, but quote-asset commissions are not added to cash spent.
2. SELL quote-asset commissions are deducted, but base-asset commissions are not added to inventory debited.
3. Third-asset commissions, such as BNB, are not recorded or valued.
4. GET order reconciliation normally lacks fills; current conversion can therefore omit commissions after recovery.

These findings are **not fixed by the minimum-order patch**, and existing reported PnL must not be treated as an audited, fee-inclusive result. Historical account reconciliation has not been performed.

The next accounting change must obtain and validate exact fills (including order-scoped paginated myTrades for recovery), persist gross execution and per-asset commissions atomically with the ledger, and distinguish unpriced or legacy commissions from verified net profit. Unknown fill results must remain locked without resubmitting the order. Historical repair needs a separate reconciled migration rather than an assumed zero fee.

## Verification Scope

Automated tests cover decimal boundaries, both quantity filters, market applicability, no POST for tiny orders, average-window checks, per-level retry, continuing other levels, persistence across worker recreation, alert deduplication and PostgreSQL claim isolation. This does not constitute authenticated production verification, 48-hour TESTNET evidence or a LIVE trading trial.
