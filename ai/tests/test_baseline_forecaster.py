"""Tests for the statistical baseline that gets served when no learned
model beats it."""
import pytest

from inference.baseline_forecaster import (
    BaselineForecaster,
    _confidence_from_spread,
    _empirical_tail_probability,
)

FLAT = [400] * 20
VARIED = [100, 500, 200, 450, 150, 480, 220, 460, 180, 430, 210, 470]


def test_refuses_to_forecast_from_too_little_history():
    """Better a 503 than a confident-looking number invented from three
    readings."""
    assert BaselineForecaster().predict([400, 420]) is None


def test_forecasts_the_recent_mean():
    result = BaselineForecaster().predict([400] * 20)
    assert result is not None
    assert result.expected_egsi == pytest.approx(400.0)


def test_tracks_the_series_rather_than_returning_a_constant():
    """The old hard-coded fallback always returned 500.0 no matter what,
    which is exactly why the UI called it a placeholder."""
    low = BaselineForecaster().predict([100] * 20)
    high = BaselineForecaster().predict([800] * 20)
    assert low.expected_egsi < high.expected_egsi


def test_only_recent_history_moves_the_forecast():
    forecaster = BaselineForecaster(window=5)
    result = forecaster.predict([0] * 50 + [400] * 5)
    # Ancient history is outside the window, so the forecast follows the
    # current regime instead of averaging across a change.
    assert result.expected_egsi == pytest.approx(400.0)


def test_a_steady_series_reads_as_more_confident_than_a_volatile_one():
    steady = BaselineForecaster().predict(FLAT)
    volatile = BaselineForecaster().predict(VARIED)
    assert steady.confidence > volatile.confidence


def test_confidence_stays_within_bounds_even_for_an_extreme_spread():
    assert _confidence_from_spread(0.0) == 1.0
    assert _confidence_from_spread(10_000.0) == 0.0
    assert 0.0 <= _confidence_from_spread(60.0) <= 1.0


def test_confidence_rejects_a_non_positive_reference():
    with pytest.raises(ValueError):
        _confidence_from_spread(10.0, reference=0.0)


def test_tail_probability_is_high_when_the_series_sits_above_the_threshold():
    assert _empirical_tail_probability([900] * 20, 500.0) > 0.9


def test_tail_probability_is_low_but_not_zero_when_never_observed():
    """'Never observed' is not the same claim as 'impossible', so Laplace
    smoothing keeps it small rather than flatly zero."""
    p = _empirical_tail_probability([100] * 20, 500.0)
    assert 0.0 < p < 0.1


def test_tail_probability_reflects_observed_frequency():
    # Half the readings exceed the threshold.
    p = _empirical_tail_probability([600] * 10 + [400] * 10, 500.0)
    assert 0.4 < p < 0.6


def test_reports_its_own_version_not_the_model_one():
    result = BaselineForecaster().predict(FLAT)
    assert result.model_version == "egsi-baseline-v1"
    # Not dressed up as a learned model.
    assert "baseline" in result.model_version
