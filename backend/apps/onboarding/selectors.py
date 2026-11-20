"""Read-only queries."""

from .models import OnboardingProfile


def current_profile() -> OnboardingProfile | None:
    return OnboardingProfile.objects.first()

