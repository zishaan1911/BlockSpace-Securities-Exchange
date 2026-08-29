#include "gasx/matching_engine.hpp"

#include <algorithm>

namespace gasx {

bool MatchingEngine::crosses(const Order& incoming, const Order& resting) {
  if (incoming.side == Side::Buy) {
    return incoming.price >= resting.price;
  }
  return incoming.price <= resting.price;
}

std::vector<Fill> MatchingEngine::submit(Order order) {
  order.remaining_quantity = order.original_quantity;
  order.sequence = next_sequence_++;

  std::vector<Fill> fills;

  while (order.remaining_quantity > 0) {
    const std::optional<Order> opposite =
        (order.side == Side::Buy) ? book_.best_ask() : book_.best_bid();
    if (!opposite.has_value() || !crosses(order, *opposite)) {
      break;
    }

    const Quantity fill_qty = std::min(order.remaining_quantity, opposite->remaining_quantity);

    fills.push_back(Fill{
        opposite->id,
        order.id,
        opposite->trader_id,
        order.trader_id,
        order.side,
        opposite->price, // execute at the resting (maker) price
        fill_qty,
        next_sequence_++,
    });

    book_.fill(opposite->id, fill_qty);
    order.remaining_quantity -= fill_qty;
  }

  if (order.remaining_quantity > 0) {
    book_.add_resting_order(order);
  }

  return fills;
}

} // namespace gasx
