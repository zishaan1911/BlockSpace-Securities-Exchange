#include <gtest/gtest.h>

#include "gasx/risk.hpp"

namespace gasx::risk {
namespace {

TEST(Risk, NotionalMultipliesPriceQuantityMultiplier) {
  EXPECT_EQ(notional(425, 5, 1), 2125);
}

TEST(Risk, RequiredMarginAppliesBpsRatio) {
  // notional = 1000, 10% (1000 bps) -> 100
  EXPECT_EQ(required_margin(100, 10, 1, 1'000), 100);
}

TEST(Risk, RequiredMarginFullRatioEqualsNotional) {
  const Price n = notional(200, 3, 2);
  EXPECT_EQ(required_margin(200, 3, 2, kBpsDenominator), n);
}

TEST(Risk, RequiredMarginRejectsZeroRatio) {
  EXPECT_THROW(required_margin(100, 1, 1, 0), std::invalid_argument);
}

TEST(Risk, RequiredMarginRejectsRatioOver100Percent) {
  EXPECT_THROW(required_margin(100, 1, 1, kBpsDenominator + 1), std::invalid_argument);
}

TEST(Risk, NotionalRejectsZeroMultiplier) {
  EXPECT_THROW(notional(100, 1, 0), std::invalid_argument);
}

// ARCHITECTURE.md §3.1 example, reused here just to sanity-check the
// notional convention this module shares with contracts/gasx (Move).
TEST(Risk, MatchesArchitectureNotionalExample) {
  EXPECT_EQ(notional(425, 5, 1), 2125);
}

TEST(Risk, LongPnlMatchesArchitectureExample) {
  // buy 5 contracts at 425, final 500 -> P&L = (500-425)*1*5 = 375
  const PnlResult result = compute_pnl(/*is_long=*/true, 425, 500, 5, 1);
  EXPECT_EQ(result.magnitude, 375);
  EXPECT_FALSE(result.is_negative);
}

TEST(Risk, LongPnlIsNegativeWhenPriceFalls) {
  const PnlResult result = compute_pnl(true, 500, 425, 5, 1);
  EXPECT_EQ(result.magnitude, 375);
  EXPECT_TRUE(result.is_negative);
}

TEST(Risk, ShortPnlIsMirrorOfLong) {
  const PnlResult long_result = compute_pnl(true, 425, 500, 5, 1);
  const PnlResult short_result = compute_pnl(false, 425, 500, 5, 1);
  EXPECT_EQ(long_result.magnitude, short_result.magnitude);
  EXPECT_NE(long_result.is_negative, short_result.is_negative);
}

TEST(Risk, FlatPositionHasZeroPnl) {
  const PnlResult result = compute_pnl(true, 300, 300, 10, 1);
  EXPECT_EQ(result.magnitude, 0);
  EXPECT_FALSE(result.is_negative);
}

TEST(Risk, ComputePnlRejectsZeroMultiplier) {
  EXPECT_THROW(compute_pnl(true, 100, 200, 1, 0), std::invalid_argument);
}

} // namespace
} // namespace gasx::risk
