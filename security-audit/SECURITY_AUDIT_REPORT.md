# HUB-IT — комплексный security audit

Дата: 2026-11-13  
Роль: Lead Application Security Engineer  
Режим: независимый read-only аудит исходного кода, конфигурации и локального окружения.  
Production-трафик не отправлялся, код не изменялся, коммиты не создавались.

> **Актуальный статус на 2026-11-13 ~16:50:** в рабочем дереве появились масштабные security-исправления. Текущая оценка: **1 Critical, 5 High, 2 Medium** (остальные находки исправлены или закрыты в исходниках). Прямая подделка JWT без `session_id` (CRIT-01) закрыта и понижена до High; HIGH-02/04/06 и MED-01/02/03/04/05/06/07/10/11 исправлены. Остаются: CRIT-02 (`MAIL_CREDENTIALS_KEY` = `.env.example`), HIGH-01 (ACL `.env`/backup), HIGH-03 (общий agent ring-key), HIGH-05 (DNS rebinding в Web Push), HIGH-07 (`xlsx-js-style` = SheetJS 0.18.5), MED-08 (зависимости) и MED-09 (SQL TLS в текущей конфигурации). Исправления не развёрнуты, секреты не ротированы. Детали и доказательства: [SECURITY_RECHECK.md](SECURITY_RECHECK.md).

## 1. Итог

Аудит выявил **2 Critical, 7 High (включая условные), 11 Medium и 12 Low/Info** подтверждённых/условных находок. Главный вывод: сама модель аутентификации HUB-IT спроектирована серьёзно (JWT с фиксированным алгоритмом, refresh rotation, 2FA/passkeys, trusted devices, session lease для WebSocket, admin IP allowlist, аккуратная работа с XFF), но **эксплуатационная конфигурация и управление ключами сводят эту защиту на нет**.

Две критические проблемы (на момент первого прохода):

1. **CRIT-01.** Запущенный backend использует `APP_ENV=development` и **10-символьный placeholder JWT-ключ**, который совпадает с placeholder из tracked-теста `tests/test_backend_auth_hardening.py:39`. `Config.validate()` в этом режиме не выполняется, а access-token без `session_id` принимается. Локальная проверка подтвердила: токен, подписанный ключом из конфигурации, успешно декодируется. Это позволяет подделать токен любого active user (admin дополнительно ограничен IP-allowlist); при пустом user store в development создаются default `admin`/`user123` (`user_service.py:666-747`). **Повторная проверка:** токен без `session_id` уже отклоняется, владелец сессии сверяется; остаётся High из-за слабого ключа и `APP_ENV=development`.
2. **CRIT-02.** `MAIL_CREDENTIALS_KEY` в `.env` **совпадает с опубликованным placeholder из `.env.example`**. Этим ключом зашифрованы пароли почты/AD, TOTP-секреты, паспортные данные, VCS и SNMP. Любой, кто получит дамп/бэкап БД и доступ к репозиторию, расшифрует их; TOTP-секреты означают обход 2FA.

Дополнительно: root `.env` и backup читаются `BUILTIN\Users`; agent `.env` на рабочих станциях тоже; общий scan-agent key не привязан к `agent_id`; делегированное `settings.users.manage` позволяет non-admin повысить себя до admin; есть два SSRF-канала (Web Push, link preview), уязвимый `xlsx@0.18.5` на пути недоверенных файлов и несколько BFLA/IDOR.

## 2. Что проверено

- Инвентаризация монорепозитория и карта поверхностей атаки: [ATTACK_SURFACE.md](ATTACK_SURFACE.md).
- Аутентификация/сессии/2FA/SSO/passkeys/WebSocket и RBAC/IDOR/BOLA/BFLA.
- FastAPI-роуты, SQL-параметризация, SSRF, path traversal, command injection, десериализация, mass assignment, CORS/CSRF/cookies, лимиты, debug/error leakage.
- React/mobile: XSS-стоки, DOMPurify, mail HTML, deep links, postMessage, хранение токенов, offline-кэш, logout/account switch.
- Файлы/вложения, публичные share-токены, OnlyOffice, preview-пайплайны, антивирус.
- Секреты в рабочем дереве и git-истории, ACL, зависимости (`npm audit`, `pip-audit`), CI/CD, Desktop updater.
- Независимые параллельные проходы A (auth/authz), B (backend/API), C (web/mobile), D (files/secrets/deps), затем попытка опровержения Critical/High отдельным агентом.
- Изучены методологии Trail of Bits, UnitOne SecuritySkills, Howard Hsieh agent-security-skills и Anthropic Claude Security; сторонние skills не устанавливались, их скрипты/хуки не исполнялись (см. [SECURITY_COVERAGE.md](SECURITY_COVERAGE.md)).

