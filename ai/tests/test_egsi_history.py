import pytest

from features.history import EgsiHistory


def test_empty_history_returns_none_features():
    history = EgsiHistory()
    assert history.features() is None
    assert len(history) == 0


def test_single_push_gives_neutral_features():
    history = EgsiHistory()
    history.push(500)
    features = history.features()
    assert features is not None
    assert features.ema == 500.0
    assert features.rsi == 50.0  # neutral — no direction data yet
    assert features.momentum == 0.0


def test_ema_moves_toward_new_values():
    history = EgsiHistory(ema_span=3)
    history.push(100)
    history.push(100)
    history.push(900)
    features = history.features()
    # EMA should have moved up from 100 but not jumped all the way to 900.
    assert 100 < features.ema < 900


def test_rsi_is_100_when_only_gains_observed():
    history = EgsiHistory(rsi_period=5)
    for score in [100, 200, 300, 400, 500, 600]:
        history.push(score)
    features = history.features()
    assert features.rsi == 100.0


def test_rsi_is_0_when_only_losses_observed():
    history = EgsiHistory(rsi_period=5)
    for score in [600, 500, 400, 300, 200, 100]:
        history.push(score)
    features = history.features()
    assert features.rsi == 0.0


def test_rsi_is_between_bounds_for_mixed_direction():
    history = EgsiHistory(rsi_period=5)
    for score in [500, 550, 480, 530, 490, 510]:
        history.push(score)
    features = history.features()
    assert 0.0 <= features.rsi <= 100.0


def test_momentum_reflects_change_over_window():
    history = EgsiHistory(momentum_period=3)
    for score in [400, 400, 400, 700]:
        history.push(score)
    features = history.features()
    assert features.momentum == 300.0  # 700 - 400 across the last 3-step window


def test_momentum_is_zero_with_only_one_point():
    history = EgsiHistory(momentum_period=3)
    history.push(400)
    assert history.features().momentum == 0.0


def test_max_len_evicts_oldest_scores():
    history = EgsiHistory(max_len=3)
    history.push(1)
    history.push(2)
    history.push(3)
    history.push(4)
    assert history.scores == [2, 3, 4]
    assert len(history) == 3


def test_scores_property_reflects_push_order():
    history = EgsiHistory()
    history.push(10)
    history.push(20)
    history.push(30)
    assert history.scores == [10, 20, 30]


def test_max_len_below_one_raises():
    with pytest.raises(ValueError):
        EgsiHistory(max_len=0)


# ---------------------------------------------------------------------------
# Feature building for training.
#
# These matter because train and serve must derive features identically.
# _build_features replays history through the same EgsiHistory the live
# service uses, precisely so the two cannot drift apart.
# ---------------------------------------------------------------------------


def test_build_features_produces_exactly_the_forecaster_feature_set():
    import pandas as pd
    from inference.forecaster import FEATURE_NAMES
    from inference.train import _build_features

    raw = pd.DataFrame({
        "score": list(range(100, 200)),
        "base_fee": [0.1] * 100,
        "utilization": [0.5] * 100,
        "mempool_pressure": [0.3] * 100,
        "gas_volatility": [0.2] * 100,
    })
    built = _build_features(raw, horizon=5)
    assert list(built.columns) == FEATURE_NAMES + ["target"]


def test_build_features_target_is_the_score_horizon_rows_ahead():
    import pandas as pd
    from inference.train import _build_features

    raw = pd.DataFrame({
        "score": [100, 200, 300, 400, 500],
        "base_fee": [0.1] * 5, "utilization": [0.5] * 5,
        "mempool_pressure": [0.3] * 5, "gas_volatility": [0.2] * 5,
    })
    built = _build_features(raw, horizon=2)
    # Row 0's target is row 2's score; the last 2 rows are dropped since
    # their future has not happened yet.
    assert built["target"].tolist() == [300.0, 400.0, 500.0]
    assert len(built) == 3


def test_build_features_defaults_absent_thetanuts_signal_to_zero():
    import pandas as pd
    from inference.train import _build_features

    raw = pd.DataFrame({
        "score": list(range(50)), "base_fee": [0.1] * 50, "utilization": [0.5] * 50,
        "mempool_pressure": [0.3] * 50, "gas_volatility": [0.2] * 50,
    })
    built = _build_features(raw, horizon=5)
    assert (built["thetanuts_iv"] == 0.0).all()


