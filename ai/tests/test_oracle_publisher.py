import pytest

from oracle.publisher import _validate_price


def test_accepts_valid_prices():
    for price in [0, 1, 500, 999, 1000]:
        _validate_price(price)  # should not raise


def test_rejects_negative_price():
    with pytest.raises(ValueError):
        _validate_price(-1)


def test_rejects_price_above_1000():
    with pytest.raises(ValueError):
        _validate_price(1001)


def test_rejects_non_integer_price():
    with pytest.raises(TypeError):
        _validate_price(500.5)


def test_rejects_bool_price():
    # bool is a subclass of int in Python — explicitly excluded since
    # True/False are never meaningful EGSI values.
    with pytest.raises(TypeError):
        _validate_price(True)


def test_rejects_string_price():
    with pytest.raises(TypeError):
        _validate_price("500")
