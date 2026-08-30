#pragma once

#include <unordered_map>

#include "gasx/inventory_tracker.hpp"
#include "gasx/market_data_publisher.hpp"
#include "gasx/matching_engine.hpp"
#include "gasx/order_book.hpp"
#include "gasx/pre_trade_risk.hpp"
#include "gasx/pricing.hpp"
#include "gasx/protocol/messages.hpp"
#include "gasx/types.hpp"

// EngineService (ARCHITECTURE.md §16.1 protocol component): a single
// stable facade over one market's OrderBook + MatchingEngine +
// PreTradeRisk + QuoteEngine + MarketDataPublisher + per-trader
// InventoryTrackers, wired together the way the eventual N-API binding
// needs them — one call in, one call out, no engine internals leaking
// across that boundary. This class is what that binding wraps 1:1; it
// does not itself know anything about Node or JS.
//
// One EngineService instance represents one market (not one trader) —
// a real shared order book has many traders — so per-trader state
// (InventoryTracker) lives in a map keyed by TraderId, populated lazily
// as each trader is first seen.
namespace gasx {

class EngineService {
 public:
  EngineService(RiskLimits risk_limits, PricingConfig pricing_config);

  // Builds an AccountState from request.available_margin and this
  // trader's locally-tracked net position, then runs PreTradeRisk::check.
  // If rejected, returns immediately with PlaceOrderStatus::RejectedRisk
  // and no book mutation whatsoever. If accepted, assigns an order_id,
  // submits to the MatchingEngine, applies every resulting Fill to both
  // the incoming and resting trader's InventoryTracker (their sides are
  // opposite), publishes an updated book snapshot, and returns the
  // order_id plus any fills produced immediately.
  protocol::PlaceOrderResponse place_order(const protocol::PlaceOrderRequest& request);

  // Cancels a resting order. Publishes an updated book snapshot only if
  // something was actually removed.
  protocol::CancelOrderResponse cancel_order(const protocol::CancelOrderRequest& request);

  // Delegates to QuoteEngine::compute_quote with the caller-supplied
  // net_position. Does not publish the resulting quote — callers that
  // want quotes broadcast do so themselves via publisher().
  protocol::GetQuoteResponse get_quote(const protocol::GetQuoteRequest& request) const;

  protocol::GetBookSnapshotResponse get_book_snapshot() const;

  // Exposes the publisher so callers can subscribe before trading starts.
  MarketDataPublisher& publisher() { return publisher_; }

  // This trader's net position AS SEEN BY THIS ENGINE SESSION SO FAR —
  // starts at 0, only reflects fills that happened through this
  // EngineService instance, NOT their true on-chain position. The
  // caller (API gateway) must reconcile with chain state separately.
  // Returns 0 for a trader_id never seen (does not insert).
  Quantity net_position(const TraderId& trader_id) const;

 private:
  OrderBook book_;
  MatchingEngine matching_engine_;   // init with book_
  PreTradeRisk pre_trade_risk_;
  QuoteEngine quote_engine_;
  MarketDataPublisher publisher_;
  std::int64_t contract_multiplier_; // from risk_limits.contract_multiplier
  std::unordered_map<TraderId, InventoryTracker> inventories_; // multi-trader
  OrderId next_order_id_ = 1;

  // Returns (inserting a fresh, zeroed tracker if trader_id hasn't been
  // seen yet) the InventoryTracker for trader_id.
  InventoryTracker& inventory_for(const TraderId& trader_id);

  // Publishes the current best_bid/best_ask via publisher_.
  void publish_snapshot();
};

} // namespace gasx
