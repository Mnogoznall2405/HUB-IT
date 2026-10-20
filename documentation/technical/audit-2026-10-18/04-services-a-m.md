# Аудит WEB-itinvent/backend/services, файлы a..m (только чтение)

Область: `WEB-itinvent/backend/services/[a-m]*.py` (около 90 модулей, ~63 600 строк; крупнейшие: `hub_service.py` 10176, `mail_service.py` 5464, `my_files_service.py` 4057, `mfu_monitor_service.py` 2885, `address_book_service.py` 2357, `docflow_service.py` 2304).

Метод: targeted grep по рискованным паттернам (SQL-строки, subprocess, LDAP-фильтры, кэши, логи, пути), чтение ключевых участков (auth/2FA/SSO, runtime store, my_files delete, recent-activity, mail mailbox, push outbox, app settings), проверка callers через rg. Полный AST-проход не выполнен (python не запускается из этой среды), поэтому поиск блокирующих вызовов в async-функциях и поиск мёртвых функций выборочный, не полный. Изменений в репозитории не сделано.

Ниже каждое утверждение проверено чтением кода; "confidence" отражает, насколько уверенно можно судить без запуска.

---

## Bugs

### B1. Обход 2FA: повторная регистрация TOTP по challenge после пароля (critical, confidence high)
- `WEB-itinvent/backend/services/auth_security_service.py:320-347` (`start_totp_enrollment`) и `:394-431` (`finalize_totp_enrollment`): не проверяется, что у пользователя 2FA уже выключена (`is_2fa_enabled`). Функция берёт challenge по id, генерирует новый TOTP-секрет, сохраняет его в challenge; `finalize` при верном коде записывает `totp_secret_enc` новым секретом, ставит `is_2fa_enabled=True`, перевыпускает backup-коды и выдаёт полноценную сессию (`auth_method="totp_setup"`).
- `WEB-itinvent/backend/api/v1/auth.py:1200-1212` (`POST /enable-2fa`) и `:1218-1235` (`POST /verify-2fa`): никакой проверки статуса 2FA пользователя нет, rate limit ключуется только по `login_challenge_id`.
- Сценарий: злоумышленник знает пароль жертвы с включённым TOTP. `POST /login` возвращает `status="2fa_required"` и `login_challenge_id` (`auth_security_service.py:273-279`). Затем он вызывает `/enable-2fa` с этим challenge, получает `manual_entry_key`/QR, добавляет секрет в своё приложение, вызывает `/verify-2fa` с кодом. Результат: 2FA жертвы заменён на секрет атакующего, backup-коды перевыпущены, атакующий получает токены. Второй фактор полностью обходится одним паролем.
- Fix (по смыслу): в `start_totp_enrollment` и `finalize_totp_enrollment` отказывать, если `user.is_2fa_enabled` уже True (или enrollment допускать только для `2fa_setup_required`-challenge с явным флагом в payload, который выставляется в `start_login:264-272`).

### B2. Windows SSO выдаёт сессию без проверки 2FA-политики (high, confidence medium: возможно намеренно)
- `WEB-itinvent/backend/services/auth_security_service.py:676-716` (`complete_windows_sso_login`): вызывает `_complete_login` без какой-либо проверки `is_2fa_enabled` и `twofa_required_for_current_request`. Флаг `twofa_required_for_current_request` записывается в challenge (`:707-709`), но `_complete_login` (`:549-636`) его не читает для принятия решения.
- Вызов: `WEB-itinvent/backend/api/v1/auth.py:940` в callback AD FS; перед ним только проверка `is_active` и `ensure_admin_ip_allowed`.
- Сценарий: пользователь с включённым 2FA в зоне, где 2FA обязательна (`is_twofa_required_for_zone`), входит через Windows SSO без второго фактора. Для сравнения, парольный путь (`start_login:252-280`) этот фактор требует. Docstring говорит только о проверке Kerberos-assertion, не о политике 2FA.
- Fix: либо явно задокументировать, что SSO (Kerberos) заменяет 2FA (тогда подтвердить с владельцем политики и ADR), либо требовать второй фактор при `is_2fa_enabled` и `twofa_required_for_current_request`.

