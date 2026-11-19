# HUB-IT — третий проход аудита (многоагентный)

Дата: 2026-11-14. Метод: 8 параллельных read-only агентов по доменам (auth/sessions, API authz, injection/SSRF, файлы, agent-поверхность, chat/WS/voice, секреты/defaults, frontend/mobile/desktop). Production не изменялся; находки сверены с кодом. Дубликаты из `SECURITY_RECHECK.md` исключены.

## Итог

| Severity | Новых | Тема |
|---|---:|---|
| Critical | 1 | Auto-enroll выдаёт bound-ключи предъявителю ring-ключа с чужим agent_id |
| High | 7 | ring-спуфинг, rotate_key caller-payload, mac↔hostname mismatch, task-payload trust, кросс-БД `db_name`, LDAP cleartext, DLP-каталоги Users:M |
| Medium | ~15 | сессионные границы (reset/refresh/WS-device), voice share без owner, файловые DoS/containment, DOM-XSS в редакторе задач, DLP media content_type |
| Low | ~20 | оракулы/формулы/nosniff/политики |

## Critical

### C-1. Auto-enroll: утечка per-agent ключей предъявителю ring-ключа
`scan_server/app.py:267-288`, `scan_server/database.py:2150-2227, 1768-1846, 2276-2337`.
Любой запрос `tasks/poll?agent_id=<чужой>` с валидным ring-ключом: `_check_agent_identity` → `maybe_enroll_agent_keys` → mint_keypair → `create_task("rotate_key", payload={scan_api_key, itinv_api_key})` → та же poll выдаёт payload с plaintext-ключами. Гейт версии не защищает — `scan_agents.version` перезаписывается heartbeat'ом атакующего. Для известных hostname дополнительно mint'ится itinv-ключ.
**Impact:** владелец ring-ключа (лежит в `.env` каждого из 880+ агентов) получает персистентные bound-ключи любого хоста, переживающие удаление ring; может пометить чужую rotate-таску completed и оставить себе единственный ключ.
**Замечание:** свойство введено нами же в auto-enroll (вариант B) — требует ужесточения до удаления ring.

## High

### H-1. Ring-ключ = спуфинг agent_id на всех scan-эндпоинтах
`scan_server/app.py:267-288`, `scan_server/database.py:1768+, 1871+, 2340-2432, 3175-3278`.
Ring-ключ не проверяет claimed `agent_id` (transitional-by-design, зафиксировано тестом): фабрикация агентов/инцидентов на любые hostnames, пометка чужих задач completed/failed (подавление self_update жертвы, re-queue rotate → повторная утечка), резолв чужих инцидентов (сокрытие следов), привязка `scan_task_id` к чужой задаче.
**Вывод:** подтверждает приоритет удаления ring после миграции; смягчается C-1-фиксом.

### H-2. `POST /scan/tasks`: caller-payload для `rotate_key` без пересборки
`scan_server/app.py:1398-1428`, `scan_agent/agent.py:2782-2838`.
Сервер пересобирает payload только для `install_package`/`self_update`; `rotate_key` уходит verbatim. Агент проверяет лишь `len>=32` — происхождение не валидируется. Пользователь с правом `scan.tasks` (роль operator) может навязать агенту произвольные ключи → fleet-wide DoS/перехват канала.
**Fix:** пересобирать rotate-payload из `app.agent_api_keys` (игнорировать ключи в caller-payload).

### H-3. Inventory: bound по `hostname`, ключ записи — `mac_address`
`inventory_runtime.py:696-700, 905-960`, `inventory_store.py:950-1000`, `inventory_server/app.py:232-259`, `api/v1/inventory.py:2896-2906`.
Проверка bound-ключа — только `payload.hostname`; upsert ищет по `mac_address`. Bound-ключ ws-001 + `mac` жертвы → перезапись чужой карточки.
**Fix:** привязать mac к enrolled-identity (записывать mac при enroll и проверять пару hostname+mac), либо требовать совпадения mac с уже известной записью этого hostname.

