# 17. Emailed one-time codes replace the authenticator app

Date: 2026-10-21
Status: Accepted (pending security review)

## Context

Sign-in used a password plus a TOTP code from an authenticator app (ADR 0003). Only roles in
`MFA_REQUIRED_ROLES` had to enrol, so some accounts, such as patients, signed in with a
password alone, and enrolment was a separate screen users had to get through first. The
product owner asked for one-time codes at sign-in for all users instead.

## Decision

Every account signs in with its password and then a 6-digit code emailed to the address on
the account. SMS is not used: the SMS provider is still an open decision (CLAUDE.md
Section 12).

- A sign-in request without a code emails one and answers `401 mfa_required`. The client
  sends the same credentials again with the code. A wrong or expired code answers
  `401 invalid_otp` and is audited. An account with no email answers `401 no_email`.
- Codes come from django-otp's `EmailDevice`: random, single use, valid for
  `OTP_EMAIL_TOKEN_VALIDITY` seconds (default 300), with django-otp's throttling of wrong
  guesses. A new code is not sent inside `OTP_EMAIL_COOLDOWN_DURATION` seconds (default 30),
  and the earlier one stays valid.
- The device is created on first sign-in, so there is no enrolment step. The TOTP enrolment
  endpoints and the `/mfa` screen are removed. Because the device is a django-otp device,
  verified sessions, `mfa_verified` bearer tokens, the WebSocket check and the Django admin
  gate keep working unchanged.
- The email goes through the queued notification path, like password links, so a slow mail
  server never fails the request. The delivery log keeps only a masked address and the
  purpose `login_code`, never the code.

## Consequences

- An email code is only as strong as the mailbox. Password reset also goes by email, so
  someone who controls a user's mailbox can reset the password and then read the code. This
  is weaker than an authenticator app; the owner accepted it for simplicity. Revisit when an
  SMS provider is chosen, or offer the authenticator app as an option for admins.
- Sign-in now depends on the Celery worker and the mail server being up.
- Existing TOTP devices are left in the database and ignored; the `otp_totp` plugin is no
  longer installed.
- The end-to-end suite reads codes from Mailpit instead of computing them, so `make e2e`
  needs the worker and Mailpit running (the compose file starts them).
