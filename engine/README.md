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
| `risk` | pure notional/margin math, mirrors `gasx::risk` in the Move package |
| `order_book` | price-time-priority book: bids/asks, cancel, fill |
| `matching_engine` | deterministic matching against the book, executes at the resting price |
| `pre_trade_risk` | order-size/position-limit/margin-sufficiency checks before an order is accepted |

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
