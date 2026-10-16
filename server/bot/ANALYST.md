# Read-Only Analyst: Phase 1

This release is free, rules-based analytics. It does not call an LLM, require an
OpenAI key, predict profit, or execute trading actions. The UI explicitly labels
AI as disabled. No chat interface or automatic parameter changes are included.

## Data And Method

- The main market pulse uses BTCUSDT and ETHUSDT as benchmarks, not a universal
  market index. Strategy assessments use each strategy's own symbol.
- SIMULATION and LIVE views read public Binance Spot history. TESTNET uses the
  Testnet history endpoint. The cache separates these data sources.
- Up to 52 hourly candles are read. Only fully closed candles count. The latest
  25 must be contiguous, valid OHLC data and end within the past 90 minutes.
- 24-hour change compares the latest closed price with the closed price 24 hours
  earlier. UP requires change >1% and price >20-hour mean *1.005. DOWN requires
  change <-1% and price <mean *0.995. Otherwise the label is mixed/range, not a
  claim that the price will stay flat.
- Daily range is (24-hour high / low - 1), not statistical volatility. Volume
  compares quote turnover across two complete, contiguous 24-hour windows.
  Missing or zero-baseline volume is shown as unavailable, never fabricated.
- Market data is cached five minutes; failures one minute. Concurrent identical
  fetches are deduplicated. The UI displays the candle close/as-of timestamp.
- Strategy valuation requires a price no older than 30 seconds (maximum future
  tolerance five seconds). Missing/stale prices and invalid ledgers prevent a
  clear verdict. No prediction confidence or success probability is generated.

## Reasons And Thresholds

Assessments flag uncertain/failed orders, unresolved profit allocations, negative
available quote, less than 10% free working capital, total marked PnL below -10%
of the original budget, descending trend, >10% daily range, and >25% turnover
decline. These are transparent review thresholds, not calibrated predictions.
The capital calculation uses available quote and retained realized profit, not
cumulative historic BUY totals. PnL is total marked trading PnL, not peak drawdown.

## Ownership And History

`GET /api/analyst/overview?environment=...` uses existing ownership and environment
permissions, and limits a response to the first 30 visible strategies. A response
explicitly reports truncation. Processing is limited to four symbols per batch.

`GET /api/analyst/strategies/:id` returns the current assessment and saved history.
`POST` on the same route snapshots server-computed data only, not client-supplied
recommendations. Matching rapid snapshots may reuse the previous record. At most
100 snapshots per strategy are retained; the latest 30 are returned.

`PATCH /api/analyst/strategies/:id/reviews/:reviewId` records ACKNOWLEDGED or
DISMISSED, scoped to the owning strategy. Neither state applies a suggestion,
changes strategy configuration, pauses a bot, places an order, or enables LIVE.
The existing strategy access checks protect both read and write routes.

History is in PostgreSQL or SQLite alongside strategy data. It contains market
and strategy observations, never exchange credentials or assigned fiat balances.
Analytics off/on is a per-browser, per-user preference. It controls the analyst
UI/automatic reads only, not the trading engine. Manual assessment remains
read-only, and no third-party generative AI is involved.

## Checks

`npm run bot:test` covers candle windows, partial/stale/invalid data, turnover,
source-isolated caching, uncertain orders, ledger warnings, immutable trading
state, and scoped history/decisions in SQLite and a PostgreSQL emulator.
Browser checks cover 320/390/1440 widths, bottom-sheet layout, keyboard dismissal,
mobile Back, source labels, save/history/decisions and off/on behavior.

This phase does not include AI-powered entry decisions, automatic changes,
AI-versus-baseline simulation comparisons, or a verified LIVE trading rollout.
