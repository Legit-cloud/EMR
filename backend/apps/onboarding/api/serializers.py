from rest_framework import serializers

from ..models import BedBand, FacilityType, OnboardingProfile, SizeBand

# What the organisation can pick. Kept short and fixed; they map to modules and departments.
DEPARTMENTS = [
    "Outpatient (OPD)",
    "Emergency",
    "Paediatrics",
    "Maternity",
    "Surgery",
    "Laboratory",
    "Radiology",
    "Pharmacy",
]
MODULES = [
    "appointments",
    "patient_records",
    "pharmacy",
    "inpatient",
    "diagnostics",
    "billing",
    "insurance_claims",
    "patient_portal",
    "inventory",
    "hr",
]


class SignupSerializer(serializers.Serializer):
    organisation_name = serializers.CharField(min_length=2, max_length=200)
    first_name = serializers.CharField(max_length=80)
    last_name = serializers.CharField(max_length=80)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    accepted_terms = serializers.BooleanField()


class VerifySerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    code = serializers.CharField(max_length=12)


class ResendSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class AcceptedSerializer(serializers.Serializer):
    """The same answer for every sign-up request, whatever the address."""

    email = serializers.EmailField()


class VerifiedSerializer(serializers.Serializer):
    user_id = serializers.UUIDField()


class ProfileSerializer(serializers.ModelSerializer):
    complete = serializers.SerializerMethodField()
    organisation_name = serializers.SerializerMethodField()
    department_choices = serializers.SerializerMethodField()
    module_choices = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingProfile
        fields = [
            "facility_name",
            "facility_type",
            "country",
            "city",
            "phone",
            "staff_band",
            "bed_band",
            "departments",
            "modules",
            "heard_from",
            "complete",
            "organisation_name",
            "department_choices",
            "module_choices",
        ]
        read_only_fields = [
            "complete",
            "organisation_name",
            "department_choices",
            "module_choices",
        ]

    def get_complete(self, profile) -> bool:
        return profile.completed_at is not None

    def get_organisation_name(self, profile) -> str:
        return profile.tenant.name

    def get_department_choices(self, profile) -> list[str]:
        return DEPARTMENTS

    def get_module_choices(self, profile) -> list[str]:
        return MODULES


class AnswersSerializer(serializers.Serializer):
    """Any subset of the answers, saved as the person moves between steps."""

    facility_name = serializers.CharField(max_length=200, required=False)
    facility_type = serializers.ChoiceField(choices=FacilityType.choices, required=False)
    country = serializers.RegexField(r"^[A-Z]{2}$", required=False)
    city = serializers.CharField(max_length=100, required=False, allow_blank=True)
    phone = serializers.RegexField(
        r"^\+[1-9]\d{7,14}$",
        required=False,
        error_messages={"invalid": "Enter the number with its country code, like +2348012345678."},
    )
    staff_band = serializers.ChoiceField(choices=SizeBand.choices, required=False)
    bed_band = serializers.ChoiceField(choices=BedBand.choices, required=False)
    departments = serializers.ListField(
        child=serializers.ChoiceField(choices=DEPARTMENTS),
        required=False,
        max_length=len(DEPARTMENTS),
    )
    modules = serializers.ListField(
        child=serializers.ChoiceField(choices=MODULES), required=False, max_length=len(MODULES)
    )
    heard_from = serializers.CharField(max_length=100, required=False, allow_blank=True)
