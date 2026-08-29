#pragma once

#include <vector>

#include "gasx/order.hpp"
#include "gasx/order_book.hpp"

namespace gasx {

// Deterministic price-time-priority matching over a local OrderBook
// (ARCHITECTURE.md §16.1). This is the *off-chain* replica: useful for
// display, quoting, simulation, and pre-trade validation. The Sui
// contract in contracts/gasx (specifically order::match_orders) is the
// authoritative source of truth for which trades actually settled
// (ARCHITECTURE.md §16) — nothing here moves funds or opens positions.
//
// Self-trade prevention is intentionally out of scope: since this book is
// advisory rather than authoritative, a local self-cross is harmless —
// the Move contract independently rejects self-trades when a match is
// actually submitted on-chain.
class MatchingEngine {
 public:
  explicit MatchingEngine(OrderBook& book) : book_(book) {}

  // Submits a new order. Matches it against the opposite side of the book
  // while prices cross, producing one Fill per match — executed at the
  // resting (maker) order's price, in price-then-time priority order. Any
  // quantity left unfilled becomes a new resting order in the book.
  //
  // order.remaining_quantity and order.sequence are overwritten
  // regardless of what the caller passed in; only id/trader_id/side/price/
  // original_quantity need to be set.
  std::vector<Fill> submit(Order order);

  OrderBook& book() { return book_; }
  const OrderBook& book() const { return book_; }

 private:
  OrderBook& book_;
  Sequence next_sequence_ = 1;

  static bool crosses(const Order& incoming, const Order& resting);
};

} // namespace gasx
