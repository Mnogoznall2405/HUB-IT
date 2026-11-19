# HUB-IT — покрытие аудита

Дата: 2026-11-13  
Режим: read-only, без активных атак на production и без изменения кода.

## 0. Security skills и инструменты

Перед аудитом изучены методологии и форматы:

- `trailofbits/skills` — static-analysis, insecure-defaults, sharp-edges, fp-check, supply-chain-risk-auditor, differential-review.
- `UnitOneAI/SecuritySkills` — secure-code-review, threat-modeling, API security, IAM/RBAC, secrets-management, dependency-scanning.
- `howardhsieh/agent-security-skills` — skill supply-chain audit, agent threat model, config audit.
- `anthropics/claude-plugins-official/plugins/claude-security` — multi-agent scan, independent verification, false-positive gate, coverage accounting.

Сторонние skills **не устанавливались и не исполнялись**: формат Claude/Codex marketplace несовместим с текущим OpenCode-контуром, а хуки/скрипты не проверялись. Использованы их методологии вручную; локальный skill `security-best-practices` загружен и применён к FastAPI/React.

Фактически доступные инструменты: `npm audit`, `pip-audit` (установлен во временный venv), `git`, `icacls`, `pm2`, локальный Python/Node. **Semgrep, CodeQL, Gitleaks и OSV-Scanner отсутствуют и не запускались**; это явно отражено в отчёте.

## 1. Что проверено фактически

### 1.1 Инвентаризация и архитектура

- Прочитаны `AGENTS.md`, `documentation/technical/REPOSITORY_MAP.md`, `AUTH_SECURITY_STACK.md`, `IIS_DEPLOYMENT_WEB.md`, `CHAT_BACKEND_ARCHITECTURE.md`.
- Построена карта компонентов, портов, reverse-proxy, клиентов, хранилищ и границ доверия — [ATTACK_SURFACE.md](ATTACK_SURFACE.md).
- Автоматический AST-разбор исходников: **838 маршрутов** в `WEB-itinvent/backend/api`, `inventory_server`, `voice_server`; отдельно просмотрены `scan_server` `@app.*` маршруты.
- Сопоставлены router-level и route-level зависимости, роли и permission-константы (`authorization_service.py`), публичные маршруты и долгоживущие соединения.

### 1.2 Аутентификация, сессии, 2FA, SSO, WS

Прочитаны и прослежены:

- `api/v1/auth.py`, `api/deps.py`, `utils/security.py`, `services/auth_security_service.py`, `session_service.py`, `session_auth_context_service.py`, `auth_runtime_store_service.py`, `trusted_device_service.py`, `user_service.py`, `models/auth.py`, `config.py`.
- JWT: алгоритм, `exp`, `token_type`, `jti`, fallback по username, поведение без `session_id`, previous keys.
- Refresh rotation/grace, revoke, logout, change-password, deactivation, reset-2FA.
- 2FA: TOTP enrollment/verify, backup codes, replay/race, trusted devices/passkeys, mobile biometric.
- SSO: state/nonce/PKCE, JWKS/issuer/audience/nonce, internal-zone restriction.
- WebSocket: handshake, `WsSessionLease`, revalidate, membership, chat/hub/task-canvas.
- Admin IP allowlist и разбор XFF/Cloudflare.
- IDOR/BOLA/BFLA: mail, my_files, hub tasks, chat, tickets, passwords, IT objects, equipment, docflow, warehouse, VCS, transfer acts.

### 1.3 Backend/API

- SQL-инъекции: просмотрены `database/queries.py`, `equipment_search_reads.py`, `itinvent_reference_writes.py`, `equipment_db_transfer_service.py`, `appdb/file_egress_store.py`, `chat/db.py`, `push_outbox_retention_service.py`; параметризация `?`/bind, динамические идентификаторы из allowlist/quote.
- Command injection: `subprocess` с аргументными списками, `shell=False`; проверены `ai_sandbox/runtime.py`, `chat/video_compress.py`, `mail_attachment_preview_service.py`, `my_files_antivirus_service.py`, `network_monitor_probe.py`.
- Десериализация: `pickle`/`marshal`/`yaml.load`/`eval`/`exec` не найдены; XML — `resolve_entities=False`.
- Path traversal: my_files, KB, hub attachments, docflow export, tickets, chat attachments, scan/voice media.
- SSRF: link preview, Web Push, OnlyOffice, 1C/ADFS/Exchange/geo, native push; проверены allowlist/redirect/URL rewrite.
- CORS/CSRF/cookies/security headers; debug/error handlers; OpenAPI; rate limits.
- Body limits, upload limits, archive handling, formula injection.

### 1.4 Frontend и mobile

