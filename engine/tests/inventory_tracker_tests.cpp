#include <gtest/gtest.h>

#include "gasx/inventory_tracker.hpp"

namespace gasx {
namespace {

TEST(InventoryTracker, StartsFlat) {
  InventoryTracker tracker;
  EXPECT_EQ(tracker.net_position(), 0);
  EXPECT_EQ(tracker.average_entry_price(), 0);
}

TEST(InventoryTracker, OpeningFromFlatSetsPositionAndEntryPrice) {
  InventoryTracker tracker;
  const auto pnl = tracker.apply_fill(Side::Buy, 425, 5);

  EXPECT_EQ(pnl.magnitude, 0);
  EXPECT_FALSE(pnl.is_negative);
  EXPECT_EQ(tracker.net_position(), 5);
  EXPECT_EQ(tracker.average_entry_price(), 425);
}

TEST(InventoryTracker, OpeningShortIsNegativeNetPosition) {
  InventoryTracker tracker;
  tracker.apply_fill(Side::Sell, 425, 5);

  EXPECT_EQ(tracker.net_position(), -5);
  EXPECT_EQ(tracker.average_entry_price(), 425);
}

TEST(InventoryTracker, AddingSameDirectionRecomputesWeightedAverage) {
  InventoryTracker tracker;
  tracker.apply_fill(Side::Buy, 400, 5);
  tracker.apply_fill(Side::Buy, 600, 5); // 5@400 + 5@600 -> weighted avg 500

  EXPECT_EQ(tracker.net_position(), 10);
  EXPECT_EQ(tracker.average_entry_price(), 500);
}

TEST(InventoryTracker, PartialReduceRealizesPnlAndKeepsEntryPrice) {
  InventoryTracker tracker;
  tracker.apply_fill(Side::Buy, 425, 5);
  const auto pnl = tracker.apply_fill(Side::Sell, 500, 2);

  EXPECT_EQ(pnl.magnitude, 150); // (500-425)*2*1
  EXPECT_FALSE(pnl.is_negative);
  EXPECT_EQ(tracker.net_position(), 3);
  EXPECT_EQ(tracker.average_entry_price(), 425); // unchanged on the remainder
}

TEST(InventoryTracker, FullReduceToFlatResetsEntryPrice) {
  InventoryTracker tracker;
  tracker.apply_fill(Side::Buy, 425, 5);
  const auto pnl = tracker.apply_fill(Side::Sell, 500, 5);

  EXPECT_EQ(pnl.magnitude, 375); // (500-425)*5*1
  EXPECT_FALSE(pnl.is_negative);
  EXPECT_EQ(tracker.net_position(), 0);
  EXPECT_EQ(tracker.average_entry_price(), 0);
}

TEST(InventoryTracker, ReduceAtALossIsNegative) {
  InventoryTracker tracker;
  tracker.apply_fill(Side::Buy, 500, 5);
  const auto pnl = tracker.apply_fill(Side::Sell, 425, 5);

  EXPECT_EQ(pnl.magnitude, 375);
  EXPECT_TRUE(pnl.is_negative);
}

TEST(InventoryTracker, FlipThroughFlatRealizesPnlOnClosedPortionAndOpensFreshBasis) {
  InventoryTracker tracker;
  tracker.apply_fill(Side::Buy, 400, 5); // long 5 @ 400
  // Sell 8: closes 5 (realizing PnL @ 500) and opens a fresh short 3 @ 500.
  const auto pnl = tracker.apply_fill(Side::Sell, 500, 8);

  EXPECT_EQ(pnl.magnitude, 500); // (500-400)*5*1 on the closing 5 only
  EXPECT_FALSE(pnl.is_negative);
  EXPECT_EQ(tracker.net_position(), -3);
  EXPECT_EQ(tracker.average_entry_price(), 500); // fresh basis on the new short leg
}

TEST(InventoryTracker, ShortPositionMirrorsLong) {
  InventoryTracker tracker;
  tracker.apply_fill(Side::Sell, 500, 5); // short 5 @ 500
  const auto pnl = tracker.apply_fill(Side::Buy, 425, 5); // covers at a profit

  EXPECT_EQ(pnl.magnitude, 375);
  EXPECT_FALSE(pnl.is_negative);
  EXPECT_EQ(tracker.net_position(), 0);
}

TEST(InventoryTracker, RejectsZeroOrNegativeQuantity) {
  InventoryTracker tracker;
  EXPECT_THROW(tracker.apply_fill(Side::Buy, 500, 0), std::invalid_argument);
}

TEST(InventoryTracker, AppliesContractMultiplierToRealizedPnl) {
  InventoryTracker tracker(/*contract_multiplier=*/10);
  tracker.apply_fill(Side::Buy, 425, 5);
  const auto pnl = tracker.apply_fill(Side::Sell, 500, 5);

  EXPECT_EQ(pnl.magnitude, 3750); // (500-425)*5*10
}

} // namespace
} // namespace gasx
