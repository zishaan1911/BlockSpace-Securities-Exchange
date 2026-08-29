#include <gtest/gtest.h>

#include "gasx/pre_trade_risk.hpp"

namespace gasx {
namespace {

Order make_order(Side side, Price price, Quantity qty) {
  Order o;
  o.id = 1;
  o.trader_id = "alice";
  o.side = side;
  o.price = price;
  o.original_quantity = qty;
  return o;
}

TEST(PreTradeRisk, AcceptsOrderWithinAllLimits) {
  RiskLimits limits;
  limits.contract_multiplier = 1;
  limits.margin_ratio_bps = 1'000; // 10%
  limits.max_order_quantity = 100;
  limits.max_net_position = 100;
  PreTradeRisk risk(limits);

  AccountState account;
  account.available_margin = 1'000;
  account.current_position = 0;

  const RiskResult result = risk.check(make_order(Side::Buy, 500, 5), account);

  EXPECT_TRUE(result.accepted());
  EXPECT_TRUE(result.reason.empty());
}

TEST(PreTradeRisk, RejectsOrderExceedingMaxOrderQuantity) {
  RiskLimits limits;
  limits.max_order_quantity = 3;
  PreTradeRisk risk(limits);

  AccountState account;
  account.available_margin = 1'000'000;

  const RiskResult result = risk.check(make_order(Side::Buy, 500, 5), account);

  EXPECT_FALSE(result.accepted());
  EXPECT_EQ(result.reason, "order quantity exceeds max_order_quantity");
}

TEST(PreTradeRisk, ZeroMaxOrderQuantityMeansUnlimited) {
  RiskLimits limits;
  limits.max_order_quantity = 0;
  PreTradeRisk risk(limits);

  AccountState account;
  // Large enough to cover required_margin for this order regardless of
  // size, so this test isolates the max_order_quantity check rather than
  // accidentally tripping the margin-sufficiency check instead.
  account.available_margin = 1'000'000'000'000;

  EXPECT_TRUE(risk.check(make_order(Side::Buy, 500, 1'000'000), account).accepted());
}

TEST(PreTradeRisk, RejectsBuyThatWouldExceedMaxNetPosition) {
  RiskLimits limits;
  limits.max_net_position = 10;
  PreTradeRisk risk(limits);

  AccountState account;
  account.available_margin = 1'000'000;
  account.current_position = 8; // already net long 8

  const RiskResult result = risk.check(make_order(Side::Buy, 500, 5), account); // 8 + 5 = 13 > 10

  EXPECT_FALSE(result.accepted());
  EXPECT_EQ(result.reason, "order would exceed max_net_position");
}

TEST(PreTradeRisk, RejectsSellThatWouldExceedMaxNetPositionOnShortSide) {
  RiskLimits limits;
  limits.max_net_position = 10;
  PreTradeRisk risk(limits);

  AccountState account;
  account.available_margin = 1'000'000;
  account.current_position = -8; // already net short 8

  const RiskResult result = risk.check(make_order(Side::Sell, 500, 5), account); // -8 - 5 = -13

  EXPECT_FALSE(result.accepted());
  EXPECT_EQ(result.reason, "order would exceed max_net_position");
}

TEST(PreTradeRisk, SellThatReducesPositionTowardZeroIsAccepted) {
  RiskLimits limits;
  limits.max_net_position = 10;
  PreTradeRisk risk(limits);

  AccountState account;
  account.available_margin = 1'000'000;
  account.current_position = 8;

  // Selling reduces the long position (8 - 5 = 3), well within the limit,
  // even though the account is already near it.
  EXPECT_TRUE(risk.check(make_order(Side::Sell, 500, 5), account).accepted());
}

TEST(PreTradeRisk, RejectsOrderWithInsufficientMargin) {
  RiskLimits limits;
  limits.contract_multiplier = 1;
  limits.margin_ratio_bps = 1'000; // 10%
  PreTradeRisk risk(limits);

  AccountState account;
  account.available_margin = 10; // required = 500*5*1*10% = 250

  const RiskResult result = risk.check(make_order(Side::Buy, 500, 5), account);

  EXPECT_FALSE(result.accepted());
  EXPECT_EQ(result.reason, "insufficient available margin");
}

TEST(PreTradeRisk, AcceptsWhenMarginExactlyMeetsRequirement) {
  RiskLimits limits;
  limits.contract_multiplier = 1;
  limits.margin_ratio_bps = 1'000; // 10%
  PreTradeRisk risk(limits);

  AccountState account;
  account.available_margin = 250; // exactly required = 500*5*1*10%

  EXPECT_TRUE(risk.check(make_order(Side::Buy, 500, 5), account).accepted());
}

} // namespace
} // namespace gasx
