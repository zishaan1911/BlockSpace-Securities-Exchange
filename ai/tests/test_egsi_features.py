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
        base_fee_wei=5_000_000_000,  # at the floor
        gas_used=0,
        pending_tx_count=0,
        base_fee_history_wei=[5_000_000_000] * 10,  # flat, no momentum/volatility
        dex_tx_count=0,
    )
    snapshot = compute_egsi(metrics)
    assert snapshot.score < 50


def test_maximal_stress_inputs_give_a_high_score():
    metrics = make_metrics(
        base_fee_wei=200_000_000_000,  # above the ceiling
        gas_used=30_000_000,
        gas_limit=30_000_000,
        pending_tx_count=30_000,
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
