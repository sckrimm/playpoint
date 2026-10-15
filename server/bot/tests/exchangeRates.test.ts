import assert from "node:assert/strict";
import { test } from "node:test";
import { convertFiat, ExchangeRateService, moneyMinor } from "../src/services/exchangeRateService.js";

test("fiat conversion uses NBG quantity, round-trips from the original amount and caches rates", async () => {
  let calls = 0;
  const now = Date.parse("2026-10-15T09:00:00Z");
  const fetchImpl = (async () => { calls++; return new Response(JSON.stringify([{ date: "2026-10-15T00:00:00Z", currencies: [
    { code: "USD", quantity: 10, rate: 27 }, { code: "EUR", quantity: 1, rate: 3 },
  ] }])); }) as typeof fetch;
  const service = new ExchangeRateService(fetchImpl, () => now);
  const rates = await service.getRates();
  assert.equal(convertFiat(270, "GEL", "USD", rates), 100);
  assert.equal(convertFiat(270, "GEL", "EUR", rates), 90);
  assert.equal(convertFiat(100, "USD", "GEL", rates), 270);
  await service.getRates();
  assert.equal(calls, 1);
  assert.equal(moneyMinor("0.29"), 29);
  for (const input of [-1, NaN, "1.001", "", "1e3", Infinity]) assert.throws(() => moneyMinor(input));
});

test("rate outages use explicitly marked cached data and never fabricate a 1:1 conversion", async () => {
  let now = Date.parse("2026-10-15T09:00:00Z");
  let failed = false;
  const service = new ExchangeRateService((async () => {
    if (failed) throw new Error("offline");
    return new Response(JSON.stringify([{ date: "2026-10-15T00:00:00Z", currencies: [
      { code: "USD", quantity: 1, rate: 2.7 }, { code: "EUR", quantity: 1, rate: 3 },
    ] }]));
  }) as typeof fetch, () => now);
  await service.getRates();
  now += 2 * 60 * 60_000;
  failed = true;
  assert.equal((await service.getRates()).stale, true);
  const empty = new ExchangeRateService((async () => { throw new Error("offline"); }) as typeof fetch, () => now);
  await assert.rejects(empty.getRates());
});
