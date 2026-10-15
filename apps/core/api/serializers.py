from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers


class CleanModelSerializer(serializers.ModelSerializer):
    """ModelSerializer that runs the model's ``full_clean`` before every save.

    Business rules that live on the model (status transitions, cross-field checks,
    constraints) then apply to API writes exactly as they do in services.
    """

    clean_exclude: tuple[str, ...] = ("created_by", "updated_by")

    def create(self, validated_data):
        instance = self.Meta.model(**validated_data)
        self.clean_instance(instance)
        instance.save()
        return instance

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        self.clean_instance(instance)
        instance.save()
        return instance

    def clean_instance(self, instance) -> None:
        if hasattr(instance, "_assign_tenant"):
            instance._assign_tenant()
        try:
            instance.full_clean(exclude=list(self.clean_exclude))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(_as_detail(exc)) from exc


def _as_detail(exc: DjangoValidationError):
    if hasattr(exc, "error_dict"):
        return {
            ("non_field_errors" if field == "__all__" else field): messages
            for field, messages in exc.message_dict.items()
        }
    return {"non_field_errors": exc.messages}
