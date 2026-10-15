"""Role vocabulary (CLAUDE.md Section 7), shared so every module can write policy grants.

The platform super admin is not a tenant role: it is a Django superuser with no tenant,
and gets no access to tenant data through the policy layer.
"""

from django.db import models


class Role(models.TextChoices):
    TENANT_ADMIN = "tenant_admin", "Tenant admin"
    DOCTOR = "doctor", "Doctor"
    NURSE = "nurse", "Nurse"
    PHARMACIST = "pharmacist", "Pharmacist"
    LAB_TECHNICIAN = "lab_technician", "Lab / imaging technician"
    FRONT_DESK = "front_desk", "Front desk / receptionist"
    BILLING_OFFICER = "billing_officer", "Billing officer"
    FINANCE = "finance", "Finance / accountant"
    HR = "hr", "HR"
    COMPLIANCE_OFFICER = "compliance_officer", "Compliance officer"
    PATIENT = "patient", "Patient"


STAFF_ROLES = frozenset(r for r in Role if r != Role.PATIENT)
CLINICAL_ROLES = frozenset({Role.DOCTOR, Role.NURSE, Role.PHARMACIST, Role.LAB_TECHNICIAN})
