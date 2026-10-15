from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class TenantUserAdmin(UserAdmin):
    list_display = ["username", "email", "tenant", "is_active", "is_superuser"]
    list_filter = ["tenant", "is_active", "is_superuser"]
    fieldsets = [*UserAdmin.fieldsets, ("Organisation", {"fields": ["tenant"]})]
