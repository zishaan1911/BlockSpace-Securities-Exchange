# GASX C++ engine

Performance-sensitive, non-authoritative off-chain runtime (ARCHITECTURE.md
§16, §20): a local order book replica, deterministic price-time-priority
matching, and pre-trade risk checks that mirror the on-chain margin math in
`contracts/gasx` (Move) so a rejection here predicts what the chain would
also reject.

**The Sui contracts remain the source of truth.** Nothing in this engine
settles a trade — it's for fast market display, quote calculation,
simulation, and validating an order is worth submitting on-chain at all.

## Modules

| module | responsibility |
|---|---|
| `types` | shared value types — integer prices/quantities, no floating point |
| `risk` | pure notional/margin/PnL math, mirrors `gasx::risk` in the Move package |
| `order_book` | price-time-priority book: bids/asks, cancel, fill |
| `matching_engine` | deterministic matching against the book, executes at the resting price |
| `pre_trade_risk` | order-size/position-limit/margin-sufficiency checks before an order is accepted |
| `inventory_tracker` | net position + realized PnL from a fill stream, mirrors `gasx::position` |
| `pricing` | `QuoteEngine` — model output -> fair_price/bid/ask/quote_size (§20.1 Pricing Runtime) |
| `market_data_publisher` | in-process pub/sub for book and quote updates |
| `protocol` | `EngineService` — stable facade wiring the above into one market; the future N-API binding wraps this 1:1 |

This covers all seven components ARCHITECTURE.md §16.1 lists for the C++
order engine (`OrderBook`, `MatchingEngine`, `PriceTimePriority` — folded
into `MatchingEngine` rather than a separate class, since price-time
priority is `OrderBook`'s ordering plus `MatchingEngine`'s walk order, not
an independent component — `QuoteEngine`, `InventoryTracker`,
`PreTradeRisk`, `MarketDataPublisher`), plus the `protocol` module
(`EngineService`) that wires all of them together behind one stable
interface for the future N-API binding.

## Build & test

```bash
cd engine
mkdir -p build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j
ctest --output-on-failure
```

Tests are pulled in via CMake `FetchContent` (GoogleTest `v1.15.2`); no
system-wide GoogleTest install is required. Set `-DGASX_ENGINE_BUILD_TESTS=OFF`
to skip building tests (e.g. when this is vendored as a dependency
elsewhere).

## Design notes

- **No floating point in financial state** (ARCHITECTURE.md §16.1): prices
  and quantities are `int64_t` in whatever fixed-point unit the caller has
  agreed on, matching the `u64` convention used on-chain.
- **Execution price = the resting (maker) order's price.** This generalizes
  the convention already used in the Move contract's Phase 1 matching
  (`contracts/gasx/sources/order.move`, which always executes at the ask
  since it only ever compares one bid against one ask).
- **Self-trade prevention is out of scope here.** Since this book is
  advisory, not authoritative, allowing a self-cross locally is harmless —
  the Move contract independently rejects self-trades when a match is
  actually submitted on-chain.
- **`PreTradeRisk` is intentionally narrow** — order-size limits,
  net-position limits, and margin sufficiency. The fuller risk engine
  described in ARCHITECTURE.md §20.1 (circuit breakers, model-confidence
  limits, hedge ratio, concentration) is out of scope for this first slice.
- **`QuoteEngine`'s spread model is intentionally simple** — it widens
  with model volatility, and its center shifts with inventory (see
  below). ARCHITECTURE.md §12 also lists liquidity, order-book imbalance,
  and hedge cost as quote inputs; those aren't wired in yet.
- **Inventory skew**: `QuoteEngine::compute_quote` takes the market
  maker's own net position (typically `InventoryTracker::net_position()`)
  as a plain `Quantity` parameter, deliberately *not* a coupling to
  `InventoryTracker`'s header — the caller samples inventory and passes
  it in, keeping `pricing` and `portfolio` independently testable. A long
  position skews both bid and ask down (less eager to buy more, more
  attractive for others to buy from us); a short position skews both up.
  Skewing shifts where the two-sided quote is centered — it never changes
  `fair_price` (the model's unskewed view of fair value) or the spread
  width (`ask - bid`).
- **`InventoryTracker` supports position flips**, unlike the Move
  contract's Phase 1 matching (which disallows a single fill flipping a
  position through flat). Since this tracker is local bookkeeping, not
  authoritative settlement state, there's no reason to impose that
  restriction here — it realizes PnL on whatever portion of a fill closes
  existing exposure, then opens a fresh basis on any remainder that flips
  through to the other side.
- **`MarketDataPublisher` is in-process only** — synchronous callbacks,
  not a network transport. It's the hook point where a real one (the
  WebSocket server in the TypeScript API gateway, ARCHITECTURE.md §22/§24)
  plugs in later.
- **`protocol::EngineService` is the stable facade the future N-API
  binding wraps 1:1** — one instance represents one market (not one
  trader), with a `RiskLimits`+`PricingConfig` pair fixing its behavior
  at construction. `protocol/messages.hpp` defines plain request/response
  structs with **no serialization**: N-API marshals fields directly
  between JS and C++, so there's no wire format to design here. A
  rejected `place_order` mutates nothing — no order id assigned, no book
  change, no inventory update — it just returns `RejectedRisk` plus a
  reason string. `available_margin` is caller-supplied per request
  (never tracked locally) for the same reason `AccountState` already is
  in `pre_trade_risk`: Sui remains the source of truth for collateral,
  and this engine must not duplicate it. Each trader's `InventoryTracker`
  is created lazily on first order and starts at zero — it reflects only
  fills seen through this `EngineService` instance, not the trader's true
  on-chain position, so the API gateway must reconcile with chain state
  separately.
