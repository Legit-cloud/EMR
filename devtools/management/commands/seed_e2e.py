"""A fresh synthetic tenant for the Playwright end-to-end suite. Development only.

Each run gets its own tenant, users and data, so runs never interfere. Writes the
credentials (including the TOTP keys the tests use to compute codes) to a JSON file the
browser tests read. Refuses to run unless DEBUG is on.
"""

import json
import secrets
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from apps.accounts.models import RoleAssignment
from apps.billing import services as billing
from apps.clinical import services as clinical
from apps.clinical.models import Diagnosis, Encounter
from apps.core.money import Money
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.patients import services as patients
from apps.patients.models import Allergy, Patient
from apps.pharmacy import services as pharmacy
from apps.pharmacy.models import Drug, Prescription, PrescriptionItem, StockBatch
from apps.scheduling.models import Appointment, AvailabilityWindow
from apps.staff.models import StaffProfile
from apps.tenants.models import Department, Facility, Tenant

DEFAULT_OUTPUT = Path(settings.BASE_DIR) / "frontend" / "e2e" / ".seed.json"
ROLES = {
    "doctor": Role.DOCTOR,
    "desk": Role.FRONT_DESK,
    "billing": Role.BILLING_OFFICER,
    "login": Role.NURSE,
    "pharmacist": Role.PHARMACIST,
}


