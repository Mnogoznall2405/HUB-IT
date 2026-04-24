# Mail Load Test Without Redis

## Goal

This procedure validates the mail module in the target mode from the stabilization plan:

- no Redis for cache or coordination
- one backend process for mail traffic
- local in-process cache + singleflight
- target load around 50 concurrent online users

## Prerequisites

1. `APP_DATABASE_URL` must point to a PostgreSQL-compatible app database.
2. Do not run the mail load test against SQLite-backed mail metadata.
3. Run the backend with:
   - `MAIL_NOTIFICATION_BACKGROUND_ENABLED=0`
   - `MAIL_CACHE_TTL_SEC=90`
   - `MAIL_BOOTSTRAP_DEFAULT_LIMIT=20`
   - `MAIL_SEARCH_WINDOW_LIMIT=1000`
   - `MAIL_VERIFY_TLS=1`
   - `APP_DB_POOL_SIZE=10`
   - `APP_DB_MAX_OVERFLOW=20`
4. Keep a single backend process for the mail scenario baseline.

## If mail metadata is still on SQLite

Migrate it first:

```powershell
python scripts/migrate_mail_sqlite_to_postgres.py `
  --source-db-path data/local_store.db `
  --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

## Credentials File

Create a JSON file with one or more credentials:

```json
[
  { "username": "user01", "password": "Secret123!" },
  { "username": "user02", "password": "Secret123!" }
]
```

The load script will reuse credentials cyclically if the file contains fewer accounts than the requested number of virtual users.

## Run

Example for 50 virtual users over 15 minutes:

```powershell
python scripts/loadtest_mail_50_users.py `
  --api-base http://127.0.0.1:8001/api/v1 `
  --users-file .\tmp\mail-load-users.json `
  --virtual-users 50 `
  --duration-sec 900 `
  --think-time-sec 2 `
  --report-json .\tmp\mail-load-report.json
```

If the backend uses a self-signed certificate:

```powershell
python scripts/loadtest_mail_50_users.py `
  --api-base https://host.example.com/api/v1 `
  --users-file .\tmp\mail-load-users.json `
  --virtual-users 50 `
  --duration-sec 900 `
  --insecure
```

Optional local RSS sampling when you know the backend PID:

```powershell
python scripts/loadtest_mail_50_users.py `
  --api-base http://127.0.0.1:8001/api/v1 `
  --users-file .\tmp\mail-load-users.json `
  --virtual-users 50 `
  --duration-sec 900 `
  --rss-pid 12345 `
  --report-json .\tmp\mail-load-report.json
```

## Scenario

Each virtual user performs:

1. `POST /auth/login`
2. `GET /mail/bootstrap?limit=20`
3. `GET /mail/messages?folder=inbox&limit=50&offset=0`
4. `GET /mail/messages/{id}`
5. `POST /mail/messages/{id}/read`

This matches the baseline scenario from the stabilization plan:

- login
- bootstrap
- inbox refresh
- open message
- mark read

## Expected SLO

The script prints PASS/FAIL against these targets:

- error rate `< 1%`
- `bootstrap` P95 cold `<= 4.0s`
- `bootstrap` P95 warm `<= 1.5s`
- inbox list P95 cold `<= 2.5s`
- inbox list P95 warm `<= 0.8s`
- RSS should not grow continuously

## Notes

- The script uses cookie-based auth through the same `/auth/login` flow as the web client.
- It does not require Redis.
- It is intentionally biased toward the `messages` mode, not `conversations`.
- If many users hit `2fa_required` or `2fa_setup_required`, use a dedicated load-test credential pool that can complete the standard password-only login flow.
