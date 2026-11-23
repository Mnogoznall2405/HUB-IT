# Cycle 16 live evidence

## Code / build / stand

- Audit base: PR #9, `60dfe457`.
- App source under test: main `4776ce5f` (merge of PR #14), exported with `git archive`
  into a clean temp directory. No owner working-tree edits were used for the final run.
- Build: `npx vite build`; `vite.config.js` reads env from the repo root
  (`envDir = ../..`), so the local root `.env` was copied next to the clean export
  to enable the same `VITE_CHAT_ENABLED` / `VITE_MAIL_MODULE_ENABLED` flags.
  The `.env` content is not published.
- Backend: `e2e/stack/local_backend.py`, SQLite `.state-cycle16`, port 18006
  (started from the working tree; the only backend working-tree change in range is
  `chat/upload_sessions.py`). Static build proxy on 5224.
- Test user: `e2e_admin` / local E2E password. Production was not contacted.
- Note: an earlier pass used the owner's dirty working tree (main `467512e5` + edits).
  All five E2E scenarios were re-run on the clean `4776ce5f` build; results below are
  from the clean build.

## Route inventory (from `App.jsx`)

- 51 route entries total; 5 redirects/service (`/`, `/dashboard/news`, `/ad-users`,
  `/kb`, `*`); 46 user-visible.
- 3 public, 31 standalone protected, 12 parameterized/child.
- 12 admin sections, 6 settings tabs.
- Full table: `COVERAGE_MATRIX.md`.

## Full E2E — UI → API → SQLite → reopen

| # | Scenario | Steps | Result |
|---|---|---|---|
| 1 | Feed publish | `/feed` → «Создать запись» → title/body → «Опубликовать» → reload | PASS: dialog closed, toast, post present before and after reload; screenshot `live-c16-feed-e2e.png` |
| 2 | Task create | `/tasks` → «Новая задача» → title, description, assignee `e2e_admin` → «Создать задачу» → reload | PASS: row present before/after reload; `live-c16-task-e2e.png` |
| 3 | Task edit + checklist | Open task → «Редактировать» → new description → save → reload; create task with checklist item → reopen → reload | PASS: new description survives reload, old text gone; checklist item survives reload; `live-c16-task-edit2.png`, `live-c16-task-checklist.png` |
| 4 | Chat notes send / cross-tab | `/chat` → «Заметки» → send token → second tab sees it → send from tab 2 → reload → API messages | PASS: API has 4 audit messages, no duplicate bodies; DOM shows sidebar preview + bubble (not duplicate rows); `live-c16-chat-e2e-clean.png` |
| 5 | My Files upload + preview | `/my-files` → file input → «Загрузить» (1 day) → reload → search name → open preview | PASS: upload 200, file survives reload/search, preview shows file content; `live-c16-files-e2e2.png`, `live-c16-files-preview.png` |
| 6 | Admin synthetic user | `/admin/users` → «Новый пользователь» → login/password/name → save → reload → search | PASS: user present before/after reload; `live-c16-admin-user-e2e.png` |

Level separation:

- Real E2E (above): UI action, real isolated API, SQLite write, reopen.
- Functional: route action with checked state but no persistent mutation.
- Smoke: render only.
- Mocked-browser: route-mocked API (used for FE-0022 in cycle 15 only).

## Admin sections and settings

- All 12 admin sections opened: `users, departments, ad-users, references, ai-bots,
  sessions, my-files, feedback, hub-desktop, work-schedules, chat-groups, system`.
  `users` has the E2E create; the rest were read-only/functional render checks.
  `/admin/hub-desktop` shows «Пакет hub-desktop не найден в реестре» +
  «Не удалось загрузить данные развёртывания» — environment state, not a crash.
- All 6 settings sections opened: `appearance, notifications, ai, security, app, about`
  (direct URLs), no render errors.

## FE-0059 — refined conclusions

Effective grace on the stand: **180 s** (root `.env`; source not published). Scenario:

1. Login → refresh (server rotates) → discard the new response cookies.
2. Retry the old refresh cookie inside grace → **200**, new access works (the recovery
   path documented in AUTH_SECURITY_STACK).
3. Retry the old refresh cookie after 185 s → **401 `Refresh token has been revoked`**;
   old access cookie → `/auth/me` **401**.
4. The NEW token pair issued by the rotation is still valid **after** the old-cookie
   rejection: `/auth/me` 200, `/auth/refresh` 200.

Distinction:

- old token rejected: yes, after grace;
- client loses the ability to recover: yes, when the rotation response is lost — the
  client only has the stale cookie;
- whole family revoked: **no** in this scenario. Family revocation is caused by
  exceeding grace reuse hits, not by the old-cookie rejection itself.

## FE-0083 — parallel refresh / family revocation

| Case | Result |
|---|---|
| 3 parallel refresh, same cookie | `[200, 200, 401]` |
| Cookies from a 200 response after the burst | `/auth/me` **401**, `/auth/refresh` **401 `revoked`** |
| 2 sequential stale retries within grace | `[200, 200]`, new access **200** |

Conclusion: the trigger is concurrency. The reuse that exceeds `_REFRESH_GRACE_MAX_HITS`
revokes the family, so even tabs that won the race are logged out. This confirms
FE-0083 and explains why the FE-0059 lost-response case (sequential, no burst) keeps
the new token alive.

## Blocked

- FE-0215 (mail inline images): local stack runs `MAIL_MODULE_ENABLED=0`; `/mail` and
  `/mail/compose` show the corporate-password gate and no IMAP/SMTP mailbox exists.
  Route-mocking cannot validate server autosave or attachment persistence.
- FE-0230 (WebView2 hooks): no Windows Desktop/WebView2 host in this audit; the C#
  bridge sends `desktop.hostReady` only after WebView2 init, so a browser simulation
  would not be valid evidence.
- FE-0232 / FE-0239 (delegates / department-manager races): no prepared
  users/departments fixtures and no approved destructive mutation.
- FE-0259 (Construction draft loss): `/construction` returns **502**
  `BUH20_1C_USER и BUH20_1C_PASSWORD не заданы в .env`; the workspace also needs a
  configured object/direction. F5/close/unmount cannot be tested.
- `/database`: renders but requires a branch/SQL data selection; only smoke.
- `/my-files/edit/:fileId`: editor opens an error state
  («Доступ к документу изменён или файл больше недоступен»); versions/access/cancel
  are not exercisable in this stand.

## Coverage counts

- E2E: 6 route entries (`/login`, `/feed`, `/tasks`, `/chat`, `/my-files`,
  `/admin/:section?`); 8 E2E scenarios total (5 new in cycle 16).
- Functional (without E2E): 26; Smoke-only: 7; Blocked: 7; redirects: 5.
- Functional/E2E = 32/46 = 69.6%; E2E = 6/46 = 13.0%.
- The former “36 scenarios” are action scenarios over 32 route entries, not 36/46.
