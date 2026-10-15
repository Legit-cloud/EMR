from django.db import migrations

from apps.clinical.codes import load_codes


def forward(apps, schema_editor):
    load_codes(apps.get_model("clinical", "LoincCode"), apps.get_model("clinical", "Icd10Code"))


class Migration(migrations.Migration):
    dependencies = [("clinical", "0001_initial")]

    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
