#include <gtest/gtest.h>

#include "gasx/order_book.hpp"

namespace gasx {
namespace {

Order make_order(OrderId id, TraderId trader, Side side, Price price, Quantity qty) {
  Order o;
  o.id = id;
  o.trader_id = std::move(trader);
  o.side = side;
  o.price = price;
  o.original_quantity = qty;
  o.remaining_quantity = qty;
  o.sequence = id;
  return o;
}

TEST(OrderBook, EmptyBookHasNoBestBidOrAsk) {
  OrderBook book;
  EXPECT_TRUE(book.empty());
  EXPECT_FALSE(book.best_bid().has_value());
  EXPECT_FALSE(book.best_ask().has_value());
}

TEST(OrderBook, AddRestingOrderAppearsAsBest) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Buy, 500, 5));

  ASSERT_TRUE(book.best_bid().has_value());
  EXPECT_EQ(book.best_bid()->id, 1u);
  EXPECT_EQ(book.best_bid()->price, 500);
  EXPECT_FALSE(book.best_ask().has_value());
  EXPECT_EQ(book.bid_count(), 1u);
}

TEST(OrderBook, BidsAreOrderedHighestPriceFirst) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Buy, 480, 5));
  book.add_resting_order(make_order(2, "bob", Side::Buy, 500, 5));
  book.add_resting_order(make_order(3, "carol", Side::Buy, 490, 5));

  ASSERT_TRUE(book.best_bid().has_value());
  EXPECT_EQ(book.best_bid()->id, 2u); // 500 is highest
}

TEST(OrderBook, AsksAreOrderedLowestPriceFirst) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Sell, 520, 5));
  book.add_resting_order(make_order(2, "bob", Side::Sell, 480, 5));
  book.add_resting_order(make_order(3, "carol", Side::Sell, 500, 5));

  ASSERT_TRUE(book.best_ask().has_value());
  EXPECT_EQ(book.best_ask()->id, 2u); // 480 is lowest
}

TEST(OrderBook, SamePriceLevelIsFifoByArrival) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Buy, 500, 5));
  book.add_resting_order(make_order(2, "bob", Side::Buy, 500, 5));

  // Both at the same price; the first to arrive has time priority.
  EXPECT_EQ(book.best_bid()->id, 1u);
}

TEST(OrderBook, CancelRemovesOrderAndClearsEmptyLevel) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Buy, 500, 5));

  EXPECT_TRUE(book.cancel(1));
  EXPECT_TRUE(book.empty());
  EXPECT_EQ(book.bid_count(), 0u);
}

TEST(OrderBook, CancelLeavesOtherOrdersAtSameLevelIntact) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Buy, 500, 5));
  book.add_resting_order(make_order(2, "bob", Side::Buy, 500, 3));

  EXPECT_TRUE(book.cancel(1));
  ASSERT_TRUE(book.best_bid().has_value());
  EXPECT_EQ(book.best_bid()->id, 2u);
  EXPECT_EQ(book.quantity_at(Side::Buy, 500), 3);
}

TEST(OrderBook, CancelNonexistentOrderReturnsFalse) {
  OrderBook book;
  EXPECT_FALSE(book.cancel(999));
}

TEST(OrderBook, CancelIsIdempotentFalseOnSecondCall) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Buy, 500, 5));
  EXPECT_TRUE(book.cancel(1));
  EXPECT_FALSE(book.cancel(1));
}

TEST(OrderBook, PartialFillReducesRemainingQuantityWithoutRemoving) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Sell, 480, 5));

  EXPECT_TRUE(book.fill(1, 2));
  ASSERT_TRUE(book.best_ask().has_value());
  EXPECT_EQ(book.best_ask()->remaining_quantity, 3);
  EXPECT_EQ(book.quantity_at(Side::Sell, 480), 3);
}

TEST(OrderBook, FullFillRemovesOrderAndClearsEmptyLevel) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Sell, 480, 5));

  EXPECT_TRUE(book.fill(1, 5));
  EXPECT_TRUE(book.empty());
}

TEST(OrderBook, FillNonexistentOrderReturnsFalse) {
  OrderBook book;
  EXPECT_FALSE(book.fill(999, 1));
}

TEST(OrderBook, FillMoreThanRemainingThrows) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Sell, 480, 5));
  EXPECT_THROW(book.fill(1, 6), std::invalid_argument);
}

TEST(OrderBook, QuantityAtSumsAllOrdersOnTheLevel) {
  OrderBook book;
  book.add_resting_order(make_order(1, "alice", Side::Buy, 500, 5));
  book.add_resting_order(make_order(2, "bob", Side::Buy, 500, 3));

  EXPECT_EQ(book.quantity_at(Side::Buy, 500), 8);
  EXPECT_EQ(book.quantity_at(Side::Buy, 999), 0);
}

} // namespace
} // namespace gasx
