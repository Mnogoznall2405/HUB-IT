# HUB-IT — план исправлений

Дата: 2026-11-13.  
Аудит был read-only: ниже — рекомендации, а не выполненные изменения. Любое исправление требует отдельного согласования, тестов и окна обслуживания. Не запускайте `npm run build`, миграции, перезапуски или правки `.env` в production без явного разрешения.

> **Статус на 2026-11-13 ~16:50:** часть P0/P1 уже реализована в рабочем дереве, но **не развёрнута**. P0-1 (прямая подделка JWT) и P0-5 (self-promotion) закрыты в коде; P0-2/P0-3/P0-4 остаются. P1-1 (link preview) закрыт, Web Push — частично; P1-2 (`xlsx`) не закрыт из-за `xlsx-js-style`; P1-3/P1-4 закрыты. Остальные пункты плана не переоценивались. Актуальные статусы: [SECURITY_RECHECK.md](SECURITY_RECHECK.md).

## P0 — немедленно (компрометация аутентификации/секретов)

### P0-1. Заменить JWT-ключи и включить production-валидацию

**Проблема:** `APP_ENV=development`, активный 10-символьный placeholder-ключ; `Config.validate()` не работает; токен без `session_id` принимается.

**Порядок:**
1. Сгенерировать новый случайный ключ: `python -c "import secrets; print(secrets.token_urlsafe(64))"` (в protected environment).
2. Записать его первым в `JWT_SECRET_KEYS`, старый реальный ключ — вторым (только если он не placeholder). Placeholder-ключи удалить.
3. Установить `APP_ENV=production` (и `DEBUG=false`).
4. Перезапустить backend и chat штатными скриптами (`restart-backend.ps1`, `restart-chat.ps1`).
5. Убедиться, что `Config.validate()` проходит; все старые сессии/refresh станут недействительны — это ожидаемо, пользователи перелогинятся.
6. После стабилизации удалить старый ключ из `JWT_SECRET_KEYS`.

**Не делать:** не включать `APP_ENV=production` до замены ключей — приложение не стартует (это правильное fail-closed поведение).

**Регрессия:** тест `Config.validate()` падает на placeholder; тест API: токен без `session_id` отклоняется 401; тест refresh rotation.

### P0-2. Ротировать `MAIL_CREDENTIALS_KEY` и перешифровать данные

**Проблема:** ключ совпадает с опубликованным placeholder; им зашифрованы пароли почты, кэш AD, TOTP, паспортные данные, VCS, SNMP.

**Порядок:**
1. Сгенерировать новый Fernet key (`cryptography.fernet.Fernet.generate_key()`), сохранить вне репозитория.
2. Перешифровать все `*_enc`/`*_encrypted` поля (mailbox_password_enc, auth/session password_enc, TOTP, passport, VCS, monitoring secrets) скриптом decrypt-старым → encrypt-новым с проверкой. `MAIL_CREDENTIALS_KEY_LEGACY` в текущем коде **не поддерживается**; для постепенного перехода сначала добавить его в `secret_crypto_service`.
3. После успешной проверки удалить старый ключ.
4. Считать старый ключ скомпрометированным: при признаках доступа к БД/бэкапам ротировать пароли почты/AD и перевыпустить TOTP.
5. Убрать литерал из `.env.example`; добавить startup-check «ключ не равен example и не короче 32 байт».

**Регрессия:** decrypt(encrypt(x)) для нового и legacy; вход в почту; 2FA; VCS; monitoring.

### P0-3. Закрыть локальный доступ к `.env` и backup

**Проблема:** `.env` (и `tmp/.env.bak-*`) читаются `BUILTIN\Users`; там SQL/Postgres/SMB/JWT/Fernet/API keys.

**Порядок:**
1. Снять наследование ACL с `.env`, `tmp`, `logs`, `data`; оставить `SYSTEM`, `Administrators` и сервисную учётку.
2. Удалить `tmp/.env.bak-*` и другие копии секретов; проверить `backups/`, `artifacts/`, `output/`.
3. Вынести `.env` из корня репозитория в защищённый каталог; обновить `config.py`/`start_server.py` или использовать protected environment.
4. Ротировать все секреты, которые были доступны локально: SQL/Postgres, SMB, Telegram, OpenRouter/RouterAI, LiveKit, OnlyOffice, JWT, Fernet, agent keys.
5. Проверить ACL SMB-шары `\\10.103.0.229\hubit` и права `HUBIT_STORAGE_USERNAME`.

