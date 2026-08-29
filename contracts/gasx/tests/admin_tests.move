#[test_only]
module gasx::admin_tests {
    use sui::test_scenario::{Self as ts};
    use gasx::admin::{Self, AdminCap};

    const ADMIN: address = @0xA1;
    const NEW_ADMIN: address = @0xA2;

    #[test]
    fun transfer_admin_moves_capability_to_new_owner() {
        let mut scenario = ts::begin(ADMIN);
        {
            let cap = admin::issue_for_testing(ts::ctx(&mut scenario));
            admin::transfer_admin(cap, NEW_ADMIN);
        };

        ts::next_tx(&mut scenario, NEW_ADMIN);
        {
            // The cap is now owned by NEW_ADMIN and can be taken from their
            // inventory; this would abort if ownership had not transferred.
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            ts::return_to_sender(&scenario, cap);
        };

        ts::end(scenario);
    }
}
