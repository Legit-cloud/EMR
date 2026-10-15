## What and why

<!-- One or two sentences. Link the requirement IDs (FR, SEC, DG, AC) this implements. -->

## Requirement IDs covered

- 

## Checklist

- [ ] `make check` passes locally (ruff and pytest)
- [ ] Every requirement ID above is referenced by a test name or docstring
- [ ] Tenant scoping, permission class and audit logging on every new endpoint
- [ ] Module boundaries respected (only `services`, `events`, `selectors` across modules)
- [ ] Money uses the Money type (no floats)
- [ ] No PHI or secrets in code, fixtures, logs or screenshots
- [ ] Migrations are reversible, or the reason they are not is stated
- [ ] New dependencies are justified below

## New dependencies

<!-- Name and reason, or "None". -->

## Not verified

<!-- Anything that could not be checked locally. -->