### H-4. `self_update`/`install_package`: URL/SHA из payload задачи
`scan_agent/agent.py:2607-2736, 2870-2960`.
Агент качает MSI по URL из task-payload и сверяет sha256 со значением из того же payload; принимает `file://` UNC и локальные пути; установка через `powershell -ExecutionPolicy Bypass`. Web-API путь пересобирает payload из серверного манифеста — остаточная граница: writer в `scan_tasks` (или баг вставки) = RCE на всех агентах.
**Fix:** подпись задач сервером (HMAC по canonical payload, ключ только на сервере) либо агент принимает URL/SHA только из `/agent-package` по фиксированному источнику.

### H-5. Кросс-БД доступ через невалидированный `db_name` в json_operations
`api/v1/json_operations.py:118-859` (все GET/POST transfers/works).
`db_name` принимается сырым из query/body, не проходит `get_request_scoped_database_id`/`normalize_database_id` и не сверяется с `assigned_database` (для не-админа фиксируется). Чтение: `db_name=None` → записи всех БД. Запись: `_update_sql_descr_with_note` → `get_db(db_name)` → `UPDATE ITEMS SET DESCR` — обход IT-owner `_ensure_item_in_scope`.
**Impact:** пользователь с PERM_DATABASE_* читает историю работ/перемещений чужих БД и пишет `DESCR` в `ITEMS` любой настроенной `DB_{id}_*` (включая read-only).
**Fix:** заменить raw-параметр на `Depends(get_request_scoped_database_id)` во всех эндпоинтах (как уже сделано в statistics-эндпоинтах того же файла) + scope-проверка equipment_id.

### H-6. LDAP simple-bind в открытом виде — ни одного TLS во всех LDAP-путях
`services/user_service.py:814-816`, `ad_users_service.py:196-211`, `ad_sync_service.py:23+`, `ad_app_user_import_service.py:241+`.
`ldap3.Server(...)` без `use_ssl`/start_tls; фоновые sync-петли включены по умолчанию (`LDAP_SYNC_BACKGROUND_ENABLED=1` и т.д., `main.py:77-79`).
**Impact:** доменный пароль при каждом ldap-логине и креды `LDAP_SYNC_*` при каждом цикле идут сетью открытым текстом.
**Fix:** `use_ssl=True` (636) или `start_tls()`; гейт на проде как для SQL TLS.

