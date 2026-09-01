"""Runs the model variants worth trying on real EGSI history, each
against the baseline that can actually embarrass it.

    python -m inference.experiment --from-gateway http://localhost:3000

Background: the original level model lost to a constant mean at every
horizon (-2.5% to -3.4% skill), while appearing to beat "predict no
change" by 25-35%. That gap is what mean reversion does to a naive
baseline, and it is the reason every comparison here is against the
harder baseline rather than the flattering one.

Four things are varied:

* **Horizon.** The original 300 rows is ~1.75h at the observed cadence,
  long enough for mean reversion to absorb the signal. Short horizons
  are where autocorrelation still exists.
* **Features.** Original ten versus the richer set in
  features/engineering.py — lags, rolling z-scores, and time-of-day,
  which the original model was entirely blind to despite gas having
  strong daily seasonality.
* **Target.** Level versus direction. Predicting the level of a
  mean-reverting series at long horizon is close to asking for its
  unconditional mean; direction is a better-posed question.
* **Baseline.** Levels are scored against a constant mean; directions
  against a mean-reversion rule, not against 50%. A classifier that
  beats a coin flip but loses to "predict toward the mean" has learned
  nothing that was not already free.
"""
from __future__ import annotations

import argparse
import statistics

import lightgbm as lgb
import numpy as np
import pandas as pd

from features.engineering import (
    add_targets,
    build_rich_features,
    feature_columns,
    reversion_direction_baseline,
)
from inference.baseline import mean_absolute_error
from inference.train import _fetch_from_gateway, _normalise_columns

HORIZONS = (5, 20, 50, 100, 300)


def _split(df: pd.DataFrame, test_fraction: float = 0.2):
    split = int(len(df) * (1 - test_fraction))
    return df.iloc[:split], df.iloc[split:]


def run_level(df: pd.DataFrame, columns: list[str], horizon: int) -> dict:
    """Trains a level regressor and scores it against a constant mean."""
    usable = df.dropna(subset=columns + ["target"])
    if len(usable) < 100:
        return {"horizon": horizon, "skipped": f"only {len(usable)} usable rows"}
    train_df, test_df = _split(usable)

    model = lgb.train(
        {"objective": "regression", "verbosity": -1, "min_data_in_leaf": 20, "learning_rate": 0.05},
        lgb.Dataset(train_df[columns], label=train_df["target"]),
        num_boost_round=300,
    )
    actual = list(test_df["target"])
    predicted = model.predict(test_df[columns]).tolist()
    constant = [float(train_df["target"].mean())] * len(actual)

    model_mae = mean_absolute_error(actual, predicted)
    constant_mae = mean_absolute_error(actual, constant)
    return {
        "horizon": horizon,
        "model_mae": model_mae,
        "constant_mae": constant_mae,
        "skill_vs_constant": (1 - model_mae / constant_mae) * 100 if constant_mae else 0.0,
        "rows": len(usable),
    }


def run_direction(df: pd.DataFrame, columns: list[str], horizon: int) -> dict:
    """Trains a direction classifier and scores it against mean reversion.

    The reversion baseline is the important one: on a mean-reverting
    series, "predict toward the mean" is already well above a coin flip,
    so beating 50% demonstrates nothing.
    """
    usable = df.dropna(subset=columns + ["target_direction"])
    if len(usable) < 100:
        return {"horizon": horizon, "skipped": f"only {len(usable)} usable rows"}
    train_df, test_df = _split(usable)

    model = lgb.train(
        {"objective": "binary", "verbosity": -1, "min_data_in_leaf": 20, "learning_rate": 0.05},
        lgb.Dataset(train_df[columns], label=train_df["target_direction"]),
        num_boost_round=300,
    )
    actual = np.array(test_df["target_direction"])
    probability = np.array(model.predict(test_df[columns]))
    predicted = (probability > 0.5).astype(int)

    accuracy = float((predicted == actual).mean())
    reversion = np.array(reversion_direction_baseline(test_df))
    reversion_accuracy = float((reversion == actual).mean())
    # Always guessing the more common class — the other free baseline.
    majority = int(round(train_df["target_direction"].mean()))
    majority_accuracy = float((actual == majority).mean())

    return {
        "horizon": horizon,
        "accuracy": accuracy,
        "reversion_accuracy": reversion_accuracy,
        "majority_accuracy": majority_accuracy,
        "edge_over_reversion": (accuracy - reversion_accuracy) * 100,
        "edge_over_majority": (accuracy - majority_accuracy) * 100,
        # A directional model has to beat BOTH free baselines. Beating
        # mean reversion while losing to "always guess the same way" is
        # not an edge, and reporting it as one was a real bug here.
        "beats_both": accuracy > reversion_accuracy and accuracy > majority_accuracy,
        "rows": len(usable),
    }


