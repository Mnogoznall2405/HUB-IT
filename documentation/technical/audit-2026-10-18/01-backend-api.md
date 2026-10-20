# Аудит WEB-itinvent/backend/api, main.py, rate_limit.py, runtime_role.py (read-only)

Область: `backend/api/**` (все роутеры, включая `chat/`), `backend/main.py`, `backend/rate_limit.py`, `backend/runtime_role.py`. Для проверки auth/permission при необходимости читались `api/deps.py`, `utils/request_network.py`, `utils/rate_limit_guard.py`, `frontend/public/web.config`, `scripts/pm2/ecosystem.backend.config.js`.

Методика и ограничения:
- Находки проверены чтением строк и grep в рабочем дереве (номера строк соответствуют текущему состоянию файлов). Отдельно перепроверены: IIS-правила `web.config` (`HTTP_X_FORWARDED_FOR`, `maxAllowedContentLength`), список `await file.read()`, счётчики блокирующих вызовов по файлам, `chat_main.py:217-218`, PM2-флаги, `rate_limit_storage_url`.
- Инструменты: Grep/Read и Node.js-скрипты в scratchpad (обход декораторов маршрутов, поиск блокирующих вызовов в async, дубли method+path и затенение маршрутов). Python в окружении не запускается (интерпретатор повреждён), поэтому pyflakes/ruff не запускались; проверка неиспользуемых импортов автоматикой не дала надёжного результата и в отчёт не вынесена.
- Тесты и сборка не запускались (read-only). Дубликатов method+path среди роутеров не найдено; затенения параметризованными маршрутами не найдено.
- Счётчики: B=17, C=6, D=9, O=7, X=6, итого 45. Часть пунктов (X2, X3 повторяют B4, B5, B16; X1 пересекается с C2; D3 повторяет C4) является перекрёстными ссылками, а не независимыми находками.

---

## Bugs

### B1. Неаутентифицированный эндпоинт с данными инвентаря
- **Где:** `api/v1/inventory.py:2333-2381` (`GET /api/v1/inventory/changes`, функция `get_inventory_changes`, сигнатура без `Depends`); роутер без dependencies (`inventory.py:33`), подключение в `main.py:584` без dependencies.
- **Суть:** эндпоинт возвращает `hostname`, `mac_address`, `change_types`, `diff`, `before/after_signature` за 30 дней по всем ПК. Фронт (`frontend/src/api/equipmentComputers.js:100`) шлёт Bearer, но сервер токен не проверяет.
- **Сценарий:** IIS проксирует весь `^api/(.*)` на `127.0.0.1:8001` (`frontend/public/web.config:125-133`); любой клиент без логина вызывает `/api/v1/inventory/changes?limit=200` и получает журнал изменений парка.
- **Severity:** high. **Confidence:** high.

### B2. Lost update и случайное удаление записей ВМ-терминалов (VCS)
- **Где:** `api/v1/vcs.py:105-133` (`_save_all_computers`, удаление строк, которых нет в переданном списке: строки 128-130), `vcs.py:308-330` (create, save на 326), `vcs.py:332-355` (update, save на 351), `vcs.py:358-372` (delete, save на 370).
- **Суть:** create/update/delete читают весь список, меняют его в памяти и перезаписывают таблицу целиком. Любая строка, отсутствующая в снимке, удаляется. Блокировки и version-check нет.
- **Сценарий:** админ A и админ B читают `[X,Y]`. A создаёт Z и сохраняет `[X,Y,Z]`. B удаляет Y и сохраняет `[X]` по старому снимку; Z удаляется молча.
- **Severity:** high. **Confidence:** high.

### B3. Массовая рассылка акта по произвольному списку получателей
- **Где:** `models/equipment.py:591` (`owner_nos: List[int]` без max_length; `subject`/`body` без лимита), `api/v1/equipment.py:2952` (`send_uploaded_act_email`, права `PERM_DATABASE_WRITE`), `equipment.py:3037` (цикл по `owner_nos` с `run_in_threadpool` на каждого), `equipment.py:3080` (таймаут из env), `equipment.py:3131` (`asyncio.gather` по всем `deduped_recipients` без ограничения параллелизма).
- **Сценарий:** пользователь с правом записи шлёт `owner_nos` из 5000 значений. Сервер делает 5000 последовательных DB-вызовов и затем 5000 параллельных SMTP-отправок с PDF-вложением. Это DoS на SMTP и пул потоков и спам сотрудникам.
- **Severity:** high. **Confidence:** high.

