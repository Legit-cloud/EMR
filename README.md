# EMR + HMS Platform

Electronic medical record and hospital management platform: one Django modular monolith
(clinical record, scheduling, pharmacy, billing and more) with PostgreSQL, Redis, Celery
and Channels. See `CLAUDE.md` for the full context, rules and build plan.

## Run locally

Requires Docker. Optional: [uv](https://docs.astral.sh/uv/) and `make` to run tools on the host.

```sh
cp .env.example .env               # optional local overrides
docker compose up --build          # app on :8080 (edge), API on :8000, Mailpit UI on :8026
curl http://localhost:8080/healthz
```

Open http://localhost:8080 for the web app. For synthetic demo data (development only):
`docker compose exec web python manage.py seed_demo_data --password <pw>`.

## Frontend

Next.js app in `frontend/`. Node runs in containers, so nothing needs installing.

```sh
make openapi         # after any API change: export the schema and regenerate the typed client
make frontend-tools  # frontend lint and unit tests in a container
make e2e             # browser tests (Playwright) against the compose stack, with fresh seed data
```

## Checks

Backend: `ruff` (lint and format) then `pytest`. Frontend: ESLint plus a Prettier check, then Vitest.
Playwright runs on demand (`make e2e`).

```sh
make check                                              # host with uv, pnpm and make
docker compose run --rm web make lint test              # backend, anywhere with Docker
docker compose --profile tools run --rm frontend-tools  # frontend, anywhere with Docker
```

Activate the pre-push hook once per clone (`make install` does this too):

```sh
git config core.hooksPath .githooks
```

There is no CI service. The hook runs the checks before every push.

## Deploy

Railway builds the `Dockerfile` (web, worker and beat run the same image).
See `docs/runbooks/deploy.md`.
