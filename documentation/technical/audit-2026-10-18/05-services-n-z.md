# Аудит WEB-itinvent/backend/services — файлы n..z

Режим: read-only. Репозиторий не менялся, серверы, сборки, миграции, SQL и pm2 не запускались. Проверено чтением кода и grep по importers.

Область: `network_*` (включая новые untracked `network_monitor_*`), `notification_preferences_service`, `one_c_*`, `password_vault_service`, `portal_user_export_service`, `request_*`, `russian_settlements_service`, `secret_crypto_service`, `security_email_service`, `session_*`, `settings_service`, `sql_*`, `task_*`, `tickets_*`, `transfer_*`, `trusted_device_service`, `twofa_service`, `user_*`, `warehouse_1c_*`, `zup_user_profile_service`, `native_push_service`. Подпакетов в services нет.

Условные обозначения: severity = critical/high/medium/low, confidence = high/medium/low. Ссылки на `api/v1/*` приведены как доказательство вызова, сами файлы вне области.

---

## Bugs

### B1. Lost update: touch_session перезаписывает terminate/logout (session_service.py:742-764, 874-882, 894-904)
`touch_session` читает `AppSessionRecord` без блокировки (`session.get`, строка 744), вычисляет `item` со статусом `active` и вызывает `_apply_session_payload(row, item)` (762), который перезаписывает `is_active`, `status`, `closed_at`, `closed_reason` значениями из снимка. Если параллельно `close_session` / `close_session_by_id` уже закоммитил `terminated`, UPDATE из touch откатит его обратно: сессия снова `active`, и кэш ставится в `active`.
Сценарий: пользователь нажал «выйти» или админ завершил сессию в тот момент, когда запрос этого же пользователя проходит throttle-окно 60 с и пишет touch.
Severity: high. Confidence: medium (окно гонки узкое; сам паттерн подтверждён кодом).

### B2. close_user_sessions переписывает уже закрытые сессии и завышает счётчик (session_service.py:920-952, 841-868, 933, 947)
`close_user_sessions` берёт все сессии пользователя без фильтра по `is_active`. `_close_session_record` (847-858) безусловно ставит `status`/`closed_reason` = `terminated` и новый `closed_at`, поэтому уже истёкшие (`expired_idle`/`expired_absolute`) сессии теряют исходную причину закрытия. Счётчик `closed += 1` (933, 947) включает их, и возвращаемое число уходит в `sessions_closed` (`services/ad_app_user_import_service.py:555-556`) и в ответ смены пароля.
Severity: medium. Confidence: high.

### B3. purge_inactive_sessions физически удаляет историю сессий, игнорируя retention (session_service.py:1034-1058; api/v1/auth.py:2160-2167)
`cleanup_sessions` удаляет только записи старше `history_retention_days` (960, 999, 986). `purge_inactive_sessions` удаляет каждую неактивную/истёкшую запись сразу (`session.delete(row)`, 1049) без cutoff, без dry-run и без флага. Вызов идёт из `POST /auth/sessions/purge-inactive` (auth.py:2166). Это необратимое удаление аудита входов.
Severity: high. Confidence: high.

### B4. _save_users делает full-sync: удаляет пользователей, которых нет в снимке (user_service.py:193-217, 209-211; вызовы 1229, 1274, 1373, 1411, 1433, 1445)
В app-DB режиме `_save_users` удаляет каждую строку `AppUser`, которой нет в переданном списке (209-211). Список берётся из `_load_users` с кэшем на 60 с (`_users_cache_ttl_sec`, строка 91). Любая запись со снимком, загруженным до создания пользователя в другом процессе, жёстко удаляет этого пользователя. Тот же снимок перезаписывает все поля остальных пользователей старыми значениями (например, откатывает `is_active=False` или смену пароля, сделанные параллельно). Сравните session_service.py:210-213, где авторы явно запрещают такое удаление.
Сценарий: процесс A загрузил список, процесс B создал пользователя X и деактивировал Y, A через 30 с меняет аватар/почту пользователя Z и пишет весь список: X удалён, Y снова активен.
Severity: high. Confidence: medium (нужны параллельные писатели; chat-процессы в `ecosystem.chat.scale.config.js` работают с той же БД, а `mail_service` и `ai_chat` вызывают `user_service.update_user`).

