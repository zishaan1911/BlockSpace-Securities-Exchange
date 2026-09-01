from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest

from inference.forecaster import (
    FALLBACK_FORECAST,
    FEATURE_NAMES,
    Forecaster,
    TrainedModel,
    _confidence_from_band,
    _p_exceeds,
    train,
)


# ---------------------------------------------------------------------------
# Pure helper functions
# ---------------------------------------------------------------------------


def test_confidence_is_1_for_a_zero_width_band():
    assert _confidence_from_band(500.0, 500.0) == 1.0


def test_confidence_is_0_for_a_full_range_band():
    assert _confidence_from_band(0.0, 1000.0) == 0.0


def test_confidence_decreases_as_band_widens():
    narrow = _confidence_from_band(480.0, 520.0)
    wide = _confidence_from_band(200.0, 800.0)
    assert narrow > wide


def test_p_exceeds_is_high_when_median_is_far_above_threshold():
    p = _p_exceeds(500.0, median=900.0, low=850.0, high=950.0)
    assert p > 0.95


def test_p_exceeds_is_low_when_median_is_far_below_threshold():
    p = _p_exceeds(500.0, median=100.0, low=50.0, high=150.0)
    assert p < 0.05


def test_p_exceeds_is_roughly_half_when_median_equals_threshold():
    p = _p_exceeds(500.0, median=500.0, low=400.0, high=600.0)
    assert p == pytest.approx(0.5, abs=1e-9)


# ---------------------------------------------------------------------------
# Forecaster fallback behavior
# ---------------------------------------------------------------------------


def test_no_model_loaded_returns_fallback():
    forecaster = Forecaster()
    assert not forecaster.is_model_loaded
    result = forecaster.predict({name: 0.0 for name in FEATURE_NAMES})
    assert result == FALLBACK_FORECAST


def test_model_that_failed_baseline_check_is_not_considered_loaded():
    fake_model = TrainedModel(median=MagicMock(), low=MagicMock(), high=MagicMock(), beats_baseline=False)
    forecaster = Forecaster(fake_model)
    assert not forecaster.is_model_loaded
    assert forecaster.predict({name: 0.0 for name in FEATURE_NAMES}) == FALLBACK_FORECAST


def test_predict_falls_back_on_inference_exception():
    broken_median = MagicMock()
    broken_median.predict.side_effect = RuntimeError("boom")
    fake_model = TrainedModel(median=broken_median, low=MagicMock(), high=MagicMock(), beats_baseline=True)
    forecaster = Forecaster(fake_model)
    assert forecaster.is_model_loaded
    assert forecaster.predict({name: 0.0 for name in FEATURE_NAMES}) == FALLBACK_FORECAST


def test_predict_with_loaded_model_returns_values_in_valid_ranges():
    median_model = MagicMock()
    median_model.predict.return_value = np.array([600.0])
    low_model = MagicMock()
    low_model.predict.return_value = np.array([550.0])
    high_model = MagicMock()
    high_model.predict.return_value = np.array([650.0])
    fake_model = TrainedModel(median=median_model, low=low_model, high=high_model, beats_baseline=True)
    forecaster = Forecaster(fake_model)

    result = forecaster.predict({name: 1.0 for name in FEATURE_NAMES})

    assert 0.0 <= result.expected_egsi <= 1000.0
    assert 0.0 <= result.confidence <= 1.0
    assert 0.0 <= result.p_tail_500 <= 1.0
    assert result.model_version == "egsi-v1"


def test_predict_handles_missing_feature_keys_gracefully():
    median_model = MagicMock()
    median_model.predict.return_value = np.array([500.0])
    low_model = MagicMock()
    low_model.predict.return_value = np.array([450.0])
    high_model = MagicMock()
    high_model.predict.return_value = np.array([550.0])
    fake_model = TrainedModel(median=median_model, low=low_model, high=high_model, beats_baseline=True)
    forecaster = Forecaster(fake_model)

    # Deliberately incomplete feature dict — predict() should default
    # missing keys to 0.0 rather than raising a KeyError.
    result = forecaster.predict({"ema": 400.0})

    assert result.model_version == "egsi-v1"


def test_predict_swaps_low_and_high_if_a_quantile_model_inverts_them():
    median_model = MagicMock()
    median_model.predict.return_value = np.array([500.0])
    low_model = MagicMock()
    low_model.predict.return_value = np.array([600.0])  # inverted on purpose
    high_model = MagicMock()
    high_model.predict.return_value = np.array([400.0])
    fake_model = TrainedModel(median=median_model, low=low_model, high=high_model, beats_baseline=True)
    forecaster = Forecaster(fake_model)

    result = forecaster.predict({name: 0.0 for name in FEATURE_NAMES})

    # Should not raise, and confidence should still be a valid probability
    # (an inverted band would otherwise produce a negative width).
    assert 0.0 <= result.confidence <= 1.0


