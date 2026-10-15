"""Safety checks before signing, override logging and tamper-evident signatures (SEC-09)."""

import base64

import pytest

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.pharmacy import signing
from apps.pharmacy.models import (
    Prescription,
    PrescriptionAlert,
    PrescriptionItem,
    SignedRecordLocked,
)

pytestmark = pytest.mark.django_db

PRESCRIPTIONS = "/api/pharmacy/prescriptions/"
REASON = "Benefit outweighs risk; patient monitored in clinic"


def authorise(client, prescription, overrides=None):
    return client.post(
        f"{PRESCRIPTIONS}{prescription['id']}/authorise/",
        {"overrides": overrides or {}},
        format="json",
    )


# -- the alert blocks the save -------------------------------------------------------


def test_allergy_alert_blocks_signing_and_nothing_is_saved(
    doctor, prescribe, django_capture_on_commit_callbacks
):
    draft = prescribe("amoxicillin")
    with django_capture_on_commit_callbacks() as callbacks:
        response = authorise(doctor, draft)
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "safety_alerts"
    [alert] = error["details"]["alerts"]
    assert alert["kind"] == "allergy" and alert["blocking"] is True
    assert "Penicillin" in alert["message"] and "Anaphylaxis" in alert["message"]
    assert error["details"]["override_required"] == [alert["key"]]

    prescription = Prescription.all_tenants.get(pk=draft["id"])
    assert prescription.status == "draft" and prescription.signature == ""
    assert not PrescriptionAlert.all_tenants.exists()
    assert callbacks == []  # prescription.authorised was not published


def test_override_needs_a_real_reason_and_is_logged(doctor, doctor_user, prescribe):
    draft = prescribe("amoxicillin")
    key = authorise(doctor, draft).json()["error"]["details"]["alerts"][0]["key"]
    assert authorise(doctor, draft, {key: "ok"}).status_code == 409

    response = authorise(doctor, draft, {key: REASON})
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["status"] == "authorised"
    assert body["alerts"][0]["override_reason"] == REASON
    entry = AuditEntry.objects.get(details__override=key)
    assert entry.reason == REASON and entry.actor_id == doctor_user.pk


def test_interaction_with_current_medication_blocks(doctor, prescribe):
    authorise(doctor, prescribe("warfarin"))
    response = authorise(doctor, prescribe("aspirin"))
    assert response.status_code == 409
    alert = response.json()["error"]["details"]["alerts"][0]
    assert alert["kind"] == "interaction" and alert["severity"] == "major"
    assert "currently prescribed" in alert["message"]


def test_contraindicated_pair_in_one_prescription_blocks(doctor, prescribe):
    response = authorise(doctor, prescribe("simvastatin", "clarithromycin"))
    assert response.json()["error"]["details"]["alerts"][0]["severity"] == "contraindicated"


def test_moderate_interactions_and_duplicates_warn_without_blocking(doctor, prescribe):
    response = authorise(
        doctor, prescribe("lisinopril", "spironolactone", "paracetamol", "panadol")
    )
    assert response.status_code == 200, response.json()
    kinds = sorted((a["kind"], a["blocking"]) for a in response.json()["alerts"])
    assert kinds == [("duplicate", False), ("interaction", False)]


def test_safety_check_preview_changes_nothing(doctor, prescribe):
    draft = prescribe("amoxicillin")
    alerts = doctor.post(f"{PRESCRIPTIONS}{draft['id']}/check/").json()
    assert [a["kind"] for a in alerts] == ["allergy"]
    assert Prescription.all_tenants.get(pk=draft["id"]).status == "draft"


# -- who may do what -----------------------------------------------------------------


def test_only_the_prescriber_signs(prescribe, make_user, tenant_a, org, signed_in):
    draft = prescribe("paracetamol")
    colleague = signed_in(
        make_user("colleague", tenant_a, [Role.DOCTOR], department=org["medicine"])
    )
    assert authorise(colleague, draft).status_code == 409


