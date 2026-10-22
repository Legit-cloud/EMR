"""Synthetic clinical and billing records for the demo tenant, so every screen has something
to show. Never real patient data.

Like ``seed_demo_data`` this is a development tool: it refuses to run unless DEBUG is on and
writes several modules' models directly, so the module boundary rules do not apply to it.
"""

import random
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.billing import services as billing
from apps.billing.models import Payer, PaymentMethod, RevenueCategory
from apps.clinical.models import (
    ClinicalStatus,
    ConsultationNote,
    Diagnosis,
    Encounter,
    EncounterStatus,
    LoincCode,
    NoteStatus,
    Observation,
    VerificationStatus,
    VitalSigns,
    compute_bmi,
)
from apps.core.money import Money
from apps.core.tenancy import tenant_context
from apps.inpatient import services as inpatient
from apps.inpatient.models import Bed, Ward
from apps.patients.models import Allergy, Patient
from apps.pharmacy import services as pharmacy
from apps.pharmacy.models import Drug, Prescription, PrescriptionItem, Vendor
from apps.tenants.models import Department, Facility, Tenant

# (code, display, reason for visit, subjective, assessment, plan)
CONDITIONS = [
    (
        "B50.9",
        "Malaria, unspecified",
        "Fever and chills",
        "Three days of fever and headache.",
        "Uncomplicated malaria.",
        "Artemether-lumefantrine, fluids, review in 3 days.",
    ),
    (
        "I10",
        "Essential hypertension",
        "Routine blood pressure review",
        "Occasional headaches.",
        "Hypertension, borderline control.",
        "Lifestyle advice, recheck in 2 weeks.",
    ),
    (
        "J06.9",
        "Acute upper respiratory infection",
        "Cough and sore throat",
        "Five days of cough.",
        "Viral upper respiratory infection.",
        "Paracetamol, rest, fluids.",
    ),
    (
        "E11.9",
        "Type 2 diabetes mellitus",
        "Diabetes follow-up",
        "No new symptoms.",
        "Type 2 diabetes, stable.",
        "Continue current plan, repeat HbA1c in 3 months.",
    ),
    (
        "A09",
        "Gastroenteritis",
        "Diarrhoea and vomiting",
        "Two days of loose stools.",
        "Acute gastroenteritis.",
        "Oral rehydration, review if not improving.",
    ),
]
ALLERGIES = [
    ("Sulfonamides", "medication", "Skin rash", "moderate"),
    ("Peanuts", "food", "Swelling of the lips", "severe"),
    ("Dust mites", "environment", "Sneezing", "mild"),
]
PRESCRIBED = [
    ("Paracetamol", "500 mg", "three times daily", 5, 15),
    ("Artemether-Lumefantrine", "80/480 mg", "twice daily", 3, 6),
    ("Amoxicillin", "500 mg", "three times daily", 7, 21),
]
VITALS = {
    "8302-2": ("cm", 150, 190),  # height
    "29463-7": ("kg", 50, 110),  # weight
    "8867-4": ("/min", 60, 100),  # heart rate
    "8310-5": ("Cel", 36, 39),  # temperature
}