### B3. Гонка при одноразовом использовании backup-кода (medium, confidence medium)
- `WEB-itinvent/backend/services/auth_security_service.py:371-392` (`_consume_backup_code`): `select` непогашенных кодов без `with_for_update`, затем установка `used_at` в той же сессии. Две параллельные challenge одного пользователя (два логина с одним паролем) могут одновременно прочитать `used_at IS NULL` и принять один и тот же backup-код.
- Challenge сама по себе одноразовая (`consume_login_challenge` использует `pop` с `with_for_update`, `auth_runtime_store_service.py:221-240`), поэтому гонка возможна только между разными challenge.
- Fix: `with_for_update()` на выборку (или условный `UPDATE ... WHERE used_at IS NULL` с проверкой rowcount).

### B4. Удаление физического файла blob до коммита транзакции (high, confidence high)
- `WEB-itinvent/backend/services/my_files_service.py:2933-2948` (`_release_blob_locked`): при `ref_count` ↓ 0 вызывается `_delete_preview_artifact_locked` и `_delete_physical_file(path)` (`:2948`) внутри открытой `app_session`. Файл удаляется до `commit`.
- Вызывающие места внутри транзакции: `my_files_service.py:1362` (массовое удаление папки), `:2708`, `:3025` (`delete_file`, purge), `:3952`.
- Сравнение: в `delete_file` (`:3025-3035`) spool-файл намеренно удаляется после выхода из `with`, то есть после коммита. Для blob так не сделано.
- Сценарий: ошибка до коммита (сбой flush, deadlock, исключение после `_release_blob_locked`) откатывает удаление строки blob и `status=STATUS_DELETED`. В БД остаётся ссылка на blob, файл уже удалён, скачивание/превью ломаются, данные потеряны безвозвратно.
- Fix: собирать пути в список и удалять после успешного коммита (как сделано для `spool_paths`).

### B5. Значение по умолчанию admin-IP-allowlist подменяет повреждённые настройки (medium, confidence high)
- `WEB-itinvent/backend/services/app_settings_service.py:31-32` (`DEFAULTS`): `transfer_act_reminder_controller_username: "kozlovskii.me"` и `admin_login_allowed_ips: ["10.105.0.42"]` захардкожены в коде.
- `:143-149` (`get_settings`): при `ValueError` из нормализации (`:146-147`) или пустом списке молча подставляется `DEFAULTS`. Ошибка в JSON или невалидный IP в файле не логируется и не поднимается наружу.
- Сценарий: при повреждении `web_app_settings.json` или ручной правке админ-доступ ограничивается одним IP из кода (lock-out либо неожиданный список). Политика доступа зависит от молчаливого fallback.
- Fix: при невалидных данных падать с явной ошибкой или, как минимум, логировать warning; вынести дефолты в конфиг, а не в код.

### B6. `update_settings` записывает дефолты в хранилище (low, confidence high)
- `WEB-itinvent/backend/services/app_settings_service.py:158-170`: `current = self.get_settings()` возвращает значения с подставленными дефолтами, затем `data.update(current)` и `_save_all(data)` сохраняют их всё равно, даже если патч касается только одного ключа. Отдельно: "чтение" через `get_settings` при повреждённых данных материализует дефолты в файле при любой записи.

### B7. Гонка при обновлении почтового ящика: lost update и TOCTOU на дубликаты (medium, confidence high)
- `WEB-itinvent/backend/services/mail_service.py:1667-1771` (`update_user_mailbox`): `current` читается в начале (`:1675`), затем долгая часть (внешний вызов `verify_mailbox_credentials` в `:1721-1750`, расшифровка, шифрование) без блокировки и без версии строки. Запись в конце перезаписывает поля целиком. Параллельное обновление одного ящика теряет изменения.
- Проверка дубликата `has_duplicate_mailbox_email` (`:1754-1758`) выполняется по выборке до записи, без уникального индекса в SQLite-DDL для `mailbox_email` (`mail_service.py:1113-1127`: только `PRIMARY KEY id`). Два одновременных создания одинакового ящика пройдут проверку оба. Уникальность только в app-DB модели (`appdb/models.py:369`), и то для другого пути.
- Fix: оптимистичная версия строки или `SELECT ... FOR UPDATE`; уникальный индекс `(user_id, mailbox_email)` в DDL.

