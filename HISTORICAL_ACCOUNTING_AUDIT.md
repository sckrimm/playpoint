# Historical TESTNET Accounting Audit (Read Only)

## Access

Administrators can open a paused TESTNET strategy and use the History Reconciliation panel below order history. The authenticated endpoint is `POST /api/strategies/:id/accounting-audit` with `{ "offset": 0, "limit": 5 }`. Only an administrator (or the legacy password-protected local administrator) may run it. In multi-user mode it resolves the **strategy owner's** TESTNET credentials and permissions, never the viewing administrator's keys for another user's strategy.

Pending strategy-level executions or manual profit-sale requests must be reconciled first. SIMULATION, LIVE and active strategies cannot be audited through this endpoint.

## What It Does

- Inspect existing exchange order IDs using signed GET order and account-trade requests. No orders are submitted or canceled.
- Reuse validated execution/commission parsing, including paginated `myTrades`. See [Binance account endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account).
- Show stored versus actual net quote, inventory flows, commissions and differences for each order. Tiny cash/quantity differences are not silently rounded into a match.
- Distinguish matched, different, third-asset unpriced, missing, unsupported and unavailable evidence. A missing order is not fabricated from current account balances. Testnet resets or changed API accounts may leave older orders unavailable.
- Stop further exchange reads within a batch after unavailable/invalid evidence, instead of repeatedly hitting an unhealthy connection.
- Default to five orders per request, at most ten. Requests are sequential; a process-local account-owner gate rejects overlap and applies ten seconds' cooldown even after failure. This is not a distributed exchange-wide rate limiter.
- Compare strategy, orders, level claims and profit requests before/after the check. Changes during the request mark the report stale and suppress its projection. The UI also discards stale results after a strategy switch or later local state change.

## Projection Limits

An order-derived average-cost projection appears only when **all** recorded orders fit in the single requested batch, every execution has priced evidence and replaying stored orders explains the current stored investment, proceeds, inventory, remaining basis and realized profit. Larger histories show row comparisons by page, not a fabricated full-history result. Pages are independent snapshots and must not be combined into an approved repair.

The projection excludes withdrawal bookkeeping, unpriced third-asset fees and any exchange trades missing from this bot's recorded order IDs. It is not a whole-account audit or a guarantee of net profit. Missing/inconsistent opening positions or fee debits that cannot be explained by the recorded inventory suppress the projection.

## What It Does Not Do

This is a diagnostic tool, not a migration or approval mechanism. It does not change balances, orders, cost basis, realized/withdrawn profit, level statuses, evidence timers/cycles, commission verification flags or LIVE permissions. Even a MATCH does not unlock profit allocation or compounding. No report is persisted as an approved correction.

Historical repairs need a separately reviewed, durable, whole-history plan with a transaction and an audit trail. LIVE remains disabled. No authenticated production account has been reconciled merely by shipping or unit-testing this feature.
