#[test_only]
module gasx::margin_tests {
    use std::string;
    use sui::object;
    use sui::test_scenario::{Self as ts};
    use sui::coin;
    use sui::balance;
    use sui::sui::SUI;
    use gasx::market;
    use gasx::margin;

    const TRADER: address = @0xD1;
    const OTHER: address = @0xD2;

    fun dummy_oracle_id(ctx: &mut sui::tx_context::TxContext): object::ID {
        let uid = object::new(ctx);
        let id = object::uid_to_inner(&uid);
        object::delete(uid);
        id
    }

    #[test]
    fun deposit_increases_available_balance() {
        let mut scenario = ts::begin(TRADER);
        let oracle_id = dummy_oracle_id(ts::ctx(&mut scenario));
        let market = market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), 10_000, 1, 1, 1_000, oracle_id, ts::ctx(&mut scenario),
        );
        let mut account = margin::open_account_for_testing<SUI>(
            object::id(&market), TRADER, ts::ctx(&mut scenario),
        );

        let payment = coin::mint_for_testing<SUI>(1_000, ts::ctx(&mut scenario));
        margin::deposit(&mut account, &market, payment, ts::ctx(&mut scenario));

        assert!(margin::available_balance(&account) == 1_000, 0);
        assert!(margin::locked_balance(&account) == 0, 1);

        sui::transfer::public_transfer(account, TRADER);
        market::destroy_for_testing(market);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun non_owner_cannot_deposit() {
        let mut scenario = ts::begin(TRADER);
        let oracle_id = dummy_oracle_id(ts::ctx(&mut scenario));
        let market = market::create_market_for_testing(
            string::utf8(b"ETH_GAS_1H"), 10_000, 1, 1, 1_000, oracle_id, ts::ctx(&mut scenario),
        );
        let mut account = margin::open_account_for_testing<SUI>(
            object::id(&market), TRADER, ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, OTHER);
        let payment = coin::mint_for_testing<SUI>(1_000, ts::ctx(&mut scenario));
        margin::deposit(&mut account, &market, payment, ts::ctx(&mut scenario));

        sui::transfer::public_transfer(account, TRADER);
        market::destroy_for_testing(market);
        ts::end(scenario);
    }

    #[test]
    fun withdraw_decreases_available_and_returns_funded_coin() {
        let mut scenario = ts::begin(TRADER);
        let mut account = margin::open_account_for_testing<SUI>(
            object::id_from_address(@0x0), TRADER, ts::ctx(&mut scenario),
        );
        margin::credit_available_for_testing(&mut account, balance::create_for_testing<SUI>(500));

        let out = margin::withdraw(&mut account, 200, ts::ctx(&mut scenario));
        assert!(coin::value(&out) == 200, 0);
        assert!(margin::available_balance(&account) == 300, 1);

        coin::burn_for_testing(out);
        sui::transfer::public_transfer(account, TRADER);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun withdraw_fails_when_insufficient_available() {
        let mut scenario = ts::begin(TRADER);
        let mut account = margin::open_account_for_testing<SUI>(
            object::id_from_address(@0x0), TRADER, ts::ctx(&mut scenario),
        );

        let out = margin::withdraw(&mut account, 1, ts::ctx(&mut scenario));

        coin::burn_for_testing(out);
        sui::transfer::public_transfer(account, TRADER);
        ts::end(scenario);
    }

    #[test]
    fun lock_and_release_round_trip() {
        let mut scenario = ts::begin(TRADER);
        let mut account = margin::open_account_for_testing<SUI>(
            object::id_from_address(@0x0), TRADER, ts::ctx(&mut scenario),
        );
        margin::credit_available_for_testing(&mut account, balance::create_for_testing<SUI>(1_000));

        margin::lock(&mut account, 400);
        assert!(margin::available_balance(&account) == 600, 0);
        assert!(margin::locked_balance(&account) == 400, 1);

        margin::release(&mut account, 400);
        assert!(margin::available_balance(&account) == 1_000, 2);
        assert!(margin::locked_balance(&account) == 0, 3);

        sui::transfer::public_transfer(account, TRADER);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun lock_fails_when_insufficient_available() {
        let mut scenario = ts::begin(TRADER);
        let mut account = margin::open_account_for_testing<SUI>(
            object::id_from_address(@0x0), TRADER, ts::ctx(&mut scenario),
        );

        margin::lock(&mut account, 1);

        sui::transfer::public_transfer(account, TRADER);
        ts::end(scenario);
    }

    #[test]
    fun debit_from_locked_can_be_credited_to_another_account() {
        let mut scenario = ts::begin(TRADER);
        let market_id = object::id_from_address(@0x0);
        let mut loser = margin::open_account_for_testing<SUI>(market_id, TRADER, ts::ctx(&mut scenario));
        let mut winner = margin::open_account_for_testing<SUI>(market_id, OTHER, ts::ctx(&mut scenario));

        margin::credit_available_for_testing(&mut loser, balance::create_for_testing<SUI>(1_000));
        margin::lock(&mut loser, 1_000);

        let proceeds = margin::debit_from_locked(&mut loser, 375);
        margin::credit(&mut winner, proceeds);

        assert!(margin::locked_balance(&loser) == 625, 0);
        assert!(margin::available_balance(&winner) == 375, 1);

        sui::transfer::public_transfer(loser, TRADER);
        sui::transfer::public_transfer(winner, OTHER);
        ts::end(scenario);
    }
}