### B4. Отладочная запись в файл на каждый запрос входа (Safari beacon)
- **Где:** `api/v1/auth.py:768-806`: два блока `# #region agent log` в `handle_safari_password_beacon_form` (вызывается из `main.py:559-562` и `auth.py:815-817`). Файл `debug-891634.log` в корне `WEB-itinvent`, без env-флага.
- **Суть:** синхронный `open(..., "a")` и `json.dumps` в async-обработчике на каждую попытку. В файл пишутся `usernameLength`, `path`, `hasChallenge`, `continuePath`, hypothesisId. Файлы отладки лежат в дереве репозитория.
- **Severity:** medium. **Confidence:** high.

### B5. Отладочный релей клиентских логов с захардкоженным гейтом
- **Где:** `api/v1/debug_client_log.py:18-21` (`DEBUG_CLIENT_LOG_ENABLED`, `_ALLOWED_SESSION` по умолчанию `"20cb37"`, путь `debug-{session}.log` в корне репозитория), `:38-66` (`ingest_client_log`: единственная проверка — заголовок `X-Debug-Session-Id` равен дефолтному значению; `payload.data` — неограниченный dict; синхронная запись в файл на строках 60-63 внутри `async def`).
- **Суть:** при включении флага любой, кто знает константу из репозитория, пишет произвольный JSON в файл на сервере. Prod-конфиги `scripts/pm2/ecosystem.backend.config.js:50,122,202,236,272,349` ставят `'0'`, поэтому риск условный.
- **Severity:** medium. **Confidence:** high.

### B6. Неаутентифицированные метрики и сброс метрик, открытые флагом в проде
- **Где:** `api/v1/system.py:23-29` (`_env_flag("REQUEST_METRICS_LOCALHOST_OPEN")`), `system.py:30-36` (`_is_loopback_client` по сырому `request.client.host`), `system.py:61-69` (`GET /request-metrics/local`), `system.py:72-77` (`POST /request-metrics/local/reset`, меняет состояние). В prod PM2 флаг включён: `scripts/pm2/ecosystem.backend.config.js:45` и `:115`.
- **Суть:** защита держится на том, что uvicorn подменяет `request.client` значением из `X-Forwarded-For` (proxy-headers по умолчанию). Остальные места используют `build_request_network_context` (trusted proxy). Если proxy-headers выключат или поменяют `forwarded_allow_ips`, все запросы через IIS будут выглядеть как loopback, и любой внешний клиент получит метрики и сможет их сбросить.
- **Severity:** medium. **Confidence:** medium (зависит от запуска uvicorn, в репозитории флаги proxy_headers явно не заданы).

### B7. Upload: `await file.read()` без лимита грузит всё тело в память
- **Где (чтение до проверки или без лимита):**
  - `api/v1/auth.py:2425-2427` (аватар: `raw = await file.read()`, проверка 2 MB после чтения);
  - `api/v1/tickets.py:558` (вложение заявки, лимит только в сервисе), `tickets.py:802` (импорт xlsx, лимит 50 MB после чтения);
  - `api/v1/hub.py:602, 866, 1149, 1907, 1947` (вложения объявлений, отчёты, файлы задач);
  - `api/v1/equipment.py:2811-2819` (акт, проверка после чтения), `equipment.py:3762` (фото без лимита до чтения);
  - `api/v1/mail.py:110, 133, 2197` (вложения почты);
  - `api/v1/networks.py:443, 465, 607, 610, 771` (шаблоны, Excel, карты).
- **Механизм:** Starlette/FastAPI уже сохраняет multipart на диск через SpooledTemporaryFile (порог ~1 MB) до вызова обработчика, поэтому сам приём тела не грузит память. Всплеск памяти создаёт безлимитный `await file.read()`, который собирает весь файл в `bytes`, а проверка размера идёт уже после этого.
- **Сценарий:** IIS разрешает тело до `maxAllowedContentLength="4294967295"` (`frontend/public/web.config:14`, около 4 GB на запрос). Один запрос с файлом в сотни МБ от пользователя с нужным правом даёт копию этого размера в памяти процесса; параллельные запросы умножают эффект.
- **Severity:** medium. **Confidence:** high.

