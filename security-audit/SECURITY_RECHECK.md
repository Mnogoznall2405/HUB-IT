# HUB-IT — повторная проверка безопасности (второй проход)

Дата: 2026-11-13, ~16:50. Режим: read-only по коду, локальной конфигурации, ACL и изолированным тестам. Production-запросы, изменения `.env`, перезапуски, деплой и ротация секретов не выполнялись.

## 1. Итог

В рабочем дереве появился большой набор security-исправлений, и большинство кодовых находок первого прохода действительно закрыто. Нельзя, однако, считать инсталляцию production-safe: **действующая конфигурация и управление ключами остаются критическими**, а часть исправлений не развёрнута.

| Категория | Кол-во | Что осталось |
|---|---:|---|
| Critical | **0** | CRIT-01/CRIT-02 закрыты ротацией 2026-11-14 (остаток CRIT-01 — `APP_ENV=development`) |
| High | **3** | общий agent ring-key (код готов, нужны per-agent ключи на машинах); DNS-rebinding в Web Push; уязвимый `xlsx-js-style`/SheetJS 0.18.5 |
| Medium | **2** | остаточные Python/JS dependency advisories; SQL Server без TLS в текущей конфигурации |
| Fixed / Fixed in source | **12** | HIGH-02/04/06, MED-01/02/03/04/05/06/07/10/11 |

Главный вывод: **кодовые исправления нельзя путать с устранением эксплуатационного риска**. Слабые JWT-ключи, `APP_ENV=development`, открытый ACL и placeholder-ключ шифрования всё ещё делают текущую установку уязвимой даже при исправленном коде.

> **Обновление 2026-11-14 (ротация выполнена):** `JWT_SECRET_KEYS`/`JWT_SECRET_KEY` заменены на новый криптостойкий ключ (старые удалены — сессии инвалидированы, повторный вход согласован); `MAIL_CREDENTIALS_KEY` заменён на новый Fernet-ключ, добавлена поддержка `MAIL_CREDENTIALS_KEY_LEGACY`, все 543 ciphertext-ячейки (users, user_mailboxes, session_auth_context, monitoring_profiles, ticket_employees, ticket_employee_documents, vcs_config) перешифрованы `scripts/mail_credentials_reencrypt.py` с backup в `backups/mail-key-rotation-20261114/`; `--verify`: все 549 непустых значений читаются только новым ключом, legacy-переменная удалена; ACL `.env`, `tmp/.env.bak-*`, `C:\ProgramData\HUB-IT\Agent\.env` очищены от `BUILTIN\Users`. CRIT-02 и HIGH-01 закрыты; CRIT-01 закрыт по ключам (остаток — `APP_ENV=development`, гейт не активен). Открытыми остаются HIGH-03, HIGH-05, HIGH-07, MED-08, MED-09.

## 2. Статусы находок

