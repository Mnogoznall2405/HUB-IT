# HUB-IT — карта поверхностей атаки

Дата: 2026-11-13  
Режим: read-only, без активных атак на production.  
Связанные документы: [SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md), [SECURITY_FINDINGS.md](SECURITY_FINDINGS.md), [SECURITY_COVERAGE.md](SECURITY_COVERAGE.md), [SECURITY_RECHECK.md](SECURITY_RECHECK.md).

> Актуальные статусы исправлений — в [SECURITY_RECHECK.md](SECURITY_RECHECK.md). Карта ниже описывает поверхность на момент первого прохода; часть путей уже закрыта в рабочем дереве (session-owner binding, read-права networks/json, owner-check transfer act, sandbox mail HTML, лимиты chunk/zip), но не развёрнута.

## 1. Компоненты и точки входа

| Компонент | Где | Порт / доставка | Аутентификация |
|---|---|---|---|
| Web SPA (React 18/Vite/MUI) | `WEB-itinvent/frontend` | IIS, HTTPS `hubit.zsgp.ru` | HttpOnly access/refresh cookies; Bearer для отдельных сценариев |
| Основной API (FastAPI) | `WEB-itinvent/backend/main.py` | `127.0.0.1:8001` через IIS `/api/*` | JWT access/refresh, сессия, cookie/Bearer |
| Chat API | `WEB-itinvent/backend/chat_main.py` | `127.0.0.1:8002` (scale: 8004) через IIS `/api/v1/chat/*` | те же JWT/сессия; WebSocket lease |
| Scan API | `scan_server/app.py` | `127.0.0.1:8011` через IIS `/api/v1/scan/*` | пользовательская сессия (`scan.read/ack/tasks`) либо agent API key |
| Inventory ingest | `inventory_server/app.py` | `127.0.0.1:8012` через IIS только `POST /api/v1/inventory` | общий agent API key |
| VoiceVideo API | `voice_server/app.py` | `127.0.0.1:8013` через IIS `/api/v1/voice/*` | сессия, валидируется через `/auth/me`; публичные share-токены |
| LiveKit | `tools/livekit` | IIS `/livekit/*` → `127.0.0.1:7880`, медиа UDP/TCP | JWT LiveKit, выдаётся backend |
| AI sandbox control | `backend/ai_sandbox_*_main.py` | private `10.103.0.217:8443` | mTLS/service token, отдельный контур |
| Desktop WPF/WebView2 | `desktop/Hub.Desktop` | установленный клиент | те же cookie-сессии, origin policy |
| Mobile Expo Android | `mobile-hub` | APK | Bearer + SecureStore, installation ID |
| Telegram bot | `bot/` | Telegram API | allowlist пользователей/группы Telegram |
| Inventory/Scan agents | `agent.py`, `scan_agent/`, `agent/` | исходящие HTTPS | общий `X-API-Key` |
| 1C / Exchange / AD FS / OpenRouter | интеграции | внутренние/внешние API | сервисные учётки, OIDC, API keys |

## 2. Границы доверия

1. **Клиент → IIS.** TLS завершается на IIS; `web.config` перезаписывает `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto`, `X-Forwarded-Host` значением `{REMOTE_ADDR}`. Это важно: backend доверяет XFF только от loopback.
2. **IIS → loopback-сервисы.** FastAPI, chat, scan, inventory, voice слушают `127.0.0.1`; IIS ARR — единственный штатный вход. Прямой доступ к портам в обход IIS считается ошибкой конфигурации.
3. **Браузер → API.** Cookie `HttpOnly`, `SameSite=Strict`, `Secure` в production; CORS — фиксированный список origin; refresh-cookie ограничен `/api/v1/auth`.
4. **Mobile → API.** Bearer в памяти/SecureStore; `X-Client-Device-ID`; refresh rotation; offline-снапшоты AES-256-GCM с ключом в SecureStore.
5. **Agent → inventory/scan.** Один общий API key на флот; `agent_id` приходит в запросе, отдельной привязки ключа к агенту нет. Это граница с повышенным риском (см. findings AGENT-01).
6. **Backend → SQL Server / PostgreSQL / NAS / Exchange / 1C / AD FS / OpenRouter / OnlyOffice.** Сервисные секреты в `.env`; SQL Server использует `TrustServerCertificate=yes`; SMB-хранилище My Files — UNC-путь.
7. **Desktop WebView2 → portal.** `NavigationPolicy` разрешает только доверенный origin, AD FS `/adfs/`, внешние схемы `https/mailto/tg/vnc` и private IPv4 HTTP; bridge проверяет origin.
8. **AI sandbox → gateway/DB.** Отдельный Linux-контур; worker/gateway с ограниченными DB-ролями; one-time transfer grants.

## 3. Инвентаризация API

Автоматический разбор AST построил **838 маршрутов** в `WEB-itinvent/backend/api`, `inventory_server`, `voice_server` (scan_server использует `@app.*` и учитывался отдельно). В основном API: **622** маршрута в `api/v1`, **142** в `api/v1/chat`.

