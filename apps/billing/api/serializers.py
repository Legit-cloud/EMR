from rest_framework import serializers

from apps.core.api.fields import TenantPrimaryKeyRelatedField
from apps.core.api.serializers import CleanModelSerializer

from ..models import (
    FULL_COVERAGE_BP,
    Account,
    Insurer,
    Invoice,
    InvoiceLine,
    JournalEntry,
    JournalLine,
    Payer,
    Payment,
    PaymentMethod,
    RevenueCategory,
)


class InsurerSerializer(CleanModelSerializer):
    class Meta:
        model = Insurer
        fields = ["id", "name", "code", "is_active"]
        read_only_fields = ["id"]


class InvoiceLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLine
        fields = [
            "id",
            "source",
            "source_id",
            "description",
            "revenue_category",
            "quantity",
            "unit_price_minor",
            "amount_minor",
            "insurer_amount_minor",
            "patient_amount_minor",
            "status",
            "finalised_at",
        ]


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = [
            "id",
            "invoice",
            "payer",
            "method",
            "amount_minor",
            "currency",
            "reference",
            "received_at",
            "received_by",
        ]


class InvoiceSerializer(serializers.ModelSerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "patient",
            "currency",
            "insurer",
            "insurer_coverage_bp",
            "payment_status",
            "total_minor",
            "insurer_due_minor",
            "patient_due_minor",
            "insurer_paid_minor",
            "patient_paid_minor",
            "net_due_minor",
            "paid_at",
            "estate_review",
            "lines",
            "payments",
            "created_at",
        ]
        read_only_fields = fields


class CoverageSerializer(serializers.Serializer):
    insurer = TenantPrimaryKeyRelatedField(Insurer, allow_null=True, required=False)
    coverage_bp = serializers.IntegerField(min_value=0, max_value=FULL_COVERAGE_BP)


class PaymentRequestSerializer(serializers.Serializer):
    payer = serializers.ChoiceField(choices=Payer.choices)
    method = serializers.ChoiceField(choices=PaymentMethod.choices)
    amount_minor = serializers.IntegerField(min_value=1)
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    # Send the same key when retrying, so a timeout never records the payment twice.
    idempotency_key = serializers.CharField(max_length=100, required=False)


class ManualChargeSerializer(serializers.Serializer):
    description = serializers.CharField(max_length=255)
    quantity = serializers.IntegerField(min_value=1)
    unit_price_minor = serializers.IntegerField(min_value=0)
    revenue_category = serializers.ChoiceField(choices=RevenueCategory.choices)
    delivered = serializers.BooleanField(default=True)
    idempotency_key = serializers.CharField(max_length=100, required=False)


class ReconciliationSerializer(serializers.Serializer):
    reconciled = serializers.BooleanField()
    problems = serializers.ListField(child=serializers.CharField())


class TrialBalanceSerializer(serializers.Serializer):
    debits_minor = serializers.IntegerField()
    credits_minor = serializers.IntegerField()


class AccountSerializer(serializers.ModelSerializer):
    balance_minor = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = ["id", "code", "name", "account_type", "balance_minor"]

    def get_balance_minor(self, account) -> int:
        return self.context.get("balances", {}).get(account.code, 0)


class JournalLineSerializer(serializers.ModelSerializer):
    account = serializers.CharField(source="account.code")

    class Meta:
        model = JournalLine
        fields = ["account", "debit_minor", "credit_minor"]


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalLineSerializer(many=True, read_only=True)

    class Meta:
        model = JournalEntry
        fields = ["id", "posted_at", "description", "source", "source_id", "currency", "lines"]
