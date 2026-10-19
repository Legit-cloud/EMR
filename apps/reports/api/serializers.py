from rest_framework import serializers

from ..services import RANGES


class DashboardQuerySerializer(serializers.Serializer):
    range = serializers.ChoiceField(choices=list(RANGES.items()), default="12m")


class FinancePeriodSerializer(serializers.Serializer):
    start = serializers.DateField(help_text="First day of the month, or the day.")
    collected_minor = serializers.IntegerField(help_text="Payments received.")
    billed_minor = serializers.IntegerField(help_text="Charges raised (not voided).")


class RevenueShareSerializer(serializers.Serializer):
    category = serializers.CharField()
    label = serializers.CharField()
    amount_minor = serializers.IntegerField()


class FinanceSerializer(serializers.Serializer):
    currency = serializers.CharField()
    periods = FinancePeriodSerializer(many=True)
    collected_minor = serializers.IntegerField()
    previous_collected_minor = serializers.IntegerField(
        help_text="Collected in the same length of time just before the range."
    )
    revenue_mix = RevenueShareSerializer(many=True)


class PatientMixSerializer(serializers.Serializer):
    new = serializers.IntegerField(help_text="Seen in the range and registered in it.")
    returning = serializers.IntegerField(help_text="Seen in the range, registered before it.")


class ServiceCountSerializer(serializers.Serializer):
    name = serializers.CharField()
    count = serializers.IntegerField()


class LowStockSerializer(serializers.Serializer):
    drug = serializers.UUIDField()
    name = serializers.CharField()
    available = serializers.IntegerField()
    reorder_level = serializers.IntegerField()


class StockSerializer(serializers.Serializer):
    currency = serializers.CharField()
    value_minor = serializers.IntegerField(help_text="Units available at selling price.")
    products = serializers.IntegerField()
    in_stock = serializers.IntegerField()
    low = serializers.IntegerField()
    out = serializers.IntegerField()
    low_items = LowStockSerializer(many=True)


class MyDaySerializer(serializers.Serializer):
    open_notes = serializers.IntegerField()
    draft_prescriptions = serializers.IntegerField()
    licence_expires_on = serializers.DateField(
        allow_null=True, help_text="Set only when the licence expires within 60 days."
    )


class DashboardSerializer(serializers.Serializer):
    """Each card is null when the user's role does not see its data tenant-wide."""

    range = serializers.CharField()
    finance = FinanceSerializer(allow_null=True)
    patients = PatientMixSerializer(allow_null=True)
    popular_services = ServiceCountSerializer(many=True, allow_null=True)
    stock = StockSerializer(allow_null=True)
    my_day = MyDaySerializer(allow_null=True)
