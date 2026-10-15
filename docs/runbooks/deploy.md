# Deploy (Railway)

## One-time setup (done by a human)

1. Create a Railway project with two environments: `staging` and `production`.
2. In each environment add PostgreSQL and Redis.
3. Add three services from this GitHub repository:
   - **web**: uses `railway.toml` at the repo root (start command, pre-deploy
     `migrate`, health check `/healthz`).
   - **worker**: set *Config file path* to `deploy/railway/worker.toml`.
   - **beat**: set *Config file path* to `deploy/railway/beat.toml`. Exactly one replica.
4. Set variables on each service (see `.env.example` for the full list):
   `DJANGO_SETTINGS_MODULE=config.settings.production`, `SECRET_KEY`, `ALLOWED_HOSTS`,
   `CSRF_TRUSTED_ORIGINS`, `DATABASE_URL` and `REDIS_URL` (reference the plugin
   variables), `S3_*`, `FIELD_ENCRYPTION_KEY`, `SENTRY_DSN`, provider keys.
   Never commit these values.
5. `ALLOWED_HOSTS` must include the public domain and `healthcheck.railway.app`
   (the host Railway uses for health checks).
6. The `staging` environment deploys automatically from the `staging` branch (the protected
   default branch); `production` is promoted manually.

## Before any real patient data

- Confirm the Railway region and terms against data-residency rules (DG-06).
- Enable and test PostgreSQL backups and an encrypted off-platform copy (SEC-08).

## Rollback

Redeploy the previous successful deployment from the Railway dashboard. Migrations are
not rolled back automatically; if the release contained a migration, follow the rollback
steps written in that release's checklist.
