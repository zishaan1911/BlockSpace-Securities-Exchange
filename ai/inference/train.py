"""Trains the EGSI forecast model and saves it to ai/models/ (ARCHITECTURE.md
§4). Run from the ai/ directory:

    # Train on real accumulated history (preferred)
    python -m inference.train --from-gateway http://localhost:3000

    # Or from a CSV of raw snapshots
    python -m inference.train --history path/to/snapshots.csv

    # Or exercise the pipeline with no data at all
    python -m inference.train --synthetic

`--from-gateway` pulls durable history from GET /api/v1/history. The AI
service never reads the database itself (ARCHITECTURE.md §2 makes the API
gateway the only client), so real history reaches this trainer through
the gateway.

Derived features (EMA/RSI/momentum) are computed here from the raw score
series using the same features/history.py code the live service uses, so
training features and serving features cannot drift apart — a
train/serve skew bug that would otherwise be invisible until the model
performed worse in production than in testing.

**The forecast horizon matters.** EGSI-1H is a one-hour market
(ARCHITECTURE.md §12), so the model should predict EGSI one hour ahead,
not one cycle ahead. At the default 12-second cycle that is 300 rows, so
meaningful training needs *hours* of accumulated history, not minutes.
--horizon makes this explicit rather than silently training a
one-cycle-ahead model and calling it an hourly forecast.

If the trained model does not beat its naive baseline out-of-sample, it
is saved but flagged, and the service will refuse to serve it (§4:
"otherwise ship the baseline"). That refusal is the system working
correctly, not a bug to route around.
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from features.history import EgsiHistory
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


def _fetch_from_gateway(base_url: str, limit: int = 5000) -> pd.DataFrame:
    """Pulls raw snapshots from the gateway's GET /api/v1/history."""
    url = f"{base_url.rstrip('/')}/api/v1/history?limit={limit}"
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = json.loads(response.read())
    rows = payload.get("history", [])
    if not rows:
        raise ValueError(
            f"gateway returned no history from {url}. Let the AI service auto-cycle "
            "for a while first, and check GASX_API_DATABASE_URL is set."
        )
    return pd.DataFrame(rows)


def _build_features(raw: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """Turns raw snapshots into the exact FEATURE_NAMES the forecaster
    expects, plus the target it should predict.

    EMA/RSI/momentum are replayed through features/history.py's own
    EgsiHistory — the same class the live service uses — rather than
    recomputed with pandas here. Reimplementing them would risk a
    train/serve skew that stays invisible until the model quietly
    underperforms in production.

    The target is the score `horizon` rows ahead, so the last `horizon`
    rows are dropped (their future has not happened yet).
    """
    # The gateway returns camelCase (its db.ts maps SQL rows into
    # TypeScript-style names) while a CSV dumped straight from MySQL is
    # snake_case. Normalize once here so either source works, rather
    # than making the caller care which one they used.
    raw = raw.rename(
        columns={
            "baseFee": "base_fee",
            "mempoolPressure": "mempool_pressure",
            "feeMomentum": "fee_momentum",
            "gasVolatility": "gas_volatility",
            "dexActivity": "dex_activity",
            "thetanutsIv": "thetanuts_iv",
            "thetanutsSkew": "thetanuts_skew",
            "blockNumber": "block_number",
        }
    )

    required = {"score", "base_fee", "utilization", "mempool_pressure", "gas_volatility"}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(
            f"history is missing required columns: {sorted(missing)}. "
            f"Got: {sorted(raw.columns)}"
        )

    history = EgsiHistory(max_len=10_000)
    rows = []
    for _, row in raw.iterrows():
        history.push(int(row["score"]))
        derived = history.features()
        rows.append(
            {
                "ema": derived.ema,
                "rsi": derived.rsi,
                "momentum": derived.momentum,
                "last_score": float(row["score"]),
                "base_fee": float(row["base_fee"]),
                "utilization": float(row["utilization"]),
                "mempool_pressure": float(row["mempool_pressure"]),
                "gas_volatility": float(row["gas_volatility"]),
                # Absent Thetanuts signal reads as 0.0, matching how
                # main.py builds the same feature dict when serving.
                "thetanuts_iv": float(row.get("thetanuts_iv") or 0.0),
                "thetanuts_skew": float(row.get("thetanuts_skew") or 0.0),
            }
        )

    df = pd.DataFrame(rows)
    df["target"] = df["last_score"].shift(-horizon)
    return df.dropna(subset=["target"]).reset_index(drop=True)


def _load_history(path: str | None) -> pd.DataFrame:
    if path is None:
        print("No --history given — generating a synthetic dataset (pipeline check only, NOT real training data).")
        return _synthetic_history()
    df = pd.read_csv(path)
    missing = set(FEATURE_NAMES + ["target"]) - set(df.columns)
    if missing:
        raise ValueError(f"history CSV is missing required columns: {sorted(missing)}")
    return df


def main(
    history_path: str | None = None,
    gateway_url: str | None = None,
    synthetic: bool = False,
    horizon: int = 300,
    test_fraction: float = 0.2,
) -> None:
    if gateway_url:
        raw = _fetch_from_gateway(gateway_url)
        print(f"Fetched {len(raw)} snapshots from {gateway_url}")
        df = _build_features(raw, horizon)
        print(f"Built {len(df)} training rows at horizon={horizon} cycles")
    elif history_path:
        raw = pd.read_csv(history_path)
        df = _build_features(raw, horizon)
    elif synthetic:
        print("Synthetic dataset (pipeline check only, NOT real training data).")
        df = _synthetic_history()
    else:
        raise SystemExit(
            "Give one of --from-gateway URL, --history CSV, or --synthetic. "
            "Refusing to silently train on fake data."
        )
    split = int(len(df) * (1 - test_fraction))
    if split < 10 or len(df) - split < 10:
        raise SystemExit(
            f"Not enough history to train: {len(df)} usable rows after applying a "
            f"{horizon}-cycle horizon. Need roughly 50+. At a 12s cycle, a 1-hour "
            f"horizon needs several hours of accumulated readings before this is "
            f"worth running — let it collect and try again."
        )

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
    parser.add_argument("--history", default=None, help="path to a CSV of raw EGSI snapshots")
    parser.add_argument("--from-gateway", default=None, help="gateway base URL, e.g. http://localhost:3000")
    parser.add_argument("--synthetic", action="store_true", help="train on synthetic data (pipeline check only)")
    parser.add_argument(
        "--horizon",
        type=int,
        default=300,
        help="rows ahead to predict. 300 = 1 hour at the default 12s cycle, matching EGSI-1H.",
    )
    parser.add_argument("--test-fraction", type=float, default=0.2, help="fraction of rows held out for testing")
    args = parser.parse_args()
    main(
        history_path=args.history,
        gateway_url=args.from_gateway,
        synthetic=args.synthetic,
        horizon=args.horizon,
        test_fraction=args.test_fraction,
    )
