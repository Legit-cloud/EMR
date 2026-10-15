"""Name and phone normalisation and validation for patient records."""

import re
import unicodedata

from django.conf import settings
from django.core.exceptions import ValidationError

# Letters in any script (accents included), separated by single spaces, hyphens or apostrophes.
_LETTERS = r"[^\W\d_]+"
NAME_PATTERN = re.compile(rf"^{_LETTERS}(?:[ '\-]{_LETTERS})*$")
E164_PATTERN = re.compile(r"^\+[1-9]\d{6,14}$")
_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "ʼ": "'"})


def clean_name(value: str) -> str:
    """NFC-normalise, unify apostrophes and collapse whitespace."""
    value = unicodedata.normalize("NFC", value or "").translate(_APOSTROPHES)
    return " ".join(value.split())


def validate_person_name(value: str) -> None:
    if not NAME_PATTERN.match(clean_name(value)):
        raise ValidationError(
            "Use letters only, separated by single spaces, hyphens or apostrophes.",
            code="invalid_name",
        )


def name_key(value: str) -> str:
    """Accent- and case-insensitive key used for duplicate matching (José -> jose)."""
    decomposed = unicodedata.normalize("NFKD", clean_name(value))
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.casefold()


def normalize_phone(value: str) -> str:
    """Return E.164. Local numbers starting with 0 get the default country code."""
    raw = re.sub(r"[\s\-().]", "", value or "")
    if raw.startswith("00"):
        raw = "+" + raw[2:]
    elif raw.startswith("0"):
        raw = f"+{settings.DEFAULT_PHONE_COUNTRY_CODE}{raw[1:]}"
    elif raw and not raw.startswith("+"):
        raw = "+" + raw
    return raw


def validate_e164(value: str) -> None:
    if value and not E164_PATTERN.match(value):
        raise ValidationError("Enter a phone number in international format.", code="invalid_phone")
