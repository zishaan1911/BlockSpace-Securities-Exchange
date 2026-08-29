/// Oracle-driven settlement (ARCHITECTURE.md §15.1, §40 Phase 1).
///
/// `settle_market` is permissionless and requires no `AdminCap` — anyone
/// may call it once the market has passed `expiry_ms` and the oracle has a
/// fresh price, and it can only ever run once (`market::mark_settled`
/// aborts on a second call). This keeps settlement mechanical and
/// oracle-driven rather than admin-discretionary (ARCHITECTURE.md §38).
///
/// Once settled, each trader independently `claim`s their own payout from
/// the `Trade<C>` escrow their position belongs to — a pull model, so no
/// single transaction needs mutable access to two different traders'
/// owned objects.
///
/// Payout model (Phase 1 simplification, documented — not a full
/// liquidation/insurance-fund system): a winner receives their own
/// committed margin plus their PnL, capped at the *other* side's
/// committed margin; a loser receives their own committed margin minus
/// their PnL, floored at zero. This guarantees claims never overdraw the
/// escrow, at the cost of not modeling under-margined losses beyond what
/// was committed — that requires the liquidation engine described
/// elsewhere in ARCHITECTURE.md and is out of scope for Phase 1.
module gasx::settlement {
    use sui::object;
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use gasx::market::{Self, Market};
    use gasx::oracle::{Self, OracleState};
    use gasx::margin::{Self, MarginAccount};
    use gasx::position::{Self, Position};
    use gasx::order::{Self, Trade};
    use gasx::events;

    const E_WRONG_ORACLE: u64 = 0;
    const E_NOT_EXPIRED: u64 = 1;
    const E_MARKET_NOT_SETTLED: u64 = 2;
    const E_WRONG_MARKET: u64 = 3;
    const E_NOT_PARTICIPANT: u64 = 4;
    const E_NOT_OWNER: u64 = 5;
    const E_WRONG_ACCOUNT: u64 = 6;
    const E_ALREADY_CLAIMED: u64 = 7;
    const E_WRONG_POSITION: u64 = 8;

    /// Permissionless: settle `market` at the oracle's current price, once
    /// expiry has passed and that price is fresh.
    public fun settle_market(market: &mut Market, oracle: &OracleState, clock: &Clock) {
        assert!(market::oracle_id(market) == object::id(oracle), E_WRONG_ORACLE);
        assert!(clock::timestamp_ms(clock) >= market::expiry_ms(market), E_NOT_EXPIRED);
        oracle::assert_fresh(oracle, clock);

        let final_price = oracle::price(oracle);
        market::mark_settled(market, final_price);
        events::emit_market_settled(object::id(market), final_price);
    }

    /// Claim this trader's payout from a settled trade. Consumes their
    /// `Position` (it is fully closed by construction — one trade opened
    /// it, one claim closes it) and credits their `MarginAccount`.
    public fun claim<C>(
        trade: &mut Trade<C>,
        mut position: Position,
        market: &Market,
        margin_account: &mut MarginAccount<C>,
        ctx: &TxContext,
    ) {
        assert!(market::is_settled(market), E_MARKET_NOT_SETTLED);
        assert!(order::trade_market_id(trade) == object::id(market), E_WRONG_MARKET);

        let sender = tx_context::sender(ctx);
        let is_buyer = sender == order::trade_buyer(trade);
        let is_seller = sender == order::trade_seller(trade);
        assert!(is_buyer || is_seller, E_NOT_PARTICIPANT);
        assert!(position::owner(&position) == sender, E_NOT_OWNER);
        assert!(margin::owner(margin_account) == sender, E_NOT_OWNER);
        assert!(margin::market_id(margin_account) == object::id(market), E_WRONG_ACCOUNT);

        let (committed, other_committed) = if (is_buyer) {
            assert!(!order::trade_buyer_claimed(trade), E_ALREADY_CLAIMED);
            assert!(object::id(&position) == order::trade_buyer_position_id(trade), E_WRONG_POSITION);
            (order::trade_buyer_committed(trade), order::trade_seller_committed(trade))
        } else {
            assert!(!order::trade_seller_claimed(trade), E_ALREADY_CLAIMED);
            assert!(object::id(&position) == order::trade_seller_position_id(trade), E_WRONG_POSITION);
            (order::trade_seller_committed(trade), order::trade_buyer_committed(trade))
        };

        let final_price = market::settlement_price(market);
        let contract_multiplier = market::contract_multiplier(market);
        let quantity = position::quantity(&position);
        let position_id = object::id(&position);

        let (pnl_magnitude, pnl_is_negative) = position::reduce(&mut position, quantity, final_price, contract_multiplier);

        let payout = if (pnl_is_negative) {
            committed - min(pnl_magnitude, committed)
        } else {
            committed + min(pnl_magnitude, other_committed)
        };

        let funds = order::withdraw_escrow(trade, payout);
        margin::credit(margin_account, funds);

        if (is_buyer) {
            order::mark_buyer_claimed(trade);
        } else {
            order::mark_seller_claimed(trade);
        };

        events::emit_position_settled(position_id, object::id(market), sender, pnl_magnitude, pnl_is_negative);
        position::destroy_empty(position);
    }

    fun min(a: u64, b: u64): u64 {
        if (a < b) { a } else { b }
    }
}
