"""A statistical baseline forecast, served when no learned model beats it.

ARCHITECTURE.md §4 says the model "must beat naive baselines
out-of-sample; otherwise ship the baseline". This is that baseline, as a
real forecast rather than an apologetic placeholder.

That framing matters. Measured on 2,704 real readings, the LightGBM
level model scored MAE 49.7 against the constant mean's 46.5 — the
baseline is not a fallback standing in for a better answer, it *is* the
best available answer. EGSI is strongly mean-reverting, and for a
mean-reverting series the historical mean genuinely is the
minimum-error prediction at any meaningful horizon. Serving it is the
correct engineering outcome, not a degraded one.

What this fixes versus the previous hard-coded fallback:

* The old fallback returned a fixed 500.0 with a fixed 0.3 confidence,
  regardless of the data. It never moved, which is why the UI called it
  a placeholder.
* This tracks the actual series, and derives confidence and
  `p_tail_500` from *measured* history rather than from a quantile band
  that was separately shown to be mis-calibrated (56-58% coverage
  against the 80% it was trained for).

Confidence here means something specific and defensible: how tightly the
recent series has clustered, expressed on the same 0-1 scale the API
already uses. It is not a probability that the forecast is right.
"""
from __future__ import annotations

import math
import statistics

from schemas import ForecastOutput

BASELINE_VERSION = "egsi-baseline-v1"

# The forecast is the mean of this many recent readings. Long enough to
# be stable, short enough to follow a genuine regime change rather than
# averaging across one.
MEAN_WINDOW = 200

# Confidence is derived by comparing recent dispersion against this
# reference spread. A series with a standard deviation at or above this
# reads as maximally uncertain; a perfectly flat one reads as certain.
# 120 EGSI points is roughly twice the ~55-67 stdev observed in real
# collected data, so ordinary conditions land mid-scale with headroom in
# both directions rather than pinning at either end.
REFERENCE_SPREAD = 120.0

# Below this many readings there is not enough history to characterise
# the series, so the service should keep saying so rather than inventing
# a confident-looking number.
MIN_HISTORY = 10


class BaselineForecaster:
    """Forecasts EGSI as the recent mean, with confidence and tail
    probability computed from observed history.

    Deliberately has the same `predict`-shaped surface as `Forecaster`
    so `main.py` can hold either without special-casing, but it takes
    the raw score history rather than a feature dict — it has no model
    and no features, which is the point.
    """

    def __init__(self, window: int = MEAN_WINDOW):
        self.window = window

    def is_ready(self, scores: list[int]) -> bool:
        return len(scores) >= MIN_HISTORY

    def predict(self, scores: list[int]) -> ForecastOutput | None:
        """Returns None when there is too little history to say anything
        honest, so the caller can report 503 rather than a fabricated
        number."""
        if not self.is_ready(scores):
            return None

        recent = scores[-self.window :]
        expected = statistics.fmean(recent)
        spread = statistics.pstdev(recent) if len(recent) > 1 else 0.0

        return ForecastOutput(
            expected_egsi=round(expected, 1),
            confidence=_confidence_from_spread(spread),
            p_tail_500=_empirical_tail_probability(recent, 500.0),
            model_version=BASELINE_VERSION,
        )


def _confidence_from_spread(spread: float, reference: float = REFERENCE_SPREAD) -> float:
    """Tighter recent history means a more trustworthy mean.

    Linear in the spread rather than anything fancier: the quantile-band
    approach it replaces was more sophisticated and measurably wrong
    (56-58% coverage against 80% expected), so this errs toward a number
    whose meaning is obvious from its definition.
    """
    if reference <= 0:
        raise ValueError("reference spread must be positive")
    return max(0.0, min(1.0, 1.0 - spread / reference))


def _empirical_tail_probability(scores: list[int], threshold: float) -> float:
    """P(EGSI > threshold), as the observed frequency in recent history.

    Honest by construction: if the series has never approached the
    threshold, this reports ~0 rather than extrapolating from a
    distributional assumption the data does not support. The previous
    implementation inferred this from a normal approximation to a
    quantile band, and evaluation could not validate it at all because
    EGSI never crossed 500 in the test window.

    Uses Laplace smoothing so a window that happens to contain no
    crossings reports a small positive probability rather than a flat
    zero — "never observed" is not the same claim as "impossible".
    """
    if not scores:
        return 0.0
    crossings = sum(1 for s in scores if s > threshold)
    return (crossings + 1) / (len(scores) + 2)
