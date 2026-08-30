"""EGSI — Ethereum Gas Stress Index (ARCHITECTURE.md §3).

v1 is a hand-tuned weighted sum of six normalized [0, 1] component
scores, blended and scaled to an integer 0-1000 index. Thetanuts ETH
option implied volatility is a seventh planned input (ARCHITECTURE.md
§3) — explicitly "wired in during Phase 4" per GOALS.md's build order,
so it is deliberately absent here.

Every normalization below is a documented heuristic appropriate for a
hackathon v1, not a calibrated model — the AI forecast layer
(inference/) is what's expected to actually predict EGSI moves; this
module's only job is turning one block's raw chain data into that
block's score. compute_egsi() is a pure function: same inputs always
produce the same output, no I/O, no floating global state.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass

from schemas import EgsiComponents, EgsiSnapshot, RawEthereumMetrics


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


@dataclass(frozen=True)
class EgsiWeights:
    """Relative weights for each component. Do not need to sum to 1 —
    compute_egsi() normalizes by their sum, so a caller tuning one
    weight doesn't have to rebalance the rest by hand. All-zero weights
    raise ValueError (there'd be no signal left to blend)."""

    base_fee: float = 0.25
    utilization: float = 0.15
    mempool_pressure: float = 0.15
    fee_momentum: float = 0.15
    gas_volatility: float = 0.15
    dex_activity: float = 0.15

    def total(self) -> float:
        return (
            self.base_fee
            + self.utilization
            + self.mempool_pressure
            + self.fee_momentum
            + self.gas_volatility
            + self.dex_activity
        )


@dataclass(frozen=True)
class EgsiNormalizationConfig:
    """Reference points each raw metric is normalized against. Defaults
    are rough Ethereum-mainnet ballpark figures, not calibrated against
    real historical data — tune these (or fit them from history) before
    relying on this for anything beyond the demo. See ai/README.md."""

    # Base fee: 0 at floor, 1.0 at/above ceiling (gwei).
    base_fee_floor_gwei: float = 5.0
    base_fee_ceiling_gwei: float = 150.0

    # Mempool pressure: pending tx count, 0 at/below floor, 1.0 at/above ceiling.
    mempool_floor: float = 500.0
    mempool_ceiling: float = 20_000.0

    # Fee momentum: % change across the base_fee_history window,
    # normalized against this ceiling. Only upward momentum raises the
    # score — a falling trend reads as "no extra stress", not negative
    # stress.
    fee_momentum_ceiling_pct: float = 50.0

    # Gas volatility: coefficient of variation (stdev / mean) of
    # base_fee_history, normalized against this ceiling. Scale-independent
    # by construction, so it reads the same whether fees are cheap or dear.
    gas_volatility_ceiling_cv: float = 0.5

    # DEX activity: dex_tx_count / block_tx_count, normalized against this
    # ceiling fraction.
    dex_activity_ceiling_fraction: float = 0.5


def _normalize_base_fee(base_fee_wei: int, config: EgsiNormalizationConfig) -> float:
    base_fee_gwei = base_fee_wei / 1e9
    span = config.base_fee_ceiling_gwei - config.base_fee_floor_gwei
    if span <= 0:
        raise ValueError("base_fee_ceiling_gwei must exceed base_fee_floor_gwei")
    return _clamp01((base_fee_gwei - config.base_fee_floor_gwei) / span)


def _normalize_utilization(gas_used: int, gas_limit: int) -> float:
    if gas_limit <= 0:
        raise ValueError("gas_limit must be positive")
    return _clamp01(gas_used / gas_limit)


def _normalize_mempool_pressure(pending_tx_count: int, config: EgsiNormalizationConfig) -> float:
    span = config.mempool_ceiling - config.mempool_floor
    if span <= 0:
        raise ValueError("mempool_ceiling must exceed mempool_floor")
    return _clamp01((pending_tx_count - config.mempool_floor) / span)


def _normalize_fee_momentum(base_fee_history_wei: list[int], config: EgsiNormalizationConfig) -> float:
    """Short-term fee acceleration: % change from the start to the end of
    the supplied history window."""
    if len(base_fee_history_wei) < 2:
        return 0.0
    start, end = base_fee_history_wei[0], base_fee_history_wei[-1]
    if start <= 0:
        return 0.0
    pct_change = ((end - start) / start) * 100.0
    return _clamp01(pct_change / config.fee_momentum_ceiling_pct)


def _normalize_gas_volatility(base_fee_history_wei: list[int], config: EgsiNormalizationConfig) -> float:
    if len(base_fee_history_wei) < 2:
        return 0.0
    mean = statistics.fmean(base_fee_history_wei)
    if mean <= 0:
        return 0.0
    stdev = statistics.pstdev(base_fee_history_wei)
    cv = stdev / mean
    return _clamp01(cv / config.gas_volatility_ceiling_cv)


def _normalize_dex_activity(dex_tx_count: int, block_tx_count: int, config: EgsiNormalizationConfig) -> float:
    """Fraction of this block's transactions that touched a known DEX/
    DeFi router address (see ingestion/ethereum.py's router list),
    normalized against a ceiling fraction."""
    if block_tx_count <= 0:
        return 0.0
    fraction = dex_tx_count / block_tx_count
    return _clamp01(fraction / config.dex_activity_ceiling_fraction)


def compute_egsi(
    metrics: RawEthereumMetrics,
    weights: EgsiWeights | None = None,
    config: EgsiNormalizationConfig | None = None,
) -> EgsiSnapshot:
    """Turns one block's raw metrics into an EgsiSnapshot: six [0, 1]
    component scores plus their weighted blend, scaled to an integer
    0-1000 index and rounded to the nearest whole point."""
    weights = weights or EgsiWeights()
    config = config or EgsiNormalizationConfig()

    total_weight = weights.total()
    if total_weight <= 0:
        raise ValueError("EgsiWeights must sum to a positive total")

    components = EgsiComponents(
        base_fee=_normalize_base_fee(metrics.base_fee_wei, config),
        utilization=_normalize_utilization(metrics.gas_used, metrics.gas_limit),
        mempool_pressure=_normalize_mempool_pressure(metrics.pending_tx_count, config),
        fee_momentum=_normalize_fee_momentum(metrics.base_fee_history_wei, config),
        gas_volatility=_normalize_gas_volatility(metrics.base_fee_history_wei, config),
        dex_activity=_normalize_dex_activity(metrics.dex_tx_count, metrics.block_tx_count, config),
    )

    weighted = (
        components.base_fee * weights.base_fee
        + components.utilization * weights.utilization
        + components.mempool_pressure * weights.mempool_pressure
        + components.fee_momentum * weights.fee_momentum
        + components.gas_volatility * weights.gas_volatility
        + components.dex_activity * weights.dex_activity
    ) / total_weight

    score = round(_clamp01(weighted) * 1000)

    return EgsiSnapshot(
        score=score,
        components=components,
        block_number=metrics.block_number,
        timestamp=metrics.timestamp,
    )
