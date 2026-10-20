# AGENTS.md — HUB-IT

Reply to the user in Russian: result first, then only the necessary details. HUB-IT is a monorepo for an internal IT platform: React 18/Vite/MUI, Python/FastAPI, SQL Server, PostgreSQL, WPF/WebView2, Expo Android.

Do not add mandatory Redis, Docker, a message broker or a new service without the user's direct instruction. Keep existing optional components; verify them against code/runtime.

## Navigation

Read only the code, tests and docs relevant to the request; find the area with `rg`. Where to start per subsystem/task: [REPOSITORY_MAP.md](documentation/technical/REPOSITORY_MAP.md) («Куда смотреть по типу задачи»). Tests: [TESTING.md](documentation/technical/TESTING.md). Domain language: [CONTEXT.md](CONTEXT.md) (do not create a second glossary). Decisions: `docs/adr/`.

If docs contradict code or production facts, record the contradiction and verify the implementation safely; never silently pick one.

## Working mode

- «Проверить», «разобраться», «аудит», «найти причину» → read-only diagnostics, no changes.
- «Исправить», «сделать», «реализовать» → minimal diff, relevant tests, verifiable result. A code-fix request does not authorize deployment or restart.
- Resolve ambiguity from the request, prior decisions, code and tests. Ask only about choices that materially change business logic, a public contract, the data schema or data-loss risk; make routine reversible choices yourself and state assumptions. While waiting for an answer, continue independent permitted work.
- Touch only task-related files; follow neighbouring code style and the `router/handler → service → store` layering. No drive-by refactoring, no "future" dependencies, no unrequested public behaviour changes.
- The working tree may be dirty: never overwrite others' changes, never use `git reset --hard`/`git checkout --`, no commits or branches unless asked.

## Production safety

Production is read-only by default. Lack of staging never permits testing on production: use a local environment, test DB or isolated harness.

Without the user's explicit request it is forbidden to:

- change `.env`, IIS, PM2, PostgreSQL config or Windows settings;
- run DDL/DML/DELETE, migrations, retention or cleanup on production;
- restart processes, free ports or deploy (including `npm run build`: it writes `dist/`, which IIS serves live);
- delete tables, indexes, users, files or data.

An explicit request or earlier consent authorizes the named operation within the agreed environment and scope; ask again only if the goal, scope or risks change. Before a dangerous operation: read-only check of the exact target, then command, expected effect, rollback and post-check.

Restarts only via the standard scripts and only on explicit request: backend `scripts/pm2/restart-backend.ps1` (also runs `restart-scan.ps1` — include in scope), split chat `restart-chat.ps1`, everything `restart-all.ps1` (only if a full restart is needed). Never replace them with a bare `pm2 restart`: the scripts clean orphan processes and ports. The frontend is served by IIS, not PM2. Diagnostics may use read-only health requests and `scripts/pm2/health-check.ps1` without `-RepairBackend`/`-RepairScan`. If `pm2.cmd` cannot find Node, put `tools/node-v24.14.0-win-x64-full` on PATH.

When a PM2 process is added, renamed or removed, in the same change:

- add it to an ecosystem file included by `scripts/pm2/ecosystem.all.config.js` (autostart `pm2-boot-resurrect.ps1` takes the set from there and `dump.pm2`); a process with its own config must be described in the [PM2 runbook](scripts/pm2/README.md) and followed by `pm2 save` after the agreed start;
- update the lists in `start-all.ps1`/`restart-all.ps1`/`health-check.ps1` (if critical) and the staged list in `pm2-boot-resurrect.ps1` (if a heavy worker);
- run `powershell -File scripts\pm2\pm2-boot-resurrect.ps1 -DelaySeconds 0`: `_boot_resurrect.log` must list the process in `expected apps` and `online`.

Deactivate users by default, keeping PK, history and relations. Cleanup needs dry-run, a feature flag defaulting to `false`, bounded batches, a single-run lock, metrics and safe re-runs.

## Secrets

Never put passwords, tokens, cookies, private keys or connection strings in code, commands, logs or reports; do not pass them via CLI when env or a protected config exists. Never commit `.env` or the local `LLM_PROJECT_CONTEXT.md`; `.env.example` holds placeholders only.

## Data and migrations

### SQL Server

Source of truth for legacy ITINVENT and equipment. `pyodbc`: parameterized `?` queries only. Do not change the meaning of legacy fields/procedures without checking consumers.

### PostgreSQL