| ID | Было | Сейчас | Доказательство / комментарий |
|---|---|---|---|
| CRIT-01 | Critical | **Fixed (сессии развёрнуты 2026-11-14)** | `deps.py` требует `session_id` и сверяет владельца сессии; REST/optional/WS проверки + регрессионные тесты. JWT-кольцо заменено новым ключом, старые удалены, сессии инвалидированы перезапуском. Остаток: `APP_ENV=development` — production-гейт не активен. |
| CRIT-02 | Critical | **Fixed (2026-11-14)** | `MAIL_CREDENTIALS_KEY` заменён новым Fernet-ключом; `MAIL_CREDENTIALS_KEY_LEGACY` поддержан в `decrypt_secret` как окно совместимости; 543 ячейки перешифрованы (`--apply`), `--verify` — 549/549 под новым ключом, legacy-переменная удалена из `.env`. Backup шифротекстов в `backups/mail-key-rotation-20261114/` (ACL ограничен). |
| HIGH-01 | High | **Fixed (2026-11-14)** | `icacls /inheritance:d + /remove:g BUILTIN\Users` на `.env`, `tmp/.env.bak-*`, `C:\ProgramData\HUB-IT\Agent\.env` и backup-директории: остались SYSTEM, Administrators, CodexSandboxUsers и сервисные SID. Чтение обычным локальным пользователем закрыто. |
| HIGH-02 | High | **Fixed** | `auth.py`: запрет менять собственную роль/права, запрет non-admin редактировать admin, admin-only delete, ограничения `create_user`. E2E `tests/test_e2e_user_management_permissions.py` — 13 passed. |
| HIGH-03 | High | **Open (кодовая цепочка закрыта 2026-11-14, конфигурация и выдача — нет)** | Bound-ключи принимаются и сверяются с identity на всём пути агента: scan_server (`/api/v1/scan/*`), inventory_server (`POST /api/v1/inventory`), backend:8001 (`fs-egress`/`telegram`/`browser`/`max` probes — раньше bound-ключ получал 401). Сравнение hostname регистронезависимо; гейт запуска допускает bound-only конфигурацию (ring можно удалить в финале); добавлена команда `rotate_key` (scan agent) для дистрибуции ключей через task-канал. В `.env` карт пока нет — действуют общие `SCAN_SERVER_API_KEYS`/`ITINV_AGENT_API_KEYS`. Тесты `tests/test_agent_key_binding.py` — 17 passed; `tests/test_scan_agent.py` — 49 passed. |
| HIGH-04 | High (conditional) | **Fixed in source, runtime не проверен** | `mailMessageFileActions.js`: popup-fallback разрешён только для `application/pdf`/PNG/JPEG/GIF/WebP; HTML/SVG/unknown идут в download. Тесты `mailMessageFileActions.test.js` — 12 passed. iOS standalone runtime не проверялся. |
| HIGH-05 | High | **Partially fixed / High residual** | `push_service.py`: HTTPS, запрет userinfo/нестандартных портов, `ip.is_global`, redirects off, проверка при подписке и отправке. Но `assert_public_push_endpoint` резолвит DNS, а `pywebpush` резолвит его повторно при отправке — остаётся TOCTOU/DNS rebinding; allowlist провайдеров нет. |
| HIGH-06 | High | **Fixed** | `link_preview_service.py` резолвит host один раз, подключается к проверенному IP, проверяет TLS SNI/сертификат, не следует redirects, разрешает только 80/443. Тесты `test_chat_link_preview_service.py` — 18 passed. |
| HIGH-07 | High | **Open / regression** | `xlsx` удалён из `package.json`, но `excelPreview.js` импортирует `xlsx-js-style@1.2.0`, внутри которого `XLSX.version = 0.18.5`. `npm audit` alias-пакет не помечает. Лимиты 25 МБ/50 листов/5000 строк/512 столбцов добавлены, но уязвимый парсер остался; публичная share-страница по-прежнему парсит файл. |
| MED-01 | Medium | **Fixed** | `networks.py`/`json_operations.py` требуют `networks.read`/`database.read`; `tests/test_e2e_network_json_permissions.py` — 12 passed. |
| MED-02 | Medium | **Fixed** | Transfer act download проверяет `created_by_user_id`/owner или admin; `tests/test_e2e_transfer_act_pdf.py` — 12 passed, включая owner/unknown-owner сценарии. |
| MED-03 | Medium | **Fixed** | `require_step_up_auth` для reset-2FA и backup-codes; `tests/test_auth_security_flow.py` — 65 passed, включая step-up сценарии. |
| MED-04 | Medium | **Fixed** | Task-эндпоинты используют `_can_manage_all_tasks` (`tasks.manage_all`/admin), а не `announcements.moderate`; `get_task`, attachment и report проверены. |
| MED-05 | Medium | **Fixed** | `MailHtmlBody.jsx` всегда iframe-sandbox; `mailHtmlContent.js` запрещает form/input/button/select/textarea и снимает fixed/absolute/z-index. Тесты `mailHtmlContent.test.js`/`MailHtmlBody.test.jsx` — 25 passed. |
| MED-06 | Medium | **Fixed** | `read_body_limited` читает `request.stream()` с жёстким лимитом до буферизации; применён к chat chunk и equipment photo chunk. |
| MED-07 | Medium | **Fixed** | `mail_attachment_preview_service.py`: лимиты entries (2048), entry (128 МБ), total (256 МБ), `workbook.xml` (16 МБ), sheets (64); проверка до `archive.read`. |
| MED-08 | Medium | **Partially fixed** | Python: 2 уязвимых пакета/3 advisory вместо 220/17; ключевые пакеты обновлены. Frontend: 12 (9 high, Excalidraw/mermaid-цепочка); mobile: 23 (1 critical dev/CLI `shell-quote`, 8 high). `xlsx-js-style` не покрыт audit. |
| MED-09 | Medium | **Open (config) / Fixed (code)** | `config.validate_sql_server_tls` и per-db проверка добавлены, но `.env`: `APP_ENV=development`, `SQL_SERVER_ENCRYPT=no`, `SQL_SERVER_TRUST_SERVER_CERTIFICATE=true`, `SQL_SERVER_ALLOW_INSECURE_SQL_TLS=1`. Production-гейт не активен; фактическое шифрование не проверялось. |
| MED-10 | Medium | **Fixed in source, не развёрнуто** | `bot/utils/decorators.py` требует привязку Telegram ID к active HUB user и permission; `TELEGRAM_REQUIRE_HUB_USER` по умолчанию `1`. `tests/test_bot_hub_binding.py` — 14 passed. Запущенный bot не перезапускался. |
| MED-11 | Medium | **Fixed** | `config.validate()` запрещает `DEBUG=true` в production; `main.py` отключает `/docs`, `/redoc`, `/openapi.json` при `debug=false`; текущий `.env` `DEBUG=false`. |

