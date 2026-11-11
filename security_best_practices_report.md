# Security Best Practices Report — HUB-IT

Дата: 2026-09-24
Метод: активный аудит по `security-best-practices` (openai/skills, commit 49f948fa) + `insecure-defaults`. Референсы: `python-fastapi-web-server-security`, `javascript-typescript-react-web-frontend-security`, `javascript-general-web-frontend-security`.
Scope: `WEB-itinvent/backend` (FastAPI), `WEB-itinvent/frontend` (React 18/Vite/MUI), `scan_server`, `inventory_server`, `bot`, `agent*`, `desktop`, `mobile-hub`, `shared/llm`, конфигурация IIS (`frontend/public/web.config`).

## Executive Summary

Подтверждённых Critical-уязвимостей не найдено. Уровень безопасности основного web-контура выше типичного: параметризованные запросы с quoting идентификаторов, JWT с allowlist алгоритма и key-ring, HttpOnly+SameSite=strict cookie с обязательным `AUTH_COOKIE_SECURE` в production, rate limiting и lockout на login, session-watchdog и лимиты на WebSocket, DOMPurify для почтового HTML, API-key auth на ingest-контурах, продуманные security-заголовки на IIS edge.

Ключевые риски:
1. **F-01** — Cookie-аутентифицированные mutation-запросы не имеют CSRF-токенов; единственный барьер — `SameSite=strict` (спек: SameSite — defense-in-depth, не основная защита).
2. **F-02** — `FileResponse`/`RedirectResponse` по путям и URL из БД без ограничения корня/схемы (arbitrary file read / open redirect при компрометации содержимого таблицы FILES).
3. **F-03** — В git закоммичен `.env.legacy` с реальным-looking `SCAN_AGENT_API_KEY` (не совпадает с текущим `.env`, но требует ротации/проверки и удаления из индекса).
4. **F-04/F-05** — `debug=True` не запрещён в production; `maxAllowedContentLength=4 ГБ` на весь сайт в IIS.

---

## High

### F-01. Отсутствует CSRF-защита для cookie-аутентифицированных mutation-запросов
- **Rule:** FASTAPI-CSRF-001 / REACT-CSRF-001
- **Severity:** High
- **Location:**
  - `WEB-itinvent/frontend/src/api/client.js:224` — `withCredentials: true` (auth целиком через браузерные cookie, Bearer-токена в JS нет — токен в HttpOnly cookie).
  - `WEB-itinvent/backend/api/v1/auth.py:382-401` — `set_cookie(..., httponly=True, samesite=strict, path="/")`.
  - `WEB-itinvent/backend/config.py:136,381-383` — `AUTH_COOKIE_SAMESITE` допускает `lax`/`none` через env.
  - Grep `csrf|x-csrf` по `WEB-itinvent/backend` — 0 совпадений: ни middleware, ни synchronizer/double-submit токенов.
- **Impact:** при понижении `AUTH_COOKIE_SAMESITE` до `lax`/`none` или при XSS на соседнем поддомене того же регистрируемого домена (SameSite считает по eTLD+1) любой POST/PUT/DELETE API выполним cross-site от имени пользователя.
- **Fix:** добавить lightweight CSRF-контроль для cookie-auth мутаций: проверка `Origin`/`Referer` против allowlist (минимальный diff, middleware) или double-submit token. Оставить `SameSite=strict` как второй слой.
- **Mitigation:** сегодня `SameSite=strict` по умолчанию блокирует cross-site отправку cookie; короткоживущий access-token (15 мин) и refresh-rotation сужают окно.
- **FP notes:** Bearer-only клиенты (mobile) не затронуты; риск относится именно к браузерному cookie-flow.

### F-02. FileResponse/RedirectResponse по значениям из БД без confinement
- **Rule:** FASTAPI-FILES-001, FASTAPI-REDIRECT-001
- **Severity:** High (если запись в FILES-документы доступна недоверенному актору — через legacy ITINVENT, иное приложение или прямой доступ к SQL Server)
- **Location:**
  - `WEB-itinvent/backend/api/v1/equipment.py:2817-2836` — `file_path_raw` из `payload["file_path"]` → `os.path.exists(candidate)` → `FileResponse(path=candidate)`; `payload["file_url"]` → `RedirectResponse(file_url)` без проверки схемы/хоста.
  - `WEB-itinvent/backend/api/v1/equipment.py:644-670` — `_normalize_local_file_path` преобразует `file://server/share` в UNC `\\server\share` — расширяет поверхность до сетевых путей.
