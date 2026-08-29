#include "gasx/risk.hpp"

#include <stdexcept>

namespace gasx::risk {

Price notional(Price price, Quantity quantity, std::int64_t contract_multiplier) {
  if (contract_multiplier <= 0) {
    throw std::invalid_argument("contract_multiplier must be positive");
  }
  return price * quantity * contract_multiplier;
}

Price required_margin(Price price,
                       Quantity quantity,
                       std::int64_t contract_multiplier,
                       std::int64_t margin_ratio_bps) {
  if (margin_ratio_bps <= 0 || margin_ratio_bps > kBpsDenominator) {
    throw std::invalid_argument("margin_ratio_bps must be in (0, kBpsDenominator]");
  }
  const Price n = notional(price, quantity, contract_multiplier);
  return (n * margin_ratio_bps) / kBpsDenominator;
}

PnlResult compute_pnl(bool is_long,
                       Price entry_price,
                       Price exit_price,
                       Quantity quantity,
                       std::int64_t contract_multiplier) {
  if (contract_multiplier <= 0) {
    throw std::invalid_argument("contract_multiplier must be positive");
  }

  const bool favorable = is_long ? (exit_price >= entry_price) : (entry_price >= exit_price);
  const Price diff = favorable
                          ? (is_long ? (exit_price - entry_price) : (entry_price - exit_price))
                          : (is_long ? (entry_price - exit_price) : (exit_price - entry_price));

  return PnlResult{diff * quantity * contract_multiplier, !favorable};
}

} // namespace gasx::risk
