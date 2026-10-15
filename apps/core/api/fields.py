from rest_framework import serializers


class TenantPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """Related field whose choices are the current tenant's rows, looked up per request.

    ``PrimaryKeyRelatedField(queryset=Model.objects.all())`` is built at import time, when
    no tenant is active, so the tenant filter would always be empty. Pass the model instead.
    """

    def __init__(self, model, **kwargs):
        self.model = model
        kwargs.setdefault("queryset", model.all_tenants.none())
        super().__init__(**kwargs)

    def get_queryset(self):
        return self.model.objects.all()
