"""Inpatient: admissions, beds, discharge and bed-day charges (CLAUDE.md Section 5).
Requirement IDs: SEC-02, SEC-03, SEC-07, FR-5 (admission and ward charge rules)."""

from datetime import UTC, date, datetime, timedelta
from unittest import mock

import pytest
from django.db import IntegrityError, transaction

from apps.audit.models import AuditEntry
from apps.billing.models import InvoiceLine, LineStatus
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.inpatient import services, tasks
from apps.inpatient.models import Admission, Bed, BedStatus, Ward
from apps.patients.models import Patient
from apps.tenants.models import Facility

pytestmark = pytest.mark.django_db

WARDS = "/api/inpatient/wards/"
ADMISSIONS = "/api/inpatient/admissions/"
BEDS = "/api/inpatient/beds/"


@pytest.fixture
def ward(tenant_a):
    with tenant_context(tenant_a.id):
        facility = Facility.objects.create(name="Main", code="main")
        return Ward.objects.create(
            facility=facility, name="Medical ward", daily_charge_minor=800_000
        )


@pytest.fixture
def beds(tenant_a, ward):
    with tenant_context(tenant_a.id):
        return [Bed.objects.create(ward=ward, label=f"Bed {n}") for n in range(1, 5)]


@pytest.fixture
def patients(tenant_a):
    with tenant_context(tenant_a.id):
        return [
            Patient.objects.create(
                first_name=name, last_name="Tester", date_of_birth=date(1980, 1, 1)
            )
            for name in ("Ada", "Bola", "Chi")
        ]


@pytest.fixture
def nurse(make_user, signed_in, tenant_a):
    return signed_in(make_user("nurse-ip", tenant_a, [Role.NURSE]))


@pytest.fixture
def doctor(make_user, signed_in, tenant_a):
    return signed_in(make_user("doctor-ip", tenant_a, [Role.DOCTOR]))


@pytest.fixture
def admin(make_user, signed_in, tenant_a):
    return signed_in(make_user("admin-ip", tenant_a, [Role.TENANT_ADMIN]))


def admit(client, patient, bed, reason="Severe malaria"):
    return client.post(
        ADMISSIONS,
        {"patient": str(patient.pk), "bed": str(bed.pk), "reason": reason},
        format="json",
    )


def status_of(bed, tenant):
    with tenant_context(tenant.id):
        return Bed.objects.get(pk=bed.pk).status


# -- admitting ---------------------------------------------------------------------------


def test_admitting_makes_the_bed_occupied_in_the_same_transaction(nurse, patients, beds, tenant_a):
    response = admit(nurse, patients[0], beds[0])
    assert response.status_code == 201
    body = response.json()
    assert body["patient_name"] == "Ada Tester"
    assert body["reason"] == "Severe malaria"
    assert status_of(beds[0], tenant_a) == BedStatus.OCCUPIED
    with tenant_context(tenant_a.id):
        assert Admission.objects.filter(bed=beds[0], discharged_at__isnull=True).count() == 1


def test_a_failed_admission_leaves_the_bed_vacant(patients, beds, tenant_a):
    with tenant_context(tenant_a.id):
        with mock.patch.object(Admission, "save", side_effect=RuntimeError("disk full")):
            with pytest.raises(RuntimeError):
                services.admit(patient_id=patients[0].pk, bed=beds[0], reason="Fever")
        assert Bed.objects.get(pk=beds[0].pk).status == BedStatus.VACANT
        assert not Admission.objects.exists()


@pytest.mark.parametrize(
    "state", [BedStatus.OCCUPIED, BedStatus.CLEANING, BedStatus.OUT_OF_SERVICE]
)
def test_cannot_admit_to_a_bed_that_is_not_vacant(nurse, patients, beds, tenant_a, state):
    with tenant_context(tenant_a.id):
        Bed.objects.filter(pk=beds[0].pk).update(status=state)
    response = admit(nurse, patients[0], beds[0])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "bed_unavailable"


def test_a_second_patient_cannot_take_an_occupied_bed(nurse, patients, beds):
    assert admit(nurse, patients[0], beds[0]).status_code == 201
    assert admit(nurse, patients[1], beds[0]).status_code == 409


