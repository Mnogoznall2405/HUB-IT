# Cycle 17 evidence — reproducible stand and results

- Audit base: PR #9, `e8930fe9`.
- App source under test: **`b95c4cac`** (current main at cycle start), exported with
  `git archive` so frontend and backend are the same clean version.
- No owner working-tree changes were used. The audit worktree contains only
  `audit/frontend/`.
- OS: Windows; Chrome via Playwright; WebView2 157.0.4341.60; .NET 8 desktop runtime.

## Stand setup (reproducible)

Use any temp directory; the commands below assume PowerShell.

```powershell
$SHA = 'b95c4cac'
$TMP = 'C:\temp\c17'
git archive --format=zip -o "$TMP\src.zip" $SHA
Expand-Archive "$TMP\src.zip" "$TMP\stand" -Force
New-Item -ItemType Junction -Path "$TMP\stand\WEB-itinvent\frontend\node_modules" `
  -Target 'C:\Project\HUB-IT-main\WEB-itinvent\frontend\node_modules'
```

Build the frontend with explicit flags (the root `.env` is not required and is not
published). `vite.config.js` reads env from the repo root, so process env is enough:

```powershell
cd "$TMP\stand\WEB-itinvent\frontend"
$env:VITE_API_URL='/api'
$env:VITE_CHAT_ENABLED='1'
$env:VITE_CHAT_WS_ENABLED='1'
$env:VITE_MAIL_MODULE_ENABLED='1'
$env:VITE_TASK_DISCUSSION_CHAT_ENABLED='1'
$env:VITE_BASE_PATH='/'
npx vite build --outDir "$TMP\built"
```

Start the isolated backend. Generate **test-only** keys for the run; never reuse
production secrets:

```powershell
$py = 'C:\Project\HUB-IT-main\.venv\Scripts\python.exe'
$mailKey  = & $py -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
$shareKey = & $py -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
$env:E2E_BACKEND_PORT='18007'; $env:E2E_FRONTEND_PORT='5227'
$env:E2E_STATE_NAME='.state-cycle17'; $env:E2E_FILES_WORKER='1'
$env:MAIL_CREDENTIALS_KEY=$mailKey
$env:MY_FILES_SHARE_TOKEN_KEY=$shareKey
Start-Process $py -ArgumentList 'e2e/stack/local_backend.py' `
  -WorkingDirectory "$TMP\stand\WEB-itinvent\frontend"
```

The backend wipes `.state-cycle17` at startup; that is the disposable test DB.
`MAIL_CREDENTIALS_KEY` is required for login challenge generation;
`MY_FILES_SHARE_TOKEN_KEY` is required for public share tokens. Neither value is
written to the audit evidence.

Static proxy (serves the build and forwards `/api` to 18007):

```powershell
$env:STATIC_ROOT="$TMP\built"; $env:PROXY_PORT='5227'; $env:API_PORT='18007'
node audit/frontend/evidence/cycle17/static-proxy.cjs
```

## Admin fixtures (FE-0232 / FE-0239)

```powershell
$env:API_URL='http://127.0.0.1:18007/api/v1'
$env:FIXTURE_FILE='<temp>\c17_admin_fixtures.json'
node audit/frontend/evidence/cycle17/fixtures-admin.cjs
node audit/frontend/evidence/cycle17/fe0232-delegates.cjs
node audit/frontend/evidence/cycle17/fe0239-departments.cjs
```

`fixtures-admin.cjs` creates synthetic users and two departments in the disposable
DB and links a delegate. The FE-0232 script injects a 500 for the bulk delegate
load and verifies the link count before/after Save; the FE-0239 script delays the
D1 members load and switches to D2 before saving managers.

## WebView2 host (FE-0230)

PerfBench build (isolated profile, local stand):

```powershell
dotnet build desktop/Hub.Desktop/Hub.Desktop.csproj -c PerfBench
$env:HUB_DESKTOP_PERF_BENCH='1'
$env:HUB_DESKTOP_ISOLATED_ROOT='<temp>\desktop-root'
$env:HUB_DESKTOP_BASE_URL='http://127.0.0.1:5227/'
$env:HUB_DESKTOP_PERF_LOGIN_USER='e2e_admin'
$env:HUB_DESKTOP_PERF_LOGIN_PASSWORD='<local E2E password>'
$env:HUB_DESKTOP_PERF_QUIT_AFTER_MS='240000'
```

For CDP, the audited temp copy of
`desktop/Hub.Desktop/WebView/DesktopWebViewEnvironmentProvider.cs` was locally
patched to pass `--remote-debugging-port=9229 --remote-allow-origins=*` to
`CoreWebView2EnvironmentOptions`. **This patch is test-only and is not part of the
audit deliverable**; the stock host does not expose a debug port. Then run
`fe0230-webview2.cjs` with `CDP_URL=http://127.0.0.1:9229`.

