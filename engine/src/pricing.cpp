#include "gasx/pricing.hpp"

#include <algorithm>
#include <cmath>

namespace gasx {

std::optional<Quote> QuoteEngine::compute_quote(const ModelQuoteInput& input, Quantity net_position) const {
  if (input.confidence < config_.min_confidence) {
    return std::nullopt;
  }

  const Price fair_price =
      static_cast<Price>(std::llround(input.expected_value * static_cast<double>(config_.price_scale)));

  const auto vol_component =
      static_cast<std::int64_t>(std::llround(input.volatility * config_.volatility_spread_multiplier));
  const Price half_spread = config_.base_half_spread + vol_component;

  // Positive net_position (long) skews the center down: a lower bid
  // (less eager to buy more) and a lower ask (more attractive for others
  // to buy from us), both pulling inventory back toward flat. Negative
  // net_position (short) does the opposite. fair_price itself stays the
  // model's unskewed view of fair value.
  const Price skew = net_position * config_.inventory_skew_per_unit;

  const Price bid = fair_price - half_spread - skew;
  const Price ask = fair_price + half_spread - skew;

  // Linearly interpolate size between min_quote_size (at min_confidence)
  // and max_quote_size (at confidence == 1.0).
  const double span = 1.0 - config_.min_confidence;
  const double t = (span > 0.0) ? (input.confidence - config_.min_confidence) / span : 1.0;
  const double clamped_t = std::min(1.0, std::max(0.0, t));
  const auto size_range = static_cast<double>(config_.max_quote_size - config_.min_quote_size);
  const Quantity quote_size =
      config_.min_quote_size + static_cast<Quantity>(std::llround(clamped_t * size_range));

  return Quote{fair_price, bid, ask, quote_size};
}

} // namespace gasx
