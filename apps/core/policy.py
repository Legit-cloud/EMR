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
``break_glass`` let eligible clinicians open a single record outside their scope after
giving a reason (see ``accounts.services.request_break_glass``).
"""

import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from enum import StrEnum

from django.core.exceptions import ImproperlyConfigured
from django.db.models import Q, QuerySet


class Action(StrEnum):
    VIEW = "view"
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


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

    @property
    def roles(self) -> frozenset[str]:
        return frozenset(a.role for a in self.assignments)

    def on_duty(self) -> bool:
        if self._on_duty is None:
            self._on_duty = bool(_on_duty_provider and _on_duty_provider(self.user_id))
        return self._on_duty


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
) -> Resource:
    grants = tuple(grants)
    scopes = {g.scope for g in grants}
    if Scope.FACILITY in scopes and not facility_field:
        raise ImproperlyConfigured(f"{name}: facility scope needs facility_field")
    if Scope.DEPARTMENT in scopes and not department_field:
        raise ImproperlyConfigured(f"{name}: department scope needs department_field")
    if Scope.CARE_TEAM in scopes and not hasattr(model, "care_team_q"):
        raise ImproperlyConfigured(f"{name}: care-team scope needs {model.__name__}.care_team_q")
    resource = Resource(name, model, grants, phi, break_glass, facility_field, department_field)
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


def filter_queryset(subject: Subject, resource: Resource, action: Action, queryset: QuerySet):
    q = scope_q(subject, resource, action)
    return queryset.none() if q is None else queryset.filter(q)


def check_object(
    subject: Subject, resource: Resource, action: Action, obj, base_queryset: QuerySet
) -> Decision:
    """Decide for one row. Break-glass applies only to viewing."""
    q = scope_q(subject, resource, action)
    if q is not None and base_queryset.filter(q).filter(pk=obj.pk).exists():
        return Decision(True, "granted")
    if resource.break_glass and action == Action.VIEW:
        from apps.accounts.selectors import active_break_glass_grant_id

        grant_id = active_break_glass_grant_id(subject.user_id, resource.name, str(obj.pk))
        if grant_id:
            return Decision(True, "break_glass", grant_id)
    return Decision(False, "out_of_scope" if can(subject, resource, action) else "not_permitted")