| Группа | Примеры | Типовая защита |
|---|---|---|
| Auth | `/api/v1/auth/*` | login/2FA/passkey/SSO/refresh; часть маршрутов намеренно публична |
| Equipment / Database | `/api/v1/equipment/*`, `/database/*` | router-level `database.*` permission; branch/object scope |
| Hub / tasks / feed | `/api/v1/hub/*` | `tasks.read/write`, participant/department visibility, `tasks.manage_all` |
| Mail | `/api/v1/mail/*` | `mail.access`, user/mailbox ownership, attachment allowlist |
| Chat | `/api/v1/chat/*` | `chat.read/write`, membership checks, WS lease |
| My Files | `/api/v1/my-files/*` | `my_files.read/write/share`, owner/grant checks, share tokens |
| Passwords / IT objects | `/api/v1/passwords/*`, `/it-objects/*` | `passwords.read/write`, object-section grants, vault unlock |
| Tickets / KB / Docflow / Warehouse | отдельные роутеры | соответствующие `*.read/write` + object scope |
| Networks / Monitoring | `/api/v1/networks/*`, `/monitoring/*` | **в networks чтение только authenticated**; monitoring — `monitoring.read` |
| Scan / Inventory / Voice | отдельные сервисы | пользовательская сессия или agent key; voice — `/auth/me` |
| Internal/admin | `/api/v1/system/*`, `/settings/app|env`, `/scan/*` internal | admin / permission / loopback |

### Публичные и полупубличные маршруты (by design)

- `POST /api/v1/auth/login`, `/safari-password-beacon`, `/login-mode`, `/sso/begin`, `/sso/callback`, `/passkey-login/*`, `/enable-2fa`, `/verify-2fa*`, `/mobile-biometric/session`, `/refresh`, `/mobile-web-session/consume`, `/session-telemetry`, `/trusted-devices/auth/*`, `/logout`, `GET /auth/avatars/{id}.jpg`.
- `GET /api/v1/my-files/public/{token}`, `/public-folders/{token}`, preview/content/download/grant — доступ по 256-битному токену, hash+encryption в БД, rate limits.
- `GET /api/v1/my-files/download-grant/{token}` — one-time (фактически reusable в TTL, см. FILE-02).
- `GET /api/v1/my-files/office/source|history/source`, `POST /office/callback` — подписанные short-lived JWT.
- `GET /api/v1/vcs/launch/{token}.vnc` — one-time launch token, без сессии.
- `GET /api/v1/voice/public/{token}`, `/clips/{name}`, `/media` — публичная share-ссылка с TTL.
- `GET /health`, `/health/ready`, `/health/pools` — без сессии (информационные).
- `scan_server`: `/health`; `/api/v1/scan/agent-package`, `/install-package`, `/ingest*`, `/tasks/poll`, `/tasks/{id}/result`, `/heartbeat` — agent key.
- `inventory_server`: `/health`, `/health/ready`; `/api/v1/inventory`, `/fs-egress`, `/telegram-probe`, `/browser-probe`, `/max-probe` — agent key (GET probe-данных не проксируются через IIS, но доступны на loopback).
- `POST /api/v1/debug/client-log` — только при `DEBUG_CLIENT_LOG_ENABLED=1` и совпадении session secret.

## 4. Роли и права

Матрица — `WEB-itinvent/backend/services/authorization_service.py`:

| Роль | Базовые возможности |
|---|---|
| `viewer` | dashboard, tasks read/create, settings read, chat read/write, chat.ai.use, mail.access, my_files read/write/share, company_structure.read, docflow.read/act, kb.read |
| `operator` | viewer + announcements.write, tasks.write, database read/write, mfu.read, networks read/write, computers read/manage, it_objects.read, scan read/ack/tasks, statistics, kb.write, vcs.read, docflow.create |
| `admin` | все права, включая settings.users.manage, settings.sessions.manage, monitoring.manage, passwords.*, mail admin, DLP, system metrics |
| custom | `viewer` base + выбранные permission; **может включать admin-права**, в частности `settings.users.manage` |

Особенности enforcement:

- `ensure_user_permission`/`require_permission` делают безусловный bypass для `role == "admin"`.
- `ensure_admin_ip_allowed` ограничивает admin-запросы списком IP из `app.app_settings.admin_login_allowed_ips` (по умолчанию один IP).
- Роутеры `equipment`/`database` имеют router-level `require_any_permission(database.*)`; `networks` и `json_operations` — **нет** read-permission (см. AUTHZ-02).
- My Files, mail, chat, hub tasks, passwords, IT objects, docflow, warehouse выполняют object-level проверки в service-слое; это проверено выборочно и отмечено в coverage.

## 5. Долгоживущие соединения

