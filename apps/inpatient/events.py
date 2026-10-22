"""Domain events published by the inpatient module."""

from apps.core import events

# Payload: {"admission_id": str}. Handler: bill the first bed-day.
PATIENT_ADMITTED = events.define("inpatient.admitted")
# Payload: {"admission_id": str, "status": "discharged"|"lama"|"transferred"}.
# Handler: the stay is over, so its pending bed-day charges become final.
PATIENT_DISCHARGED = events.define("inpatient.discharged")