**Регрессия/контроль:** `icacls` в deploy checklist; старт-ап проверка, что стандартный пользователь не читает `.env`; тест доступа к NAS под сервисной учёткой.

### P0-4. Ротировать agent keys и привязать их к агенту

**Проблема:** `C:\ProgramData\HUB-IT\Agent\.env` читается `BUILTIN\Users`; `SCAN_AGENT_API_KEY` принят сервером; `/api/v1/scan/tasks/poll?agent_id=` и `/result` не привязаны к ключу.

**Порядок:**
1. Сгенерировать новый ring `SCAN_SERVER_API_KEYS`/`SCAN_AGENT_API_KEY` и `ITINV_AGENT_API_KEY(S)`; старые отозвать.
2. Ограничить ACL `C:\ProgramData\HUB-IT\Agent` (и `ScanAgent`) до `SYSTEM`/`Administrators`/сервисной учётки.
3. Ввести per-agent key или подпись `agent_id`; проверять владельца задачи в `poll_tasks`/`task_result`.
4. Разделить read- и write- agent endpoints; read probe-данных — только отдельный admin/service token.
5. Рассмотреть mTLS/короткоживущие токены для агентов.

**Регрессия:** ключ агента A не читает задачи агента B; стандартный пользователь не читает `.env`; старый ключ получает 401.

### P0-5. Запретить самоповышение через `settings.users.manage`

**Проблема:** non-admin с этим custom permission может `PATCH /auth/users/{self} {"role":"admin"}` или сменить пароль администратора.

**Порядок:**
1. В `update_user`/`create_user` разрешать `role`, `is_active`, `password`, `custom_permissions` другого пользователя только при `current_user.role == "admin"`.
2. Запретить менять собственную роль и собственный permission-набор даже admin’у (или требовать второго admin).
3. В `create_user` запретить `role=admin` без admin-роли.
4. Пересмотреть UI: `settings.users.manage` не должен выглядеть как «ограниченное» право, если оно эквивалентно admin.

**Регрессия (E2E/TestClient):** user-manager PATCH own role → 403; user-manager PATCH admin password → 403; admin → 200; audit log.

## P1 — в течение нескольких дней

### P1-1. SSRF: Web Push и link preview

- Web Push: allowlist провайдеров (FCM/Mozilla/WNS/Apple), HTTPS only, resolve+private-IP deny, redirects off, лимит подписок; отдельный egress-proxy.
- Link preview: резолвить host один раз, проверять все IP и подключаться к конкретному проверенному IP (IP pinning); разрешить только 80/443; запретить metadata/link-local; egress-proxy.
- Регрессия: `http://127.0.0.1`, `169.254.169.254`, DNS rebinding fixture, internal host → отказ.

### P1-2. Заменить `xlsx@0.18.5`

- SheetJS ≥0.20.3 с официального CDN или `exceljs`; лимиты размера/ячеек; Web Worker + timeout.
- Проверить все пути: mail, My Files, public SharedFile.
- Регрессия: prototype-pollution fixture, ReDoS timeout, обычный XLSX.

### P1-3. Закрыть read-права `networks` и `json_operations`

- Добавить `require_permission(PERM_NETWORKS_READ)` на все GET `/networks/*`.
- Добавить `require_permission(PERM_DATABASE_READ)` на GET `/json/transfers`, `/works`, статистику/экспорт.
- `discovery.identify-workspace` — `database.read` или отдельное право.
- Регрессия: viewer → 403; operator → 200.

### P1-4. Object-level проверка transfer act

- `GET /equipment/transfer/act/{act_id}`: требовать `database.write`/`database.read` + owner/operation scope; не выдавать по одному UUID.
- `prepare_act_download` не должен быть публичным API; добавить audit.
- Регрессия: чужой act_id → 404/403; свой → 200.

### P1-5. Re-auth для 2FA reset/backup codes

