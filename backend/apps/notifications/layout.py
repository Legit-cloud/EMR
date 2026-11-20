"""The shared look of every email: a branded, table-based HTML layout that renders in Gmail,
Outlook and phone mail apps, and a plain-text twin built from the same pieces.

Colours repeat the web app's design tokens (docs/DESIGN.md); email clients cannot read CSS
variables, so the values are written out here.
"""

from dataclasses import dataclass
from html import escape

from django.conf import settings

BLUE = "#3f5de7"
BLUE_TINT = "#e8f0fb"
INK = "#243444"
BODY = "#41505f"
MUTED = "#627184"
LINE = "#e6eaf1"
CANVAS = "#f4f6fa"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


@dataclass(frozen=True)
class Email:
    subject: str
    text: str
    html: str


def brand() -> str:
    return getattr(settings, "EMAIL_BRAND_NAME", "EMR")


def _p(text: str) -> str:
    return (
        f'<p style="margin:0 0 16px;font:400 15px/1.65 {FONT};color:{BODY};">'
        f"{escape(text).replace(chr(10), '<br>')}</p>"
    )


def _code(code: str) -> str:
    return (
        f'<table role="presentation" align="center" cellpadding="0" cellspacing="0" '
        f'style="margin:8px auto 20px;"><tr><td style="background:{BLUE_TINT};'
        f"border-radius:12px;padding:16px 28px;font:700 32px/1 'SFMono-Regular',Menlo,Consolas,"
        f'monospace;letter-spacing:10px;color:{INK};text-align:center;">{escape(code)}</td></tr>'
        "</table>"
    )


def _details(rows: list[tuple[str, str]]) -> str:
    cells = "".join(
        f'<tr><td style="padding:10px 0;border-top:1px solid {LINE};font:400 13px/1.4 {FONT};'
        f'color:{MUTED};width:38%;vertical-align:top;">{escape(label)}</td>'
        f'<td style="padding:10px 0;border-top:1px solid {LINE};font:600 14px/1.5 {FONT};'
        f'color:{INK};vertical-align:top;">{escape(value)}</td></tr>'
        for label, value in rows
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:4px 0 20px;border-bottom:1px solid {LINE};">{cells}</table>'
    )


def _button(label: str, url: str) -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">'
        f'<tr><td style="background:{BLUE};border-radius:10px;">'
        f'<a href="{escape(url, quote=True)}" style="display:inline-block;padding:13px 26px;'
        f"font:600 15px/1 {FONT};color:#ffffff;text-decoration:none;border-radius:10px;"
        f'">{escape(label)}</a></td></tr></table>'
    )


def build(
    *,
    subject: str,
    heading: str,
    paragraphs: list[str],
    preheader: str = "",
    code: str = "",
    details: list[tuple[str, str]] | None = None,
    button: tuple[str, str] | None = None,
    after: list[str] | None = None,
    footer: str = "",
) -> Email:
    """Assemble one email. ``paragraphs`` come before the code, details and button; ``after``
    comes after them (the small print). Every value is escaped for the HTML version."""
    name = brand()
    # -- plain text ---------------------------------------------------------------------
    lines = [heading, "", *[line for p in paragraphs for line in (p, "")]]
    if code:
        lines += [f"    {code}", ""]
    if details:
        lines += [f"{label}: {value}" for label, value in details] + [""]
    if button:
        lines += [f"{button[0]}: {button[1]}", ""]
    for p in after or []:
        lines += [p, ""]
    lines += ["--", footer or f"Sent by {name}."]
    text = "\n".join(lines).strip() + "\n"
    # -- HTML ----------------------------------------------------------------------------
    body = "".join(_p(p) for p in paragraphs)
    if code:
        body += _code(code)
    if details:
        body += _details(details)
    if button:
        body += _button(*button)
        body += (
            f'<p style="margin:0 0 16px;font:400 12px/1.6 {FONT};color:{MUTED};">'
            f"If the button does not work, copy this address into your browser:<br>"
            f'<span style="word-break:break-all;color:{BLUE};">{escape(button[1])}</span></p>'
        )
    body += "".join(
        f'<p style="margin:0 0 12px;font:400 13px/1.6 {FONT};color:{MUTED};">{escape(p)}</p>'
        for p in after or []
    )
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(subject)}</title></head>"
        f'<body style="margin:0;padding:0;background:{CANVAS};">'
        '<span style="display:none;max-height:0;overflow:hidden;opacity:0;">'
        f"{escape(preheader)}</span>"
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{CANVAS};"><tr><td align="center" style="padding:32px 16px;">'
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" '
        'style="width:100%;max-width:560px;">'
        '<tr><td style="padding:0 4px 20px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        f'<td style="background:{BLUE};border-radius:8px;width:30px;height:30px;text-align:center;'
        f'font:700 22px/30px {FONT};color:#ffffff;">+</td>'
        f'<td style="padding-left:10px;font:700 20px/1 {FONT};color:{INK};">{escape(name)}</td>'
        "</tr></table></td></tr>"
        f'<tr><td style="background:#ffffff;border:1px solid {LINE};border-radius:16px;'
        'padding:36px 32px;">'
        f'<h1 style="margin:0 0 18px;font:700 22px/1.3 {FONT};color:{INK};">{escape(heading)}</h1>'
        f"{body}</td></tr>"
        f'<tr><td style="padding:20px 8px 0;font:400 12px/1.6 {FONT};color:{MUTED};'
        'text-align:center;">'
        f"{escape(footer or f'Sent by {name}.')}</td></tr>"
        "</table></td></tr></table></body></html>"
    )
    return Email(subject=subject, text=text, html=html)
