"""The words of every email the system sends. One function per email, each returning
``Email(subject, text, html)``.

Rules for the copy: say what happened and what to do in the first two sentences; never put a
diagnosis, a result value or any clinical detail in an email (they stay in the system); every
email that needs an action has one button and the plain link under it; warn the reader when a
code or link they did not ask for arrives.
"""

from django.conf import settings

from .layout import Email, brand, build


def link(path: str) -> str:
    """An address in the web app. Always built from FRONTEND_URL, never from the API's host."""
    return f"{settings.FRONTEND_URL.rstrip('/')}/{path.lstrip('/')}"


def _hi(name: str) -> str:
    return f"Hi {name.strip()}," if name and name.strip() else "Hello,"


def _hours(seconds: int | None = None) -> int:
    return max(1, (seconds or settings.PASSWORD_RESET_TIMEOUT) // 3600)


# -- signing up and signing in ---------------------------------------------------------------


def signup_code(first_name: str, code: str, minutes: int, organisation: str) -> Email:
    subject = "Confirm your email to open your account"
    return build(
        subject=subject,
        heading="Confirm your email address",
        preheader=f"Your verification code is {code}.",
        paragraphs=[
            _hi(first_name),
            f"Thanks for setting up {organisation} on {brand()}. Enter this code on the "
            "sign-up page to confirm your email address.",
        ],
        code=code,
        after=[
            f"The code works for {minutes} minutes and can be used once.",
            "Did not ask to open an account? You can ignore this email. Nothing will be created.",
        ],
    )


def already_registered(first_name: str) -> Email:
    subject = "You already have an account"
    return build(
        subject=subject,
        heading="You already have an account",
        preheader="Sign in, or reset your password if you have forgotten it.",
        paragraphs=[
            _hi(first_name),
            "Someone, hopefully you, tried to open a new account with this email address. "
            f"It already has one on {brand()}, so we did not create another.",
            "Sign in with this email address and your password. If you have forgotten the "
            "password, you can set a new one.",
        ],
        button=("Sign in", link("/login")),
        after=[
            f"Forgot your password? Reset it here: {link('/forgot-password')}",
            "Not you? You can ignore this email. Your account has not changed.",
        ],
    )


def sign_in_code(first_name: str, code: str, minutes: int) -> Email:
    subject = "Your sign-in code"
    return build(
        subject=subject,
        heading="Your sign-in code",
        preheader=f"Use {code} to finish signing in.",
        paragraphs=[_hi(first_name), "Enter this code to finish signing in."],
        code=code,
        after=[
            f"The code works for {minutes} minutes and can be used once.",
            "Did not try to sign in? Someone may know your password. Change it now at "
            f"{link('/forgot-password')} and tell your administrator.",
        ],
    )


# -- invitations and passwords ---------------------------------------------------------------


def staff_invitation(
    first_name: str, organisation: str, role: str, url: str, valid_hours: int
) -> Email:
    subject = f"You have been invited to {organisation} on {brand()}"
    return build(
        subject=subject,
        heading=f"Join {organisation} on {brand()}",
        preheader=f"You have been added as {role}. Set a password to get started.",
        paragraphs=[
            _hi(first_name),
            f"{organisation} has added you to {brand()}"
            + (f" as {role}." if role else ".")
            + " Set a password to get started.",
        ],
        details=[("Organisation", organisation), *([("Your role", role)] if role else [])],
        button=("Set your password", url),
        after=[
            f"This link works for {valid_hours} hours. After that, use 'Forgot your password?' "
            "on the sign-in page to get a new one.",
            "Once your password is set, sign in with this email address. Each time you sign in "
            "we will also email you a short code, so keep this mailbox safe.",
            "Were you not expecting this? You can ignore this email.",
        ],
    )


def patient_invitation(first_name: str, organisation: str, url: str, valid_hours: int) -> Email:
    subject = f"Your {organisation} patient portal account"
    return build(
        subject=subject,
        heading="Your patient portal is ready",
        preheader="Set a password to see your appointments, bills and medicines online.",
        paragraphs=[
            _hi(first_name),
            f"{organisation} has opened a patient portal account for you. There you can book "
            "appointments, see your bills and pay them, and read your results and medicines.",
        ],
        button=("Set your password", url),
        after=[
            f"This link works for {valid_hours} hours. After that, use 'Forgot your password?' "
            "on the sign-in page to get a new one.",
            "Were you not expecting this? You can ignore this email.",
        ],
        footer=f"Sent by {organisation} through {brand()}.",
    )


def password_reset(first_name: str, url: str, valid_hours: int) -> Email:
    subject = "Reset your password"
    return build(
        subject=subject,
        heading="Reset your password",
        preheader="Use this link to choose a new password.",
        paragraphs=[
            _hi(first_name),
            "We received a request to reset the password for your account. Choose a new one "
            "with the button below.",
        ],
        button=("Choose a new password", url),
        after=[
            f"This link works for {valid_hours} hours and can be used once.",
            "Did not ask for this? You can ignore this email. Your password has not changed.",
        ],
    )


# -- appointments ----------------------------------------------------------------------------


def appointment_confirmed(
    first_name: str, doctor: str, when: str, facility: str, reference: str, moved: bool
) -> Email:
    subject = f"Appointment {'moved' if moved else 'confirmed'}: {when}"
    return build(
        subject=subject,
        heading="Your appointment has been moved" if moved else "Your appointment is confirmed",
        preheader=f"{when} with {doctor}.",
        paragraphs=[
            _hi(first_name),
            "Your appointment time has changed. The new details are below."
            if moved
            else "We have booked your appointment. The details are below.",
        ],
        details=[
            ("When", when),
            ("With", doctor),
            ("Where", facility),
            ("Reference", reference),
        ],
        after=[
            "A calendar invitation is attached so you can add it to your calendar.",
            "Please arrive a few minutes early. If you cannot come, contact the clinic as early "
            "as you can so the time can go to someone else.",
        ],
    )


def appointment_reminder(first_name: str, doctor: str, when: str) -> Email:
    subject = f"Reminder: appointment on {when}"
    return build(
        subject=subject,
        heading="A reminder about your appointment",
        preheader=f"{when} with {doctor}.",
        paragraphs=[
            _hi(first_name),
            f"This is a reminder that you have an appointment with {doctor} on {when}.",
        ],
        after=[
            "If you cannot come, please contact the clinic as early as you can.",
            "You can stop these reminders from your profile in the patient portal.",
        ],
    )


# -- the staff inbox, leave and licences -----------------------------------------------------


def new_message() -> Email:
    subject = "You have a new message"
    return build(
        subject=subject,
        heading="You have a new message",
        preheader="Someone on your team wrote to you.",
        paragraphs=[
            "A colleague sent you a message in the staff inbox. Sign in to read and reply.",
        ],
        button=("Open your messages", link("/messages")),
        after=["For privacy, the message itself is never sent by email."],
    )


def leave_decision(
    first_name: str, leave_type: str, start: str, end: str, approved: bool, note: str
) -> Email:
    word = "approved" if approved else "declined"
    subject = f"Your leave request was {word}"
    return build(
        subject=subject,
        heading=f"Your leave was {word}",
        preheader=f"{leave_type}, {start} to {end}.",
        paragraphs=[
            _hi(first_name),
            "Your leave request has been approved."
            if approved
            else "Your leave request was not approved this time.",
        ],
        details=[
            ("Leave", leave_type),
            ("From", start),
            ("To", end),
            *([("Note from HR", note)] if note else []),
        ],
        button=("View your leave", link("/leave")),
    )


def licence_alert(name: str, body_label: str, expired: bool, expiry: str) -> Email:
    state = "has expired" if expired else "expires soon"
    subject = f"Licence {state}: {name}"
    return build(
        subject=subject,
        heading=f"A licence {state}",
        preheader=f"{name}: {body_label} licence, expiry {expiry}.",
        paragraphs=[
            f"The {body_label} licence of {name} {state}. Please follow up on its renewal "
            "so they can keep working without a break.",
        ],
        details=[("Staff member", name), ("Licence", body_label), ("Expiry", expiry)],
        button=("Open the staff list", link("/staff")),
    )


# -- money ------------------------------------------------------------------------------------


def payment_reminder(first_name: str, amount: str, reference: str, can_pay_online: bool) -> Email:
    subject = f"A reminder about your bill {reference}"
    paragraphs = [
        _hi(first_name),
        f"This is a friendly reminder that {amount} is still to be paid on your bill {reference}.",
        "You can pay at the cashier or by bank transfer, quoting the bill number.",
    ]
    return build(
        subject=subject,
        heading="A reminder about your bill",
        preheader=f"{amount} is still to be paid on bill {reference}.",
        paragraphs=paragraphs,
        details=[("Bill", reference), ("Still to pay", amount)],
        button=("Pay online", link("/portal/invoices")) if can_pay_online else None,
        after=[
            "Already paid, or think this is a mistake? Please speak to our billing office. "
            "Thank you.",
        ],
    )


def payment_flagged(reference: str, bill: str, reason: str) -> Email:
    subject = "An online payment needs review"
    return build(
        subject=subject,
        heading="An online payment needs your review",
        preheader=f"Payment {reference} could not be applied.",
        paragraphs=[
            "The payment service took a payment that could not be applied to a bill. "
            "Please check it and refund it or apply it by hand.",
        ],
        details=[("Payment", reference), ("Bill", bill), ("Why", reason)],
        button=("Open invoices", link("/billing")),
    )


# -- pharmacy and diagnostics ----------------------------------------------------------------


def purchase_order(
    vendor: str, organisation: str, reference: str, lines: list[tuple[str, int]], note: str
) -> Email:
    subject = f"Purchase order {reference}"
    return build(
        subject=subject,
        heading=f"Purchase order {reference}",
        preheader=f"{organisation} would like to order {len(lines)} item(s).",
        paragraphs=[
            f"Dear {vendor},",
            f"Please supply the items below to {organisation or 'us'} under this purchase order.",
        ],
        details=[(name, f"{qty} units") for name, qty in lines]
        + ([("Note", note)] if note else []),
        after=[
            "Please reply to confirm that you can supply this and when it will arrive.",
            f"Quote {reference} on your delivery note and your invoice, and deliver only what "
            "is listed. Deliveries that do not match this order may be refused.",
            "Thank you.",
        ],
        footer=f"Sent on behalf of {organisation or brand()}.",
    )


def critical_result(label: str) -> Email:
    subject = "A critical result needs your attention"
    return build(
        subject=subject,
        heading="A critical result needs your attention",
        preheader="Open it in the system and act on it now.",
        paragraphs=[
            f"The result of {label} is marked critical. Please open it in the system and act "
            "on it now.",
        ],
        button=("Open tests and scans", link("/diagnostics")),
        after=["For privacy, the result itself is never sent by email."],
    )


def result_corrected(label: str) -> Email:
    subject = "A result has been corrected"
    return build(
        subject=subject,
        heading="A result has been corrected",
        preheader="Please review the new version.",
        paragraphs=[f"The result of {label} was corrected. Please review the new version."],
        button=("Open tests and scans", link("/diagnostics")),
        after=["For privacy, the result itself is never sent by email."],
    )


# -- patient data requests --------------------------------------------------------------------


def data_request_received(first_name: str, kind: str, due: str) -> Email:
    subject = "We have received your request"
    return build(
        subject=subject,
        heading="We have received your request",
        preheader=f"We will answer by {due}.",
        paragraphs=[
            _hi(first_name),
            f"Thank you. We have received your request ({kind}) and will answer by {due}.",
        ],
        button=("Follow your request", link("/portal/profile")),
        after=["You can follow it under Your rights in the patient portal."],
    )


def data_request_answered(first_name: str, kind: str) -> Email:
    subject = "Your request has been answered"
    return build(
        subject=subject,
        heading="Your request has been answered",
        preheader="Sign in to the patient portal to read the answer.",
        paragraphs=[
            _hi(first_name),
            f"Your request ({kind}) has been answered. Sign in to the patient portal and open "
            "Your rights to read the answer.",
        ],
        button=("Open the patient portal", link("/portal/profile")),
        after=["For your privacy, the answer itself is not sent by email."],
    )


def data_request_staff(kind: str, due: str) -> Email:
    subject = "A patient has made a data-protection request"
    return build(
        subject=subject,
        heading="A patient made a data-protection request",
        preheader=f"A {kind} request is due by {due}.",
        paragraphs=[
            f"A {kind} request was made and is due by {due}. The law sets this deadline, so "
            "please answer it in time.",
        ],
        button=("Open data requests", link("/requests")),
    )
