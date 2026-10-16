# Commands run through `uv run` on a host with uv installed.
# Inside the dev container RUN is empty because the virtualenv is already on PATH.
RUN ?= uv run
COMPOSE ?= docker compose

.PHONY: install run worker beat lint format test check seed shell up down

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

check: lint test

seed:
	$(RUN) python manage.py seed_demo_data

shell:
	$(RUN) python manage.py shell

up:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

# Frontend (Node runs in containers; nothing to install on the host).
NODE_IMAGE ?= node:22-bookworm-slim

.PHONY: openapi e2e
openapi:
	$(COMPOSE) run --rm web python manage.py spectacular --validate --fail-on-warn --file frontend/openapi.yaml
	docker run --rm -v "$(CURDIR)/frontend:/app" -w /app $(NODE_IMAGE) npm run gen:api

e2e:
	$(COMPOSE) --profile e2e up -d --build web worker frontend edge
	$(COMPOSE) exec -T web python manage.py seed_e2e
	$(COMPOSE) --profile e2e run --rm playwright
