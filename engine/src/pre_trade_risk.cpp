#include "gasx/pre_trade_risk.hpp"

#include <cstdlib>

namespace gasx {

RiskResult PreTradeRisk::check(const Order& order, const AccountState& account) const {
  if (limits_.max_order_quantity > 0 && order.original_quantity > limits_.max_order_quantity) {
    return {RiskDecision::Reject, "order quantity exceeds max_order_quantity"};
  }

  const Quantity signed_delta =
      (order.side == Side::Buy) ? order.original_quantity : -order.original_quantity;
  const Quantity projected_position = account.current_position + signed_delta;

  if (limits_.max_net_position > 0 && std::llabs(projected_position) > limits_.max_net_position) {
    return {RiskDecision::Reject, "order would exceed max_net_position"};
  }

  const Price required =
      risk::required_margin(order.price, order.original_quantity, limits_.contract_multiplier,
                             limits_.margin_ratio_bps);
  if (required > account.available_margin) {
    return {RiskDecision::Reject, "insufficient available margin"};
  }

  return {RiskDecision::Accept, ""};
}

} // namespace gasx
