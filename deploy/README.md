# June AI production deployment

## 1. Build and configure

1. Build the frontend first: `cd frontend && npm ci && npm run build`.
2. Put production secrets in the process environment or `backend/.env`; never commit them.
3. Required production variables:
   - `JUNE_API_TOKEN` (at least 16 random characters)
   - `JUNE_AUTH_SECRET` (at least 32 random characters)
   - `JUNE_ADMIN_PASSWORD`
   - `JUNE_PUBLIC_BASE_URL=https://your-domain`
   - `JUNE_PAYMENT_PROVIDER=stripe`
   - `JUNE_STRIPE_SECRET_KEY`
   - `JUNE_STRIPE_WEBHOOK_SECRET`
4. Create a Stripe webhook for `checkout.session.completed` and point it to `https://your-domain/api/payments/stripe/webhook`.

## 2. TLS certificate

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

## 3. Start and verify

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
curl.exe -k https://localhost/health
curl.exe -k https://localhost/metrics
```

SSE verification must go through Nginx, not only the backend port. Open the browser at `https://localhost/#/studio`, start a normal chat, and confirm in DevTools that `/api/mvp-runs/.../chat` is `text/event-stream`, receives incremental `data:` frames, and is not buffered until completion.

The API writes JSON request logs to `/data/logs/app.jsonl`; Nginx writes structured access logs to stdout, collected by Docker's `json-file` driver. The backup sidecar writes SQLite backups to the `june-backups` volume and retains the latest `JUNE_BACKUP_RETENTION` copies.

## 4. Production data reset

On a brand-new deployment, leave `june-data` empty and only configure the real administrator. To reset test commerce/training data on an existing deployment, first back up the volume, then run:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml exec june-api `
  python scripts/clean_test_data.py --reset-commerce --confirm CLEAN_JUNE_DATA
```

This keeps accounts and audit records but removes orders, entitlements, MVP runs, model-service credentials, payment callback records, and analytics events.
