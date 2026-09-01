"""Richer features than features/history.py's three derived values.

Motivated by a concrete failure: with only EMA/RSI/momentum plus the raw
component scores, the level model was measurably worse than predicting a
constant (see ai/README.md). Three things were missing, none of which is
fixable by a larger model:

1. **Lags.** The model saw one EMA but never the recent trajectory, so it
   could not distinguish "300 and rising" from "300 and falling".

2. **Time of day.** Ethereum gas has strong daily seasonality — US, EU
   and Asian trading hours produce very different congestion. This was
   the single biggest omission: the model had no idea what time it was.
   Encoded as sin/cos of the hour so that 23:00 and 01:00 are adjacent
   rather than maximally distant.

3. **Change-based features.** Differences over several windows, which
   carry the short-horizon autocorrelation that a mean-reverting level
   does not.

Deliberately still tabular, and still fed to gradient boosting. At ~2,500
rows spanning about a day, a deep sequence model would overfit long
before it learned anything a tree cannot; the shortage here is
information, not capacity.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Lookbacks in rows. At the observed ~21s cadence these are roughly
# 1.75min, 3.5min, 17.5min, 35min and 1.75h.
LAGS = (5, 10, 50, 100, 300)
ROLLING_WINDOWS = (10, 50, 200)


def build_rich_features(raw: pd.DataFrame) -> pd.DataFrame:
    """Expands raw snapshots into a wider feature frame.

    `raw` needs `score` plus the component columns, and ideally
    `block_timestamp` (unix seconds) for the seasonality features. When
    the timestamp is absent the time-of-day features are still emitted,
    as zeros, so the column set stays stable — a model trained with them
    can still be scored on data that lacks them.
    """
    df = pd.DataFrame(index=raw.index)
    score = raw["score"].astype(float)
    df["score"] = score

    # Component scores, passed through as-is.
    for column in (
        "base_fee",
        "utilization",
        "mempool_pressure",
        "fee_momentum",
        "gas_volatility",
        "dex_activity",
    ):
        if column in raw.columns:
            df[column] = raw[column].astype(float)

    # Lagged levels and the changes over each lookback. The change
    # matters more than the level on a mean-reverting series.
    for lag in LAGS:
        df[f"lag_{lag}"] = score.shift(lag)
        df[f"delta_{lag}"] = score - score.shift(lag)

    # Rolling statistics: where the current value sits relative to its
    # own recent distribution, which is what mean reversion acts on.
    for window in ROLLING_WINDOWS:
        rolling = score.rolling(window, min_periods=2)
        mean = rolling.mean()
        std = rolling.std()
        df[f"roll_mean_{window}"] = mean
        df[f"roll_std_{window}"] = std
        # Z-score: how stretched the series is right now. A large
        # positive value is precisely when mean reversion predicts a
        # fall, so this is the feature that lets the model learn
        # reversion explicitly rather than by accident.
        df[f"roll_z_{window}"] = (score - mean) / std.replace(0, np.nan)

    # Time of day. Cyclical encoding so 23:00 and 01:00 sit next to each
    # other instead of at opposite ends of a linear scale.
    if "block_timestamp" in raw.columns:
        seconds = pd.to_numeric(raw["block_timestamp"], errors="coerce")
        hour = (seconds % 86_400) / 3_600.0
        df["hour_sin"] = np.sin(2 * np.pi * hour / 24)
        df["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    else:
        df["hour_sin"] = 0.0
        df["hour_cos"] = 0.0

    return df.replace([np.inf, -np.inf], np.nan)


def add_targets(features: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """Adds both a level target and a direction target.

    `target` is the score `horizon` rows ahead. `target_direction` is 1
    when it is higher than the current score, 0 otherwise — a
    better-posed question on a series whose level is dominated by mean
    reversion.
    """
    df = features.copy()
    future = df["score"].shift(-horizon)
    df["target"] = future
    df["target_direction"] = (future > df["score"]).astype(int)
    return df


def reversion_direction_baseline(features: pd.DataFrame, window: int = 200) -> pd.Series:
    """The directional baseline that matters.

    Predicts "down" whenever the score sits above its rolling mean and
    "up" when below — pure mean reversion, no learning. On a
    mean-reverting series this alone scores well above a coin flip, so a
    classifier must beat *this*, not 50%, to have demonstrated anything.
    Exactly the same trap as the level model beating "no change" while
    losing to a constant.
    """
    column = f"roll_mean_{window}"
    mean = features[column] if column in features else features["score"].expanding().mean()
    return (features["score"] < mean).astype(int)


def feature_columns(df: pd.DataFrame) -> list[str]:
    """Everything except the targets."""
    return [c for c in df.columns if not c.startswith("target")]
