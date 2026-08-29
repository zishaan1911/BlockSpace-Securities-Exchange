#include "gasx/order_book.hpp"

#include <algorithm>
#include <stdexcept>

namespace gasx {

namespace {

template <typename MapT>
std::optional<Order> best_of(const MapT& levels) {
  if (levels.empty()) return std::nullopt;
  return levels.begin()->second.front();
}

template <typename MapT>
std::size_t order_count(const MapT& levels) {
  std::size_t total = 0;
  for (const auto& [price, level] : levels) {
    total += level.size();
  }
  return total;
}

} // namespace

void OrderBook::add_resting_order(Order order) {
  const OrderId id = order.id;
  const Side side = order.side;
  const Price price = order.price;

  if (side == Side::Buy) {
    bids_[price].push_back(std::move(order));
  } else {
    asks_[price].push_back(std::move(order));
  }
  locations_[id] = {side, price};
}

bool OrderBook::cancel(OrderId id) {
  auto it = locations_.find(id);
  if (it == locations_.end()) return false;
  const auto [side, price] = it->second;

  if (side == Side::Buy) {
    auto level_it = bids_.find(price);
    if (level_it == bids_.end()) return false;
    auto& level = level_it->second;
    auto pos = std::find_if(level.begin(), level.end(),
                             [&](const Order& o) { return o.id == id; });
    if (pos == level.end()) return false;
    level.erase(pos);
    if (level.empty()) bids_.erase(level_it);
  } else {
    auto level_it = asks_.find(price);
    if (level_it == asks_.end()) return false;
    auto& level = level_it->second;
    auto pos = std::find_if(level.begin(), level.end(),
                             [&](const Order& o) { return o.id == id; });
    if (pos == level.end()) return false;
    level.erase(pos);
    if (level.empty()) asks_.erase(level_it);
  }

  locations_.erase(it);
  return true;
}

bool OrderBook::fill(OrderId id, Quantity qty) {
  auto it = locations_.find(id);
  if (it == locations_.end()) return false;
  const auto [side, price] = it->second;

  if (side == Side::Buy) {
    auto level_it = bids_.find(price);
    if (level_it == bids_.end()) return false;
    auto& level = level_it->second;
    auto pos = std::find_if(level.begin(), level.end(),
                             [&](const Order& o) { return o.id == id; });
    if (pos == level.end()) return false;
    if (qty <= 0 || qty > pos->remaining_quantity) {
      throw std::invalid_argument("fill quantity out of range");
    }
    pos->remaining_quantity -= qty;
    if (pos->remaining_quantity == 0) {
      level.erase(pos);
      if (level.empty()) bids_.erase(level_it);
      locations_.erase(it);
    }
  } else {
    auto level_it = asks_.find(price);
    if (level_it == asks_.end()) return false;
    auto& level = level_it->second;
    auto pos = std::find_if(level.begin(), level.end(),
                             [&](const Order& o) { return o.id == id; });
    if (pos == level.end()) return false;
    if (qty <= 0 || qty > pos->remaining_quantity) {
      throw std::invalid_argument("fill quantity out of range");
    }
    pos->remaining_quantity -= qty;
    if (pos->remaining_quantity == 0) {
      level.erase(pos);
      if (level.empty()) asks_.erase(level_it);
      locations_.erase(it);
    }
  }

  return true;
}

std::optional<Order> OrderBook::best_bid() const { return best_of(bids_); }
std::optional<Order> OrderBook::best_ask() const { return best_of(asks_); }

bool OrderBook::empty() const { return bids_.empty() && asks_.empty(); }

std::size_t OrderBook::bid_count() const { return order_count(bids_); }
std::size_t OrderBook::ask_count() const { return order_count(asks_); }

Quantity OrderBook::quantity_at(Side side, Price price) const {
  const auto sum_level = [](const Level& level) {
    Quantity total = 0;
    for (const auto& o : level) total += o.remaining_quantity;
    return total;
  };

  if (side == Side::Buy) {
    auto it = bids_.find(price);
    return it == bids_.end() ? 0 : sum_level(it->second);
  } else {
    auto it = asks_.find(price);
    return it == asks_.end() ? 0 : sum_level(it->second);
  }
}

} // namespace gasx
