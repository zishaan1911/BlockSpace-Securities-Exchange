#pragma once

#include "gasx/types.hpp"

namespace gasx {

struct Order {
  OrderId id;
  TraderId trader_id;
  Side side;
  Price price;
  Quantity original_quantity;
  // Unfilled quantity remaining. MatchingEngine::submit overwrites this
  // with original_quantity on entry; callers constructing an Order don't
  // need to set it themselves for that path.
  Quantity remaining_quantity = 0;
  // Assigned by MatchingEngine on submission; breaks price ties by
  // arrival order (time priority).
  Sequence sequence = 0;

  bool is_filled() const { return remaining_quantity == 0; }
};

// One match between an incoming order and a resting order already in the
// book. Executes at the resting (maker) order's price.
struct Fill {
  OrderId resting_order_id;
  OrderId incoming_order_id;
  TraderId resting_trader_id;
  TraderId incoming_trader_id;
  // Side of the incoming order (the resting order is always the other side).
  Side incoming_side;
  Price price;
  Quantity quantity;
  Sequence sequence;
};

} // namespace gasx
