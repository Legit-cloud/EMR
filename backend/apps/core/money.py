"""Money as integer minor units plus an ISO 4217 currency code. Floats are never accepted."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# Minor-unit exponent per supported currency. Extend deliberately, not by guessing.
CURRENCY_EXPONENTS = {
    "NGN": 2,
    "GHS": 2,
    "KES": 2,
    "ZAR": 2,
    "XOF": 0,
    "USD": 2,
    "EUR": 2,
    "GBP": 2,
}


class CurrencyMismatch(ValueError):
    pass


def _check_int(value, name: str) -> int:
    # bool is a subclass of int, and float/Decimal would silently allow fractions.
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an int, got {type(value).__name__}")
    return value


@dataclass(frozen=True, slots=True)
class Money:
    amount_minor: int
    currency: str

    def __post_init__(self):
        _check_int(self.amount_minor, "amount_minor")
        if not isinstance(self.currency, str) or self.currency not in CURRENCY_EXPONENTS:
            raise ValueError(f"Unsupported currency: {self.currency!r}")

    # -- construction ---------------------------------------------------------
    @classmethod
    def zero(cls, currency: str) -> "Money":
        return cls(0, currency)

    @classmethod
    def from_major(cls, amount: str | Decimal | int, currency: str) -> "Money":
        """Build from a major-unit amount such as ``"1500.50"``. Excess precision is an error."""
        if isinstance(amount, bool) or isinstance(amount, float):
            raise TypeError("Money amounts must not be floats; pass a str or Decimal")
        if currency not in CURRENCY_EXPONENTS:
            raise ValueError(f"Unsupported currency: {currency!r}")
        try:
            value = Decimal(amount)
        except (InvalidOperation, TypeError) as exc:
            raise ValueError(f"Invalid amount: {amount!r}") from exc
        if not value.is_finite():
            raise ValueError(f"Invalid amount: {amount!r}")
        minor = value.scaleb(CURRENCY_EXPONENTS[currency])
        if minor != minor.to_integral_value():
            raise ValueError(f"{amount!r} has more precision than {currency} allows")
        return cls(int(minor), currency)

    # -- presentation ---------------------------------------------------------
    @property
    def exponent(self) -> int:
        return CURRENCY_EXPONENTS[self.currency]

    def to_major(self) -> Decimal:
        return Decimal(self.amount_minor).scaleb(-self.exponent)

    def __str__(self) -> str:
        return f"{self.currency} {self.to_major():.{self.exponent}f}"

    def to_dict(self) -> dict:
        return {"amount_minor": self.amount_minor, "currency": self.currency}

    # -- arithmetic -----------------------------------------------------------
    def _same_currency(self, other) -> "Money":
        if not isinstance(other, Money):
            raise TypeError(f"Expected Money, got {type(other).__name__}")
        if other.currency != self.currency:
            raise CurrencyMismatch(f"{self.currency} and {other.currency} cannot be combined")
        return other

    def __add__(self, other: "Money") -> "Money":
        other = self._same_currency(other)
        return Money(self.amount_minor + other.amount_minor, self.currency)

    def __sub__(self, other: "Money") -> "Money":
        other = self._same_currency(other)
        return Money(self.amount_minor - other.amount_minor, self.currency)

    def __neg__(self) -> "Money":
        return Money(-self.amount_minor, self.currency)

    def __mul__(self, quantity: int) -> "Money":
        return Money(self.amount_minor * _check_int(quantity, "quantity"), self.currency)

    __rmul__ = __mul__

    def __lt__(self, other: "Money") -> bool:
        return self.amount_minor < self._same_currency(other).amount_minor

    def __le__(self, other: "Money") -> bool:
        return self.amount_minor <= self._same_currency(other).amount_minor

    def __gt__(self, other: "Money") -> bool:
        return self.amount_minor > self._same_currency(other).amount_minor

    def __ge__(self, other: "Money") -> bool:
        return self.amount_minor >= self._same_currency(other).amount_minor

    def is_zero(self) -> bool:
        return self.amount_minor == 0

    def allocate(self, ratios: list[int]) -> list["Money"]:
        """Split by integer ratios (for example insurer 80, patient 20) without losing a unit.

        Leftover minor units go one each to the earliest non-zero shares, so the parts
        always sum to the original and a zero ratio always gets zero.
        """
        if not ratios or any(_check_int(r, "ratio") < 0 for r in ratios) or sum(ratios) == 0:
            raise ValueError("Ratios must be non-negative ints with a positive total")
        total = sum(ratios)
        sign = -1 if self.amount_minor < 0 else 1
        amount = abs(self.amount_minor)
        shares = [amount * r // total for r in ratios]
        receivers = [i for i, r in enumerate(ratios) if r > 0]
        for i in range(amount - sum(shares)):
            shares[receivers[i]] += 1
        return [Money(sign * s, self.currency) for s in shares]
