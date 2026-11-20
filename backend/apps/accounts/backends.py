"""Sign-in by email address, or by username for older accounts."""

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailOrUsernameBackend(ModelBackend):
    """Looks the person up by username, then by email address (any letter case).

    An email address shared by more than one active account signs nobody in, because the
    password could belong to either; those people use their username instead.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        login = (username or kwargs.get(User.USERNAME_FIELD) or "").strip()
        if not login or password is None:
            return None
        user = User.objects.filter(username__iexact=login).order_by("-is_active").first()
        if user is None and "@" in login:
            matches = list(User.objects.filter(email__iexact=login, is_active=True)[:2])
            user = matches[0] if len(matches) == 1 else None
        if user is None:
            # Same work as a real check, so a missing account is not quicker to refuse.
            User().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
