# syntax=docker/dockerfile:1

# ---- base: Python and uv ----------------------------------------------------
FROM python:3.12-slim-bookworm AS base
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
RUN groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid app --create-home app
WORKDIR /app

# ---- runtime dependencies ---------------------------------------------------
FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ---- dev: used by docker compose and for `make check` -----------------------
FROM deps AS dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends make \
    && rm -rf /var/lib/apt/lists/*
RUN uv sync --frozen --no-install-project
ENV RUN="" \
    RUFF_CACHE_DIR=/tmp/ruff-cache \
    DJANGO_SETTINGS_MODULE=config.settings.local
COPY --chown=app:app . .
USER app
EXPOSE 8000
CMD ["uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ---- production: final stage, built by Railway ------------------------------
FROM base AS production
COPY --from=deps /opt/venv /opt/venv
COPY --chown=app:app . .
# Dummy values exist only for this build step; they are not stored in the image.
RUN SECRET_KEY=collectstatic-only \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379/0 \
    DJANGO_SETTINGS_MODULE=config.settings.production \
    python manage.py collectstatic --noinput
ENV DJANGO_SETTINGS_MODULE=config.settings.production
USER app
EXPOSE 8000
CMD ["sh", "-c", "gunicorn config.asgi:application -k uvicorn_worker.UvicornWorker --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3}"]
