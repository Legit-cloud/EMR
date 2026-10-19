"""Authorisation policy: role grants narrowed by attributes (SEC-02).

Each module registers its resources in ``AppConfig.ready``::

    policy.register(
        "clinical.vitals",
        model=Vitals,
        grants=[
            policy.grant({Role.DOCTOR}, {Action.VIEW, Action.CREATE}, Scope.DEPARTMENT),
            policy.grant({Role.NURSE}, {Action.VIEW}, Scope.CARE_TEAM, on_duty=True),
        ],
        facility_field="facility",
        department_field="department",
        break_glass=True,
    )

A grant gives roles some actions within a scope:

- ``TENANT``: any row of the current tenant (tenant filtering is already done by models).
- ``FACILITY``: rows whose facility is one the user is assigned to for that role.
- ``DEPARTMENT``: rows whose department the user is assigned to; an assignment without a
  department covers its whole facility, and one without a facility covers the tenant.
- ``CARE_TEAM``: rows the model's ``care_team_q(user_id)`` says the user cares for.

Grants marked ``on_duty`` apply only while the user is on shift. Resources marked
``break_glass`` let eligible clinicians view records outside their scope after giving a
reason (see ``accounts.services.request_break_glass``): either one record, or, with a
grant on ``patients.patient``, every break-glass record of that patient. Break-glass only
widens *where* a role may view; it never lets a role view a resource it has no grant for.
"""

import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from enum import StrEnum

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db.models import Q, QuerySet


class Action(StrEnum):
    VIEW = "view"
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    # Separate from update so prescribers cannot also dispense.
    DISPENSE = "dispense"


class Scope(StrEnum):
    TENANT = "tenant"
    FACILITY = "facility"
    DEPARTMENT = "department"
    CARE_TEAM = "care_team"


@dataclass(frozen=True)
class Grant:
    roles: frozenset[str]
    actions: frozenset[Action]
    scope: Scope = Scope.TENANT
    on_duty: bool = False


def grant(
    roles: Iterable[str], actions: Iterable[Action], scope: Scope = Scope.TENANT, *, on_duty=False
) -> Grant:
    return Grant(frozenset(str(r) for r in roles), frozenset(actions), scope, on_duty)


@dataclass(frozen=True)
class Resource:
    name: str
    model: type
    grants: tuple[Grant, ...]
    phi: bool = True
    break_glass: bool = False
    facility_field: str | None = None
    department_field: str | None = None
    # How a row names its patient for patient-level break-glass: "patient" (a foreign key)
    # or "pk" (the patient itself). None when the resource is not tied to one patient.
    patient_field: str | None = None


# A break-glass grant on this resource opens all of one patient's break-glass records.
PATIENT_RESOURCE = "patients.patient"


@dataclass(frozen=True)
class Assignment:
    role: str
    facility_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None


@dataclass
class Subject:
    """The user a decision is made for, with their role assignments in the current tenant."""

    user_id: uuid.UUID
    tenant_id: uuid.UUID | None
    assignments: tuple[Assignment, ...]
    _on_duty: bool | None = field(default=None, repr=False)
    _patient_grants: dict[str, uuid.UUID] | None = field(default=None, repr=False)

    @property
    def roles(self) -> frozenset[str]:
        return frozenset(a.role for a in self.assignments)

    def on_duty(self) -> bool:
        if self._on_duty is None:
            self._on_duty = bool(_on_duty_provider and _on_duty_provider(self.user_id))
        return self._on_duty

    def can_break_glass(self) -> bool:
        return bool(self.roles & set(settings.BREAK_GLASS_ROLES))

    def patient_grants(self) -> dict[str, uuid.UUID]:
        """Active patient-level break-glass grants, as {patient id: grant id}."""
        if self._patient_grants is None:
            from apps.accounts.selectors import active_patient_grants

            self._patient_grants = active_patient_grants(self.user_id) if self.tenant_id else {}
        return self._patient_grants


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str
    break_glass_grant_id: uuid.UUID | None = None


