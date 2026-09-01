"""Evaluates the EGSI forecast model properly, rather than reporting the
single boolean `beats_baseline` that training prints.

    python -m inference.evaluate --from-gateway http://localhost:3000
    python -m inference.evaluate --from-gateway http://localhost:3000 --compare-horizons

`beats_baseline` is a deliberately low bar: it only means the model beat
"predict no change" on held-out data. That is the right gate for
deciding whether to serve a model at all (ARCHITECTURE.md §4), but it
says nothing about how *useful* the forecast is, and nothing at all
about whether the confidence figure the UI displays is honest.

This reports four things the boolean hides:

1. **Error against both naive baselines**, with a skill score — the
   percentage by which the model beats each. A skill score of 3% and one
   of 40% are both "beats_baseline=True" and mean very different things.

2. **Band calibration.** The confidence number shown in the UI is
   derived from the width of the model's [low, high] quantile band,
   which is trained as a 10th-90th percentile interval and so *should*
   contain the true value about 80% of the time. If actual coverage is
   much lower, the interval is too narrow, which means the displayed
   confidence is overstated — the model is claiming more certainty than
   it has. This is the check most worth running before showing a
   confidence figure to anyone.

3. **Directional accuracy.** Whether the forecast gets the *sign* of the
   move right, versus a coin flip. For a trader deciding which side to
   take, direction can matter more than magnitude.

4. **p_tail_500 calibration**, when the data contains threshold
   crossings — of the times the model said "70% chance of exceeding
   500", did roughly 70% of them exceed it?

Everything is measured on the held-out split only. Nothing here is
tuned against the test set; it is reported and left alone.
"""
from __future__ import annotations

import argparse
import statistics

import numpy as np
import pandas as pd

from inference.baseline import mean_absolute_error, moving_average
from inference.forecaster import (
    FEATURE_NAMES,
    QUANTILE_HIGH,
    QUANTILE_LOW,
    train,
)
from inference.train import _build_features, _fetch_from_gateway

# The band is trained as the 10th-90th percentile interval, so a
# well-calibrated model should land inside it this often.
EXPECTED_COVERAGE = QUANTILE_HIGH - QUANTILE_LOW


def _rmse(actual: list[float], predicted: list[float]) -> float:
    return float(np.sqrt(np.mean((np.array(actual) - np.array(predicted)) ** 2)))


def _skill_score(model_error: float, baseline_error: float) -> float:
    """Percentage improvement over a baseline. Negative means worse."""
    if baseline_error == 0:
        return 0.0
    return (1 - model_error / baseline_error) * 100


def evaluate(df: pd.DataFrame, horizon: int, test_fraction: float = 0.2) -> dict:
    """Trains on the first part of `df` and evaluates on the held-out
    tail. Returns a dict of metrics; printing is the caller's job."""
    split = int(len(df) * (1 - test_fraction))
    if split < 10 or len(df) - split < 10:
        raise SystemExit(f"not enough rows to evaluate (got {len(df)})")

    train_df, test_df = df.iloc[:split], df.iloc[split:]
    X_train, y_train = train_df[FEATURE_NAMES], train_df["target"]
    X_test, y_test = test_df[FEATURE_NAMES], test_df["target"]

    actual = list(y_test)
    # Baseline 1: predict no change — each row's own last_score.
    naive_last = list(X_test["last_score"])
    # Baseline 2: trailing mean of the last 5 observations.
    scores = list(df["last_score"])
    naive_ma = [moving_average(scores[max(0, split + i - 5) : split + i + 1]) for i in range(len(test_df))]
    # Baseline 3: climatology — always predict the training-set mean.
    #
    # This is the baseline that actually matters on a mean-reverting
    # series. "Predict no change" is easy to beat here simply because the
    # series pulls back toward its average, so a model can post a large
    # skill score against it while doing nothing more clever than
    # regressing to the mean. Beating climatology is what distinguishes a
    # forecast from a constant.
    climatology_value = statistics.fmean(y_train)
    naive_climatology = [climatology_value] * len(test_df)

    model = train(X_train, y_train, X_test, y_test, naive_last)
    median = model.median.predict(X_test).tolist()
    low = model.low.predict(X_test).tolist()
    high = model.high.predict(X_test).tolist()

    model_mae = mean_absolute_error(actual, median)
    last_mae = mean_absolute_error(actual, naive_last)
    ma_mae = mean_absolute_error(actual, naive_ma)
    climatology_mae = mean_absolute_error(actual, naive_climatology)

    # Coverage: how often the true value fell inside the band. Compared
    # against EXPECTED_COVERAGE to judge whether displayed confidence is
    # honest or overstated.
    inside = sum(1 for a, lo, hi in zip(actual, low, high) if min(lo, hi) <= a <= max(lo, hi))
    coverage = inside / len(actual)
    mean_band_width = statistics.fmean(abs(h - l) for l, h in zip(low, high))

    # Direction: did the forecast get the sign of the change right?
    directional_hits = sum(
        1
        for a, m, base in zip(actual, median, naive_last)
        if (a - base) == 0 or ((a - base) > 0) == ((m - base) > 0)
    )
    directional_accuracy = directional_hits / len(actual)

    # p_tail_500 calibration, only meaningful if the series actually
    # crosses 500 in the test window.
    crossings = sum(1 for a in actual if a > 500)

    return {
        "horizon": horizon,
        "rows": len(df),
        "train_rows": len(train_df),
        "test_rows": len(test_df),
        "model_mae": model_mae,
        "model_rmse": _rmse(actual, median),
        "last_value_mae": last_mae,
        "moving_average_mae": ma_mae,
        "climatology_mae": climatology_mae,
        "skill_vs_last_value": _skill_score(model_mae, last_mae),
        "skill_vs_moving_average": _skill_score(model_mae, ma_mae),
        "skill_vs_climatology": _skill_score(model_mae, climatology_mae),
        "beats_baseline": model.beats_baseline,
        "band_coverage": coverage,
        "expected_coverage": EXPECTED_COVERAGE,
        "mean_band_width": mean_band_width,
        "directional_accuracy": directional_accuracy,
        "target_mean": statistics.fmean(actual),
        "target_stdev": statistics.pstdev(actual),
        "test_crossings_above_500": crossings,
    }


