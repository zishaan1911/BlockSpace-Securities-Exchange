#pragma once

#include <cstdint>
#include <optional>
#include <string>

#include "gasx/types.hpp"

namespace gasx {

// Normalized model response the Python AI backend hands to this runtime
// (ARCHITECTURE.md §20.1 Pricing Runtime), matching its JSON schema.
// expected_value/volatility are in the model's real-valued EGSI units;
// confidence/tail_probability are probabilities in [0, 1]. These are the
// one place in the engine floating point is appropriate — they're
// external model output, not committed financial state.
struct ModelQuoteInput {
  std::string market;
  double expected_value = 0.0;
  double volatility = 0.0;
  double confidence = 0.0;
  double tail_probability = 0.0;
  std::string model_version;
};

// Hard-coded risk constraints the quote is deterministically computed
// against (ARCHITECTURE.md §12: "The C++ runtime should calculate the
// final quote deterministically from a model output schema and
// hard-coded risk constraints").
struct PricingConfig {
  // Multiplier converting the model's real-valued EGSI units into
  // integer Price ticks (e.g. 100 for 2 decimal places of precision).
  std::int64_t price_scale = 100;
  // Minimum half-spread applied regardless of volatility, in price ticks.
  std::int64_t base_half_spread = 50;
  // Additional half-spread per unit of model volatility (in EGSI units,
  // before price_scale).
  double volatility_spread_multiplier = 0.5;
  // Below this confidence, refuse to quote at all.
  double min_confidence = 0.4;
  // Quote size at confidence == 1.0.
  Quantity max_quote_size = 100;
  // Quote size at confidence == min_confidence; scales linearly with
  // confidence between the two.
  Quantity min_quote_size = 5;
};

struct Quote {
  Price fair_price = 0;
  Price bid = 0;
  Price ask = 0;
  Quantity quote_size = 0;
};

// Deterministically derives a two-sided quote from a model response and
// fixed risk constants. No floating point survives into the returned
// Quote (ARCHITECTURE.md §16.1: no floating point in financial state
// transitions) — expected_value/volatility only ever inform integer
// price-tick and quantity outputs.
class QuoteEngine {
 public:
  explicit QuoteEngine(PricingConfig config) : config_(config) {}

  // Returns std::nullopt if input.confidence < config.min_confidence —
  // i.e. the engine refuses to publish a two-sided quote it doesn't
  // trust, rather than quoting an arbitrarily wide/small one.
  std::optional<Quote> compute_quote(const ModelQuoteInput& input) const;

 private:
  PricingConfig config_;
};

} // namespace gasx
