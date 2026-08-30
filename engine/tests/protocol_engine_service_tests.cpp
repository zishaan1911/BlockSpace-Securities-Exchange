#include <gtest/gtest.h>

#include "gasx/protocol/engine_service.hpp"

namespace gasx {
namespace {

RiskLimits make_risk_limits() {
  RiskLimits limits;
  limits.contract_multiplier = 1;
  limits.margin_ratio_bps = 1'000; // 10%
  limits.max_order_quantity = 100;
  limits.max_net_position = 1'000;
  return limits;
}

protocol::PlaceOrderRequest make_place_request(TraderId trader, Side side, Price price,
                                                Quantity quantity, Price available_margin) {
  protocol::PlaceOrderRequest request;
  request.trader_id = std::move(trader);
  request.side = side;
  request.price = price;
  request.quantity = quantity;
  request.available_margin = available_margin;
  return request;
}

ModelQuoteInput make_model_input(double confidence) {
  ModelQuoteInput input;
  input.market = "EGSI-1H";
  input.expected_value = 441.2;
  input.volatility = 69.4;
  input.confidence = confidence;
  input.tail_probability = 0.21;
  input.model_version = "egsi-v1";
  return input;
}

TEST(EngineService, PlaceOrderAcceptsWithinLimitsAndReturnsOrderId) {
  EngineService service(make_risk_limits(), PricingConfig{});

  // notional = 500 * 5 = 2500, required_margin = 250 at 10%.
  const auto response = service.place_order(make_place_request("alice", Side::Buy, 500, 5, 1'000));

  EXPECT_EQ(response.status, protocol::PlaceOrderStatus::Accepted);
  EXPECT_EQ(response.order_id, 1u);
  EXPECT_TRUE(response.fills.empty());
  EXPECT_TRUE(response.reject_reason.empty());
}

TEST(EngineService, PlaceOrderRejectsInsufficientMargin) {
  EngineService service(make_risk_limits(), PricingConfig{});

  // notional = 500 * 5 = 2500, required_margin = 250 at 10% — 100 is short.
  const auto response = service.place_order(make_place_request("alice", Side::Buy, 500, 5, 100));

  EXPECT_EQ(response.status, protocol::PlaceOrderStatus::RejectedRisk);
  EXPECT_EQ(response.order_id, 0u);
  EXPECT_TRUE(response.fills.empty());
  EXPECT_FALSE(response.reject_reason.empty());

  // No book mutation on rejection.
  const auto snapshot = service.get_book_snapshot();
  EXPECT_FALSE(snapshot.snapshot.best_bid.has_value());
  EXPECT_FALSE(snapshot.snapshot.best_ask.has_value());
}

TEST(EngineService, PlaceOrderMatchesAgainstRestingOrderAndReturnsFills) {
  EngineService service(make_risk_limits(), PricingConfig{});

  service.place_order(make_place_request("alice", Side::Sell, 480, 5, 1'000));
  const auto response = service.place_order(make_place_request("bob", Side::Buy, 500, 5, 1'000));

  EXPECT_EQ(response.status, protocol::PlaceOrderStatus::Accepted);
  ASSERT_EQ(response.fills.size(), 1u);
  EXPECT_EQ(response.fills[0].price, 480); // executes at the resting (maker) price
  EXPECT_EQ(response.fills[0].quantity, 5);
  EXPECT_EQ(response.fills[0].resting_trader_id, "alice");
  EXPECT_EQ(response.fills[0].incoming_trader_id, "bob");
}

TEST(EngineService, FillsUpdateInventoryForBothPartiesCorrectly) {
  EngineService service(make_risk_limits(), PricingConfig{});

  service.place_order(make_place_request("alice", Side::Sell, 480, 5, 1'000));
  service.place_order(make_place_request("bob", Side::Buy, 500, 5, 1'000));

  EXPECT_EQ(service.net_position("bob"), 5);    // incoming buyer, now net long
  EXPECT_EQ(service.net_position("alice"), -5); // resting seller, now net short
}

TEST(EngineService, CancelOrderRemovesFromBook) {
  EngineService service(make_risk_limits(), PricingConfig{});

  const auto placed = service.place_order(make_place_request("alice", Side::Sell, 500, 5, 1'000));
  ASSERT_EQ(placed.status, protocol::PlaceOrderStatus::Accepted);

  protocol::CancelOrderRequest cancel_request;
  cancel_request.order_id = placed.order_id;
  const auto cancel_response = service.cancel_order(cancel_request);

  EXPECT_TRUE(cancel_response.cancelled);
  const auto snapshot = service.get_book_snapshot();
  EXPECT_FALSE(snapshot.snapshot.best_ask.has_value());
}

TEST(EngineService, CancelNonexistentOrderReturnsFalse) {
  EngineService service(make_risk_limits(), PricingConfig{});

  protocol::CancelOrderRequest cancel_request;
  cancel_request.order_id = 999;
  const auto cancel_response = service.cancel_order(cancel_request);

  EXPECT_FALSE(cancel_response.cancelled);
}

TEST(EngineService, GetBookSnapshotReflectsRestingOrders) {
  EngineService service(make_risk_limits(), PricingConfig{});

  service.place_order(make_place_request("alice", Side::Sell, 500, 5, 1'000));

  const auto snapshot = service.get_book_snapshot();
  ASSERT_TRUE(snapshot.snapshot.best_ask.has_value());
  EXPECT_EQ(snapshot.snapshot.best_ask->price, 500);
  EXPECT_EQ(snapshot.snapshot.best_ask->trader_id, "alice");
  EXPECT_FALSE(snapshot.snapshot.best_bid.has_value());
}

TEST(EngineService, GetQuoteRefusesBelowMinConfidence) {
  PricingConfig config;
  config.min_confidence = 0.4;
  EngineService service(make_risk_limits(), config);

  protocol::GetQuoteRequest request;
  request.model_input = make_model_input(0.2);
  const auto response = service.get_quote(request);

  EXPECT_FALSE(response.has_quote);
}

TEST(EngineService, GetQuoteReflectsSuppliedNetPositionSkew) {
  PricingConfig config;
  config.inventory_skew_per_unit = 5;
  EngineService service(make_risk_limits(), config);

  protocol::GetQuoteRequest flat_request;
  flat_request.model_input = make_model_input(0.9);
  flat_request.net_position = 0;
  const auto flat = service.get_quote(flat_request);

  protocol::GetQuoteRequest long_request;
  long_request.model_input = make_model_input(0.9);
  long_request.net_position = 10;
  const auto long_position = service.get_quote(long_request);

  ASSERT_TRUE(flat.has_quote);
  ASSERT_TRUE(long_position.has_quote);
  // Long 10 units * 5 ticks/unit = 50 ticks skewed down (toward flat).
  EXPECT_EQ(long_position.quote.bid, flat.quote.bid - 50);
  EXPECT_EQ(long_position.quote.ask, flat.quote.ask - 50);
}

TEST(EngineService, NetPositionForUnseenTraderIsZero) {
  EngineService service(make_risk_limits(), PricingConfig{});

  EXPECT_EQ(service.net_position("nobody"), 0);
}

} // namespace
} // namespace gasx
