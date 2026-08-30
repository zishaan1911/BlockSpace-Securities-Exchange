#include "gasx/market_data_publisher.hpp"

namespace gasx {

void MarketDataPublisher::subscribe_book(BookSubscriber subscriber) {
  book_subscribers_.push_back(std::move(subscriber));
}

void MarketDataPublisher::subscribe_quote(QuoteSubscriber subscriber) {
  quote_subscribers_.push_back(std::move(subscriber));
}

void MarketDataPublisher::publish_book(const BookSnapshot& snapshot) {
  for (const auto& subscriber : book_subscribers_) {
    subscriber(snapshot);
  }
}

void MarketDataPublisher::publish_quote(const Quote& quote) {
  for (const auto& subscriber : quote_subscribers_) {
    subscriber(quote);
  }
}

} // namespace gasx
