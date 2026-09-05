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
| `inference/evaluate` | CLI: measures skill vs both baselines, band calibration, directional accuracy |
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
- **Evaluate before trusting the numbers.** `beats_baseline` is a
  boolean and a deliberately low bar — it only means the model beat
  "predict no change". `python -m inference.evaluate --from-gateway
  http://localhost:3000 --compare-horizons` reports how *much* better,
  whether the confidence figure is honest, and whether direction is
  better than a coin flip. Expect a single-digit skill score: real, but
  marginal, and not the same as accurate.
- **The confidence figure is likely overstated.** The band is trained as
  a 10th-90th percentile interval, so it should contain the true value
  ~80% of the time; measured coverage runs closer to 60%, meaning the
  interval is too narrow and the model claims more certainty than it
  has. `inference/evaluate` warns when it detects this. Widening the
  quantiles, or calibrating the band on held-out data, is the fix —
  neither is done yet.
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
- **The oracle publisher's pysui bootstrap is now exercised directly**
  (`tests/test_oracle_publisher_bootstrap.py`), against the real
  installed pysui package, not a mock. This caught two real bugs on a
  live machine attempting its first publish:
  `PysuiConfiguration(persist=False)` unconditionally requiring an
  already-existing `~/.pysui/PysuiConfig.json` regardless of `persist`
  (fixed by bootstrapping via `initialize_config` in a fresh temp
  directory instead), and the pysui group being built with
  `GroupProtocol.GRAPHQL` instead of `GRPC` — inconsistent with the rest
  of the project's gRPC migration. `publish_price()`'s actual
  move_call/build_and_sign/execute path still has not been exercised
  against a live network and remains the thing to verify next.
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

## What /forecast actually serves

Three possible sources, in priority order:

1. A learned model, **if** it beat its naive baselines out-of-sample.
2. `inference/baseline_forecaster.py` — the recent mean, with confidence
   from measured dispersion and `p_tail_500` from observed frequency.
3. `FALLBACK_FORECAST`, a hard-coded constant, only when there is not
   even enough history for (2).

On real data (2,704 readings) the learned model has **not** qualified:
MAE 49.7 against the constant mean's 46.5, and negative skill at every
horizon. So the baseline is what gets served — and per ARCHITECTURE.md
§4 ("otherwise ship the baseline") that is the specified behaviour, not
a degraded mode. It is also simply the more accurate predictor here.

The baseline replaced a hard-coded 500.0 / 0.3-confidence constant that
never moved. It now tracks the series, and its confidence comes from
measured dispersion rather than the quantile band that evaluation showed
to be mis-calibrated (56-58% coverage against 80% expected).

## Evaluating the model honestly

`beats_baseline` is a boolean and a low bar. Run
`python -m inference.evaluate --from-gateway http://localhost:3000
--compare-horizons` and read the **constant mean** row, not the
no-change row.

**Measured result: the model does not forecast the level.** Skill over a
constant mean came in NEGATIVE at every horizon tested (-2.5% to -3.4%
on 2,550 real readings). It is worse than always predicting the average.
The training gate now checks the harder of the two baselines, so such a
model is no longer served — `/forecast` reports the honest fallback
instead, and the UI banner stays up. That is the design working.

The one genuinely strong result is **direction**: 72-77% correct sign of
move, well above a coin flip. The model knows which way EGSI is heading
even though it cannot predict how far. That is worth something to a
trader choosing a side, and it is the honest thing to claim.

EGSI is strongly mean-reverting, which makes "predict no change" an easy
baseline to beat — a model can post a 30% skill score against it while
doing nothing cleverer than regressing toward the average. Measured on
real data (2,550 readings, Aug-Sep 2026), model MAE stayed flat at
~49 EGSI points across horizons of 50, 100, 170 and 300 rows. A genuine
forecaster degrades as the horizon lengthens; flat error across a 6x
range of horizons is a signature of predicting the mean rather than the
trajectory.

Band coverage measured 56-58% against the 80% the quantile band is
trained for, so **the confidence figure displayed in the UI is
overstated**. Widening the quantiles or calibrating the band on held-out
data is the fix; neither is done yet.

Direction was the genuinely strong result: 72-77% correct sign of move,
well above a coin flip, and useful for a trader choosing a side even
when the magnitude is unreliable.
