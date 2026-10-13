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