### B5. _load_users возвращает shallow-копию: мутации вызывающих кода попадают в кэш (user_service.py:173, 241; update_user 1277-1384)
`return list(cached[1])` копирует только список, dict-объекты общие с `_users_cache`. `update_user` меняет `user["email"]` и другие поля до того, как `encrypt_secret` для `mailbox_password` бросает `ValueError` (1347-1349). Сохранения не было, но `list_users`, `search_users` и остальные `_load_users`-потребители видят «фантомные» значения до истечения TTL кэша (до 60 с).
Severity: medium. Confidence: high.

### B6. delete_user делает жёсткое удаление пользователя (user_service.py:1436-1460; api/v1/auth.py:2308-2322)
`DELETE /users/{id}` удаляет строку `AppUser` через full-sync (см. B4) и связанные delegate-ссылки. В AGENTS.md прямо сказано: «Deactivate users by default, keeping PK, history and relations». Для пользователей с историей заявок, задач и сообщений удаление либо каскадно стирает историю, либо падает по FK.
Severity: medium. Confidence: high.

### B7. LDAP-bind без receive_timeout (user_service.py:783-785)
`ldap3.Connection(... auto_bind=True)` без `receive_timeout`. Если контроллер домена зависает на bind, поток из threadpool блокируется бесконечно. Вход выполняется через `run_in_threadpool` (api/v1/auth.py, login), поэтому зависший DC исчерпывает пул потоков, а не event loop.
Severity: medium. Confidence: medium.

### B8. Ошибка OAuth-токена FCM отключает push-токены пользователей (native_push_service.py:317-342, 357, 508-511, 430-441)
`_send_fcm_message` вызывает `_get_access_token` (357), который делает `urlopen` на token-endpoint. `HTTPError` оттуда (например, 400 `invalid_grant` из-за неверного ключа или рассинхронизации часов) ловится в `send_notification` веткой `except urllib.error.HTTPError` (508-511). Там `disabled = code in {400, 404}`, и `_mark_failed(disabled=True)` ставит `is_active=False` и `revoked_at` для каждого токена получателя. Сбой конфигурации сервиса превращается в массовое отключение push у всех пользователей.
Severity: high. Confidence: high.

### B9. Статусы задач актов не защищены от перезаписи устаревшим воркером (transfer_act_job_service.py:509-531, 568-594, 597-631; api/v1/equipment.py:361, 423)
`mark_processing`, `mark_done`, `mark_failed` делают безусловный ORM-апдейт без проверки владельца/lease и без условия по статусу. `requeue_stale_processing_job` (339-394) возвращает просроченный job в `queued`, а новый воркер его забирает. Старый воркер при потере lease получает `checkpoint_processing_result = False` (equipment.py:361) → `RuntimeError` → `except Exception` → `mark_failed` (423) перезаписывает статус job, которым уже владеет другой воркер, или уже `done`. Для `claim_for_execution` и `checkpoint_processing_result` условные UPDATE с `rowcount` уже есть, для финальных переходов их нет.
Severity: high. Confidence: medium.

### B10. Дубли писем при нескольких процессах (task_email_outbox_service.py:141-184)
Выборка `pending` и UPDATE в `sending` идут без `FOR UPDATE` и без проверки `rowcount` (154-161). `self._lock` защищает только текущий процесс. Если два процесса одновременно вызывают `dispatch_task_email_outbox`, оба могут получить одни и те же строки. Проигравший UPDATE затрагивает 0 строк, но его `claimed` всё равно отправляется (166-183).
Severity: medium. Confidence: medium.

### B11. Письма навсегда остаются в статусе `sending` после падения (task_email_outbox_service.py:146, 154-162, 186-200)
Выборка берёт только `status='pending'`, а никакого возврата просроченных `sending` в очередь нет (grep по `'sending'` в services: только строка 157). Если процесс упал между commit claim (162) и `_mark_task_email_sent/failed` (177/180), письмо не отправится и не будет переотправлено.
Severity: medium. Confidence: high.

### B12. TOTP-коды можно переиспользовать внутри окна (twofa_service.py:118-126; password_vault_service.py:644)
`verify_totp` при `valid_window=1` принимает один и тот же код до ~90 с. В `twofa_service`, `auth_security_service`, `user_service` и `api/v1/auth.py` нет хранения последнего использованного шага (grep по `replay|last_totp|totp_step|used_totp` пуст). Тот же код работает для входа и для разблокировки хранилища паролей.
Severity: medium. Confidence: medium (поиск ограничен перечисленными файлами).