## 3. Ключевые доказательства

### 3.1. CRIT-01: прямая подделка закрыта, ключи — нет

- `WEB-itinvent/backend/api/deps.py:114-148`: токен без `session_id` отклоняется; `is_session_active_for_user(session_id, user_id)` сверяет владельца; optional-auth (`:192-228`) и WS (`:316-329`) используют ту же проверку.
- `WEB-itinvent/backend/services/session_service.py:888-913`: owner-binding, включая кэш и fallback при неизвестном владельце.
- Регрессии: `tests/test_e2e_user_devices.py::test_forged_token_cannot_borrow_another_users_session`, `tests/test_session_device_limits.py::test_session_owner_binding`, `tests/test_ws_auth_lease.py` — 24 passed, 1 skipped.
- Остаток: `.env` `JWT_SECRET_KEYS` — два 10-символьных ключа; первый совпадает с литералом `tests/test_backend_auth_hardening.py:39` (значение не выводится); `APP_ENV=development`, поэтому `Config.validate()` не выполняется. Ключ не ротирован, старые сессии не закрыты.

### 3.2. CRIT-02 / HIGH-01: секреты и ACL

- `MAIL_CREDENTIALS_KEY` в `.env` побайтно равен `.env.example` (значение не выводится).
- `icacls` на `.env`, backup и agent `.env`: `BUILTIN\Users:(I)(RX)`.
- `tmp/.env.bak-before-1419-20261111-163339` (23 КБ) существует; другие копии не исключены.
- Это не «Potential»: доступ к файлу и совпадение ключа подтверждены локально. Наличие фактической утечки данных не установлено, но риск расшифрования mail/AD/TOTP/паспорт/VCS/SNMP данных реален.

### 3.3. HIGH-03: agent key

- `scan_server/app.py:238-270`, `inventory_server/app.py:120-165`: identity проверяется только если ключ найден в `agent_api_keys`.
- `.env`: `SCAN_SERVER_API_KEYS` и `ITINV_AGENT_API_KEYS` заданы, `SCAN_AGENT_API_KEYS`/`INVENTORY_AGENT_API_KEYS` отсутствуют.
- Владение общим ключом позволяет заявлять чужой `agent_id`/`computer_name`. Код для поэтапной миграции готов, но конфигурация не переведена.

### 3.4. HIGH-05: Web Push

- `chat/push_service.py`: `assert_public_push_endpoint` проверяет HTTPS, userinfo, порт 443, `ip.is_global`; `requests_session.max_redirects = 0`; проверка вызывается при `upsert_subscription` и перед `webpush`.
- Остаток: проверка и отправка — два независимых DNS-резолва. Домен атакующего может вернуть global IP при проверке и private IP при `webpush` (DNS rebinding). Для полного закрытия нужен pinned connection/egress proxy или allowlist провайдеров.

### 3.5. HIGH-07: xlsx regression