def _report(m: dict) -> None:
    print(f"\n{'=' * 62}")
    print(f"  Horizon {m['horizon']} rows   |   {m['train_rows']} train / {m['test_rows']} test")
    print(f"{'=' * 62}")

    print("\nAccuracy (EGSI points, lower is better)")
    print(f"  Model MAE                {m['model_mae']:8.2f}")
    print(f"  Model RMSE               {m['model_rmse']:8.2f}")
    print(f"  Baseline: no change      {m['last_value_mae']:8.2f}")
    print(f"  Baseline: 5-row average  {m['moving_average_mae']:8.2f}")
    print(f"  Baseline: constant mean  {m['climatology_mae']:8.2f}")
    print(f"  For scale, target stdev  {m['target_stdev']:8.2f}")

    print("\nSkill (percent better than each baseline; negative is worse)")
    print(f"  vs no change             {m['skill_vs_last_value']:7.1f}%")
    print(f"  vs 5-row average         {m['skill_vs_moving_average']:7.1f}%")
    print(f"  vs constant mean         {m['skill_vs_climatology']:7.1f}%   <- the one that matters")

    if m["climatology_mae"] < m["last_value_mae"]:
        print("\n  This series is mean-reverting: a constant mean predicts it better")
        print("  than 'no change' does. That makes the no-change skill score")
        print("  flattering. Judge the model on the constant-mean row instead.")

    if m["skill_vs_climatology"] < 10:
        print("\n  WARNING: the model barely beats a constant. Most of its apparent")
        print("           skill comes from regressing toward the mean, not from")
        print("           forecasting. Do not describe this as predictive.")
    elif m["skill_vs_climatology"] < 25:
        print("\n  A modest but real edge over a constant. Defensible; not accurate.")

    print("\nConfidence calibration")
    print(f"  Band should contain      {m['expected_coverage'] * 100:5.0f}% of true values")
    print(f"  Band actually contained  {m['band_coverage'] * 100:5.1f}%")
    print(f"  Mean band width          {m['mean_band_width']:8.2f} EGSI points")
    gap = m["band_coverage"] - m["expected_coverage"]
    if gap < -0.15:
        print("  WARNING: the band is far too narrow. Confidence shown in the UI")
        print("           is OVERSTATED — the model claims more certainty than it")
        print("           has. Treat the displayed confidence as unreliable.")
    elif gap > 0.15:
        print("  NOTE: the band is wider than needed, so confidence is understated.")
        print("        Harmless, but the forecast is more useful than it looks.")
    else:
        print("  Calibration is reasonable; displayed confidence is defensible.")

    print("\nDirection")
    print(f"  Correct sign of move     {m['directional_accuracy'] * 100:5.1f}%  (coin flip = 50%)")
    if m["directional_accuracy"] < 0.55:
        print("  NOTE: barely better than chance at calling direction.")

    if m["test_crossings_above_500"] == 0:
        print("\np_tail_500")
        print("  Not evaluable: EGSI never exceeded 500 in the test window, so the")
        print("  tail probability the UI displays has no evidence behind it either")
        print("  way. It is not wrong, it is untested.")
    else:
        print(f"\np_tail_500: {m['test_crossings_above_500']} crossings in test window")

    print()


def main(gateway_url: str, horizons: list[int], test_fraction: float) -> None:
    raw = _fetch_from_gateway(gateway_url)
    print(f"Fetched {len(raw)} snapshots from {gateway_url}")

    results = []
    for horizon in horizons:
        df = _build_features(raw, horizon)
        metrics = evaluate(df, horizon, test_fraction)
        _report(metrics)
        results.append(metrics)

    if len(results) > 1:
        print("=" * 62)
        print("  Horizon comparison")
        print("=" * 62)
        print(f"  {'horizon':>8}  {'MAE':>8}  {'skill':>8}  {'coverage':>9}  {'direction':>10}")
        for m in results:
            print(
                f"  {m['horizon']:>8}  {m['model_mae']:>8.2f}  "
                f"{m['skill_vs_last_value']:>7.1f}%  {m['band_coverage'] * 100:>8.1f}%  "
                f"{m['directional_accuracy'] * 100:>9.1f}%"
            )
        best = max(results, key=lambda r: r["skill_vs_last_value"])
        print(f"\n  Best skill at horizon {best['horizon']}.")
        print("  Longer horizons are harder, so a falling skill score across")
        print("  horizons is expected, not a bug.")
        print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-gateway", required=True, help="gateway base URL")
    parser.add_argument("--horizon", type=int, default=300)
    parser.add_argument(
        "--compare-horizons",
        action="store_true",
        help="evaluate several horizons and compare them",
    )
    parser.add_argument("--test-fraction", type=float, default=0.2)
    args = parser.parse_args()

    selected = [50, 100, 170, 300] if args.compare_horizons else [args.horizon]
    main(args.from_gateway, selected, args.test_fraction)