### B13. Исключения в TOTP-fallback не превращаются в «неверный код» (twofa_service.py:127-147)
`_totp_now` (128) вне `try` бросает `TwoFactorServiceError` при пустом секрете или `binascii.Error` при битом base32. Исключение уходит наверх (500), и в `password_vault_service.unlock` (644) счётчик неудач не инкрементируется, потому что перехватываются только собственные ошибки сервиса.
Severity: low. Confidence: medium.

### B14. Пеппер резервных кодов выведен из JWT-секрета (twofa_service.py:31-33)
`hash_backup_code` использует HMAC с ключом `sha256(config.jwt.secret_key or "itinvent-backup-code-pepper")`. Ротация JWT-ключа делает все сохранённые резервные коды недействительными, и пользователи теряют восстановление 2FA. При пустом секрете пеппер становится публичной константой.
Severity: medium. Confidence: high.

### B15. Секреты TOTP шифруются ключом почты и без строгой проверки (twofa_service.py:72-76; secret_crypto_service.py:67-68, 79-84, 129-130)
`TwoFactorService.encrypt_secret` вызывает `encrypt_secret()`, который использует `MAIL_CREDENTIALS_KEY` с `strict=False`, то есть passphrase принимается и в production. Пароль хранилища шифруется с `strict=True` (130). Поэтому смена или потеря ключа почты ломает все 2FA-секреты, а ключ домена почты используется для другого домена.
Severity: medium. Confidence: high.

### B16. Гонка при подтверждении настройки 2FA хранилища (password_vault_service.py:706-732)
Челлендж читается через `get_json` (707) и удаляется отдельно (723). Два параллельных подтверждения с одним кодом пройдут проверку, оба вызовут `update_user` и `_replace_backup_codes` (732). Второй вызов инвалидирует резервные коды, которые уже вернул первому. Для атомарного взятия есть `auth_runtime_store_service.pop_json` (строка 285), который использует `consume_once`.
Severity: medium. Confidence: high.

### B17. Rate limit разблокировки хранилища проверяется до операции, а не атомарно (password_vault_service.py:631, 652)
`_check_unlock_rate_limit` (631) читает счётчик, а `_record_unlock_failure` (652) пишет после дорогой проверки. N параллельных попыток проходят проверку до того, как какая-либо неудача записана, поэтому лимит 5/300 с обходится.
Severity: low. Confidence: medium.

### B18. Разблокировка действует на все сессии пользователя (password_vault_service.py:139-144, 592-619, 801-817)
`_grant_unlock` всегда пишет и сессионный ключ, и пользовательский `"{user_id}:user"` (610). `get_unlocked_until` берёт максимум по обоим ключам. Итог: разблокировка в одной браузерной сессии открывает хранилище во всех сессиях пользователя на 300 с, и `session_id` не даёт реальной изоляции. Если это намеренно, это нужно зафиксировать в документации.
Severity: medium. Confidence: medium.

### B19. Отзыв устройства очищает кэш до коммита (trusted_device_service.py:163-175)
В `revoke_device` `self._device_valid.clear()` (174) выполняется внутри `with app_session`, то есть до коммита. Параллельный `is_token_device_valid` (287-300) может прочитать ещё активную строку и закешировать «валидно» на TTL. В `revoke_all_user_devices` (177-192) очистка сделана после блока, и там этой проблемы нет.
Severity: medium. Confidence: medium.

### B20. update_sign_count без compare-and-set (trusted_device_service.py:209-222)
Счётчик перезаписывается безусловно (220). Параллельные WebAuthn-подтверждения могут записать меньший счётчик поверх большего. Проверка клонирования (`credential_current_sign_count` в 443-452) опирается на то, что значение монотонно растёт.
Severity: low. Confidence: medium.

### B21. Все ошибки SNMP-опроса проглатываются без лога (network_monitor_probe.py:169-171)
`except Exception:` ставит `"Ошибка SNMP-клиента"` без `logger` и без traceback. Баги парсера и кода опроса выглядят как обычный сбой сети, и их невозможно диагностировать.
Severity: low. Confidence: high.

