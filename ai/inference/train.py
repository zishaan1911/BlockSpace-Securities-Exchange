"""Trains the EGSI forecast model and saves it to ai/models/ (ARCHITECTURE.md
§4). Run from the ai/ directory:

    python -m inference.train --history path/to/egsi_history.csv

`--history` must be a CSV with one row per past cycle, columns: ema, rsi,
momentum, last_score, base_fee, utilization, mempool_pressure,
gas_volatility, target (target = the EGSI score one cycle later — i.e.
what the model is trying to predict from that row's features). Building
that CSV from real accumulated history is a separate, ongoing job (e.g. a
small script logging every features/history.py + features/egsi.py output
over time) — this module only trains against whatever CSV it's given.

With no --history (or too little data), generates a synthetic
mean-reverting dataset instead, purely so this script — and the on-disk
model format it produces — can be exercised end-to-end without real
historical EGSI data, which doesn't exist yet for a brand-new market.
Never treat a synthetic-trained model as fit to serve real forecasts;
it exists to prove the pipeline works, not to predict anything real.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from inference.baseline import last_value
from inference.forecaster import FEATURE_NAMES, train

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def _synthetic_history(n: int = 400, seed: int = 0) -> pd.DataFrame:
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
            "last_score": raw,
            "base_fee": np.zeros(n),
            "utilization": np.zeros(n),
            "mempool_pressure": np.zeros(n),
            "gas_volatility": np.zeros(n),
            "thetanuts_iv": np.zeros(n),
            "thetanuts_skew": np.zeros(n),
        }
    )
    df["target"] = df["ema"]
    return df


def _load_history(path: str | None) -> pd.DataFrame:
    if path is None:
        print("No --history given — generating a synthetic dataset (pipeline check only, NOT real training data).")
        return _synthetic_history()
    df = pd.read_csv(path)
    missing = set(FEATURE_NAMES + ["target"]) - set(df.columns)
    if missing:
        raise ValueError(f"history CSV is missing required columns: {sorted(missing)}")
    return df


def main(history_path: str | None = None, test_fraction: float = 0.2) -> None:
    df = _load_history(history_path)
    split = int(len(df) * (1 - test_fraction))
    if split < 10 or len(df) - split < 10:
        raise ValueError(f"not enough rows to train/test split (got {len(df)}); need at least ~50")

    train_df, test_df = df.iloc[:split], df.iloc[split:]
    X_train, y_train = train_df[FEATURE_NAMES], train_df["target"]
    X_test, y_test = test_df[FEATURE_NAMES], test_df["target"]

    # last_value baseline, evaluated on the test split: each row's own
    # last_score feature *is* the naive "predict no change" forecast for
    # that row's target.
    naive_predictions = [last_value([v]) for v in X_test["last_score"]]

    model = train(X_train, y_train, X_test, y_test, naive_predictions)

    MODELS_DIR.mkdir(exist_ok=True)
    model.median.save_model(str(MODELS_DIR / "egsi_median.txt"))
    model.low.save_model(str(MODELS_DIR / "egsi_low.txt"))
    model.high.save_model(str(MODELS_DIR / "egsi_high.txt"))
    (MODELS_DIR / "metadata.json").write_text(
        json.dumps(
            {
                "beats_baseline": model.beats_baseline,
                "feature_names": FEATURE_NAMES,
                "train_rows": len(train_df),
                "test_rows": len(test_df),
            },
            indent=2,
        )
    )

    print(f"beats_baseline={model.beats_baseline}  (train={len(train_df)} rows, test={len(test_df)} rows)")
    if not model.beats_baseline:
        print(
            "WARNING: model did not beat the naive baseline on this split — "
            "per ARCHITECTURE.md §4, the service should ship the baseline, "
            "not this model. Saved anyway for inspection; do not load it "
            "into Forecaster for serving."
        )
    print(f"Saved to {MODELS_DIR}/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", default=None, help="path to a CSV of accumulated EGSI history")
    parser.add_argument("--test-fraction", type=float, default=0.2, help="fraction of rows held out for testing")
    args = parser.parse_args()
    main(history_path=args.history, test_fraction=args.test_fraction)