### B8. Импорт снимков почтовых квот: JSON-тело парсится до проверки ключа
- **Где:** `api/v1/mailbox_quota.py:62-72` (параметр `payload: MailboxQuotaSnapshotImport` парсится FastAPI до вызова функции; ключ `x_api_key` проверяется внутри, строки 67-72), `:76` (лимит 10000 строк после парсинга), `:79-81` (оценка размера `len(rows)*512` вместо реального размера тела).
- **Сценарий:** неавторизованный клиент отправляет JSON-тело до 4 GB (ограничение IIS, см. B7), которое FastAPI полностью читает и парсит до ответа 401. Это дешёвая DoS-поверхность без аутентификации.
- **Severity:** medium. **Confidence:** medium.

### B9. Фрагмент секретного ключа пишется в логи; внутренние тексты ошибок в ответе
- **Где:** `api/v1/mailbox_quota.py:27-33` (`_api_key_fingerprint` пишет первые 4 и последние 4 символа ключа), `:68-71` (лог при отказе); `:88-89` (`detail=str(exc)` для любой ошибки импорта).
- **Сравнение:** `api/v1/inventory.py:334-339` использует SHA-256-отпечаток, то есть правильный подход. Расхождение внутри одного API.
- **Severity:** medium. **Confidence:** high.

### B10. Доверие к левому элементу X-Forwarded-For
- **Где:** `utils/request_network.py:119-127` (берётся первый элемент `x-forwarded-for`, если пир входит в `trusted_proxy_cidrs`, по умолчанию `127.0.0.1/32`, `::1/128`, `config.py:343-344`); далее `classify_network_zone` (`request_network.py:92-95`, `config.py:341-342` для `10.0.0.0/8`); использование зоны в `auth.py:601-607` (обход лимитов для внутренней зоны) и `is_twofa_required_for_zone`.
- **Сейчас:** IIS перезаписывает серверную переменную `HTTP_X_FORWARDED_FOR` значением `{REMOTE_ADDR}` (`frontend/public/web.config:54,68,80,92,104`), поэтому эксплуатация через IIS не проходит.
- **Риск:** при любом пути к бэкенду с loopback-пира (локальный процесс, изменённые правила IIS) клиент сам задаёт `X-Forwarded-For: 10.x.x.x` и получает зону `internal`: обходит rate limit входа и политику 2FA для внутренней зоны. Правильнее брать самый правый адрес, не принадлежащий доверенному прокси.
- **Severity:** medium (условный). **Confidence:** medium.

### B11. Блокирующий I/O в async-обработчиках (системно)
- **Масштаб:** после проверки шаблоном (`asyncblock.tsv` → `asyncblock_verified.tsv`) найдено 243 вызова сервисов/стора без `run_in_threadpool`/`to_thread` внутри `async def` в 15 файлах: `auth.py` (64), `networks.py` (38), `hub.py` (38), `tickets.py` (37), `kb.py` (16), `departments.py` (12), `settings.py` (10), `json_operations.py` (9), `equipment.py` (4), `system.py` (4), `ai_bots.py` (4), `vcs.py` (2), `my_files.py` (2), `mail.py` (2), `database.py` (1).
- **Примеры:**
  - `auth.py:1181` `user_service.change_password` → PBKDF2 с 120 000 итерациями (`services/user_service.py:76`, `_hash_password` на 436) выполняется прямо в event loop;
  - `networks.py:174` `network_service.list_branches`, `networks.py:575` `export_map_pdf`, `networks.py:619` `import_network_data` (разбор Excel), `networks.py:771-773` `upload_map`;
  - `tickets.py:305-319` (все обработчики заявок вызывают `tickets_service` синхронно, `run_in_threadpool` в файле используется один раз, строка 697);
  - `kb.py:59-64`, `departments.py:86` `sync_departments_from_users` → `user_service.list_users()` целиком;
  - `hub.py:1679-1701` `transfer_act_reminder_service.enrich_tasks`; `fs_egress.py:47-48` и аналоги (store-вызовы в async);
  - `json_operations.py:871-1042` (`cartridge_db.*`, JSON-файл).
- **Сценарий:** один тяжёлый запрос (экспорт PDF, импорт Excel, хэширование пароля) останавливает event loop и все WebSocket/чат-соединения процесса.
- **Severity:** high. **Confidence:** high (паттерн), medium (точная длительность по эндпоинтам).