# ---------------------------------------------------------------------------
# train() — pipeline/plumbing test, not a forecast-quality benchmark.
#
# This checks that train()'s fit -> evaluate -> compare-to-baseline wiring
# behaves correctly, using a synthetic dataset rigged so the model has an
# easy time (target equals one of its own input features) and the supplied
# "naive" baseline is a clearly worse predictor (a noisier, unsmoothed
# feature). It does NOT validate real forecasting skill on real EGSI
# history — that needs real historical data, which isn't available in
# this sandbox. See ai/README.md.
# ---------------------------------------------------------------------------


def _synthetic_dataset(n: int = 400, seed: int = 42):
    # Mean-reverting (not a plain random walk): a cumulative random walk
    # drifts outside its own training-set range over time, and tree
    # models like LightGBM can't extrapolate past the value ranges they
    # saw in training — a chronological train/test split would then fail
    # for reasons unrelated to train()'s own correctness. Mean-reversion
    # keeps train/test in the same range (and is also more realistic for
    # a bounded 0-1000 index like EGSI than an unbounded walk).
    rng = np.random.default_rng(seed)
    mean, theta = 500.0, 0.1
    raw = np.empty(n)
    raw[0] = mean
    for t in range(1, n):
        raw[t] = raw[t - 1] + theta * (mean - raw[t - 1]) + rng.normal(0, 20)
    raw = np.clip(raw, 0, 1000)
    ema = pd.Series(raw).ewm(span=14, adjust=False).mean().to_numpy()

    df = pd.DataFrame(
        {
            "ema": ema,
            "rsi": np.full(n, 50.0),
            "momentum": np.zeros(n),
            "last_score": raw,  # the noisier, unsmoothed baseline predictor
            "base_fee": np.zeros(n),
            "utilization": np.zeros(n),
            "mempool_pressure": np.zeros(n),
            "gas_volatility": np.zeros(n),
            "thetanuts_iv": np.zeros(n),
            "thetanuts_skew": np.zeros(n),
        }
    )
    target = ema  # trivially learnable: target equals the 'ema' feature
    return df[FEATURE_NAMES], pd.Series(target)


def test_train_beats_baseline_on_an_easy_synthetic_task():
    X, y = _synthetic_dataset()
    split = len(X) // 2
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]

    naive_predictions = X_test["last_score"].tolist()  # the noisier baseline

    model = train(X_train, y_train, X_test, y_test, naive_predictions)

    assert model.beats_baseline


def test_train_returns_a_usable_forecaster():
    X, y = _synthetic_dataset()
    split = len(X) // 2
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]
    naive_predictions = X_test["last_score"].tolist()

    model = train(X_train, y_train, X_test, y_test, naive_predictions)
    forecaster = Forecaster(model)

    assert forecaster.is_model_loaded
    result = forecaster.predict(dict(zip(FEATURE_NAMES, X_test.iloc[0].tolist())))
    assert 0.0 <= result.expected_egsi <= 1000.0


# ---------------------------------------------------------------------------
# Model loading.
#
# main.py previously never loaded a trained model at all, so the service
# served its fallback forever no matter how good a model sat in models/.
# These cover the loader and, more importantly, the two gates that must
# refuse a model rather than serve something misleading.
# ---------------------------------------------------------------------------


def _train_and_save(tmp_path):
    from inference.forecaster import FEATURE_NAMES as names
    import json as _json

    X, y = _synthetic_dataset()
    split = len(X) // 2
    model = train(X.iloc[:split], y.iloc[:split], X.iloc[split:], y.iloc[split:],
                  X.iloc[split:]["last_score"].tolist())
    model.median.save_model(str(tmp_path / "egsi_median.txt"))
    model.low.save_model(str(tmp_path / "egsi_low.txt"))
    model.high.save_model(str(tmp_path / "egsi_high.txt"))
    (tmp_path / "metadata.json").write_text(
        _json.dumps({"beats_baseline": True, "feature_names": names})
    )
    return model


def test_returns_none_when_no_model_has_been_saved(tmp_path):
    from inference.forecaster import load_trained_model
    assert load_trained_model(tmp_path) is None


