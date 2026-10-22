from django.apps import AppConfig


class PatientsConfig(AppConfig):
    name = "apps.patients"
    label = "patients"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action
        from apps.core.roles import Role

        from . import events  # noqa: F401  (defines patient.deceased)
        from .models import Allergy, Attachment, DuplicateReview, Patient

        view, create, update, remove = Action.VIEW, Action.CREATE, Action.UPDATE, Action.DELETE
        clinicians = {Role.DOCTOR, Role.NURSE}
        policy.register(
            policy.PATIENT_RESOURCE,
            model=Patient,
            # A break-glass grant on a patient opens all of that patient's clinical records.
            break_glass=True,
            patient_field="pk",
            grants=[
                policy.grant(
                    {
                        Role.DOCTOR,
                        Role.NURSE,
                        Role.PHARMACIST,
                        Role.LAB_TECHNICIAN,
                        Role.FRONT_DESK,
                        Role.BILLING_OFFICER,
                        Role.TENANT_ADMIN,
                    },
                    {view},
                ),
                policy.grant(clinicians | {Role.FRONT_DESK}, {create, update}),
                policy.grant({Role.DOCTOR, Role.FRONT_DESK}, {remove}),
            ],
        )
        policy.register(
            "patients.allergy",
            model=Allergy,
            grants=[
                policy.grant(clinicians | {Role.PHARMACIST}, {view, create, update, remove}),
                policy.grant({Role.TENANT_ADMIN}, {view}),
            ],
        )
        policy.register(
            "patients.attachment",
            model=Attachment,
            grants=[
                policy.grant(clinicians | {Role.FRONT_DESK}, {view, create}),
                policy.grant({Role.TENANT_ADMIN}, {view}),
                policy.grant({Role.DOCTOR, Role.FRONT_DESK}, {remove}),
            ],
        )
        policy.register(
            "patients.duplicatereview",
            model=DuplicateReview,
            grants=[
                policy.grant({Role.FRONT_DESK, Role.DOCTOR}, {view, update}),
                policy.grant({Role.TENANT_ADMIN}, {view}),
            ],
        )
