#pragma once

#include <cstddef>
#include <deque>
#include <functional>
#include <map>
#include <optional>
#include <unordered_map>
#include <utility>

#include "gasx/order.hpp"

namespace gasx {

// Price-time-priority local order book (ARCHITECTURE.md §16.1). A
// non-authoritative replica: useful for fast display, quoting,
// simulation, and pre-trade validation, but the Sui contracts in
// contracts/gasx remain the source of truth for what actually settled
// (ARCHITECTURE.md §16).
//
// Bids are kept highest-price-first, asks lowest-price-first; within a
// price level, orders are FIFO (first in, first matched), which is what
// gives "time priority" its meaning.
//
// This class only manages book *state* — insertion, cancellation, and
// reducing a resting order's remaining quantity. It does not decide
// whether two orders cross or produce fills; that's MatchingEngine's job,
// built on top of this book's public API.
class OrderBook {
 public:
  // Inserts `order` as a new resting order. Ignores order.remaining_quantity
  // as given and sets it to order.original_quantity.
  void add_resting_order(Order order);

  // Removes `id` if it is currently resting in the book. Returns true if
  // something was removed, false if `id` isn't resting (already filled,
  // cancelled, or never existed).
  bool cancel(OrderId id);

  // Reduces the resting order `id`'s remaining_quantity by `qty` (which
  // must be <= its current remaining_quantity); removes it from the book
  // entirely if that exhausts it. Returns false if `id` isn't resting.
  bool fill(OrderId id, Quantity qty);

  // Best (highest-priority) resting order on each side, if any. Returns a
  // copy — mutate book state via fill()/cancel(), not through this.
  std::optional<Order> best_bid() const;
  std::optional<Order> best_ask() const;

  bool empty() const;
  std::size_t bid_count() const;
  std::size_t ask_count() const;

  // Total resting quantity across all orders at exactly `price` on `side`.
  // 0 if there's no such level.
  Quantity quantity_at(Side side, Price price) const;

 private:
  using Level = std::deque<Order>;

  // Highest price first.
  std::map<Price, Level, std::greater<Price>> bids_;
  // Lowest price first.
  std::map<Price, Level> asks_;
  // Where to find a resting order by id, for O(level size) cancel/fill
  // instead of scanning the whole book.
  std::unordered_map<OrderId, std::pair<Side, Price>> locations_;
};

} // namespace gasx
