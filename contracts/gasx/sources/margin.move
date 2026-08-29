/// Per-trader, per-market collateral account (ARCHITECTURE.md §12).
///
/// Collateral is generic over coin type `C` rather than hardcoded to a
/// specific USDC coin object, so the same code works against Sui testnet
/// USDC or a local test coin (see `contracts/gasx/README.md`).
///
/// Funds sit in one of two balances:
/// - `available`: withdrawable, usable to back new orders.
/// - `locked`: committed as margin against open orders/positions; only
///   `order` and `settlement` (both in this package) can move funds into or
///   out of `locked` — a trader can never withdraw locked funds directly.
module gasx::margin {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use gasx::market::{Self, Market};
    use gasx::events;

    const E_NOT_OWNER: u64 = 0;
    const E_INSUFFICIENT_AVAILABLE: u64 = 1;
    const E_INSUFFICIENT_LOCKED: u64 = 2;
    const E_WRONG_MARKET: u64 = 3;

    public struct MarginAccount<phantom C> has key, store {
        id: UID,
        owner: address,
        market_id: ID,
        available: Balance<C>,
        locked: Balance<C>,
    }

    /// Open an empty margin account for `sender`, scoped to one market.
    public entry fun open_account<C>(market: &Market, ctx: &mut TxContext) {
        let account = MarginAccount<C> {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            market_id: object::id(market),
            available: balance::zero<C>(),
            locked: balance::zero<C>(),
        };
        transfer::transfer(account, tx_context::sender(ctx));
    }

    /// Add collateral to `available`. Callable by anyone funding their own
    /// account (owner-gated); market must not be paused/settled.
    public entry fun deposit<C>(
        account: &mut MarginAccount<C>,
        market: &Market,
        payment: Coin<C>,
        ctx: &TxContext,
    ) {
        assert!(account.owner == tx_context::sender(ctx), E_NOT_OWNER);
        assert!(account.market_id == object::id(market), E_WRONG_MARKET);
        market::assert_active(market);

        let amount = coin::value(&payment);
        balance::join(&mut account.available, coin::into_balance(payment));
        events::emit_margin_deposited(object::id(account), account.market_id, account.owner, amount);
    }

    /// Withdraw `amount` from `available` back to a `Coin<C>`. Never touches
    /// `locked` funds, so a trader with open orders/positions cannot
    /// withdraw their committed margin out from under them.
    public fun withdraw<C>(
        account: &mut MarginAccount<C>,
        amount: u64,
        ctx: &TxContext,
    ): Coin<C> {
        assert!(account.owner == tx_context::sender(ctx), E_NOT_OWNER);
        assert!(balance::value(&account.available) >= amount, E_INSUFFICIENT_AVAILABLE);

        events::emit_margin_withdrawn(object::id(account), account.market_id, account.owner, amount);
        coin::from_balance(balance::split(&mut account.available, amount), ctx)
    }

    public entry fun withdraw_and_transfer<C>(
        account: &mut MarginAccount<C>,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        let coin_out = withdraw(account, amount, ctx);
        transfer::public_transfer(coin_out, tx_context::sender(ctx));
    }

    /// Move `amount` from `available` to `locked`. Called by `order` when
    /// an order is placed or matched.
    public(package) fun lock<C>(account: &mut MarginAccount<C>, amount: u64) {
        assert!(balance::value(&account.available) >= amount, E_INSUFFICIENT_AVAILABLE);
        let moved = balance::split(&mut account.available, amount);
        balance::join(&mut account.locked, moved);
    }

    /// Move `amount` from `locked` back to `available`. Called by `order`
    /// on cancellation, or by `settlement` once a position is closed out.
    public(package) fun release<C>(account: &mut MarginAccount<C>, amount: u64) {
        assert!(balance::value(&account.locked) >= amount, E_INSUFFICIENT_LOCKED);
        let moved = balance::split(&mut account.locked, amount);
        balance::join(&mut account.available, moved);
    }

    /// Split `amount` out of `locked` as a raw `Balance<C>`, e.g. to move a
    /// losing trader's margin to the winning side at settlement.
    public(package) fun debit_from_locked<C>(account: &mut MarginAccount<C>, amount: u64): Balance<C> {
        assert!(balance::value(&account.locked) >= amount, E_INSUFFICIENT_LOCKED);
        balance::split(&mut account.locked, amount)
    }

    /// Credit a raw `Balance<C>` straight into `available`, e.g. a winning
    /// trader's settlement proceeds.
    public(package) fun credit<C>(account: &mut MarginAccount<C>, funds: Balance<C>) {
        balance::join(&mut account.available, funds);
    }

    public fun owner<C>(account: &MarginAccount<C>): address {
        account.owner
    }

    public fun market_id<C>(account: &MarginAccount<C>): ID {
        account.market_id
    }

    public fun available_balance<C>(account: &MarginAccount<C>): u64 {
        balance::value(&account.available)
    }

    public fun locked_balance<C>(account: &MarginAccount<C>): u64 {
        balance::value(&account.locked)
    }

    #[test_only]
    public fun open_account_for_testing<C>(market_id: ID, owner: address, ctx: &mut TxContext): MarginAccount<C> {
        MarginAccount<C> {
            id: object::new(ctx),
            owner,
            market_id,
            available: balance::zero<C>(),
            locked: balance::zero<C>(),
        }
    }

    #[test_only]
    public fun credit_available_for_testing<C>(account: &mut MarginAccount<C>, funds: Balance<C>) {
        balance::join(&mut account.available, funds);
    }
}