- Holds app/chat/scan runtime. Schema changes only via Alembic; no runtime `CREATE TABLE/INDEX` in the request path. Use the existing ORM/SQL abstraction and bound parameters.
- Production processes never apply migrations: `initialize_app_schema`/`initialize_chat_schema` only compare `system.alembic_version` with head and log `schema_migration_check`. Migrations run by explicit command at release ([runbook](scripts/pm2/README.md#миграции-бд-при-релизе)); a new file in `alembic/versions` changes nothing in production. Test migrations on sqlite/test DB, including upgrade/downgrade.
- Before migrating, check the actual schema, volume, indexes, FKs, duplicates, orphan rows, locks and free space.
- Alembic does not read the URL from `.env`: pass it explicitly (`alembic -x url=<url> ...` or `ALEMBIC_DATABASE_URL`).
- Chat migrations are idempotent ("create if missing") and never skip DDL based on `itinvent_scope`: check that tables exist (`chat.*` or legacy `public.chat_*`), not the scope.
- **Chat invariant:** ORM and base migrations use the logical schema `chat`, but the legacy runtime may route it to `public` via `schema_translate_map` while `chat.chat_conversations` does not exist. Before a migration, `alembic check` or manual SQL, verify the actual runtime schema.
- No network calls, heavy serialization or computation inside transactions; long operations in batches with a rollback plan.

### JSON

`data/*.json` is shared by web and bot: keep the existing locking patterns and atomic writes. With `APP_ENV=production` the JSON runtime must not silently fall back to SQLite.

## Backend and concurrency

- Short transactions; no blocking I/O in the event loop.
- Status transitions, approve/reject, update/update and retries: check races, idempotency, lost updates.
- WebSocket: reconnect, ordering, duplicate delivery, backpressure, slow clients. ACK never waits for optional notifications, external calls or heavy serialization.
- Workers survive restarts and multiple concurrent processes.
- Structured logs without secrets, with request/correlation id and stage where the subsystem uses them.

## Frontend

- New domain APIs go into separate files in `WEB-itinvent/frontend/src/api/`; do not grow legacy `client.js`.
- Update the object/query cache instead of refetching the whole page.
- Keep the design system, responsiveness and dark theme; handle loading, empty, error, reconnect and expired-session states.
- Do not break silent refresh, tab return, WebSocket reconnect or the auth flow. API data is not trusted HTML.

## Subsystem invariants

- **LLM:** all OpenRouter/LLM calls only through `shared/llm/`; no local `OpenAI()` clients; never log confidential prompts/responses without redaction.
- **Scan / Inventory:** do not mix. Scan = `scan_agent/`, `scan_server/`, schema `scan` (or an explicitly allowed dev fallback); Inventory = `agent.py`, `agent/`, `inventory_server/`. Read [SCAN_ARCHITECTURE.md](documentation/technical/SCAN_ARCHITECTURE.md) before changing Scan routes/proxy.
- **Desktop:** `desktop/` is a thin WPF/WebView2 shell of the portal (the web frontend is shared by browser and Desktop); auth, REST, WebSocket and business logic stay in frontend/backend. Preserve the origin/navigation policy.
- **Mobile:** the live app is Expo React Native in `mobile-hub/`; never restore the old `mobile-android/` or Capacitor (a native-push API does not imply a Capacitor client).
- **Auth:** read [AUTH_SECURITY_STACK.md](documentation/technical/AUTH_SECURITY_STACK.md) first. Never change session lifetime, refresh rotation, device trust, WebAuthn origin/RP ID or 2FA policy as a side effect. One client's failure must not weaken server checks for others.

## Verification commands

Pick checks by change, narrow to broad; run details in [TESTING.md](documentation/technical/TESTING.md).

- Python: `pytest -q tests/test_<area>_<feature>.py` or specific nodeids; bot `pytest -q -c pytest.bot.ini`. A changed shared fixture: its isolation tests plus affected consumers. The broad backend gate runs separately, after cross-module changes stabilize or on request; do not rerun passing untouched suites.
- Frontend (`WEB-itinvent/frontend`): `npm run test:run -- <paths>`; trial build only `npx vite build --outDir <outside dist>`.
- Playwright E2E: only the relevant spec files (`npx playwright test e2e/<file>.spec.js`), locally with `E2E_LOCAL=1`. The full suite only on explicit request.
- Desktop: `dotnet test desktop/Hub.Desktop.sln -c Release` (portable `tools/dotnet-sdk-8/dotnet.exe`).
- Mobile: per `mobile-hub/README.md`.

Rerun passing checks only after new changes, failures or a specific untested hypothesis. Before a check that touches a DB or services, inspect its fixtures and environment — local tests are not automatically isolated. Extra per change type: database — upgrade/downgrade and schema on a test DB; concurrency — a parallel test of the critical transition and final state; WebSocket — reconnect/duplicate/order; frontend — production build after changes to build, routing, auth or API client; Desktop — Release test/build for WebView2, navigation, packaging, auth bridge.

Never claim tests passed, a problem is fixed or a deployment is done without actually checking; if a check is impossible, state why.

## Test quality

By default write only E2E tests for important user scenarios: Playwright (`WEB-itinvent/frontend/e2e/`) for UI, the app's real `TestClient` for backend boundaries (model: `tests/test_e2e_smoke.py`). Check DOM through user actions, HTTP through routes.

A unit test is allowed only for complex business logic/algorithms, pure functions, or critical spots whose failure cannot be reproduced through a boundary (races, crypto, migrations, permission matrix, offline state machines). Before writing one, state briefly which failures E2E would miss. Write tests before or with the implementation, never afterwards for coverage.

Forbidden (delete when found): trivial tests and tests restating the implementation; empty, boilerplate or coverage-only tests; "renders without error" without a behavioural assertion; export-existence checks (`typeof x === 'function'`, `callable(x)`); constant tautologies; snapshot-only checks; mock-echo (asserting what the test's own mock returned).

## Performance

Find the bottleneck and record a baseline first; compare before/after on the same scenario and volume. API/WS — p50/p95/p99, error rate, event-loop lag, queue wait, stage timings; SQL — query count, time, locks, plan. `EXPLAIN (ANALYZE, BUFFERS)` only in a safe environment or with permission for production. Never declare an optimization successful from a single run or extrapolate a small benchmark to production scale without a caveat.

## Finishing a task

Report briefly: what was done or the cause found; files changed; checks run and their actual results; what could not be checked; remaining risks and deployment steps. Do not retell the process unless asked.

## Maintaining these instructions

Update the rules when mandatory invariants change, and [REPOSITORY_MAP.md](documentation/technical/REPOSITORY_MAP.md) when subsystems, entrypoints or runtime change. Keep details in subsystem READMEs and topic docs. Record recurring user corrections in the matching rule without duplication.
