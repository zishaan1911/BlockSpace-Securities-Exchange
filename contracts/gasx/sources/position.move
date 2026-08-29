/// A trader's open exposure in one market (ARCHITECTURE.md §12). One
/// `Position` per trader per market: a matching trade on the same side
/// grows it (volume-weighted entry price), a matching trade on the
/// opposite side realizes PnL and shrinks it.
///
/// Every mutating function here is `public(package)` — a `Position` is only
/// ever created or changed as a side effect of `order::match_orders` or
/// `settlement::settle_position`, never called directly by a trader or by
/// admin.
module gasx::position {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::TxContext;
    use gasx::risk;

    const E_WRONG_DIRECTION: u64 = 0;
    const E_REDUCE_EXCEEDS_QUANTITY: u64 = 1;
    const E_NOT_EMPTY: u64 = 2;

    public struct Position has key, store {
        id: UID,
        owner: address,
        market_id: ID,
        is_long: bool,
        quantity: u64,
        /// Volume-weighted average entry price across all fills.
        entry_price: u64,
    }

    public(package) fun open(
        owner: address,
        market_id: ID,
        is_long: bool,
        quantity: u64,
        entry_price: u64,
        ctx: &mut TxContext,
    ): Position {
        Position { id: object::new(ctx), owner, market_id, is_long, quantity, entry_price }
    }

    /// Add `additional_quantity` filled at `trade_price` to an existing
    /// position on the same side, recomputing the volume-weighted average
    /// entry price.
    public(package) fun increase(position: &mut Position, additional_quantity: u64, is_long: bool, trade_price: u64) {
        assert!(position.is_long == is_long, E_WRONG_DIRECTION);

        let existing_notional = (position.entry_price as u128) * (position.quantity as u128);
        let added_notional = (trade_price as u128) * (additional_quantity as u128);
        let new_quantity = position.quantity + additional_quantity;

        position.entry_price = (((existing_notional + added_notional) / (new_quantity as u128)) as u64);
        position.quantity = new_quantity;
    }

    /// Reduce the position by `reduce_quantity`, realizing PnL on that
    /// portion at `exit_price`. Returns (pnl_magnitude, pnl_is_negative).
    /// Does not change `entry_price` — the remaining quantity keeps the
    /// same average entry price.
    public(package) fun reduce(
        position: &mut Position,
        reduce_quantity: u64,
        exit_price: u64,
        contract_multiplier: u64,
    ): (u64, bool) {
        assert!(reduce_quantity <= position.quantity, E_REDUCE_EXCEEDS_QUANTITY);

        let (magnitude, is_negative) = risk::compute_pnl(
            position.is_long, position.entry_price, exit_price, reduce_quantity, contract_multiplier,
        );
        position.quantity = position.quantity - reduce_quantity;
        (magnitude, is_negative)
    }

    /// Destroy a fully-closed (`quantity == 0`) position object.
    public(package) fun destroy_empty(position: Position) {
        let Position { id, owner: _, market_id: _, is_long: _, quantity, entry_price: _ } = position;
        assert!(quantity == 0, E_NOT_EMPTY);
        object::delete(id);
    }

    public fun owner(position: &Position): address {
        position.owner
    }

    public fun market_id(position: &Position): ID {
        position.market_id
    }

    public fun is_long(position: &Position): bool {
        position.is_long
    }

    public fun quantity(position: &Position): u64 {
        position.quantity
    }

    public fun entry_price(position: &Position): u64 {
        position.entry_price
    }

    #[test_only]
    /// Force-destroy a position for test cleanup, bypassing the
    /// quantity == 0 check that `destroy_empty` enforces.
    public fun destroy_for_testing(position: Position) {
        let Position { id, owner: _, market_id: _, is_long: _, quantity: _, entry_price: _ } = position;
        object::delete(id);
    }

    #[test_only]
    public fun open_for_testing(
        owner: address,
        market_id: ID,
        is_long: bool,
        quantity: u64,
        entry_price: u64,
        ctx: &mut TxContext,
    ): Position {
        open(owner, market_id, is_long, quantity, entry_price, ctx)
    }
}
