from django.apps import AppConfig


class ClinicalConfig(AppConfig):
    name = "apps.clinical"
    label = "clinical"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action, Scope
        from apps.core.roles import Role

        from .models import ConsultationNote, Diagnosis, Encounter, VitalSigns

        view, create, update, remove = Action.VIEW, Action.CREATE, Action.UPDATE, Action.DELETE
        dept = Scope.DEPARTMENT

        def register(name, model, grants, *, via_encounter=True):
            prefix = "encounter__" if via_encounter else ""
            policy.register(
                name,
                model=model,
                grants=grants,
                facility_field=f"{prefix}facility",
                department_field=f"{prefix}department",
                break_glass=True,
            )

        register(
            "clinical.encounter",
            Encounter,
            [
                policy.grant({Role.DOCTOR}, {view, create, update, remove}, dept),
                policy.grant({Role.NURSE}, {view, create, update}, dept),
            ],
            via_encounter=False,
        )
        register(
            "clinical.vitalsigns",
            VitalSigns,
            [
                policy.grant({Role.DOCTOR, Role.NURSE}, {view, create, remove}, dept),
                policy.grant({Role.PHARMACIST}, {view}),
            ],
        )
        register(
            "clinical.diagnosis",
            Diagnosis,
            [
                policy.grant({Role.DOCTOR}, {view, create, update, remove}, dept),
                policy.grant({Role.NURSE}, {view}, dept),
                policy.grant({Role.PHARMACIST}, {view}),
            ],
        )
        register(
            "clinical.consultationnote",
            ConsultationNote,
            [
                policy.grant({Role.DOCTOR}, {view, create, update, remove}, dept),
                policy.grant({Role.NURSE}, {view}, dept),
            ],
        )
