"""FastAPI entrypoint for the GASX AI service (ARCHITECTURE.md §2:
"Ingest Ethereum data, compute EGSI, forecast, publish oracle").

Run with:

    cd ai && uvicorn main:app --reload

or from the repo root:

    uvicorn main:app --app-dir ai --reload
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from config import settings
from features.egsi import EgsiNormalizationConfig, EgsiWeights, compute_egsi
from features.history import EgsiHistory
from inference.baseline_forecaster import BaselineForecaster
from inference.forecaster import Forecaster, load_trained_model
from ingestion.ethereum import EthereumIngestionClient
from schemas import CycleRequest, EgsiSnapshot, ForecastOutput

logger = logging.getLogger("gasx.ai")


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    """Starts and cleanly stops the background cycle loop. Uses the
    lifespan API rather than the deprecated @app.on_event hooks."""
    task = None
    if settings.cycle_interval_seconds > 0:
        task = asyncio.create_task(_auto_cycle_loop())
    else:
        logger.info("auto-cycling disabled (cycle_interval_seconds=0); drive with POST /cycle")
    try:
        yield
    finally:
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="GASX AI Service", version="0.1.0", lifespan=_lifespan)

# Single-market, in-process state (ARCHITECTURE.md's Decisions §12: "Cache:
# in-memory in the API" — the AI service follows the same convention).
# EGSI-1H is the only market for this hackathon (ARCHITECTURE.md §12), so
# one history buffer / one forecaster instance is enough.
_history = EgsiHistory(max_len=settings.egsi_history_max_len)
# Loads a trained model from ai/models/ if one exists AND it beat its
# naive baseline out-of-sample. If not, Forecaster serves the honest
# fallback and /forecast reports model_version "egsi-v1-fallback" — see
# inference/train.py for how to produce a real one from accumulated
# history.
_MODELS_DIR = Path(__file__).resolve().parent / "models"
_forecaster = Forecaster(load_trained_model(_MODELS_DIR))
# Served whenever no learned model qualifies. ARCHITECTURE.md §4: "must
# beat naive baselines out-of-sample; otherwise ship the baseline". On
# real data the baseline is measurably MORE accurate than the learned
# model (MAE 46.5 vs 49.7), so this is the correct answer rather than a
# degraded one.
_baseline_forecaster = BaselineForecaster()
_latest_snapshot: EgsiSnapshot | None = None
# Thetanuts skew isn't part of EGSI's own formula (ARCHITECTURE.md §3
# only lists IV), but it is a forecast feature (§4) — tracked separately
# since EgsiSnapshot/EgsiComponents has no slot for it.
_latest_thetanuts_skew: float | None = None


def _ingestion_client() -> EthereumIngestionClient:
    return EthereumIngestionClient(rpc_url=settings.ethereum_rpc_url)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model_loaded": _forecaster.is_model_loaded, "history_len": len(_history)}


@app.get("/egsi/current", response_model=EgsiSnapshot)
def get_current_egsi() -> EgsiSnapshot:
    if _latest_snapshot is None:
        raise HTTPException(status_code=503, detail="no EGSI snapshot yet — call POST /cycle first")
    return _latest_snapshot


@app.get("/forecast", response_model=ForecastOutput)
def get_forecast() -> ForecastOutput:
    features = _history.features()
    if features is None:
        raise HTTPException(status_code=503, detail="no EGSI history yet — call POST /cycle first")

    # No qualifying learned model: serve the statistical baseline, which
    # measurement shows is the better predictor anyway.
    if not _forecaster.is_model_loaded:
        baseline = _baseline_forecaster.predict(_history.scores)
        if baseline is None:
            raise HTTPException(
                status_code=503,
                detail=f"need at least {_baseline_forecaster.__class__.__name__}'s minimum history",
            )
        return baseline

    last_score = _history.scores[-1]
    components = _latest_snapshot.components if _latest_snapshot else None
    feature_dict = {
        "ema": features.ema,
        "rsi": features.rsi,
        "momentum": features.momentum,
        "last_score": float(last_score),
        "base_fee": components.base_fee if components else 0.0,
        "utilization": components.utilization if components else 0.0,
        "mempool_pressure": components.mempool_pressure if components else 0.0,
        "gas_volatility": components.gas_volatility if components else 0.0,
        "thetanuts_iv": (components.thetanuts_iv if components and components.thetanuts_iv is not None else 0.0),
        "thetanuts_skew": _latest_thetanuts_skew if _latest_thetanuts_skew is not None else 0.0,
    }
    return _forecaster.predict(feature_dict)


def _perform_cycle(thetanuts: CycleRequest | None = None) -> EgsiSnapshot:
    """The actual ingest -> compute -> record step, shared by the HTTP
    endpoint and the background loop so both go through identical logic
    rather than drifting apart."""
    global _latest_snapshot, _latest_thetanuts_skew
    client = _ingestion_client()
    metrics = client.fetch_latest_metrics()
    thetanuts_iv = thetanuts.thetanuts_atm_iv if thetanuts else None
    _latest_thetanuts_skew = thetanuts.thetanuts_skew_25delta if thetanuts else None
    snapshot = compute_egsi(metrics, EgsiWeights(), EgsiNormalizationConfig(), thetanuts_iv=thetanuts_iv)
    _history.push(snapshot.score)
    _latest_snapshot = snapshot
    return snapshot


async def _auto_cycle_loop() -> None:
    """Keeps EGSI current without anyone poking POST /cycle.

    Interval defaults to Ethereum's ~12s block time: cycling faster
    cannot surface new data, since there is no new block to read — it
    only burns RPC rate limit and recomputes an identical score.

    Ingestion is blocking (web3.py is synchronous), so it runs in a
    thread rather than stalling the event loop and making every HTTP
    request wait behind it. Failures are logged and the loop continues:
    one unreachable RPC call should not permanently stop the service
    from updating.
    """
    interval = settings.cycle_interval_seconds
    while True:
        try:
            snapshot = await asyncio.to_thread(_perform_cycle)
            logger.info("auto-cycle: EGSI %s at block %s", snapshot.score, snapshot.block_number)
        except Exception as exc:
            logger.warning("auto-cycle failed, will retry in %ss: %s", interval, exc)
        await asyncio.sleep(interval)


class HistoryRestoreRequest(BaseModel):
    """Past EGSI scores, oldest first, replayed into the in-memory
    history buffer on startup."""

    scores: list[int] = Field(default_factory=list)


@app.post("/history/restore")
def restore_history(request: HistoryRestoreRequest) -> dict:
    """Warm-starts EgsiHistory from durable storage.

    The AI service never touches the database directly (ARCHITECTURE.md
    §2: the API gateway is the only client), so the gateway reads the
    persisted history and pushes it here at startup. Without this, a
    restart resets the forecaster's EMA/RSI/momentum context to nothing
    and it serves low-confidence output until enough new cycles
    accumulate — even though the readings were durably stored all along.

    Replaces rather than appends, so a repeated call is idempotent
    instead of duplicating history.
    """
    global _history
    restored = EgsiHistory(max_len=settings.egsi_history_max_len)
    for score in request.scores:
        restored.push(score)
    _history = restored
    return {"restored": len(restored)}


@app.post("/cycle", response_model=EgsiSnapshot)
def run_cycle(thetanuts: CycleRequest | None = None) -> EgsiSnapshot:
    """One ingest -> compute EGSI -> update history cycle. Does NOT
    publish to Sui — that's a separate, explicit step (POST /publish),
    since an on-chain write with real (testnet-or-real) gas cost should
    never happen as a side effect of a read/compute loop.

    `thetanuts` is optional (ARCHITECTURE.md §3, §4) — see CycleRequest's
    docstring in schemas.py for why there's no automatic live wiring to
    blockchain/thetanuts yet.

    Still useful with auto-cycling on: this is how a caller supplies a
    live Thetanuts signal (the background loop has none) and how the
    gateway's /hedge/sync-signal route drives a cycle on demand."""
    return _perform_cycle(thetanuts)


