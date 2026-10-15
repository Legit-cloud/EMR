from pathlib import Path

from django.core.management.base import BaseCommand

from apps.clinical.codes import CODES_FILE, load_codes
from apps.clinical.models import Icd10Code, LoincCode


class Command(BaseCommand):
    help = "Load or update LOINC and ICD-10 reference codes from a JSON file."

    def add_arguments(self, parser):
        parser.add_argument("--file", type=Path, default=CODES_FILE)

    def handle(self, *args, file, **options):
        loinc, icd10 = load_codes(LoincCode, Icd10Code, file)
        self.stdout.write(f"Loaded {loinc} LOINC and {icd10} ICD-10 codes.")
