#[test_only]
module gasx::risk_tests {
    use gasx::risk;

    #[test]
    fun notional_multiplies_price_quantity_multiplier() {
        // 425 price * 5 contracts * 1 multiplier = 2125
        assert!(risk::notional(425, 5, 1) == 2125, 0);
    }

    #[test]
    fun required_margin_applies_bps_ratio() {
        // notional = 1000, 10% (1000 bps) margin ratio -> 100
        let m = risk::required_margin(100, 10, 1, 1_000);
        assert!(m == 100, 0);
    }

    #[test]
    fun required_margin_full_ratio_equals_notional() {
        let n = risk::notional(200, 3, 2);
        let m = risk::required_margin(200, 3, 2, risk::bps_denominator_for_testing());
        assert!(m == n, 0);
    }

    #[test]
    #[expected_failure]
    fun required_margin_rejects_zero_ratio() {
        risk::required_margin(100, 1, 1, 0);
    }

    #[test]
    #[expected_failure]
    fun required_margin_rejects_ratio_over_100_percent() {
        risk::required_margin(100, 1, 1, 10_001);
    }

    #[test]
    fun long_pnl_matches_architecture_example() {
        // ARCHITECTURE.md §3.1 example:
        // buy 5 contracts at 425, final 500 -> P&L = (500-425)*1*5 = 375
        let (magnitude, is_negative) = risk::compute_pnl(true, 425, 500, 5, 1);
        assert!(magnitude == 375, 0);
        assert!(!is_negative, 1);
    }

    #[test]
    fun long_pnl_is_negative_when_price_falls() {
        let (magnitude, is_negative) = risk::compute_pnl(true, 500, 425, 5, 1);
        assert!(magnitude == 375, 0);
        assert!(is_negative, 1);
    }

    #[test]
    fun short_pnl_is_mirror_of_long() {
        let (long_mag, long_neg) = risk::compute_pnl(true, 425, 500, 5, 1);
        let (short_mag, short_neg) = risk::compute_pnl(false, 425, 500, 5, 1);
        assert!(long_mag == short_mag, 0);
        assert!(long_neg != short_neg, 1);
    }

    #[test]
    fun flat_position_has_zero_pnl() {
        let (magnitude, is_negative) = risk::compute_pnl(true, 300, 300, 10, 1);
        assert!(magnitude == 0, 0);
        assert!(!is_negative, 1);
    }
}
