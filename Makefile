# Root commands. Backend commands live in backend/Makefile; these forward to it.
PNPM ?= pnpm
COMPOSE ?= docker compose

.PHONY: install run worker beat lint format test frontend-check check seed shell up down

install:
	$(MAKE) -C backend install
	git config core.hooksPath .githooks

run worker beat format seed shell:
	$(MAKE) -C backend $@

lint:
	$(MAKE) -C backend lint

test:
	$(MAKE) -C backend test

# Backend: ruff, then pytest. Frontend: ESLint and Prettier, then Vitest.
frontend-check:
	$(PNPM) --dir frontend check

check: lint test frontend-check

up:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

# Frontend (Node runs in containers; nothing to install on the host).
.PHONY: openapi e2e frontend-tools
openapi:
	$(COMPOSE) run --rm web python manage.py spectacular --validate --fail-on-warn --file /frontend/openapi.yaml
	$(COMPOSE) --profile tools run --rm frontend-tools pnpm api:gen

# The frontend checks in a container, for hosts without Node.
frontend-tools:
	$(COMPOSE) --profile tools run --rm frontend-tools

e2e:
	AUTH_THROTTLE_RATE=300/min $(COMPOSE) --profile e2e up -d --build web worker frontend edge
	$(COMPOSE) exec -T web python manage.py seed_e2e
	$(COMPOSE) --profile e2e run --rm playwright
