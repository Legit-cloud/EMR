"""Keep PHI out of logs and error reports.

Log lines and Sentry events can carry what a user typed: search terms in query strings,
emails, phone numbers, request bodies. These helpers remove them. Identifiers (UUIDs)
stay, because they are needed to investigate and are not PHI on their own.
"""

import logging
import re

REDACTED = "[redacted]"
# Query strings carry search terms such as patient names (?q=okonkwo). Removed first and
# whole, so nothing after an id inside the query string survives.
_QUERY_STRING = re.compile(r"\?[^\s\"']*")
_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email]"),
    # Phone numbers (E.164 or local), but not UUID fragments or long ids.
    (re.compile(r"(?<![\w-])\+?\d[\d ()-]{8,}\d(?![\w-])"), "[number]"),
]

# Headers that may be kept in error reports; everything else is dropped.
SAFE_HEADERS = {"user-agent", "content-type", "content-length", "accept", "host"}


_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _redact_segment(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def redact(text: str) -> str:
    """Redact PHI patterns, leaving UUIDs intact (they may look like digit runs)."""
    text = _QUERY_STRING.sub("?" + REDACTED, text)
    parts, last = [], 0
    for match in _UUID.finditer(text):
        parts.append(_redact_segment(text[last : match.start()]))
        parts.append(match.group())
        last = match.end()
    parts.append(_redact_segment(text[last:]))
    return "".join(parts)


class PhiRedactingFilter(logging.Filter):
    """Logging filter: formats the message, then redacts it. Attach to every handler."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # a broken format string must not lose the log line
            message = str(record.msg)
        record.msg = redact(message)
        record.args = ()
        return True


def scrub_sentry_event(event: dict, hint: dict | None = None) -> dict:
    """``before_send`` for Sentry: drop bodies, cookies, query strings and most headers."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        request.pop("query_string", None)
        request.pop("env", None)
        if "url" in request:
            request["url"] = redact(str(request["url"]))
        headers = request.get("headers") or {}
        request["headers"] = {k: v for k, v in headers.items() if k.lower() in SAFE_HEADERS}
    user = event.get("user")
    if isinstance(user, dict):
        event["user"] = {"id": user["id"]} if "id" in user else {}
    if isinstance(event.get("message"), str):
        event["message"] = redact(event["message"])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            if isinstance(logentry.get(key), str):
                logentry[key] = redact(logentry[key])
        logentry.pop("params", None)
    for exception in (event.get("exception") or {}).get("values", []):
        if isinstance(exception.get("value"), str):
            exception["value"] = redact(exception["value"])
        for frame in (exception.get("stacktrace") or {}).get("frames", []):
            frame.pop("vars", None)  # local variables can hold any patient data
    for crumb in (event.get("breadcrumbs") or {}).get("values", []):
        if isinstance(crumb.get("message"), str):
            crumb["message"] = redact(crumb["message"])
        crumb.pop("data", None)
    return event
