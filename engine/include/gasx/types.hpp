#pragma once

#include <cstdint>
#include <string>

// Shared value types for the GASX C++ engine (ARCHITECTURE.md §16.1, §20).
//
// This engine is a non-authoritative local replica used for fast display,
// quoting, simulation, and pre-trade validation — the Sui contracts in
// contracts/gasx remain the source of truth for which trades actually
// settled (ARCHITECTURE.md §16). Keeping the two in agreement on
// convention (integer prices/quantities, basis-point margin ratios,
// notional = price * quantity * contract_multiplier) makes the pre-trade
// checks here meaningful predictors of what the chain will accept.
//
// Prices and quantities are plain integers in whatever fixed-point unit
// the caller has agreed on (matching the u64 convention on-chain) —
// floating point is intentionally never used in these financial types.
namespace gasx {

using Price = std::int64_t;
using Quantity = std::int64_t;
using OrderId = std::uint64_t;
using TraderId = std::string;
// Monotonically increasing arrival sequence number, assigned by the
// engine on order entry — not a wall-clock timestamp. Used to break
// price ties by time priority.
using Sequence = std::uint64_t;

enum class Side { Buy, Sell };

} // namespace gasx
