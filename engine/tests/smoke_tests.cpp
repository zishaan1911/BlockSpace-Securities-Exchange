#include <gtest/gtest.h>

#include "gasx/types.hpp"

// Proves the build wiring (CMake + FetchContent GoogleTest + ctest
// discovery) works before any real engine logic is added on top of it.
TEST(Smoke, TypesHeaderCompiles) {
  gasx::Price price = 480;
  gasx::Quantity quantity = 5;
  gasx::Side side = gasx::Side::Buy;

  EXPECT_EQ(price, 480);
  EXPECT_EQ(quantity, 5);
  EXPECT_EQ(side, gasx::Side::Buy);
}
