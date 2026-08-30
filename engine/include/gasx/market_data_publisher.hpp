#pragma once

#include <functional>
#include <optional>
#include <vector>

#include "gasx/order.hpp"
#include "gasx/pricing.hpp"

namespace gasx {

// Top-of-book snapshot: what a display or downstream consumer needs after
// a book-affecting event (add, cancel, fill).
struct BookSnapshot {
  std::optional<Order> best_bid;
  std::optional<Order> best_ask;
};

// Minimal in-process publish/subscribe for local book and quote updates
// (ARCHITECTURE.md §16.1 MarketDataPublisher). This is intentionally not
// a network transport of its own — it's the hook point where a real one
// (the WebSocket server in the TypeScript API gateway, ARCHITECTURE.md
// §22/§24) plugs in later. For Phase 1 it just fans out in-process
// callbacks synchronously on the publishing thread.
class MarketDataPublisher {
 public:
  using BookSubscriber = std::function<void(const BookSnapshot&)>;
  using QuoteSubscriber = std::function<void(const Quote&)>;

  void subscribe_book(BookSubscriber subscriber);
  void subscribe_quote(QuoteSubscriber subscriber);

  void publish_book(const BookSnapshot& snapshot);
  void publish_quote(const Quote& quote);

  std::size_t book_subscriber_count() const { return book_subscribers_.size(); }
  std::size_t quote_subscriber_count() const { return quote_subscribers_.size(); }

 private:
  std::vector<BookSubscriber> book_subscribers_;
  std::vector<QuoteSubscriber> quote_subscribers_;
};

} // namespace gasx
