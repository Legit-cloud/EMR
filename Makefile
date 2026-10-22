# Commands run through `uv run` on a host with uv installed.
# Inside the dev container RUN is empty because the virtualenv is already on PATH.
RUN ?= uv run
PNPM ?= pnpm
COMPOSE ?= docker compose

.PHONY: install run worker beat lint format test frontend-check check seed shell up down

install:
	uv sync
	git config core.hooksPath .githooks

run:
	$(RUN) uvicorn config.asgi:application --reload --host 0.0.0.0 --port 8000

worker:
	$(RUN) celery -A config worker -l info

beat:
	$(RUN) celery -A config beat -l info

lint:
	$(RUN) ruff check .
	$(RUN) ruff format --check .

format:
	$(RUN) ruff check --fix .
	$(RUN) ruff format .

test:
	$(RUN) pytest

# Backend: ruff, then pytest. Frontend: ESLint and Prettier, then Vitest.
frontend-check:
	$(PNPM) --dir frontend check

check: lint test frontend-check

seed:
	$(RUN) python manage.py seed_demo_data

shell:
	$(RUN) python manage.py shell

up:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

# Frontend (Node runs in containers; nothing to install on the host).
.PHONY: openapi e2e frontend-tools
openapi:
	$(COMPOSE) run --rm web python manage.py spectacular --validate --fail-on-warn --file frontend/openapi.yaml
	$(COMPOSE) --profile tools run --rm frontend-tools pnpm api:gen

# The frontend checks in a container, for hosts without Node.
frontend-tools:
	$(COMPOSE) --profile tools run --rm frontend-tools

e2e:
	AUTH_THROTTLE_RATE=300/min $(COMPOSE) --profile e2e up -d --build web worker frontend edge
	$(COMPOSE) exec -T web python manage.py seed_e2e
	$(COMPOSE) --profile e2e run --rm playwright
