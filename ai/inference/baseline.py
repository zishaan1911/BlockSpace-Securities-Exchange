"""Naive forecast baselines (ARCHITECTURE.md §4) the LightGBM model must
beat out-of-sample before it's trusted; otherwise the service ships one
of these instead (see forecaster.py's beats_baseline gate)."""
from __future__ import annotations

import statistics


def last_value(history: list[float]) -> float:
    """Forecast = the most recently observed value."""
    if not history:
        raise ValueError("history must be non-empty")
    return float(history[-1])


def moving_average(history: list[float], window: int = 5) -> float:
    """Forecast = mean of the last `window` observations (or all of
    history, if shorter)."""
    if not history:
        raise ValueError("history must be non-empty")
    if window < 1:
        raise ValueError("window must be at least 1")
    tail = history[-window:]
    return statistics.fmean(tail)


def mean_absolute_error(actual: list[float], predicted: list[float]) -> float:
    if len(actual) != len(predicted):
        raise ValueError("actual and predicted must be the same length")
    if not actual:
        raise ValueError("actual/predicted must be non-empty")
    return statistics.fmean(abs(a - p) for a, p in zip(actual, predicted))
