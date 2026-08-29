/// Pure margin and PnL math (ARCHITECTURE.md §12). Holds no on-chain state
/// and performs no object mutation, so `margin`, `position`, `order`, and
/// `settlement` all call into it deterministically rather than duplicating
/// the arithmetic.
///
/// Move has no signed integer type in the standard/framework libraries used
/// here, so PnL is returned as (magnitude: u64, is_negative: bool) rather
/// than a signed value — the same convention used by `events::PositionSettled`.
module gasx::risk {
    /// Basis-point denominator: a `margin_ratio_bps` of 1000 means 10%.
    const BPS_DENOMINATOR: u64 = 10_000;

    const E_ZERO_MULTIPLIER: u64 = 0;
    const E_MARGIN_RATIO_OUT_OF_RANGE: u64 = 1;

    /// Notional value of `quantity` contracts at `price`, in the same fixed
    /// point as the collateral coin's smallest unit.
    public fun notional(price: u64, quantity: u64, contract_multiplier: u64): u64 {
        assert!(contract_multiplier > 0, E_ZERO_MULTIPLIER);
        let n = (price as u128) * (quantity as u128) * (contract_multiplier as u128);
        (n as u64)
    }

    /// Required initial margin for a position of `quantity` contracts at
    /// `price`, as `margin_ratio_bps` / 10_000 of notional value.
    /// `margin_ratio_bps` must be in (0, BPS_DENOMINATOR].
    public fun required_margin(
        price: u64,
        quantity: u64,
        contract_multiplier: u64,
        margin_ratio_bps: u64,
    ): u64 {
        assert!(
            margin_ratio_bps > 0 && margin_ratio_bps <= BPS_DENOMINATOR,
            E_MARGIN_RATIO_OUT_OF_RANGE,
        );
        let n = (notional(price, quantity, contract_multiplier) as u128);
        let m = n * (margin_ratio_bps as u128) / (BPS_DENOMINATOR as u128);
        (m as u64)
    }

    /// PnL for `quantity` contracts moving from `entry_price` to
    /// `exit_price`, per the futures formula in ARCHITECTURE.md §3.1:
    /// `Long P&L = (final - entry) * contract_multiplier * quantity`.
    /// Returns (magnitude, is_negative); a flat position (entry == exit)
    /// returns (0, false).
    public fun compute_pnl(
        is_long: bool,
        entry_price: u64,
        exit_price: u64,
        quantity: u64,
        contract_multiplier: u64,
    ): (u64, bool) {
        assert!(contract_multiplier > 0, E_ZERO_MULTIPLIER);

        let favorable = if (is_long) { exit_price >= entry_price } else { entry_price >= exit_price };
        let diff = if (favorable) {
            if (is_long) { exit_price - entry_price } else { entry_price - exit_price }
        } else {
            if (is_long) { entry_price - exit_price } else { exit_price - entry_price }
        };

        let magnitude = (diff as u128) * (quantity as u128) * (contract_multiplier as u128);
        ((magnitude as u64), !favorable)
    }

    #[test_only]
    public fun bps_denominator_for_testing(): u64 {
        BPS_DENOMINATOR
    }
}