- **Impact:** чтение произвольного локального/UNC-файла (NTLM-хэш может утечь при обращении к внешнему UNC) или open redirect на внешний домен — при условии, что злоумышленник влияет на строку пути в БД. Аутентифицированный доступ обязателен.
- **Fix:** ограничить выдачу списком доверенных корней (каталог вложений/общих папок), отклонять абсолютные/UNC пути вне allowlist; для `file_url` — allowlist схем (`https:`/`http:`) и хостов.
- **Mitigation:** аутентификация обязательна; `admin`-override БД только для admin.
- **FP notes:** если содержимое FILES-таблицы полностью доверенное (только trusted-процессы пишут), severity снижается до Medium — стоит зафиксировать это допущение в доке.

### F-03. Реальный API-ключ в закоммиченном `.env.legacy`
- **Rule:** REACT-CONFIG-001 / секреты в репозитории (insecure-defaults)
- **Severity:** High→Medium (значение не совпадает с текущим `.env`; вероятно устаревший ключ, но валидность не проверяема безопасно)
- **Location:** `WEB-itinvent/backend/.env.legacy` — `SCAN_AGENT_API_KEY` = 30-символьное токеноподобное значение (commit `710f0651`). Файл отслеживается git.
- **Evidence:** значение не пустое, не placeholder; в активном `.env` ключ другой (64 chars) — т.е. закоммичен прежний ключ.
- **Impact:** если старый ключ ещё принимается `scan_server` (key-ring `SCAN_SERVER_API_KEYS`), владелец репозитория может поллить/сабмитить задачи агентов.
- **Fix:** ротировать `SCAN_SERVER_API_KEYS`, удалить `.env.legacy` из git-индекса (`git rm --cached`), при необходимости — purge из истории; `.env*` оставить только в `.env.example`.

---

## Medium

### F-04. `debug=True` не запрещён в production
- **Rule:** FASTAPI-DEPLOY-002
- **Location:** `WEB-itinvent/backend/config.py:436` (`DEBUG` env), `config.py:573-583` `validate()` проверяет только JWT-секрет и `AUTH_COOKIE_SECURE`; `main.py:440-443`, `chat_main.py:210-213` — debug включает `/docs`,`/redoc`, traceback-страницы.
- **Impact:** комбинация `APP_ENV=production` + `DEBUG=true` даёт открытые OpenAPI-доки и debug-ошибки без единой защиты.
- **Fix:** в `validate()` добавить: `if self.app.debug: raise ConfigurationError("DEBUG is not allowed in production")`.

### F-05. Лимит тела запроса ~4 ГБ на весь сайт (IIS edge)
- **Rule:** FASTAPI-LIMITS-001
- **Location:** `WEB-itinvent/frontend/public/web.config:12-16` — `requestLimits maxAllowedContentLength="4294967295"` применяется ко всему приложению (комментарий: для «Моего диска»).
- **Impact:** memory/CPU DoS на любых endpoint'ах (включая auth), а не только на upload-chunk маршрутах.
- **Fix:** вынести большой лимит в `<location path="api/v1/my-files">` (и upload-session роуты), для остального сайта оставить разумный потолок (напр. 32–64 МБ).

### F-06. Service Worker кэширует аутентифицированные медиа чата; кэш не очищается при logout
- **Rule:** REACT-SW-001
- **Location:** `WEB-itinvent/frontend/public/sw.js:395-402` (`isChatMediaVariantRequest` → `CHAT_MEDIA_CACHE`), `:483-491` (`cleanupOldCaches` удаляет только старые версии), `src/lib/routeChunkRecovery.js:69-70` — полная очистка только при recovery.
- **Impact:** на общем устройстве медиа-вложения предыдущего пользователя остаются в Cache Storage после logout.
- **Fix:** очищать `hubit-chat-media-*` и `itinvent-push-runtime-*` при logout (postMessage в SW), либо не кэшировать ответы с `Authorization`-контекстом.

### F-07. Нет валидации Host header на уровне приложения
- **Rule:** FASTAPI-HOST-001
- **Location:** `main.py`/`chat_main.py` — `TrustedHostMiddleware` отсутствует. Edge (`web.config:23-35`) делает canonical redirect для IP и HTTP, но приложение само принимает любой Host.
- **Impact:** host-header injection при прямом обращении к backend (минует IIS), влияет на генерируемые URL.
- **Fix:** `TrustedHostMiddleware` с canonical host в production, либо зафиксировать «проверено на edge».

