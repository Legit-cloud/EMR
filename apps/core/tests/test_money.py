from decimal import Decimal

import pytest

from apps.core.money import CurrencyMismatch, Money

# -- never floats ----------------------------------------------------------------


def test_money_rejects_float_amount():
    with pytest.raises(TypeError):
        Money(100.0, "NGN")


def test_money_rejects_decimal_and_bool_amounts():
    with pytest.raises(TypeError):
        Money(Decimal("100"), "NGN")
    with pytest.raises(TypeError):
        Money(True, "NGN")


def test_from_major_rejects_float():
    with pytest.raises(TypeError):
        Money.from_major(10.5, "NGN")


def test_multiplying_by_float_is_rejected():
    with pytest.raises(TypeError):
        Money(100, "NGN") * 1.5


def test_amount_is_always_an_int_after_arithmetic():
    total = Money.from_major("0.10", "USD") + Money.from_major("0.20", "USD")
    assert total == Money(30, "USD")
    assert type(total.amount_minor) is int


# -- construction and presentation -------------------------------------------------


def test_from_major_converts_exactly():
    assert Money.from_major("1500.50", "NGN") == Money(150050, "NGN")
    assert Money.from_major(Decimal("2"), "USD") == Money(200, "USD")
    assert Money.from_major(500, "XOF") == Money(500, "XOF")


def test_from_major_rejects_excess_precision():
    with pytest.raises(ValueError):
        Money.from_major("1.005", "NGN")
    with pytest.raises(ValueError):
        Money.from_major("1.5", "XOF")


@pytest.mark.parametrize("bad", ["abc", "NaN", "Infinity", ""])
def test_from_major_rejects_non_numbers(bad):
    with pytest.raises(ValueError):
        Money.from_major(bad, "NGN")


def test_unknown_or_lowercase_currency_is_rejected():
    with pytest.raises(ValueError):
        Money(100, "ngn")
    with pytest.raises(ValueError):
        Money(100, "ABC")


def test_string_and_dict_forms():
    money = Money(150050, "NGN")
    assert str(money) == "NGN 1500.50"
    assert str(Money(-5, "USD")) == "USD -0.05"
    assert money.to_dict() == {"amount_minor": 150050, "currency": "NGN"}
    assert money.to_major() == Decimal("1500.50")


def test_money_is_immutable():
    with pytest.raises(AttributeError):
        Money(1, "NGN").amount_minor = 2


# -- arithmetic --------------------------------------------------------------------


def test_add_subtract_negate_multiply():
    a, b = Money(1000, "NGN"), Money(250, "NGN")
    assert a + b == Money(1250, "NGN")
    assert a - b == Money(750, "NGN")
    assert -a == Money(-1000, "NGN")
    assert b * 3 == 3 * b == Money(750, "NGN")


def test_mixing_currencies_is_refused():
    with pytest.raises(CurrencyMismatch):
        Money(1, "NGN") + Money(1, "USD")
    with pytest.raises(CurrencyMismatch):
        _ = Money(1, "NGN") < Money(2, "USD")


def test_comparisons():
    assert Money(1, "NGN") < Money(2, "NGN") <= Money(2, "NGN")
    assert Money(3, "NGN") > Money(2, "NGN") >= Money(2, "NGN")
    assert Money.zero("NGN").is_zero()


# -- allocation (insurer and patient split) ----------------------------------------


def test_allocate_never_loses_or_creates_a_unit():
    parts = Money(1000, "NGN").allocate([1, 1, 1])
    assert parts == [Money(334, "NGN"), Money(333, "NGN"), Money(333, "NGN")]
    assert sum(p.amount_minor for p in parts) == 1000


def test_allocate_insurer_patient_split():
    insurer, patient = Money(10001, "NGN").allocate([80, 20])
    assert insurer + patient == Money(10001, "NGN")
    assert (insurer, patient) == (Money(8001, "NGN"), Money(2000, "NGN"))


def test_allocate_gives_nothing_to_zero_ratio():
    parts = Money(2, "NGN").allocate([1, 0, 1, 1])
    assert parts[1] == Money(0, "NGN")
    assert sum(p.amount_minor for p in parts) == 2


def test_allocate_negative_amount():
    parts = Money(-1000, "NGN").allocate([1, 2])
    assert sum(p.amount_minor for p in parts) == -1000


@pytest.mark.parametrize("ratios", [[], [0, 0], [-1, 2], [0.5, 0.5]])
def test_allocate_rejects_bad_ratios(ratios):
    with pytest.raises((ValueError, TypeError)):
        Money(100, "NGN").allocate(ratios)