- `POST /auth/reset-2fa-self` и `/auth/backup-codes/regenerate`: требовать password + текущий TOTP/backup code (или WebAuthn), иначе 403.
- Логировать событие; уведомлять пользователя.
- Регрессия: session без re-auth → 403; с re-auth → 200; сессии закрываются.

### P1-6. Включить sandbox для mail HTML по умолчанию

- `parseFlag(envValue, true)` + `VITE_MAIL_HTML_SANDBOX=1` в сборке.
- В DOMPurify запретить `form,input,button,select,textarea` и `position:fixed/absolute`; ссылки — `target=_blank rel=noopener`.
- Регрессия: overlay-письмо не содержит form/fixed; компонент использует iframe по умолчанию.

### P1-7. Исправить `announcements.moderate` → task admin

- В task-эндпоинтах использовать `_is_admin_user` или `tasks.manage_all`/`tasks.review`; не переиспользовать announcement permission.
- Регрессия: moderator без task-прав → 403 на чужую private-задачу.

### P1-8. Ограничить тело chunk-загрузок и XLSX zip

- Проверять `Content-Length` и читать `request.stream()` с лимитом; 413 до буферизации.
- В Excel-preview проверять `ZipInfo.file_size`, суммарный uncompressed size, ratio, число листов; лимит temp.
- Регрессия: 60 МБ chunk → 413 без роста памяти; zip-bomb XLSX → 413/422.

## P2 — планово (недели)

1. **Python-зависимости:** обновить `python-multipart`, `pypdf`, `pillow`, `starlette`, `cryptography`, `urllib3`, `aiohttp`; прогнать functional tests; добавить `pip-audit`/OSV в CI.
2. **Mobile:** обновить `axios`; заменить `decode-uri-component` shim; пересобрать APK; проверить, что `shell-quote` не входит в release APK.
3. **CSP/HSTS:** перевести CSP из Report-Only в enforce (с nonce/hash), добавить `form-action`, `base-uri`, `frame-src`; HSTS после проверки всех поддоменов.
4. **SQL Server TLS:** `Encrypt=yes;TrustServerCertificate=no` + CA; проверить драйвер/порт; иначе документировать риск.
5. **Debug/OpenAPI:** `Config.validate()` должен запрещать `DEBUG=true` в production; `openapi_url=None`, если docs выключены.
6. **Bot access:** привязать Telegram user к active HUB user и проверять `is_active`/permission на каждом шаге; sync при деактивации.
7. **Mail/mobile hardening:** iOS blob fallback — MIME allowlist/sandbox; mobile regex sanitizer → parser-based; убрать `data:text/html` navigation.
8. **Download grant:** атомарно `UPDATE ... WHERE used_at IS NULL RETURNING`; второй запрос → 410.
9. **Excel formula injection:** экранировать `= + - @` в экспортируемых ячейках.
10. **1C credential test:** rate limit/lockout/audit; запретить проверять чужой login без отдельного права.
11. **Auth internal rate limit:** не отключать лимиты по зоне; отдельный высокий лимит + агрегат на IP/username.
12. **Health/avatars/VCS:** ограничить `/health/pools`, закрыть публичные аватары при необходимости, пересмотреть выдачу глобального VNC-пароля роли `vcs.read`.

## P3 — архитектурные изменения

1. **Разделить «управление пользователями» и «admin»:** отдельная роль/набор прав, запрет self-elevation, двухмандатное подтверждение для admin-назначений.
2. **Per-agent identity:** mTLS или отдельные ключи + подпись `agent_id`; отдельный read-only API для DLP.
3. **Egress-контроль:** единый proxy/allowlist для link preview, Web Push, OnlyOffice, 1C, LLM; запрет private IP на уровне сети.
4. **Изоляция парсеров:** LibreOffice/PDF/изображения/XLSX — в отдельных low-privilege worker/контейнерах с квотами и без сети.
5. **Секреты:** вынести из репозитория в protected store/DPAPI/сервисный аккаунт; ключи — только через environment/secret manager; ротация и аудит.
6. **Политика авторизации:** единая матрица route → permission → object scope, property-based/E2E тесты на IDOR/BFLA; запретить «UI-only» проверки.
7. **Мониторинг:** алерты на admin role changes, 2FA reset, agent key misuse, SSRF-подобные исходящие, массовые скачивания.