Подробное покрытие и ограничения: [SECURITY_COVERAGE.md](SECURITY_COVERAGE.md).  
Зависимости: [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md).  
Детали и доказательства: [SECURITY_FINDINGS.md](SECURITY_FINDINGS.md).  
Повторная проверка и актуальные статусы: [SECURITY_RECHECK.md](SECURITY_RECHECK.md).  
План: [REMEDIATION_PLAN.md](REMEDIATION_PLAN.md).

## 3. Сводная таблица

| ID | Severity | Module | Vulnerability | Evidence | Confidence | Fix |
|---|---|---|---|---|---|---|
| CRIT-01 | Critical | Auth/config | Placeholder JWT key (also in tracked test) + `APP_ENV=development`; token without session accepted | `.env:275,286`; `tests/test_backend_auth_hardening.py:39`; `config.py:577-588`; `deps.py:108-146` | Confirmed | Rotate keys; `APP_ENV=production`; mandatory session_id |
| CRIT-02 | Critical | Crypto | `MAIL_CREDENTIALS_KEY` equals published `.env.example` | `.env:261`; `.env.example:700`; `secret_crypto_service.py:67-95` | Confirmed | New Fernet key; re-encrypt; rotate credentials |
| HIGH-01 | High | Infra | `.env`/backup readable by local `Users` | `icacls`; `tmp/.env.bak-*`; `ProgramData\HUB-IT\Agent\.env` | Confirmed | Explicit ACL; remove copies; rotate secrets |
| HIGH-02 | High (cond.) | AuthZ | `settings.users.manage` is admin-equivalent; non-admin can create/upgrade admin | `auth.py:2287-2311`; `models/auth.py:273-291`; `user_service.py:1348-1361` | Confirmed | Admin-only role/password changes; forbid self-role; scope permission |
| HIGH-03 | High | Agents | Shared agent key readable; arbitrary `agent_id` | `ProgramData\HUB-IT\Agent\.env`; `scan_server/app.py:1206-1248` | Confirmed | Per-agent keys/mTLS; ACL; split read/write |
| HIGH-04 | High (cond.) | Web mobile | iOS PWA HTML blob same-origin XSS | `mailMessageFileActions.js:281-314`; `useMailMessageFileActions.js:231-233` | Needs Validation | MIME allowlist/sandbox; octet-stream |
| HIGH-05 | High | API | Web Push SSRF | `push_service.py:222-284,397-431`; `settings.py:104-111` | Confirmed | Provider allowlist; HTTPS/IP checks; no redirects |
| HIGH-06 | High/Medium | API | Link preview DNS-rebinding SSRF | `link_preview_service.py:70-98,152-174` | Confirmed (code) | IP pinning/egress allowlist; 80/443 |
| HIGH-07 | High | Frontend | `xlsx@0.18.5` prototype pollution/ReDoS on attachments/public share | `excelPreview.js:50-60`; `SharedFile.jsx:30,401`; npm audit | Confirmed | SheetJS ≥0.20.3/ExcelJS; Worker/limits |
| MED-01 | Medium | API | Networks/json read without read permission | `networks.py` GETs; `json_operations.py` GETs | Confirmed | Add `networks.read`/`database.read` |
| MED-02 | Medium | Files | Transfer act IDOR by UUID | `equipment.py:3673-3707`; `transfer_service.py:333-359` | Confirmed | Owner/operation scope + permission |
| MED-03 | Medium | Auth | 2FA reset/backup codes without re-auth | `auth.py:1821-1830,2050-2075` | Confirmed | Require password + TOTP/WebAuthn |
| MED-04 | Medium | Hub | `announcements.moderate` gives task-admin | `hub.py:126-127,1724`; `hub_service.py:2490-2500` | Confirmed | Use `tasks.manage_all`/admin |
| MED-05 | Medium | Web | Mail HTML inline without sandbox; form/overlay allowed | `mailHtmlSandboxFlags.js:14-30`; `MailHtmlBody.jsx:36-84` | Confirmed | Sandbox default; forbid forms/fixed CSS |
| MED-06 | Medium | API | Chunk body buffered before size check | `chat/uploads.py:43-61` | Confirmed | Streaming limit/413 |
| MED-07 | Medium | Files | XLSX zip-bomb in preview | `mail_attachment_preview_service.py:202-212,280-363` | Confirmed (code) | Zip limits; temp quota |
| MED-08 | Medium | Deps | 220 Python advisories in 17 packages | pip-audit `.venv` | Confirmed versions | Update pypdf/pillow/multipart/starlette |
| MED-09 | Medium | DB | SQL Server TLS cert not validated | `config.py:83-91`; `connection.py:47-57` | Confirmed (code) | `Encrypt=yes;TrustServerCertificate=no` + CA |
| MED-10 | Medium | Bot | Bot access not tied to active HUB user | `bot/utils/decorators.py:43-62` | Needs Validation | Map Telegram ID to active user + permission |
| MED-11 | Medium | Config | No production `DEBUG` guard; OpenAPI exposed | `config.py:577-588`; `main.py:483-490` | Confirmed (code) | Fail on DEBUG in prod; `openapi_url=None` |
| LOW-01…08 | Low | — | CSP report-only; mobile axios; grant reuse; internal rate limit; formula injection; 1C test; mobile sanitizer; data:text/html | см. [SECURITY_FINDINGS.md](SECURITY_FINDINGS.md) | Confirmed/Needs Validation | см. план |
| INFO-01…04 | Info | — | VCS password, avatars, health/OpenAPI, python-jose | см. findings | Confirmed/Needs Validation | см. план |

