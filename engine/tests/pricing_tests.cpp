#include <gtest/gtest.h>

#include "gasx/pricing.hpp"

namespace gasx {
namespace {

ModelQuoteInput make_input(double expected_value, double volatility, double confidence) {
  ModelQuoteInput input;
  input.market = "EGSI-1H";
  input.expected_value = expected_value;
  input.volatility = volatility;
  input.confidence = confidence;
  input.tail_probability = 0.21;
  input.model_version = "egsi-v1.3";
  return input;
}

TEST(QuoteEngine, RefusesToQuoteBelowMinConfidence) {
  PricingConfig config;
  config.min_confidence = 0.4;
  QuoteEngine engine(config);

  const auto quote = engine.compute_quote(make_input(441.2, 69.4, 0.39));

  EXPECT_FALSE(quote.has_value());
}

TEST(QuoteEngine, QuotesAtExactlyMinConfidence) {
  PricingConfig config;
  config.min_confidence = 0.4;
  QuoteEngine engine(config);

  const auto quote = engine.compute_quote(make_input(441.2, 69.4, 0.4));

  EXPECT_TRUE(quote.has_value());
}

TEST(QuoteEngine, FairPriceScalesExpectedValueByPriceScale) {
  PricingConfig config;
  config.price_scale = 100;
  config.min_confidence = 0.0;
  QuoteEngine engine(config);

  const auto quote = engine.compute_quote(make_input(441.2, 0.0, 0.9));

  ASSERT_TRUE(quote.has_value());
  EXPECT_EQ(quote->fair_price, 44120);
}

TEST(QuoteEngine, ZeroVolatilityGivesBaseSpreadOnly) {
  PricingConfig config;
  config.price_scale = 100;
  config.base_half_spread = 50;
  config.volatility_spread_multiplier = 0.5;
  config.min_confidence = 0.0;
  QuoteEngine engine(config);

  const auto quote = engine.compute_quote(make_input(441.2, 0.0, 0.9));

  ASSERT_TRUE(quote.has_value());
  EXPECT_EQ(quote->fair_price - quote->bid, 50);
  EXPECT_EQ(quote->ask - quote->fair_price, 50);
}

TEST(QuoteEngine, HigherVolatilityWidensSpreadSymmetrically) {
  PricingConfig config;
  config.price_scale = 100;
  config.base_half_spread = 50;
  config.volatility_spread_multiplier = 1.0;
  config.min_confidence = 0.0;
  QuoteEngine engine(config);

  const auto low_vol = engine.compute_quote(make_input(441.2, 10.0, 0.9));
  const auto high_vol = engine.compute_quote(make_input(441.2, 100.0, 0.9));

  ASSERT_TRUE(low_vol.has_value());
  ASSERT_TRUE(high_vol.has_value());
  const Price low_spread = low_vol->ask - low_vol->bid;
  const Price high_spread = high_vol->ask - high_vol->bid;
  EXPECT_GT(high_spread, low_spread);

  // Symmetric around fair_price in this simplified model.
  EXPECT_EQ(high_vol->fair_price - high_vol->bid, high_vol->ask - high_vol->fair_price);
}

TEST(QuoteEngine, ConfidenceAtMinimumGivesMinQuoteSize) {
  PricingConfig config;
  config.min_confidence = 0.4;
  config.min_quote_size = 5;
  config.max_quote_size = 100;
  QuoteEngine engine(config);

  const auto quote = engine.compute_quote(make_input(441.2, 69.4, 0.4));

  ASSERT_TRUE(quote.has_value());
  EXPECT_EQ(quote->quote_size, 5);
}

TEST(QuoteEngine, ConfidenceAtOneGivesMaxQuoteSize) {
  PricingConfig config;
  config.min_confidence = 0.4;
  config.min_quote_size = 5;
  config.max_quote_size = 100;
  QuoteEngine engine(config);

  const auto quote = engine.compute_quote(make_input(441.2, 69.4, 1.0));

  ASSERT_TRUE(quote.has_value());
  EXPECT_EQ(quote->quote_size, 100);
}

TEST(QuoteEngine, QuoteSizeScalesMonotonicallyWithConfidence) {
  PricingConfig config;
  config.min_confidence = 0.4;
  config.min_quote_size = 5;
  config.max_quote_size = 100;
  QuoteEngine engine(config);

  const auto lower = engine.compute_quote(make_input(441.2, 69.4, 0.6));
  const auto higher = engine.compute_quote(make_input(441.2, 69.4, 0.8));

  ASSERT_TRUE(lower.has_value());
  ASSERT_TRUE(higher.has_value());
  EXPECT_LT(lower->quote_size, higher->quote_size);
}

TEST(QuoteEngine, BidIsAlwaysBelowFairPriceAndAskAlwaysAbove) {
  PricingConfig config;
  QuoteEngine engine(config);

  const auto quote = engine.compute_quote(make_input(441.2, 69.4, 0.91));

  ASSERT_TRUE(quote.has_value());
  EXPECT_LT(quote->bid, quote->fair_price);
  EXPECT_GT(quote->ask, quote->fair_price);
}

} // namespace
} // namespace gasx