### H-7. `BUILTIN\Users:(OI)(CI)M` на DLP-каталогах проб + конфликт с ACL `Agent\.env`
`agent/scripts/install_{telegram,max,browser}_probe_task.ps1` — `icacls *S-1-5-32-545:(OI)(CI)M` на `C:\ProgramData\HUB-IT\{TelegramProbe,MaxProbe,BrowserProbe}` (chats/*.jsonl, media, screenshots, state). Любой локальный пользователь читает чужие перехваченные данные и **подкладывает** файлы/строки, которые уходят на хаб как подлинные. Пробы читают `Agent\.env` от имени интерактивного пользователя — на хостах, где ACL `.env` ограничит Users, пробы сломаются (на сервере задачи под SYSTEM/Admin — без регресса).
**Fix:** ACL по принципу least-privilege на probe-каталоги (SYSTEM+Admin+владелец-сессия) и/или per-user подкаталоги; серверный приём DLP-media — проверка целостности/подписи бандла.

## Medium

### Auth/сессии
- **M-1.** Сброс пароля админом не закрывает сессии/refresh пользователя (`auth.py:2414-2424` — только `revoke_all_user_credentials`; `close_user_sessions` только при `is_active=False`). Self change-password сессии закрывает — поведение непоследовательное. Сессии атакующего живут до expiry.
- **M-2.** Отзыв `mobile-biometric:*` креденшела не закрывает выданные сессии (`trusted_device_service.py:288-291` возвращает True для не-`trusted:` device_id; `revoke_device`/`DELETE /mobile-biometric` сессий не трогают).
- **M-3.** `/refresh` и WS-ревалидация никогда не перепроверяют `is_token_device_valid` — отозванное trusted-устройство: REST умирает, открытый chat-WS живёт всю сессию (`auth.py:1540-1573`, `deps.py:302-330`, `ws_auth.py:90-163`).
- **M-4.** `POST /auth/safari-password-beacon` + `/login/save-password` — неаутентифицированный оракул пароля без rate-limit (`auth.py:749-787`; challenge_id в логах и `?resume_challenge=` URL).
- **M-5.** Локаут/рейт-лимит логина по ключу `(IP, username)` — обход распределённым брутфорсом и password-spray с одного IP (`auth.py:176-179, 656-670`). Нужен per-account и per-IP счётчик.
- **M-6.** Refresh grace отдаёт НОВУЮ пару предъявителю старого jti в 15-с окне; reuse старого refresh не помечает family скомпрометированной (`auth.py:1503-1521`, `auth_runtime_store_service.py:513-592`). Осознанный trade-off для параллельных клиентов — зафиксировать/добавить kill-on-post-grace-reuse.

### Voice
- **M-7.** `POST /voice/meetings/{id}/share` и все GET-эндпоинты совещаний — только `PERM_VOICE_READ`, без проверки `created_by`/владения; публичная ссылка `token_urlsafe(24)` TTL ≤720ч открывает запись без аутентификации (`voice_server/app.py:637-646, 479-1132`, `store.py:286-336`). Любой `voice.read` читает и публикует любую запись.

### Файлы
- **M-8.** KB-attachments: `upload.file.read()` целиком в память без лимита (`kb_service.py:592-599`) — единственный upload-путь без `read_upload_limited`.
- **M-9.** `gzip.decompress` без лимита при отдаче чат-вложения с magic `\x1f\x8b` (`attachment_media.py:394-419`) — zip-bomb на запрос чтения.
- **M-10.** DLP probe-media отдаётся с agent-supplied `content_type` inline без nosniff (`fs_egress.py:321-337, 399-415, 441-456`) — stored XSS в браузере DLP-админа.
- **M-11.** Акты оборудования: `FileResponse` по `FILES.FILE_PATH` из legacy-БД без containment (включая `file://`→UNC) (`equipment.py:3554-3569`) — чтение произвольных файлов при контроле над строкой БД.
- **M-12.** Те же акты: inline-отдача байтов с `content_type` из БД (`equipment.py:3575-3595`) — stored XSS.
- **M-13.** `openpyxl.load_workbook` на пользовательских XLSX без лимита распаковки (`tickets_import_service.py:298-300`, `network_service.py:2175, 4120, 4335`; аналог `ai_chat/document_extractors.py`) — zip-bomb DoS.
- **M-14.** `my_files_service.py:2819-2827`: legacy-ветка принимает absolute/UNC `storage_path` без containment.
- **M-15.** `hub_service.py:6758, 6779, 6949, 9747`: `(data_dir / file_path).resolve()` без `relative_to` на чтении вложений.

### Agent/inventory
- **M-16.** Attacker-controlled `persisted_timestamp`/`last_seen` из payload «замораживает» карточку хоста и вечный online (`inventory_runtime.py:927-955`, `inventory_store.py:963-971`); heartbeat мерджит произвольные поля; dedupe_key предсказуем.
- **M-17.** Ring-ключ: read/write DLP-данных любого `computer_name` на 8012 и 8001 (`_scope_computer_name` → early return для ring) — транзитный риск до удаления ring.

### Frontend
- **M-18.** DOM-XSS: `markdownToEditorHtml` вставляет `safeHref` в `innerHTML` без экранирования кавычек — `[x](https://a"onmouseover=...)` инъецирует обработчик; sink `MobileCreateDescriptionEditor.jsx:30` (`taskRichText.js:15-18`). Доставка — share/paste-сценарий.
- **M-19.** Fernet strict-проверка только для `PASSWORD_VAULT_KEY`; `encrypt_secret`/`MY_FILES_SHARE_TOKEN_KEY`/`DOCFLOW_CREDENTIALS_KEY` — `strict=False` → passphrase молча деривится через SHA-256 даже в production (`secret_crypto_service.py:60-65, 180-242`).

## Low (сводно)

- **Auth:** timing-оракул username/auth_source на login; OIDC state не привязан к браузеру (login CSRF, internal-зона); `Math.random` в client device id (mobile); парольная политика min_length=6.
- **Files:** tickets `storage_path` без containment; фото оборудования — доверие заявленному MIME, inline без nosniff; AV помечает запароленные архивы «clean» (политика); docflow `?disposition=inline` + внешний content_type; CSV/Excel formula injection (task analytics export, portal users CSV, equipment CSV); office-callback fetch event.url — потенциальный SSRF; отсутствие nosniff/CSP на части download-роутов; Pillow без явной bomb-обработки на аватарах.
- **Infra:** `/request-metrics/local*` без auth при loopback (чтение/reset метрик локальным процессом); voice/scan серверы доверяют левому XFF → проброс в `/auth/me` (локальный обход admin IP-allowlist, подделка audit-IP); GeoIP lookup по открытому HTTP стороннему сервису с клиентскими IP (включён по умолчанию).
- **Chat:** `mark_notification_read` без recipient-фильтра; FCM-token переназначается владельцу + хранится открытым текстом; `watch_presence` принимает произвольные user_ids; agent HTML-отчёт отдаётся verbatim на 8012.
- **Frontend/mobile:** drawio postMessage `'*'` fallback; профиль+уведомления в localStorage; regex-санитайзер mail HTML в WebView (сдержано CSP `script-src 'none'`); push-диагностика шлёт URL вкладок; нет cert pinning; WebView2 password autofill.
- **Agent:** stored XSS в агентском HTML-отчёте на 8012 (loopback); XFF-спуфинг в `/auth/me` (косметика).

## Подтверждено чистым

JWT (пин HS256, session_id+jti-ревокация, owner-binding сессии), refresh-атомарность, backup-коды/TOTP/WebAuthn, cookies (HttpOnly/SameSite=strict/Secure-гейт), WS-авторизация (Bearer-заголовок, не query; lease+watchdog), chat membership/eviction/dedup/fanout, LiveKit (member-gated, identity=user_id), push-доставка только на устройства получателя, DOMPurify/rehype-sanitize пути, mobile SecureStore/logout-wipe, desktop navigation policy, chat-uploads/my_files containment, mail preview лимиты, ai_sandbox изоляция, LDAP `escape_filter_chars`, все SQL — bound-параметры, subprocess без shell, AD FS/TLS-проверки исходящих соединений.

## Рекомендуемый порядок исправлений

1. **C-1 + H-2 (auto-enroll/rotate)**: пересборка rotate-payload из БД; IP-pinning enrollment→delivery или доставка только после подтверждения bound-ключа (re-mint при contested); метрика аномалий.
2. **H-5 (json_operations `db_name`)**: перевести на `get_request_scoped_database_id` + scope-проверки — изолированная правка, высокий эффект.
3. **H-6 (LDAP TLS)**: `use_ssl`/start_tls — требует проверки DC-сертификата.
4. **H-3 (inventory mac↔hostname)**: привязка пары при enroll.
5. **M-1/M-2/M-3 (сессионные границы)**: закрытие сессий при admin-reset и отзыве устройства; device-check в refresh/WS-revalidate.
6. **M-7 (voice)**: owner/manage-скоуп для share и GET-эндпоинтов.
7. Файловая пачка (M-8…M-15): лимиты/контейнмент/nosniff — шаблонные правки.
8. H-4 (подпись задач) и H-7 (probe ACL) — после стабилизации флота.
9. Финал HIGH-03: удаление ring после полной миграции + выключение авто-rotate канала.

Открытые из прошлых проходов: HIGH-05 (push DNS-rebinding), HIGH-07 (`xlsx-js-style` SheetJS 0.18.5), MED-08 (deps), MED-09 (SQL TLS), остаток CRIT-01 (`APP_ENV=development` — blast-radius: `antivirus_enabled=False`, JSON-runtime fallback, non-strict Fernet derivation).