### B8. Race при первом касании recent-карточек/актов в БД: неперехваченный IntegrityError (medium, confidence high)
- `WEB-itinvent/backend/services/equipment_recent_cards_service.py:258-271` (`touch`, ветка БД): `select` → если `None`, `session.add(new row)`. Уникальное ограничение `uq_app_equipment_recent_cards_user_db_inv` (`appdb/models.py:629`) при параллельном первом касании (двойной клик, два вкладки) даёт `IntegrityError`, который здесь не перехватывается. Аналогично `equipment_recent_acts_service.py:297-311` (`uq_app_equipment_recent_acts_user_db_doc`, `models.py:650`).
- Сценарий: запрос `/equipment/.../touch` возвращает 500 при гонке; `activity_count` при параллельных обновлениях теряет инкременты (нет `with_for_update`).
- Fix: `INSERT ... ON CONFLICT DO UPDATE` либо перехват `IntegrityError` с повторным чтением, плюс `FOR UPDATE` на счётчик.

### B9. Дубликаты `id` в локальном JSON-режиме recent-активности (low, confidence high)
- `equipment_recent_cards_service.py:297` и `equipment_recent_acts_service.py:338`: `"id": len(items) + 1`. После `_prune_local_scope` (вызывается в `touch`, `:307`) список сокращается, и новый `id` может совпасть с уже существующим. Пример: элементы с id 1..9, удалён id 1, длина 8, новый id 9 — дубликат.
- Используется только в fallback без БД; в проде при наличии БД не срабатывает. Fix: `max(id)+1` или uuid.

### B10. Локальный JSON recent-активности: фиксированное имя tmp-файла (low, confidence medium)
- `equipment_recent_cards_service.py` `_save_local_items_unlocked` (`tmp_path = self.file_path.with_suffix(...)`): `threading.RLock` защищает только внутри процесса. Два процесса (web и bot пишут в один `data/`) одновременно пишут один tmp и делают `replace`, итоговый файл может быть смешанным или потерять запись. AGENTS требует атомарной записи и блокировок по JSON, здесь блокировки межпроцессной нет.

### B11. Непойманная ошибка bind для LDAP с сервисной учёткой (medium, confidence high)
- `WEB-itinvent/backend/services/ad_sync_service.py:33-41`: при заданных `LDAP_SYNC_USER/PASSWORD` `Connection(..., auto_bind=True)` не обёрнут в try (`:35`), а анонимный путь (`:37-41`) возвращает `[]` при ошибке. Исключение уходит к вызывающему коду.
- То же в `ad_users_service.py:195-210` (`_open_ad_connection`, return `:205` без try, try только у анонимного пути `:206-209`).
- Сценарий: неверный пароль сервисной учётки вызывает исключение в фоновом синке/API вместо контролируемого `None`/`[]`. Поведение зависит от пути (`ad_users` возвращает `None` только для анонима).

