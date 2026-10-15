"""Profile the requests of one chart open in-process (development aid, not a check).

docker compose run --rm -e DOCTOR_TOKEN=<token> web python scripts/profile_request.py
"""

import cProfile
import os
import pstats

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
django.setup()

from django.test import Client  # noqa: E402

from apps.patients.models import Patient  # noqa: E402

token = os.environ["DOCTOR_TOKEN"]
client = Client(HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_HOST="localhost")
patient_id = Patient.all_tenants.values_list("id", flat=True).first()
paths = [
    f"/api/patients/patients/{patient_id}/",
    f"/api/clinical/vitals/?patient={patient_id}",
    f"/api/clinical/diagnoses/?patient={patient_id}",
    f"/api/patients/allergies/?patient={patient_id}",
    f"/api/pharmacy/prescriptions/?patient={patient_id}",
]
for path in paths:  # warm up
    client.get(path)
profiler = cProfile.Profile()
profiler.enable()
for _ in range(10):
    for path in paths:
        assert client.get(path).status_code == 200, path
profiler.disable()
stats = pstats.Stats(profiler).sort_stats("cumulative")
stats.print_stats(r"apps/|rest_framework/|django/db/models/sql/compiler|hashers|json", 28)
