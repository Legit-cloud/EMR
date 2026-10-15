"""Drug-interaction and allergy checking behind a replaceable interface.

``PHARMACY_INTERACTION_CHECKER`` names the checker class. The default uses the local
``InteractionRule`` table (a small synthetic starter set) and the patient's structured
allergies. A licensed knowledge base plugs in as another ``Checker``.
"""

from dataclasses import dataclass
from itertools import combinations

from django.conf import settings
from django.db.models import Q
from django.utils.module_loading import import_string

from apps.patients import selectors as patients

from .models import (
    BLOCKING_SEVERITIES,
    AlertKind,
    Drug,
    InteractionRule,
    InteractionSeverity,
    PrescriptionItem,
    PrescriptionStatus,
)

ACTIVE_PRESCRIPTION_STATUSES = [
    PrescriptionStatus.AUTHORISED,
    PrescriptionStatus.PARTIALLY_DISPENSED,
]


@dataclass(frozen=True)
class Alert:
    kind: str
    key: str
    severity: str
    blocking: bool
    message: str


class Checker:
    def check(self, *, patient_id, drugs: list[Drug], exclude_prescription_id=None) -> list[Alert]:
        raise NotImplementedError


def _terms(drug: Drug) -> set[str]:
    return set(drug.ingredients) | set(drug.classes)


class LocalRulesChecker(Checker):
    """Allergies, duplicate ingredients and pairwise interactions, including current meds."""

    def check(self, *, patient_id, drugs, exclude_prescription_id=None):
        alerts: list[Alert] = []
        alerts += self._allergies(patient_id, drugs)
        current = self._current_drugs(patient_id, exclude_prescription_id)
        alerts += self._duplicates(drugs, current)
        alerts += self._interactions(drugs, current)
        return sorted(alerts, key=lambda a: (not a.blocking, a.kind, a.key))

    def _allergies(self, patient_id, drugs):
        alerts = []
        for allergy in patients.active_allergies(patient_id):
            substance = allergy["substance"].strip().casefold()
            code = allergy["substance_code"].strip().casefold()
            for drug in drugs:
                matched = substance in _terms(drug) or (code and code in _terms(drug))
                if matched:
                    alerts.append(
                        Alert(
                            kind=AlertKind.ALLERGY,
                            key=f"allergy:{allergy['id']}:{drug.pk}",
                            severity=allergy["severity"],
                            blocking=True,
                            message=(
                                f"{drug.name} contains or belongs to {allergy['substance']}; "
                                f"recorded reaction: {allergy['reaction']} ({allergy['severity']})."
                            ),
                        )
                    )
        return alerts

    def _current_drugs(self, patient_id, exclude_prescription_id) -> list[Drug]:
        items = PrescriptionItem.objects.filter(
            prescription__patient_id=patient_id,
            prescription__status__in=ACTIVE_PRESCRIPTION_STATUSES,
        ).select_related("drug")
        if exclude_prescription_id:
            items = items.exclude(prescription_id=exclude_prescription_id)
        return [item.drug for item in items]

    def _duplicates(self, drugs, current):
        alerts = []
        pool = [(d, "new") for d in drugs] + [(d, "current") for d in current]
        for (a, origin_a), (b, origin_b) in combinations(pool, 2):
            if origin_a == origin_b == "current":
                continue
            shared = set(a.ingredients) & set(b.ingredients)
            for ingredient in sorted(shared):
                alerts.append(
                    Alert(
                        kind=AlertKind.DUPLICATE,
                        key=f"duplicate:{ingredient}:{min(a.pk, b.pk)}:{max(a.pk, b.pk)}",
                        severity=InteractionSeverity.MODERATE,
                        blocking=False,
                        message=f"{a.name} and {b.name} both contain {ingredient}.",
                    )
                )
        return alerts

    def _interactions(self, drugs, current):
        pool = [(d, "new") for d in drugs] + [(d, "current") for d in current]
        terms = {term for drug, _ in pool for term in _terms(drug)}
        if not terms:
            return []
        rules = list(
            InteractionRule.objects.filter(Q(ingredient_a__in=terms) & Q(ingredient_b__in=terms))
        )
        alerts = []
        for (a, origin_a), (b, origin_b) in combinations(pool, 2):
            if origin_a == origin_b == "current":
                continue
            for rule in rules:
                pair = {rule.ingredient_a, rule.ingredient_b}
                hit = (rule.ingredient_a in _terms(a) and rule.ingredient_b in _terms(b)) or (
                    rule.ingredient_b in _terms(a) and rule.ingredient_a in _terms(b)
                )
                if not hit:
                    continue
                with_current = (
                    " (currently prescribed)" if "current" in (origin_a, origin_b) else ""
                )
                alerts.append(
                    Alert(
                        kind=AlertKind.INTERACTION,
                        key=f"interaction:{'+'.join(sorted(pair))}",
                        severity=rule.severity,
                        blocking=rule.severity in BLOCKING_SEVERITIES,
                        message=f"{a.name} + {b.name}{with_current}: {rule.description}",
                    )
                )
        # One alert per interacting pair of ingredients.
        unique = {alert.key: alert for alert in alerts}
        return list(unique.values())


def get_checker() -> Checker:
    return import_string(settings.PHARMACY_INTERACTION_CHECKER)()
