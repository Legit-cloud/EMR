from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Load synthetic demo data. Never load real patient data."

    def handle(self, *args, **options):
        self.stdout.write("No demo data defined yet.")
