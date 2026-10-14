# User Accounts

Production requires PostgreSQL (`DATABASE_URL`) and the existing administrator
settings (`DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`). Existing strategies and
templates remain assigned to that administrator. The administrator's current
environment-based Binance credentials continue to work.

To enable personal API credentials:

1. Run `node scripts/generate-bot-credentials-key.mjs` from the repository root.
2. Add `BOT_CREDENTIALS_ENCRYPTION_KEY` from `data/bot-credentials-key.env` to the
   application's encrypted runtime environment settings, then redeploy.
3. Keep this key stable and backed up with the database. Replacing it prevents
   existing encrypted API credentials from being read.

Invite users from the administrator's Users panel. Registration opens their
Profile, where they can enter their own Testnet and Spot read-only credentials.
LIVE trading remains disabled. Testnet credentials must permit trading.

Each dashboard lists only its owner's strategies, history and templates.
Administrators can inspect other users' strategies but cannot trade or modify
them. Sharing is opt-in from the strategy's checkbox. Cloning copies BUY/SELL
levels and reserve settings into a new form with no budget, orders, balances,
API credentials or execution state.

Personal credentials use AES-256-GCM authenticated to the user and environment.
Neither profile responses nor shared strategies expose API secrets. Key changes
require the account's strategies to be paused with no unresolved execution.
Personal Spot USDT balance history is collected every 30 seconds. Telegram
remains attached to the administrator; other users' trades are not sent there.

## Execution Safety

LIVE trading remains disabled in configuration, dashboard mutations and engine
initialization. No fixed monetary cap is introduced by the safety controls.

Streaming price events older than 30 seconds, more than 5 seconds in the future,
or with invalid timestamps cannot trigger new orders. TESTNET execution requires
an exchange event timestamp; simulation scripts may still use synthetic prices.
The engine rechecks the timestamp after queueing, and the Testnet executor checks
the strategy status and timestamp after preflight, before submitting a new order.
Fresh events resume evaluation automatically; stale ticks do not consume levels.

A TESTNET order error pauses that strategy persistently and stops the rest of
the tick's orders. Unknown submissions retain their reconciliation markers.
Reconciliation continues independently of paused trading and never resubmits
the uncertain order. Inspect the result before manually resuming the strategy.

The overview's pause-all command atomically pauses only the current account's
existing active strategies, including in legacy single-admin mode. It does not
sell holdings, withdraw funds, or resume any strategy after restart. Already sent
orders may still finish and must be reconciled. This is not an account lock:
users may explicitly resume individual strategies or create new ones afterwards.

## Environment Views And LIVE Access

The SIMULATION / TESTNET / LIVE switch filters strategy lists, archives, bot
totals and comparisons. Testnet balances come from the owner's Testnet account;
the LIVE view uses Spot read-only USDT balances. Simulation has no exchange
balance. Missing Testnet balance history is not replaced by Spot return data.

New and existing non-admin users default to `live_access = FALSE`. Administrators
grant or revoke this permission in Users. It is enforced on the server for LIVE
queries and direct strategy access, not just on the switch. Session queries read
the current permission, so an existing login does not retain revoked access.
Spot balance endpoints and saving Spot credentials also require LIVE access.
Revoking access pauses that user's active LIVE strategies in the same database
transaction. It leaves Testnet/simulation strategies and other users untouched.

This permission grants access to the LIVE view only. It does not enable real
order submission: LIVE creation, activation, profit withdrawal and engine
initialization remain locked. The LIVE view displays this state and disables
strategy creation. Enabling real-money execution requires separate work and
explicit approval; neither the environment switch nor a permission grant does it.
