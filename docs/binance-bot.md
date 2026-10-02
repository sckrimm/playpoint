# Binance strategy bot

The Binance strategy dashboard is mounted inside the existing Playpoint web
service at `/bot/`. A production supervisor starts the Playpoint API, the bot
dashboard on internal port `4173`, and exactly one strategy worker in the same
container.

## DigitalOcean commands

- Build command: `npm ci && npm run build`
- Run command: `npm start`
- Public port: `8080`
- Health check: `/health`
- Container count: `1`

## App-level environment variables

Keep the existing Playpoint variables and add:

```text
BASE_PATH=/bot
TRADING_MODE=SIMULATION
BOT_INTERNAL_PORT=4173
BINANCE_API_KEY=<encrypted>
BINANCE_API_SECRET=<encrypted>
BINANCE_TESTNET_API_KEY=<encrypted>
BINANCE_TESTNET_API_SECRET=<encrypted>
DASHBOARD_USERNAME=<encrypted>
DASHBOARD_PASSWORD=<encrypted>
```

The existing `DATABASE_URL` is shared. Bot tables use the `bot_` prefix, so
they do not overwrite Playpoint's Prisma tables. The dashboard requires Basic
Authentication while `/bot/health` remains available to health checks.

LIVE trading remains disabled by the bot backend.