### B22. Одно SQLAlchemy-соединение используется из нескольких потоков (network_monitor_service.py:42-58, 93-113, 157-158)
`still_owned()` выполняет запрос на соединении lease через `to_thread`. Его вызывают одновременно до 4 опросов из `asyncio.gather` и цикл владельца. Соединение SQLAlchemy не потокобезопасно.
Severity: low. Confidence: medium.

### B23. Retention смотрит только на 1000 самых старых строк (network_monitor_store.py:460-494; network_monitor_service.py:183-193)
Выборка `raw` ограничена `batch_size` и упорядочена по времени. Если в голове очереди есть строка без покрытия rollup (`raw_without_rollups`), она никогда не удаляется, а цикл прерывается при `raw_eligible == 0`. Строки за ней не очищаются.
Severity: medium. Confidence: low (нужна строка без покрытия; условия покрытия в 468-478 строгие).

### B24. Ошибка unlock advisory-lock глотается (one_c_catalog_compact_writer.py:248-255; аналогично cleanup 155-160, rebuild 238-243)
`_advisory_unlock` делает `except Exception: pass`. Session-level advisory lock остаётся на соединении из пула, и rebuild/cleanup в других процессах блокируются до пересоздания соединения.
Severity: medium. Confidence: medium.

### B25. Lost update в notification_preferences (notification_preferences_service.py:172-180)
`update_preferences` делает `_load_all()` → изменение одного пользователя → `_save_all(data)` без блокировки на уровне сервиса. `hubit_storage` блокирует только отдельные операции файла (`_LOCK`, hubit_storage.py:61, 246, 399), но не цикл read-modify-write. Два одновременных обновления от разных пользователей → один пропадает. Файл `data/*.json` общий с ботом, как указано в AGENTS.md.
Severity: medium. Confidence: high (код); частота зависит от нагрузки.

### B26. update_user_settings: full-table RMW и удаление строк (settings_service.py:335-372; 265-266)
`update_user_settings` загружает всю таблицу (`_load_all`), меняет одного пользователя и вызывает `_save_all`. В app-DB режиме `_save_all` перезаписывает все строки и удаляет строки, которых нет в снимке (266). Настройки, созданные другим процессом между загрузкой и записью, удаляются. Каждое обновление одного пользователя пишет всю таблицу.
Severity: medium. Confidence: medium.

### B27. Финансовые операции: удаление без актора, без версий (tickets_service.py:2415-2436; 2302-2330)
`delete_financial_op(op_id, user_id)` не использует `user_id` (тело: `is_deleted=True`, `updated_at`). В модели `TicketFinancialOp` (appdb/tickets_models.py, ~258-275) нет `deleted_by`/`updated_by`, поэтому аудит «кто удалил» отсутствует. `update_financial_op` тоже не проверяет версию, в отличие от `change_status` (версии в 902-951).
Severity: medium. Confidence: high.

### B28. Кэш деталей IT-заявок никогда не вытесняет устаревшие записи (warehouse_1c_it_requests.py:1374, 1493-1500)
`get` возвращает `None` по TTL, но запись не удаляется. `remember_detail` только перезаписывает ключ. Память растёт с числом уникальных `request_ref` за время жизни процесса, и каждое значение хранится как `deepcopy`.
Severity: low. Confidence: high.

---

## Conflicts

### C1. Два противоположных правила для snapshot-записи сессий и пользователей
`session_service.py:210-213` явно запрещает удалять строки, которых нет в снимке (сохранение уже закоммиченных логинов других процессов). `user_service.py:209-211` и `settings_service.py:265-266` делают обратное. Один и тот же паттерн («сохранить весь список») в трёх сервисах ведёт себя по-разному, и безопасного общего правила нет (см. B4, B26).
Severity: medium. Confidence: high.

### C2. Кэши аутентификации не инвалидируются между процессами
`user_service`: кэш пользователей 60 с (91), кэш identity 300 с (95), инвалидация только в текущем процессе (118-123). `session_service`: кэш активности 8 с и «fresh touch» на 60 с без обращения к БД (120-121, 494-509, 735). Chat-процессы (`ecosystem.chat.scale.config.js`, `instances: 1` на нод) читают те же таблицы. Деактивация или смена пароля, сделанные в основном процессе, видны в других процессах до 300 с (identity) и до 60 с (touch-путь). Для `is_session_active` ограничение 8 с, но touch-путь доверяет кэшу полную минуту.
Severity: medium. Confidence: medium.

