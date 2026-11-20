"""What each role is, in plain words, and what it may do.

The list of permissions is built from the live policy rules (``apps.core.policy``), not written
by hand, so it can never disagree with what the server enforces. Only the wording lives here.
"""

from apps.core import policy
from apps.core.policy import Action, Scope
from apps.core.roles import Role

# Roles an administrator can give when inviting someone. Patients get access through the portal.
INVITABLE = [r for r in Role if r != Role.PATIENT]

ROLE_INFO: dict[str, tuple[str, str]] = {
    Role.TENANT_ADMIN: (
        "Organisation admin",
        "Runs the organisation: manages users and roles, facilities and departments, and can "
        "view everything for oversight. Cannot change clinical records.",
    ),
    Role.DOCTOR: (
        "Doctor",
        "Sees patients, records vitals, diagnoses and notes, and prescribes.",
    ),
    Role.NURSE: (
        "Nurse",
        "Cares for patients: vitals, bed management, and day-to-day supplies.",
    ),
    Role.PHARMACIST: (
        "Pharmacist",
        "Dispenses prescriptions and manages the formulary, stock and supplies.",
    ),
    Role.LAB_TECHNICIAN: (
        "Lab and imaging technician",
        "Receives test and scan orders and enters results.",
    ),
    Role.FRONT_DESK: (
        "Front desk",
        "Registers patients, books appointments and runs the queue.",
    ),
    Role.BILLING_OFFICER: (
        "Billing officer",
        "Prepares invoices, takes payments and works insurer claims.",
    ),
    Role.FINANCE: (
        "Finance",
        "Reviews billing and the ledger, and keeps the books.",
    ),
    Role.HR: (
        "HR",
        "Manages staff records, licences and leave.",
    ),
    Role.COMPLIANCE_OFFICER: (
        "Compliance officer",
        "Reviews the audit log and break-glass access. Cannot change records.",
    ),
}

RESOURCE_LABELS: dict[str, str] = {
    "accounts.breakglassgrant": "Break-glass access reviews",
    "accounts.roleassignment": "User roles",
    "accounts.user": "Users",
    "audit.auditentry": "Audit log",
    "billing.claim": "Insurer claims",
    "billing.insurer": "Insurers",
    "billing.invoice": "Invoices",
    "billing.journalentry": "Ledger entries",
    "billing.ledger": "Accounts and reports",
    "billing.payment": "Payments",
    "billing.paymentintent": "Online payments",
    "clinical.consultationnote": "Consultation notes",
    "clinical.diagnosis": "Diagnoses",
    "clinical.encounter": "Encounters",
    "clinical.vitalsigns": "Vital signs",
    "diagnostics.investigation": "Test catalogue",
    "diagnostics.order": "Test and scan orders",
    "diagnostics.result": "Test and scan results",
    "inpatient.admission": "Admissions",
    "inpatient.bed": "Beds",
    "inpatient.ward": "Wards",
    "inventory.item": "Supplies",
    "inventory.stockmovement": "Supply stock movements",
    "messaging.thread": "Staff messages",
    "onboarding.profile": "Organisation setup answers",
    "patients.allergy": "Allergies",
    "patients.attachment": "Patient documents",
    "patients.duplicatereview": "Duplicate patient review",
    "patients.patient": "Patient records",
    "pharmacy.drug": "Formulary",
    "pharmacy.prescription": "Prescriptions",
    "pharmacy.purchaseorder": "Stock orders",
    "pharmacy.stockbatch": "Drug stock",
    "pharmacy.vendor": "Vendors",
    "portal.account": "Patient portal accounts",
    "portal.request": "Patient data requests",
    "scheduling.appointment": "Appointments",
    "scheduling.availabilitywindow": "Doctor availability",
    "staff.leave": "Leave requests",
    "staff.shift": "Shifts",
    "staff.staffprofile": "Staff records",
    "tenants.department": "Departments",
    "tenants.facility": "Facilities",
}

ACTION_WORDS = {
    Action.VIEW: "View",
    Action.CREATE: "Add",
    Action.UPDATE: "Change",
    Action.DELETE: "Remove",
    Action.DISPENSE: "Dispense",
    Action.APPROVE: "Approve",
}
_ORDER = [Action.VIEW, Action.CREATE, Action.UPDATE, Action.DELETE, Action.DISPENSE, Action.APPROVE]

SCOPE_WORDS = {
    Scope.TENANT: "",
    Scope.FACILITY: "in their facility",
    Scope.DEPARTMENT: "in their department",
    Scope.CARE_TEAM: "for patients in their care",
}


def label_for(resource: str) -> str:
    return RESOURCE_LABELS.get(resource) or resource.split(".")[-1].replace("_", " ").capitalize()


def permissions_of(role: str) -> list[dict]:
    """What the role may do, one entry per thing, with the widest scope each action has."""
    rows = []
    for name, resource in sorted(policy.registered_resources().items()):
        if name.startswith("tenancy_app."):
            continue  # test-only models
        # action -> the widest scope any grant gives it (tenant beats facility beats the rest)
        rank = {Scope.CARE_TEAM: 0, Scope.DEPARTMENT: 1, Scope.FACILITY: 2, Scope.TENANT: 3}
        best: dict[Action, tuple[Scope, bool]] = {}
        for g in resource.grants:
            if role not in g.roles:
                continue
            for action in g.actions:
                current = best.get(action)
                if current is None or rank[g.scope] > rank[current[0]]:
                    best[action] = (g.scope, g.on_duty)
        if not best:
            continue
        actions = [a for a in _ORDER if a in best]
        scopes = {best[a][0] for a in actions}
        scope = min(scopes, key=lambda s: rank[s])  # the narrowest limit that applies
        rows.append(
            {
                "resource": name,
                "label": label_for(name),
                "actions": [ACTION_WORDS[a] for a in actions],
                "limit": SCOPE_WORDS[scope],
                "on_duty_only": any(best[a][1] for a in actions),
            }
        )
    return rows


def catalogue() -> list[dict]:
    return [
        {
            "role": str(role),
            "label": ROLE_INFO[role][0],
            "description": ROLE_INFO[role][1],
            "permissions": permissions_of(str(role)),
        }
        for role in INVITABLE
    ]
