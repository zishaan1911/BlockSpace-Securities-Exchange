#pragma once

#include <string>
#include <vector>

#include "gasx/market_data_publisher.hpp"
#include "gasx/order.hpp"
#include "gasx/pricing.hpp"
#include "gasx/types.hpp"

// Plain request/response structs for EngineService (ARCHITECTURE.md
// §16.1 protocol component). No serialization lives here on purpose: the
// TypeScript API gateway will eventually talk to this engine through a
// native Node addon (N-API), which marshals these fields directly
// between JS and C++ rather than going through a wire format. This
// header's only job is to give that future binding a stable, versioned
// set of request/response shapes to wrap 1:1 — nothing here depends on
// EngineService itself, so it can be included on its own.
namespace gasx::protocol {

struct PlaceOrderRequest {
  TraderId trader_id;
  Side side;
  Price price;
  Quantity quantity;
  // Caller-supplied, as last known from chain — this engine NEVER
  // tracks collateral itself (Sui is the source of truth for margin).
  Price available_margin;
};

enum class PlaceOrderStatus { Accepted, RejectedRisk };

struct PlaceOrderResponse {
  PlaceOrderStatus status = PlaceOrderStatus::RejectedRisk;
  OrderId order_id = 0;         // valid only if Accepted
  std::string reject_reason;    // valid only if RejectedRisk
  std::vector<Fill> fills;      // fills produced immediately by this order
};

struct CancelOrderRequest {
  OrderId order_id;
};

struct CancelOrderResponse {
  bool cancelled = false;
};

struct GetQuoteRequest {
  ModelQuoteInput model_input;
  // Caller-supplied, same decoupling QuoteEngine::compute_quote itself
  // already uses (see pricing.hpp) — EngineService samples the trader's
  // InventoryTracker and passes it in here rather than GetQuote taking a
  // "maker identity" concept of its own.
  Quantity net_position = 0;
};

struct GetQuoteResponse {
  bool has_quote = false;
  Quote quote;
};

struct GetBookSnapshotResponse {
  BookSnapshot snapshot;
};

} // namespace gasx::protocol
