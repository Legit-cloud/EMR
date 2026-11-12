"""Fuzzy duplicate detection: above 85% the registration is held for manual review."""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest
from django.db import connection

from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.patients import services
from apps.patients.duplicates import (
    MatchComponents,
    birthdate_score,
    combined_score,
    is_probable_duplicate,
)
from apps.patients.models import DuplicateReview, Patient

from .conftest import ADA

PATIENTS = "/api/patients/patients/"
REVIEWS = "/api/patients/duplicate-reviews/"


def components(names: float, birthdate: float, nid=False) -> MatchComponents:
    return MatchComponents(names, names, 0.0, birthdate, nid)


# -- scoring (pure) ----------------------------------------------------------------


def test_threshold_boundary_exactly_85_percent_is_not_flagged():
    # 0.6 * 0.75 + 0.4 * 1.0 = 0.85
    score = combined_score(components(names=0.75, birthdate=1.0))
    assert score == 0.85
    assert not is_probable_duplicate(score)


def test_threshold_boundary_just_above_85_percent_is_flagged():
    score = combined_score(components(names=0.7502, birthdate=1.0))
    assert score == 0.8501
    assert is_probable_duplicate(score)


def test_threshold_boundary_just_below_85_percent_is_not_flagged():
    assert not is_probable_duplicate(combined_score(components(names=0.7498, birthdate=1.0)))


def test_exact_national_id_match_scores_full_marks():
    assert combined_score(components(names=0.0, birthdate=0.0, nid=True)) == 1.0


def test_swapped_first_and_last_names_count():
    swapped = MatchComponents(0.1, 0.1, 1.0, 1.0, False)
    assert swapped.names == 1.0


@pytest.mark.parametrize(
    ("a", "b", "score"),
    [
        (date(1990, 4, 12), date(1990, 4, 12), 1.0),
        (date(1990, 4, 12), date(1991, 4, 12), 0.75),  # one part differs
        (date(1990, 4, 12), date(1990, 12, 4), 0.75),  # day and month swapped
        (date(1990, 4, 12), date(1991, 5, 12), 0.0),
    ],
)
def test_birthdate_partial_scores(a, b, score):
    assert birthdate_score(a, b) == score


# -- end to end with PostgreSQL trigrams -------------------------------------------


@pytest.mark.django_db
def test_exact_repeat_registration_is_held_not_created(clerk, make_patient):
    existing = make_patient()
    response = clerk.post(PATIENTS, ADA, format="json")
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "possible_duplicate"
    assert error["details"]["candidates"][0]["patient_id"] == str(existing.pk)
    assert error["details"]["candidates"][0]["score"] == 1.0
    assert Patient.all_tenants.count() == 1
    assert DuplicateReview.all_tenants.get().status == "pending"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "variant",
    [
        {"first_name": "Adaeze", "last_name": "Okonkow"},  # typo
        {"first_name": "Okonkwo", "last_name": "Adaeze"},  # swapped
        {"first_name": "ADAÉZE", "last_name": "okonkwo"},  # case and accent
        {"date_of_birth": "1990-12-04"},  # day and month swapped
    ],
)
def test_near_duplicates_are_flagged(clerk, make_patient, variant):
    make_patient()
    response = clerk.post(PATIENTS, {**ADA, **variant}, format="json")
    assert response.status_code == 409, response.json()


@pytest.mark.django_db
def test_same_national_id_is_flagged_even_with_other_details(clerk, make_patient):
    make_patient(national_id="NIN123")
    response = clerk.post(
        PATIENTS,
        {**ADA, "first_name": "Bisi", "last_name": "Lawal", "national_id": "nin-123"},
        format="json",
    )
    assert response.status_code == 409


@pytest.mark.django_db
@pytest.mark.parametrize(
    "different",
    [
        {"first_name": "Chiamaka"},  # sibling: same surname and birthday
        {"date_of_birth": "1975-09-30"},  # namesake born on another date
        {"first_name": "Bisi", "last_name": "Lawal"},
    ],
)
def test_different_people_are_registered(clerk, make_patient, different):
    make_patient()
    assert clerk.post(PATIENTS, {**ADA, **different}, format="json").status_code == 201


@pytest.mark.django_db
def test_entered_in_error_and_other_tenants_patients_are_not_candidates(
    clerk, make_patient, tenant_a, tenant_b, as_tenant
):
    hidden = make_patient()
    with as_tenant(tenant_a):
        hidden.mark_entered_in_error("Registered twice by mistake")
    make_patient(tenant=tenant_b)
    assert clerk.post(PATIENTS, ADA, format="json").status_code == 201


@pytest.mark.django_db(transaction=True)
def test_simultaneous_identical_registrations_create_only_one_patient(make_tenant):
    tenant = make_tenant("busy-clinic")
    barrier = threading.Barrier(2)

    def register(_):
        try:
            with tenant_context(tenant.id):
                barrier.wait()
                outcome = services.register_patient(
                    {"first_name": "Tolu", "last_name": "Bello", "date_of_birth": date(2001, 3, 3)}
                )
                return type(outcome).__name__
        finally:
            connection.close()

    with ThreadPoolExecutor(2) as pool:
        outcomes = sorted(pool.map(register, range(2)))
    assert outcomes == ["DuplicateReview", "Patient"]


# -- review queue ------------------------------------------------------------------


@pytest.fixture
def held(clerk, make_patient):
    existing = make_patient()
    review_id = clerk.post(PATIENTS, ADA, format="json").json()["error"]["details"]["review_id"]
    return existing, review_id


@pytest.mark.django_db
def test_reviewer_creates_a_new_patient_when_not_a_duplicate(doctor, held):
    existing, review_id = held
    assert len(doctor.get(REVIEWS, {"status": "pending"}).json()["results"]) == 1
    response = doctor.post(
        f"{REVIEWS}{review_id}/resolve/",
        {"decision": "created_new", "note": "Different person, checked ID"},
        format="json",
    )
    assert response.status_code == 200, response.json()
    created = Patient.all_tenants.get(pk=response.json()["created_patient"])
    assert created.mrn != existing.mrn
    assert response.json()["resolved_by"] is not None


@pytest.mark.django_db
def test_reviewer_links_a_duplicate_without_creating_anything(doctor, held):
    existing, review_id = held
    response = doctor.post(
        f"{REVIEWS}{review_id}/resolve/",
        {"decision": "duplicate", "matched_patient": str(existing.pk)},
        format="json",
    )
    assert response.json()["matched_patient"] == str(existing.pk)
    assert Patient.all_tenants.count() == 1
    again = doctor.post(f"{REVIEWS}{review_id}/resolve/", {"decision": "rejected"}, format="json")
    assert again.status_code == 400


@pytest.mark.django_db
def test_duplicate_decision_needs_the_matched_patient(doctor, held):
    _, review_id = held
    response = doctor.post(
        f"{REVIEWS}{review_id}/resolve/", {"decision": "duplicate"}, format="json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_only_registration_roles_see_the_review_queue(held, make_user, tenant_a, signed_in):
    pharmacist = signed_in(make_user("pharm", tenant_a, [Role.PHARMACIST]))
    assert pharmacist.get(REVIEWS).status_code == 403


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("okonkwo", "okonkwo", 1.0),
        ("okonkwo", "okonkow", 1 - 1 / 7),  # one transposition
        ("adaeze", "adaze", 1 - 1 / 6),  # one deletion
        ("ngozi", "", 0.0),
    ],
)
def test_edit_similarity_counts_a_transposition_as_one_edit(a, b, expected):
    from apps.patients.duplicates import edit_similarity

    assert edit_similarity(a, b) == pytest.approx(expected)