_resources: dict[str, Resource] = {}
_on_duty_provider: Callable[[uuid.UUID], bool] | None = None


def register(
    name: str,
    *,
    model: type,
    grants: Iterable[Grant],
    phi: bool = True,
    break_glass: bool = False,
    facility_field: str | None = None,
    department_field: str | None = None,
    patient_field: str | None = None,
) -> Resource:
    grants = tuple(grants)
    if break_glass and patient_field is None:
        fields = {f.name for f in model._meta.get_fields()}
        patient_field = "patient" if "patient" in fields else None
    scopes = {g.scope for g in grants}
    if Scope.FACILITY in scopes and not facility_field:
        raise ImproperlyConfigured(f"{name}: facility scope needs facility_field")
    if Scope.DEPARTMENT in scopes and not department_field:
        raise ImproperlyConfigured(f"{name}: department scope needs department_field")
    if Scope.CARE_TEAM in scopes and not hasattr(model, "care_team_q"):
        raise ImproperlyConfigured(f"{name}: care-team scope needs {model.__name__}.care_team_q")
    resource = Resource(
        name, model, grants, phi, break_glass, facility_field, department_field, patient_field
    )
    _resources[name] = resource
    return resource


def get_resource(name: str) -> Resource:
    try:
        return _resources[name]
    except KeyError:
        raise ImproperlyConfigured(f"Policy resource {name!r} is not registered") from None


def registered_resources() -> dict[str, Resource]:
    return dict(_resources)


def get_on_duty_provider() -> Callable[[uuid.UUID], bool] | None:
    return _on_duty_provider


def set_on_duty_provider(provider: Callable[[uuid.UUID], bool] | None) -> None:
    """The staff module supplies shift status. Without a provider nobody counts as on duty."""
    global _on_duty_provider
    _on_duty_provider = provider


def subject_for(user, tenant_id) -> Subject:
    from apps.accounts.selectors import role_assignments

    assignments = role_assignments(user.pk) if tenant_id else ()
    return Subject(user.pk, tenant_id, tuple(assignments))


# -- decisions ---------------------------------------------------------------------


def _matching_grants(resource: Resource, subject: Subject, action: Action) -> list[Grant]:
    roles = subject.roles
    return [
        g
        for g in resource.grants
        if action in g.actions and g.roles & roles and (not g.on_duty or subject.on_duty())
    ]


def can(subject: Subject, resource: Resource, action: Action) -> bool:
    """Whether any grant could allow ``action`` on some row of ``resource``."""
    return bool(_matching_grants(resource, subject, action))


def can_tenant_wide(subject: Subject, resource: Resource, action: Action = Action.VIEW) -> bool:
    """Whether a grant allows ``action`` on every row of the tenant. Totals across the
    tenant (dashboard figures) are shown only to these subjects, since a scoped user's
    totals would either leak rows outside their scope or be silently incomplete."""
    return any(g.scope == Scope.TENANT for g in _matching_grants(resource, subject, action))


def _grant_q(resource: Resource, g: Grant, subject: Subject) -> Q | None:
    if g.scope == Scope.TENANT:
        return Q()
    if g.scope == Scope.CARE_TEAM:
        return resource.model.care_team_q(subject.user_id)
    assignments = [a for a in subject.assignments if a.role in g.roles]
    facility = f"{resource.facility_field}_id" if resource.facility_field else None
    if g.scope == Scope.FACILITY:
        if any(a.facility_id is None for a in assignments):
            return Q()
        return Q(**{f"{facility}__in": {a.facility_id for a in assignments}})
    # Department scope.
    parts = []
    for a in assignments:
        if a.department_id is not None:
            parts.append(Q(**{f"{resource.department_field}_id": a.department_id}))
        elif a.facility_id is None:
            return Q()
        elif facility:
            parts.append(Q(**{facility: a.facility_id}))
    return _any(parts)


