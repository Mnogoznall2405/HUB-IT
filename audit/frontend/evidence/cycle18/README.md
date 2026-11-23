# Cycle 18 evidence — asserted E2E, negative controls, strict regressions

- Audit base: PR #9, `209611a3`.
- App source under test: **`338912d9`**, clean `git archive` (frontend + backend).
- Isolated SQLite `.state-cycle18`, backend `:18008`, static proxy `:5228`.
- Preview worker: `WEB-itinvent/start_preview_worker.py` (the same process that runs
  as the PM2 `itinvent-preview-worker`). Without it My Files image previews stay
  `queued`.

## Stand setup

```powershell
$SHA = '338912d9'
$TMP = 'C:\temp\c18'
git archive --format=zip -o "$TMP\src.zip" $SHA
Expand-Archive "$TMP\src.zip" "$TMP\stand" -Force
New-Item -ItemType Junction -Path "$TMP\stand\WEB-itinvent\frontend\node_modules" `
  -Target 'C:\Project\HUB-IT-main\WEB-itinvent\frontend\node_modules'

cd "$TMP\stand\WEB-itinvent\frontend"
$env:VITE_API_URL='/api'; $env:VITE_CHAT_ENABLED='1'; $env:VITE_CHAT_WS_ENABLED='1'
$env:VITE_MAIL_MODULE_ENABLED='1'; $env:VITE_TASK_DISCUSSION_CHAT_ENABLED='1'; $env:VITE_BASE_PATH='/'
npx vite build --outDir "$TMP\built"
```

Generate **test-only** keys (never reuse production secrets):

```powershell
$py = 'C:\Project\HUB-IT-main\.venv\Scripts\python.exe'
$mailKey  = & $py -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
$shareKey = & $py -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
$env:E2E_BACKEND_PORT='18008'; $env:E2E_FRONTEND_PORT='5228'
$env:E2E_STATE_NAME='.state-cycle18'; $env:E2E_FILES_WORKER='1'
$env:MAIL_CREDENTIALS_KEY=$mailKey; $env:MY_FILES_SHARE_TOKEN_KEY=$shareKey
Start-Process $py -ArgumentList 'e2e/stack/local_backend.py' -WorkingDirectory "$TMP\stand\WEB-itinvent\frontend"
```

Static proxy:

```powershell
$env:STATIC_ROOT="$TMP\built"; $env:PROXY_PORT='5228'; $env:API_PORT='18008'
node audit/frontend/evidence/cycle17/static-proxy.cjs
```

Preview worker (same state, continuous):

```powershell
$state = "$TMP\stand\WEB-itinvent\frontend\e2e\stack\.state-cycle18"
$env:APP_ENV='development'
$env:APP_DATABASE_URL = "sqlite:///$($state.Replace('\','/'))/app.sqlite3"
$env:CHAT_DATABASE_URL = "sqlite:///$($state.Replace('\','/'))/chat.sqlite3"
$env:CHAT_MODULE_ENABLED='1'
$env:MY_FILES_STORAGE_DIR="$state\my_files"
$env:MY_FILES_SPOOL_DIR="$state\my_files_spool"
$env:MY_FILES_PREVIEWS_DIR="$state\my_files_previews"
$env:HUB_DATA_DIR="$state\hub_data"
Start-Process $py -ArgumentList 'start_preview_worker.py' -WorkingDirectory "$TMP\stand\WEB-itinvent"
```

## Five E2E (positive control)

```powershell
$env:BASE_URL='http://127.0.0.1:5228'
$env:NODE_PATH='C:\Project\HUB-IT-main\WEB-itinvent\frontend\node_modules'
$env:SHOT_DIR='<audit>\audit\frontend\evidence\cycle18\shots'
$env:PREVIEW_PYTHON=$py
node audit/frontend/evidence/cycle18/five-e2e.cjs
```

Result: 5/5 PASS, 49 mandatory checks. `SHOT_DIR/results-<runId>.json`.

## Negative controls (each must exit 1)

```powershell
node audit/frontend/evidence/cycle18/negative-controls.cjs
```

Result: `SHOT_DIR/negative-controls.json` — 10 negative cases failed as expected;
positive feed passed. Test-only route interceptions: API 500, missing save, wrong
record, duplicates, hidden records, login timeout.

## Strict regressions

```powershell
$env:API_URL='http://127.0.0.1:18008/api/v1'
$env:FIXTURE_FILE='<temp>\c18_admin_fixtures.json'
node audit/frontend/evidence/cycle18/fixtures-admin.cjs
node audit/frontend/evidence/cycle18/fe0232-delegates.cjs
node audit/frontend/evidence/cycle18/fe0239-departments.cjs
node audit/frontend/evidence/cycle18/fe0259-construction.cjs
node audit/frontend/evidence/cycle18/fe_public_preview.cjs
```

Each prints a JSON verdict and exits 1 on a failed assertion. FE-0232/0239 use
the synthetic users/departments from `fixtures-admin.cjs`; FE-0259 creates its own
managed construction object; FE-0326 finds a PNG with a ready preview.

## Results

- Positive: 5/5; 49 checks; 1 non-mandatory observation (FE-0326 artifact).
- Negative: 10/10 fail as expected.
- FE-0232: 11/11; FE-0239: 8/8; FE-0259: 11/11; FE-0326: 7/7 (bug reproduced).
- Authenticated PNG preview: 64x64, canvas pixel (200,30,40).
- Public PNG preview: 200 image/png 180 bytes, Pillow decode fails; original
  download 200.

## Notes

- No real mailbox/Exchange, SQL Server, ONLYOFFICE or production data was used.
- Network failure/delay injections are test-only; persistence was checked on the
  real isolated backend.
- No WebView2 diagnostic host or CDP port is used in cycle 18; cycle 17's host was
  stopped. The FE-0230 analysis is static + cycle-17 live-negative.
- No secrets, cookies or tokens are stored in the evidence.