### F-08. WebSocket: нет проверки Origin
- **Rule:** FASTAPI-WS-001
- **Location:** `WEB-itinvent/backend/api/v1/chat/ws.py:85-95`, `task_canvas_ws.py`, `hub_realtime_ws.py`; `api/deps.py:227-259` — auth через cookie/Bearer.
- **Impact:** cross-site WebSocket hijacking теоретически возможен; практически сдерживается `SameSite=strict` cookie (cross-site handshake не несёт cookie) и Bearer-only клиентами.
- **Fix:** проверять `websocket.headers["origin"]` против allowlist `config.app.cors_origins` до `accept()`.

### F-09. `download_transfer_act` — скачивание акта по UUID без проверки принадлежности
- **Rule:** FASTAPI-AUTHZ-001
- **Location:** `WEB-itinvent/backend/api/v1/equipment.py:2932-2967`; `transfer_service.py:315-325` — `_ACT_STORE` in-memory, `act_id` = uuid4/uuid5.
- **Impact:** любой аутентифицированный пользователь, знающий UUID, скачает акт. Угадывание UUID маловероятно → остаточный риск утечки ссылки.
- **Fix:** привязать запись к `user_id` создателя или permission `PERM_TRANSFER_READ` на скачивание.

### F-10. Полный обход rate limiting для внутренних адресов, включая login
- **Rule:** insecure-defaults / FASTAPI-LIMITS-001
- **Location:** `WEB-itinvent/backend/rate_limit.py:11-42` — `INTERNAL_NETWORKS` = все RFC1918 + loopback → `skip_rate_limit` для любых роутов, включая `/login` (lockout при этом отдельно работает).
- **Impact:** brute-force паролей из LAN/с хоста без троттлинга (lockout на username+IP всё же ограничивает).
- **Fix:** не применять bypass к auth-роутам или сузить список до конкретных сервисных подсетей.

---

## Low

### F-11. Fallback-pepper для 2FA backup-кодов при пустом JWT-секрете
- **Location:** `WEB-itinvent/backend/services/twofa_service.py:32` — `config.jwt.secret_key or "itinvent-backup-code-pepper"`.
- **Impact:** вне production при пустом секрете backup-коды хэшируются с известным pepper → офлайн-подбор упрощается.
- **Fix:** падать при пустом секрете (fail-secure) вместо fallback-константы.

### F-12. PBKDF2 120k итераций — ниже актуальной рекомендации OWASP (~600k для PBKDF2-HMAC-SHA256)
- **Location:** `WEB-itinvent/backend/services/user_service.py:76,438`.
- **Fix:** поднять `PBKDF2_ITERATIONS` (напр. 600k) — хэши пересчитаются при следующем login/смене пароля.

### F-13. GeoIP-lookup по plain HTTP с утечкой client IP третьей стороне
- **Location:** `WEB-itinvent/backend/utils/client_geo.py:111` — `http://ip-api.com/json/{ip}`.
- **Impact:** IP клиентов уходят внешнему сервису по HTTP; ответ (код страны) используется в UX-подсказках — подмена по сети теоретически возможна (low).
- **Fix:** HTTPS-эндпоинт или локальная GeoIP-база; задокументировать передачу IP третьей стороне.

### F-14. Debug-endpoint `/acts/{doc_no}/inspect` раскрывает внутреннее устройство FILES-хранилища любому пользователю
- **Location:** `WEB-itinvent/backend/api/v1/equipment.py:2861-2878` (`Depends(get_current_active_user)` — без admin/permission).
- **Fix:** ограничить `require_permission`/`get_current_admin_user` или убрать за feature-flag.

### F-15. Экспорт пользователей по SSH на `root@10.103.0.230` по умолчанию
- **Location:** `WEB-itinvent/backend/services/portal_user_export_service.py:204-216` — дефолтный target `root@…`, `ssh`/`scp` с удалённым `mv` (аргументы из env, не из запроса — инъекции нет).
- **Fix:** не-root аккаунт, target только из env (без дефолта), задокументировать.

### F-16. Мелкие отклонения от least-privilege
- `main.py:459-460`, `chat_main.py` — CORS `allow_methods=["*"]`, `allow_headers=["*"]` (origins строго allowlist’нуты — низкий риск; рекомендуется сузить методы/заголовки).
- `WEB-itinvent/frontend/public/web.config` — CSP только `Report-Only` (задокументированный переходный этап; `script-src 'self'` уже строгий — после свёртывания отчётов перевести в enforce).

