"""AI Forecast (ARCHITECTURE.md §4): "one small model, not an ensemble."

A single LightGBM point (median) regressor gives the expected_egsi value.
Two more LightGBM quantile regressors (low/high) trained on the same
features give a "simple quantile band" around it — per §4's spec — which
is all that's needed to derive both a confidence score and P(EGSI >
500) without a full probabilistic model: the band is treated as a normal
distribution's ~80% interval (median = mean, band width -> stdev), then
confidence is read off the band's width and p_tail_500 off that
distribution's survival function at 500.

Falls back to a naive baseline (baseline.py) if the model doesn't beat it
out-of-sample (§4: "must beat naive baselines out-of-sample; otherwise
ship the baseline") — TrainedModel.beats_baseline records that check's
result, and Forecaster refuses to use a model that failed it. Falls back
further, to a hard-coded forecast, if no model is loaded at all or
inference raises — either way the service keeps producing forecasts
rather than erroring out to its caller (§4: "hard-coded fallback forecast
keeps the demo alive if the model fails").
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass

import lightgbm as lgb
import numpy as np

from schemas import ForecastOutput

MODEL_VERSION = "egsi-v1"

# Feature order the model was trained on and predicts against. Keeping
# this as an explicit list (rather than trusting dict key order) means a
# caller passing an incomplete dict fails loudly-but-gracefully: missing
# keys default to 0.0 in predict() rather than raising, since a single
# missing feature (e.g. no history yet for 'momentum') shouldn't take
# down the whole forecast.
FEATURE_NAMES = [
    "ema",
    "rsi",
    "momentum",
    "last_score",
    "base_fee",
    "utilization",
    "mempool_pressure",
    "gas_volatility",
    # Wired in Phase 4 (GOALS.md) — ARCHITECTURE.md §4: "Thetanuts IV/
    # skew signals" as forecast features, on top of the EGSI-history
    # features above. Both default to 0.0 via predict()'s .get(name, 0.0)
    # when no live Thetanuts signal was available for a given cycle (see
    # main.py's CycleRequest/run_cycle) — same graceful-degradation
    # convention as every other feature here.
    "thetanuts_iv",
    "thetanuts_skew",
]

# Used only if no trained model is loaded, or inference raises — keeps
# the service returning *something* rather than a 500 to the API gateway.
# Deliberately conservative: mid-range point estimate, low confidence.
FALLBACK_FORECAST = ForecastOutput(
    expected_egsi=500.0,
    confidence=0.3,
    p_tail_500=0.5,
    model_version=f"{MODEL_VERSION}-fallback",
)

QUANTILE_LOW = 0.1
QUANTILE_HIGH = 0.9
# For a normal distribution, z(0.9) - z(0.1) standard deviations separate
# those two quantiles — used to convert the [low, high] band into an
# implied stdev under the normal approximation.
_Z_SPREAD = 2 * 1.2815515655446004  # z(0.9) for a standard normal, doubled


@dataclass(frozen=True)
class TrainedModel:
    median: lgb.Booster
    low: lgb.Booster
    high: lgb.Booster
    beats_baseline: bool


def _clamp_score(x: float) -> float:
    return max(0.0, min(1000.0, x))


def _standard_normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2)))


def _confidence_from_band(low: float, high: float, full_range: float = 1000.0) -> float:
    """Narrower [low, high] -> higher confidence. A band spanning the
    entire 0-1000 EGSI range reads as ~0 confidence; a zero-width band
    reads as 1. Deliberately simple, matching §4's "simple quantile
    band" — not a calibrated probabilistic confidence."""
    width = max(0.0, high - low)
    return max(0.0, min(1.0, 1.0 - width / full_range))


def _p_exceeds(threshold: float, median: float, low: float, high: float) -> float:
    """P(EGSI > threshold) under a normal approximation: median as the
    mean, (high - low) / _Z_SPREAD as the implied standard deviation."""
    spread = max(high - low, 1e-6)
    sigma = spread / _Z_SPREAD
    z = (threshold - median) / sigma
    return max(0.0, min(1.0, 1.0 - _standard_normal_cdf(z)))