def _any(parts: list[Q]) -> Q | None:
    if not parts:
        return None
    combined = parts[0]
    for part in parts[1:]:
        combined |= part
    return combined


def scope_q(subject: Subject, resource: Resource, action: Action) -> Q | None:
    """A filter for the rows the subject may act on, ``Q()`` for all, ``None`` for none."""
    parts = []
    for g in _matching_grants(resource, subject, action):
        q = _grant_q(resource, g, subject)
        if q is None:
            continue
        if q == Q():
            return Q()
        parts.append(q)
    return _any(parts)


def _break_glass_applies(subject: Subject, resource: Resource, action: Action) -> bool:
    return resource.break_glass and action == Action.VIEW and can(subject, resource, action)


def _patient_grant_q(subject: Subject, resource: Resource) -> Q | None:
    granted = subject.patient_grants()
    if not granted or not resource.patient_field:
        return None
    return Q(**{f"{resource.patient_field}__in": list(granted)})


def visible_q(subject: Subject, resource: Resource, action: Action) -> Q | None:
    """``scope_q`` plus the rows of patients opened with patient-level break-glass."""
    q = scope_q(subject, resource, action)
    if q == Q() or not _break_glass_applies(subject, resource, action):
        return q
    granted = _patient_grant_q(subject, resource)
    if granted is None:
        return q
    return granted if q is None else q | granted


def filter_queryset(subject: Subject, resource: Resource, action: Action, queryset: QuerySet):
    q = visible_q(subject, resource, action)
    return queryset.none() if q is None else queryset.filter(q)


def patient_id_of(resource: Resource, obj) -> str | None:
    if resource.patient_field == "pk":
        return str(obj.pk)
    if resource.patient_field:
        value = getattr(obj, f"{resource.patient_field}_id", None)
        return str(value) if value else None
    return None


def check_object(
    subject: Subject, resource: Resource, action: Action, obj, base_queryset: QuerySet
) -> Decision:
    """Decide for one row. Break-glass applies only to viewing."""
    q = scope_q(subject, resource, action)
    if q is not None and base_queryset.filter(q).filter(pk=obj.pk).exists():
        return Decision(True, "granted")
    if _break_glass_applies(subject, resource, action):
        from apps.accounts.selectors import active_break_glass_grant_id

        grant_id = active_break_glass_grant_id(subject.user_id, resource.name, str(obj.pk))
        if not grant_id:
            grant_id = subject.patient_grants().get(patient_id_of(resource, obj) or "")
        if grant_id:
            return Decision(True, "break_glass", grant_id)
    return Decision(False, "out_of_scope" if can(subject, resource, action) else "not_permitted")


def break_glass_grants_used(subject: Subject, resource: Resource, ids: list[str]) -> list[str]:
    """Patient-level grants that made any of these listed rows visible, for the audit log."""
    granted = _patient_grant_q(subject, resource) if resource.break_glass else None
    if granted is None or not ids:
        return []
    rows = resource.model.objects.filter(granted, pk__in=ids)
    q = scope_q(subject, resource, Action.VIEW)
    if q == Q():
        return []
    if q is not None:
        rows = rows.exclude(q)
    patients = {str(p) for p in rows.values_list(resource.patient_field, flat=True)}
    return sorted(str(subject.patient_grants()[p]) for p in patients)


def has_hidden_records(subject: Subject, patient_id) -> bool:
    """Whether the patient has break-glass records the subject's roles could view but its
    scope hides: the cue to offer patient-level break-glass."""
    for resource in _resources.values():
        if resource.patient_field in (None, "pk"):
            continue
        if not _break_glass_applies(subject, resource, Action.VIEW):
            continue
        q = scope_q(subject, resource, Action.VIEW)
        if q == Q():
            continue
        rows = resource.model.objects.filter(**{resource.patient_field: patient_id})
        if (rows if q is None else rows.exclude(q)).exists():
            return True
    return False
