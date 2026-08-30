import pytest

from features.history import EgsiHistory


def test_empty_history_returns_none_features():
    history = EgsiHistory()
    assert history.features() is None
    assert len(history) == 0


def test_single_push_gives_neutral_features():
    history = EgsiHistory()
    history.push(500)
    features = history.features()
    assert features is not None
    assert features.ema == 500.0
    assert features.rsi == 50.0  # neutral — no direction data yet
    assert features.momentum == 0.0


def test_ema_moves_toward_new_values():
    history = EgsiHistory(ema_span=3)
    history.push(100)
    history.push(100)
    history.push(900)
    features = history.features()
    # EMA should have moved up from 100 but not jumped all the way to 900.
    assert 100 < features.ema < 900


def test_rsi_is_100_when_only_gains_observed():
    history = EgsiHistory(rsi_period=5)
    for score in [100, 200, 300, 400, 500, 600]:
        history.push(score)
    features = history.features()
    assert features.rsi == 100.0


def test_rsi_is_0_when_only_losses_observed():
    history = EgsiHistory(rsi_period=5)
    for score in [600, 500, 400, 300, 200, 100]:
        history.push(score)
    features = history.features()
    assert features.rsi == 0.0


def test_rsi_is_between_bounds_for_mixed_direction():
    history = EgsiHistory(rsi_period=5)
    for score in [500, 550, 480, 530, 490, 510]:
        history.push(score)
    features = history.features()
    assert 0.0 <= features.rsi <= 100.0


def test_momentum_reflects_change_over_window():
    history = EgsiHistory(momentum_period=3)
    for score in [400, 400, 400, 700]:
        history.push(score)
    features = history.features()
    assert features.momentum == 300.0  # 700 - 400 across the last 3-step window


def test_momentum_is_zero_with_only_one_point():
    history = EgsiHistory(momentum_period=3)
    history.push(400)
    assert history.features().momentum == 0.0


def test_max_len_evicts_oldest_scores():
    history = EgsiHistory(max_len=3)
    history.push(1)
    history.push(2)
    history.push(3)
    history.push(4)
    assert history.scores == [2, 3, 4]
    assert len(history) == 3


def test_scores_property_reflects_push_order():
    history = EgsiHistory()
    history.push(10)
    history.push(20)
    history.push(30)
    assert history.scores == [10, 20, 30]


def test_max_len_below_one_raises():
    with pytest.raises(ValueError):
        EgsiHistory(max_len=0)
