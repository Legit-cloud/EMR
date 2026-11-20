# 27. Self-service sign-up and onboarding

Date: 2026-11-20
Status: Accepted (pending legal review of the terms and privacy notice)

## Context

Until now organisations were created by hand. The management of a hospital or clinic should be
able to open an account, prove their email, answer a few questions and land on their dashboard.

## Decision

**Flow.** `/signup` (organisation, name, work email, password, accept terms) emails a 6-digit
code; `/signup/verify` takes it; `/onboarding` asks four short steps; finishing opens
`/dashboard`.

**Nothing exists until the email is proved.** `POST /api/onboarding/signup/` stores a pending
`Signup` (password and code only as hashes) and emails the code. Verifying creates the tenant,
a first facility named after the organisation, the first administrator (role Tenant admin,
username is the email address) and an onboarding profile, in one transaction, then signs the
person in. The session counts as code-verified, like any sign-in.

**Safety rules.** Codes expire (15 minutes), allow five wrong guesses, work once, and can be
resent once a minute. The sign-up answer is the same whether or not the address already has an
account; an existing owner gets an email instead, so the form cannot be used to list customers.
All three endpoints are anonymous, throttled with the sign-in limit and CSRF-checked. Acceptance
of the terms is required and its time is kept in the audit log (DG-02).
`SELF_SIGNUP_ENABLED=false` closes sign-up for invitation-only deployments, for example
Enterprise installs.

**Onboarding questions.** Facility name and type, city and phone (stored as E.164), staff and bed
size bands, departments, modules wanted, and how they heard of us. Each step is saved as the
person goes. Finishing renames the first facility and creates the chosen departments, and can be
repeated safely. Only the tenant admin can read or answer them. Organisations set up by hand
have no profile (404) and are never sent to the questions.

**Web app.** The staff layout sends an administrator with unanswered questions to `/onboarding`
before anything else, so closing the tab midway resumes there on the next sign-in.

## Consequences

- The terms of use and privacy notice are not written yet; the checkbox only records acceptance.
  Counsel must supply the text and its version before launch (DG-02, DG-07).
- Anyone with an email address can create an empty organisation. There is no payment, plan or
  abuse screening yet; rate limits are the only brake. A plan choice belongs with pricing
  (open decision 8).
- The bed and staff bands, modules and how-heard answers are recorded but do not yet switch
  anything on or off.
- Email delivery depends on the mail provider, which is still an open decision.
- No browser (Playwright) test of the whole flow has been run against the full stack.
