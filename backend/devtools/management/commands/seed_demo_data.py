"""Synthetic demo data for local development and load tests. Never real patient data.

Lives outside ``apps/`` and is only installed by local and test settings; it also refuses
to run unless DEBUG is on. It writes several modules' models directly on purpose: it is a
development tool, not application code, so the module boundary rules do not apply.
"""

import random
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import ApiToken, RoleAssignment
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.patients.models import Patient
from apps.pharmacy.models import Drug, StockBatch
from apps.scheduling.models import AvailabilityWindow
from apps.staff.models import StaffProfile
from apps.tenants.models import Department, Facility, Tenant

FIRST = ["Adaeze", "Bayo", "Chidi", "Damilola", "Emeka", "Funmi", "Garba", "Halima", "Ifeoma"]
FIRST += ["Jide", "Kemi", "Lami", "Musa", "Ngozi", "Obinna", "Rukayat", "Segun", "Tolu", "Uche"]
LAST = ["Okonkwo", "Adeyemi", "Bello", "Eze", "Ibrahim", "Lawal", "Nwosu", "Ogunleye", "Okafor"]
LAST += ["Olawale", "Sani", "Umar", "Yusuf", "Abubakar", "Chukwu", "Danjuma", "Effiong"]

STAFF = [
    ("demo-admin", Role.TENANT_ADMIN),
    ("demo-doctor", Role.DOCTOR),
    ("demo-nurse", Role.NURSE),
    ("demo-desk", Role.FRONT_DESK),
    ("demo-pharmacist", Role.PHARMACIST),
    ("demo-billing", Role.BILLING_OFFICER),
    ("demo-finance", Role.FINANCE),
    ("demo-compliance", Role.COMPLIANCE_OFFICER),
    ("demo-lab", Role.LAB_TECHNICIAN),
]


