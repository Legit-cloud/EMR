"""Load test for the Release 1 latency targets (CLAUDE.md Section 6), standard library only.

    chart open   p95 < 2 s    (patient, vitals, diagnoses, allergies, prescriptions)
    booking API  p95 < 500 ms (POST an appointment into a free slot)

Run against a stack seeded with ``manage.py seed_demo_data`` (development only):

    python scripts/load_test.py --base-url http://localhost:8000 \\
        --doctor-token <token> --desk-token <token> --concurrency 20 --requests 200

Exits non-zero when a target is missed. Results depend on the machine and the number of
web workers; measure on staging-sized infrastructure before relying on them.
"""

import argparse
import json
import random
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

TARGETS = {"chart_open": 2.0, "booking": 0.5}


EXTRA_HEADERS: dict[str, str] = {}


def call(base, token, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    request = urllib.request.Request(
        base + path, data=data, method=method, headers={**headers, **EXTRA_HEADERS}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, None
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return 0, None  # counted as an error


def percentile(values, pct):
    ordered = sorted(values)
    index = max(0, int(round(pct / 100 * len(ordered))) - 1)
    return ordered[index]


def chart_open(base, token, patient_id):
    started = time.perf_counter()
    statuses = [
        call(base, token, "GET", f"/api/patients/patients/{patient_id}/")[0],
        call(base, token, "GET", f"/api/clinical/vitals/?patient={patient_id}")[0],
        call(base, token, "GET", f"/api/clinical/diagnoses/?patient={patient_id}")[0],
        call(base, token, "GET", f"/api/patients/allergies/?patient={patient_id}")[0],
        call(base, token, "GET", f"/api/pharmacy/prescriptions/?patient={patient_id}")[0],
    ]
    return time.perf_counter() - started, all(s == 200 for s in statuses)


def booking(base, token, slot, patient_id, physician_id, facility_id):
    started = time.perf_counter()
    status, _ = call(
        base,
        token,
        "POST",
        "/api/scheduling/appointments/",
        {
            "patient": patient_id,
            "physician": physician_id,
            "facility": facility_id,
            "appointment_type": "new",
            "start_at": slot,
        },
    )
    # 409 (slot taken by a concurrent request) is a correct, fast answer.
    return time.perf_counter() - started, status in (201, 409)


def report(name, results, elapsed):
    durations = [d for d, _ in results]
    errors = sum(1 for _, ok in results if not ok)
    p95 = percentile(durations, 95)
    target = TARGETS[name]
    verdict = "PASS" if p95 < target and not errors else "FAIL"
    print(
        f"{name:11} n={len(durations):4}  p50={statistics.median(durations) * 1000:7.1f} ms  "
        f"p95={p95 * 1000:7.1f} ms  max={max(durations) * 1000:7.1f} ms  "
        f"errors={errors}  rate={len(durations) / elapsed:5.1f}/s  "
        f"target p95<{target * 1000:.0f} ms  {verdict}"
    )
    return verdict == "PASS"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--doctor-token", required=True)
    parser.add_argument("--desk-token", required=True)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument(
        "--behind-tls-proxy",
        action="store_true",
        help="Send X-Forwarded-Proto: https, as Railway's edge does, to a production image.",
    )
    args = parser.parse_args()
    if args.behind_tls_proxy:
        EXTRA_HEADERS["X-Forwarded-Proto"] = "https"
    base = args.base_url.rstrip("/")
    rng = random.Random(7)

    _, page = call(base, args.desk_token, "GET", "/api/patients/patients/")
    patient_ids = [p["id"] for p in page["results"]]
    _, me = call(base, args.doctor_token, "GET", "/api/accounts/auth/me/")
    physician_id = me["id"]
    slots = []
    for offset in range(1, 14):
        day = (date.today() + timedelta(days=offset)).isoformat()
        _, free = call(
            base,
            args.desk_token,
            "GET",
            f"/api/scheduling/appointments/free-slots/?physician={physician_id}&date={day}",
        )
        slots.extend(free or [])
    if not patient_ids or not slots:
        sys.exit("Seed the stack first: manage.py seed_demo_data --password ...")
    facility_id = slots[0]["facility"]

    with ThreadPoolExecutor(args.concurrency) as pool:
        started = time.perf_counter()
        charts = list(
            pool.map(
                lambda _: chart_open(base, args.doctor_token, rng.choice(patient_ids)),
                range(args.requests),
            )
        )
        chart_seconds = time.perf_counter() - started
        started = time.perf_counter()
        bookings = list(
            pool.map(
                lambda slot: booking(
                    base,
                    args.desk_token,
                    slot["start_at"],
                    rng.choice(patient_ids),
                    physician_id,
                    facility_id,
                ),
                slots[: args.requests],
            )
        )
        booking_seconds = time.perf_counter() - started
    ok = report("chart_open", charts, chart_seconds) & report("booking", bookings, booking_seconds)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
