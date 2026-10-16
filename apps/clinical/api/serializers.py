from rest_framework import serializers

from apps.core.api.serializers import CleanModelSerializer

from ..models import (
    CodeSystem,
    ConsultationNote,
    Diagnosis,
    Encounter,
    EncounterStatus,
    Icd10Code,
    LoincCode,
    Observation,
    VitalSigns,
)


class EncounterSerializer(CleanModelSerializer):
    class Meta:
        model = Encounter
        fields = [
            "id",
            "patient",
            "encounter_class",
            "status",
            "facility",
            "department",
            "practitioner",
            "started_at",
            "ended_at",
            "reason",
            "appointment_id",
            "record_state",
        ]
        read_only_fields = ["id", "status", "ended_at", "record_state"]
        extra_kwargs = {"practitioner": {"required": False}}

    def validate(self, attrs):
        if self.instance is not None and "patient" in attrs:
            if attrs["patient"].pk != self.instance.patient_id:
                raise serializers.ValidationError({"patient": "An encounter keeps its patient."})
        return attrs


class EncounterStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=EncounterStatus.choices)


class ReadingSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=16)
    value = serializers.DecimalField(max_digits=8, decimal_places=2)
    unit = serializers.CharField(max_length=32, required=False)


class ObservationSerializer(serializers.ModelSerializer):
    display = serializers.CharField(source="code.display", read_only=True)

    class Meta:
        model = Observation
        fields = ["code", "display", "value", "unit"]


class VitalSignsSerializer(serializers.ModelSerializer):
    readings = ReadingSerializer(many=True, write_only=True)
    observations = ObservationSerializer(many=True, read_only=True)
    recorded_by = serializers.UUIDField(source="created_by_id", read_only=True)

    class Meta:
        model = VitalSigns
        fields = [
            "id",
            "patient",
            "encounter",
            "recorded_at",
            "recorded_by",
            "note",
            "readings",
            "observations",
            "record_state",
            "created_at",
        ]
        read_only_fields = ["id", "patient", "record_state", "created_at"]
        extra_kwargs = {"recorded_at": {"required": False}}


class DiagnosisSerializer(CleanModelSerializer):
    recorded_by = serializers.UUIDField(source="created_by_id", read_only=True)
    display = serializers.CharField(max_length=255, required=False)
    rank = serializers.IntegerField(min_value=1, required=False)

    class Meta:
        model = Diagnosis
        fields = [
            "id",
            "patient",
            "encounter",
            "code_system",
            "code",
            "display",
            "clinical_status",
            "verification_status",
            "onset_date",
            "abatement_date",
            "rank",
            "note",
            "recorded_by",
            "record_state",
            "created_at",
        ]
        read_only_fields = ["id", "patient", "record_state", "created_at"]
        # Rank uniqueness is a conditional database constraint, checked in full_clean.
        validators = []

    def validate(self, attrs):
        if self.instance is not None:
            for field in ("encounter", "code_system", "code"):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError(
                        {field: "Record a new diagnosis instead of recoding this one."}
                    )
            return attrs
        system, code = attrs["code_system"], attrs["code"].strip().upper()
        if system == CodeSystem.ICD10:
            entry = Icd10Code.objects.filter(code=code).first()
            if entry is None:
                raise serializers.ValidationError({"code": f"{code} is not a known ICD-10 code."})
            attrs["display"] = entry.display
        else:
            if not code.isdigit() or not 6 <= len(code) <= 18:
                raise serializers.ValidationError(
                    {"code": "A SNOMED CT concept id is 6-18 digits."}
                )
            if not attrs.get("display"):
                raise serializers.ValidationError({"display": "Required for SNOMED CT codes."})
        attrs["code"] = code
        return attrs


class RankSerializer(serializers.Serializer):
    diagnosis_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)


class ConsultationNoteSerializer(CleanModelSerializer):
    author = serializers.UUIDField(source="created_by_id", read_only=True)

    class Meta:
        model = ConsultationNote
        fields = [
            "id",
            "patient",
            "encounter",
            "subjective",
            "objective",
            "assessment",
            "plan",
            "status",
            "closed_at",
            "addendum_to",
            "author",
            "record_state",
            "created_at",
        ]
        read_only_fields = ["id", "patient", "status", "closed_at", "record_state", "created_at"]

    def validate(self, attrs):
        if self.instance is not None:
            for field in ("encounter", "addendum_to"):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError({field: "Cannot be changed."})
        return attrs


class LoincCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoincCode
        fields = ["code", "display", "unit", "min_value", "max_value", "derived"]


class Icd10CodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Icd10Code
        fields = ["code", "display"]