def test_loads_a_saved_model_and_it_serves_real_forecasts(tmp_path):
    from inference.forecaster import load_trained_model
    _train_and_save(tmp_path)

    loaded = load_trained_model(tmp_path)
    assert loaded is not None

    forecaster = Forecaster(loaded)
    assert forecaster.is_model_loaded
    result = forecaster.predict({name: 400.0 for name in FEATURE_NAMES})
    # The whole point: no longer the fallback.
    assert result.model_version == "egsi-v1"
    assert not result.model_version.endswith("-fallback")


def test_refuses_a_model_that_did_not_beat_its_baseline(tmp_path):
    """ARCHITECTURE.md §4 says ship the baseline in this case. Serving
    the model anyway would be worse than the fallback it replaced."""
    import json as _json
    from inference.forecaster import load_trained_model
    _train_and_save(tmp_path)
    meta = _json.loads((tmp_path / "metadata.json").read_text())
    meta["beats_baseline"] = False
    (tmp_path / "metadata.json").write_text(_json.dumps(meta))

    assert load_trained_model(tmp_path) is None


def test_refuses_a_model_trained_on_a_different_feature_set(tmp_path):
    """A stale model expects a different input shape and would silently
    produce garbage rather than failing loudly."""
    import json as _json
    from inference.forecaster import load_trained_model
    _train_and_save(tmp_path)
    meta = _json.loads((tmp_path / "metadata.json").read_text())
    meta["feature_names"] = ["ema", "rsi"]
    (tmp_path / "metadata.json").write_text(_json.dumps(meta))

    assert load_trained_model(tmp_path) is None


def test_refuses_when_model_files_are_missing_despite_metadata(tmp_path):
    import json as _json
    from inference.forecaster import load_trained_model
    (tmp_path / "metadata.json").write_text(
        _json.dumps({"beats_baseline": True, "feature_names": FEATURE_NAMES})
    )
    assert load_trained_model(tmp_path) is None


# ---------------------------------------------------------------------------
# Evaluation metrics.
# ---------------------------------------------------------------------------


def test_skill_score_is_positive_when_model_beats_baseline():
    from inference.evaluate import _skill_score
    # Model MAE 40 vs baseline 50 = 20% better.
    assert _skill_score(40.0, 50.0) == pytest.approx(20.0)


def test_skill_score_is_negative_when_model_is_worse():
    from inference.evaluate import _skill_score
    assert _skill_score(60.0, 50.0) < 0


def test_skill_score_handles_a_zero_baseline_without_dividing_by_zero():
    from inference.evaluate import _skill_score
    assert _skill_score(10.0, 0.0) == 0.0


def test_rmse_penalises_large_errors_more_than_mae():
    from inference.baseline import mean_absolute_error
    from inference.evaluate import _rmse
    actual = [0.0, 0.0, 0.0, 0.0]
    predicted = [0.0, 0.0, 0.0, 40.0]  # one big miss
    assert _rmse(actual, predicted) > mean_absolute_error(actual, predicted)


def test_expected_coverage_matches_the_trained_quantile_band():
    """The calibration check is only meaningful if the expected coverage
    is derived from the actual quantiles the model was trained on."""
    from inference.evaluate import EXPECTED_COVERAGE
    from inference.forecaster import QUANTILE_HIGH, QUANTILE_LOW
    assert EXPECTED_COVERAGE == pytest.approx(QUANTILE_HIGH - QUANTILE_LOW)


def test_evaluate_reports_every_metric_the_report_needs():
    import pandas as pd
    from inference.evaluate import evaluate

    X, y = _synthetic_dataset(n=600)
    df = X.copy()
    df["target"] = y
    metrics = evaluate(df, horizon=10)

    for key in (
        "model_mae", "model_rmse", "last_value_mae", "moving_average_mae",
        "skill_vs_last_value", "band_coverage", "directional_accuracy",
        "beats_baseline", "mean_band_width",
    ):
        assert key in metrics, f"missing metric: {key}"
    assert 0.0 <= metrics["band_coverage"] <= 1.0
    assert 0.0 <= metrics["directional_accuracy"] <= 1.0


def test_evaluate_reports_the_climatology_baseline():
    """The constant-mean baseline is what distinguishes forecasting from
    mean-reversion on a mean-reverting series; it must always be
    reported, not just the flattering no-change one."""
    from inference.evaluate import evaluate

    X, y = _synthetic_dataset(n=600)
    df = X.copy()
    df["target"] = y
    metrics = evaluate(df, horizon=10)

    assert "climatology_mae" in metrics
    assert "skill_vs_climatology" in metrics
    assert metrics["climatology_mae"] > 0
