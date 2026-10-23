# Retention and patient requests

## Retention
- Medical records: `RECORD_RETENTION_YEARS` (default 10) after last contact; children longer. Counsel to confirm.
- Billing records: as tax rules require.
- Audit log: as long as the records it describes.
- Nothing is deleted automatically. A record that has reached its limit is reviewed by compliance before any removal, and removal is itself recorded.
- Clinical records are never hard-deleted by users; Entered-in-Error hides a record and keeps history.

## Handling a patient request
1. The patient sends it from the portal (Your rights). They get an email acknowledgement. Compliance is alerted.
2. Compliance checks identity (portal sign-in counts for portal requests; for others, confirm with the patient).
3. Decide: do it, or refuse with a reason (for example, erasure of a medical record inside the retention period).
4. Answer in `/requests` with a note of at least ten characters. The patient is emailed to read it in the portal.
5. Aim for `DSR_RESPONSE_DAYS` (30). Late requests show first and marked.
6. Access to the full record: staff prepare the copy outside the system and hand it over in person or by a secure route, never as an email attachment.
