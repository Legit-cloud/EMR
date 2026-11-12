from datetime import date

import pytest

from apps.clinical.models import Encounter
from apps.core.roles import Role
from apps.patients.models import Allergy, Patient
from apps.pharmacy.models import Drug, StockBatch
from apps.tenants.models import Department, Facility


@pytest.fixture
def org(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        main = Facility.objects.create(name="Main hospital", code="main")
        return {
            "facility": main,
            "medicine": Department.objects.create(facility=main, name="Medicine"),
        }


@pytest.fixture
def doctor_user(make_user, tenant_a, org):
    return make_user("doctor", tenant_a, [Role.DOCTOR], department=org["medicine"])


@pytest.fixture
def doctor(doctor_user, signed_in):
    return signed_in(doctor_user)


@pytest.fixture
def pharmacist_user(make_user, tenant_a):
    return make_user("pharmacist", tenant_a, [Role.PHARMACIST])


@pytest.fixture
def pharmacist(pharmacist_user, signed_in):
    return signed_in(pharmacist_user)


@pytest.fixture
def patient(tenant_a, as_tenant):
    """Synthetic patient allergic to penicillin."""
    with as_tenant(tenant_a):
        patient = Patient.objects.create(
            first_name="Ngozi", last_name="Eze", date_of_birth=date(1985, 6, 1)
        )
        Allergy.objects.create(
            patient=patient,
            substance="Penicillin",
            category="medication",
            reaction="Anaphylaxis",
            severity="severe",
        )
        return patient


@pytest.fixture
def encounter(tenant_a, as_tenant, org, doctor_user, patient):
    with as_tenant(tenant_a, doctor_user):
        return Encounter.objects.create(
            patient=patient,
            encounter_class="outpatient",
            facility=org["facility"],
            department=org["medicine"],
            practitioner=doctor_user,
        )


DRUGS = {
    "amoxicillin": ("Amoxicillin", "500 mg", "capsule", ["amoxicillin"], ["penicillin"], 15000),
    "paracetamol": ("Paracetamol", "500 mg", "tablet", ["paracetamol"], [], 2500),
    "warfarin": ("Warfarin", "5 mg", "tablet", ["warfarin"], ["anticoagulant"], 8000),
    "aspirin": ("Aspirin", "75 mg", "tablet", ["aspirin"], ["nsaid"], 1000),
    "simvastatin": ("Simvastatin", "20 mg", "tablet", ["simvastatin"], ["statin"], 5000),
    "clarithromycin": ("Clarithromycin", "500 mg", "tablet", ["clarithromycin"], [], 20000),
    "lisinopril": ("Lisinopril", "10 mg", "tablet", ["lisinopril"], [], 3000),
    "spironolactone": ("Spironolactone", "25 mg", "tablet", ["spironolactone"], [], 4000),
    "panadol": ("Panadol", "500 mg", "tablet", ["paracetamol"], [], 3000),
}


@pytest.fixture
def drugs(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        return {
            key: Drug.objects.create(
                name=name,
                strength=strength,
                form=form,
                ingredients=ingredients,
                classes=classes,
                unit_price_minor=price,
            )
            for key, (name, strength, form, ingredients, classes, price) in DRUGS.items()
        }


@pytest.fixture
def stock(tenant_a, as_tenant, drugs):
    """Paracetamol: an expired batch, an early-expiry batch of 10, a later batch of 100."""
    with as_tenant(tenant_a):
        return {
            "expired": StockBatch.objects.create(
                drug=drugs["paracetamol"],
                batch_number="OLD",
                expiry_date=date(2020, 1, 1),
                quantity_on_hand=50,
            ),
            "early": StockBatch.objects.create(
                drug=drugs["paracetamol"],
                batch_number="EARLY",
                expiry_date=date(2031, 1, 1),
                quantity_on_hand=10,
            ),
            "late": StockBatch.objects.create(
                drug=drugs["paracetamol"],
                batch_number="LATE",
                expiry_date=date(2032, 1, 1),
                quantity_on_hand=100,
            ),
        }


@pytest.fixture
def prescribe(doctor, encounter, drugs):
    """``prescribe("paracetamol", "aspirin", quantity=...)`` -> draft prescription JSON."""

    def make(*drug_keys, quantity=12, client=None):
        response = (client or doctor).post(
            "/api/pharmacy/prescriptions/",
            {
                "encounter": str(encounter.pk),
                "items": [
                    {
                        "drug": str(drugs[key].pk),
                        "dose": "1 tablet",
                        "frequency": "three times daily",
                        "duration_days": 4,
                        "quantity": quantity,
                    }
                    for key in drug_keys
                ],
            },
            format="json",
        )
        assert response.status_code == 201, response.json()
        return response.json()

    return make
