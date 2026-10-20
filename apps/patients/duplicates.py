"""Fuzzy duplicate detection for new registrations.

Candidates are found with PostgreSQL trigram indexes on accent- and case-folded names (not
hashing: hashes cannot express a partial match). Each name's similarity is the better of
the trigram similarity and a Damerau-Levenshtein ratio, because trigrams score short
transposition typos (Okonkwo / Okonkow) poorly.

    names     = mean similarity of first and last name (or of the swapped pair, if higher)
    birthdate = 1.0 exact, 0.75 if one part differs or day and month are swapped, else 0
    score     = 0.6 * names + 0.4 * birthdate
    An exact national ID match scores 1.0: the ID belongs to one person.
    A different national ID does not lower the score; mistyped IDs are common and a
    missed duplicate costs more than a manual review.

A score above ``PATIENT_DUPLICATE_THRESHOLD`` (0.85) holds the registration for review.
"""

from dataclasses import asdict, dataclass
from datetime import date

from django.conf import settings
from django.contrib.postgres.search import TrigramSimilarity
from django.db.models import Q

from .models import Patient
from .normalize import name_key

NAME_WEIGHT = 0.6
BIRTHDATE_WEIGHT = 0.4
MAX_CANDIDATES = 20


@dataclass(frozen=True)
class MatchComponents:
    first_name: float
    last_name: float
    swapped_names: float
    birthdate: float
    national_id_match: bool

    @property
    def names(self) -> float:
        return max((self.first_name + self.last_name) / 2, self.swapped_names)


def edit_similarity(a: str, b: str) -> float:
    """1 - (optimal string alignment distance / longer length): transpositions cost 1."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    previous_previous: list[int] = []
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cost = ca != cb
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                current[j] = min(current[j], previous_previous[j - 2] + 1)
        previous_previous, previous = previous, current
    return 1 - previous[-1] / max(len(a), len(b))


def name_similarity(trigram: float, a: str, b: str) -> float:
    return max(float(trigram), edit_similarity(a, b))


def birthdate_score(a: date, b: date) -> float:
    if a == b:
        return 1.0
    differing = (a.year != b.year) + (a.month != b.month) + (a.day != b.day)
    swapped = a.year == b.year and a.month == b.day and a.day == b.month
    return 0.75 if differing == 1 or swapped else 0.0


def combined_score(components: MatchComponents) -> float:
    if components.national_id_match:
        return 1.0
    score = NAME_WEIGHT * components.names + BIRTHDATE_WEIGHT * components.birthdate
    return round(score, 4)


def is_probable_duplicate(score: float, threshold: float | None = None) -> bool:
    """Strictly above the threshold: exactly 85% is not flagged."""
    return score > (settings.PATIENT_DUPLICATE_THRESHOLD if threshold is None else threshold)


def _normalized_national_id(value: str) -> str:
    return "".join(ch for ch in (value or "") if ch.isalnum()).upper()


def find_probable_duplicates(
    *,
    first_name: str,
    last_name: str,
    date_of_birth: date,
    national_id: str = "",
    threshold: float | None = None,
) -> list[dict]:
    """Candidates in the current tenant scoring above the threshold, best first.

    ``threshold`` defaults to the hold-for-review threshold. The live check on the
    registration form passes the lower hint threshold to show "possible matches" early.
    """
    first, last = name_key(first_name), name_key(last_name)
    national_id = _normalized_national_id(national_id)
    prefilter = (
        Q(last_name_key__trigram_similar=last)
        | Q(first_name_key__trigram_similar=first)
        | Q(last_name_key__trigram_similar=first)
        | Q(date_of_birth=date_of_birth)
    )
    if national_id:
        prefilter |= Q(national_id__iexact=national_id)
    candidates = (
        Patient.objects.active_chart()
        .filter(prefilter)
        .annotate(
            first_sim=TrigramSimilarity("first_name_key", first),
            last_sim=TrigramSimilarity("last_name_key", last),
            first_as_last=TrigramSimilarity("first_name_key", last),
            last_as_first=TrigramSimilarity("last_name_key", first),
        )
    )
    matches = []
    for patient in candidates[:500]:
        pk_first, pk_last = patient.first_name_key, patient.last_name_key
        components = MatchComponents(
            first_name=name_similarity(patient.first_sim, pk_first, first),
            last_name=name_similarity(patient.last_sim, pk_last, last),
            swapped_names=(
                name_similarity(patient.first_as_last, pk_first, last)
                + name_similarity(patient.last_as_first, pk_last, first)
            )
            / 2,
            birthdate=birthdate_score(patient.date_of_birth, date_of_birth),
            national_id_match=bool(
                national_id and _normalized_national_id(patient.national_id) == national_id
            ),
        )
        score = combined_score(components)
        if is_probable_duplicate(score, threshold):
            matches.append(
                {
                    "patient_id": str(patient.pk),
                    "mrn": patient.mrn,
                    "score": score,
                    "components": asdict(components),
                }
            )
    matches.sort(key=lambda m: m["score"], reverse=True)
    return matches[:MAX_CANDIDATES]
