#include <gtest/gtest.h>

#include "gasx/inventory_tracker.hpp"
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

TEST(QuoteEngine, ZeroSkewConfigMatchesUnskewedBehavior) {
  PricingConfig config; // inventory_skew_per_unit defaults to 0
  QuoteEngine engine(config);

  const auto flat = engine.compute_quote(make_input(441.2, 69.4, 0.9), /*net_position=*/0);
  const auto as_if_long = engine.compute_quote(make_input(441.2, 69.4, 0.9), /*net_position=*/50);

  ASSERT_TRUE(flat.has_value());
  ASSERT_TRUE(as_if_long.has_value());
  EXPECT_EQ(flat->bid, as_if_long->bid);
  EXPECT_EQ(flat->ask, as_if_long->ask);
}

TEST(QuoteEngine, FlatInventoryMeansNoSkewEvenWithSkewConfigured) {
  PricingConfig config;
  config.inventory_skew_per_unit = 5;
  QuoteEngine engine(config);

  const auto with_default = engine.compute_quote(make_input(441.2, 69.4, 0.9));
  const auto explicit_flat = engine.compute_quote(make_input(441.2, 69.4, 0.9), /*net_position=*/0);

  ASSERT_TRUE(with_default.has_value());
  ASSERT_TRUE(explicit_flat.has_value());
  EXPECT_EQ(with_default->bid, explicit_flat->bid);
  EXPECT_EQ(with_default->ask, explicit_flat->ask);
}

TEST(QuoteEngine, LongInventorySkewsBidAndAskDown) {
  PricingConfig config;
  config.inventory_skew_per_unit = 5;
  QuoteEngine engine(config);

  const auto flat = engine.compute_quote(make_input(441.2, 69.4, 0.9), 0);
  const auto long_position = engine.compute_quote(make_input(441.2, 69.4, 0.9), 10);

  ASSERT_TRUE(flat.has_value());
  ASSERT_TRUE(long_position.has_value());
  EXPECT_EQ(long_position->bid, flat->bid - 50);  // 10 * 5
  EXPECT_EQ(long_position->ask, flat->ask - 50);
}

TEST(QuoteEngine, ShortInventorySkewsBidAndAskUp) {
  PricingConfig config;
  config.inventory_skew_per_unit = 5;
  QuoteEngine engine(config);

  const auto flat = engine.compute_quote(make_input(441.2, 69.4, 0.9), 0);
  const auto short_position = engine.compute_quote(make_input(441.2, 69.4, 0.9), -10);

  ASSERT_TRUE(flat.has_value());
  ASSERT_TRUE(short_position.has_value());
  EXPECT_EQ(short_position->bid, flat->bid + 50);
  EXPECT_EQ(short_position->ask, flat->ask + 50);
}

TEST(QuoteEngine, SkewPreservesSpreadWidth) {
  PricingConfig config;
  config.inventory_skew_per_unit = 7;
  QuoteEngine engine(config);

  const auto flat = engine.compute_quote(make_input(441.2, 69.4, 0.9), 0);
  const auto skewed = engine.compute_quote(make_input(441.2, 69.4, 0.9), 25);

  ASSERT_TRUE(flat.has_value());
  ASSERT_TRUE(skewed.has_value());
  EXPECT_EQ(flat->ask - flat->bid, skewed->ask - skewed->bid);
}

TEST(QuoteEngine, SkewDoesNotAffectFairPriceOrQuoteSize) {
  PricingConfig config;
  config.inventory_skew_per_unit = 7;
  QuoteEngine engine(config);

  const auto flat = engine.compute_quote(make_input(441.2, 69.4, 0.9), 0);
  const auto skewed = engine.compute_quote(make_input(441.2, 69.4, 0.9), 40);

  ASSERT_TRUE(flat.has_value());
  ASSERT_TRUE(skewed.has_value());
  EXPECT_EQ(flat->fair_price, skewed->fair_price);
  EXPECT_EQ(flat->quote_size, skewed->quote_size);
}

// End-to-end: a real InventoryTracker's net_position() feeds straight
// into QuoteEngine, demonstrating the wiring the engine README describes
// (portfolio -> pricing), without QuoteEngine depending on
// InventoryTracker's header at all.
TEST(QuoteEngine, WiredToARealInventoryTrackerSkewsTowardFlat) {
  PricingConfig config;
  config.inventory_skew_per_unit = 5;
  QuoteEngine engine(config);

  InventoryTracker tracker;
  tracker.apply_fill(Side::Buy, 44000, 20); // now net long 20

  const auto quote = engine.compute_quote(make_input(441.2, 69.4, 0.9), tracker.net_position());
  const auto flat_quote = engine.compute_quote(make_input(441.2, 69.4, 0.9), 0);

  ASSERT_TRUE(quote.has_value());
  ASSERT_TRUE(flat_quote.has_value());
  // Long 20 units * 5 ticks/unit = 100 ticks skewed down.
  EXPECT_EQ(quote->bid, flat_quote->bid - 100);
  EXPECT_EQ(quote->ask, flat_quote->ask - 100);
}

} // namespace
} // namespace gasx