### B12. Некорректный тип входа в create_task даёт 500 вместо 400
- **Где:** `api/v1/hub.py:1562` `create_task`; `hub.py:1570-1573` `int(item)` в try, но `hub.py:1579-1584` `int(single_assignee)`, `hub.py:1567` `int(controller_raw)` вне try; `except` в конце функции ловит только `ValueError`.
- **Сценарий:** `"assignee_user_id": [1]` или `{}` вызывает `TypeError`, который не перехвачен → общий 500.
- **Severity:** low. **Confidence:** high.

### B13. Мутирующие эндпоинты задач защищены правом чтения
- **Где:** `api/v1/hub.py:1785` (PATCH `/tasks/{id}`), `:1809` (DELETE), `:1830` (start), `:1858` (reopen), `:1894` (submit), `:1973` (review), `:2000-2004` (complete), `:2211` (discussion), `:2253` (comments), `:2281` (mark-seen). Все используют `require_permission(PERM_TASKS_READ)`.
- **Суть:** проверка права записи отсутствует на уровне роутера; авторизация отдана сервису. У `complete` `enforce_permission=True` (`hub.py:2008-2014`, `services/hub_service.py:9266-9290`), у остальных проверки в сервисе не подтверждены.
- **Severity:** medium. **Confidence:** medium (нужна проверка сервиса по каждому методу).

### B14. Фото сотрудников доступны без авторизации
- **Где:** `api/v1/address_book.py:170-186` (`GET /api/v1/address-book/photos/{code}`, без auth, документировано как «same public-surface class as /avatars»).
- **Суть:** фото по табельному коду; санитайзер кода есть (`services/employee_photo_service.py:41`), но перечисление кодов не ограничено.
- **Severity:** medium. **Confidence:** medium.

### B15. Ingest агентов: тело без лимита размера и синхронный стор
- **Где:** `api/v1/fs_egress.py:40-49`, `:66-75`, `:121-130`, `:165-175` (`await request.json()` без ограничения размера; ключ проверяется до чтения, это правильно). `store.ingest_*` (`fs_egress.py:47-48` и аналоги) вызывается синхронно в async (`services/fs_egress_store_service.py:78-79`, `get_egress_store()`).
- **Сценарий:** тело читается только после проверки API-ключа агента, поэтому атака возможна только с валидным ключом или при утечке ключа. Лимит IIS (см. B7) остаётся единственным верхним ограничением.
- **Severity:** low. **Confidence:** medium (блокировка зависит от реализации стора).

### B16. Раскрытие серверного пути через отладочный эндпоинт аватара
- **Где:** `api/v1/auth.py:2493-2510` (`GET /me/avatar/debug`, `"avatars_dir": str(avatars_dir)` на строке 2508, доступен любому активному пользователю).
- **Severity:** low. **Confidence:** high.

### B17. Фоновая задача без сохранённой ссылки
- **Где:** `main.py:332` (`asyncio.create_task(_chat_event_loop_lag_probe(), name=...)` без присваивания).
- **Суть:** asyncio не держит сильной ссылки; задачу может собрать GC, и датчик лага молча остановится.
- **Severity:** low. **Confidence:** medium.

---

## Conflicts

### C1. Два определения «внутренней» сети
- **Где:** `rate_limit.py:11-16` (`INTERNAL_NETWORKS`: 10/8, 172.16/12, 192.168/16, 127/8) и `rate_limit.py:18-27` (`_is_internal_ip`, флаг `skip_rate_limit`); против `config.py:341-342` (`twofa_internal_cidrs` по умолчанию только `10.0.0.0/8`), `utils/request_network.py:92-95` и `auth.py:601-607`.
- **Суть:** для одного и того же адреса 192.168.x.x middleware считает клиента внутренним (обход), а зона для лимитов и 2FA — внешней.
- **Severity:** medium. **Confidence:** high.

### C2. Настройка RATE_LIMIT_STORAGE_URL не влияет на реальные лимиты
- **Где:** `config.py:329, 511` (читается из `RATE_LIMIT_STORAGE_URL`), `main.py:238` (пишет в лог `rate_limit_storage=...` как будто активно), `rate_limit.py:53` (используется только в неиспользуемом slowapi Limiter). Реальные лимиты идут через `auth_runtime_store_service` и `utils/rate_limit_guard.py`.
- **Суть:** оператор, выставивший внешнее хранилище, получает ложное ощущение общих лимитов между процессами.
- **Severity:** medium. **Confidence:** high.

