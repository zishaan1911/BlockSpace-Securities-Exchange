import pytest

from inference.baseline import last_value, mean_absolute_error, moving_average


def test_last_value_returns_final_element():
    assert last_value([100.0, 200.0, 300.0]) == 300.0


def test_last_value_raises_on_empty():
    with pytest.raises(ValueError):
        last_value([])


def test_moving_average_over_full_window():
    assert moving_average([100.0, 200.0, 300.0], window=3) == 200.0


def test_moving_average_uses_all_history_when_shorter_than_window():
    assert moving_average([100.0, 200.0], window=5) == 150.0


def test_moving_average_uses_only_tail_window():
    assert moving_average([0.0, 0.0, 100.0, 200.0, 300.0], window=3) == 200.0


def test_moving_average_raises_on_empty():
    with pytest.raises(ValueError):
        moving_average([])


def test_moving_average_raises_on_invalid_window():
    with pytest.raises(ValueError):
        moving_average([1.0, 2.0], window=0)


def test_mean_absolute_error_of_identical_series_is_zero():
    assert mean_absolute_error([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == 0.0


def test_mean_absolute_error_computes_correctly():
    assert mean_absolute_error([10.0, 20.0], [8.0, 25.0]) == pytest.approx(3.5)


def test_mean_absolute_error_raises_on_length_mismatch():
    with pytest.raises(ValueError):
        mean_absolute_error([1.0, 2.0], [1.0])


def test_mean_absolute_error_raises_on_empty():
    with pytest.raises(ValueError):
        mean_absolute_error([], [])
