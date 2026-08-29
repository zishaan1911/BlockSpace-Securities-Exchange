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

} // namespace
} // namespace gasx::risk
