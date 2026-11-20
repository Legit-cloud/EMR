# Deploy (Railway)

## One-time setup (done by a human)

1. Create a Railway project with two environments: `staging` and `production`.
2. In each environment add PostgreSQL and Redis.
3. Add three services from this GitHub repository. For each, set *Root Directory* to `/backend`
   (everything the server needs is in that folder; the config file paths below are relative to it):
   - **web**: uses `backend/railway.toml` (start command, pre-deploy
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

## Web app on Vercel, API on Railway

The browser must call the API through the web app's own address, or the session and CSRF cookies
are not sent. The web app forwards `/api/*` to the API (`frontend/next.config.ts`):

1. On Vercel set `API_ORIGIN` to the API's public address, for example
   `https://emr-production-9dbcb9c0.up.railway.app` (no trailing slash), and redeploy.
2. On the Railway API, `CSRF_TRUSTED_ORIGINS` must include the Vercel address
   (`https://<your-app>.vercel.app` and any custom domain). `ALLOWED_HOSTS` keeps the Railway
   domain, because the forwarded request carries it as its host.
3. Leave `NEXT_PUBLIC_API_URL` unset.
4. Vercel cannot forward WebSockets, so the live queue (`/ws`) does not work through it.

## Services the API needs besides web

- **worker** (`celery -A config worker -l info --concurrency 4`): sends every email, including the
  sign-up and sign-in codes. Without it no code is delivered.
- **beat** (`celery -A config beat -l info --schedule /tmp/celerybeat-schedule`), exactly one
  replica: ward charges, licence watcher, reminders.
- Both use the web service's variables. Also set `EMAIL_URL` (mail provider) and
  `DEFAULT_FROM_EMAIL`; the defaults only print to the log.