def main(gateway_url: str) -> None:
    raw = _normalise_columns(_fetch_from_gateway(gateway_url))
    print(f"Fetched {len(raw)} snapshots\n")

    rich = build_rich_features(raw)
    rich_columns = [c for c in rich.columns if c != "score"] + ["score"]

    print("=" * 72)
    print("  LEVEL forecasting, scored against a constant mean")
    print("=" * 72)
    print(f"  {'horizon':>8}  {'model MAE':>10}  {'constant':>10}  {'skill':>8}")
    level_results = []
    for horizon in HORIZONS:
        result = run_level(add_targets(rich, horizon), rich_columns, horizon)
        level_results.append(result)
        if "skipped" in result:
            print(f"  {horizon:>8}  {result['skipped']}")
        else:
            print(
                f"  {horizon:>8}  {result['model_mae']:>10.2f}  "
                f"{result['constant_mae']:>10.2f}  {result['skill_vs_constant']:>7.1f}%"
            )

    print("\n" + "=" * 72)
    print("  DIRECTION forecasting, scored against mean reversion")
    print("=" * 72)
    print(f"  {'horizon':>8}  {'model':>8}  {'reversion':>10}  {'majority':>9}  {'edge':>8}")
    direction_results = []
    for horizon in HORIZONS:
        result = run_direction(add_targets(rich, horizon), rich_columns, horizon)
        direction_results.append(result)
        if "skipped" in result:
            print(f"  {horizon:>8}  {result['skipped']}")
        else:
            print(
                f"  {horizon:>8}  {result['accuracy'] * 100:>7.1f}%  "
                f"{result['reversion_accuracy'] * 100:>9.1f}%  "
                f"{result['majority_accuracy'] * 100:>8.1f}%  "
                f"{result['edge_over_reversion']:>7.1f}pp  "
                f"{'yes' if result['beats_both'] else 'no':>11}"
            )

    print("\n" + "=" * 72)
    print("  Verdict")
    print("=" * 72)

    best_level = max((r for r in level_results if "skill_vs_constant" in r),
                     key=lambda r: r["skill_vs_constant"], default=None)
    if best_level and best_level["skill_vs_constant"] > 5:
        print(f"  Level: usable at horizon {best_level['horizon']} "
              f"({best_level['skill_vs_constant']:.1f}% over a constant).")
    else:
        best = best_level["skill_vs_constant"] if best_level else 0.0
        print(f"  Level: still not usable. Best is {best:.1f}% over a constant.")
        print("         Predicting the level of a mean-reverting series is close to")
        print("         asking for its average; that is a property of the data, not")
        print("         a shortcoming of the model. More capacity will not fix it.")

    # Rank only among models that beat both baselines. A large edge over
    # reversion means nothing if the majority class beats the model.
    qualified = [r for r in direction_results if r.get("beats_both")]
    best_dir = max(qualified, key=lambda r: r["edge_over_reversion"], default=None)
    if best_dir and best_dir["edge_over_reversion"] > 1:
        print(f"\n  Direction: real edge at horizon {best_dir['horizon']} — "
              f"{best_dir['accuracy'] * 100:.1f}% vs {best_dir['reversion_accuracy'] * 100:.1f}% "
              f"for mean reversion alone.")
        print("             This is worth serving, and worth saying plainly that it")
        print("             predicts direction rather than level.")
    else:
        print("\n  Direction: no horizon beats BOTH free baselines. Any apparent")
        print("             edge over mean reversion is cancelled by the majority")
        print("             class -- at long horizons the series moves mostly one")
        print("             way, so 'always guess down' is very hard to beat.")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-gateway", required=True)
    args = parser.parse_args()
    main(args.from_gateway)
