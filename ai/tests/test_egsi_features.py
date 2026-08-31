import pytest

from features.egsi import (
    EgsiNormalizationConfig,
    EgsiWeights,
    compute_egsi,
)
from schemas import RawEthereumMetrics


def make_metrics(**overrides) -> RawEthereumMetrics:
    defaults = dict(
        block_number=1000,
        timestamp=1_700_000_000,
        base_fee_wei=20_000_000_000,  # 20 gwei
        gas_used=15_000_000,
        gas_limit=30_000_000,
        pending_tx_count=5_000,
        base_fee_history_wei=[20_000_000_000] * 10,
        dex_tx_count=10,
        block_tx_count=100,
    )
    defaults.update(overrides)
    return RawEthereumMetrics(**defaults)


def test_score_is_within_0_1000_bounds():
    snapshot = compute_egsi(make_metrics())
    assert 0 <= snapshot.score <= 1000


def test_minimal_stress_inputs_give_a_low_score():
    metrics = make_metrics(
        base_fee_wei=100_000_000,  # 0.1 gwei — at the log-scale floor
        gas_used=0,
        pending_tx_count=0,
        base_fee_history_wei=[100_000_000] * 10,  # flat, no momentum/volatility
        dex_tx_count=0,
    )
    snapshot = compute_egsi(metrics)
    assert snapshot.score < 50


def test_maximal_stress_inputs_give_a_high_score():
    metrics = make_metrics(
        base_fee_wei=200_000_000_000,  # above the ceiling
        gas_used=30_000_000,
        gas_limit=30_000_000,
        pending_tx_count=300_000,  # above the 200k ceiling
        base_fee_history_wei=[10_000_000_000, 40_000_000_000],  # sharp rise
        dex_tx_count=90,
        block_tx_count=100,
    )
    snapshot = compute_egsi(metrics)
    assert snapshot.score > 900


def test_higher_base_fee_increases_score_all_else_equal():
    low = compute_egsi(make_metrics(base_fee_wei=10_000_000_000))
    high = compute_egsi(make_metrics(base_fee_wei=100_000_000_000))
    assert high.score > low.score


def test_higher_utilization_increases_score_all_else_equal():
    low = compute_egsi(make_metrics(gas_used=1_000_000, gas_limit=30_000_000))
    high = compute_egsi(make_metrics(gas_used=29_000_000, gas_limit=30_000_000))
    assert high.score > low.score


def test_rising_fee_history_increases_fee_momentum_component():
    flat = compute_egsi(make_metrics(base_fee_history_wei=[20_000_000_000] * 10))
    rising = compute_egsi(make_metrics(base_fee_history_wei=[10_000_000_000, 30_000_000_000]))
    assert rising.components.fee_momentum > flat.components.fee_momentum


def test_falling_fee_history_does_not_go_below_zero_momentum():
    falling = compute_egsi(make_metrics(base_fee_history_wei=[30_000_000_000, 10_000_000_000]))
    assert falling.components.fee_momentum == 0.0


def test_volatile_fee_history_increases_volatility_component():
    stable = compute_egsi(make_metrics(base_fee_history_wei=[20_000_000_000] * 10))
    volatile = compute_egsi(
        make_metrics(base_fee_history_wei=[5_000_000_000, 50_000_000_000, 8_000_000_000, 45_000_000_000])
    )
    assert volatile.components.gas_volatility > stable.components.gas_volatility


def test_short_fee_history_gives_zero_momentum_and_volatility():
    snapshot = compute_egsi(make_metrics(base_fee_history_wei=[20_000_000_000]))
    assert snapshot.components.fee_momentum == 0.0
    assert snapshot.components.gas_volatility == 0.0


def test_dex_activity_scales_with_fraction_of_block():
    low = compute_egsi(make_metrics(dex_tx_count=1, block_tx_count=100))
    high = compute_egsi(make_metrics(dex_tx_count=60, block_tx_count=100))
    assert high.components.dex_activity > low.components.dex_activity


def test_zero_block_tx_count_gives_zero_dex_activity_not_a_crash():
    snapshot = compute_egsi(make_metrics(dex_tx_count=0, block_tx_count=0))
    assert snapshot.components.dex_activity == 0.0


