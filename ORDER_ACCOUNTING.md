# Execution and Commission Accounting

## Current Contract

For new TESTNET executions, the actual gross quote divided by gross quantity is the displayed execution VWAP. It is not recalculated from fee-adjusted cash flows.

| Side | quoteAmount in ledger | assetQuantity in ledger |
| --- | --- | --- |
| BUY | gross quote + USDT commission | gross filled quantity - base commission |
| SELL | gross quote - USDT commission | gross filled quantity + base commission |

SELL cost basis includes all inventory debited, including base commission. Order history stores a JSON execution snapshot (gross amounts, commission amounts/assets, source) and commission status in the same database transaction as holdings, cash, PnL and level completion. Replaying an existing order cannot overwrite its original ledger or mark old evidence verified retroactively.

`VERIFIED` means fills and base/quote commissions are accounted for on this order, not that the entire account, strategy or historical profit has passed an external audit.

## Evidence and Recovery

FULL fills must match executed quantity and gross quote (allowing only per-fill quote rounding). Missing/invalid fills fall back to signed order-scoped `GET /api/v3/myTrades` with `orderId`, `limit=1000` and monotonic `fromId` pagination. Trade IDs are checked for duplicates, symbol/order/side are validated, and quantities/quote totals must match the final order. Commissions must be explicit, nonnegative decimals; absent fees are never assumed zero.

See [Binance account trade list documentation](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account).

Incomplete/unavailable evidence raises `UNKNOWN_RESULT` with no automatic resubmission. Failures saving an already-confirmed execution also lock the level for reconciliation rather than creating another exchange order. Pending manual profit-sale requests retain their existing durable request ID and are reconciled with the same accounting path.

## Provisional Profit

- A nonzero commission in a third asset, e.g. BNB on BTCUSDT, is preserved as `UNPRICED`. No invented USDT conversion is used.
- Old orders migrate additively to `UNVERIFIED`, without balance or history rewrites. SIMULATION orders are exempt from exchange-fee verification.
- Any unverified/unpriced TESTNET order blocks new profit-allocation requests and profit compounding for that strategy. Base-budget BUYs can continue, bounded by recorded free quote; this does not automatically pause the strategy.
- Existing pending profit-sale requests may settle: an already-executed sale must not be duplicated or forgotten.
- Detail/overview display provisional-result warnings; order history shows stored commissions. Readiness has an explicit commission-evidence check. LIVE remains disabled.

## Remaining Work Before LIVE

1. Reconcile historical orders against account fills in a separately reviewed migration, preserving an audit trail of corrections. This update does not backfill or rewrite them.
2. Value third-asset fees with a documented historical conversion policy before labeling overall PnL fully net.
3. Verify fee headroom and reserve edge cases against TESTNET. A base-asset SELL fee crossing the permanent-reserve/holdings guard stays pending for review instead of bypassing that guard or being resubmitted. A quote fee can consume cash beyond the requested gross amount; the actual debit is recorded, not hidden.
4. Authenticated production checks and observed 48-hour / three-cycle evidence remain separate requirements. Unit tests are not trading-profit evidence.
5. The dashboard's initial-purchase path still needs a durable pre-submission request record (separate from normal strategy-level and manual profit-sale claims). An ambiguous initial BUY must be investigated before reactivation; this patch does not make that path restart-safe.
