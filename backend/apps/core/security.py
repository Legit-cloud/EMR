"""Security headers added to every response (SEC-06).

Django's SecurityMiddleware already sends HSTS, nosniff, Referrer-Policy and
Cross-Origin-Opener-Policy. This adds what it does not cover.
"""

from django.conf import settings


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.headers.setdefault("Content-Security-Policy", settings.CONTENT_SECURITY_POLICY)
        response.headers.setdefault("Permissions-Policy", settings.PERMISSIONS_POLICY)
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        if request.path.startswith("/api/"):
            # API responses carry PHI: never store them in browser or proxy caches.
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response