### C3. Два механизма rate limit с разной политикой внутренней сети
- **Где:** `api/v1/auth.py:610-636` (`_enforce_rate_limit`: всегда пропускает внутреннюю зону, без `Retry-After`) и `utils/rate_limit_guard.py:21-82` (`enforce_rate_limit`: параметр `allow_internal_bypass`, `Retry-After`). `my_files_*_rate_limit.py` передают `allow_internal_bypass=False`, auth — всегда пропускает.
- **Severity:** medium. **Confidence:** high.

### C4. Разные правила чтения API-ключей агентов
- **Где:** `api/v1/fs_egress.py:19-37` (`ITINV_AGENT_API_KEYS` + `ITINV_AGENT_API_KEY`, `set()`), `api/v1/inventory.py:342-365` (те же переменные, отдельный парсер, `token in keys`), `api/v1/mailbox_quota.py:36-52` (`MAIL_QUOTA_IMPORT_API_KEYS`/`_KEY`, другой формат логов, см. B9).
- **Суть:** три копии одной логики с разной обработкой и разными логами. Отдельная проверка времени сравнения не делалась (сравнение через `in`, не `hmac.compare_digest`).
- **Severity:** low. **Confidence:** high.

### C5. Разный разбор env-флагов и CORS-списка
- **Где:** `config.py:442` (`AUTH_COOKIE_SECURE` принимает только `"true"`), `api/v1/system.py:20` и другие места (`_env_flag`: `1/true/yes/on`); `config.py:439` (`CORS_ORIGINS.split(",")` без `strip`) против `api/v1/my_files.py:105` (элементы обрезаются `strip()`).
- **Последствие:** значение `"https://a, https://b"` в CORS не совпадает по второму origin, а в my-files совпадает.
- **Severity:** low. **Confidence:** high.

### C6. Две реализации `_has_permission`
- **Где:** `api/v1/hub.py:102-104` (проверка по `user.permissions`), `api/v1/docflow.py:59-65` (`authorization_service.has_permission` с учётом custom permissions).
- **Суть:** возможно расхождение для пользователей с custom permissions. Не подтверждено: нужно проверить, что `User.permissions` в `get_current_user` уже содержит эффективные права.
- **Severity:** low. **Confidence:** low.

---

## Duplication

### D1. `_normalize_text` в пяти модулях
- **Где:** `api/v1/hub.py:90-92`, `mail.py:212-215`, `mfu.py:84-87`, `chat/_common.py:154-156` (идентичны по логике); `inventory.py:426-427` (отличается удалением NUL).
- **Куда свести:** один хелпер в `backend/utils/` (например, `text.py`) с параметром `strip_nul`.
- **Severity:** low. **Confidence:** high.

### D2. Формирование Content-Disposition в пяти местах
- **Где:** `docflow.py:93-97` (`_content_disposition`), `mail.py:217-231` (`_build_content_disposition`), `hub.py:95-100` (`_build_task_preview_content_disposition`), `chat/attachments.py:170-180` (`_build_chat_attachment_content_disposition`), `my_files.py:180-184` (`_content_disposition`). Алгоритм один (ASCII-fallback + RFC 5987 `filename*`), различаются только санитайзеры.
- **Куда свести:** `backend/utils/http_headers.py`. Важно сохранить различия (`mail` и `chat` фильтруют `\r\n` и `"`/`\\`, `my_files` — непечатные символы).
- **Severity:** low. **Confidence:** high.

### D3. Загрузчики API-ключей агентов в трёх файлах
- **Где:** `fs_egress.py:19-37`, `inventory.py:334-365`, `mailbox_quota.py:27-52`. См. C4.
- **Куда свести:** один модуль (например, `backend/utils/agent_api_keys.py`) с парсингом env-списка, сравнением через `hmac.compare_digest` и отпечатком SHA-256.
- **Severity:** low. **Confidence:** high.