def test_build_features_rejects_history_missing_required_columns():
    import pandas as pd
    import pytest as _pytest
    from inference.train import _build_features

    with _pytest.raises(ValueError, match="missing required columns"):
        _build_features(pd.DataFrame({"score": [1, 2, 3]}), horizon=1)


def test_build_features_accepts_the_gateways_camelcase_column_names():
    """The gateway returns camelCase (db.ts maps SQL rows into
    TypeScript-style names) while a CSV from MySQL is snake_case. Both
    must work — this mismatch broke the first real training run."""
    import pandas as pd
    from inference.train import _build_features

    raw = pd.DataFrame({
        "score": list(range(100, 160)),
        "baseFee": [0.05] * 60,
        "utilization": [0.5] * 60,
        "mempoolPressure": [0.33] * 60,
        "gasVolatility": [0.2] * 60,
        "thetanutsIv": [None] * 60,
    })
    built = _build_features(raw, horizon=5)
    assert len(built) == 55
    assert built["base_fee"].iloc[0] == 0.05
    assert built["mempool_pressure"].iloc[0] == 0.33
    assert built["thetanuts_iv"].iloc[0] == 0.0


# ---------------------------------------------------------------------------
# Rich feature engineering.
# ---------------------------------------------------------------------------


def test_rich_features_add_lags_rolling_stats_and_time_of_day():
    import pandas as pd
    from features.engineering import build_rich_features

    raw = pd.DataFrame({
        "score": list(range(100, 500)),
        "block_timestamp": [1_788_100_000 + i * 21 for i in range(400)],
        "base_fee": [0.05] * 400, "utilization": [0.5] * 400,
        "mempool_pressure": [0.33] * 400, "gas_volatility": [0.2] * 400,
    })
    built = build_rich_features(raw)

    assert "lag_5" in built and "delta_5" in built
    assert "roll_mean_50" in built and "roll_z_50" in built
    assert "hour_sin" in built and "hour_cos" in built
    # Substantially more than the original ten features.
    assert len(built.columns) > 20


def test_time_of_day_is_cyclical_so_midnight_wraps():
    import pandas as pd
    from features.engineering import build_rich_features

    # 23:30 and 00:30 are an hour apart in reality; a linear hour
    # encoding would place them 23 hours apart.
    raw = pd.DataFrame({
        "score": [100, 100],
        "block_timestamp": [84_600, 1_800],  # 23:30 and 00:30 UTC
        "base_fee": [0.0, 0.0], "utilization": [0.0, 0.0],
        "mempool_pressure": [0.0, 0.0], "gas_volatility": [0.0, 0.0],
    })
    built = build_rich_features(raw)
    distance = abs(built["hour_sin"].iloc[0] - built["hour_sin"].iloc[1])
    assert distance < 0.5


def test_rich_features_survive_missing_timestamps():
    import pandas as pd
    from features.engineering import build_rich_features

    raw = pd.DataFrame({
        "score": list(range(50)), "base_fee": [0.0] * 50, "utilization": [0.0] * 50,
        "mempool_pressure": [0.0] * 50, "gas_volatility": [0.0] * 50,
    })
    built = build_rich_features(raw)
    # Columns stay stable so a model trained with them can still score.
    assert "hour_sin" in built
    assert (built["hour_sin"] == 0.0).all()


def test_direction_target_marks_rises_as_one():
    import pandas as pd
    from features.engineering import add_targets, build_rich_features

    raw = pd.DataFrame({
        "score": [100, 200, 150], "base_fee": [0.0] * 3, "utilization": [0.0] * 3,
        "mempool_pressure": [0.0] * 3, "gas_volatility": [0.0] * 3,
    })
    built = add_targets(build_rich_features(raw), horizon=1)
    assert built["target_direction"].iloc[0] == 1   # 100 -> 200, up
    assert built["target_direction"].iloc[1] == 0   # 200 -> 150, down


def test_reversion_baseline_predicts_toward_the_mean():
    """This baseline is what a direction classifier must beat. On a
    mean-reverting series it is well above a coin flip for free."""
    import pandas as pd
    from features.engineering import build_rich_features, reversion_direction_baseline

    raw = pd.DataFrame({
        "score": [500] * 100 + [100] * 100,
        "base_fee": [0.0] * 200, "utilization": [0.0] * 200,
        "mempool_pressure": [0.0] * 200, "gas_volatility": [0.0] * 200,
    })
    built = build_rich_features(raw)
    baseline = reversion_direction_baseline(built)
    # Far below the running mean, so it should predict "up".
    assert baseline.iloc[-1] == 1