def test_a_patient_is_in_one_bed_at_a_time(nurse, patients, beds, tenant_a):
    assert admit(nurse, patients[0], beds[0]).status_code == 201
    response = admit(nurse, patients[0], beds[1])
    assert response.status_code == 409
    assert "already admitted" in response.json()["error"]["message"]
    assert status_of(beds[1], tenant_a) == BedStatus.VACANT


def test_the_database_itself_refuses_two_open_stays_in_one_bed(patients, beds, tenant_a):
    with tenant_context(tenant_a.id):
        services.admit(patient_id=patients[0].pk, bed=beds[0], reason="Fever")
        with pytest.raises(IntegrityError), transaction.atomic():
            Admission.objects.create(
                patient=patients[1],
                bed=beds[0],
                reason="Fever",
                admitted_at=datetime.now(UTC),
            )


def test_a_deceased_or_unknown_patient_is_not_admitted(nurse, patients, beds, tenant_a):
    with tenant_context(tenant_a.id):
        Patient.objects.filter(pk=patients[0].pk).update(
            status="deceased", deceased_at=date(2026, 10, 20)
        )
    assert admit(nurse, patients[0], beds[0]).status_code == 409
    gone = type("P", (), {"pk": "11111111-1111-4111-8111-111111111111"})
    assert admit(nurse, gone, beds[0]).status_code == 409


def test_an_admission_needs_a_reason(nurse, patients, beds):
    response = nurse.post(
        ADMISSIONS,
        {"patient": str(patients[0].pk), "bed": str(beds[0].pk), "reason": "  "},
        format="json",
    )
    assert response.status_code in (400, 409)


# -- transferring ------------------------------------------------------------------------


def admission_id(response):
    return response.json()["admission"]


def test_transfer_frees_the_old_bed_for_cleaning_and_takes_the_new_one(
    nurse, patients, beds, tenant_a
):
    first = admission_id(admit(nurse, patients[0], beds[0]))
    response = nurse.post(
        f"{ADMISSIONS}{first}/transfer/",
        {"bed": str(beds[2].pk), "reason": "Needs oxygen"},
        format="json",
    )
    assert response.status_code == 200
    assert status_of(beds[0], tenant_a) == BedStatus.CLEANING
    assert status_of(beds[2], tenant_a) == BedStatus.OCCUPIED
    with tenant_context(tenant_a.id):
        stay = Admission.objects.get(pk=first)
        assert stay.bed_id == beds[2].pk
        (move,) = stay.moves.all()
        assert (move.from_bed_id, move.to_bed_id, move.reason) == (
            beds[0].pk,
            beds[2].pk,
            "Needs oxygen",
        )


def test_cannot_transfer_to_an_occupied_bed_or_the_same_bed(nurse, patients, beds, tenant_a):
    first = admission_id(admit(nurse, patients[0], beds[0]))
    admit(nurse, patients[1], beds[1])
    assert (
        nurse.post(
            f"{ADMISSIONS}{first}/transfer/", {"bed": str(beds[1].pk)}, format="json"
        ).status_code
        == 409
    )
    assert (
        nurse.post(
            f"{ADMISSIONS}{first}/transfer/", {"bed": str(beds[0].pk)}, format="json"
        ).status_code
        == 409
    )
    assert status_of(beds[0], tenant_a) == BedStatus.OCCUPIED


# -- discharging -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "note"),
    [
        ("discharged", ""),
        ("lama", "Told of the risks; signed himself out"),
        ("transferred", "UCH Ibadan"),
    ],
)
def test_discharge_ends_the_stay_with_its_status_and_sends_the_bed_to_cleaning(
    nurse, patients, beds, tenant_a, status, note
):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    response = nurse.post(
        f"{ADMISSIONS}{stay}/discharge/", {"status": status, "note": note}, format="json"
    )
    assert response.status_code == 200
    assert response.json() == {"status": status}
    assert status_of(beds[0], tenant_a) == BedStatus.CLEANING
    with tenant_context(tenant_a.id):
        done = Admission.objects.get(pk=stay)
        assert done.discharge_status == status
        assert done.discharged_at is not None


@pytest.mark.parametrize("status", ["lama", "transferred"])
def test_lama_and_transfer_need_a_note(nurse, patients, beds, status):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    response = nurse.post(
        f"{ADMISSIONS}{stay}/discharge/", {"status": status, "note": ""}, format="json"
    )
    assert response.status_code == 409