## Порядок безопасного внедрения

1. Сначала P0-1/P0-2 (ключи) в изолированном окне; после — P0-3/P0-4 (ACL/agent keys).
2. Затем P0-5 и P1-1/P1-2 (наиболее эксплуатируемые прикладные дефекты).
3. P1-3…P1-8 — обычный release-цикл с регрессией.
4. P2/P3 — плановый техдолг; не смешивать с P0 в одном изменении.

Для каждого пункта: минимальный diff, тест до/после, проверка на локальной/тестовой БД, отсутствие production-миграций без отдельного разрешения.
## Статус реализации (2026-11-13, рабочее дерево)

Код исправлен, тесты добавлены; production-операции выполняются отдельно по согласованию.

| Находка | Статус |
|---|---|
| CRIT-01 | Частично: session_id обязателен в HTTP/WS; **требуется ротация JWT-ключей + APP_ENV=production** |
| CRIT-02 | Открыто: ротация MAIL_CREDENTIALS_KEY + перешифрование данных — операционная задача |
| HIGH (ACL .env, копии) | Открыто: операционная задача (ACL, удаление копий) |
| HIGH-03 (общий agent key) | Код: per-agent привязка scan/inventory; **требуется выдача per-agent ключей** |
| HIGH-04 (link preview SSRF) | Готово: DNS-pinning, единый resolved IP, проверка сертификата по имени |
| Web Push SSRF | Готово: endpoint-валидация при регистрации и отправке, запрет редиректов |
| HIGH-02 (self-promotion) | Готово: non-admin не может назначать права/admin-роль/чужой пароль |
| HIGH-07 (xlsx 0.18.5) | Готово: xlsx 0.20.3 + лимиты парсинга; excalidraw-цепочка — нужен major-апгрейд (решение владельца) |
| iOS PWA HTML/SVG | Готово: нет same-origin blob:-открытия |
| MED-01 (read-права) | Готово |
| MED-02 (transfer act IDOR) | Готово: владелец или admin |
| MED-03 (2FA reset) | Готово: step-up пароль+TOTP |
| MED-04 (announcements.moderate) | Готово: без tasks.manage_all приватные задачи 403 |
| MED-05 (mail HTML) | Готово: sandbox-iframe |
| MED-06 (chunk-body DoS) | Готово: лимиты до буферизации |
| MED-07 (XLSX zip-bomb) | Готово: лимиты записей/размера/листов |
| MED-08 (Python advisories) | Частично: fastapi/starlette/cryptography/pyOpenSSL обновлены, floors в requirements |
| MED-09 (SQL TLS) | Код готов; **временно отключено в .env** (легаси-драйвер DBNETLIB без TLS) — нужен ODBC 17/18 + сертификат |
| MED-10 (bot без привязки) | Готово: TELEGRAM_REQUIRE_HUB_USER + database.* права |
| DEBUG в production | Готово: ConfigurationError |
| LOW-02 (mobile axios) | Готово: axios 1.21.0 |
| LOW-03 (grant reuse) | Готово: одноразовый grant, повтор 410 |
| LOW-04 (internal rate-limit) | Готово: повышенный лимит вместо bypass |
| LOW-05 (Excel injection) | Готово: санитизация формул |
| LOW-06 (1C throttle) | Готово |
| LOW-07/08 (mobile mail) | Готово: слэш-разделители + data:-навигация только первичная |
| INFO-01 (vcs.read → VNC пароль) | Готово: launch-token требует vcs.manage |
| INFO-02/03/04 | Документировано/принято (аватары по дизайну; health loopback; jose CVE не применимо к HS256) |
| FP-* | Без изменений — ложные срабатывания/принятые исключения |

**Остаётся по согласованию (операционно):** ротация JWT/mail-ключей и перешифрование; ACL .env и удаление копий; выдача per-agent ключей; APP_ENV=production; установка ODBC Driver 17/18 + сертификат SQL Server (вернуть Encrypt); миграции/перезапуски/деплой по ранбукам.
