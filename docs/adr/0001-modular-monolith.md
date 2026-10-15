# 1. Modular monolith on Django

Date: 2026-10-15
Status: Accepted

## Context

The product spans clinical, scheduling, pharmacy, billing and ERP domains. A small team
must ship Release 1 quickly, keep data consistent across chart, invoice and ledger, and
ship the same artefact to SaaS (Railway) and Enterprise installs.

## Decision

One Django project with one app per domain module under `apps/`, deployed as one Docker
image run as three processes (web, worker, beat). Modules talk to each other only through
`services`, `events` and `selectors`; `apps.core` is the shared kernel. The rule is
enforced by `tests/test_module_boundaries.py`.

## Consequences

- One database transaction can span modules where the domain needs it (for example bed
  assignment on admission).
- Extraction into a service stays possible because boundaries are tested
  (criteria in CLAUDE.md Section 13).
