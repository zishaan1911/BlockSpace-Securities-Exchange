#[test_only]
module gasx::market_tests {
    use std::string;
    use sui::object;
    use sui::test_scenario::{Self as ts};
    use gasx::admin;
    use gasx::market::{Self, Market};

    const ADMIN: address = @0xA1;

    fun dummy_oracle_id(ctx: &mut sui::tx_context::TxContext): object::ID {
        let uid = object::new(ctx);
        let id = object::uid_to_inner(&uid);
        object::delete(uid);
        id
    }

    #[test]
    fun new_market_is_unpaused_and_unsettled() {
        let mut scenario = ts::begin(ADMIN);
        let oracle_id = dummy_oracle_id(ts::ctx(&mut scenario));
        let market = market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), 10_000, 1, 1, 1_000, oracle_id, ts::ctx(&mut scenario),
        );

        assert!(!market::is_paused(&market), 0);
        assert!(!market::is_settled(&market), 1);
        assert!(market::margin_ratio_bps(&market) == 1_000, 2);

        market::share_for_testing(market);
        ts::end(scenario);
    }

    #[test]
    fun admin_can_pause_and_unpause() {
        let mut scenario = ts::begin(ADMIN);
        let oracle_id = dummy_oracle_id(ts::ctx(&mut scenario));
        let cap = admin::issue_for_testing(ts::ctx(&mut scenario));
        let mut market = market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), 10_000, 1, 1, 1_000, oracle_id, ts::ctx(&mut scenario),
        );

        market::pause(&cap, &mut market);
        assert!(market::is_paused(&market), 0);

        market::unpause(&cap, &mut market);
        assert!(!market::is_paused(&market), 1);

        sui::transfer::public_transfer(cap, ADMIN);
        market::share_for_testing(market);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun settlement_price_unavailable_before_settlement() {
        let mut scenario = ts::begin(ADMIN);
        let oracle_id = dummy_oracle_id(ts::ctx(&mut scenario));
        let market = market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), 10_000, 1, 1, 1_000, oracle_id, ts::ctx(&mut scenario),
        );

        let _ = market::settlement_price(&market);

        market::share_for_testing(market);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun cannot_unpause_a_settled_market() {
        let mut scenario = ts::begin(ADMIN);
        let oracle_id = dummy_oracle_id(ts::ctx(&mut scenario));
        let cap = admin::issue_for_testing(ts::ctx(&mut scenario));
        let mut market = market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), 10_000, 1, 1, 1_000, oracle_id, ts::ctx(&mut scenario),
        );

        market::mark_settled(&mut market, 512);
        market::unpause(&cap, &mut market);

        sui::transfer::public_transfer(cap, ADMIN);
        market::share_for_testing(market);
        ts::end(scenario);
    }
}