### B12. LDAP-фильтр: DN и значения из конфигурации вставляются без экранирования (medium, confidence medium)
- `WEB-itinvent/backend/services/ad_groups_access_service.py:287`: `f"(&{_USER_ENABLED_FILTER}(|{filter_parts}))"`, где `filter_parts = "".join(f"(distinguishedName={dn})" ...)` (`:284`). DN из AD могут содержать `(`, `)`, `*`, `\`, например `CN=Иванов (ИТ),OU=...`. Незакрытые скобки ломают фильтр, и весь чанк из 40 DN не резолвится (`:282`, `chunk_size = 40`).
- `ad_groups_access_service.py:213`: `f"(&(objectClass=organizationalUnit)(|(ou={branch})(name={branch})))"`, `branch` из `AD_GROUPS_ACCESS_BRANCHES` (`:72-76`) без `escape_filter_chars`. Источник — конфиг, поэтому риск низкий, но для DN это реальный функциональный дефект.
- Fix: `ldap3.utils.conv.escape_filter_chars` для DN и branch (уже используется в `ad_users_service.py:951`).

### B13. Push outbox: повторная отправка при зависшем job (medium, confidence medium)
- `WEB-itinvent/backend/services/app_push_outbox_service.py:130-131` (`heartbeat_sec`) используется только для логирования (`:521-534`); job не продлевает аренду.
- `:351-368` (`recover_stale_jobs`) возвращает в очередь все PROCESSING с `updated_at` старше `processing_timeout_sec` (по умолчанию 300 с, `:126-127`). Длинная отправка (сетевой таймаут, зависший push-сервис) > 300 с сбрасывается, другой воркер заберёт job и отправит повторно.
- Fix: heartbeat, обновляющий `updated_at` (или lease-token), либо идемпотентность по `dedupe_key` на стороне доставки.

### B14. Push outbox: неограниченные повторы claim при падении воркера (low, confidence medium)
- `:370-392` (`claim_jobs`): `attempt_count` увеличивается при claim, но выборка не фильтрует `attempt_count < max_attempts`. `process_job` (`:407-479`) проверяет лимит только после попытки отправки. Job, на котором воркер падает (OOM, исключение вне `try`), бесконечно возвращается через `recover_stale_jobs` и `claim_jobs`.

### B15. `poll_once` прерывается на первом исключении из gather (low, confidence high)
- `app_push_outbox_service.py:551`: `asyncio.gather(...)` без `return_exceptions=True`. Если `_update_job` в `process_job` (`:478`/`:460`) бросает исключение (недоступна БД), gather поднимает его наружу. Остальные уже claimed job остаются в PROCESSING до истечения таймаута (см. B13), а `_emit_heartbeat_if_due` (`:570`) не выполняется.

### B16. Кэш разрешённых revocation в процессе: окно гонки после отзыва (low, confidence medium)
- `WEB-itinvent/backend/services/auth_runtime_store_service.py:410-415` (`revoke_jti`): `self._jti_not_revoked.forget(...)` вызывается до записи в БД (`:415`). Параллельный `is_jti_revoked` (`:417-427`) между `forget` и записью увидит «не отозван», запишет `remember` и разрешит токен ещё до `AUTH_REVOCATION_CACHE_TTL_SEC` (по умолчанию 3 с) даже в этом же процессе, хотя docstring в `auth_short_cache.py:8` обещает немедленную инвалидацию.
- Аналогично `complete_refresh_rotation:456`: `forget` до транзакции.
- Fix: `forget` после успешной записи (и, при желании, повторный `forget` после коммита).

### B17. Политика TTL refresh дублирует clamp без учёта конфигурации (low, confidence high)
- `auth_security_service.py:85-86` (`_refresh_ttl`): `max(7, ... or 7)`. В `config.py:404-407` тот же минимум 7 уже задан `_clamp_min_int`. Дубликат не даёт расхождения, но в случае изменения одного места второе станет противоречием. Отмечено в разделе Duplication.

### B18. Сравнение пароля в safari-beacon не constant-time (low, confidence high)
- `auth_security_service.py:211`: `if str(password or "") != expected_password`. Значение расшифровано из `password_enc` (`:208`). Для сравнения секретов использовать `hmac.compare_digest` (как в `twofa_service.find_matching_backup_code`). Практический риск низкий (challenge короткоживущий), но это инконсистентность.

### B19. Пароль пользователя хранится в challenge обратимо зашифрованным до 600 с (medium, confidence high: design risk)
- `auth_security_service.py:166-171` (`create_login_challenge`): `payload["password_enc"] = encrypt_secret(password)`; challenge лежит в `app_auth_runtime_items` до `_challenge_ttl()` (`:79-80`, по умолчанию 600 с). Пароль нужен для LDAP-сессии (`:588-600`) и Safari beacon, но хранить его в БД даже в зашифрованном виде — расширение поверхности атаки: при утечке ключа `secret_crypto` и дампа БД пароли восстанавливаются.
- Рекомендация: хранить только то, что нужно для LDAP-сессии, с минимальным TTL, либо получать пароль на шаге 2FA из повторного ввода.

### B21. Жёсткий путь к файлу SNMP-конфига в Windows (low, confidence high)
- `WEB-itinvent/backend/services/mfu_monitor_service.py:231` и `:1222`: `Path("C:/Project/Image_scan/data/custom_snmp.json")`. Кандидаты вида `Path(__file__).parent...` уже есть в том же списке; абсолютный путь ломает окружение с другим корнем и дублируется в двух местах.

### B22. Жёсткий адрес Exchange по умолчанию (low, confidence high)
- `WEB-itinvent/backend/services/mail_service.py:1153`: `_normalize_text(os.getenv("MAIL_EXCHANGE_HOST"), "10.103.0.50")`. Внутренний адрес в коде, при пустом окружении запросы уходят на него без явной ошибки конфигурации.

---

## Conflicts

### C1. Контроль 2FA в парольном и SSO-путях расходится (см. B1, B2)
- Парольный путь: challenge с `2fa_required` и блокировка в `verify_login_second_factor`. SSO: `complete_windows_sso_login` без проверки. Переходы в `start_login` (`auth_security_service.py:252`) и `complete_windows_sso_login` (`:676`) противоречат друг другу в выдаче токенов для одной и той же политики `is_twofa_required_for_zone`.

### C2. Нормализация текста: `str(value or "")` трактует 0/False как пустое (low, confidence high)
- `mail_service.py:186-188` (`_normalize_text`): `text = str(value or "").strip(); return text or default`. Для `value=0` вернёт `default`, тогда как `mail_send_pipeline.py:10-19` и `mail_ai_service.py:72-78` (`if value is None: ...; str(value)`) вернут `"0"`. Одно и то же имя функции даёт разные результаты для числовых значений в разных модулях mail.

### C3. Два способа импорта LLM-клиента (low, confidence high)
- AGENTS требует вызовы OpenRouter/LLM только через `shared/llm/`. `act_upload_service.py:23-26`, `mail_ai_service.py:13`, `equipment_photo_ocr_service.py:42` импортируют `shared.llm`. `markdown_transform_service.py:10` импортирует `backend.ai_chat.openrouter_client` (compat re-export, `ai_chat/openrouter_client.py:1-6`). Поведение одинаковое, но путь импорта противоречит правилу и продолжает существовать (также `warehouse_1c_reconcile.py:1543`, `ai_chat/service.py:33`).

### C4. `mail_service._to_bool` и `mfu_monitor_service._to_bool` с разной семантикой по умолчанию (low, confidence medium)
- `mail_service.py:201` — `default: bool = False`; `mfu_monitor_service.py:78` — `default: bool` без значения по умолчанию. Одинаковое имя, разные контракты, в обоих модулях импортируются только локально.

---

## Duplication

### D1. `_normalize_text` в 12+ модулях (две несовместимые версии)
- Версия A `str(value or "").strip()` + default: `mail_service.py:186`, `mail_metadata_store.py:17`, `mailbox_quota_service.py:32`, `mail_metadata_store`.
- Версия B с проверкой None и try/except: `mail_send_pipeline.py:10`, `mail_ai_service.py:72`, `mail_conversation_finder.py:7`, `mail_conversation_payloads.py:7`, `mail_draft_lifecycle.py:8`, `mail_folder_mutations.py:7`, `mail_folder_tree.py:7`, `mail_message_actions.py:9`, `mail_message_content.py:9`, `mail_message_listing.py:8`, `mail_message_serializer.py:22`.
- Также `hub_service.py:169`, `employee_absence_service.py:30` (с `maximum`), `app_push_outbox_service.py:44` (с `max_length`), `document_preview_job_service.py:42`, `equipment_recent_acts_service.py:37`, `equipment_recent_cards_service.py:37` (без default).
- Предложение: один `backend/utils/text.py` (или `services/_text.py`) с явной семантикой; см. C2.

### D2. `_utc_now` / `_utc_now_iso` / `_iso` продублированы в 15+ модулях
- `_utc_now`: `app_push_outbox_service.py:32`, `construction_management_service.py:32`, `document_preview_job_service.py:38`, `equipment_photo_check_service.py:82`, `equipment_photo_ocr_service.py:229`, `mobile_biometric_session_service.py:31`, `my_files_service.py:143`, `ad_expiry_cache.py:21`, `auth_runtime_store_service.py:30`, `company_structure_service.py:39`, `equipment_recent_acts_service.py:20`, `equipment_recent_cards_service.py:20`, `hub_notifications_retention_service.py:42`.
- `_utc_now_iso`: `ad_app_user_import_service.py:179`, `ad_groups_access_service.py:64`, `department_service.py:21`, `env_settings_service.py:334`, `equipment_recent_acts_service.py:24`, `equipment_recent_cards_service.py:24`, `hub_service.py:165`, `kb_service.py:58`, `mail_metadata_store.py:13`, `mail_service.py:182`, `mfu_monitor_service.py:74`.
- Предложение: `backend/utils/time.py`.

### D3. Recent-активность: `equipment_recent_acts_service.py` (453 строки) и `equipment_recent_cards_service.py` (438 строк) — почти копия
- Одинаковые: `_utc_now`, `_utc_now_iso`, `_json_loads` (`acts:28`, `cards:28`), `_normalize_text` (`acts:37`, `cards:37`), `_normalize_user_id`, `_normalize_db_id`, `_local_sort_key`, `_load_local_items_unlocked`, `_save_local_items_unlocked`, `_prune_local_scope`, логика `touch`/`list_recent`/`remove`/`clear`, класс с `_file_lock`, `_use_app_database`, `MAX_PER_SCOPE`.
- Различаются: модель БД, ключ (`doc_no` vs `inv_no`), словари `ACTION_LABELS`, `SNAPSHOT_*`.
- Предложение: базовый класс `RecentActivityStore` с параметрами модели, ключа и нормализации snapshot.

### D4. Адаптер «SQL Alchemy или sqlite» продублирован в четырёх сервисах
- `hub_service.py:951-965` (`SqlAlchemyCompatConnection`, `_CountingSqliteConnection`, `_AfterCommitConnection`), `mail_service.py:949-954`, `mfu_monitor_service.py:256-263`, `env_settings_service.py:458-464`. Общий класс уже есть: `WEB-itinvent/backend/appdb/sql_compat.py:39` (`SqlAlchemyCompatConnection`). Ветки sqlite-fallback дублируются, а поведение таймаутов (30 с в hub и mail, 10 с в mfu) расходится.

### D5. `_safe_file_name` в четырёх модулях
- `kb_service.py:79`, `docflow_1c_client.py:280` (с `extension`), `my_files_service.py:159` (с `fallback`), `hub_service.py:174`. Разные правила очистки имени (расширения, длина, кириллица) при одинаковой цели.

### D6. Мелкие дубликаты числовых хелперов
- `_as_int`: `equipment_photo_notification_service.py:125`, `equipment_quality_service.py:196`, `hub_service.py:2039` (с default), `task_email_templates.py:35`.
- `_to_int`: `equipment_transfer_execution_service.py:44`, `markdown_transform_service.py:24`, `mfu_monitor_service.py:2873`.
- `_json_loads`: `acts:28`, `cards:28`, `native_push_service.py:73`, `transfer_act_job_service.py:85`.
- `_sha256`/`_sha256_file`: `mobile_biometric_session_service.py:35`, `my_files_service.py:189,241`.

### D7. Построение LDAP-подключения продублировано в четырёх модулях
- `ad_sync_service.py:28-41`, `ad_users_service.py:195-210`, `ad_app_user_import_service.py:253-255`, `ad_groups_access_service.py` (через `_paged_search`, `:159`). Каждый модуль сам собирает `Server`/`Connection` с разной обработкой ошибок (см. B11) и без таймаутов (см. O2). Общая фабрика сняла бы оба дефекта.

### D8. Сборка challenge-payload дублируется в auth_security_service
- Одинаковый словарь с полями `challenge_id`, `user_id`, `username`, `role`, `auth_source`, `ip_address`, `user_agent`, `network_zone`, `twofa_policy`, `twofa_required_for_current_request`: `auth_security_service.py:654-668` (biometric), `:697-711` (SSO), `:754-768` (passkey), `:149-165` (create_login_challenge). Любое новое поле надо добавлять в четыре места, и расхождения уже есть: в biometric/SSO нет `request_username`, `created_at`, `client_device_id`.

### D9. Три TTL-кэша со своей логикой
- `auth_short_cache.py:32-67` (`AllowCache`), `ad_expiry_cache.py:13-...` (`_cache_ttl_sec`), `mail_runtime_cache.py:26-103` (`RuntimeCachePolicy`), `employee_absence_service.py:21-23`, `equipment_quality_service.py:302-308`, `equipment_photo_review_service.py:39,365-389`, `hub_service.py:672-716` (восемь кэшей с Lock). Общий примитив TTL-cache с ограничением размера убрал бы повторную реализацию и дефекты из O3.

### D10. Повторное чтение backup-кодов и TOTP в auth
- `auth_security_service.py:371-392` и `password_vault_service.py:647` (вызывает приватный `_consume_backup_code` из другого сервиса). Публичный метод, который `password_vault` вызывает через приватное имя, — признак смешения слоёв.
---

## Optimization

### O1. Сброс 2FA сканирует все активные сессии (medium, confidence high)
- `WEB-itinvent/backend/services/auth_security_service.py:818-822` (`reset_user_twofa`): `session_service.list_sessions(active_only=True)` возвращает все сессии системы, затем фильтр по `user_id` в Python; далее `close_session` по одной (`:823-827`) — N отдельных вызовов.
- Fix: выборка по `user_id` на уровне `session_service` и пакетное закрытие.

### O2. LDAP-подключение создаётся на каждый вызов и без таймаутов (medium, confidence high)
- `ad_users_service.py:195-210`, `ad_sync_service.py:28-41`, `ad_app_user_import_service.py:253-255`: новый `Server`/`Connection` на каждый запрос (поиск пользователя, пароли, синк). Таймаутов получения (`receive_timeout`) нет ни в одном `Connection(...)` (grep по `ldap3` в a..m), поэтому зависший контроллер домена блокирует поток синка без ограничения.
- Fix: общий пул/фабрика с `receive_timeout` и `connect_timeout`.

### O3. Кэши без ограничения размера (medium, confidence high)
- `employee_absence_service.py:21, 129-131, 165-166` (`_DASHBOARD_EMBED_CACHE`): записи истекают только при повторном чтении (`:131`); ключи, которые не запрашивались повторно, не удаляются никогда.
- `equipment_quality_service.py:302, 399` (`_summary_cache`): записи добавляются без проверки размера, в отличие от `equipment_photo_review_service.py:382-383`, где есть `> 256 → clear()`.
- `hub_service.py:2507-2513` (`_user_directory_cache`): ключ строковый, ограничения размера нет; `_department_scope_ids_cache` (`:857-870`) и `_tasks_list_cache` (`:685`) тоже без ограничения.
- `docflow_dm_service_client.py:340, 711-725` (`_task_xml_cache`, `bytes` payload): без ограничения размера; при большом числе задач память растёт монотонно (сохраняются XML).
- Fix: общий ограниченный TTL-кэш (см. D9).

### O4. Двойной подсчёт активных устройств при логине (low, confidence high)
- `auth_security_service.py:124` (`_login_methods`) и `:103-109` (`_build_public_user`), плюс `start_login:246` вызывает `_build_public_user`, а `create_login_challenge:144` вызывает `_login_methods`. Для одного логина выполняется до трёх запросов количества устройств (`count_active_devices`, `count_discoverable_active_devices`).

### O5. Загрузка `_load_local_items_unlocked` на каждый `touch`/`list` в файловом режиме (low, confidence medium)
- `equipment_recent_cards_service.py:200` и аналоги: весь JSON читается и пишется целиком при каждом обновлении. Для fallback-режима без БД приемлемо, но растёт линейно с числом пользователей. Низкий приоритет.

### O6. Конструкции планирования: повторный `json.loads` в циклах (low, confidence high)
- `construction_planning_service.py:83-84` и `:88`: `json.loads(row.plan_json)['archived']` для каждого target и для каждого `work_id` каждого назначения (`any(... json.loads(items[w].plan_json) ...)`). Для большого плана декодируется многократно одна и та же строка. Fix: декодировать один раз в словарь.

### O7. `_prune_memory_locked` выполняется на каждой операции memory-бэкенда (low, confidence high)
- `auth_runtime_store_service.py:127-135`: полный проход по `self._memory` при каждом `get/set/pop/increment`. Бэкенд используется только в dev/test (`:82-89`), поэтому влияние ограничено; при росте числа ключей (rate-limit counters) цена линейна.

### O8. `hub_service.add_task_attachment_from_path`: I/O под глобальной блокировкой (medium, confidence high)
- `WEB-itinvent/backend/services/hub_service.py:6692-6705`: `read_bytes()` целого файла и `_store_attachment_file` (`write_bytes`, `:3555-3570`) выполняются внутри `with self._lock, self._connect() as conn:` (`:6705`). Все остальные операции hub-хранилища (sqlite-режим) ждут окончания записи файла.
- Fix: прочитать и записать файл вне блокировки, в блокировке только INSERT.

---

## Dead code

### DC1 (dead). `wait_refresh_rotation_grace` не вызывается (low, confidence high)
- `WEB-itinvent/backend/services/auth_runtime_store_service.py:519-533`: поиск по всему репозиторию (`rg`) даёт только определение; `api/v1/auth.py:1460` использует `get_refresh_rotation_grace`, а не `wait_*`. Метод опрашивает `time.sleep` до 0.25 с и не используется, его удаление снимает блокирующую ветку, которая в будущем может попасть в async-путь.

### DC2 (dead). `save_refresh_rotation_grace` не вызывается (low, confidence high)
- `auth_runtime_store_service.py:500-510`: grep показывает только определение; запись grace в проде делается через `complete_refresh_rotation` (`:438-498`). Либо удалить, либо подтвердить, что нужен для тестов.

### DC3 (dead). Атрибут `_redis_client` оставлен «для старых тестов» (low, confidence high)
- `auth_runtime_store_service.py:59`: `self._redis_client = None  # Kept for old tests/monkeypatches; Redis is no longer used.` Redis не используется; атрибут нигде не читается в сервисе. Удалить вместе с monkeypatch в тестах.