- `package.json`: `xlsx` удалён, `xlsx-js-style@1.2.0` остаётся.
- `node -e`: `xlsx-js-style` version 1.2.0, `XLSX.version` 0.18.5.
- `excelPreview.js:77-83`: `await import('xlsx-js-style')` → `XLSX.read`.
- `npm audit` не показывает `xlsx-js-style`, потому что advisory привязан к имени `xlsx`; это слепое пятно SCA.
- Лимиты не устраняют prototype pollution/ReDoS в парсере; тест `excelPreview.test.js` проверяет только обычный workbook.

## 4. Проверки

| Проверка | Результат |
|---|---|
| `pytest tests/test_backend_auth_hardening.py tests/test_e2e_user_management_permissions.py tests/test_e2e_network_json_permissions.py tests/test_agent_key_binding.py tests/test_bot_hub_binding.py` | **79 passed** |
| `pytest tests/test_chat_link_preview_service.py tests/test_chat_push_service.py tests/test_mail_attachment_preview_service.py tests/test_my_files_service.py tests/test_hub_tasks.py` | **197 passed, 1 failed** |
| `pytest tests/test_auth_security_flow.py tests/test_transfer_act_download_recovery.py tests/test_e2e_transfer_act_pdf.py tests/test_chat_ws_session_lifecycle.py` | **86 passed** |
| `pytest tests/test_e2e_user_devices.py::test_forged_token_cannot_borrow_another_users_session tests/test_session_device_limits.py tests/test_ws_auth_lease.py` | **24 passed, 1 skipped** |
| Frontend `vitest` (excelPreview, mailMessageFileActions, mailHtmlContent, MailHtmlBody) | **43 passed** |
| `npm audit --omit=dev` frontend / mobile | 12 / 23 vulns (см. `DEPENDENCY_AUDIT.md`) |
| `pip-audit` по `.venv` | 2 vulnerable packages, 3 advisories |

Единственное падение: `tests/test_hub_tasks.py::test_task_email_outbox_queues_assignment_and_dispatches` — ожидает dict без нового ключа `unknown`, фактический результат содержит `unknown: 0`. Это не security-регрессия и не связано с проверенными исправлениями; тест требует обновления ожидания.

## 5. Что не проверено

- Production runtime и фактический TLS до SQL Server; запросы к SQL/IIS/SMB не выполнялись.
- iOS standalone PWA и Android runtime; HIGH-04 закрыт только по коду и unit-тестам.
- Реальная ротация JWT/`MAIL_CREDENTIALS_KEY`, перешифрование данных, закрытие старых сессий.
- Полный DAST, Semgrep/CodeQL/Gitleaks/OSV-Scanner, динамическая детонация XLSX/PDF/изображений.
- Фактическая конфигурация всех agent-ов и внешних прокси; HIGH-03 требует инвентаризации парка.
- Desktop NuGet audit (restore пишет `obj/`).
- Применение исправлений: backend/bot/scan/inventory не перезапускались, frontend не публиковался.

## 6. Приоритетные действия

1. **Ротация JWT**: заменить `JWT_SECRET_KEYS` на криптостойкие значения, перевести `APP_ENV=production`, закрыть старые сессии; проверить, что `Config.validate()` проходит.
2. **CRIT-02**: сгенерировать новый `MAIL_CREDENTIALS_KEY`, перешифровать зависимые данные с резервной копией и проверкой читаемости; при признаках компрометации сменить пароли/TOTP.
3. **ACL**: убрать `BUILTIN\Users` с `.env`, backup и agent `.env`; инвентаризировать копии; только после закрытия доступа ротировать секреты.
4. **HIGH-03**: выдать per-agent ключи, проверить heartbeat/poll, затем удалить общий ring-key.
5. **HIGH-07**: заменить `xlsx-js-style` на исправленный парсер; не считать лимиты заменой патча.
6. **HIGH-05**: добавить pinned connection/egress allowlist для push; не полагаться на повторный DNS-резолв.
7. **MED-09**: после проверки драйвера/сертификата вернуть `Encrypt=yes`/`TrustServerCertificate=no` и включить production-валидацию.

## 7. Границы вывода

Это повторная проверка **рабочего дерева**, а не production. Исправления в исходниках не означают, что они развёрнуты. Нельзя утверждать, что все находки закрыты: CRIT-02, HIGH-01, HIGH-03, HIGH-05 и HIGH-07 остаются, а CRIT-01 понижен до High только потому, что прямая подделка без сессии действительно закрыта.
