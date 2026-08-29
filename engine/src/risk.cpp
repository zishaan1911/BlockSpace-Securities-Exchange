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

} // namespace gasx::risk
