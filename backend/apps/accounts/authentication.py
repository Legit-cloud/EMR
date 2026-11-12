from datetime import timedelta

from django.utils import timezone
from rest_framework import authentication, exceptions

from .models import ApiToken

LAST_USED_RESOLUTION = timedelta(minutes=5)


class ApiTokenAuthentication(authentication.BaseAuthentication):
    """``Authorization: Bearer <key>`` with hashed, expiring, revocable tokens."""

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Invalid token header.")
        try:
            raw_key = header[1].decode()
        except UnicodeError:
            raise exceptions.AuthenticationFailed("Invalid token header.") from None
        token = ApiToken.find(raw_key)
        if token is None or not token.user.is_active:
            raise exceptions.AuthenticationFailed("Invalid or expired token.")
        now = timezone.now()
        if token.last_used_at is None or now - token.last_used_at > LAST_USED_RESOLUTION:
            ApiToken.objects.filter(pk=token.pk).update(last_used_at=now)
        return token.user, token

    def authenticate_header(self, request):
        return self.keyword
