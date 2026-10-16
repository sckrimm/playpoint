# Profit Allocation

The profit button earmarks funds outside a strategy's trading budget. It is not
a bank withdrawal or a transfer out of Binance. LIVE execution stays disabled.

## Cash First

- The strategy must be PAUSED. In-flight and uncertain level orders block a new
  allocation. This prevents a BUY from spending the same cash during allocation.
- Available profit is the positive difference between recorded realized profit
  and previous allocations. Unrealized price gains and unspent initial capital
  are not counted as withdrawable profit.
- Free strategy quote is initial budget + sale proceeds - investment - previous
  allocations. Cash allocation is capped by both free quote and available profit.
- Cash-only allocation increments withdrawn_profit transactionally. It creates
  no exchange order, changes no coin holdings, and has no exchange order minimum.
- The existing engine deducts withdrawn_profit from quote availability and from
  retained profit used for compounding. A simulation account can reuse allocated
  funds outside this bot under its existing wallet rules.

## Optional Additional Sale

- A separate confirmation is required to sell only the cash shortfall. The total
  request still cannot exceed recorded realized, unallocated profit.
- Binance minimum notional, quantity step and the permanent reserve still apply
  to this additional sale. The application does not enlarge the sale to meet a
  minimum without consent.
- A durable PENDING request and deterministic client order ID are saved first.
  The bot cannot activate, reset or archive while that request is unresolved.
- Only the first handler may submit the sale. Repeated requests query Binance by
  the same client order ID. A missing or uncertain response is not permission to
  submit another sale. The button can recheck the pending request later.
- Definitive rejection/preflight errors cancel the request. Ambiguous results
  remain pending for reconciliation/manual investigation.
- Settlement records actual sale proceeds plus the cash portion once. Market
  execution and quantity rounding can make the final amount differ from the
  requested estimate. The allocated amount is shown under the existing total.

## History And Compatibility

New allocations have durable request IDs. Reusing an ID with another strategy,
amount or unapproved sale is rejected. The browser retains an unresolved request
across retries instead of creating a second allocation after a lost response.

Cash allocations are separate from exchange order history. Period performance
deducts their cash portions from historical working equity without treating them
as trading gains or fictitious SELL orders. Historical sale-based withdrawals
remain unchanged. The new workflow uses the existing realized-profit ledger; it
does not retroactively audit or repair historical exchange fee records.

After an allocation, the user explicitly resumes the bot. A successful local test
is not proof of production deployment or an exchange transaction.
