/// Event structs emitted across the `gasx` package, centralized here so the
/// off-chain indexer (ARCHITECTURE.md §39 `indexer/`) has one schema to
/// track instead of one per module. Emission is `public(package)`-gated:
/// only `gasx` modules may emit these, callers cannot forge events.
module gasx::events {
    use sui::event;
    use sui::object::ID;

    public struct MarketCreated has copy, drop {
        market_id: ID,
        expiry_ms: u64,
        contract_multiplier: u64,
        tick_size: u64,
    }

    public struct MarketStatusChanged has copy, drop {
        market_id: ID,
        paused: bool,
    }

    public struct OraclePriceUpdated has copy, drop {
        oracle_id: ID,
        price: u64,
        timestamp_ms: u64,
    }

    public struct MarginDeposited has copy, drop {
        account_id: ID,
        market_id: ID,
        trader: address,
        amount: u64,
    }

    public struct MarginWithdrawn has copy, drop {
        account_id: ID,
        market_id: ID,
        trader: address,
        amount: u64,
    }

    public struct OrderPlaced has copy, drop {
        order_id: ID,
        market_id: ID,
        trader: address,
        is_bid: bool,
        price: u64,
        quantity: u64,
    }

    public struct OrderCancelled has copy, drop {
        order_id: ID,
        market_id: ID,
        trader: address,
    }

    public struct TradeExecuted has copy, drop {
        market_id: ID,
        buy_order_id: ID,
        sell_order_id: ID,
        buyer: address,
        seller: address,
        price: u64,
        quantity: u64,
    }

    public struct MarketSettled has copy, drop {
        market_id: ID,
        final_price: u64,
    }

    public struct PositionSettled has copy, drop {
        position_id: ID,
        market_id: ID,
        trader: address,
        pnl_magnitude: u64,
        pnl_is_negative: bool,
    }

    public(package) fun emit_market_created(
        market_id: ID,
        expiry_ms: u64,
        contract_multiplier: u64,
        tick_size: u64,
    ) {
        event::emit(MarketCreated { market_id, expiry_ms, contract_multiplier, tick_size });
    }

    public(package) fun emit_market_status_changed(market_id: ID, paused: bool) {
        event::emit(MarketStatusChanged { market_id, paused });
    }

    public(package) fun emit_oracle_price_updated(oracle_id: ID, price: u64, timestamp_ms: u64) {
        event::emit(OraclePriceUpdated { oracle_id, price, timestamp_ms });
    }

    public(package) fun emit_margin_deposited(
        account_id: ID,
        market_id: ID,
        trader: address,
        amount: u64,
    ) {
        event::emit(MarginDeposited { account_id, market_id, trader, amount });
    }

    public(package) fun emit_margin_withdrawn(
        account_id: ID,
        market_id: ID,
        trader: address,
        amount: u64,
    ) {
        event::emit(MarginWithdrawn { account_id, market_id, trader, amount });
    }

    public(package) fun emit_order_placed(
        order_id: ID,
        market_id: ID,
        trader: address,
        is_bid: bool,
        price: u64,
        quantity: u64,
    ) {
        event::emit(OrderPlaced { order_id, market_id, trader, is_bid, price, quantity });
    }

    public(package) fun emit_order_cancelled(order_id: ID, market_id: ID, trader: address) {
        event::emit(OrderCancelled { order_id, market_id, trader });
    }

    public(package) fun emit_trade_executed(
        market_id: ID,
        buy_order_id: ID,
        sell_order_id: ID,
        buyer: address,
        seller: address,
        price: u64,
        quantity: u64,
    ) {
        event::emit(TradeExecuted {
            market_id, buy_order_id, sell_order_id, buyer, seller, price, quantity,
        });
    }

    public(package) fun emit_market_settled(market_id: ID, final_price: u64) {
        event::emit(MarketSettled { market_id, final_price });
    }

    public(package) fun emit_position_settled(
        position_id: ID,
        market_id: ID,
        trader: address,
        pnl_magnitude: u64,
        pnl_is_negative: bool,
    ) {
        event::emit(PositionSettled { position_id, market_id, trader, pnl_magnitude, pnl_is_negative });
    }
}
