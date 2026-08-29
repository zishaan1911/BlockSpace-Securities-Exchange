/// Narrowly-scoped admin authority for GASX (ARCHITECTURE.md §38).
///
/// `AdminCap` gates market pause/unpause, risk-parameter updates, and
/// oracle-publisher rotation. It intentionally cannot move user funds or
/// mutate existing positions/balances — those are always authorized by the
/// owning trader, or by deterministic settlement logic.
module gasx::admin {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;

    /// Possession of this object authorizes admin-only entry functions
    /// across the `gasx` package.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Minted once, on package publish, and sent to the publisher.
    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            AdminCap { id: object::new(ctx) },
            tx_context::sender(ctx),
        );
    }

    /// Transfer admin authority to a new address (e.g. a multisig).
    public entry fun transfer_admin(cap: AdminCap, to: address) {
        transfer::transfer(cap, to);
    }

    #[test_only]
    /// Mint an `AdminCap` for use in tests. Not callable outside `#[test]`.
    public fun issue_for_testing(ctx: &mut TxContext): AdminCap {
        AdminCap { id: object::new(ctx) }
    }
}