class Forecaster:
    """Wraps an optional TrainedModel. With no model loaded (the
    constructor's default), or a model that didn't beat baseline,
    predict() always returns FALLBACK_FORECAST — the service is usable
    from a cold start, before inference/train.py has ever produced a
    trained model."""

    def __init__(self, model: TrainedModel | None = None):
        self._model = model

    @property
    def is_model_loaded(self) -> bool:
        return self._model is not None and self._model.beats_baseline

    def predict(self, features: dict[str, float]) -> ForecastOutput:
        if not self.is_model_loaded:
            return FALLBACK_FORECAST
        try:
            x = np.array([[features.get(name, 0.0) for name in FEATURE_NAMES]])
            median = float(self._model.median.predict(x)[0])
            low = float(self._model.low.predict(x)[0])
            high = float(self._model.high.predict(x)[0])
            # A quantile model isn't guaranteed to keep low <= high at
            # every point; enforce it so confidence/p_tail stay sane.
            low, high = min(low, high), max(low, high)

            return ForecastOutput(
                expected_egsi=_clamp_score(median),
                confidence=_confidence_from_band(low, high),
                p_tail_500=_p_exceeds(500.0, median, low, high),
                model_version=MODEL_VERSION,
            )
        except Exception:
            return FALLBACK_FORECAST


def load_trained_model(models_dir) -> TrainedModel | None:
    """Loads a model saved by inference/train.py, or None if there isn't
    one to load.

    Honours the baseline gate: a model whose metadata records
    beats_baseline=false is deliberately NOT loaded, because
    ARCHITECTURE.md §4 says to ship the baseline in that case. Returning
    None there means the service keeps serving its honest fallback
    rather than a model already known to be worse than predicting no
    change.
    """
    from pathlib import Path

    directory = Path(models_dir)
    metadata_path = directory / "metadata.json"
    paths = {name: directory / f"egsi_{name}.txt" for name in ("median", "low", "high")}
    if not metadata_path.exists() or not all(p.exists() for p in paths.values()):
        return None

    try:
        metadata = json.loads(metadata_path.read_text())
        if not metadata.get("beats_baseline", False):
            return None
        if metadata.get("feature_names") != FEATURE_NAMES:
            # Feature set changed since training; the saved model expects
            # a different input shape and would silently produce garbage.
            return None
        return TrainedModel(
            median=lgb.Booster(model_file=str(paths["median"])),
            low=lgb.Booster(model_file=str(paths["low"])),
            high=lgb.Booster(model_file=str(paths["high"])),
            beats_baseline=True,
        )
    except Exception:
        return None


def train(
    X_train,
    y_train,
    X_test,
    y_test,
    naive_predictions: list[float],
) -> TrainedModel:
    """Trains median/low/high LightGBM quantile regressors on the
    training split (X_train/y_train are pandas DataFrame/Series with
    FEATURE_NAMES columns), then checks the median model beats
    `naive_predictions` (e.g. from baseline.last_value/moving_average,
    evaluated against the same y_test targets) on held-out data (§4:
    "must beat naive baselines out-of-sample"). The caller owns the
    train/test split and which baseline(s) to compare against — this
    just fits and evaluates.
    """
    params_common = {"objective": "quantile", "verbosity": -1, "min_data_in_leaf": 5}

    median_model = lgb.train({**params_common, "alpha": 0.5}, lgb.Dataset(X_train, label=y_train))
    low_model = lgb.train({**params_common, "alpha": QUANTILE_LOW}, lgb.Dataset(X_train, label=y_train))
    high_model = lgb.train({**params_common, "alpha": QUANTILE_HIGH}, lgb.Dataset(X_train, label=y_train))

    from inference.baseline import mean_absolute_error

    model_predictions = median_model.predict(X_test).tolist()
    model_mae = mean_absolute_error(list(y_test), model_predictions)
    baseline_mae = mean_absolute_error(list(y_test), naive_predictions)
    beats_baseline = model_mae < baseline_mae

    return TrainedModel(median=median_model, low=low_model, high=high_model, beats_baseline=beats_baseline)