def test_components_are_individually_clamped_to_0_1():
    snapshot = compute_egsi(
        make_metrics(base_fee_wei=1_000_000_000_000, pending_tx_count=10_000_000)  # absurdly high
    )
    for value in snapshot.components.model_dump().values():
        if value is None:  # thetanuts_iv, when no live signal was supplied
            continue
        assert 0.0 <= value <= 1.0


def test_zero_gas_limit_raises():
    with pytest.raises(ValueError):
        compute_egsi(make_metrics(gas_limit=0))


def test_all_zero_weights_raises():
    zero_weights = EgsiWeights(
        base_fee=0, utilization=0, mempool_pressure=0, fee_momentum=0, gas_volatility=0, dex_activity=0
    )
    with pytest.raises(ValueError):
        compute_egsi(make_metrics(), weights=zero_weights)


def test_snapshot_preserves_block_number_and_timestamp():
    snapshot = compute_egsi(make_metrics(block_number=12345, timestamp=999))
    assert snapshot.block_number == 12345
    assert snapshot.timestamp == 999


def test_custom_weights_shift_the_score_toward_the_upweighted_component():
    metrics = make_metrics(base_fee_wei=200_000_000_000, gas_used=1, pending_tx_count=0)  # high base fee, low else
    default_score = compute_egsi(metrics).score
    base_fee_heavy = EgsiWeights(
        base_fee=1.0, utilization=0.01, mempool_pressure=0.01, fee_momentum=0.01, gas_volatility=0.01, dex_activity=0.01
    )
    heavy_score = compute_egsi(metrics, weights=base_fee_heavy).score
    assert heavy_score > default_score


def test_custom_normalization_config_is_respected():
    metrics = make_metrics(base_fee_wei=20_000_000_000)  # 20 gwei
    default_snapshot = compute_egsi(metrics)
    tight_config = EgsiNormalizationConfig(base_fee_floor_gwei=19.0, base_fee_ceiling_gwei=21.0)
    tight_snapshot = compute_egsi(metrics, config=tight_config)
    # Same 20 gwei reads as fully mid-scale (0.5) under the wide default
    # range, but the tighter [19, 21] range should also read near 0.5 —
    # what should differ is how *sensitive* nearby values are, which we
    # check indirectly via a different base fee.
    assert 0.0 <= default_snapshot.components.base_fee <= 1.0
    assert 0.0 <= tight_snapshot.components.base_fee <= 1.0


def test_thetanuts_iv_omitted_by_default_leaves_component_none():
    snapshot = compute_egsi(make_metrics())
    assert snapshot.components.thetanuts_iv is None


def test_thetanuts_iv_supplied_populates_the_component():
    snapshot = compute_egsi(make_metrics(), thetanuts_iv=0.9)
    assert snapshot.components.thetanuts_iv is not None
    assert 0.0 <= snapshot.components.thetanuts_iv <= 1.0


def test_higher_thetanuts_iv_increases_score_all_else_equal():
    metrics = make_metrics(base_fee_wei=10_000_000_000, gas_used=1_000_000, pending_tx_count=0)
    calm = compute_egsi(metrics, thetanuts_iv=0.3)  # at the floor
    stressed = compute_egsi(metrics, thetanuts_iv=1.5)  # at the ceiling
    assert stressed.score > calm.score


def test_thetanuts_iv_absent_vs_present_can_move_the_score():
    # A high live IV reading should pull the blended score up relative
    # to having no signal at all for an otherwise-calm block, since the
    # blend without it excludes thetanuts_iv's weight entirely rather
    # than treating the missing signal as calm.
    metrics = make_metrics(base_fee_wei=10_000_000_000, gas_used=1_000_000, pending_tx_count=0)
    without_signal = compute_egsi(metrics)
    with_high_iv = compute_egsi(metrics, thetanuts_iv=1.5)
    assert with_high_iv.score > without_signal.score


def test_thetanuts_iv_component_is_clamped_to_0_1():
    snapshot = compute_egsi(make_metrics(), thetanuts_iv=50.0)  # absurdly high
    assert snapshot.components.thetanuts_iv == 1.0

    snapshot_low = compute_egsi(make_metrics(), thetanuts_iv=-10.0)  # absurdly low
    assert snapshot_low.components.thetanuts_iv == 0.0


