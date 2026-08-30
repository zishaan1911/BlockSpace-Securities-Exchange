// Cross-runtime parity tests between this C++ engine and the on-chain
// Move contracts in contracts/gasx.
//
// There's no bridge that lets a single test process call both Sui Move
// and this C++ code, so "integration" here means something narrower but
// still real: the exact same numeric scenarios that contracts/gasx's
// Move test suite verifies on-chain are reproduced here, with the exact
// same expected numbers, hard-coded from those tests (file:test noted on
// each one). If someone changes a formula on one side without updating
// the other, this file is what catches the drift.
//
// This deliberately does NOT reimplement gasx::settlement as a C++
// module — settlement is intentionally chain-only per ARCHITECTURE.md
// §16 (the C++ side is "not authoritative"). The payout-capping formula
// below is inlined just for this test, to check that the risk primitives
// this engine already exposes (risk::compute_pnl) would feed that Move
// logic the same numbers the chain actually produced.

#include <gtest/gtest.h>

#include <algorithm>

#include "gasx/inventory_tracker.hpp"
#include "gasx/matching_engine.hpp"
#include "gasx/risk.hpp"

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

// Shared scenario constants, copied verbatim from
// contracts/gasx/tests/settlement_tests.move.
constexpr Price kBuyPrice = 500;
constexpr Price kSellPrice = 480; // trade executes here (ask/maker price)
constexpr Quantity kQuantity = 5;
constexpr std::int64_t kContractMultiplier = 1;
constexpr std::int64_t kMarginRatioBps = 1'000; // 10%
constexpr Price kSettlementPrice = 600;

// Mirrors gasx::settlement::claim's payout cap (Move,
// contracts/gasx/sources/settlement.move): a winner gets their own
// committed margin plus PnL capped at the other side's committed margin;
// a loser gets their own committed margin minus PnL floored at zero. Not
// a production C++ module — settlement is chain-only — just inlined here
// to check the numbers agree.
Price capped_payout(Price committed, Price other_committed, const risk::PnlResult& pnl) {
  if (pnl.is_negative) {
    return committed - std::min(pnl.magnitude, committed);
  }
  return committed + std::min(pnl.magnitude, other_committed);
}

// Mirrors contracts/gasx/tests/risk_tests.move and the buyer/seller
// required-margin computation in
// contracts/gasx/tests/order_tests.move::match_orders_opens_positions_and_pools_escrow
// and contracts/gasx/tests/settlement_tests.move::setup_matched_trade.
TEST(MoveParity, RequiredMarginMatchesOrderPlacementInMoveTests) {
  const Price buyer_required =
      risk::required_margin(kBuyPrice, kQuantity, kContractMultiplier, kMarginRatioBps);
  const Price seller_required =
      risk::required_margin(kSellPrice, kQuantity, kContractMultiplier, kMarginRatioBps);

  EXPECT_EQ(buyer_required, 250);
  EXPECT_EQ(seller_required, 240);
}

// Mirrors contracts/gasx/tests/order_tests.move::match_orders_opens_positions_and_pools_escrow,
// which executes at the ask (resting/maker) price when the ask rests
// first — the same convention MatchingEngine::submit uses generally.
TEST(MoveParity, MatchingEngineExecutesAtSamePriceAsMoveOrderModule) {
  OrderBook book;
  MatchingEngine engine(book);

  engine.submit(make_order(1, "seller", Side::Sell, kSellPrice, kQuantity)); // rests first
  const auto fills = engine.submit(make_order(2, "buyer", Side::Buy, kBuyPrice, kQuantity));

  ASSERT_EQ(fills.size(), 1u);
  EXPECT_EQ(fills[0].price, kSellPrice); // 480, same as the Move test
  EXPECT_EQ(fills[0].quantity, kQuantity);
  EXPECT_TRUE(book.empty()); // exact-quantity match, nothing left resting
}

// Mirrors contracts/gasx/tests/settlement_tests.move::winner_and_loser_claims_exactly_drain_the_escrow.
// Positions open at the *execution* price (480), not either trader's own
// limit price — same as gasx::order::match_orders setting
// position::open's entry_price to trade_price on both sides.
TEST(MoveParity, RealizedPnlAtSettlementMatchesMoveSettlementTest) {
  const Price entry_price = kSellPrice; // both positions open at the execution price

  const risk::PnlResult buyer_pnl =
      risk::compute_pnl(/*is_long=*/true, entry_price, kSettlementPrice, kQuantity, kContractMultiplier);
  const risk::PnlResult seller_pnl =
      risk::compute_pnl(/*is_long=*/false, entry_price, kSettlementPrice, kQuantity, kContractMultiplier);

  EXPECT_EQ(buyer_pnl.magnitude, 600);
  EXPECT_FALSE(buyer_pnl.is_negative);
  EXPECT_EQ(seller_pnl.magnitude, 600);
  EXPECT_TRUE(seller_pnl.is_negative);
}