### F-17. Артефакты и legacy-контент в репозитории
- Закоммичены: `WEB-itinvent/_manual_env_tests/.env1/.env2` (только плейсхолдеры — ок), `google-services.json` (Firebase client config — публичен by design), каталоги `iz/`, `VEL/`, `_restored_from_git_ec63*`, `_recovery_probe`, `zup_probe*.py`, `tmp_*.py`, десятки root-level логов в рабочем дереве (в git не отслеживаются).
- **Fix:** убрать probe/legacy-скрипты из main-дерева или перенести в `archive/` с README-оговоркой.

---

## Verified good (подтверждённые контроли)

- **SQL-инъекции:** `?`-параметры + `_quote_sqlserver_identifier` (bracket-quoting с экранированием `]`) для всех динамических идентификаторов (`queries.py:65-70`, использование на 1967-2078); update-списки колонок в `hub_service.py` собираются из жёстко заданных имён, не из ключей payload.
- **JWT:** allowlist алгоритма (`utils/security.py:96`), key-ring с previous-ключами, JTI-revocation и session-активность (`deps.py:262-279`), валидация placeholder-секрета и `AUTH_COOKIE_SECURE` в production (`config.py:573-583`).
- **Cookies:** `httponly=True`, `samesite=strict` default, `secure` обязателен в prod, refresh-cookie ограничен `path="/api/v1/auth"` (`auth.py:382-401`).
- **Auth-флоу:** login rate-limit 5/min по IP+username + lockout-bans (`auth.py:632-671`), admin IP allowlist (`deps.py:238-246`), XFF принимается только от trusted proxy CIDRs (`request_network.py:109-145`, default loopback).
- **Docs:** `/docs`, `/redoc`, `openapi.json` отключены вне debug (`main.py:442-443`, `chat_main.py:212-213`, gateway-файлы — `docs_url=None`).
- **WebSocket:** обязательная auth до accept, session-watchdog (4401 на истечении), rate-limit (1008), лимит размера payload (1009).
- **Файлы/загрузки:** chat attachments — allowlist расширений/MIME (`chat/service.py:304-315`), `CSP: sandbox` + `nosniff` при отдаче (`attachments.py:121-131`); my-files public share — `token_urlsafe(32)`, хранение по hash + encryption, rate-limit + miss-limit на публичных роутах (`my_files.py:816-888`); отдача только `inline` для safe-mime.
- **Frontend:** DOMPurify (`USE_PROFILES html`, FORBID script/style/iframe/object/embed) для всей почты (`mailHtmlContent.js:65-76`); markdown-редактор экранирует HTML до трансформаций и allowlist'ит схемы ссылок (`taskRichText.js:1-24`); токены не хранятся в Web Storage; `return-to` валидируется (`aboutOnboarding.js:40-62` + `App.jsx:410` same-origin check); no `eval`/`new Function` в проде; нет third-party скриптов в `index.html`.
- **IIS edge:** `X-Content-Type-Options`, `X-Frame-Options SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, CSP-Report-Only `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `no-store` на `index.html`/`sw.js`, canonical HTTPS redirect (`web.config`).
- **Процессы:** все `subprocess` — args-list без `shell=True` с пользовательским вводом (`ai_sandbox/executor.py`, `mail_attachment_preview_service.py`, `transfer_service.py`, `portal_user_export_service.py`); `agent.py` TLS verify по умолчанию (`ca_bundle or True`).
- **Ingest-контуры:** `scan_server`/`inventory_server` — API-key обязателен в production (`scan_server/config.py:117-153`), логируется только fingerprint ключа, не значение.
- **LLM:** `shared/llm` логирует model/error без prompt/response; локальных OpenAI-клиентов вне `shared/llm` не найдено (инвариант соблюдён).
- **Desktop:** `NavigationPolicy.IsAllowedExternalScheme` + navigation-gating (`MainWindow.xaml.cs:1504`, `Security/NavigationPolicy.cs`).
- **bot/**: без eval/exec/subprocess/конкатенации SQL.
- **`.env` файлы в git:** только `.env.example` и плейсхолдерные тестовые env; корневой `.env` не отслеживается.

---

## Приоритет исправлений

1. F-03 — удалить `.env.legacy` из индекса + ротация `SCAN_SERVER_API_KEYS` (быстро).
2. F-04 — запрет `debug` в production-валидации (1 строка).
3. F-05 — разделить `maxAllowedContentLength` по location (web.config).
4. F-01 — Origin/Referer-check middleware для cookie-auth мутаций.
5. F-02 — allowlist корней для `file_path` и схем/хостов для `file_url`.
6. F-06 — очистка SW-кэша на logout.
7. F-07..F-10 — host validation, WS Origin, act ownership, сужение internal-bypass.

По любому finding готов дать расширенный разбор или приступить к исправлению (по одному, минимальными diff'ами, с тестами).
