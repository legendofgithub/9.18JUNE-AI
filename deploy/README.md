# June AI production deployment

## 1. Supabase/Postgres preparation

June AI supports two persistence modes:

- Desktop/local development: SQLite at `JUNE_DB_PATH`.
- Server production: PostgreSQL/Supabase at `JUNE_DATABASE_URL`.

Create a Supabase project in Singapore and copy its Session Pooler connection string. Convert the scheme to `postgresql+psycopg` and keep `sslmode=require`, for example:

```text
postgresql+psycopg://postgres:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Initialize and upgrade the schema explicitly. Application startup never runs `create_all` against an external database:

```powershell
cd backend
$env:JUNE_DATABASE_URL = "<your-session-pooler-url>"
..\.venv\Scripts\python.exe -m alembic upgrade head
```

The migration enables Row Level Security on every application table and intentionally creates no public policy. The backend's server-side repository layer remains the authorization boundary.

To copy an existing SQLite dataset while preserving IDs, timestamps, orders, entitlements, and Harness state:

```powershell
$env:JUNE_DATABASE_URL = "<your-session-pooler-url>"
..\.venv\Scripts\python.exe scripts\migrate_sqlite_to_postgres.py --dry-run
..\.venv\Scripts\python.exe scripts\migrate_sqlite_to_postgres.py --confirm MIGRATE_JUNE_DATA
```

The migration creates a source backup first and refuses to write into non-empty application tables.

## 2. Build and configure

1. Build the frontend first: `cd frontend && npm ci && npm run build`.
2. Put production secrets in the process environment or `backend/.env`; never commit them.
3. Required production variables:
   - `JUNE_API_TOKEN` (at least 16 random characters)
   - `JUNE_AUTH_SECRET` (at least 32 random characters)
   - `JUNE_BYOK_KEY` (at least 32 random characters)
   - `JUNE_METRICS_TOKEN` (at least 16 random characters)
   - `JUNE_DATABASE_URL` (Supabase Session Pooler URL)
   - `JUNE_WORKSPACE_ROOT=/data/workspaces`
   - `JUNE_ADMIN_PASSWORD`
   - `JUNE_PUBLIC_BASE_URL=https://your-domain`
   - `JUNE_PAYMENT_PROVIDER=stripe`
   - `JUNE_STRIPE_SECRET_KEY`
   - `JUNE_STRIPE_WEBHOOK_SECRET`
4. Create a Stripe webhook for `checkout.session.completed` and point it to `https://your-domain/api/payments/stripe/webhook`.

## 3. TLS certificate

For a rehearsal, create a local certificate:

```powershell
New-Item -ItemType Directory -Force deploy\certs | Out-Null
openssl req -x509 -newkey rsa:2048 -sha256 -days 30 -nodes `
  -keyout deploy/certs/june-local.key `
  -out deploy/certs/june-local.crt `
  -subj "/CN=localhost" `
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

For production, replace the two files mounted by `docker-compose.production.yml` with a certificate for the real domain. The Nginx entry only exposes ports 80/443; HTTP redirects to HTTPS.

## 4. Start and verify

Run migrations as an explicit service before starting the API:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile migration run --rm june-migrate
```

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
curl.exe -k https://localhost/health
curl.exe -k https://localhost/metrics
```

For `/metrics`, pass the configured token: `Authorization: Bearer <JUNE_METRICS_TOKEN>`.

SSE verification must go through Nginx, not only the backend port. Open the browser at `https://localhost/#/studio`, start a normal chat, and confirm in DevTools that `/api/mvp-runs/.../chat` is `text/event-stream`, receives incremental `data:` frames, and is not buffered until completion.

The API writes JSON request logs to `/data/logs/app.jsonl`; Nginx writes structured access logs to stdout, collected by Docker's `json-file` driver. The backup sidecar writes SQLite backups to the `june-backups` volume and retains the latest `JUNE_BACKUP_RETENTION` copies.

## 4.1 Optional monitoring (Prometheus + Alertmanager)

The repository includes an optional monitoring stack under `deploy/monitoring/`. To enable it:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml `
  -f deploy/monitoring/docker-compose.monitoring.yml --profile monitoring up -d
```

- Prometheus scrapes `june-api:8000/metrics`.
- Alert rules are defined in `deploy/monitoring/alerts.yml`.
- Alertmanager is configured with a `default` receiver that only logs to stdout. Add your own webhook/email/Slack receiver before relying on it.

## 4.2 Offsite backup

When `JUNE_DATABASE_URL` is configured, the backup sidecar creates custom-format `pg_dump` archives and validates each one with `pg_restore --list`. SQLite continues to use an online consistent backup.

The backup sidecar supports copying each local backup to an offsite directory or mounted network path.

Set `JUNE_OFFSITE_BACKUP_DIR` on the `june-backup` service (for example a mounted S3/FTP/network drive path) and the backup script will copy new backups there and apply the same retention policy. Example environment for the backup service:

```yaml
JUNE_OFFSITE_BACKUP_DIR=/backups-offsite
JUNE_BACKUP_RETENTION=14
```

You can also run it outside Docker:

```powershell
cd backend
..\.venv\Scripts\python.exe scripts/backup.py --offsite-dir D:\backups\june-offsite --retention 14
```

## 4.3 Dependency security scan

Run the built-in scanner before release:

```powershell
cd backend
..\.venv\Scripts\python.exe scripts/security_scan.py
```

It checks Python dependencies with `pip-audit` (install it first with `pip install pip-audit`) and frontend dependencies with `npm audit --omit=dev`. Fix any reported vulnerabilities before production deployment.





## 4. Production data reset

On a brand-new deployment, leave `june-data` empty and only configure the real administrator. To reset test commerce/training data on an existing deployment, first back up the volume, then run:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml exec june-api `
  python scripts/clean_test_data.py --reset-commerce --confirm CLEAN_JUNE_DATA
```

This keeps accounts and audit records but removes orders, entitlements, MVP runs, model-service credentials, payment callback records, and analytics events.