> Статусы в таблице выше зафиксированы на момент **первого** прохода. Актуальные статусы (Fixed / Partially fixed / Open) — в [SECURITY_RECHECK.md](SECURITY_RECHECK.md); в `SECURITY_FINDINGS.md` после каждого заголовка добавлена строка «Статус повторной проверки».

## 4. Критические находки — кратко

### CRIT-01. Подделка JWT из-за dev-конфигурации

Подтверждено:

- `.env` root: `APP_ENV=development`; `JWT_SECRET_KEYS` — два 10-символьных placeholder-значения; fallback `JWT_SECRET_KEY` — 42-символьный placeholder.
- PM2 `itinvent-backend` online, cwd `C:\Project\Image_scan\WEB-itinvent`, `APP_ENV` в PM2 env пуст; `start_server.py` загружает root `.env`; `C:\Project\Image_scan` — junction на `C:\Project\HUB-IT-main`.
- `Config.validate()` при non-production сразу `return`; проверка placeholder-ключей не выполняется.
- `_load_user_from_token` не требует `session_id`; `trusted_device_service` при `None` возвращает `True`.
- Локально: `jwt.encode` с `config.jwt.secret_key` и `user_id=1`, без `session_id`, успешно проходит `decode_access_token`.

> **Повторная проверка:** прямая подделка без `session_id` и заимствование чужой сессии **закрыты** в `deps.py`/`session_service.py` (REST, optional-auth, WS), есть регрессионные тесты. Остаётся High: известный слабый ключ + `APP_ENV=development` + отсутствие ротации; см. [SECURITY_RECHECK.md](SECURITY_RECHECK.md).

Последствия: подделка access-token любого active user; non-admin данные доступны полностью, admin — при разрешённом IP. HTTP-эксплуатация не выполнялась по условиям аудита.

### CRIT-02. Опубликованный ключ шифрования

`MAIL_CREDENTIALS_KEY` в `.env` побайтово равен placeholder из `.env.example`. Этим ключом `encrypt_secret` защищает пароли почты, кэш AD, TOTP, паспортные данные, VCS и SNMP. Доступ к БД/бэкапу + репозиторию = расшифровка; TOTP-секреты = обход 2FA. Ключ нужно считать скомпрометированным.

> **Повторная проверка:** **Open.** Ключ не ротирован, ACL `.env`/backup не закрыт; см. [SECURITY_RECHECK.md](SECURITY_RECHECK.md).

## 5. Что работает хорошо

