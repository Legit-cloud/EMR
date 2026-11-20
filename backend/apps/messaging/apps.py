from django.apps import AppConfig


class MessagingConfig(AppConfig):
    name = "apps.messaging"
    label = "messaging"

    def ready(self):
        from apps.core import events, policy
        from apps.core.policy import Action
        from apps.core.roles import STAFF_ROLES

        from . import tasks
        from .events import MESSAGE_SENT
        from .models import Thread

        events.subscribe(MESSAGE_SENT, tasks.notify_members)
        # Staff talk to staff. Who may read a thread is decided by membership in the view, not
        # by role: not even the tenant admin reads other people's threads.
        policy.register(
            "messaging.thread",
            model=Thread,
            grants=[policy.grant(STAFF_ROLES, {Action.VIEW, Action.CREATE, Action.UPDATE})],
            phi=False,
        )
