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
from django_otp.plugins.otp_totp.models import TOTPDevice

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
]


class Command(BaseCommand):
    help = "Create a synthetic demo tenant with staff, patients, availability and stock."

    def add_arguments(self, parser):
        parser.add_argument("--password", required=True, help="Password for every demo user.")
        parser.add_argument("--patients", type=int, default=200)

    def handle(self, *args, password, patients, **options):
        if not settings.DEBUG:
            raise CommandError("Demo data is only for development (DEBUG must be on).")
        if Tenant.objects.filter(slug="demo-clinic").exists():
            raise CommandError("The demo tenant already exists.")
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
        tokens = {
            name: ApiToken.issue(users[name], ttl=timedelta(days=1), mfa_verified=True)[1]
            for name in ("demo-doctor", "demo-desk")
        }
        self.stdout.write(f"Created tenant {tenant.slug} with {patients} synthetic patients.")
        self.stdout.write("Users: " + ", ".join(u for u, _ in STAFF))
        self.stdout.write("Each user has an authenticator device; enrol it from the admin.")
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
            TOTPDevice.objects.create(user=user, name="demo", confirmed=True)
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
