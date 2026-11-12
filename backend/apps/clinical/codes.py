"""Loading of reference code tables (LOINC vital signs, ICD-10)."""

import json
from pathlib import Path

CODES_FILE = Path(__file__).resolve().parent / "data" / "codes.json"


def load_codes(loinc_model, icd10_model, path: Path = CODES_FILE) -> tuple[int, int]:
    """Insert or update codes from ``path``. Works with real or migration-state models."""
    data = json.loads(path.read_text(encoding="utf-8"))
    for row in data["loinc"]:
        loinc_model.objects.update_or_create(
            code=row["code"],
            defaults={
                "display": row["display"],
                "unit": row["unit"],
                "min_value": row["min"],
                "max_value": row["max"],
                "derived": row["derived"],
            },
        )
    for row in data["icd10"]:
        icd10_model.objects.update_or_create(code=row["code"], defaults={"display": row["display"]})
    return len(data["loinc"]), len(data["icd10"])
