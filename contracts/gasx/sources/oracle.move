/// EGSI oracle state (ARCHITECTURE.md §10, §15.1). A single authorized
/// publisher address pushes price updates to a shared `OracleState`; admin
/// can rotate that publisher and adjust the freshness window, but cannot
/// push prices itself. Consumers (settlement, pricing) must check
/// `is_fresh`/`assert_fresh` before trusting a price — a stale oracle must
/// block settlement rather than settle against a stale value.
///
/// `update_price` also rejects a price above `max_price` (ARCHITECTURE.md
/// §6: "Settlement rejects stale, out-of-range or wrong-market updates") —
/// a compromised or buggy publisher key should not be able to push a value
/// outside the valid EGSI 0-1000 scale on-chain, regardless of what any
/// off-chain publisher client validates before submitting.
module gasx::oracle {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use gasx::admin::AdminCap;
    use gasx::events;

    const E_NOT_PUBLISHER: u64 = 0;
    const E_STALE_PRICE: u64 = 1;
    const E_PRICE_OUT_OF_RANGE: u64 = 2;

    /// Shared object holding the latest published EGSI value.
    public struct OracleState has key {
        id: UID,
        /// Latest published index value, on the 0–1000 EGSI scale (§10.1).
        price: u64,
        /// False until the first update_price call. Needed because a
        /// publish can legitimately happen at clock timestamp 0, so
        /// last_update_ms alone can't distinguish "never published" from
        /// "published at t=0".
        has_price: bool,
        last_update_ms: u64,
        publisher: address,
        /// A price older than this many ms is considered stale.
        max_staleness_ms: u64,
        /// A published price above this is rejected — see the module doc
        /// comment. The valid EGSI scale is 0-1000 (ARCHITECTURE.md §3),
        /// so this is normally set to 1000 at creation, but is left
        /// admin-adjustable (set_max_price) for the same reason
        /// max_staleness_ms is: no need to redeploy a whole new oracle to
        /// change a single bound.
        max_price: u64,
    }

    /// Admin-gated: create and share a new oracle for a market.
    public fun create_oracle(
        _admin: &AdminCap,
        initial_publisher: address,
        max_staleness_ms: u64,
        max_price: u64,
        ctx: &mut TxContext,
    ): ID {
        let oracle = OracleState {
            id: object::new(ctx),
            price: 0,
            has_price: false,
            last_update_ms: 0,
            publisher: initial_publisher,
            max_staleness_ms,
            max_price,
        };
        let oracle_id = object::id(&oracle);
        transfer::share_object(oracle);
        oracle_id
    }

    /// Publisher-gated: push a new EGSI value with the current chain
    /// timestamp. Rejects a price above max_price (see the module doc
    /// comment) — checked before any state is mutated, so a rejected call
    /// leaves the oracle exactly as it was.
    public fun update_price(
        oracle: &mut OracleState,
        price: u64,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == oracle.publisher, E_NOT_PUBLISHER);
        assert!(price <= oracle.max_price, E_PRICE_OUT_OF_RANGE);
        oracle.price = price;
        oracle.has_price = true;
        oracle.last_update_ms = clock::timestamp_ms(clock);
        events::emit_oracle_price_updated(object::id(oracle), price, oracle.last_update_ms);
    }

    /// Admin-gated: rotate which address is authorized to publish.
    public fun set_publisher(_admin: &AdminCap, oracle: &mut OracleState, new_publisher: address) {
        oracle.publisher = new_publisher;
    }

    /// Admin-gated: adjust the freshness window.
    public fun set_max_staleness(_admin: &AdminCap, oracle: &mut OracleState, max_staleness_ms: u64) {
        oracle.max_staleness_ms = max_staleness_ms;
    }

    /// Admin-gated: adjust the maximum acceptable published price.
    public fun set_max_price(_admin: &AdminCap, oracle: &mut OracleState, max_price: u64) {
        oracle.max_price = max_price;
    }

    public fun price(oracle: &OracleState): u64 {
        oracle.price
    }

    public fun last_update_ms(oracle: &OracleState): u64 {
        oracle.last_update_ms
    }

    public fun publisher(oracle: &OracleState): address {
        oracle.publisher
    }

    public fun max_price(oracle: &OracleState): u64 {
        oracle.max_price
    }

    public fun is_fresh(oracle: &OracleState, clock: &Clock): bool {
        let now = clock::timestamp_ms(clock);
        oracle.has_price && now - oracle.last_update_ms <= oracle.max_staleness_ms
    }

    /// Used by `settlement` (and, later, pricing) to hard-fail rather than
    /// silently proceed on a stale oracle.
    public(package) fun assert_fresh(oracle: &OracleState, clock: &Clock) {
        assert!(is_fresh(oracle, clock), E_STALE_PRICE);
    }

    #[test_only]
    public fun create_oracle_for_testing(
        initial_publisher: address,
        max_staleness_ms: u64,
        max_price: u64,
        ctx: &mut TxContext,
    ): OracleState {
        OracleState {
            id: object::new(ctx),
            price: 0,
            has_price: false,
            last_update_ms: 0,
            publisher: initial_publisher,
            max_staleness_ms,
            max_price,
        }
    }

    #[test_only]
    public fun share_for_testing(oracle: OracleState) {
        transfer::share_object(oracle);
    }

    #[test_only]
    /// Force-destroy an oracle for test cleanup. share_object can only be
    /// called on an object within the same transaction that created it, so
    /// this is used instead once a test has advanced past that point.
    public fun destroy_for_testing(oracle: OracleState) {
        let OracleState {
            id, price: _, has_price: _, last_update_ms: _, publisher: _, max_staleness_ms: _, max_price: _,
        } = oracle;
        object::delete(id);
    }
}
