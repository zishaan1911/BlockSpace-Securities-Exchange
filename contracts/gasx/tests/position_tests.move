#[test_only]
module gasx::position_tests {
    use sui::object;
    use sui::test_scenario::{Self as ts};
    use gasx::position;

    const TRADER: address = @0xE1;

    fun dummy_market_id(ctx: &mut sui::tx_context::TxContext): object::ID {
        let uid = object::new(ctx);
        let id = object::uid_to_inner(&uid);
        object::delete(uid);
        id
    }

    #[test]
    fun open_sets_initial_fields() {
        let mut scenario = ts::begin(TRADER);
        let market_id = dummy_market_id(ts::ctx(&mut scenario));
        let position = position::open_for_testing(TRADER, market_id, true, 5, 425, ts::ctx(&mut scenario));

        assert!(position::owner(&position) == TRADER, 0);
        assert!(position::is_long(&position), 1);
        assert!(position::quantity(&position) == 5, 2);
        assert!(position::entry_price(&position) == 425, 3);

        position::destroy_for_testing(position);
        ts::end(scenario);
    }

    #[test]
    fun increase_recomputes_volume_weighted_entry_price() {
        let mut scenario = ts::begin(TRADER);
        let market_id = dummy_market_id(ts::ctx(&mut scenario));
        // 5 @ 400, then 5 @ 600 -> weighted average 500
        let mut position = position::open_for_testing(TRADER, market_id, true, 5, 400, ts::ctx(&mut scenario));
        position::increase(&mut position, 5, true, 600);

        assert!(position::quantity(&position) == 10, 0);
        assert!(position::entry_price(&position) == 500, 1);

        position::destroy_for_testing(position);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun increase_rejects_opposite_direction() {
        let mut scenario = ts::begin(TRADER);
        let market_id = dummy_market_id(ts::ctx(&mut scenario));
        let mut position = position::open_for_testing(TRADER, market_id, true, 5, 400, ts::ctx(&mut scenario));
        position::increase(&mut position, 5, false, 600);

        position::destroy_empty(position);
        ts::end(scenario);
    }

    #[test]
    fun reduce_realizes_pnl_and_keeps_entry_price_on_remainder() {
        let mut scenario = ts::begin(TRADER);
        let market_id = dummy_market_id(ts::ctx(&mut scenario));
        let mut position = position::open_for_testing(TRADER, market_id, true, 5, 425, ts::ctx(&mut scenario));

        let (magnitude, is_negative) = position::reduce(&mut position, 5, 500, 1);
        assert!(magnitude == 375, 0);
        assert!(!is_negative, 1);
        assert!(position::quantity(&position) == 0, 2);
        assert!(position::entry_price(&position) == 425, 3);

        position::destroy_empty(position);
        ts::end(scenario);
    }

    #[test]
    fun partial_reduce_leaves_remaining_quantity() {
        let mut scenario = ts::begin(TRADER);
        let market_id = dummy_market_id(ts::ctx(&mut scenario));
        let mut position = position::open_for_testing(TRADER, market_id, true, 5, 425, ts::ctx(&mut scenario));

        let (magnitude, _is_negative) = position::reduce(&mut position, 2, 500, 1);
        assert!(magnitude == 150, 0);
        assert!(position::quantity(&position) == 3, 1);

        position::destroy_for_testing(position);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun reduce_more_than_quantity_aborts() {
        let mut scenario = ts::begin(TRADER);
        let market_id = dummy_market_id(ts::ctx(&mut scenario));
        let mut position = position::open_for_testing(TRADER, market_id, true, 5, 425, ts::ctx(&mut scenario));

        let (_magnitude, _is_negative) = position::reduce(&mut position, 6, 500, 1);

        position::destroy_empty(position);
        ts::end(scenario);
    }
}
