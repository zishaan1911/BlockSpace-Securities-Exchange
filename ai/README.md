# GASX AI service

Python (FastAPI) service implementing ARCHITECTURE.md §2's AI component:
"Ingest Ethereum data, compute EGSI, forecast, publish oracle." Reads raw
Ethereum chain data, blends it into the Ethereum Gas Stress Index (EGSI,
§3), forecasts it with a small LightGBM model (§4), and — as the one
piece of this service that talks to Sui directly — publishes the current
EGSI value on-chain (§6).

## Modules

| module | responsibility |
|---|---|
| `schemas` | shared Pydantic models — raw metrics, EGSI snapshot, forecast output (matches §4's JSON schema exactly) |
| `config` | environment-driven settings (`pydantic-settings`); see `.env.example` |
| `features/egsi` | pure function: one block's raw metrics -> a 0-1000 EGSI score (§3) |
| `features/history` | rolling EGSI score buffer -> EMA/RSI/momentum features for the forecaster (§4) |
| `ingestion/ethereum` | pulls raw metrics from an Ethereum JSON-RPC endpoint via `web3.py` |
| `inference/baseline` | naive forecasts (`last_value`, `moving_average`) the model must beat |
| `inference/forecaster` | LightGBM quantile-band forecast, confidence, `P(EGSI > 500)`, baseline/fallback gating |
| `inference/train` | CLI: trains and saves a model to `models/` |
| `oracle/publisher` | publishes EGSI to `contracts/gasx`'s `OracleState` on Sui (§6) |
| `main` | FastAPI app wiring all of the above together |

## Run

Requires **Python 3.12+** (`requirements.txt` pins require it) and the
system OpenMP runtime **`libgomp1`** (LightGBM needs it at import time —
`setup.md` installs it).

```bash
cd ai
uv venv venv --python 3.12               # or: python3.12 -m venv venv
uv pip install --python venv/bin/python -r requirements.txt
cp .env.example .env                     # defaults work: public Ethereum RPC; oracle publishing disabled
venv/bin/uvicorn main:app --port 8000
```

The service starts with no snapshot — `GET /egsi/current` returns 503
until a cycle has run:

```bash
curl -X POST http://localhost:8000/cycle -H 'content-type: application/json' -d '{}'
```

(Optional `{"thetanuts_atm_iv": ..., "thetanuts_skew_25delta": ...}`
body wires the Thetanuts vol signal into EGSI — the API gateway's
`POST /api/v1/hedge/sync-signal` does this.)

Oracle publishing (`POST /publish`) stays disabled (501) until
`GASX_AI_SUI_PUBLISHER_PRIVATE_KEY`, `GASX_AI_SUI_PACKAGE_ID` and
`GASX_AI_SUI_ORACLE_OBJECT_ID` are all set in `.env`.

## Test

```bash
cd ai
venv/bin/pytest          # 86 tests; no network needed (ingestion is mocked)
```

If pytest errors out importing an unrelated globally-registered plugin
(e.g. `ModuleNotFoundError: No module named 'lark'` from ROS2's
`launch_testing` package, if you have ROS installed) rather than running
this project's own tests, disable pytest's setuptools-entrypoint plugin
autoload — it doesn't affect this project's own `conftest.py`/tests,
which pytest finds by directory walking regardless:

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/pytest
```

`scripts/test-all.sh` already sets this for you.

**Verified status:**

- **Tested here**: `features/egsi`, `features/history`,
  `inference/baseline`, `inference/forecaster` (including a full
  train -> save -> load -> predict round trip against synthetic data),
  `main`'s FastAPI routes (with ingestion mocked), and
  `ingestion/ethereum`'s parsing/shaping logic (with `web3.py` mocked).
  86 tests pass, type/imports clean.
- **Live-verified on this machine**: a real `POST /cycle` against the
  public Ethereum RPC produced a real EGSI snapshot (score + block
  number + components) and the fallback forecast — so ingestion and the
  fallback path work end-to-end without any keys.
- **Not yet exercised**: `oracle/publisher.OraclePublisher` against Sui
  testnet with a real funded throwaway publisher key (needs a deployed
  package + OracleState). Also worth extra scrutiny when you get there:
  it's built against `pysui` 1.4.x's current async
  `PysuiConfiguration`/`client_factory` API, verified by introspecting
  the actually-installed package rather than from memory — `pysui`
  deprecated and then removed its older synchronous `SuiConfig`/`SyncClient`
  classes (which a lot of tutorials and older docs still show) around
  version 0.98. If the pinned `pysui` version in `requirements.txt` has
  moved again by the time you read this, re-verify `oracle/publisher.py`'s
  calls against it before trusting them.

## Design notes

- **`features/egsi.compute_egsi` is a pure function** — no I/O, no
  global state, same inputs always produce the same output. v1 is a
  hand-tuned weighted sum of `[0, 1]` normalized components (§3): six
  from Ethereum chain data, plus a seventh, Thetanuts ETH implied
  volatility, wired in per GOALS.md's Phase 4. The seventh is optional
  (`compute_egsi`'s `thetanuts_iv` parameter defaults to `None`) — when
  omitted, the blend renormalizes across the remaining six rather than
  treating "no signal" as "no stress." `main.py`'s `POST /cycle` accepts
  it via an optional `CycleRequest` body
  (`thetanuts_atm_iv`/`thetanuts_skew_25delta`); the live wiring is the
  API gateway's `POST /api/v1/hedge/sync-signal`, which pulls the
  Thetanuts vol signal and forwards it into `POST /cycle` (see
  `api/README.md` and `blockchain/thetanuts/README.md`).
  `inference.forecaster.FEATURE_NAMES` includes `thetanuts_iv`/
  `thetanuts_skew` too (§4: "Thetanuts IV/skew signals"), defaulting to
  `0.0` via the same missing-feature handling every other feature uses.
- **Normalization reference points
  (`features/egsi.EgsiNormalizationConfig`) were recalibrated against
  live mainnet on 2026-08-31**, after the original guessed defaults
  turned out to be badly wrong: the base-fee floor sat 35x above the
  real gas price (0.14 gwei), pinning that component at 0.0 on every
  cycle, and the mempool ceiling sat 4x below the real pending count
  (79,361), pinning that one at 1.0. Two of six inputs were dead and
  the failure was silent — EGSI was effectively tracking block
  utilization alone. Base fee is now normalized on a **log** scale,
  because gas prices are log-distributed and a linear scale wastes its
  whole range on the top decade. `tests/test_egsi_features.py` has
  regression guards against both pinning failures. These bounds are
  still fitted to a single observation, not a distribution — worth
  revisiting once `egsi_snapshot` has accumulated real history.
- **The forecaster never raises to its caller.** `inference.Forecaster`
  falls back to `FALLBACK_FORECAST` (a conservative, low-confidence,
  mid-range forecast) whenever no model is loaded, the loaded model
  didn't beat its naive baseline (`TrainedModel.beats_baseline`), or
  inference itself throws — matching §4: "hard-coded fallback forecast
  keeps the demo alive if the model fails."
- **Confidence and `p_tail_500` come from a "simple quantile band"**
  (§4), not a calibrated probabilistic model: three LightGBM regressors
  (median + low/high quantile) share the same features; the band width
  drives confidence, and the band is treated as a normal distribution's
  ~80% interval to derive `P(EGSI > 500)`. Good enough for a demo, not a
  substitute for a properly calibrated model.
- **Training on real history is now the default path.** `POST /cycle`
  runs automatically on Ethereum's block time, the gateway persists
  every reading to MySQL, and `python -m inference.train --from-gateway
  http://localhost:3000` trains on that accumulated history. Derived
  features (EMA/RSI/momentum) are replayed through the *same*
  `features/history.py` the live service uses, so training and serving
  cannot drift apart. `main.py` loads the resulting model at startup.
- **The horizon has to match the market.** EGSI-1H is a one-hour
  product, so `--horizon` defaults to 300 rows — one hour at the default
  12-second cycle. That means meaningful training needs *hours* of
  accumulated readings, not minutes. Until then `train.py` refuses with
  a clear message rather than silently fitting a one-cycle-ahead model
  and calling it an hourly forecast.
- **A model that does not beat its baseline is not served.**
  `load_trained_model` refuses to load one whose metadata records
  `beats_baseline=false`, and also refuses one trained on a different
  feature set (which would silently produce garbage). In both cases the
  service keeps serving its honest fallback and the UI keeps saying so.
  That refusal is the design working, not a bug to route around.
- **`inference/train.py` can still run against synthetic data via
  `--synthetic`** — there's no real accumulated EGSI history for a
  market that doesn't exist yet. This proves the train -> save -> load
  pipeline works, not that the resulting model can forecast anything
  real; never point `main.py` at a synthetic-trained model. Trained
  model files land in `models/` and are gitignored — regenerate them,
  don't commit them.
- **`oracle/publisher` is the one module that talks to Sui directly**,
  bypassing the TypeScript API gateway/Sui adapter, per ARCHITECTURE.md
  §1's system diagram (`AI -->|EGSI update tx| MOVE`). It publishes the
  EGSI **score** (an int, 0-1000 — `oracle.move`'s `price` field is a
  Move `u64`), not the AI forecast's float `expected_egsi`, which is a
  prediction rather than the current index value.
- **`main.py`'s state is in-memory and single-market**, matching
  ARCHITECTURE.md §12's "Cache: in-memory in the API" decision — there's
  only one market (EGSI-1H) for this hackathon, so one `EgsiHistory` /
  `Forecaster` instance is enough. `POST /cycle` (ingest + compute +
  update history) and `POST /publish` (the on-chain write) are
  deliberately separate endpoints — a publish should never happen as a
  side effect of a read/compute loop.
