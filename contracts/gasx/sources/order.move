/// Orders and deterministic order matching (ARCHITECTURE.md §40 Phase 1:
/// "get one deterministic manual trade working").
///
/// `Order` is a shared object so a resting order placed by one trader can
/// be matched by anyone (either counterparty, or a relayer) in a single
/// transaction — Sui only allows a transaction to mutate an *owned* object
/// if its owner signs, so two different traders' orders can't both be
/// owned inputs to the same `match_orders` call.
///
/// Phase 1 matching is intentionally narrow: exactly one bid and one ask,
/// for the *same* quantity (no partial fills), whose prices cross. The
/// off-chain C++ matching engine (ARCHITECTURE.md §16) is expected to find
/// compatible orders and submit the match; this function re-validates
/// everything itself and is the sole source of truth for whether a trade
/// happened.
///
/// A matched trade locks both sides' committed margin into a shared
/// `Trade<C>` escrow and opens one `Position` per side. Positions are
/// owned by their trader (not shared) so that later settlement is
/// "pull-based": each trader claims their own payout in their own
/// transaction (see `gasx::settlement`), which sidesteps needing atomic
/// cross-owner mutation a second time.
module gasx::order {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::balance::{Self, Balance};
    use gasx::market::{Self, Market};
    use gasx::margin::{Self, MarginAccount};
    use gasx::position;
    use gasx::risk;
    use gasx::events;

    const STATUS_OPEN: u8 = 0;
    const STATUS_FILLED: u8 = 1;
    const STATUS_CANCELLED: u8 = 2;

    const E_NOT_OWNER: u64 = 0;
    const E_WRONG_MARKET: u64 = 1;
    const E_NOT_OPEN: u64 = 2;
    const E_INVALID_SIDES: u64 = 3;
    const E_QUANTITY_MISMATCH: u64 = 4;
    const E_PRICE_MISMATCH: u64 = 5;
    const E_WRONG_ACCOUNT: u64 = 6;
    const E_SELF_TRADE: u64 = 7;

    public struct Order has key, store {
        id: UID,
        market_id: ID,
        owner: address,
        /// true = bid (wants to go long), false = ask (wants to go short).
        is_bid: bool,
        price: u64,
        quantity: u64,
        /// Margin locked out of the owner's MarginAccount when this order
        /// was placed; released in full on cancellation.
        locked_margin: u64,
        status: u8,
    }

    /// Escrow created when a bid and ask are matched. Holds both sides'
    /// committed margin until each side claims their settlement payout.
    public struct Trade<phantom C> has key {
        id: UID,
        market_id: ID,
        buyer: address,
        seller: address,
        buyer_position_id: ID,
        seller_position_id: ID,
        buyer_committed: u64,
        seller_committed: u64,
        escrow: Balance<C>,
        buyer_claimed: bool,
        seller_claimed: bool,
    }

    /// Lock the required margin and place a resting order.
    public fun place_order<C>(
        market: &Market,
        margin_account: &mut MarginAccount<C>,
        is_bid: bool,
        price: u64,
        quantity: u64,
        ctx: &mut TxContext,
    ) {
        market::assert_active(market);
        let market_id = object::id(market);
        assert!(margin::owner(margin_account) == tx_context::sender(ctx), E_NOT_OWNER);
        assert!(margin::market_id(margin_account) == market_id, E_WRONG_MARKET);

        let required = risk::required_margin(
            price, quantity, market::contract_multiplier(market), market::margin_ratio_bps(market),
        );
        margin::lock(margin_account, required);

        let order = Order {
            id: object::new(ctx),
            market_id,
            owner: tx_context::sender(ctx),
            is_bid,
            price,
            quantity,
            locked_margin: required,
            status: STATUS_OPEN,
        };
        events::emit_order_placed(object::id(&order), market_id, order.owner, is_bid, price, quantity);
        transfer::share_object(order);
    }

    /// Owner-gated: cancel an open order and release its locked margin.
    public fun cancel_order<C>(
        order: &mut Order,
        margin_account: &mut MarginAccount<C>,
        ctx: &TxContext,
    ) {
        assert!(order.owner == tx_context::sender(ctx), E_NOT_OWNER);
        assert!(order.status == STATUS_OPEN, E_NOT_OPEN);
        assert!(margin::owner(margin_account) == order.owner, E_NOT_OWNER);
        assert!(margin::market_id(margin_account) == order.market_id, E_WRONG_MARKET);

        margin::release(margin_account, order.locked_margin);
        order.status = STATUS_CANCELLED;
        events::emit_order_cancelled(object::id(order), order.market_id, order.owner);
    }