| Канал | Маршрут | Защита |
|---|---|---|
| Chat WS | `GET /api/v1/chat/ws` | JWT/сессия, membership, `WsSessionLease` reauth, 4401 при истечении |
| Hub realtime WS | `/api/v1/chat/hub-realtime/ws` | тот же вход, publisher событий |
| Task canvas WS | `/api/v1/chat/task-canvas/ws` | task access, участники |
| Scan SSE | `GET /api/v1/scan/events` | `scan.read`, `/auth/me`, поток событий |
| Voice/LiveKit | `/livekit/*` | LiveKit JWT, выданный backend |
| Desktop presence | `/api/v1/desktop-presence/*` | сессия |

Origin WebSocket отдельно не проверяется; защита опирается на `SameSite=Strict` cookie и Bearer. Это приемлемо для текущей конфигурации, но является хрупким местом при `SameSite=None`/компрометации same-site subdomain (см. NEEDS VALIDATION в coverage).

## 6. Хранилища и секреты

| Хранилище | Содержимое | Доступ |
|---|---|---|
| SQL Server `ITINVENT` (10.103.0.213) | оборудование, акты, FILES, сотрудники | сервисная учётка из `.env`; `TrustServerCertificate=yes` |
| PostgreSQL `hubit_chat` (10.103.0.10) | app/chat/scan runtime, auth runtime, My Files metadata, DLP | `APP_DATABASE_URL`/`CHAT_DATABASE_URL`/`SCAN_DATABASE_URL` |
| `data/*.json` | перемещения, работы, кэши, настройки | общий для web/bot; файловые блокировки |
| My Files blobs / NAS | файлы пользователей | `MY_FILES_STORAGE_DIR` (UNC), SMB-учётка |
| ProgramData agents | `.env` агента, spool, logs, probe media | `C:\ProgramData\HUB-IT\*` |
| Root `.env` | JWT, SQL/PG/SMB, SMTP, Telegram, OpenRouter, Fernet, OnlyOffice, LiveKit | файл в корне репозитория; ACL — см. findings SECRET-01 |
| ProgramData `Secrets` | Firebase service account | ACL ограничен (SYSTEM/Administrators/владелец) |

## 7. Межмодульные потоки и идентификаторы

| Поток | Идентификатор | Где проверяется |
|---|---|---|
| Mail attachment | `message_id`, `attachment_ref`, `mailbox_id` | `mail_service` разрешает mailbox только из строк пользователя; Exchange-доступ под его учёткой |
| Chat attachment | `message_id`, `attachment_id` | `chat_service._require_membership` перед выдачей файла |
| My Files | `file_id`, `folder_id`, share `token`, download-grant `token` | owner/grant/role checks; token hash + encryption |
| Hub task | `task_id`, `attachment_id`, `report_id` | `can_view_task`; исключение — `announcements.moderate` (AUTHZ-04) |
| Transfer act | `act_id` (UUID) | router-level `database.*`, но **не проверяется владелец** (AUTHZ-03); viewer заблокирован |
| IT object / vault | `object_ref`, `entry_id` | section grants + `_visibility_clause` + unlock |
| Docflow / Warehouse | `task_ref`, `file_ref`, `registrar_ref` | per-user 1C context, scope |
| Scan / Inventory agent | `agent_id`, `task_id` | общий API key; `agent_id` не привязан к ключу (AGENT-01) |
| VCS | launch `token` | one-time token; глобальный VNC-пароль (INFO-01) |

## 8. Внешние и исходящие каналы

- **Exchange/EWS** — почта, вложения, preview; TLS проверяется (`MAIL_VERIFY_TLS=1`).
- **1C** — docflow/warehouse через bridge; отдельные credential store/DPAPI/Fernet.
- **AD FS** — OIDC code+PKCE, state/nonce, JWKS pin к настроенному issuer.
- **OpenRouter/LLM** — только `shared/llm`; секреты не логируются.
- **OnlyOffice** — signed config/callback, source URL rewriting, internal DS host.
- **Web Push** — `pywebpush` на произвольный endpoint подписки (SSRF-01).
- **Link preview** — `urllib` на пользовательский URL (SSRF-02).
- **LiveKit** — JWT, TURN/медиа.
- **Telegram Bot API** — токен из `.env`; логирование URL подавлено.
- **SMB/NAS** — UNC-хранилище My Files; учётные данные в `.env`.

## 9. Выводы для приоритизации

Наиболее важные границы по результатам аудита:

1. **Конфигурация запуска и ключи** (root `.env`, `APP_ENV=development`, JWT/Fernet keys) — критично, потому что компрометирует всю модель аутентификации и шифрования.
2. **Локальные ACL** (`.env`, ProgramData agents) — превращают низкопривилегированного локального пользователя в держателя сервисных секретов.
3. **Делегированные admin-права** (`settings.users.manage`) — вертикальная эскалация.
4. **Agent API** — общий ключ и отсутствие привязки к агенту.
5. **SSRF/парсеры недоверенных файлов** (Web Push, link preview, XLSX/PDF/Office) — сетевая разведка и DoS/клиентская компрометация.
6. **Неполные server-side permission checks** в `networks`/`json_operations` и точечные object-level исключения.