### C3. Разные гарантии блокировки для мониторинга на SQLite и PostgreSQL (network_monitor_service.py:29-41)
На PG lease берётся через advisory lock. На SQLite для scope `target:*` блокировки нет вообще (ветка `yield lambda: True` без захвата), а для `owner` работает только локальный `threading.Lock`. Поведение при нескольких процессах разное для двух бэкендов.
Severity: low. Confidence: medium.

---

## Duplication

### D1. secret_crypto_service: encrypt_secret/decrypt_secret повторяют _encrypt/_decrypt_with_env_key
`secret_crypto_service.py:79-95` и `98-114` делают одно и то же, только с фиксированным `MAIL_CREDENTIALS_KEY`. Литерал `"fernet:v1:"` повторён в строках 184 и 220, хотя рядом есть `_PASSWORD_VAULT_VERSION_PREFIX` (117). Оставить одну реализацию с параметром env-переменной.

### D2. Пять копий advisory-lock с проглатыванием ошибок unlock
`one_c_catalog_compact_cleanup.py:148-160`, `one_c_catalog_compact_rebuild.py:232-243`, `one_c_catalog_compact_writer.py:242-255`, `one_c_catalog_compact_backfill.py:113-180`, `network_monitor_service.py:42-58` (`monitoring_lease`). Все строят `pg_try_advisory_lock`/`pg_advisory_unlock` по одной схеме. Вынести в общий хелпер (см. B24).

### D3. twofa_service: HOTP реализован дважды, а fallback дублирует основной путь
`_totp_now` (45-56) и цикл fallback (134-146) считают один и тот же HOTP. Fallback жёстко использует `1_000_000` и игнорирует `digits`. Так как `pyotp` есть в `backend/requirements.txt:23`, fallback в основном не нужен (см. DC2).

### D4. network_monitor_calculations: одна и та же логика weighted-merge
`aggregate_values` (56-69) и `merge_aggregates` (83-91) вычисляют `sum`, `weight`, `min`, `max`, `count` одинаковым образом, различаются только входные данные. Вынести общий `_merge_stat(a, b)`.

### D5. session_service: одни и те же циклы normalize/delete в трёх местах
`cleanup_sessions` app-путь (964-995) и `purge_inactive_sessions` app-путь (1040-1058) повторяют загрузку всех строк, `_row_to_session_dict` → `_normalize_session` → `_apply_session_payload`. JSON-пути (997-1032 и 1059-1081) повторяют то же самое. Плюс `close_session` (870-892), `close_session_by_id` (894-918), `close_user_sessions` (920-952) и `_enforce_active_session_limit` (567-574) используют один и тот же шаблон «строка → dict → close → apply».

---

## Optimization

### O1. N+1 при нормализации сессий: один и тот же дедлайн считается дважды (session_service.py:378-430, 351-356, 394, 400)
`_normalize_session` вызывает `_compute_idle_expires_at` (394), а `_resolve_status` (351-356) считает его снова. Каждый расчёт вызывает `_effective_trusted_device_id` (272-287) и `_has_active_mobile_biometric_trust` (306-324), то есть запросы к БД. На одну сессию уходит 4-6 запросов. `cleanup_sessions` и `reapply_idle_policy_for_active_sessions` (1204-1258) выполняют это для каждой строки, а последний запускается при старте каждого процесса (`main.py:270`, `chat_main.py:119`).
Severity: medium. Confidence: high.

### O2. Вся таблица сессий грузится в память одной транзакцией (session_service.py:964-965, 1040-1041, 1204-1210, 1094-1100)
`cleanup_sessions`, `purge_inactive_sessions`, `reapply_idle_policy_for_active_sessions` и `normalize_active_session_limits` делают `select(AppSessionRecord)` без батчей и держат транзакцию с блокировками всё время обхода (с учётом O1 — с N+1 запросами внутри). Нужны батчи по ключу.
Severity: medium. Confidence: high.

