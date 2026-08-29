#[test_only]
module gasx::order_tests {
    use std::string;
    use sui::object;
    use sui::test_scenario::{Self as ts};
    use sui::balance;
    use sui::sui::SUI;
    use gasx::market;
    use gasx::margin;
    use gasx::order;
    use gasx::position;
    use gasx::risk;

    const ADMIN: address = @0xA1;
    const BUYER: address = @0xF1;
    const SELLER: address = @0xF2;

    fun dummy_oracle_id(ctx: &mut sui::tx_context::TxContext): object::ID {
        let uid = object::new(ctx);
        let id = object::uid_to_inner(&uid);
        object::delete(uid);
        id
    }

    /// contract_multiplier = 1, tick_size = 1, margin_ratio_bps = 1_000 (10%)
    fun new_test_market(ctx: &mut sui::tx_context::TxContext): market::Market {
        let oracle_id = dummy_oracle_id(ctx);
        market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), 10_000, 1, 1, 1_000, oracle_id, ctx,
        )
    }

    #[test]
    fun place_order_locks_required_margin() {
        let mut scenario = ts::begin(ADMIN);
        let market = new_test_market(ts::ctx(&mut scenario));
        let mut buyer_margin = margin::open_account_for_testing<SUI>(
            object::id(&market), BUYER, ts::ctx(&mut scenario),
        );
        margin::credit_available_for_testing(&mut buyer_margin, balance::create_for_testing<SUI>(10_000));

        ts::next_tx(&mut scenario, BUYER);
        {
            order::place_order<SUI>(&market, &mut buyer_margin, true, 500, 5, ts::ctx(&mut scenario));
        };

        let required = risk::required_margin(500, 5, market::contract_multiplier(&market), market::margin_ratio_bps(&market));
        assert!(margin::locked_balance(&buyer_margin) == required, 0);
        assert!(margin::available_balance(&buyer_margin) == 10_000 - required, 1);

        ts::next_tx(&mut scenario, BUYER);
        let placed = ts::take_shared<order::Order>(&scenario);
        assert!(order::is_open(&placed), 2);
        assert!(order::order_price(&placed) == 500, 3);
        assert!(order::order_quantity(&placed) == 5, 4);
        assert!(order::locked_margin(&placed) == required, 5);
        ts::return_shared(placed);

        sui::transfer::public_transfer(buyer_margin, BUYER);
        market::destroy_for_testing(market);
        ts::end(scenario);
    }

    #[test]
    fun cancel_order_releases_locked_margin() {
        let mut scenario = ts::begin(ADMIN);
        let market_id = object::id_from_address(@0x1);
        let mut buyer_margin = margin::open_account_for_testing<SUI>(market_id, BUYER, ts::ctx(&mut scenario));
        margin::credit_available_for_testing(&mut buyer_margin, balance::create_for_testing<SUI>(1_000));
        margin::lock(&mut buyer_margin, 250);

        let mut order_obj = order::place_order_for_testing(market_id, BUYER, true, 500, 5, 250, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, BUYER);
        order::cancel_order(&mut order_obj, &mut buyer_margin, ts::ctx(&mut scenario));

        assert!(order::is_cancelled(&order_obj), 0);
        assert!(margin::locked_balance(&buyer_margin) == 0, 1);
        assert!(margin::available_balance(&buyer_margin) == 1_000, 2);

        order::destroy_order_for_testing(order_obj);
        sui::transfer::public_transfer(buyer_margin, BUYER);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun non_owner_cannot_cancel_order() {
        let mut scenario = ts::begin(ADMIN);
        let market_id = object::id_from_address(@0x1);
        let mut buyer_margin = margin::open_account_for_testing<SUI>(market_id, BUYER, ts::ctx(&mut scenario));
        margin::credit_available_for_testing(&mut buyer_margin, balance::create_for_testing<SUI>(1_000));
        margin::lock(&mut buyer_margin, 250);
        let mut order_obj = order::place_order_for_testing(market_id, BUYER, true, 500, 5, 250, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, SELLER);
        order::cancel_order(&mut order_obj, &mut buyer_margin, ts::ctx(&mut scenario));

        order::destroy_order_for_testing(order_obj);
        sui::transfer::public_transfer(buyer_margin, BUYER);
        ts::end(scenario);
    }

    #[test]
    fun match_orders_opens_positions_and_pools_escrow() {
        let mut scenario = ts::begin(ADMIN);
        let market = new_test_market(ts::ctx(&mut scenario));
        let market_id = object::id(&market);

        let required = risk::required_margin(500, 5, market::contract_multiplier(&market), market::margin_ratio_bps(&market));

        let mut buyer_margin = margin::open_account_for_testing<SUI>(market_id, BUYER, ts::ctx(&mut scenario));
        margin::credit_available_for_testing(&mut buyer_margin, balance::create_for_testing<SUI>(10_000));
        margin::lock(&mut buyer_margin, required);

        let mut seller_margin = margin::open_account_for_testing<SUI>(market_id, SELLER, ts::ctx(&mut scenario));
        margin::credit_available_for_testing(&mut seller_margin, balance::create_for_testing<SUI>(10_000));
        margin::lock(&mut seller_margin, required);

        let mut buy_order = order::place_order_for_testing(market_id, BUYER, true, 500, 5, required, ts::ctx(&mut scenario));
        let mut sell_order = order::place_order_for_testing(market_id, SELLER, false, 480, 5, required, ts::ctx(&mut scenario));

        order::match_orders<SUI>(
            &market, &mut buy_order, &mut sell_order, &mut buyer_margin, &mut seller_margin, ts::ctx(&mut scenario),
        );

        assert!(order::is_filled(&buy_order), 0);
        assert!(order::is_filled(&sell_order), 1);
        assert!(margin::locked_balance(&buyer_margin) == 0, 2);
        assert!(margin::locked_balance(&seller_margin) == 0, 3);

        ts::next_tx(&mut scenario, BUYER);
        {
            let trade = ts::take_shared<order::Trade<SUI>>(&scenario);
            assert!(order::trade_buyer_committed(&trade) == required, 4);
            assert!(order::trade_seller_committed(&trade) == required, 5);
            assert!(order::trade_escrow_value(&trade) == required * 2, 6);
            assert!(order::trade_buyer(&trade) == BUYER, 7);
            assert!(order::trade_seller(&trade) == SELLER, 8);
            ts::return_shared(trade);

            let buyer_position = ts::take_from_address<position::Position>(&scenario, BUYER);
            assert!(position::is_long(&buyer_position), 9);
            assert!(position::quantity(&buyer_position) == 5, 10);
            // Executes at the ask (resting/maker) price, per module docs.
            assert!(position::entry_price(&buyer_position) == 480, 11);
            position::destroy_for_testing(buyer_position);

            let seller_position = ts::take_from_address<position::Position>(&scenario, SELLER);
            assert!(!position::is_long(&seller_position), 12);
            assert!(position::quantity(&seller_position) == 5, 13);
            position::destroy_for_testing(seller_position);
        };

        order::destroy_order_for_testing(buy_order);
        order::destroy_order_for_testing(sell_order);
        sui::transfer::public_transfer(buyer_margin, BUYER);
        sui::transfer::public_transfer(seller_margin, SELLER);
        market::destroy_for_testing(market);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun match_orders_rejects_non_crossing_prices() {
        let mut scenario = ts::begin(ADMIN);
        let market = new_test_market(ts::ctx(&mut scenario));
        let market_id = object::id(&market);
        let required = risk::required_margin(400, 5, 1, 1_000);

        let mut buyer_margin = margin::open_account_for_testing<SUI>(market_id, BUYER, ts::ctx(&mut scenario));
        margin::credit_available_for_testing(&mut buyer_margin, balance::create_for_testing<SUI>(10_000));
        margin::lock(&mut buyer_margin, required);
        let mut seller_margin = margin::open_account_for_testing<SUI>(market_id, SELLER, ts::ctx(&mut scenario));
        margin::credit_available_for_testing(&mut seller_margin, balance::create_for_testing<SUI>(10_000));
        margin::lock(&mut seller_margin, required);

        // Bid below ask: does not cross.
        let mut buy_order = order::place_order_for_testing(market_id, BUYER, true, 400, 5, required, ts::ctx(&mut scenario));
        let mut sell_order = order::place_order_for_testing(market_id, SELLER, false, 480, 5, required, ts::ctx(&mut scenario));

        order::match_orders<SUI>(
            &market, &mut buy_order, &mut sell_order, &mut buyer_margin, &mut seller_margin, ts::ctx(&mut scenario),
        );

        order::destroy_order_for_testing(buy_order);
        order::destroy_order_for_testing(sell_order);
        sui::transfer::public_transfer(buyer_margin, BUYER);
        sui::transfer::public_transfer(seller_margin, SELLER);
        market::destroy_for_testing(market);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun match_orders_rejects_self_trade() {
        let mut scenario = ts::begin(ADMIN);
        let market = new_test_market(ts::ctx(&mut scenario));
        let market_id = object::id(&market);
        let required = risk::required_margin(500, 5, 1, 1_000);

        // Two distinct margin account objects, both owned by BUYER — Move's
        // borrow checker forbids passing &mut of the *same* local twice
        // into one call, so self-trade rejection is exercised via two
        // accounts sharing an owner rather than one account used twice.
        let mut buyer_side_margin = margin::open_account_for_testing<SUI>(market_id, BUYER, ts::ctx(&mut scenario));
        margin::credit_available_for_testing(&mut buyer_side_margin, balance::create_for_testing<SUI>(10_000));
        margin::lock(&mut buyer_side_margin, required);
        let mut seller_side_margin = margin::open_account_for_testing<SUI>(market_id, BUYER, ts::ctx(&mut scenario));
        margin::credit_available_for_testing(&mut seller_side_margin, balance::create_for_testing<SUI>(10_000));
        margin::lock(&mut seller_side_margin, required);

        let mut buy_order = order::place_order_for_testing(market_id, BUYER, true, 500, 5, required, ts::ctx(&mut scenario));
        let mut sell_order = order::place_order_for_testing(market_id, BUYER, false, 480, 5, required, ts::ctx(&mut scenario));

        order::match_orders<SUI>(
            &market, &mut buy_order, &mut sell_order, &mut buyer_side_margin, &mut seller_side_margin, ts::ctx(&mut scenario),
        );

        order::destroy_order_for_testing(buy_order);
        order::destroy_order_for_testing(sell_order);
        sui::transfer::public_transfer(buyer_side_margin, BUYER);
        sui::transfer::public_transfer(seller_side_margin, BUYER);
        market::destroy_for_testing(market);
        ts::end(scenario);
    }
}
