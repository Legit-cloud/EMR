from pathlib import Path

from django.conf import settings
from rest_framework import serializers

from apps.core.api.fields import TenantPrimaryKeyRelatedField

from ..models import (
    Allergy,
    Attachment,
    AttachmentCategory,
    DuplicateReview,
    Patient,
    PatientStatus,
    ReviewStatus,
)
from ..normalize import clean_name, normalize_phone

# First bytes of each allowed file type; the declared type alone is not trusted.
_SIGNATURES = {
    "application/pdf": (b"%PDF-",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
}


class PhoneField(serializers.CharField):
    def to_internal_value(self, data):
        return normalize_phone(super().to_internal_value(data))


class PatientSerializer(serializers.ModelSerializer):
    phone = PhoneField(max_length=32, required=False, allow_blank=True)

    class Meta:
        model = Patient
        fields = [
            "id",
            "mrn",
            "first_name",
            "middle_name",
            "last_name",
            "date_of_birth",
            "sex",
            "national_id",
            "phone",
            "email",
            "address_line",
            "city",
            "state",
            "country",
            "status",
            "deceased_at",
            "record_state",
            "created_at",
        ]
        read_only_fields = ["id", "mrn", "status", "deceased_at", "record_state", "created_at"]

    def validate_middle_name(self, value):
        value = clean_name(value)
        if value:
            for validator in Patient._meta.get_field("first_name").validators:
                validator(value)
        return value

    def validate_national_id(self, value):
        return "".join(ch for ch in value if ch.isalnum()).upper()

    def validate_phone(self, value):
        for validator in Patient._meta.get_field("phone").validators:
            validator(value)
        return value


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=PatientStatus.choices)
    deceased_at = serializers.DateField(required=False, allow_null=True)


class EnteredInErrorSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000)


class AllergySerializer(serializers.ModelSerializer):
    class Meta:
        model = Allergy
        fields = [
            "id",
            "patient",
            "substance",
            "substance_code",
            "category",
            "reaction",
            "severity",
            "onset_date",
            "note",
            "record_state",
            "created_at",
        ]
        read_only_fields = ["id", "record_state", "created_at"]

    def validate_patient(self, patient):
        if self.instance is not None and patient.pk != self.instance.patient_id:
            raise serializers.ValidationError("An allergy cannot move to another patient.")
        return patient


class AttachmentSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)
    category = serializers.ChoiceField(choices=AttachmentCategory.choices)

    class Meta:
        model = Attachment
        fields = [
            "id",
            "patient",
            "file",
            "original_name",
            "content_type",
            "size",
            "category",
            "description",
            "record_state",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "original_name",
            "content_type",
            "size",
            "record_state",
            "created_at",
        ]

    def validate_file(self, upload):
        if upload.size > settings.PATIENT_ATTACHMENT_MAX_BYTES:
            limit = settings.PATIENT_ATTACHMENT_MAX_BYTES // (1024 * 1024)
            raise serializers.ValidationError(f"Files must be {limit} MB or smaller.")
        declared = (upload.content_type or "").split(";")[0].strip().lower()
        signatures = _SIGNATURES.get(declared)
        if signatures is None:
            raise serializers.ValidationError("Upload a PDF, JPEG or PNG file.")
        head = upload.read(16)
        upload.seek(0)
        if not head.startswith(signatures):
            raise serializers.ValidationError("The file content does not match its type.")
        return upload

    def create(self, validated_data):
        upload = validated_data["file"]
        validated_data["original_name"] = Path(upload.name).name[:255]
        validated_data["content_type"] = upload.content_type.split(";")[0].strip().lower()
        validated_data["size"] = upload.size
        return super().create(validated_data)


class DuplicateReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = DuplicateReview
        fields = [
            "id",
            "status",
            "payload",
            "candidates",
            "top_score",
            "created_by",
            "created_at",
            "resolved_by",
            "resolved_at",
            "resolution_note",
            "matched_patient",
            "created_patient",
        ]
        read_only_fields = fields


class ResolveReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(
        choices=[ReviewStatus.CREATED_NEW, ReviewStatus.DUPLICATE, ReviewStatus.REJECTED]
    )
    matched_patient = TenantPrimaryKeyRelatedField(Patient, required=False, allow_null=True)
    note = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["decision"] == ReviewStatus.DUPLICATE and not attrs.get("matched_patient"):
            raise serializers.ValidationError({"matched_patient": "Choose the existing patient."})
        return attrs