- JWT: фиксированный `algorithms=[config.jwt.algorithm]`, проверка `exp`/`token_type`, JTI-revocation, refresh rotation/grace, закрытие сессий при logout/смене пароля/деактивации.
- Cookies: HttpOnly, `Secure` в production, `SameSite=Strict`, refresh-cookie path ограничен.
- 2FA/passkeys/trusted devices: TOTP, backup codes с атомарным consume, WebAuthn challenges, device binding, mobile biometric с revocable credential.
- SSO: code+PKCE, state/nonce, JWKS/issuer/audience/nonce, internal-zone restriction; SSO как замена TOTP явно задокументирован.
- WebSocket: handshake + lease + reauth, membership checks, 4401/1008 коды.
- My Files: 256-битные share-токены, hash+encryption в БД, owner/grant checks, rate limits, AV fail-closed, content-security headers.
- OnlyOffice: подписанные URL/callback, HS256, `typ`/`exp`, запрет `..`, redirects off.
- Desktop updater: RSA-PSS-SHA256, allowlist key_id, SHA-256/размер, redirects off; NavigationPolicy.
- CI: actions pinned by SHA, `contents: read`, `persist-credentials: false`.
- В git-истории по проверенным ключевым именам секретов не найдено; `.env` не отслеживается. Однако тестовый placeholder JWT в `tests/test_backend_auth_hardening.py:39` совпадает с активным ключом — это CRIT-01, а не обычная утечка токена.

## 6. Ограничения аудита

- Semgrep, CodeQL, Gitleaks и OSV-Scanner **не установлены и не запускались**. Использованы ручной анализ, `npm audit`, `pip-audit` (в temp venv), regex-скан tracked-файлов и git-истории.
- DAST/активные HTTP-атаки на production не выполнялись. CRIT-01 подтверждён локальным decode и конфигурацией, но не HTTP-запросом к работающему backend.
- iOS/Android runtime, реальные Telegram-группы, 1C ACL, SMB ACL, IIS/ARR production, SQL Server TLS и полный test suite не проверялись.
- `npm audit`/`pip-audit` не доказывают reachability; для xlsx путь разбора подтверждён, для остальных — указано.
- Часть файлов содержит чужие незакоммиченные изменения; аудит их не исправлял.

## 7. Приоритетный план

**Немедленно (P0):**

1. Ротировать JWT-ключи, выставить `APP_ENV=production`, сделать `session_id` обязательным; перезапустить backend/chat штатными скриптами.
2. Ротировать `MAIL_CREDENTIALS_KEY`, перешифровать все секреты, удалить legacy; при признаках утечки ротировать пароли почты/AD и TOTP.
3. Закрыть ACL `.env`/backup, удалить копии, вынести `.env` из репозитория; ротировать SQL/PG/SMB/Telegram/OpenRouter/LiveKit/OnlyOffice/agent keys.
4. Ротировать agent keys, ограничить ACL ProgramData, ввести per-agent identity.
5. Запретить self-promotion через `settings.users.manage`.

**В течение дней (P1):**

6. SSRF: Web Push allowlist/IP checks; link preview IP pinning/egress.
7. Заменить `xlsx@0.18.5`.
8. Добавить `networks.read`/`database.read` на чтение; object-level проверка transfer act.
9. Re-auth для 2FA reset/backup codes.
10. Включить mail sandbox по умолчанию; исправить `announcements.moderate` → task-admin.
11. Лимиты chunk body и XLSX zip.

**Планово (P2/P3):**

12. Обновить Python/mobile зависимости, CSP enforce/HSTS, SQL TLS, debug guard, bot access mapping, formula injection, download grant, 1C throttle.
13. Архитектурно: разделить user-manager и admin, per-agent mTLS, egress-proxy, sandbox парсеров, secret manager, единая матрица авторизации и регрессионные тесты.

Полный план с критериями и тестами: [REMEDIATION_PLAN.md](REMEDIATION_PLAN.md).

## 8. Итоговая оценка

| Область | Оценка |
|---|---|
| Аутентификация (дизайн) | Хорошо |
| Аутентификация (фактическая конфигурация) | **Критично** |
| Управление секретами | **Критично** |
| Авторизация/RBAC | Требует исправлений (self-promotion, networks/json read, transfer act, announcements) |
| Файлы/вложения | В основном хорошо; xlsx/zip/IDOR требуют исправлений |
| SSRF/исходящие | Требует исправлений (Web Push, link preview) |
| Frontend XSS | В основном хорошо; mail sandbox/фишинг и iOS blob — исправить |
| Mobile | В основном хорошо; axios/sanitizer/data: — исправить |
| Зависимости | Требует планового обновления; xlsx — срочно |
| CI/CD/Desktop updater | Хорошо |

Аудит не изменял код. Все исправления требуют отдельного согласования, тестов и окна обслуживания; P0-изменения нельзя совмещать с обычным релизом.