### D4. Rate limit: ключи, хэши и проверки внутренней сети продублированы
- **Где:** `my_files_upload_rate_limit.py:11-14` (`_rate_ip_key`) == `my_files_download_grant_rate_limit.py:18-21` == `my_files_public_rate_limit.py:18-21` (`_public_rate_ip_key`); `my_files_download_grant_rate_limit.py:13-15` (`_hash_grant_token`) == `my_files_public_rate_limit.py:13-15` (`_hash_share_token`); `rate_limit.py:18-27`, `auth.py:601-607`, `utils/rate_limit_guard.py:13-18` (проверка внутренней зоны); `auth.py:610-636` и `utils/rate_limit_guard.py:21-82` (два enforce).
- **Куда свести:** `utils/rate_limit_guard.py` (один `client_ip_key(request)`, один `hash_token`, один `request_is_internal`).
- **Severity:** low. **Confidence:** high.

### D5. Копии `_request_meta`, `_service_error_to_http`, `_payload`
- **Где:** `my_files.py:83-88` и `passwords.py:56-61` (`_request_meta` идентичны, различается только тип результата); `my_files.py:110-119` и `passwords.py:78-93` (маппинг исключений в HTTP по одному шаблону); `networks.py:25` и `passwords.py:96` (`_payload`).
- **Куда свести:** общий хелпер `api/_common_mappers.py` (или `api/deps.py`).
- **Severity:** low. **Confidence:** high.

### D6. Request-id и тайминг логов в чате и почте
- **Где:** `chat/_common.py:159-170` (`_request_id_from_headers`, `_log_request_timing`) и `mail.py:303-310`, `mail.py:472-485`.
- **Severity:** low. **Confidence:** medium (тела функций не сравнивались построчно).

### D7. Два почти одинаковых резолвера database id
- **Где:** `api/deps.py:426-446` (`get_current_database_id`) и `deps.py:448-468` (`get_request_scoped_database_id`). Тело одинаковое, отличается `prefer_request_hint=True`.
- **Куда свести:** одна функция с параметром, две тонкие обёртки для `Depends`.
- **Severity:** low. **Confidence:** high.

### D8. Внутри inventory: дубли сохранения событий и SQL-джойна сети
- **Где:** `inventory.py:297-304` (`_save_change_events`, ветка app-store) и `inventory.py:311-316` (`_append_change_events`) — один и тот же цикл `prune` + `append`. SQL сетевого джойна дублируется в `_resolve_network_link` (fallback, около `inventory.py:1325-1345`) и `_load_network_lookup_index` (`inventory.py:1392-1420`), оба с `LIMIT 4000`. Также `_to_int` в `equipment.py:214` (default None) и `inventory.py:412` (default 0) — разные сигнатуры под одним именем.
- **Severity:** low. **Confidence:** high.

### D9. Дубль логики WebSocket-сессий в hub и task-canvas
- **Где:** `api/v1/chat/hub_realtime_ws.py:33-49` (`HUB_REALTIME_*`: revalidate, rate limit, max bytes) и `api/v1/chat/task_canvas_ws.py:28-33` (`TASK_CANVAS_WS_*`: те же параметры по отдельным переменным).
- **Severity:** low. **Confidence:** medium.

---

## Optimization

### O1. Последовательные вызовы 1С в подсказках по складам
- **Где:** `api/v1/warehouse_1c.py:368` (`get_missing_warehouse_hints`), `:397-398` (до 30 кодов), `:450-476` (на каждый код: `search_nomenclature` и до нескольких `get_balances(limit=200)`, все через `await` подряд).
- **Суть:** до 30 × (1 + варианты кода) последовательных HTTP-вызовов в 1С на один запрос, без `asyncio.gather`, без кэша.
- **Severity:** high. **Confidence:** high.

### O2. Инвентарь: полная выборка событий за 30 дней ради `limit`
- **Где:** `api/v1/inventory.py:2334-2381`: `_load_changes` (`:1087-1101`) отдаёт все события окна без SQL-лимита, затем сортировка и агрегация в Python, и только в конце `sorted_changes[: int(limit)]` (`:2377`). Вызов работает без кэша.
- **Severity:** medium. **Confidence:** high.

### O3. Вставка событий инвентаря по одной транзакции
- **Где:** `api/v1/inventory.py:297-304` и `:311-316` вызывают `app_store.append_change_event` на каждое событие; `appdb/inventory_store.py:829-841` открывает `app_session`, делает `session.get` и `commit` на каждое событие.
- **Суть:** N транзакций и N SELECT на один ingest, при том что события уже сортируются и готовы к пакетной вставке.
- **Severity:** medium. **Confidence:** high.

