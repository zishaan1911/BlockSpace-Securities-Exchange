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

```bash
cd ai
python3 -m venv venv && venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in RPC URLs / oracle publisher key — see .env.example
venv/bin/uvicorn main:app --reload
```

## Test

```bash
cd ai
venv/bin/pytest
```

**What's actually verified in Claude's sandbox vs. what needs verification
on your machine** — the same split this project already uses for Move
contracts (see `GASX_PROJECT_HANDOFF.md` §1) applies here for the same
reason: no network egress to any Ethereum or Sui RPC endpoint from that
sandbox.

- **Fully tested, real, in-sandbox**: `features/egsi`, `features/history`,
  `inference/baseline`, `inference/forecaster` (including a full
  train -> save -> load -> predict round trip against synthetic data),
  `main`'s FastAPI routes (with ingestion mocked), and
  `ingestion/ethereum`'s parsing/shaping logic (with `web3.py` mocked).
- **NOT exercised against a live endpoint** — needs verification on your
  machine before you trust it:
  - `ingestion/ethereum.EthereumIngestionClient` against a real Ethereum
    RPC URL.
  - `oracle/publisher.OraclePublisher` against Sui testnet, with a real
    funded throwaway publisher key. This one is also worth extra
    scrutiny for a different reason: it's built against `pysui` 1.4.x's
    current async `PysuiConfiguration`/`client_factory` API, verified by
    introspecting the actually-installed package rather than from
    memory — `pysui` deprecated and then removed its older synchronous
    `SuiConfig`/`SyncClient` classes (which a lot of tutorials and older
    docs still show) around version 0.98. If the pinned `pysui` version
    in `requirements.txt` has moved again by the time you read this,
    re-verify `oracle/publisher.py`'s calls against it before trusting
    them.

## Design notes

- **`features/egsi.compute_egsi` is a pure function** — no I/O, no
  global state, same inputs always produce the same output. v1 is a
  hand-tuned weighted sum of six `[0, 1]` normalized components (§3);
  Thetanuts ETH option implied volatility is a seventh, planned input
  explicitly deferred to Phase 4 (GOALS.md's build order) and not
  present here.
- **Normalization reference points
  (`features/egsi.EgsiNormalizationConfig`) are rough, undocumented-as-
  calibrated defaults**, not fit against real historical data — there
  isn't any yet for a brand-new index. Tune or refit these once real
  history accumulates.
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
- **`inference/train.py` runs end-to-end against synthetic data with no
  `--history` given** — there's no real accumulated EGSI history for a
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