def test_sec_02_pharmacists_dispense_but_do_not_prescribe(
    pharmacist, doctor, prescribe, encounter, drugs
):
    response = pharmacist.post(
        PRESCRIPTIONS,
        {
            "encounter": str(encounter.pk),
            "items": [
                {
                    "drug": str(drugs["paracetamol"].pk),
                    "dose": "1",
                    "frequency": "tds",
                    "duration_days": 1,
                    "quantity": 1,
                }
            ],
        },
        format="json",
    )
    assert response.status_code == 403
    signed = authorise(doctor, prescribe("paracetamol")).json()
    item = signed["items"][0]["id"]
    response = doctor.post(
        f"{PRESCRIPTIONS}{signed['id']}/dispense/", {"items": {item: 1}}, format="json"
    )
    assert response.status_code == 403  # prescribers cannot dispense


# -- signatures ----------------------------------------------------------------------


@pytest.fixture
def signed(doctor, prescribe, tenant_a, as_tenant):
    body = authorise(doctor, prescribe("paracetamol")).json()
    with as_tenant(tenant_a):
        return Prescription.objects.get(pk=body["id"])


def verify_api(client, prescription):
    return client.get(f"{PRESCRIPTIONS}{prescription.pk}/verify/").json()


def test_sec_09_signed_prescription_verifies(doctor, signed):
    assert signed.signature and signed.signing_key_id and len(signed.signed_payload_sha256) == 64
    assert verify_api(doctor, signed) == {
        "signed": True,
        "valid": True,
        "signing_key_id": signed.signing_key_id,
    }


def test_sec_09_signed_prescription_cannot_be_edited(doctor, signed, tenant_a, as_tenant):
    response = doctor.patch(f"{PRESCRIPTIONS}{signed.pk}/", {"note": "changed"}, format="json")
    assert response.status_code == 400
    with as_tenant(tenant_a):
        item = signed.items.first()
        item.quantity = 999
        with pytest.raises(SignedRecordLocked):
            item.save()


@pytest.mark.parametrize(
    "tamper",
    [
        lambda p: PrescriptionItem.all_tenants.filter(prescription=p).update(quantity=999),
        lambda p: PrescriptionItem.all_tenants.filter(prescription=p).update(dose="10 tablets"),
        lambda p: Prescription.all_tenants.filter(pk=p.pk).update(
            authorised_at=p.authorised_at.replace(year=2020)
        ),
        lambda p: Prescription.all_tenants.filter(pk=p.pk).update(
            signature=base64.b64encode(b"x" * 64).decode()
        ),
    ],
    ids=["quantity", "dose", "authorised_at", "signature"],
)
def test_sec_09_any_tampering_is_detected_and_blocks_dispensing(
    tamper, doctor, pharmacist, signed, stock
):
    tamper(signed)
    signed.refresh_from_db()
    assert verify_api(doctor, signed)["valid"] is False
    item = PrescriptionItem.all_tenants.filter(prescription=signed).first()
    response = pharmacist.post(
        f"{PRESCRIPTIONS}{signed.pk}/dispense/", {"items": {str(item.pk): 1}}, format="json"
    )
    assert response.status_code == 409


def test_sec_09_tampered_override_reason_is_detected(doctor, prescribe, tenant_a, as_tenant):
    draft = prescribe("amoxicillin")
    key = authorise(doctor, draft).json()["error"]["details"]["alerts"][0]["key"]
    authorise(doctor, draft, {key: REASON})
    PrescriptionAlert.all_tenants.filter(prescription_id=draft["id"]).update(override_reason="none")
    with as_tenant(tenant_a):
        assert signing.verify(Prescription.objects.get(pk=draft["id"])) is False


def test_sec_09_rotated_keys_still_verify_old_prescriptions(signed, settings):
    old_public = signing._private_key().public_key()
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    settings.PRESCRIPTION_SIGNING_KEY = base64.b64encode(b"n" * 32).decode()
    assert signing.verify(signed) is False  # unknown key id
    settings.PRESCRIPTION_RETIRED_PUBLIC_KEYS = [
        base64.b64encode(old_public.public_bytes(Encoding.Raw, PublicFormat.Raw)).decode()
    ]
    assert signing.verify(signed) is True
