"""FastAPI entrypoint for the GASX AI service (ARCHITECTURE.md §2:
"Ingest Ethereum data, compute EGSI, forecast, publish oracle").

Run with:

    cd ai && uvicorn main:app --reload

or from the repo root:

    uvicorn main:app --app-dir ai --reload
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException

from config import settings
from features.egsi import EgsiNormalizationConfig, EgsiWeights, compute_egsi
from features.history import EgsiHistory
from inference.forecaster import Forecaster
from ingestion.ethereum import EthereumIngestionClient
from schemas import CycleRequest, EgsiSnapshot, ForecastOutput

app = FastAPI(title="GASX AI Service", version="0.1.0")

# Single-market, in-process state (ARCHITECTURE.md's Decisions §12: "Cache:
# in-memory in the API" — the AI service follows the same convention).
# EGSI-1H is the only market for this hackathon (ARCHITECTURE.md §12), so
# one history buffer / one forecaster instance is enough.
_history = EgsiHistory(max_len=settings.egsi_history_max_len)
_forecaster = Forecaster()  # no trained model loaded yet — see inference/train.py; serves the fallback forecast until one is
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


@app.post("/cycle", response_model=EgsiSnapshot)
def run_cycle(thetanuts: CycleRequest | None = None) -> EgsiSnapshot:
    """One ingest -> compute EGSI -> update history cycle. Does NOT
    publish to Sui — that's a separate, explicit step (POST /publish),
    since an on-chain write with real (testnet-or-real) gas cost should
    never happen as a side effect of a read/compute loop.

    `thetanuts` is optional (ARCHITECTURE.md §3, §4) — see CycleRequest's
    docstring in schemas.py for why there's no automatic live wiring to
    blockchain/thetanuts yet."""
    global _latest_snapshot, _latest_thetanuts_skew
    client = _ingestion_client()
    metrics = client.fetch_latest_metrics()
    thetanuts_iv = thetanuts.thetanuts_atm_iv if thetanuts else None
    _latest_thetanuts_skew = thetanuts.thetanuts_skew_25delta if thetanuts else None
    snapshot = compute_egsi(metrics, EgsiWeights(), EgsiNormalizationConfig(), thetanuts_iv=thetanuts_iv)
    _history.push(snapshot.score)
    _latest_snapshot = snapshot
    return snapshot


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
