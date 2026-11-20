from django.apps import AppConfig


class OnboardingConfig(AppConfig):
    name = "apps.onboarding"
    label = "onboarding"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action
        from apps.core.roles import Role

        from .models import OnboardingProfile

        # The first administrator answers a few questions about the organisation. Nobody else
        # has any business with them.
        policy.register(
            "onboarding.profile",
            model=OnboardingProfile,
            grants=[policy.grant({Role.TENANT_ADMIN}, {Action.VIEW, Action.UPDATE})],
            phi=False,
        )