    /// Match one open bid against one open ask of equal quantity whose
    /// prices cross. Executes at the ask's price. Callable by anyone —
    /// all compatibility checks happen here, not at the caller.
    public fun match_orders<C>(
        market: &Market,
        buy_order: &mut Order,
        sell_order: &mut Order,
        buyer_margin: &mut MarginAccount<C>,
        seller_margin: &mut MarginAccount<C>,
        ctx: &mut TxContext,
    ): ID {
        market::assert_active(market);
        let market_id = object::id(market);

        assert!(buy_order.market_id == market_id && sell_order.market_id == market_id, E_WRONG_MARKET);
        assert!(buy_order.status == STATUS_OPEN && sell_order.status == STATUS_OPEN, E_NOT_OPEN);
        assert!(buy_order.is_bid && !sell_order.is_bid, E_INVALID_SIDES);
        assert!(buy_order.quantity == sell_order.quantity, E_QUANTITY_MISMATCH);
        assert!(buy_order.price >= sell_order.price, E_PRICE_MISMATCH);
        assert!(buy_order.owner != sell_order.owner, E_SELF_TRADE);
        assert!(
            margin::owner(buyer_margin) == buy_order.owner && margin::market_id(buyer_margin) == market_id,
            E_WRONG_ACCOUNT,
        );
        assert!(
            margin::owner(seller_margin) == sell_order.owner && margin::market_id(seller_margin) == market_id,
            E_WRONG_ACCOUNT,
        );

        let trade_price = sell_order.price;
        let quantity = buy_order.quantity;

        let mut escrow = margin::debit_from_locked(buyer_margin, buy_order.locked_margin);
        let seller_funds = margin::debit_from_locked(seller_margin, sell_order.locked_margin);
        balance::join(&mut escrow, seller_funds);

        let buyer_position = position::open(buy_order.owner, market_id, true, quantity, trade_price, ctx);
        let seller_position = position::open(sell_order.owner, market_id, false, quantity, trade_price, ctx);
        let buyer_position_id = object::id(&buyer_position);
        let seller_position_id = object::id(&seller_position);

        let trade = Trade<C> {
            id: object::new(ctx),
            market_id,
            buyer: buy_order.owner,
            seller: sell_order.owner,
            buyer_position_id,
            seller_position_id,
            buyer_committed: buy_order.locked_margin,
            seller_committed: sell_order.locked_margin,
            escrow,
            buyer_claimed: false,
            seller_claimed: false,
        };
        let trade_id = object::id(&trade);

        buy_order.status = STATUS_FILLED;
        sell_order.status = STATUS_FILLED;

        events::emit_trade_executed(
            market_id, object::id(buy_order), object::id(sell_order),
            buy_order.owner, sell_order.owner, trade_price, quantity,
        );

        transfer::public_transfer(buyer_position, buy_order.owner);
        transfer::public_transfer(seller_position, sell_order.owner);
        transfer::share_object(trade);

        trade_id
    }

    public fun status(order: &Order): u8 { order.status }
    public fun is_open(order: &Order): bool { order.status == STATUS_OPEN }
    public fun is_filled(order: &Order): bool { order.status == STATUS_FILLED }
    public fun is_cancelled(order: &Order): bool { order.status == STATUS_CANCELLED }
    public fun order_owner(order: &Order): address { order.owner }
    public fun order_market_id(order: &Order): ID { order.market_id }
    public fun order_price(order: &Order): u64 { order.price }
    public fun order_quantity(order: &Order): u64 { order.quantity }
    public fun locked_margin(order: &Order): u64 { order.locked_margin }

    public fun trade_market_id<C>(trade: &Trade<C>): ID { trade.market_id }
    public fun trade_buyer<C>(trade: &Trade<C>): address { trade.buyer }
    public fun trade_seller<C>(trade: &Trade<C>): address { trade.seller }
    public fun trade_buyer_position_id<C>(trade: &Trade<C>): ID { trade.buyer_position_id }
    public fun trade_seller_position_id<C>(trade: &Trade<C>): ID { trade.seller_position_id }
    public fun trade_buyer_committed<C>(trade: &Trade<C>): u64 { trade.buyer_committed }
    public fun trade_seller_committed<C>(trade: &Trade<C>): u64 { trade.seller_committed }
    public fun trade_buyer_claimed<C>(trade: &Trade<C>): bool { trade.buyer_claimed }
    public fun trade_seller_claimed<C>(trade: &Trade<C>): bool { trade.seller_claimed }
    public fun trade_escrow_value<C>(trade: &Trade<C>): u64 { balance::value(&trade.escrow) }

    /// Used only by `gasx::settlement` to pay out a claim.
    public(package) fun withdraw_escrow<C>(trade: &mut Trade<C>, amount: u64): Balance<C> {
        balance::split(&mut trade.escrow, amount)
    }

    public(package) fun mark_buyer_claimed<C>(trade: &mut Trade<C>) {
        trade.buyer_claimed = true;
    }

    public(package) fun mark_seller_claimed<C>(trade: &mut Trade<C>) {
        trade.seller_claimed = true;
    }

    #[test_only]
    public fun place_order_for_testing(
        market_id: ID,
        owner: address,
        is_bid: bool,
        price: u64,
        quantity: u64,
        locked_margin: u64,
        ctx: &mut TxContext,
    ): Order {
        Order {
            id: object::new(ctx),
            market_id,
            owner,
            is_bid,
            price,
            quantity,
            locked_margin,
            status: STATUS_OPEN,
        }
    }

    #[test_only]
    public fun destroy_order_for_testing(order: Order) {
        let Order { id, market_id: _, owner: _, is_bid: _, price: _, quantity: _, locked_margin: _, status: _ } = order;
        object::delete(id);
    }
}
