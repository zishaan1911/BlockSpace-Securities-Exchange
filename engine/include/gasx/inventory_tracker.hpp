#pragma once

#include "gasx/risk.hpp"
#include "gasx/types.hpp"

namespace gasx {

// Local, off-chain tracker of net position and realized PnL from a
// stream of fills (ARCHITECTURE.md §16.1 InventoryTracker) — the C++
// analogue of gasx::position (Move), kept in the same
// volume-weighted-average-entry-price convention so the two agree.
//
// Unlike the Move contract's Phase 1 matching (which disallows a single
// fill from flipping a position through flat, ARCHITECTURE.md §40), this
// tracker supports flips: since it's purely local bookkeeping rather than
// authoritative settlement state, there's no reason to impose that
// restriction here. It also does not verify fills against an OrderBook or
// move any funds — it just answers "what is our net position and its
// average entry price, given everything that's happened so far."
class InventoryTracker {
 public:
  explicit InventoryTracker(std::int64_t contract_multiplier = 1)
      : contract_multiplier_(contract_multiplier) {}

  // Applies one fill to the tracked position. `side` is this trader's own
  // side of the fill. Returns the realized PnL on whatever portion of
  // `qty` closed out existing opposite-side exposure — {0, false} if this
  // fill only added to (or opened) the position, with no closing portion.
  risk::PnlResult apply_fill(Side side, Price price, Quantity qty);

  // Signed: positive = net long, negative = net short, 0 = flat.
  Quantity net_position() const { return net_position_; }

  // Volume-weighted average entry price of the current net position.
  // Meaningless (reads 0) once net_position() == 0.
  Price average_entry_price() const { return average_entry_price_; }

 private:
  std::int64_t contract_multiplier_;
  Quantity net_position_ = 0;
  Price average_entry_price_ = 0;
};

} // namespace gasx
