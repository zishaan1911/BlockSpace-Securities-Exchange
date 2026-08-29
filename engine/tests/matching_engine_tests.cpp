#include <gtest/gtest.h>

#include "gasx/matching_engine.hpp"

namespace gasx {
namespace {

Order make_order(OrderId id, TraderId trader, Side side, Price price, Quantity qty) {
  Order o;
  o.id = id;
  o.trader_id = std::move(trader);
  o.side = side;
  o.price = price;
  o.original_quantity = qty;
  return o;
}

TEST(MatchingEngine, RestsOrderWhenBookIsEmpty) {
  OrderBook book;
  MatchingEngine engine(book);

  auto fills = engine.submit(make_order(1, "alice", Side::Buy, 500, 5));

  EXPECT_TRUE(fills.empty());
  ASSERT_TRUE(book.best_bid().has_value());
  EXPECT_EQ(book.best_bid()->id, 1u);
  EXPECT_EQ(book.best_bid()->remaining_quantity, 5);
}

TEST(MatchingEngine, RestsOrderWhenPricesDoNotCross) {
  OrderBook book;
  MatchingEngine engine(book);

  engine.submit(make_order(1, "alice", Side::Sell, 500, 5));
  auto fills = engine.submit(make_order(2, "bob", Side::Buy, 480, 5)); // bid below ask

  EXPECT_TRUE(fills.empty());
  EXPECT_EQ(book.bid_count(), 1u);
  EXPECT_EQ(book.ask_count(), 1u);
}

TEST(MatchingEngine, ExactCrossFullyFillsBothSides) {
  OrderBook book;
  MatchingEngine engine(book);

  engine.submit(make_order(1, "alice", Side::Sell, 480, 5));
  auto fills = engine.submit(make_order(2, "bob", Side::Buy, 500, 5));

  ASSERT_EQ(fills.size(), 1u);
  EXPECT_EQ(fills[0].resting_order_id, 1u);
  EXPECT_EQ(fills[0].incoming_order_id, 2u);
  EXPECT_EQ(fills[0].resting_trader_id, "alice");
  EXPECT_EQ(fills[0].incoming_trader_id, "bob");
  EXPECT_EQ(fills[0].price, 480); // executes at the resting (maker) price
  EXPECT_EQ(fills[0].quantity, 5);
  EXPECT_TRUE(book.empty());
}

TEST(MatchingEngine, IncomingLargerThanRestingLeavesRemainderResting) {
  OrderBook book;
  MatchingEngine engine(book);

  engine.submit(make_order(1, "alice", Side::Sell, 480, 3));
  auto fills = engine.submit(make_order(2, "bob", Side::Buy, 500, 5));

  ASSERT_EQ(fills.size(), 1u);
  EXPECT_EQ(fills[0].quantity, 3);
  EXPECT_TRUE(book.empty() == false);
  ASSERT_TRUE(book.best_bid().has_value());
  EXPECT_EQ(book.best_bid()->id, 2u);
  EXPECT_EQ(book.best_bid()->remaining_quantity, 2); // 5 - 3
}

TEST(MatchingEngine, IncomingSmallerThanRestingLeavesRestingPartiallyFilled) {
  OrderBook book;
  MatchingEngine engine(book);

  engine.submit(make_order(1, "alice", Side::Sell, 480, 5));
  auto fills = engine.submit(make_order(2, "bob", Side::Buy, 500, 2));

  ASSERT_EQ(fills.size(), 1u);
  EXPECT_EQ(fills[0].quantity, 2);
  ASSERT_TRUE(book.best_ask().has_value());
  EXPECT_EQ(book.best_ask()->id, 1u);
  EXPECT_EQ(book.best_ask()->remaining_quantity, 3); // 5 - 2
  EXPECT_EQ(book.bid_count(), 0u); // incoming fully filled, nothing rests
}

TEST(MatchingEngine, WalksMultiplePriceLevelsUntilExhausted) {
  OrderBook book;
  MatchingEngine engine(book);

  engine.submit(make_order(1, "alice", Side::Sell, 480, 2));
  engine.submit(make_order(2, "bob", Side::Sell, 490, 2));
  engine.submit(make_order(3, "carol", Side::Sell, 500, 2));

  // Aggressive buy that should sweep all three levels.
  auto fills = engine.submit(make_order(4, "dave", Side::Buy, 500, 6));

  ASSERT_EQ(fills.size(), 3u);
  EXPECT_EQ(fills[0].price, 480);
  EXPECT_EQ(fills[1].price, 490);
  EXPECT_EQ(fills[2].price, 500);
  EXPECT_TRUE(book.empty());
}

TEST(MatchingEngine, TimePriorityMatchesOldestRestingOrderFirst) {
  OrderBook book;
  MatchingEngine engine(book);

  engine.submit(make_order(1, "alice", Side::Sell, 480, 3));
  engine.submit(make_order(2, "bob", Side::Sell, 480, 3)); // same price, later arrival

  auto fills = engine.submit(make_order(3, "carol", Side::Buy, 480, 3));

  ASSERT_EQ(fills.size(), 1u);
  EXPECT_EQ(fills[0].resting_order_id, 1u); // alice was first at this price
}

TEST(MatchingEngine, IncomingSideRecordedOnFill) {
  OrderBook book;
  MatchingEngine engine(book);

  engine.submit(make_order(1, "alice", Side::Sell, 480, 5));
  auto fills = engine.submit(make_order(2, "bob", Side::Buy, 500, 5));

  ASSERT_EQ(fills.size(), 1u);
  EXPECT_EQ(fills[0].incoming_side, Side::Buy);
}

} // namespace
} // namespace gasx