class Command(BaseCommand):
    help = "Create a synthetic demo tenant with staff, patients, availability and stock."

    def add_arguments(self, parser):
        parser.add_argument("--password", required=True, help="Password for every demo user.")
        parser.add_argument("--patients", type=int, default=200)
        parser.add_argument(
            "--add-hospital",
            action="store_true",
            help="Top up an existing demo tenant with the lab user, a ward, tests and a claim, "
            "and set the demo users' password.",
        )

    def handle(self, *args, password, patients, add_hospital, **options):
        if not settings.DEBUG:
            raise CommandError("Demo data is only for development (DEBUG must be on).")
        if Tenant.objects.filter(slug="demo-clinic").exists():
            if not add_hospital:
                raise CommandError("The demo tenant already exists (use --add-hospital).")
            return self._top_up(password)
        rng = random.Random(42)
        with transaction.atomic():
            tenant = Tenant.objects.create(name="Demo Clinic", slug="demo-clinic")
            users = self._staff(tenant, password)
            with tenant_context(tenant.id, users["demo-admin"].pk):
                facility = Facility.objects.create(name="Demo Main", code="main")
                dept = Department.objects.create(facility=facility, name="General Outpatients")
                for user in users.values():
                    role = dict(STAFF)[user.username]
                    department = dept if role in (Role.DOCTOR, Role.NURSE) else None
                    RoleAssignment.objects.create(user=user, role=role, department=department)
                self._physician(users["demo-doctor"], facility, dept)
                self._patients(rng, patients)
                self._pharmacy()
                self._hospital(users)
        tokens = {
            name: ApiToken.issue(users[name], ttl=timedelta(days=1), mfa_verified=True)[1]
            for name in ("demo-doctor", "demo-desk")
        }
        self.stdout.write(f"Created tenant {tenant.slug} with {patients} synthetic patients.")
        self.stdout.write("Users: " + ", ".join(u for u, _ in STAFF))
        self.stdout.write("Sign-in codes are emailed to <username>@example.test (see Mailpit).")
        for name, token in tokens.items():
            self.stdout.write(f"MFA-verified API token for {name} (24 h): {token}")

    def _staff(self, tenant, password):
        users = {}
        for username, _ in STAFF:
            user = get_user_model().objects.create_user(
                username=username,
                password=password,
                tenant=tenant,
                email=f"{username}@example.test",
                first_name=username.split("-")[1].title(),
                last_name="Demo",
            )
            users[username] = user
        return users

    def _physician(self, doctor, facility, dept):
        StaffProfile.objects.create(
            user=doctor,
            staff_type="physician",
            title="Dr",
            licensing_body="mdcn",
            licence_number="MDCN-DEMO-0001",
            licence_expires_on=date.today() + timedelta(days=365),
            consultation_fee_minor=1_000_000,
        )
        zone = ZoneInfo(settings.MRN_TIME_ZONE)
        today = datetime.now(zone).date()
        for offset in range(14):
            day = today + timedelta(days=offset)
            AvailabilityWindow.objects.create(
                physician=doctor,
                facility=facility,
                department=dept,
                start_at=datetime.combine(day, time(8), tzinfo=zone),
                end_at=datetime.combine(day, time(17), tzinfo=zone),
            )

    def _patients(self, rng, count):
        for i in range(count):
            Patient.objects.create(
                first_name=rng.choice(FIRST),
                last_name=f"{rng.choice(LAST)}",
                middle_name=rng.choice(FIRST) if i % 3 else "",
                date_of_birth=date(1940, 1, 1) + timedelta(days=rng.randrange(0, 30_000)),
                sex=rng.choice(["female", "male"]),
                phone=f"+23480{rng.randrange(10_000_000, 99_999_999)}",
            )

    def _pharmacy(self):
        for name, ingredient, price in (
            ("Paracetamol", "paracetamol", 2_500),
            ("Artemether-Lumefantrine", "artemether", 150_000),
            ("Amoxicillin", "amoxicillin", 15_000),
        ):
            drug = Drug.objects.create(
                name=name,
                strength="standard",
                form="tablet",
                ingredients=[ingredient],
                unit_price_minor=price,
            )
            StockBatch.objects.create(
                drug=drug,
                batch_number="DEMO-1",
                expiry_date=date(2030, 1, 1),
                quantity_on_hand=10_000,
            )

    def _hospital(self, users):
        """A ward with an admitted patient, tests and scans at each stage, and an insurer claim."""
        from apps.billing import claims
        from apps.billing import services as billing
        from apps.billing.models import Insurer
        from apps.core.money import Money
        from apps.diagnostics import services as diagnostics
        from apps.diagnostics.models import Investigation
        from apps.inpatient import services as inpatient
        from apps.inpatient.models import Bed, Ward

        facility = Facility.objects.get()
        ward = Ward.objects.create(
            facility=facility, name="Medical ward", daily_charge_minor=800_000
        )
        beds = [Bed.objects.create(ward=ward, label=f"Bed {n}") for n in range(1, 5)]
        people = list(Patient.objects.order_by("created_at")[:4])
        # A patient with no earlier bill, so the insurer can still be set on the invoice.
        insured = Patient.objects.create(
            first_name="Ibrahim", last_name="Claimant", date_of_birth=date(1975, 5, 5), sex="male"
        )
        doctor, lab = users["demo-doctor"], users["demo-lab"]
        tenant_id = doctor.tenant_id

        with tenant_context(tenant_id, users["demo-nurse"].pk):
            inpatient.admit(patient_id=people[0].pk, bed=beds[0], reason="Severe malaria")

        fbc = Investigation.objects.create(
            kind="lab", name="Full blood count", code="58410-2", unit="g/dL",
            reference_range="12 - 16", price_minor=450_000,
        )  # fmt: skip
        malaria = Investigation.objects.create(
            kind="lab", name="Malaria parasite test", price_minor=150_000
        )
        xray = Investigation.objects.create(kind="imaging", name="Chest X-ray", price_minor=900_000)

        def place(patient, test):
            with tenant_context(tenant_id, doctor.pk):
                order = diagnostics.place_order(
                    patient_id=patient.pk, investigation=test, reason="Fever", priority="routine"
                )
                # Put the charge on the bill now rather than waiting for the worker.
                billing.add_line(
                    patient_id=patient.pk,
                    source="diagnostics.order",
                    source_id=order.pk,
                    description=test.name,
                    quantity=1,
                    unit_price=order.unit_price,
                    idempotency_key=diagnostics.billing_key(order.pk),
                    revenue_category="laboratory" if test.kind == "lab" else "imaging",
                )
            return order

        place(people[1], fbc)  # waiting
        done = place(people[2], malaria)  # resulted, waiting for a doctor to review
        scan = place(people[3], xray)  # resulted and reviewed, so the patient can see it
        with tenant_context(tenant_id, lab.pk):
            diagnostics.record_result(done, value="Parasites seen", flag="abnormal")
            diagnostics.record_result(scan, report="Clear lung fields. No effusion.", flag="normal")
            billing.finalise_line(diagnostics.billing_key(done.pk))
            billing.finalise_line(diagnostics.billing_key(scan.pk))
        with tenant_context(tenant_id, doctor.pk):
            diagnostics.review_result(scan)

        hmo = Insurer.objects.create(name="Demo HMO", code="demo-hmo")
        with tenant_context(tenant_id, users["demo-billing"].pk):
            line = billing.add_line(
                patient_id=insured.pk,
                source="demo",
                source_id="claim",
                description="Surgical consultation",
                quantity=1,
                unit_price=Money(5_000_000, "NGN"),
                idempotency_key="demo-claim-line",
            )
            billing.set_coverage(line.invoice, insurer=hmo, coverage_bp=8000)
            billing.finalise_line("demo-claim-line")
            claim = claims.create_claim(line.invoice)
            claims.submit(claim, insurer_reference="HMO-DEMO-1")

    def _top_up(self, password):
        from apps.inpatient.models import Ward

        tenant = Tenant.objects.get(slug="demo-clinic")
        User = get_user_model()
        with transaction.atomic():
            users = {u.username: u for u in User.objects.filter(tenant=tenant)}
            if "demo-lab" not in users:
                users["demo-lab"] = User.objects.create_user(
                    username="demo-lab",
                    password=password,
                    tenant=tenant,
                    email="demo-lab@example.test",
                    first_name="Lab",
                    last_name="Demo",
                )
                with tenant_context(tenant.id, users["demo-admin"].pk):
                    RoleAssignment.objects.create(user=users["demo-lab"], role=Role.LAB_TECHNICIAN)
            for user in users.values():
                user.set_password(password)
                user.save(update_fields=["password"])
            with tenant_context(tenant.id, users["demo-admin"].pk):
                if Ward.objects.exists():
                    self.stdout.write("The ward and tests are already there.")
                else:
                    self._hospital(users)
        self.stdout.write(f"Topped up {tenant.slug}. Users: " + ", ".join(sorted(users)))
