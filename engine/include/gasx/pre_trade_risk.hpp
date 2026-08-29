#pragma once

#include <cstdlib>
#include <string>

#include "gasx/order.hpp"
#include "gasx/risk.hpp"

namespace gasx {

// Configuration a market/account is checked against before an order is
// accepted into the (local, non-authoritative) book. 0 means "no limit"
// for either quantity field.
struct RiskLimits {
  std::int64_t contract_multiplier = 1;
  std::int64_t margin_ratio_bps = 1'000;
  Quantity max_order_quantity = 0;
  Quantity max_net_position = 0;
};

// A trader's current standing, as known to this local check — mirrors
// what gasx::margin / gasx::position track on-chain. current_position is
// signed: positive = net long, negative = net short.
struct AccountState {
  Price available_margin = 0;
  Quantity current_position = 0;
};

enum class RiskDecision { Accept, Reject };

struct RiskResult {
  RiskDecision decision;
  // Empty when decision == Accept.
  std::string reason;

  bool accepted() const { return decision == RiskDecision::Accept; }
};

// Pre-trade check (ARCHITECTURE.md §16.1): would accepting `order` at its
// stated price/quantity violate an order-size limit, a net-position
// limit, or leave the account under-margined? Purely advisory and
// side-effect-free — it does not reserve margin, touch the book, or
// mutate `account` in any way, exactly like the rest of this engine is
// non-authoritative relative to the Sui contracts in contracts/gasx.
//
// This intentionally covers only the checks with a direct on-chain
// counterpart (gasx::risk::required_margin). The fuller risk engine in
// ARCHITECTURE.md §20.1 — circuit breakers, model-confidence limits,
// hedge ratio, concentration — is out of scope for this first slice.
class PreTradeRisk {
 public:
  explicit PreTradeRisk(RiskLimits limits) : limits_(limits) {}

  RiskResult check(const Order& order, const AccountState& account) const;

 private:
  RiskLimits limits_;
};

} // namespace gasx