class Command(BaseCommand):
    help = (
        "Add synthetic encounters, vitals, diagnoses, notes, allergies, prescriptions and invoices."
    )

    def add_arguments(self, parser):
        parser.add_argument("--patients", type=int, default=30)

    def handle(self, *args, patients, **options):
        if not settings.DEBUG:
            raise CommandError("Demo data is only for development (DEBUG must be on).")
        try:
            tenant = Tenant.objects.get(slug="demo-clinic")
        except Tenant.DoesNotExist:
            raise CommandError("Run seed_demo_data first.") from None
        rng = random.Random(7)
        users = get_user_model().objects
        doctor, nurse = users.get(username="demo-doctor"), users.get(username="demo-nurse")
        with tenant_context(tenant.id, doctor.pk):
            if Encounter.objects.exists():
                raise CommandError("The demo tenant already has clinical records.")
            facility, dept = Facility.objects.first(), Department.objects.first()
            drugs = {d.name: d for d in Drug.objects.all()}
            made = {"encounters": 0, "prescriptions": 0, "invoices": 0}
            for patient in Patient.objects.order_by("created_at")[:patients]:
                if rng.random() < 0.4:
                    substance, category, reaction, severity = rng.choice(ALLERGIES)
                    Allergy.objects.create(
                        patient=patient,
                        substance=substance,
                        category=category,
                        reaction=reaction,
                        severity=severity,
                    )
                for visit in range(rng.choice([1, 1, 2, 3])):
                    self._visit(rng, patient, visit, doctor, nurse, facility, dept, drugs, made)
            self._stock_orders(drugs)
            self._wards(rng, facility)
        self.stdout.write(
            f"Added {made['encounters']} encounters, {made['prescriptions']} prescriptions "
            f"and {made['invoices']} paid or part-paid invoices."
        )

    def _visit(self, rng, patient, visit, doctor, nurse, facility, dept, drugs, made):
        code, display, reason, subjective, assessment, plan = rng.choice(CONDITIONS)
        started = timezone.now() - timedelta(days=rng.randrange(1, 60) + visit * 30, hours=2)
        encounter = Encounter.objects.create(
            patient=patient,
            encounter_class="outpatient",
            facility=facility,
            department=dept,
            practitioner=doctor,
            reason=reason,
            started_at=started,
            ended_at=started + timedelta(minutes=30),
        )
        made["encounters"] += 1
        self._vitals(rng, encounter, nurse, started)
        Diagnosis.objects.create(
            encounter=encounter,
            code_system="icd10",
            code=code,
            display=display,
            rank=1,
            clinical_status=ClinicalStatus.ACTIVE,
            onset_date=started.date(),
            verification_status=VerificationStatus.CONFIRMED,
        )
        ConsultationNote.objects.create(
            encounter=encounter,
            subjective=subjective,
            assessment=assessment,
            plan=plan,
            objective="Examination unremarkable apart from the findings above.",
            status=NoteStatus.CLOSED,
            closed_at=started + timedelta(minutes=25),
        )
        Encounter.objects.filter(pk=encounter.pk).update(status=EncounterStatus.FINISHED)
        billing.charge_delivered(
            patient_id=patient.pk,
            source="clinical.encounter",
            source_id=encounter.pk,
            description="Consultation",
            quantity=1,
            unit_price=Money(1_000_000, "NGN"),
            idempotency_key=f"demo-consult:{encounter.pk}",
            revenue_category=RevenueCategory.CONSULTATION,
        )
        if rng.random() < 0.6:
            self._prescribe(rng, patient, encounter, doctor, drugs, made)
        self._pay(rng, patient, made)

    def _vitals(self, rng, encounter, nurse, taken_at):
        vitals = VitalSigns.objects.create(encounter=encounter, recorded_at=taken_at)
        readings = {}
        for loinc, (unit, low, high) in VITALS.items():
            code = LoincCode.objects.filter(pk=loinc).first()
            if code is None:
                continue
            value = Decimal(str(round(rng.uniform(low, high), 1)))
            readings[loinc] = value
            Observation.objects.create(vital_signs=vitals, code=code, value=value, unit=unit)
        bmi_code = LoincCode.objects.filter(pk="39156-5").first()
        if bmi_code and "8302-2" in readings and "29463-7" in readings:
            Observation.objects.create(
                vital_signs=vitals,
                code=bmi_code,
                unit="kg/m2",
                value=compute_bmi(readings["29463-7"], readings["8302-2"]),
            )

    def _prescribe(self, rng, patient, encounter, doctor, drugs, made):
        name, dose, frequency, days, quantity = rng.choice(PRESCRIBED)
        drug = drugs.get(name)
        if drug is None:
            return
        prescription = Prescription.objects.create(
            patient=patient, encounter=encounter, prescriber=doctor
        )
        PrescriptionItem.objects.create(
            prescription=prescription,
            drug=drug,
            dose=dose,
            frequency=frequency,
            duration_days=days,
            quantity=quantity,
        )
        try:
            pharmacy.authorise(prescription, overrides={})
            made["prescriptions"] += 1
        except Exception as error:  # a blocking alert leaves the draft in place
            self.stdout.write(f"Left a draft prescription for {patient}: {error}")

    def _pay(self, rng, patient, made):
        from apps.billing.models import Invoice

        invoice = Invoice.objects.filter(patient=patient).order_by("-created_at").first()
        if invoice is None or invoice.net_due_minor <= 0:
            return
        share = rng.choice([0, 0.5, 1])
        if not share:
            return
        amount = Money(int(invoice.net_due_minor * share), invoice.currency)
        if amount.amount_minor <= 0:
            return
        billing.record_payment(
            invoice,
            payer=Payer.PATIENT,
            method=rng.choice(list(PaymentMethod.values[:3])),
            amount=amount,
            reference="DEMO",
        )
        made["invoices"] += 1

    def _stock_orders(self, drugs):
        """Vendors and three orders: one pending, one part-received, one complete."""
        if Vendor.objects.exists() or len(drugs) < 3:
            return
        today = timezone.localdate()
        expiry = today + timedelta(days=540)
        medsupply = Vendor.objects.create(
            name="MedSupply Nigeria Ltd",
            email="orders@medsupply.example.test",
            phone="+2348012340001",
        )
        walk_in = Vendor.objects.create(name="Walk-in Supplier")
        chosen = list(drugs.values())[:3]

        def order(vendor, specs):
            return pharmacy.place_order(
                vendor=vendor,
                lines=[
                    {"drug": drug, "quantity": qty, "unit_cost_minor": cost}
                    for drug, qty, cost in specs
                ],
                note="Demo order",
            )

        order(medsupply, [(chosen[0], 200, 90_00), (chosen[1], 120, 150_00)])
        part = order(medsupply, [(chosen[1], 100, 140_00), (chosen[2], 60, 300_00)])
        first = part.lines.first()
        pharmacy.receive_order(
            part,
            [{"line": first, "quantity": 40, "batch_number": "DEMO-PO-1", "expiry_date": expiry}],
        )
        done = order(walk_in, [(chosen[2], 50, 280_00)])
        pharmacy.receive_order(
            done,
            [
                {
                    "line": done.lines.first(),
                    "quantity": 50,
                    "batch_number": "DEMO-PO-2",
                    "expiry_date": expiry,
                }
            ],
        )

    def _wards(self, rng, facility):
        """Three wards with beds, and a few patients already admitted."""
        if Ward.objects.exists():
            return
        beds = []
        for name, charge, labels in (
            ("Medical ward", 800_000, [f"Bed {n}" for n in range(1, 7)]),
            ("Paediatrics", 650_000, [f"Cot {n}" for n in range(1, 5)]),
            ("Maternity", 1_200_000, [f"Bed {n}" for n in range(1, 5)]),
        ):
            ward = Ward.objects.create(facility=facility, name=name, daily_charge_minor=charge)
            beds += [Bed.objects.create(ward=ward, label=label) for label in labels]
        # One bed of the medical ward is out for repair.
        inpatient.set_out_of_service(beds[5], True)
        reasons = ["Severe malaria", "Pneumonia", "Hypertensive crisis", "Post-operative care"]
        for bed, patient in zip(
            beds, rng.sample(list(Patient.objects.all()[:20]), 4), strict=False
        ):
            inpatient.admit(patient_id=patient.pk, bed=bed, reason=rng.choice(reasons))
