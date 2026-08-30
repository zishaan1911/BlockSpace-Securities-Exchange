"""Shared Pydantic models for the GASX AI service (ARCHITECTURE.md §2-4).

These are the boundary types: what ingestion produces, what the EGSI/
forecast layers compute, and what the API exposes to callers (the
TypeScript API gateway, and the AI service's own oracle publish step).
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class RawEthereumMetrics(BaseModel):
    """One sample of raw, unnormalized signals pulled from an Ethereum RPC
    endpoint at a point in time (ingestion/ethereum.py). Everything the
    EGSI feature layer needs and nothing it computes itself —
    normalization/weighting happens in features/egsi.py, not here.
    """

    block_number: int
    timestamp: int  # unix seconds, from the block header
    base_fee_wei: int
    gas_used: int
    gas_limit: int
    pending_tx_count: int  # mempool pressure proxy
    # Recent per-block base fees, oldest first, most-recent-last. Used for
    # fee momentum + gas volatility. May be shorter than the requested
    # window near chain genesis or if the RPC provider caps history depth.
    base_fee_history_wei: list[int] = Field(default_factory=list)
    dex_tx_count: int = 0  # tx count touching a known DEX/DeFi router address
    block_tx_count: int = 0  # total tx count in the block; denominator for dex_tx_count


class EgsiComponents(BaseModel):
    """Each raw input's contribution after normalization to [0, 1], before
    weighting. Kept alongside the final score so a caller/UI can show
    *why* EGSI moved, not just that it did (ARCHITECTURE.md §3)."""

    base_fee: float
    utilization: float
    mempool_pressure: float
    fee_momentum: float
    gas_volatility: float
    dex_activity: float


class EgsiSnapshot(BaseModel):
    """One computed EGSI value plus its inputs, for one block."""

    market: str = "EGSI-1H"
    score: int = Field(..., ge=0, le=1000)
    components: EgsiComponents
    block_number: int
    timestamp: int


class ForecastOutput(BaseModel):
    """Matches ARCHITECTURE.md §4's output schema exactly — this is what
    the API gateway and risk engine consume."""

    market: str = "EGSI-1H"
    expected_egsi: float
    confidence: float = Field(..., ge=0.0, le=1.0)
    p_tail_500: float = Field(..., ge=0.0, le=1.0)
    model_version: str
