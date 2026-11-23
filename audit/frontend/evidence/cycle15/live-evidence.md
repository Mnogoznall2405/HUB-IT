# Cycle 15 live evidence

## Code/config

- Audit base: PR #9 `eb83a0c0` (323 records).
- Tested build: trial `cycle14-built`, built from main `5513db68`; current main `467512e5` changed MyFiles only — Auth/Warehouse1C/http/main/sw/construction files are identical (`git diff --stat` empty).
- Stand: `e2e/stack/local_backend.py`, SQLite `.state-cycle15`, 18002; static build proxy 5223; separate 2FA backend 18004 (cycle 14 evidence).
- Test users: e2e_admin / e2e-local-admin-pass; no production calls.

## FE-0022 — Warehouse1C keyboard (confirmed with mocked data)

- Route-mocked `GET /warehouse-1c/balances` returned one row; searched «кабель», rendered table.
- DOM: `tr` has `tabindex=null`, `role=null`; nomenclature `td` has `tabindex=null`, `role=null`;
  no keyboard-focusable element on the cell. Clickable cell is mouse-only.
- Screenshot: `live-fe0022-warehouse-row.png`.
- Expected: row/cell reachable by Tab/Enter; actual: no focus target.

## FE-0059 — lost refresh response (confirmed API)

- Login, POST /auth/refresh (server rotates), discard new cookies (lost response).
- Wait 185 s (> grace 180 s from root `.env`), retry old refresh cookie -> 401 `Refresh token has been revoked`.
- Old access cookie -> /auth/me 401 `Could not validate credentials`.
- Expected: recover session within grace; actual: forced logout after lost rotation.

## FE-0325 / PWA (cycle 15)

- Three offline/online reload cycles with existing session: each offline render `/dashboard` + cached banner in ~2.6 s, online returns dashboard.
- Fresh session offline reload still hangs >50 s (cycle 14); only 2 refresh attempts, reconnect recovers ~2 s.
- Two tabs both show loader offline; stale-SW probe: new worker `waiting=true`, old controller and old caches remain; `/settings/app` showed no update label.
- Screenshot: `live-stale-sw.png`.

## Functional routes added (12)

`/help` (open article), `/menu` (navigate Tasks), `/it/objects` (retry/error state), `/it/requests` (История tab), `/groups-access` (refresh), `/voice` (Задачи tab + refresh), `/monitoring` (empty/search state), `/shared-files/invalid` (retry error), `/admin` (Отделы), `/file-egress` (refresh), `/dlp` (refresh), `/chat/open` (К списку чатов -> /chat).

Level: Functional (not E2E creation); dialogs are not counted as record creation.

## Blocked

- FE-0215: local stack sets `MAIL_MODULE_ENABLED=0`; no IMAP/SMTP test mailbox; route-mocking cannot validate server autosave/attachment persistence.
- FE-0230: no Windows Desktop/WebView2 host; C# host sends `desktop.hostReady` after bridge init; browser simulation is not valid WebView2 proof.
- FE-0232/FE-0239: no approved mutation/fixtures for delegates/departments.
- FE-0259: construction workspace requires configured object/direction («сначала настройте объект»); mocked planning alone insufficient.
