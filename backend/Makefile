# Backend commands. Run from this folder, or through the root Makefile.
# Inside the dev container RUN is empty because the virtualenv is already on PATH.
RUN ?= uv run

.PHONY: install run worker beat lint format test seed shell

install:
	uv sync

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

seed:
	$(RUN) python manage.py seed_demo_data

shell:
	$(RUN) python manage.py shell
