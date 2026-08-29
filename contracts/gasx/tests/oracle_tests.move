#[test_only]
module gasx::oracle_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self};
    use gasx::admin;
    use gasx::oracle;

    const ADMIN: address = @0xA1;
    const PUBLISHER: address = @0xB1;
    const OTHER_PUBLISHER: address = @0xB2;
    const STRANGER: address = @0xC1;

    #[test]
    fun publisher_can_update_price_and_is_fresh_immediately_after() {
        let mut scenario = ts::begin(ADMIN);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);

        let cap = admin::issue_for_testing(ts::ctx(&mut scenario));
        let mut oracle = oracle::create_oracle_for_testing(PUBLISHER, 5_000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            oracle::update_price(&mut oracle, 512, &clock, ts::ctx(&mut scenario));
        };

        assert!(oracle::price(&oracle) == 512, 0);
        assert!(oracle::last_update_ms(&oracle) == 1_000, 1);
        assert!(oracle::is_fresh(&oracle, &clock), 2);

        oracle::share_for_testing(oracle);
        sui::transfer::public_transfer(cap, ADMIN);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun non_publisher_cannot_update_price() {
        let mut scenario = ts::begin(ADMIN);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let mut oracle = oracle::create_oracle_for_testing(PUBLISHER, 5_000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, STRANGER);
        {
            oracle::update_price(&mut oracle, 512, &clock, ts::ctx(&mut scenario));
        };

        oracle::share_for_testing(oracle);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun admin_can_rotate_publisher() {
        let mut scenario = ts::begin(ADMIN);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let cap = admin::issue_for_testing(ts::ctx(&mut scenario));
        let mut oracle = oracle::create_oracle_for_testing(PUBLISHER, 5_000, ts::ctx(&mut scenario));

        oracle::set_publisher(&cap, &mut oracle, OTHER_PUBLISHER);
        assert!(oracle::publisher(&oracle) == OTHER_PUBLISHER, 0);

        ts::next_tx(&mut scenario, OTHER_PUBLISHER);
        {
            oracle::update_price(&mut oracle, 777, &clock, ts::ctx(&mut scenario));
        };
        assert!(oracle::price(&oracle) == 777, 1);

        oracle::share_for_testing(oracle);
        sui::transfer::public_transfer(cap, ADMIN);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun price_becomes_stale_after_max_staleness_elapses() {
        let mut scenario = ts::begin(ADMIN);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 0);

        let mut oracle = oracle::create_oracle_for_testing(PUBLISHER, 1_000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, PUBLISHER);
        {
            oracle::update_price(&mut oracle, 500, &clock, ts::ctx(&mut scenario));
        };
        assert!(oracle::is_fresh(&oracle, &clock), 0);

        clock::set_for_testing(&mut clock, 1_001);
        assert!(!oracle::is_fresh(&oracle, &clock), 1);

        oracle::share_for_testing(oracle);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun never_published_oracle_is_not_fresh() {
        let mut scenario = ts::begin(ADMIN);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let oracle = oracle::create_oracle_for_testing(PUBLISHER, 5_000, ts::ctx(&mut scenario));

        assert!(!oracle::is_fresh(&oracle, &clock), 0);

        oracle::share_for_testing(oracle);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
