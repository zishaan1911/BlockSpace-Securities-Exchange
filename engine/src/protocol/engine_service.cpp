#include "gasx/protocol/engine_service.hpp"

#include <utility>

namespace gasx {

EngineService::EngineService(RiskLimits risk_limits, PricingConfig pricing_config)
    : matching_engine_(book_),
      pre_trade_risk_(risk_limits),
      quote_engine_(pricing_config),
      contract_multiplier_(risk_limits.contract_multiplier) {}

InventoryTracker& EngineService::inventory_for(const TraderId& trader_id) {
  auto [it, inserted] = inventories_.try_emplace(trader_id, contract_multiplier_);
  return it->second;
}

void EngineService::publish_snapshot() {
  BookSnapshot snapshot;
  snapshot.best_bid = book_.best_bid();
  snapshot.best_ask = book_.best_ask();
  publisher_.publish_book(snapshot);
}

protocol::PlaceOrderResponse EngineService::place_order(const protocol::PlaceOrderRequest& request) {
  protocol::PlaceOrderResponse response;

  AccountState account;
  account.available_margin = request.available_margin;
  account.current_position = inventory_for(request.trader_id).net_position();

  Order order;
  order.trader_id = request.trader_id;
  order.side = request.side;
  order.price = request.price;
  order.original_quantity = request.quantity;

  const RiskResult risk_result = pre_trade_risk_.check(order, account);
  if (!risk_result.accepted()) {
    response.status = protocol::PlaceOrderStatus::RejectedRisk;
    response.reject_reason = risk_result.reason;
    return response;
  }

  order.id = next_order_id_++;
  std::vector<Fill> fills = matching_engine_.submit(order);

  for (const Fill& fill : fills) {
    // The resting trader's side is always the opposite of the incoming
    // order's side (that's what "crossed" means).
    const Side resting_side = (fill.incoming_side == Side::Buy) ? Side::Sell : Side::Buy;
    inventory_for(fill.incoming_trader_id).apply_fill(fill.incoming_side, fill.price, fill.quantity);
    inventory_for(fill.resting_trader_id).apply_fill(resting_side, fill.price, fill.quantity);
  }

  response.status = protocol::PlaceOrderStatus::Accepted;
  response.order_id = order.id;
  response.fills = std::move(fills);

  publish_snapshot();

  return response;
}

protocol::CancelOrderResponse EngineService::cancel_order(const protocol::CancelOrderRequest& request) {
  protocol::CancelOrderResponse response;
  response.cancelled = book_.cancel(request.order_id);
  if (response.cancelled) {
    publish_snapshot();
  }
  return response;
}

protocol::GetQuoteResponse EngineService::get_quote(const protocol::GetQuoteRequest& request) const {
  protocol::GetQuoteResponse response;
  const auto quote = quote_engine_.compute_quote(request.model_input, request.net_position);
  if (quote.has_value()) {
    response.has_quote = true;
    response.quote = *quote;
  }
  return response;
}

protocol::GetBookSnapshotResponse EngineService::get_book_snapshot() const {
  protocol::GetBookSnapshotResponse response;
  response.snapshot.best_bid = book_.best_bid();
  response.snapshot.best_ask = book_.best_ask();
  return response;
}

Quantity EngineService::net_position(const TraderId& trader_id) const {
  const auto it = inventories_.find(trader_id);
  if (it == inventories_.end()) {
    return 0;
  }
  return it->second.net_position();
}

} // namespace gasx