### DC4 (dead). `consume_once` и `pop_json` — два имени для одного `pop_text`
- `auth_runtime_store_service.py:270-271` (`consume_once` = `pop_text`) и `:285-292` (`pop_json` через `consume_once`). Используется `adfs_sso_service.py:114`, но вторая точка входа не нужна.

### DC5 (dead, частично). Функции без вызовов в `equipment_recent_acts_service.py`
- `_normalize_doc_no` (`:52`) вызывается в `:194` — не dead. Полный поиск мёртвых функций (AST/`rg` по всем определениям a..m) не завершён: фоновый скан прерван из-за времени (тайм-аут по 120 с на каждый файл). Список кандидатов подлежит отдельной проверке.

### DC6. Модули без импортёров в проде не найдены
- Проверено: каждый модуль a..m имеет хотя бы одного импортёра (`rg` по `services.<name>` и `from ... import`). Пример: `dlp_report_service` импортируется только `api/v1/fs_egress.py`, `excel_export_service` — только `api/v1/json_operations.py:60`. Кандидаты на удаление отсутствуют.

---

## Не проверено / ограничения
- Блокирующие вызовы внутри `async def` (AST-скан): не выполнен, `python` недоступен из bash и из `py`. Проверено выборочно (`mfu_monitor_service`, `docflow_service`, `adfs_sso_service`, `app_push_outbox_service`).
- Полный список мёртвых функций: не завершён (см. D5).
- Поведение с реальным ldap3 (B12, B11) и реальными Windows-путями (B21) по коду; без запуска не подтверждено.
- B2 может быть намеренным решением (SSO = доверенный фактор), нужно подтверждение владельца политики 2FA.
- Не просматривались целиком: `hub_service.py` (10k строк), `mail_service.py` (5.5k), `address_book_service.py`, `mfu_monitor_service.py` (кроме ping и SNMP-конфига), `docflow_1c_client.py`, `docflow_dm_service_client.py`, `env_settings_service.py`, `equipment_db_transfer_service.py` (выборочно: SQL-идентификаторы `_next_id:118`, `_insert_row:728`, цикл переноса `:1030-1077` с общей транзакцией — признаков потери данных не найдено).

## Итог по приоритету
1. B1 (2FA-bypass через повторную регистрацию TOTP) — критично, исправлять сразу.
2. B4 (удаление blob до коммита) — высокий риск потери данных.
3. B2 (SSO без 2FA) — уточнить политику и исправить.
4. B7, B8, B11, B13 — гонки и отказоустойчивость.
5. Остальное — оптимизация и дубли.