### O3. list_entries сканирует теги всех записей при каждом запросе (password_vault_service.py:333-337)
Для каждого вызова `list_entries` загружается `tags_json` всех неархивных записей, без пагинации и без учёта фильтров `q`, `group`, `tag`. Итоговая стоимость O(N) на каждый запрос списка. Список тегов нужно считать SQL-запросом с `DISTINCT` по `jsonb_array_elements_text` или кэшировать с инвалидацией.
Severity: medium. Confidence: high.

### O4. SNMP-опрос идёт последовательными батчами под общим таймаутом 12 с (network_monitor_probe.py:64-73, 92, 116-131)
`get()` отправляет OID по 20 штук и ждёт каждый батч по очереди. Для устройства с десятками интерфейсов (4 OID на интерфейс плюс счётчики) набор не укладывается в 12 с, и опрос помечается как «Неполный опрос». Батчи можно отправлять параллельно или использовать GETBULK.
Severity: medium. Confidence: medium.

### O5. delete_target удаляет всю историю одной транзакцией (network_monitor_store.py:112-119)
Удаляются все `MonitoringSample`, `MonitoringAggregate`, `MonitoringEvent`, `MonitoringInterface` для цели одним `DELETE` при удержании блокировки строки цели. При 7 днях сырых данных по всем интерфейсам это большой объём. Нужны батчи, как в `retention` (460-494).
Severity: medium. Confidence: high.

### O6. Push: конфиг сервисного аккаунта читается с диска при каждой отправке, а OAuth-токен обновляется без блокировки (native_push_service.py:119-134, 317-320, 457-530)
`_service_account()` читает и парсит JSON-файл на каждый `send_notification`. Кэш токена OAuth (`_access_token`) не защищён блокировкой, поэтому при холодном старте параллельные отправки запрашивают токен несколько раз.
Severity: low. Confidence: high.

---

## Dead code

### DC1. one_c_catalog_compact_cleanup.py (539 строк) не подключён к продакшену
В репозитории на него ссылаются только тесты (`tests/test_one_c_catalog_compact_search.py:542-551`, `tests/test_one_c_catalog_compact_final_closure_pg.py:386`). Ни один процесс или планировщик не создаёт `OneCCatalogCompactCleanupService`, то есть очистка версий каталога в runtime не выполняется. Если это осознанно, нужно зафиксировать в runbook; иначе модуль и его тесты можно удалить.
Severity: low. Confidence: high.

### DC2. Отладочная инструментация «agent log» в session_service (session_service.py:150-179, 736, 801)
Блок `# region agent log` пишет в `debug-20cb37.log` в корне репозитория, если включён `DEBUG_CLIENT_LOG_ENABLED`. Тот же файл пишет `backend/chat/send_audit.py:17`. Функция вызывается на горячем пути `touch_session` и `is_session_active`, и на каждом попадании в кэш читается переменная окружения. Удалить вместе с `send_audit`-логом после завершения отладки.
Severity: low. Confidence: high.

### DC3. Дублирующая функция в network_service (network_service.py:622-626)
`_network_autoincrement_tables()` возвращает то же самое, что `_network_table_names()`. Оставить одну.
Severity: low. Confidence: high.

---

## Проверено без находок (кратко)
- `transfer_act_job_service.claim_for_execution`, `checkpoint_processing_result`, `touch_execution_lease`, `requeue_stale_processing_job`: переходы условные (`rowcount`, lease), кроме финальных `mark_*` (B9).
- `tickets_service.change_status`: оптимистичная блокировка по `version` и таблица `STATUS_TRANSITIONS` применяются корректно.
- `warehouse_1c_service`: тяжёлые операции вынесены через `asyncio.to_thread` (поиск, снимок каталога), спот-проверка не выявила блокировки event loop.
- `secret_crypto_service.decrypt_*`: ошибки оборачиваются в `SecretCryptoError` без утечки значения ключа в сообщение.

## Ограничения
- Не проверено выполнение: гонки описаны по коду и требуют подтверждения тестом на изолированной БД.
- Оценка «несколько процессов пишут в одну БД» опирается на `ecosystem.chat.scale.config.js` и `chat_main.py`; при одном процессе B4, B9, B10, C2 теряют значимость.
- Файлы `warehouse_1c_service.py` (5526 строк) и `tickets_service.py` (3302) просмотрены выборочно по паттернам, не построчно. `network_service.py` (4567) просмотрен по SQL и подключению.
