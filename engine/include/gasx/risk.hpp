#pragma once

#include <cstdint>

#include "gasx/types.hpp"

// Pure notional/margin math, deliberately kept in lockstep with
// gasx::risk in contracts/gasx (Move) — see that module's doc comment for
// the same rationale. margin_ratio_bps follows the same basis-point
// convention on both sides (1000 = 10%).
namespace gasx::risk {

constexpr std::int64_t kBpsDenominator = 10'000;

// Notional value of `quantity` contracts at `price`, scaled by
// `contract_multiplier`. Aborts (throws std::invalid_argument) if
// `contract_multiplier <= 0`.
Price notional(Price price, Quantity quantity, std::int64_t contract_multiplier);

// Required initial margin, as margin_ratio_bps / 10'000 of notional.
// Throws std::invalid_argument if contract_multiplier <= 0 or
// margin_ratio_bps is outside (0, kBpsDenominator].
Price required_margin(Price price,
                       Quantity quantity,
                       std::int64_t contract_multiplier,
                       std::int64_t margin_ratio_bps);

struct PnlResult {
  Price magnitude = 0;
  bool is_negative = false;
};

// PnL for `quantity` contracts moving from `entry_price` to `exit_price`,
// per the same formula as gasx::risk::compute_pnl in the Move contracts:
// Long P&L = (exit - entry) * contract_multiplier * quantity. A flat move
// (entry == exit) returns {0, false}. Throws std::invalid_argument if
// contract_multiplier <= 0.
PnlResult compute_pnl(bool is_long,
                       Price entry_price,
                       Price exit_price,
                       Quantity quantity,
                       std::int64_t contract_multiplier);

} // namespace gasx::risk
