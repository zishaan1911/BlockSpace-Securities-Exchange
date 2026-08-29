#[test_only]
module gasx::settlement_tests {
    use std::string;
    use sui::object;
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self};
    use sui::balance;
    use sui::sui::SUI;
    use gasx::market;
    use gasx::oracle;
    use gasx::margin;
    use gasx::order;
    use gasx::position;
    use gasx::risk;
    use gasx::settlement;

    const ADMIN: address = @0xA1;
    const PUBLISHER: address = @0xB1;
    const BUYER: address = @0xF1;
    const SELLER: address = @0xF2;

    const EXPIRY_MS: u64 = 10_000;
    const BUY_PRICE: u64 = 500;
    const SELL_PRICE: u64 = 480; // trade executes here (ask price)
    const QUANTITY: u64 = 5;
    const MARGIN_RATIO_BPS: u64 = 1_000; // 10%

    /// Sets up a market, an oracle, a matched buyer/seller trade, and
    /// advances (but does not settle) a clock to expiry. Returns the
    /// pieces the caller needs to drive settlement/claims itself.
    fun setup_matched_trade(scenario: &mut ts::Scenario): (
        market::Market, oracle::OracleState, sui::clock::Clock,
        margin::MarginAccount<SUI>, margin::MarginAccount<SUI>,
        order::Order, order::Order, u64, u64,
    ) {
        let oracle_state = oracle::create_oracle_for_testing(PUBLISHER, 5_000, ts::ctx(scenario));
        let oracle_id = object::id(&oracle_state);
        let market = market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), EXPIRY_MS, 1, 1, MARGIN_RATIO_BPS, oracle_id, ts::ctx(scenario),
        );
        let market_id = object::id(&market);

        let buyer_required = risk::required_margin(BUY_PRICE, QUANTITY, 1, MARGIN_RATIO_BPS);
        let seller_required = risk::required_margin(SELL_PRICE, QUANTITY, 1, MARGIN_RATIO_BPS);

        let mut buyer_margin = margin::open_account_for_testing<SUI>(market_id, BUYER, ts::ctx(scenario));
        margin::credit_available_for_testing(&mut buyer_margin, balance::create_for_testing<SUI>(10_000));
        margin::lock(&mut buyer_margin, buyer_required);

        let mut seller_margin = margin::open_account_for_testing<SUI>(market_id, SELLER, ts::ctx(scenario));
        margin::credit_available_for_testing(&mut seller_margin, balance::create_for_testing<SUI>(10_000));
        margin::lock(&mut seller_margin, seller_required);

        let mut buy_order = order::place_order_for_testing(
            market_id, BUYER, true, BUY_PRICE, QUANTITY, buyer_required, ts::ctx(scenario),
        );
        let mut sell_order = order::place_order_for_testing(
            market_id, SELLER, false, SELL_PRICE, QUANTITY, seller_required, ts::ctx(scenario),
        );

        order::match_orders<SUI>(
            &market, &mut buy_order, &mut sell_order, &mut buyer_margin, &mut seller_margin, ts::ctx(scenario),
        );

        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, EXPIRY_MS);

        (
            market, oracle_state, clock, buyer_margin, seller_margin,
            buy_order, sell_order, buyer_required, seller_required,
        )
    }

    #[test]
    fun winner_and_loser_claims_exactly_drain_the_escrow() {
        let mut scenario = ts::begin(ADMIN);
        let (
            mut market, mut oracle_state, clock, mut buyer_margin, mut seller_margin,
            buy_order, sell_order, buyer_required, seller_required,
        ) = setup_matched_trade(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        oracle::update_price(&mut oracle_state, 600, &clock, ts::ctx(&mut scenario));

        settlement::settle_market(&mut market, &oracle_state, &clock);
        assert!(market::is_settled(&market), 0);
        assert!(market::settlement_price(&market) == 600, 1);

        // Buyer went long at 480, settles at 600: full win, capped at the
        // seller's committed margin -> payout = 250 + min(600, 240) = 490.
        ts::next_tx(&mut scenario, BUYER);
        {
            let mut trade = ts::take_shared<order::Trade<SUI>>(&scenario);
            let buyer_position = ts::take_from_address<position::Position>(&scenario, BUYER);
            settlement::claim<SUI>(&mut trade, buyer_position, &market, &mut buyer_margin, ts::ctx(&mut scenario));
            ts::return_shared(trade);
        };
        assert!(margin::available_balance(&buyer_margin) == 10_000 - buyer_required + 490, 2);
        assert!(margin::locked_balance(&buyer_margin) == 0, 3);

        // Seller went short at 480, settles at 600: full loss, floored at
        // zero -> payout = 240 - min(600, 240) = 0.
        ts::next_tx(&mut scenario, SELLER);
        {
            let mut trade = ts::take_shared<order::Trade<SUI>>(&scenario);
            let seller_position = ts::take_from_address<position::Position>(&scenario, SELLER);
            settlement::claim<SUI>(&mut trade, seller_position, &market, &mut seller_margin, ts::ctx(&mut scenario));
            assert!(order::trade_escrow_value(&trade) == 0, 4);
            ts::return_shared(trade);
        };
        assert!(margin::available_balance(&seller_margin) == 10_000 - seller_required, 5);

        order::destroy_order_for_testing(buy_order);
        order::destroy_order_for_testing(sell_order);
        sui::transfer::public_transfer(buyer_margin, BUYER);
        sui::transfer::public_transfer(seller_margin, SELLER);
        market::destroy_for_testing(market);
        oracle::destroy_for_testing(oracle_state);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun cannot_claim_twice() {
        let mut scenario = ts::begin(ADMIN);
        let (
            mut market, mut oracle_state, clock, mut buyer_margin, seller_margin,
            buy_order, sell_order, _buyer_required, _seller_required,
        ) = setup_matched_trade(&mut scenario);

        ts::next_tx(&mut scenario, PUBLISHER);
        oracle::update_price(&mut oracle_state, 600, &clock, ts::ctx(&mut scenario));
        settlement::settle_market(&mut market, &oracle_state, &clock);

        ts::next_tx(&mut scenario, BUYER);
        let mut trade = ts::take_shared<order::Trade<SUI>>(&scenario);
        let buyer_position = ts::take_from_address<position::Position>(&scenario, BUYER);
        settlement::claim<SUI>(&mut trade, buyer_position, &market, &mut buyer_margin, ts::ctx(&mut scenario));

        // The buyer's Position was consumed by the claim above, so a
        // second attempt as BUYER (still the sender in this same test
        // transaction) must be rejected purely on trade.buyer_claimed,
        // regardless of which Position object is supplied.
        assert!(order::trade_buyer_claimed(&trade), 0);
        let seller_position = ts::take_from_address<position::Position>(&scenario, SELLER);
        settlement::claim<SUI>(&mut trade, seller_position, &market, &mut buyer_margin, ts::ctx(&mut scenario));

        ts::return_shared(trade);
        order::destroy_order_for_testing(buy_order);
        order::destroy_order_for_testing(sell_order);
        sui::transfer::public_transfer(buyer_margin, BUYER);
        sui::transfer::public_transfer(seller_margin, SELLER);
        market::destroy_for_testing(market);
        oracle::destroy_for_testing(oracle_state);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun cannot_claim_before_settlement() {
        let mut scenario = ts::begin(ADMIN);
        let (
            market, oracle_state, clock, mut buyer_margin, seller_margin,
            buy_order, sell_order, _buyer_required, _seller_required,
        ) = setup_matched_trade(&mut scenario);

        ts::next_tx(&mut scenario, BUYER);
        let mut trade = ts::take_shared<order::Trade<SUI>>(&scenario);
        let buyer_position = ts::take_from_address<position::Position>(&scenario, BUYER);
        settlement::claim<SUI>(&mut trade, buyer_position, &market, &mut buyer_margin, ts::ctx(&mut scenario));

        ts::return_shared(trade);
        order::destroy_order_for_testing(buy_order);
        order::destroy_order_for_testing(sell_order);
        sui::transfer::public_transfer(buyer_margin, BUYER);
        sui::transfer::public_transfer(seller_margin, SELLER);
        market::destroy_for_testing(market);
        oracle::destroy_for_testing(oracle_state);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun settle_market_rejects_settling_before_expiry() {
        let mut scenario = ts::begin(ADMIN);
        let oracle_state = oracle::create_oracle_for_testing(PUBLISHER, 5_000, ts::ctx(&mut scenario));
        let oracle_id = object::id(&oracle_state);
        let mut market = market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), EXPIRY_MS, 1, 1, MARGIN_RATIO_BPS, oracle_id, ts::ctx(&mut scenario),
        );
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, EXPIRY_MS - 1);

        settlement::settle_market(&mut market, &oracle_state, &clock);

        market::destroy_for_testing(market);
        oracle::destroy_for_testing(oracle_state);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
