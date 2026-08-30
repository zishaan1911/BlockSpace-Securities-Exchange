#include <gtest/gtest.h>

#include "gasx/market_data_publisher.hpp"

namespace gasx {
namespace {

Order make_order(OrderId id, Side side, Price price, Quantity qty) {
  Order o;
  o.id = id;
  o.trader_id = "alice";
  o.side = side;
  o.price = price;
  o.original_quantity = qty;
  o.remaining_quantity = qty;
  return o;
}

TEST(MarketDataPublisher, StartsWithNoSubscribers) {
  MarketDataPublisher publisher;
  EXPECT_EQ(publisher.book_subscriber_count(), 0u);
  EXPECT_EQ(publisher.quote_subscriber_count(), 0u);
}

TEST(MarketDataPublisher, PublishBookWithNoSubscribersIsANoop) {
  MarketDataPublisher publisher;
  BookSnapshot snapshot;
  publisher.publish_book(snapshot); // should not throw / crash
}

TEST(MarketDataPublisher, SubscribedBookCallbackReceivesSnapshot) {
  MarketDataPublisher publisher;
  int call_count = 0;
  std::optional<Order> received_bid;

  publisher.subscribe_book([&](const BookSnapshot& snapshot) {
    ++call_count;
    received_bid = snapshot.best_bid;
  });

  BookSnapshot snapshot;
  snapshot.best_bid = make_order(1, Side::Buy, 500, 5);
  publisher.publish_book(snapshot);

  EXPECT_EQ(call_count, 1);
  ASSERT_TRUE(received_bid.has_value());
  EXPECT_EQ(received_bid->id, 1u);
}

TEST(MarketDataPublisher, MultipleBookSubscribersAllReceiveEachPublish) {
  MarketDataPublisher publisher;
  int first_count = 0;
  int second_count = 0;

  publisher.subscribe_book([&](const BookSnapshot&) { ++first_count; });
  publisher.subscribe_book([&](const BookSnapshot&) { ++second_count; });

  publisher.publish_book(BookSnapshot{});
  publisher.publish_book(BookSnapshot{});

  EXPECT_EQ(first_count, 2);
  EXPECT_EQ(second_count, 2);
  EXPECT_EQ(publisher.book_subscriber_count(), 2u);
}

TEST(MarketDataPublisher, SubscribedQuoteCallbackReceivesQuote) {
  MarketDataPublisher publisher;
  Quote received;

  publisher.subscribe_quote([&](const Quote& quote) { received = quote; });

  Quote quote;
  quote.fair_price = 44120;
  quote.bid = 43780;
  quote.ask = 44490;
  quote.quote_size = 42;
  publisher.publish_quote(quote);

  EXPECT_EQ(received.fair_price, 44120);
  EXPECT_EQ(received.bid, 43780);
  EXPECT_EQ(received.ask, 44490);
  EXPECT_EQ(received.quote_size, 42);
}

TEST(MarketDataPublisher, BookAndQuoteSubscribersAreIndependent) {
  MarketDataPublisher publisher;
  int book_calls = 0;
  int quote_calls = 0;

  publisher.subscribe_book([&](const BookSnapshot&) { ++book_calls; });
  publisher.subscribe_quote([&](const Quote&) { ++quote_calls; });

  publisher.publish_book(BookSnapshot{});

  EXPECT_EQ(book_calls, 1);
  EXPECT_EQ(quote_calls, 0); // publishing a book update shouldn't fire quote subscribers
}

} // namespace
} // namespace gasx