### O4. Сетевой индекс загружается на каждый запрос списка ПК
- **Где:** `inventory.py:2419`, `:2455`, `:2503`, `:2735`, `:2809` вызывают `_load_network_lookup_index` (`:1392-1420`, `LIMIT 4000`, полный проход и построение индекса в Python) на каждый запрос без кэша. При исключении индекс становится `None`, и тогда в цикле `_resolve_network_link` (`inventory.py:2471`, `:2520`, `:2751`) делает SQL с 4000-строчным fallback на каждый уникальный MAC.
- **Severity:** medium. **Confidence:** medium.

### O5. Поиск по инвентарю: отдельный запрос на каждый токен
- **Где:** `api/v1/inventory.py:1894-1896` (`app_store.search_host_keys` в цикле по `tokens`).
- **Severity:** low. **Confidence:** medium.

### O6. Замер пула БД выполняется до проверки аудита
- **Где:** `api/v1/chat/_common.py:754-770` (`get_chat_engine()`, `pool.checkedout()` и т.д. вычисляются при `took_ms >= 200` или нужном маршруте до `audit_send_trace`, который сам проверяет `audit_enabled()`).
- **Severity:** low. **Confidence:** high.

### O7. Синхронизация отделов грузит всех пользователей
- **Где:** `api/v1/departments.py:83-87` (`user_service.list_users()` целиком, в async, без пагинации).
- **Severity:** low. **Confidence:** medium.

---

## Dead code

### X1. Мёртвый стек slowapi и лишний middleware на каждом запросе
- **Где:** `rate_limit.py:45-68` (создаётся `Limiter`, ни один маршрут не использует `@limiter.limit`; `SlowAPIMiddleware` отключён, `main.py:470-471`); `rate_limit.py:36-42` (`InternalIPBypassMiddleware`, `BaseHTTPMiddleware`, пишет флаг, который читает только мёртвый `_smart_key_func`); подключение `main.py:451-452` и `chat_main.py:217-218` (проверено grep).
- **Эффект:** каждый HTTP-запрос проходит через `BaseHTTPMiddleware` и `build_request_network_context` без пользы. См. также C2.
- **Severity:** medium. **Confidence:** high.

### X2. Оставленные отладочные блоки «agent log»
- **Где:** `api/v1/auth.py:768-806` (см. B4), `api/v1/chat/_common.py:193-210`, `:754-786`, `api/v1/chat/ws.py:395-409`; модуль `api/v1/debug_client_log.py` целиком (см. B5). Блоки в chat гейтятся `audit_enabled`, но сам маркер в коде — остаток сессионной отладки (сессии 891634, 20cb37).
- **Рекомендация:** удалить после закрытия сессий отладки.
- **Severity:** low (кроме auth.py — medium, см. B4). **Confidence:** high.

### X3. Отладочный эндпоинт аватара
- **Где:** `api/v1/auth.py:2493-2510` (см. B16). Удалить.
- **Severity:** low. **Confidence:** high.

### X4. Алиасы-обёртки в rate limit для публичных файлов
- **Где:** `api/v1/my_files_public_rate_limit.py:48-54` (`enforce_public_preview_limits` и `enforce_public_preview_content_limits` только пересылают вызов).
- **Severity:** low. **Confidence:** high.

### X5. Неиспользуемые функции и реэкспорт
- **Где:** `runtime_role.py:34-35` (`is_api_process` — нигде не вызывается, проверено чтением файла); `api/v1/chat/__init__.py` (`__all__` содержит `run_in_threadpool`, реэкспорт без потребителей — проверить по grep перед удалением).
- **Severity:** low. **Confidence:** medium.

### X6. Повторные локальные импорты
- **Где:** `api/v1/auth.py` — `import os` внутри `debug_my_avatar` (2495) и `get_user_avatar` (≈2517), `import time` внутри `_process_and_save` (≈2433) при наличии импорта на уровне модуля.
- **Severity:** low. **Confidence:** high.

---

## Итог по приоритету

1. Критично по безопасности: B1 (открытый `/inventory/changes`), B3 (массовая рассылка акта), B2 (потеря данных VCS).
2. Производительность и устойчивость: B11 (блокировка event loop, системно), O1 (N×1С-запросов), B7 (безлимитный `read()` upload, до ~4 GB на запрос).
3. Конфигурация и проверка доверия: B6 (метрики открыты флагом в проде), B10 (X-Forwarded-For), C1/C2 (расхождение «внутренней» сети и мёртвая настройка rate limit).