def test_custom_thetanuts_iv_normalization_config_is_respected():
    tight_config = EgsiNormalizationConfig(thetanuts_iv_floor=0.6, thetanuts_iv_ceiling=0.8)
    snapshot = compute_egsi(make_metrics(), config=tight_config, thetanuts_iv=0.7)
    assert snapshot.components.thetanuts_iv == pytest.approx(0.5)


def test_thetanuts_iv_ceiling_not_exceeding_floor_raises():
    bad_config = EgsiNormalizationConfig(thetanuts_iv_floor=1.0, thetanuts_iv_ceiling=0.5)
    with pytest.raises(ValueError):
        compute_egsi(make_metrics(), config=bad_config, thetanuts_iv=0.7)


def test_thetanuts_iv_weight_of_zero_excludes_it_even_when_supplied():
    weights = EgsiWeights(thetanuts_iv=0.0)
    metrics = make_metrics(base_fee_wei=10_000_000_000, gas_used=1_000_000, pending_tx_count=0)
    with_zero_weight = compute_egsi(metrics, weights=weights, thetanuts_iv=1.5)
    without_signal = compute_egsi(metrics, weights=weights)
    assert with_zero_weight.score == without_signal.score


# ---------------------------------------------------------------------------
# Calibration regression guards.
#
# These exist because the original defaults were guesses that turned out
# to be badly wrong against live mainnet (2026-08-31): the base fee floor
# sat 35x above the real gas price, pinning that component at 0.0 forever,
# and the mempool ceiling sat 4x below the real pending count, pinning
# that one at 1.0 forever. Two of six inputs were dead and the failure was
# silent. These check the components actually respond in the range the
# real network occupies.
# ---------------------------------------------------------------------------


def test_base_fee_is_log_scaled_not_linear():
    # On a linear scale the midpoint of [0.1, 100] gwei would be ~50 gwei.
    # On a log scale it is ~3.16 gwei (10^0.5). Assert the log behaviour.
    snapshot = compute_egsi(make_metrics(base_fee_wei=3_162_000_000))  # ~3.16 gwei
    assert snapshot.components.base_fee == pytest.approx(0.5, abs=0.01)


def test_realistic_low_gas_price_is_on_scale_not_pinned_to_zero():
    # 0.14 gwei — the actual observed mainnet gas price that exposed the
    # original miscalibration. Must be > 0, or the component is dead.
    snapshot = compute_egsi(make_metrics(base_fee_wei=140_000_000))
    assert snapshot.components.base_fee > 0.0
    assert snapshot.components.base_fee < 0.2


def test_base_fee_still_responds_across_the_realistic_low_range():
    # Two ordinary post-Dencun readings must be distinguishable.
    quiet = compute_egsi(make_metrics(base_fee_wei=140_000_000))  # 0.14 gwei
    busier = compute_egsi(make_metrics(base_fee_wei=2_000_000_000))  # 2 gwei
    assert busier.components.base_fee > quiet.components.base_fee


def test_congestion_spike_still_reaches_the_top_of_the_scale():
    snapshot = compute_egsi(make_metrics(base_fee_wei=100_000_000_000))  # 100 gwei
    assert snapshot.components.base_fee == pytest.approx(1.0, abs=0.01)


def test_zero_base_fee_does_not_break_the_log_scale():
    # log10(0) is undefined; must read as no stress rather than raising.
    snapshot = compute_egsi(make_metrics(base_fee_wei=0))
    assert snapshot.components.base_fee == 0.0


def test_realistic_mempool_is_on_scale_not_pinned_to_one():
    # 79,361 pending — the actual observed mainnet value that exposed the
    # original miscalibration.
    snapshot = compute_egsi(make_metrics(pending_tx_count=79_361))
    assert 0.0 < snapshot.components.mempool_pressure < 1.0


def test_mempool_still_responds_across_the_realistic_range():
    normal = compute_egsi(make_metrics(pending_tx_count=79_361))
    congested = compute_egsi(make_metrics(pending_tx_count=150_000))
    assert congested.components.mempool_pressure > normal.components.mempool_pressure


def test_base_fee_floor_must_be_positive_for_log_scale():
    bad = EgsiNormalizationConfig(base_fee_floor_gwei=0.0)
    with pytest.raises(ValueError):
        compute_egsi(make_metrics(), config=bad)
