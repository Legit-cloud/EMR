"""Create a hospital (tenant) and its first administrator. Safe to run in production.

Prints a generated password once unless ``--password`` is given. Sign-in still needs the
emailed code, so the email address must be a mailbox the person can read.
"""

import secrets

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts import services as accounts

from ...models import Tenant


class Command(BaseCommand):
    help = "Create a hospital tenant and a tenant admin who can sign in."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--username", default="")
        parser.add_argument("--hospital", default="Demo Hospital")
        parser.add_argument("--slug", default="demo-hospital")
        parser.add_argument("--password", default="")

    def handle(self, *args, email, username, hospital, slug, password, **options):
        username = username or email.split("@")[0]
        generated = not password
        password = password or secrets.token_urlsafe(16)
        try:
            with transaction.atomic():
                tenant, _ = Tenant.objects.get_or_create(slug=slug, defaults={"name": hospital})
                accounts.create_tenant_admin(
                    tenant_id=tenant.id,
                    username=username,
                    email=email,
                    password=password,
                    first_name="Hospital",
                    last_name="Admin",
                )
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages)) from exc
        except Exception as exc:  # duplicate username, for example
            raise CommandError(f"Could not create the admin: {exc}") from exc
        self.stdout.write(f"Hospital: {tenant.name} ({tenant.slug})")
        self.stdout.write(f"Username: {username}\nEmail: {email}")
        if generated:
            self.stdout.write(f"Password: {password}")