def test_cannot_discharge_twice_or_with_an_unknown_status(nurse, patients, beds):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    assert (
        nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "gone"}, format="json").status_code
        == 400
    )
    assert (
        nurse.post(
            f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json"
        ).status_code
        == 200
    )
    assert (
        nurse.post(
            f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json"
        ).status_code
        == 409
    )


def test_the_same_patient_can_be_admitted_again_after_leaving(nurse, patients, beds):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json")
    assert admit(nurse, patients[0], beds[1]).status_code == 201


# -- bed housekeeping --------------------------------------------------------------------


def test_a_cleaned_bed_is_marked_ready_and_only_then(nurse, patients, beds, tenant_a):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    assert nurse.post(f"{BEDS}{beds[0].pk}/ready/").status_code == 409  # still occupied
    nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json")
    assert nurse.post(f"{BEDS}{beds[0].pk}/ready/").json()["status"] == "vacant"
    assert nurse.post(f"{BEDS}{beds[0].pk}/ready/").status_code == 409


def test_an_empty_bed_can_leave_and_return_to_service_but_an_occupied_one_cannot(
    nurse, patients, beds
):
    admit(nurse, patients[0], beds[0])
    assert nurse.post(f"{BEDS}{beds[0].pk}/out-of-service/").status_code == 409
    assert nurse.post(f"{BEDS}{beds[1].pk}/out-of-service/").json()["status"] == "out_of_service"
    assert nurse.post(f"{BEDS}{beds[1].pk}/in-service/").json()["status"] == "vacant"
    assert nurse.post(f"{BEDS}{beds[1].pk}/in-service/").status_code == 409


# -- bed-day charges ---------------------------------------------------------------------


def lines(tenant, patient):
    with tenant_context(tenant.id):
        return list(
            InvoiceLine.objects.filter(invoice__patient_id=patient.pk, revenue_category="ward")
        )


