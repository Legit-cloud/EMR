from django.db import migrations

# Synthetic starter rules for development and tests. Not clinical advice: the real
# interaction knowledge base is an open decision (CLAUDE.md Section 12).
RULES = [
    ("aspirin", "warfarin", "major", "Raised bleeding risk."),
    ("metronidazole", "warfarin", "major", "Raises warfarin effect; bleeding risk."),
    ("clarithromycin", "simvastatin", "contraindicated", "Raised statin levels; myopathy."),
    ("nitroglycerin", "sildenafil", "contraindicated", "Severe low blood pressure."),
    ("lisinopril", "spironolactone", "moderate", "Raised potassium."),
    ("ciprofloxacin", "magnesium hydroxide", "minor", "Reduced ciprofloxacin absorption."),
    ("nsaid", "warfarin", "major", "Raised bleeding risk."),
    ("artemether", "halofantrine", "contraindicated", "QT prolongation."),
]


def forward(apps, schema_editor):
    rule = apps.get_model("pharmacy", "InteractionRule")
    for a, b, severity, description in RULES:
        first, second = sorted((a, b))
        rule.objects.update_or_create(
            ingredient_a=first,
            ingredient_b=second,
            defaults={"severity": severity, "description": description},
        )


class Migration(migrations.Migration):
    dependencies = [("pharmacy", "0001_initial")]

    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
