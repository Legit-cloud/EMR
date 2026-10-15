# EMR + HMS Platform

Electronic medical record and hospital management platform: one Django modular monolith
(clinical record, scheduling, pharmacy, billing and more) with PostgreSQL, Redis, Celery
and Channels. See `CLAUDE.md` for the full context, rules and build plan.

## Run locally

Requires Docker. Optional: [uv](https://docs.astral.sh/uv/) and `make` to run tools on the host.

```sh
cp .env.example .env               # optional local overrides
docker compose up --build          # web on :8000, Mailpit UI on :8026
curl http://localhost:8000/healthz
```

## Checks

Exactly two checks: `ruff` (lint and format) and `pytest`.

```sh
make check                                  # host with uv and make
docker compose run --rm web make check      # anywhere with Docker
```

Activate the pre-push hook once per clone (`make install` does this too):

```sh
git config core.hooksPath .githooks
```

There is no CI service. The hook runs `make check` before every push.

## Deploy

Railway builds the `Dockerfile` (web, worker and beat run the same image).
See `docs/runbooks/deploy.md`.
