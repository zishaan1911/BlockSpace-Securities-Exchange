#include "gasx/inventory_tracker.hpp"

#include <algorithm>
#include <cstdlib>
#include <stdexcept>

namespace gasx {

risk::PnlResult InventoryTracker::apply_fill(Side side, Price price, Quantity qty) {
  if (qty <= 0) {
    throw std::invalid_argument("fill quantity must be positive");
  }

  const Quantity delta = (side == Side::Buy) ? qty : -qty;

  if (net_position_ == 0) {
    net_position_ = delta;
    average_entry_price_ = price;
    return risk::PnlResult{};
  }

  const bool same_direction = (net_position_ > 0) == (delta > 0);

  if (same_direction) {
    const Quantity abs_pos = std::llabs(net_position_);
    const Price existing_notional = average_entry_price_ * abs_pos;
    const Price added_notional = price * qty;
    const Quantity new_abs = abs_pos + qty;
    average_entry_price_ = (existing_notional + added_notional) / new_abs;
    net_position_ += delta;
    return risk::PnlResult{};
  }

  // Opposite direction: this fill reduces, and possibly flips, the
  // existing position.
  const bool was_long = net_position_ > 0;
  const Quantity abs_pos = std::llabs(net_position_);
  const Quantity closing_qty = std::min(qty, abs_pos);

  const risk::PnlResult realized =
      risk::compute_pnl(was_long, average_entry_price_, price, closing_qty, contract_multiplier_);

  const Quantity flipped_qty = qty - closing_qty; // > 0 only if this fill flips through flat
  net_position_ += delta;

  if (flipped_qty > 0) {
    average_entry_price_ = price; // fresh basis on the new (opposite) side
  } else if (net_position_ == 0) {
    average_entry_price_ = 0;
  }
  // else: position was only partially reduced — average_entry_price_
  // correctly stays as-is, since the remaining quantity keeps its
  // original basis.

  return realized;
}

} // namespace gasx
