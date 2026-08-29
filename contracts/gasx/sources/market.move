/// `Market` is the shared configuration object for a single gas-futures
/// contract (ARCHITECTURE.md §6, §15.1) — e.g. "ETH_GAS_1H" expiring at a
/// given timestamp. Every other module (`margin`, `position`, `order`,
/// `settlement`) reads from it and, in settlement's case, marks it settled.
///
/// Admin authority here is deliberately narrow: create, pause/unpause, and
/// adjust the margin ratio. Admin cannot settle a market or touch trader
/// funds (ARCHITECTURE.md §38) — settlement is oracle-price-driven only,
/// in `gasx::settlement`.
module gasx::market {
    use std::string::String;
    use sui::object::{Self, UID, ID};
    use sui::tx_context::TxContext;
    use sui::transfer;
    use gasx::admin::AdminCap;
    use gasx::events;

    const E_MARKET_PAUSED: u64 = 0;
    const E_MARKET_ALREADY_SETTLED: u64 = 1;
    const E_MARKET_NOT_SETTLED: u64 = 2;

    public struct Market has key {
        id: UID,
        underlying: String,
        expiry_ms: u64,
        contract_multiplier: u64,
        tick_size: u64,
        /// Initial margin requirement, in basis points of notional (§12).
        margin_ratio_bps: u64,
        oracle_id: ID,
        paused: bool,
        settled: bool,
        /// Only meaningful once `settled == true`.
        settlement_price: u64,
    }

    /// Admin-gated: create and share a new market.
    public fun create_market(
        _admin: &AdminCap,
        underlying: String,
        expiry_ms: u64,
        contract_multiplier: u64,
        tick_size: u64,
        margin_ratio_bps: u64,
        oracle_id: ID,
        ctx: &mut TxContext,
    ): ID {
        let market = Market {
            id: object::new(ctx),
            underlying,
            expiry_ms,
            contract_multiplier,
            tick_size,
            margin_ratio_bps,
            oracle_id,
            paused: false,
            settled: false,
            settlement_price: 0,
        };
        let market_id = object::id(&market);
        events::emit_market_created(market_id, expiry_ms, contract_multiplier, tick_size);
        transfer::share_object(market);
        market_id
    }

    public fun pause(_admin: &AdminCap, market: &mut Market) {
        market.paused = true;
        events::emit_market_status_changed(object::id(market), true);
    }

    public fun unpause(_admin: &AdminCap, market: &mut Market) {
        assert!(!market.settled, E_MARKET_ALREADY_SETTLED);
        market.paused = false;
        events::emit_market_status_changed(object::id(market), false);
    }

    public fun set_margin_ratio(_admin: &AdminCap, market: &mut Market, new_ratio_bps: u64) {
        market.margin_ratio_bps = new_ratio_bps;
    }

    /// Aborts unless the market is open for trading: not paused, not
    /// settled. Called by `order`/`margin` before mutating trading state.
    public(package) fun assert_active(market: &Market) {
        assert!(!market.paused, E_MARKET_PAUSED);
        assert!(!market.settled, E_MARKET_ALREADY_SETTLED);
    }

    /// Called only by `gasx::settlement` once, at expiry.
    public(package) fun mark_settled(market: &mut Market, final_price: u64) {
        assert!(!market.settled, E_MARKET_ALREADY_SETTLED);
        market.settled = true;
        market.settlement_price = final_price;
    }

    public fun contract_multiplier(market: &Market): u64 {
        market.contract_multiplier
    }

    public fun tick_size(market: &Market): u64 {
        market.tick_size
    }

    public fun margin_ratio_bps(market: &Market): u64 {
        market.margin_ratio_bps
    }

    public fun oracle_id(market: &Market): ID {
        market.oracle_id
    }

    public fun expiry_ms(market: &Market): u64 {
        market.expiry_ms
    }

    public fun is_paused(market: &Market): bool {
        market.paused
    }

    public fun is_settled(market: &Market): bool {
        market.settled
    }

    public fun settlement_price(market: &Market): u64 {
        assert!(market.settled, E_MARKET_NOT_SETTLED);
        market.settlement_price
    }

    #[test_only]
    public fun create_market_for_testing(
        underlying: String,
        expiry_ms: u64,
        contract_multiplier: u64,
        tick_size: u64,
        margin_ratio_bps: u64,
        oracle_id: ID,
        ctx: &mut TxContext,
    ): Market {
        Market {
            id: object::new(ctx),
            underlying,
            expiry_ms,
            contract_multiplier,
            tick_size,
            margin_ratio_bps,
            oracle_id,
            paused: false,
            settled: false,
            settlement_price: 0,
        }
    }

    #[test_only]
    public fun share_for_testing(market: Market) {
        transfer::share_object(market);
    }

    #[test_only]
    /// Force-destroy a market for test cleanup. share_object can only be
    /// called on an object within the same transaction that created it, so
    /// this is used instead once a test has advanced past that point.
    public fun destroy_for_testing(market: Market) {
        let Market {
            id, underlying: _, expiry_ms: _, contract_multiplier: _, tick_size: _,
            margin_ratio_bps: _, oracle_id: _, paused: _, settled: _, settlement_price: _,
        } = market;
        object::delete(id);
    }
}