@app.post("/publish")
async def publish_oracle_price() -> dict:
    """Publishes the latest EGSI snapshot's integer score on-chain via
    OraclePublisher (ARCHITECTURE.md §6). Disabled (501) unless
    SUI_PUBLISHER_PRIVATE_KEY/SUI_PACKAGE_ID/SUI_ORACLE_OBJECT_ID are all
    configured — see oracle/publisher.py's module docstring for why this
    can't be exercised in Claude's sandbox."""
    if _latest_snapshot is None:
        raise HTTPException(status_code=503, detail="no EGSI snapshot yet — call POST /cycle first")
    if not (settings.sui_publisher_private_key and settings.sui_package_id and settings.sui_oracle_object_id):
        raise HTTPException(status_code=501, detail="oracle publishing not configured — see .env.example")

    from oracle.publisher import OraclePublisher, OraclePublishTarget

    publisher = OraclePublisher(
        rpc_url=settings.sui_rpc_url,
        publisher_private_key=settings.sui_publisher_private_key,
        target=OraclePublishTarget(
            package_id=settings.sui_package_id,
            oracle_object_id=settings.sui_oracle_object_id,
        ),
    )
    digest = await publisher.publish_price(_latest_snapshot.score)
    return {"digest": digest, "price": _latest_snapshot.score}