TEST(MoveParity, CappedPayoutsMatchMoveSettlementTestExactly) {
  const Price buyer_committed = 250;
  const Price seller_committed = 240;

  const risk::PnlResult buyer_pnl =
      risk::compute_pnl(true, kSellPrice, kSettlementPrice, kQuantity, kContractMultiplier);
  const risk::PnlResult seller_pnl =
      risk::compute_pnl(false, kSellPrice, kSettlementPrice, kQuantity, kContractMultiplier);

  const Price buyer_payout = capped_payout(buyer_committed, seller_committed, buyer_pnl);
  const Price seller_payout = capped_payout(seller_committed, buyer_committed, seller_pnl);

  // contracts/gasx/tests/settlement_tests.move, lines 89-102:
  // "payout = 250 + min(600, 240) = 490" / "payout = 240 - min(600, 240) = 0"
  EXPECT_EQ(buyer_payout, 490);
  EXPECT_EQ(seller_payout, 0);
  // The escrow (buyer_committed + seller_committed) is exactly drained,
  // same as order::trade_escrow_value(&trade) == 0 after both claims in
  // the Move test.
  EXPECT_EQ(buyer_payout + seller_payout, buyer_committed + seller_committed);
}

// Full end-to-end parity check, wiring OrderBook + MatchingEngine +
// InventoryTracker + risk:: together to reproduce the entire Phase 1
// trade lifecycle from contracts/gasx/tests/settlement_tests.move in one
// place: place two orders, match them, track the resulting positions,
// settle, and confirm the same final numbers the chain produced.
TEST(MoveParity, FullTradeLifecycleMatchesMoveEndToEnd) {
  // 1. Required margin at order placement (order.move::place_order).
  const Price buyer_required =
      risk::required_margin(kBuyPrice, kQuantity, kContractMultiplier, kMarginRatioBps);
  const Price seller_required =
      risk::required_margin(kSellPrice, kQuantity, kContractMultiplier, kMarginRatioBps);
  ASSERT_EQ(buyer_required, 250);
  ASSERT_EQ(seller_required, 240);

  // 2. Matching (order.move::match_orders).
  OrderBook book;
  MatchingEngine engine(book);
  engine.submit(make_order(1, "seller", Side::Sell, kSellPrice, kQuantity));
  const auto fills = engine.submit(make_order(2, "buyer", Side::Buy, kBuyPrice, kQuantity));
  ASSERT_EQ(fills.size(), 1u);
  const Fill& fill = fills[0];
  ASSERT_EQ(fill.price, kSellPrice);

  // 3. Position tracking from the fill (position.move::open, via
  // InventoryTracker as the C++ analogue).
  InventoryTracker buyer_position;
  InventoryTracker seller_position;
  buyer_position.apply_fill(Side::Buy, fill.price, fill.quantity);
  seller_position.apply_fill(Side::Sell, fill.price, fill.quantity);
  ASSERT_EQ(buyer_position.net_position(), kQuantity);
  ASSERT_EQ(seller_position.net_position(), -kQuantity);
  ASSERT_EQ(buyer_position.average_entry_price(), kSellPrice);
  ASSERT_EQ(seller_position.average_entry_price(), kSellPrice);

  // 4. Settlement PnL (settlement.move::claim's compute_pnl call).
  const risk::PnlResult buyer_pnl = buyer_position.apply_fill(Side::Sell, kSettlementPrice, kQuantity);
  const risk::PnlResult seller_pnl = seller_position.apply_fill(Side::Buy, kSettlementPrice, kQuantity);
  ASSERT_EQ(buyer_position.net_position(), 0);
  ASSERT_EQ(seller_position.net_position(), 0);

  // 5. Payout capping (settlement.move::claim's payout formula).
  const Price buyer_payout = capped_payout(buyer_required, seller_required, buyer_pnl);
  const Price seller_payout = capped_payout(seller_required, buyer_required, seller_pnl);

  EXPECT_EQ(buyer_payout, 490);
  EXPECT_EQ(seller_payout, 0);
  EXPECT_EQ(buyer_payout + seller_payout, buyer_required + seller_required);
}

} // namespace
} // namespace gasx