## Five E2E — clean run

```powershell
$env:BASE_URL='http://127.0.0.1:5227'
$env:NODE_PATH='C:\Project\HUB-IT-main\WEB-itinvent\frontend\node_modules'
$env:SHOT_DIR='<audit>\audit\frontend\evidence\cycle17\shots'
node audit/frontend/evidence/cycle17/five-e2e.cjs
```

Final clean run: `results-1795424647920-424.json`.

| Scenario | Result |
|---|---|
| Feed publish → reload | PASS |
| Tasks create + edit + checklist → reload | PASS |
| Chat notes send + second tab + reload + API dedupe | PASS (`apiOccurrences:2`, `apiDuplicates:0`) |
| My Files upload + search + preview → reload | PASS |
| Admin synthetic user create → reload | PASS |

After a backend restart (to add public-share keys) the My Files scenario was rerun:
`results-1795426289958-665.json`, `results-1795426407627-217.json` — PASS.

## Refresh matrix (FE-0059 / FE-0083)

`refresh-matrix.mjs` (isolated backend, grace 15 s = code default, `MAX_HITS=1`):

| Case | Rotation | Reuse | New token after |
|---|---|---|---|
| A: one sequential stale retry | 200 | 200 | access 200, refresh 200 |
| B: two sequential stale retries | 200 | 200, 401 | access 401, refresh 401 revoked |
| C: three parallel | 200 | [200, 200, 401] | both winners 401 |
| D: stale after grace | 200 | 401 revoked | access 200, refresh 200 |

Conclusion: family revocation is caused by the reuse that exceeds `MAX_HITS=1`;
parallel refresh only reaches that count faster. A lost rotation response (FE-0059)
keeps the new token valid; the logout is client-side because the client retained
only the old cookie.

## Static-only High — results

- **FE-0232** — reproduced with a real backend: bulk delegate load injected 500 →
  delegate absent in drawer → Save sent `items: []` → link count 1 → 0. Control
  1 → 1. Script: `fe0232-delegates.cjs`; fixture: `fixtures-admin.cjs`.
- **FE-0239** — reproduced with a delayed members GET: D1 load delayed 3.2 s,
  switch to D2; late D1 response set the manager draft; Save wrote
  `[11]` into D2 (was `[13]`). Script: `fe0239-departments.cjs`.
- **FE-0259** — reproduced live on a synthetic managed object: work plan saved and
  visible after reload; day draft `5` lost on F5 with no `beforeunload` dialog.
  Script: `fe0259-construction.cjs`.
- **FE-0230** — real Windows WebView2 host test (PerfBench build from `b95c4cac`,
  isolated profile, delayed `desktop.ready` 8 s). The chat notifications card was
  mounted at `shell=null`; at the hostReady flip the update button was clicked
  synchronously. No hooks error; parent unmounted the card. Live crash **not
  reproduced**; static risk remains. Script: `fe0230-webview2.cjs`.
- **FE-0215** — **blocked**: mail transport is Exchange EWS, not IMAP/SMTP; no EWS
  test server/mailbox; local stack forces `MAIL_MODULE_ENABLED=0`; `/mail` shows the
  corporate-password gate. Route-mocking would be UI-only.

## Public share, KB, smoke routes

- Public file share: create 200 → public page 200 + download 200 (content match) →
  revoke 204 → public/download 404. Forced expiry (`expires_at` in the past in the
  disposable DB) → public/download 404 + "срок хранения истёк". Scripts:
  `fe_public_share.cjs`, `fe_public_expiry.cjs`.
- `/kb/manage`: create article → reload → reopen with description — PASS. Script:
  `kb-manage-e2e.cjs`.
- `/dashboard`: real greeting/task/mail/chat counters, no API errors.
- `/statistics`, `/computers`: controls render, 0 records; classified as Smoke
  (no data fixtures), not as verified with data.
- `/database`: equipment APIs 500/503; blocked.
- `/my-files/edit/:fileId`: ONLYOFFICE server unavailable; blocked.
- `/it/objects/:objectRef`: objects DB unavailable; blocked.

## Secret hygiene and limitations

- Test keys are generated per run and passed via environment; no keys, cookies or
  tokens are written to the audit evidence or logs.
- Synthetic users/departments/objects live only in `.state-cycle17`.
- Network-failure and delay injections are marked as such; persistence checks were
  performed against the real isolated backend.
- Production, IIS, PM2 and the owner's working tree were not touched.