def test_admission_bills_the_first_bed_day_as_pending(
    nurse, patients, beds, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        admit(nurse, patients[0], beds[0])
    (line,) = lines(tenant_a, patients[0])
    assert line.status == LineStatus.PENDING
    assert line.amount_minor == 800_000
    assert "Medical ward" in line.description


def test_the_midnight_job_adds_one_bed_day_per_open_admission_and_is_safe_to_rerun(
    nurse, patients, beds, tenant_a
):
    admit(nurse, patients[0], beds[0])
    admit(nurse, patients[1], beds[1])
    tomorrow = services.today() + timedelta(days=1)
    with tenant_context(tenant_a.id):
        assert services.charge_open_admissions(tomorrow) == 2
        assert services.charge_open_admissions(tomorrow) == 0
    assert len(lines(tenant_a, patients[0])) == 1
    with tenant_context(tenant_a.id):
        services.charge_open_admissions(tomorrow + timedelta(days=1))
    assert len(lines(tenant_a, patients[0])) == 2


def test_the_beat_task_bills_every_active_tenant(nurse, patients, beds, tenant_a):
    admit(nurse, patients[0], beds[0])
    assert tasks.run_daily_ward_charges() >= 1
    assert len(lines(tenant_a, patients[0])) == 1
    assert tasks.run_daily_ward_charges() == 0


def test_no_bed_day_after_discharge_for_the_deceased_or_in_a_free_ward(
    nurse, patients, beds, tenant_a, ward
):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json")
    admit(nurse, patients[1], beds[1])
    with tenant_context(tenant_a.id):
        Patient.objects.filter(pk=patients[1].pk).update(
            status="deceased", deceased_at=date(2026, 10, 20)
        )
        assert services.charge_open_admissions(services.today() + timedelta(days=1)) == 0
        Ward.objects.filter(pk=ward.pk).update(daily_charge_minor=0)
        admit_free = services.admit(patient_id=patients[2].pk, bed=beds[2], reason="Rest")
        assert services.charge_day(admit_free, services.today() + timedelta(days=1)) is False


def test_discharge_makes_the_stays_pending_bed_days_final_revenue(
    nurse, patients, beds, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        stay = admission_id(admit(nurse, patients[0], beds[0]))
    with tenant_context(tenant_a.id):
        services.charge_day(Admission.objects.get(pk=stay), services.today() + timedelta(days=1))
    assert {line.status for line in lines(tenant_a, patients[0])} == {LineStatus.PENDING}
    with django_capture_on_commit_callbacks(execute=True):
        nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json")
    done = lines(tenant_a, patients[0])
    assert len(done) == 2
    assert {line.status for line in done} == {LineStatus.FINAL}


def test_the_bed_day_is_the_hospitals_calendar_day_not_utc(settings):
    late = datetime(2026, 10, 21, 23, 30, tzinfo=UTC)  # 00:30 on the 22nd in Lagos
    with mock.patch("apps.inpatient.services.timezone.now", return_value=late):
        assert services.today() == date(2026, 10, 22)


# -- the board and who may do what -------------------------------------------------------


def test_the_board_lists_wards_beds_and_who_is_in_them(nurse, patients, beds):
    admit(nurse, patients[0], beds[0])
    (ward,) = nurse.get(WARDS).json()
    assert ward["name"] == "Medical ward"
    assert [b["label"] for b in ward["beds"]] == ["Bed 1", "Bed 2", "Bed 3", "Bed 4"]
    occupied, vacant = ward["beds"][0], ward["beds"][1]
    assert occupied["status"] == "occupied"
    assert set(occupied["occupant"]) == {
        "admission",
        "patient",
        "patient_name",
        "patient_mrn",
        "admitted_at",
        "reason",
    }
    assert occupied["occupant"]["patient_name"] == "Ada Tester"
    assert vacant["status"] == "vacant"
    assert vacant["occupant"] is None


def test_sec_02_doctor_nurse_and_admin_view_the_board_others_do_not(
    nurse, doctor, admin, patients, beds, make_user, signed_in, tenant_a
):
    for client in (nurse, doctor, admin):
        assert client.get(WARDS).status_code == 200
    for role in (Role.FRONT_DESK, Role.BILLING_OFFICER, Role.PHARMACIST, Role.FINANCE):
        stranger = signed_in(make_user(f"x-{role}", tenant_a, [role]))
        assert stranger.get(WARDS).status_code == 403, role
        assert stranger.get(ADMISSIONS).status_code == 403, role


def test_sec_02_the_admin_looks_but_cannot_admit_move_discharge_or_clean(
    admin, nurse, patients, beds
):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    assert admit(admin, patients[1], beds[1]).status_code == 403
    assert (
        admin.post(
            f"{ADMISSIONS}{stay}/transfer/", {"bed": str(beds[1].pk)}, format="json"
        ).status_code
        == 403
    )
    assert (
        admin.post(
            f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json"
        ).status_code
        == 403
    )
    assert admin.post(f"{BEDS}{beds[2].pk}/out-of-service/").status_code == 403
    assert admin.get(ADMISSIONS).status_code == 200


def test_the_admin_sets_up_wards_and_beds_and_the_nurse_cannot(admin, nurse, ward, tenant_a):
    facility = str(ward.facility_id)
    created = admin.post(
        WARDS,
        {
            "facility": facility,
            "name": "Maternity",
            "daily_charge_minor": 1_200_000,
            "currency": "NGN",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    bed = admin.post(BEDS, {"ward": created.json()["id"], "label": "Bed A"}, format="json")
    assert bed.status_code == 201
    assert bed.json()["status"] == "vacant"
    assert nurse.post(WARDS, {"facility": facility, "name": "X"}, format="json").status_code == 403
    assert (
        nurse.post(BEDS, {"ward": created.json()["id"], "label": "B"}, format="json").status_code
        == 403
    )
    duplicate = admin.post(
        WARDS, {"facility": facility, "name": "Maternity", "daily_charge_minor": 0}, format="json"
    )
    assert duplicate.status_code == 400


def test_sec_07_another_tenant_sees_nothing_and_cannot_use_our_beds(
    nurse, patients, beds, make_user, signed_in, tenant_b
):
    admit(nurse, patients[0], beds[0])
    outsider = signed_in(make_user("nurse-b", tenant_b, [Role.NURSE]))
    assert outsider.get(WARDS).json() == []
    assert outsider.get(ADMISSIONS).json()["count"] == 0
    assert admit(outsider, patients[1], beds[1]).status_code in (400, 404)
    assert outsider.post(f"{BEDS}{beds[0].pk}/ready/").status_code == 404


def test_sec_03_admitting_moving_and_discharging_are_audited(nurse, patients, beds, tenant_a):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    nurse.post(f"{ADMISSIONS}{stay}/transfer/", {"bed": str(beds[1].pk)}, format="json")
    nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json")
    with tenant_context(tenant_a.id):
        actions = [
            e.action
            for e in AuditEntry.objects.filter(
                resource="inpatient.admission", tenant_id=tenant_a.id
            )
            if e.outcome == "allowed"
        ]
    assert actions.count("create") == 1
    assert actions.count("update") == 2


# -- a patient who died, and the day of leaving ---------------------------------------------


def test_a_stay_is_closed_as_died_only_after_the_death_is_recorded_on_the_chart(
    nurse, patients, beds, tenant_a
):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    url = f"{ADMISSIONS}{stay}/discharge/"
    refused = nurse.post(url, {"status": "died", "note": ""}, format="json")
    assert refused.status_code == 409
    assert "Record the death on the patient" in refused.json()["error"]["message"]
    assert status_of(beds[0], tenant_a) == BedStatus.OCCUPIED
    with tenant_context(tenant_a.id):
        Patient.objects.filter(pk=patients[0].pk).update(
            status="deceased", deceased_at=date(2026, 10, 20)
        )
    done = nurse.post(url, {"status": "died", "note": ""}, format="json")
    assert done.status_code == 200 and done.json() == {"status": "died"}
    assert status_of(beds[0], tenant_a) == BedStatus.CLEANING


def test_a_stay_is_billed_for_the_nights_not_the_day_of_leaving(
    nurse, patients, beds, tenant_a, django_capture_on_commit_callbacks
):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    today = services.today()
    with tenant_context(tenant_a.id):
        # Admitted two days ago: the admission day and two midnights have each been billed.
        Admission.objects.filter(pk=stay).update(admitted_at=datetime.now(UTC) - timedelta(days=2))
        admission = Admission.objects.get(pk=stay)
        for back in (2, 1, 0):
            services.charge_day(admission, today - timedelta(days=back))
    assert len(lines(tenant_a, patients[0])) == 3
    with django_capture_on_commit_callbacks(execute=True):
        nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json")
    kept = [line for line in lines(tenant_a, patients[0]) if line.status == LineStatus.FINAL]
    gone = [line for line in lines(tenant_a, patients[0]) if line.status == LineStatus.VOID]
    assert len(kept) == 2  # the admission day and the next night
    assert len(gone) == 1  # the day of leaving came off the bill
    assert str(today) not in " ".join(line.description for line in kept)


def test_a_stay_that_starts_and_ends_on_the_same_day_is_one_day(
    nurse, patients, beds, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        stay = admission_id(admit(nurse, patients[0], beds[0]))
    with django_capture_on_commit_callbacks(execute=True):
        nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json")
    (only,) = lines(tenant_a, patients[0])
    assert only.status == LineStatus.FINAL


def test_finalising_a_stay_twice_changes_nothing(nurse, patients, beds, tenant_a):
    stay = admission_id(admit(nurse, patients[0], beds[0]))
    nurse.post(f"{ADMISSIONS}{stay}/discharge/", {"status": "discharged"}, format="json")
    with tenant_context(tenant_a.id):
        admission = Admission.objects.get(pk=stay)
        first = services.finalise_charges(admission)
        second = services.finalise_charges(admission)
    assert second <= first


def test_a_ward_can_belong_to_a_department_of_its_own_facility_only(admin, tenant_a, ward):
    from apps.tenants.models import Department

    with tenant_context(tenant_a.id):
        main = ward.facility
        other = Facility.objects.create(name="Annex", code="annex")
        mine = Department.objects.create(facility=main, name="Medicine")
        theirs = Department.objects.create(facility=other, name="Surgery")
    ok = admin.patch(f"{WARDS}{ward.pk}/", {"department": str(mine.pk)}, format="json")
    assert ok.status_code == 200 and ok.json()["department"] == str(mine.pk)
    bad = admin.patch(f"{WARDS}{ward.pk}/", {"department": str(theirs.pk)}, format="json")
    assert bad.status_code == 400
