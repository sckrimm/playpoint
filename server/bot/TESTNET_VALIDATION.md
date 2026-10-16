# TESTNET Validation

LIVE execution stays disabled. READY describes operational checks, not profitability
or an approval to trade real money.

## Evidence

- The worker records fresh TESTNET samples at most once every 10 seconds per bot.
- Only ACTIVE strategies without FAILED or EXECUTING levels earn observation time.
- Only intervals up to 30 seconds within the same worker process are accumulated.
  Restart gaps, offline time, old creation dates and stale prices do not count.
- A completed cycle is recorded transactionally after all configured SELL levels
  execute. Multiple BUY/SELL orders are not multiple cycles. Duplicate exchange
  order confirmations cannot increment this counter twice.
- Evidence survives restart and deploy. Editing an untraded strategy clears its
  evidence because it is a different configuration.
- No historic observation time or cycles are invented during migration. Existing
  strategies start the evidence-based validation after this deployment.
- Worker process changes and resumed samples after a gap over 30 seconds have
  separate counters. A sample gap is not proof of an actual network disconnection.

## Acceptance

1. Leave the selected TESTNET strategies running with LIVE disabled.
2. Each active strategy needs 48 accumulated observed hours. The active set needs
   at least 3 complete cycles in total and at least 1 complete cycle per strategy.
3. No unresolved orders, failed levels, stale prices or negative available quote
   balance may remain. An authenticated admin opens the readiness monitor to see
   each blocking check. Merely visiting the monitor does not earn observation time.
4. Restart/redeploy normally. Confirm that observation/cycle counters persist,
   fresh worker evidence returns, and Binance orders are not duplicated.
5. In an isolated TESTNET deployment, interrupt its price feed for over 30 seconds,
   then restore it. Confirm no order is sent using a stale event; no offline time
   is credited; fresh ticks resume evaluation. Never interrupt shared production
   networking or force trades just to obtain a green check.
6. Check matching Binance order IDs against local order history, including an
   order whose POST response is lost. Reconciliation must precede any new trade.

## Automated Versus Real Evidence

`npm run bot:test` covers fresh/stale events, preflight guards, temporary BUY/SELL
failures, backoff, ambiguous POST results, duplicate confirmations, persistence
after reopening SQLite, and cycle counters in SQLite and a PostgreSQL emulator.
The emulator is not a real PostgreSQL deployment. These tests do not substitute
for the elapsed 48-hour TESTNET run or the isolated operational scenarios above.

The monitor's restart/gap checks report observed runtime events only. They do not
certify that every manual scenario above was performed. Record actual operational
results before considering a separate LIVE rollout.