- Все `dangerouslySetInnerHTML`/`innerHTML`/`srcDoc` в web; DOMPurify-конфигурация; mail HTML, chat markdown, KB, tasks, DLP report, OnlyOffice iframe, print.
- Ссылки/redirect/deep links/postMessage/iframe origin; Desktop NavigationPolicy/bridge.
- Токены: web HttpOnly cookies, mobile SecureStore, offline AES-GCM, service worker cache, account switch/logout.
- Mobile: mail WebView/CSP/sanitizer, attachment downloads, deep links, biometric, cleartext/backup flags.
- Локальная проверка DOMPurify: sanitizer сохраняет `<form>`, `<input type="password">`, `style="position:fixed;inset:0;z-index:99999"` (это подтверждает WEB-01, не только статическое чтение).

### 1.5 Файлы, секреты, зависимости, CI/CD

- Проверены ACL: root `.env`, `tmp/.env.bak-*`, `logs/`, `data/`, `C:\ProgramData\HUB-IT\Agent\.env`, `C:\ProgramData\HUB-IT\Secrets`.
- Секреты: git-tracked файлы проверены regex-сканером (Telegram/OpenAI/OpenRouter/GitHub/AWS/Google/Slack/private key/JWT) — совпадений нет; история по ключевым именам (`JWT_SECRET_KEY`, `SQL_SERVER_PASSWORD`, `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, private key) — коммитов не найдено. `.env` в git не отслеживается. Отдельно: тестовый placeholder JWT в `tests/test_backend_auth_hardening.py:39` совпадает с активным ключом — это CRIT-01, а не обычная утечка токена.
- `npm audit --json --omit=dev` в `WEB-itinvent/frontend` и `mobile-hub` — фактически выполнен.
- `pip-audit 2.10.1` (установлен во временный venv вне репозитория) по `C:\Project\HUB-IT-main\.venv\Lib\site-packages` — фактически выполнен.
- GitHub Actions: единственный workflow, actions запинены по SHA, `permissions: contents: read`, `persist-credentials: false`, секретов нет.
- Desktop updater: RSA-PSS-SHA256, allowlist key_id, SHA-256/размер, redirects off.
- PM2: `pm2 jlist` — 21 процесс online; cwd `C:\Project\Image_scan\...`; `APP_ENV` в PM2 env не задан.
- `C:\Project\Image_scan` — junction на `C:\Project\HUB-IT-main`; `start_server.py` загружает root `.env`.

### 1.6 Локальные безопасные проверки (без HTTP)

| Проверка | Результат |
|---|---|
| `python` import `backend.config` из рабочего дерева | `environment=development`, `debug=False`, длина `jwt.secret_key` = 10 |
| Локальный `jwt.encode` + `decode_access_token` с ключом из конфигурации | токен с `user_id=1`, `token_type=access`, без `session_id` декодируется |
| `jwt.encode` с `MAIL_CREDENTIALS_KEY`? | не выполнялось; ключ не выводился |
| DOMPurify + jsdom с точной конфигурацией `mailHtmlContent.js` | форма/пароль/fixed-overlay сохраняются |
| `icacls` | `.env` и backup читаются `BUILTIN\Users`; `.env` агента — тоже |
| `pm2 jlist` | backend/chat/scan/inventory online; APP_ENV в env не задан |
| `npm audit` | frontend: 13 (10 high); mobile: 25 (1 critical, 10 high) |
| `pip-audit` | 220 advisory matches в 17 пакетах |
| git secret regex | 0 совпадений в tracked-файлах |
| git history по ключевым именам | 0 коммитов |

### 1.7 Повторный проход по текущему рабочему дереву (2026-11-13 ~16:50)

После появления security-исправлений выполнены:

| Проверка | Результат |
|---|---|
| `pytest` auth/user-management/network/agent/bot (5 файлов) | 79 passed |
| `pytest` link-preview/push/mail-preview/my-files/hub-tasks (5 файлов) | 197 passed, 1 failed (не связан с security: лишний ключ `unknown` в ожидании outbox-теста) |
| `pytest` auth-flow/transfer-act/WS lifecycle (4 файла) | 86 passed |
| `pytest` session-owner/WS-lease/device-limits | 24 passed, 1 skipped |
| `vitest` excelPreview/mailMessageFileActions/mailHtmlContent/MailHtmlBody | 43 passed |
| `npm audit --omit=dev` frontend / mobile | 12 / 23 vulns (9 high / 1 critical+8 high) |
| `pip-audit` по `.venv` | 2 уязвимых пакета, 3 advisory (было 220/17) |

Выводы повторного прохода и статусы находок: [SECURITY_RECHECK.md](SECURITY_RECHECK.md). Тесты подтверждают кодовые исправления, но не заменяют production runtime, iOS/Android, IIS/SQL и ротацию секретов.

## 2. Что просмотрено только частично

| Область | Что именно | Почему |
|---|---|---|
| Telegram bot | `bot/utils/decorators.py`, `bot/handlers/work.py`, `bot/config.py`; доступ по группе/allowlist | Полный разбор всех handlers и реальная Telegram-группа не проверялись |
| VoiceVideo pipeline | `voice_server/app.py`, `pipeline.py`, `store.py`, публичные share | ML/транскрипция, генерация HTML-отчётов и фактическая изоляция worker не проверялись |
| AI sandbox | `ai_sandbox/*`, gateway/worker, transfer grants | Контур на отдельной Linux VM; runtime, Podman, egress и quota не проверялись |
| 1C / Docflow | `docflow_service.py`, gateway, per-user context | Реальная 1C-авторизация и ACL делегированы 1C; не проверялись |
| Mobile native runtime | Expo/Android, WebView, SecureStore, offline DB | Нет устройства/эмулятора; iOS-сценарий WEB-02 не воспроизведён |
| Desktop UI | WPF/WebView2, updater, bridge | Сборка/запуск не выполнялись; проверен код политики и подписи |
| Production IIS/PM2 | `web.config`, ARR, ACL, порты, реальные env | Конфигурация читалась статически; production-трафик не отправлялся |
| SMB/NAS | `\\10.103.0.229\hubit` | ACL шары и фактические права не инспектировались |
| SQL Server runtime | схема, объёмы, индексы, locks | Только статический анализ запросов; production SQL не выполнялся |

## 3. Что не удалось выполнить

- **Semgrep** — не установлен/не запускался.
- **CodeQL** — не установлен; сборка базы для Python/JS/React Native не выполнялась.
- **Gitleaks** — не установлен; использован собственный regex-скан tracked-файлов и git-истории.
- **OSV-Scanner** — не установлен; pip-audit/npm audit использовались как замена.
- **DAST / активные HTTP-атаки** — запрещены условиями; не выполнялись.
- **Android/iOS runtime** — нет устройства/эмулятора; WEB-02/MOB-01/MOB-02 имеют статус Needs Validation.
- **Детонация вредоносных файлов** — не выполнялась; выводы по парсерам основаны на коде и advisory.
- **Полный backend/frontend test suite** — не запускался; выполнены только целевые наборы из §1.7.
- **Production key rotation / migration** — не выполнялись и не могли выполняться в рамках аудита.

## 4. Независимая проверка Critical/High

Отдельный агент-верификатор пытался опровергнуть каждую Critical/High-находку по коду (без HTTP и без изменения файлов). Итог:

| Кандидат | Вердикт верификатора | Что изменилось после проверки |
|---|---|---|
| CRIT-01 (JWT/APP_ENV) | Confirmed | Добавлено доказательство: тот же placeholder есть в `tests/test_backend_auth_hardening.py:39`; production-старт с ним падает |
| CRIT-02 (Fernet key) | Confirmed | Без изменений |
| HIGH-01 (.env ACL) | Confirmed | Без изменений; условие локального доступа указано |
| HIGH-02 (users.manage) | Confirmed, severity завышена | Понижено до «High (conditional)/Medium»: право уже admin-эквивалентно; это дефект модели делегирования |
| HIGH-03 (agent key) | Confirmed | Без изменений |
| MED-01 (networks/json) | Confirmed частично | Часть GET защищена; в находке оставлены только конкретные незащищённые |
| MED-02 (transfer act) | **Refuted as stated** | Исправлено: viewer заблокирован router-level `database.*`; остаётся IDOR для operator/admin по UUID |
| HIGH-05/HIGH-06 (SSRF) | Confirmed | HIGH-06 помечен как High/Medium (DNS rebinding вероятностен) |
| HIGH-07 (xlsx) | Confirmed | Без изменений |
| HIGH-04 (iOS blob) | Confirmed по коду, runtime условен | Оставлен Needs Validation |
| MED-03 (2FA reset) | Confirmed | Без изменений |

> Повторный проход 2026-11-13 ~16:50: CRIT-01 (прямая подделка) и HIGH-02/04/06, MED-01/02/03/04/05/06/07/10/11 исправлены в рабочем дереве; CRIT-02, HIGH-01, HIGH-03, HIGH-05, HIGH-07, MED-08 и MED-09 остаются (полностью или частично). Актуальные статусы и доказательства — в [SECURITY_RECHECK.md](SECURITY_RECHECK.md).

## 5. Ограничения интерпретации

- `npm audit` и `pip-audit` считают advisory по версиям, но не доказывают reachability. В отчёте это явно разделено.
- Наличие уязвимой зависимости — не то же самое, что эксплуатация; для xlsx путь разбора недоверенных файлов подтверждён, для остальных — указано.
- `APP_ENV=development` и ключи подтверждены для **запущенных PM2-процессов на проверенном хосте**; HTTP-эксплуатация не выполнялась.
- Локальные ACL (`BUILTIN\Users`) зависят от политики домена/сервера; на другом хосте они могут отличаться, но конфигурация установки в репозитории не задаёт более строгих прав.
- Некоторые файлы содержат чужие незакоммиченные изменения; аудит не пытался их исправить или атрибутировать.