class Command(BaseCommand):
    help = "Create a synthetic tenant for the browser end-to-end tests (development only)."

    def add_arguments(self, parser):
        parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)

    def handle(self, *args, output, **options):
        if not settings.DEBUG:
            raise CommandError("End-to-end data is only for development (DEBUG must be on).")
        run = timezone.now().strftime("%Y%m%d%H%M%S") + secrets.token_hex(2)
        password = secrets.token_urlsafe(16)
        with transaction.atomic():
            seed = self._seed(run, password)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(seed, indent=2, default=str), encoding="utf-8")
        self.stdout.write(f"Seeded end-to-end tenant e2e-{run}; details in {output}")

    def _seed(self, run, password):
        tenant = Tenant.objects.create(name=f"E2E Clinic {run}", slug=f"e2e-{run}")
        users = {}
        for key, role in ROLES.items():
            user = get_user_model().objects.create_user(
                username=f"e2e-{key}-{run}",
                password=password,
                tenant=tenant,
                first_name=key.title(),
                last_name="Tester",
                email=f"e2e-{key}-{run}@example.test",
            )
            device = TOTPDevice.objects.create(user=user, name="e2e", confirmed=True)
            users[key] = {"user": user, "role": role, "totp_key": device.key}

        doctor = users["doctor"]["user"]
        zone = ZoneInfo(settings.MRN_TIME_ZONE)
        tomorrow = datetime.now(zone).date() + timedelta(days=1)
        with tenant_context(tenant.id, doctor.pk):
            facility = Facility.objects.create(name="E2E Main", code="main")
            medicine = Department.objects.create(facility=facility, name="Medicine")
            for entry in users.values():
                clinical_role = entry["role"] in (Role.DOCTOR, Role.NURSE)
                RoleAssignment.objects.create(
                    user=entry["user"],
                    role=entry["role"],
                    department=medicine if clinical_role else None,
                )
            StaffProfile.objects.create(
                user=doctor,
                staff_type="physician",
                title="Dr",
                licensing_body="mdcn",
                licence_number=f"MDCN-{run}",
                licence_expires_on=date.today() + timedelta(days=400),
                consultation_fee_minor=1_000_000,
            )
            AvailabilityWindow.objects.create(
                physician=doctor,
                facility=facility,
                department=medicine,
                start_at=datetime.combine(tomorrow, time(8), tzinfo=zone),
                end_at=datetime.combine(tomorrow, time(17), tzinfo=zone),
            )

            ngozi = Patient.objects.create(
                first_name="Ngozi",
                last_name="Eze",
                date_of_birth=date(1985, 6, 1),
                sex="female",
                phone="+2348031234567",
            )
            Allergy.objects.create(
                patient=ngozi,
                substance="Penicillin",
                category="medication",
                reaction="Anaphylaxis",
                severity="severe",
            )
            encounter = Encounter.objects.create(
                patient=ngozi,
                encounter_class="outpatient",
                facility=facility,
                department=medicine,
                practitioner=doctor,
                reason="Headache and raised blood pressure",
            )
            clinical.record_vital_signs(
                encounter=encounter,
                readings=[
                    {"code": "8480-6", "value": 148},
                    {"code": "8462-4", "value": 94},
                    {"code": "8867-4", "value": 78},
                    {"code": "8310-5", "value": "36.8"},
                    {"code": "29463-7", "value": 70},
                    {"code": "8302-2", "value": 175},
                ],
            )
            Diagnosis.objects.create(
                encounter=encounter,
                patient=ngozi,
                code_system="icd10",
                code="I10",
                display="Essential (primary) hypertension",
                verification_status="confirmed",
                rank=1,
            )
            drugs = {}
            for name, ingredient, classes, price in (
                ("Amoxicillin", "amoxicillin", ["penicillin"], 15_000),
                ("Paracetamol", "paracetamol", [], 2_500),
            ):
                drug = drugs[ingredient] = Drug.objects.create(
                    name=name,
                    strength="500 mg",
                    form="tablet",
                    ingredients=[ingredient],
                    classes=classes,
                    unit_price_minor=price,
                )
                StockBatch.objects.create(
                    drug=drug,
                    batch_number=f"E2E-{run}",
                    expiry_date=date(2031, 1, 1),
                    quantity_on_hand=500,
                )

            # A signed prescription waiting at the pharmacy.
            to_dispense = Prescription.objects.create(
                patient=ngozi, encounter=encounter, prescriber=doctor
            )
            PrescriptionItem.objects.create(
                prescription=to_dispense,
                drug=drugs["paracetamol"],
                dose="2 tablets",
                frequency="three times daily",
                duration_days=3,
                quantity=18,
            )
            pharmacy.authorise(to_dispense)

            # A registration held as a possible duplicate of Ngozi Eze.
            review = patients.register_patient(
                {
                    "first_name": "Ngozi",
                    "last_name": "Ezeh",
                    "date_of_birth": date(1985, 6, 1),
                    "sex": "female",
                }
            )

            bisi = Patient.objects.create(
                first_name="Bisi", last_name="Lawal", date_of_birth=date(1990, 2, 2), sex="female"
            )
            queued = Appointment.objects.create(
                patient=bisi,
                physician=doctor,
                facility=facility,
                department=medicine,
                appointment_type="new",
                start_at=datetime.combine(tomorrow, time(9), tzinfo=zone),
                end_at=datetime.combine(tomorrow, time(9, 15), tzinfo=zone),
            )

            line = billing.charge_delivered(
                patient_id=ngozi.pk,
                source="e2e.seed",
                source_id=run,
                description="Consultation with Dr Doctor Tester",
                quantity=1,
                unit_price=Money(1_000_000, "NGN"),
                idempotency_key=f"e2e:{run}:consultation",
                revenue_category="consultation",
            )
            billing.add_line(
                patient_id=ngozi.pk,
                source="e2e.seed",
                source_id=run,
                description="Paracetamol 500 mg (Tablet)",
                quantity=12,
                unit_price=Money(2_500, "NGN"),
                idempotency_key=f"e2e:{run}:paracetamol",
                revenue_category="pharmacy",
            )
            invoice = line.invoice
            billing.record_payment(
                invoice, payer="patient", method="cash", amount=Money(500_000, "NGN")
            )

        return {
            "run": run,
            "password": password,
            "users": {
                key: {"username": entry["user"].username, "totp_key": entry["totp_key"]}
                for key, entry in users.items()
            },
            "physician_id": str(doctor.pk),
            "patient": {"id": str(ngozi.pk), "name": "Ngozi Eze", "mrn": ngozi.mrn},
            "queued_appointment_id": str(queued.pk),
            "queued_patient": "Bisi Lawal",
            "queued_patient_id": str(bisi.pk),
            "encounter_id": str(encounter.pk),
            "invoice_id": str(invoice.pk),
            "prescription_to_dispense_id": str(to_dispense.pk),
            "duplicate_review_id": str(review.pk),
            "booking_date": tomorrow.isoformat(),
        }
