"""Derives model-ready features (EMA/RSI/momentum) from a rolling window
of past EGSI scores (ARCHITECTURE.md §4: "Features: EGSI history (EMA/
RSI/momentum), network metrics, Thetanuts IV/skew signals"). Thetanuts
signals are a Phase 4 addition (GOALS.md) and not produced here.

Deliberately separate from egsi.py: that module turns *one* block's raw
chain data into *one* EGSI score; this module turns a *sequence* of past
scores into the features inference/forecaster.py conditions on.
"""
from __future__ import annotations

import statistics
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class EgsiHistoryFeatures:
    ema: float
    rsi: float  # 0-100, Wilder's RSI convention
    momentum: float  # simple point change over the momentum window


class EgsiHistory:
    """Fixed-capacity rolling buffer of past EGSI scores, plus the
    derived features the forecaster needs. Not thread-safe — one
    instance per market, driven from a single ingestion loop."""

    def __init__(
        self,
        max_len: int = 200,
        ema_span: int = 14,
        rsi_period: int = 14,
        momentum_period: int = 5,
    ):
        if max_len < 1:
            raise ValueError("max_len must be at least 1")
        self._scores: deque[int] = deque(maxlen=max_len)
        self.ema_span = ema_span
        self.rsi_period = rsi_period
        self.momentum_period = momentum_period

    def push(self, score: int) -> None:
        self._scores.append(score)

    def __len__(self) -> int:
        return len(self._scores)

    @property
    def scores(self) -> list[int]:
        return list(self._scores)

    def features(self) -> EgsiHistoryFeatures | None:
        """None until at least one score has been pushed. Each derived
        feature degrades gracefully (flat EMA, neutral RSI, zero
        momentum) before its full window is available, rather than
        raising — a cold-started service can still produce a (low-
        confidence) forecast from the first sample onward."""
        if not self._scores:
            return None
        return EgsiHistoryFeatures(
            ema=self._ema(),
            rsi=self._rsi(),
            momentum=self._momentum(),
        )

    def _ema(self) -> float:
        scores = self.scores
        alpha = 2.0 / (self.ema_span + 1)
        ema = float(scores[0])
        for s in scores[1:]:
            ema = alpha * s + (1 - alpha) * ema
        return ema

    def _rsi(self) -> float:
        scores = self.scores
        if len(scores) < 2:
            return 50.0  # neutral — no direction data yet
        window = scores[-(self.rsi_period + 1):]
        gains = []
        losses = []
        for prev, curr in zip(window, window[1:]):
            delta = curr - prev
            if delta > 0:
                gains.append(delta)
            elif delta < 0:
                losses.append(-delta)
        avg_gain = statistics.fmean(gains) if gains else 0.0
        avg_loss = statistics.fmean(losses) if losses else 0.0
        if avg_loss == 0:
            return 100.0 if avg_gain > 0 else 50.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    def _momentum(self) -> float:
        scores = self.scores
        window = scores[-(self.momentum_period + 1):]
        if len(window) < 2:
            return 0.0
        return float(window[-1] - window[0])
