# Аудит БД и миграций: WEB-itinvent/backend (read-only)

Область: `backend/database` (pyodbc/SQL Server), `backend/appdb` (PostgreSQL ORM, db.py, json_store), `backend/alembic` (versions + env.py), `db_migrations.py`, `db_schema.py`, `config.py`, `json_db/`, `models/`, `utils/`, `scripts/`. Смежные точки, которые напрямую влияют на эту область: `local_store.py` (корень репозитория, используется `json_db/manager.py`), `chat/postgres_realtime.py`, `services/equipment_db_transfer_service.py`, `scripts/` в корне репозитория.

Ограничения: БД не запрашивалась; `alembic check`/`upgrade` не запускались; код не выполнялся. Сверка моделей и миграций выполнена по именам таблиц и индексов (regex + grep), не по колонкам. Проверка «мёртвого» кода выполнена grep по всему репозиторию (включая `tests/`, `scripts/`, корневой `local_store.py`). `queries.py` (5298 строк) просмотрен структурно и по ключевым местам.

Из корневого `.env` прочитаны только два ключа (значения): `APP_ENV=development`, `APP_SCHEMA_DEV_AUTO_CREATE=0`. Остальное содержимое файла не читалось.

Что проверено и в порядке:
- Alembic: 140 ревизий, уникальные `revision`, одна голова `20261016_0137`, нет битых `down_revision`, один корень `20260327_0001`, merge `20260328_0010` корректен.
- pyodbc: пользовательские значения идут через `?`; динамические идентификаторы проходят `_quote_sqlserver_identifier` (`queries.py:65-70`, `equipment_act_history_reads.py:34-39`), f-string с LIMIT приведены к int.
- `alembic/env.py:46-61`: URL обязан задаваться явно, корневой `.env` не используется.
- `db_migrations.check_internal_database_revision` только читает версию.
- Инициализация PostgreSQL защищена advisory lock 48151623 (`db.py:33`, `:260-264`).

Порядок приоритетов (с учётом зависимостей):
1. B-01: ротировать пароли, удалить `migrate_vcs_info.py`.
2. B-06: добавить Alembic-миграцию для пяти таблиц и проверить прод-БД. Это обязательное условие перед отключением DDL (B-02).
3. B-02 + C-07: безопасные значения по умолчанию для DDL и `APP_ENV`; исправить `.env.example`.
4. B-13: убрать runtime DDL в realtime-пути (работает независимо от флага DDL).
5. B-03, B-04, B-05: maintenance в SAVEPOINT; пакетная очистка change-events; проверка результата `save_json`/`append_to_json`.
6. B-16, B-18, B-17: ограничить `replace_from_legacy`; исправить scope-gate в миграциях чата; сверить индексы и unique-constraints на проде.

---

## Bugs

### B-01. Пароли внешних учётных записей в git (critical, high)
- Файл: `WEB-itinvent/backend/migrate_vcs_info.py:9-20` (список `json_data`, 10 записей с логинами и паролями).
- Описание: в tracked-файле захардкожены логины и пароли внешних серверов. Файл попал в коммит `6ac02e7e` и остаётся в истории.
- Сценарий: любой, у кого есть доступ к репозиторию или его истории, получает эти учётные данные. Нарушает AGENTS.md («Secrets»).
- Что сделать: ротировать все перечисленные пароли; удалить файл. Переписывание истории — решение пользователя.

### B-02. Старт может выполнять DDL: дефолты кода и примера небезопасны (medium, high)
- Файлы: `appdb/db.py:55` (`APP_SCHEMA_DEV_AUTO_CREATE` по умолчанию `"1"`), `appdb/db.py:250` (guard только при `config.app.is_production` или выключенном флаге), `appdb/db.py:260-270` (`create_all` и maintenance в одной транзакции), `config.py:369` (`APP_ENV` по умолчанию `development`).
- Текущее состояние: в корневом `.env` стоит `APP_SCHEMA_DEV_AUTO_CREATE=0`, поэтому DDL-ветка выключена на этой конфигурации. Ветка остаётся включённой для любого окружения, где флаг не задан или равен `1`, и при `APP_ENV` не из `prod`/`production`.
- Сценарий: новый или переустановленный хост, скопировавший `.env.example` (см. C-07), на каждом старте воркера выполняет `CREATE SCHEMA`, `create_all`, `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX` против живой БД. Это противоречит AGENTS.md («production processes never apply migrations»). Advisory lock сериализует процессы, но не запрещает DDL.
- Исправление: дефолт `APP_SCHEMA_DEV_AUTO_CREATE` в `0`; DDL разрешать только явным флагом; `APP_ENV` без значения трактовать как production либо требовать явного значения. Сначала закрыть B-06.

### B-03. Ошибка одного statement отключает всю maintenance-пачку PostgreSQL (medium, high)
- Файлы: `appdb/db.py:176-209` (цикл с `try/except` на строках 205-209), `appdb/db.py:260-270` (всё внутри одной `engine.begin()`).
- Описание: все `ALTER`/`CREATE INDEX` выполняются в одной транзакции. Исключение на любом statement проглатывается и логируется как «Skipped». После ошибки PostgreSQL переводит транзакцию в aborted, все последующие statements падают с `InFailedSqlTransaction`, а commit при выходе из контекста откатывает всё молча.
- Сценарий: `SET LOCAL lock_timeout = '500ms'` (`db.py:265`) и `ALTER TABLE "app"."users" ALTER COLUMN "telegram_id" TYPE BIGINT` (`db.py:178`). `ALTER TABLE ... ALTER COLUMN TYPE` берёт `ACCESS EXCLUSIVE` даже когда тип не меняется (ожидаемое поведение PostgreSQL, не проверено на живой БД). При конкуренции за блокировку statement падает, остальные колонки и индексы (`db.py:179-203`) не применяются, старт проходит с одним warning на каждый statement.
- Уточнение: `create_all` (`db.py:269`) стоит в той же транзакции, но его исключение не перехватывается и даёт громкий отказ старта. Тихо теряется только maintenance.
- Активность: только при включённой DDL-ветке (см. B-02).
- Исправление: `SAVEPOINT` на каждый statement либо fail-fast.

### B-04. Синхронная неограниченная очистка change-events на пути записи (high)
- Файлы: `appdb/inventory_store.py:848-858` (`prune_change_events`); вызовы `inventory_runtime.py:726`, `inventory_runtime.py:741`, `api/v1/inventory.py:297`, `api/v1/inventory.py:312`.
- Описание: функция загружает в память все `event_id` старше cutoff (строки 850-852), затем одним `DELETE` без батчей (строка 855). Возвращается `len(rows)`, а не число реально удалённых строк. Вызывается на каждой записи change-events.
- Сценарий: при накоплении бэклога каждая запись ingest держит долгую блокирующую транзакцию и тянет O(N) строк в память. Нарушает AGENTS.md (cleanup: bounded batches, dry-run, feature flag, single-run lock).

### B-05. Ошибки записи JSON проглатываются, вызывающие их игнорируют (high)
- Файлы: `appdb/json_store.py:104-149` (`save_json`, `except Exception: return False` на строках 148-149), `appdb/json_store.py:151-182` (`append_to_json`, строки 181-182); `local_store.py:439-462` и `:464-482` (то же, с `logger.error`).
- Вызовы без проверки результата: `json_db/transfers.py:89`, `json_db/works.py:227`, `:372`, `:648`, `:654`, `:821`.
- Сценарий: при таймауте блокировки или обрыве соединения во время добавления записи о перемещении (`transfers.py:89`) вызывающий логирует «Added transfer» и возвращает запись. Запись потеряна, пользователь ошибки не видит.

### B-06. Пять таблиц ORM не создаются ни одной миграцией (high)
- Модели: `appdb/models.py:388-391` (`employee_absences`, `AppEmployeeAbsence`), `:1212-1213` (`ai_bot_runs`), `:1238-1239` (`transfer_act_jobs`), `:1263-1264` (`ai_pending_actions`), `:1289-1290` (`ai_kb_documents`).
- Доказательство: `rg` по `alembic/versions` даёт 0 упоминаний каждой из пяти таблиц. Упоминания в `appdb/db.py:190-203` и `:335-348` — только `ALTER`/`CREATE INDEX`, которые предполагают, что таблица уже существует.
- Что это значит: таблицы появляются только через dev-`create_all` (B-02). БД, созданная одними миграциями (новый стенд, восстановление из бэкапа, чистая установка), их не содержит. Тогда первый запуск AI-бота, задачи перемещения акта или запрос отсутствий (`services/address_book_service.py:2216`) падает с `UndefinedTable`. Прод-состояние не проверено.
- Порядок: сначала миграция, которая создаёт эти таблицы (с проверкой существования), затем отключение DDL (B-02). Иначе отключение DDL сломает функции на БД, где таблиц нет.

### B-07. Блокировка отсутствует при изменении cartridge DB (medium)
- Файлы: `json_db/cartridges.py:311-313` (`_load_raw_database`), `:315-317` (`_save_raw_database`), `:86` (кэш чтения), `:304-308` (`reload`).
- Описание: `cartridge_database.json` общий с ботом (CLAUDE.md). Цикл «прочитать, изменить, записать» выполняется без блокировки. Запись идёт всем документом (`json_store.py:116-124`). `reload()` очищает только кэш текущего процесса.
- Сценарий: две правки администратора или запись бота в окне между чтением и записью: одна правка теряется. Другой процесс продолжает работать на устаревшем кэше до рестарта.

### B-08. Read-modify-write без блокировки: `update_json_array` и non-list append (medium, latent)
- Файлы: `appdb/json_store.py:184-204` (load на строке 190, save на 203), `appdb/json_store.py:151-159` (non-list ветка append), `local_store.py:484-505`, `json_db/manager.py:103-105`.
- Описание: цикл «прочитать, изменить, записать» без транзакции и без версии. Конкурентная запись между load и save теряется.
- Текущий риск: единственный вызов `update_json_array` — из `tests/test_json_manager_app_db.py:109` (см. X-01). Латентно; станет реальным при появлении продового вызова.

### B-09. Строка подключения ODBC собрана без экранирования (medium, medium)
- Файл: `database/connection.py:47-57` (строка 54: `PWD={db_config['password']};`, строки 50-52: `DRIVER`, `SERVER`, `DATABASE`, `UID` без фигурных скобок).
- Описание: значения пароля и логина вставляются как есть. По правилам ODBC значения со спецсимволами (`;`, `}`) должны быть заключены в `{...}` с удвоением `}`.
- Сценарий: пароль из `DB_{ID}_PASSWORD` или `SQL_SERVER_PASSWORD` с `;` обрезается, остаток строки разбирается как отдельный атрибут. Вход падает или идёт с неверным паролем.
- Confidence medium: правило проверено по документации ODBC, не на реальном драйвере.

### B-10. Битое соединение возвращается в пул (medium, medium)
- Файл: `database/connection.py:213-220` (`get_connection`).
- Описание: если `conn.rollback()` в `except` (строка 216) сам падает, исключение пробрасывается, но `finally` (строки 219-220) всё равно вызывает `self._pool.release(conn)`. Соединение в неопределённом состоянии возвращается в пул и переиспользуется.

### B-11. Production-проверки конфигурации выключены в текущем `.env` (medium, high)
- Файлы: `config.py:369` (`APP_ENV`/`ENVIRONMENT` по умолчанию `development`), `:378` (JWT placeholder по умолчанию), `:389-393` (хост `10.103.0.213`, пустой пароль по умолчанию), `:579-589` (`validate()` проверяет JWT и `AUTH_COOKIE_SECURE` только для `prod`/`production`).
- Подтверждено для текущего `.env`: `APP_ENV=development`, значит `validate()` не выполняется, placeholder-секрет и `AUTH_COOKIE_SECURE=false` допустимы.
- Сценарий: при `APP_ENV=staging` или отсутствии переменной JWT-секрет остаётся `your-secret-key-change-in-production`, cookie без `Secure`. Тот же корень, что B-02.

### B-12. Downgrade шести миграций — осознанный no-op (low)
- Файлы (`alembic/versions/`): `20261002_0125_chat_scheduled_messages_ensure.py:88-90`, `20261012_0129_chat_group_admin_audit.py:64-66`, `20261013_0130_chat_group_invites.py:68-70`, `20261013_0131_chat_group_limits.py:61-63`, `20261013_0132_chat_group_restrictions.py:64-66`, `20261013_0133_chat_group_permissions.py:61-63`.
- Описание: `downgrade()` содержит только `pass` и комментарий с обоснованием (например, «an audit journal must not be dropped»). Таблицы не удаляются, повторный `upgrade` пропускает создание из-за `_has_table`.
- Оценка: не нарушение, но downgrade не зеркалит upgrade. Решение о таком подходе принимает команда; в отчёте зафиксировано как осознанное.

### B-13. Runtime DDL в realtime-пути чата на не-production (medium, high)
- Файлы: `chat/postgres_realtime.py:1101-1111` (`_ensure_publisher_unlocked` вызывает `_ensure_relay_table_sync` при каждом (пере)подключении), `:1144-1158` (`CREATE TABLE IF NOT EXISTS` выполняется только если не `config.app.is_production`, проверка на строке 1153), `:1176-1190` (`CREATE INDEX IF NOT EXISTS`).
- Описание: DDL в пути публикации и presence. Не зависит от `APP_SCHEMA_DEV_AUTO_CREATE`, поэтому активен на текущем `.env` (`APP_ENV=development`) при работе PostgreSQL realtime.
- Исправление: проверку наличия таблиц заменить валидацией (как в ветке production, `_validate_relay_schema_sync`) и для всех окружений.

### B-14. Миграции переписывают версионируемую документацию (low, high)
- Файлы: `alembic/env.py:91-113` (`_refresh_pg_schema_documentation_after_migration`, вызывается после каждого `upgrade`), `appdb/db.py:212-229` (dev-ветка, активна при включённом DDL), `scripts/pg_schema_docs.py:493-497` (перезапись `POSTGRES_APP_SCHEMA_DDL.md`), `:460` (`POSTGRES_APP_SCHEMA.md`).
- Описание: при каждом `alembic upgrade` файлы в `documentation/technical/` перезаписываются. На рабочем дереве прода это грязнит git. Отключается переменной `SKIP_PG_SCHEMA_DOCS`.

### B-15. Гонка при выделении `sort_order` в json_records (low, high)
- Файлы: `appdb/json_store.py:164-170` (`max + 1` без блокировки), `appdb/models.py:1467-1476` (нет unique по `(file_name, sort_order)`).
- Описание: два параллельных append могут получить одинаковый `sort_order`. Порядок остаётся детерминированным за счёт `id`, поэтому влияние мало.

### B-16. `replace_from_legacy` — полная перезапись, используется миграционными скриптами (medium, high)
- Файлы: `appdb/inventory_store.py:858-…` (удаляет всех хостов, change events, профили пользователей, outlook-файлы, SQL-контексты в одной транзакции).
- Вызовы: `scripts/migrate_inventory_sqlite_to_postgres.py:52`, `scripts/perf/bench_inventory_store.py:130`, `tests/test_inventory_perf.py:99`. Не мёртвый код.
- Риск: если вызов попадёт в рабочий путь, история change events и данные инвентаризации будут удалены. Нужен guard или явная пометка «только разовая миграция».

### B-17. Имена индексов и unique-constraints из моделей не найдены ни в одной миграции (medium, medium)
- Проверка: для 285 имён индексов и constraints из моделей подстрочный поиск по `alembic/versions`. Нулевые совпадения у 14:
  - `ix_app_ai_bot_runs_bot_conversation_created_at`, `ix_app_ai_bot_runs_status_created_at` (`appdb/models.py:1215-1216`);
  - `ix_app_ai_kb_chunks_document_id_chunk_index`, `ix_app_ai_kb_chunks_kb_article_id`;
  - `ix_app_ai_pending_actions_run_status`, `ix_app_ai_pending_actions_status_expires_at` (`models.py:1266-1267`);
  - `ix_app_employee_absences_range`, `ix_app_employee_absences_user_id` (`models.py:393-394`);
  - `ix_app_transfer_act_jobs_status_created_at`, `ix_app_transfer_act_jobs_user_created_at` (`models.py:1241-1242`);
  - `ix_chat_messages_conversation_id_conversation_seq` (`chat/models.py:220`). Runtime-DDL создаёт другое имя `idx_chat_messages_conversation_id_conversation_seq` (`chat/db.py:627`), поэтому на dev индекс дублируется, а на проде индекса с этим именем нет;
  - `uq_app_ai_bots_slug`, `uq_app_ai_bot_conversations_conversation`, `uq_app_ai_kb_documents_article`.
- Примечание: восемь имён относятся к таблицам из B-06 (`ai_bot_runs`, `ai_pending_actions`, `employee_absences`, `transfer_act_jobs`). Два имени `ix_app_ai_kb_chunks_*` относятся к `ai_kb_chunks`, которую в миграциях найти не удалось (проверить отдельно). Для unique-constraints возможна безымянная констрейнт в DDL, поэтому перед выводом проверить `pg_constraint` и `pg_indexes` на реальной БД.

### B-18. Миграции чата выходят по `itinvent_scope == "app"` (medium, high)
- Нарушение AGENTS.md: «never skip DDL based on itinvent_scope: check that tables exist».
- Файлы (21 миграция, ранний `return` при `_scope() == "app"`): `20260924_0121_chat_poll_votes.py:40`, `:96`; `20260924_0122_chat_muted_until.py:49`, `:64`; `20260925_0123_chat_message_mentions.py:49`, `:92`; `20261002_0124_chat_scheduled_messages.py:46`, `:87`; `20260618_0051_chat_folders.py:41`, `:97`; `20260618_0050_chat_task_discussions.py:50`, `:83`; `20260501_0027_chat_group_moderation.py:41`, `:68`; `20260502_0028_chat_event_outbox_schema.py:62`, `:123`; `20260418_0020_chat_push_outbox_and_client_message_id.py:26`, `:125`; `20260418_0021_chat_message_seq_and_unread_counters.py:26`, `:153`; `20260417_0019_chat_forward_messages.py:44`, `:65`; `20260406_0015_chat_perf_indexes.py:34`, `:66`; `20260508_0030_chat_message_reactions.py:29`, `:53`; `20260502_0029_chat_message_body_format.py:47`, `:78`; `20260603_0039_chat_voice_attachment_metadata.py:50`, `:64`; `20260609_0047_chat_push_outbox_mentions.py:50`, `:66`; `20260626_0061_chat_messages_body_trgm.py:47`, `:72`; `20260806_0083_chat_attachment_previews.py:32`, `:80`; `20260806_0086_chat_telegram_stickers.py:32`, `:107`; `20260823_0103_chat_pinned_message.py:54`, `:79`; `20260409_0018_chat_attachment_dimensions.py:34`, `:52`.
- Сценарий: запуск миграций с `itinvent_scope=app` при chat-таблицах в той же БД пропускает создание chat-таблиц, но ревизия при этом проставляется. Схема расходится с историей.
- Исправление: проверять существование таблиц, а не scope (как в `20261013_0131` и подобных).

---

## Conflicts

### C-01. Два `get_all_equipment` с разным SQL и форматом ответа (medium, high)
- Вариант A (живой): `database/queries.py:2558-2591` на базе `QUERY_GET_ALL_EQUIPMENT` (`queries.py:222-236`): нормализация ключей, колонки `branch_name`, `location_name`, `status_name`. Вызовы: `api/v1/equipment.py:1042`, `ai_chat/tools/itinvent.py:1429`, тест `tests/test_equipment_search_read_helpers.py:99`.
- Вариант B (мёртвый): `database/equipment_db.py:241-262` на базе `queries_new.QUERY_GET_ALL_EQUIPMENT` (`queries_new.py:7-38`): сырые строки, колонки `description`, `status`, `empl_no`.
- Риск: переподключение на `equipment_db` меняет контракт API. Одно имя, два набора колонок.

### C-02. Одни SQL-константы определены в нескольких модулях (medium, high)
- `QUERY_COUNT_ALL_EQUIPMENT`: `queries.py:245` и `queries_new.py:40` (идентичны).
- `QUERY_GET_ALL_BRANCHES`, `QUERY_GET_ALL_LOCATIONS`: `equipment_directory_reads.py` и `queries_new.py:52`, `:61`.
- `QUERY_GET_ALL_EQUIPMENT_TYPES`: `equipment_reference_reads.py` и `queries_new.py:239`.
- `QUERY_GET_MODELS_BY_TYPE`: `queries.py:251` и `equipment_reference_reads.py`.
- Сценарий: правка одной копии не попадает в другую. Всего шесть дублирующихся имён.

### C-03. Три слоя фасадов для одних имён (medium, high)
- `get_all_branches`: реализация `equipment_directory_reads.py:97`; делегат `queries.py:2594-2595` (`_directory_get_all_branches`); обёртка в `equipment_db.py`.
- Аналогично для 24 имён: `get_model_no_by_name`, `search_equipment_universal`, `get_owner_no_by_name` и др. (делегаты `queries.py:294-305`, `:308-338`, `:3628-3630`, `:4017-4019`).
- Делегация корректна, но публичная поверхность дублируется.

### C-04. Схема поддерживается вручную параллельно Alembic (medium, medium)
- `appdb/db.py:176-209` (PostgreSQL) и `:276-348` (SQLite) содержат ручные `ALTER`/`CREATE INDEX` для `trusted_devices`, `sessions`, `ai_bots`, `ai_bot_runs`, `ai_pending_actions`, `transfer_act_jobs`, `inventory_host_sql_contexts`, `auth_runtime_items`.
- Второй источник правды о схеме. Совпадение с миграциями по колонкам не проверено.

### C-05. Одни таблицы создаются в двух миграциях с переименованием (medium, medium)
- `my_file_blobs`, `my_file_previews`: создаются в `20260603_0040_my_files.py` и `20260608_0046_my_file_previews.py`; `20260909_0110_my_files_blob_v2.py:102-123` переименовывает в `*_v1` и пересоздаёт.
- `ai_sandbox_transfer_grants`, `ai_sandbox_gateway_grants`: `20260815_0099_ai_sandbox.py:209-279` и `20260909_0111_ai_sandbox_grants_repair.py:43-121` (с guard'ами).
- Корректно по guard'ам, но downgrade `0110` опирается на наличие `*_v1`. Не проверено upgrade/downgrade на тестовой БД.

### C-06. Коллизии префиксов номеров миграций (low, high)
- `20261012_0130_equipment_photo_checks.py` и `20261013_0130_chat_group_invites.py`; `20260327_0007_inventory_json_init.py` и `20260328_0007_user_profile_fields.py`; `20260607_0046_my_file_previews_legacy_marker.py` и `20260608_0046_my_file_previews.py`.
- Ревизии (`revision`) уникальны. Путаница для релизного процесса.

### C-07. `.env.example` противоречит своему комментарию: DDL включён (medium, high)
- Файл: `.env.example:639-642`. Комментарий: «Disable development create_all/maintenance DDL on a long-lived server…». Значение: `APP_SCHEMA_DEV_AUTO_CREATE=1`, что по коду (`appdb/db.py:55-56`) означает включение DDL.
- Сценарий: копия примера на сервер включает DDL на долгоживущем хосте (см. B-02).

---

## Duplication

### D-01. Функция `_has_table` скопирована в 72 миграции (low, high)
- Примеры: `20261012_0129_chat_group_admin_audit.py:30-31`, `20261013_0130_chat_group_invites.py:30-31`, `20261013_0131_chat_group_limits.py:29-30`, `20261013_0132_chat_group_restrictions.py:30-31`, `20261013_0133_chat_group_permissions.py:29-30`, `20260909_0110_my_files_blob_v2.py:31-32`, `20260909_0111_ai_sandbox_grants_repair.py:31-32`, `20260815_0099_ai_sandbox.py:27-28`. Также повторяются `_scope()` и `_schema()`.
- Вынести в общий модуль внутри `alembic/`.

### D-02. Служебные функции продублированы в модулях чтения (low, high)
- `_get_db` идентичен в пяти модулях: `equipment_act_history_reads.py:42`, `equipment_reference_reads.py:90`, `equipment_directory_reads.py:60`, `equipment_photos.py:50`, `equipment_search_reads.py:215`.
- `_quote_sqlserver_identifier` идентичен в `queries.py:65-70` и `equipment_act_history_reads.py:34-39`. `_identifier` в `services/equipment_db_transfer_service.py:534-535` — слабее (не проверяет NUL/CRLF).

### D-03. Два построителя строки подключения и повторное чтение переменных пула (low, high)
- `config.py:80-91` (`DatabaseConfig.connection_string`, не используется, см. X-03) и `database/connection.py:47-57`.
- `config.py:457-460`: `CHAT_DB_WRITE_POOL_SIZE` и `CHAT_DB_WRITE_MAX_OVERFLOW` читаются дважды (поля `pool_size` и `write_pool_size`).

---

## Optimization

### O-01. Нет составного индекса для json_records (medium, high)
- Файлы: `appdb/json_store.py:72-75` (`WHERE file_name = ? ORDER BY sort_order, id`), `:164-168` (max `sort_order`), `:97-101` (max `updated_at` по `file_name`); `appdb/models.py:1472-1473` (только одиночные индексы).
- Предложение: миграция с индексами `(file_name, sort_order, id)` и `(file_name, updated_at)`.

### O-02. Каждая запись одного документа переписывает весь файл (medium, high)
- Файлы: `appdb/json_store.py:111-137` (DELETE всех записей и вставка заново), `local_store.py:445-456`. Вызов `update_json_array` (`json_store.py:203`) усиливает эффект, но вызывается только тестом (X-01).
- Последствие: O(N) записей на одно изменение; сбрасываются `created_at` и `id` строк.

### O-03. Истории и поиски по JSON читают весь файл на каждый запрос (medium, high)
- Файлы: `json_db/works.py:264-266`, `:300-302`, `:399`, `:727`, `:736`, `:1035`, `:1107`, `:1135`. `appdb/json_store.py:72-79` декодирует все `payload_json` и фильтрует в Python.
- Предложение: индексируемые ключи (серийный номер, инв. номер) вместо полного списка.

### O-04. Перенос инвентаризации тянет `SELECT *` с BLOB-вложениями (medium, medium)
- Файлы: `services/equipment_db_transfer_service.py:294-297` (`FILES` в `_COPY_TABLES`), `:615-623` (`SELECT * FROM {table} WHERE ...` для каждой таблицы, включая `FILES`), `:373` (`SELECT *` при копировании).
- Последствие: при снимке тянутся `FILE_DATA` всех вложений; память растёт с размером файлов. Колонка `FILE_DATA` в схеме ITEMS не проверена, но по имени и условиям кода это blob.

### O-05. Неограниченные выборки (low, high)
- `appdb/inventory_store.py:172-191` (`list_hosts`): `select(AppInventoryHost).order_by(...)` без пагинации. Вызывающие места не проверены.
- `database/connection.py:244-256` (`execute_query`): читает все строки без лимита. Вызывающие места с `SELECT *` (см. O-04) этим усугубляются.

### O-06. Избыточные индексы-префиксы в AI sandbox (low, high)
- `20260815_0099_ai_sandbox.py`: `ix_app_ai_sandbox_sessions_status` (строка 61) при `_sessions_expiry` (62, префикс `status`); `_sessions_user_id` (60) при `_sessions_user_activity` (63); `_jobs_session_id` (108) при `_jobs_session_created` (116); `_jobs_status` (113) при `_jobs_status_created` (115); `_files_session_id` (170) при `_files_session_kind` (174); `_permissions_user_id` (204) при `_permissions_user_status` (207); `_transfer_grants_job_id` (236) при `_transfer_grants_job` (242); `_transfer_grants_status` (239) при `_transfer_grants_expiry` (241); `_gateway_grants_job_id` (273) при `_gateway_grants_job_status` (278); `_gateway_grants_status` (276) при `_gateway_grants_expiry` (279).
- Повторено в `20260909_0111_ai_sandbox_grants_repair.py`. Последствие: лишние записи при INSERT/UPDATE.

### O-07. Нет индекса на FK `monitoring_targets.profile_id` (low, high)
- Файлы: `appdb/monitoring_models.py:30` (`ForeignKey` без `index=True`), `alembic/versions/20261015_0135_network_monitoring.py:43` (колонка без индекса).
- Последствие: проверки FK при удалении профиля и выборки по профилю сканируют таблицу.

### O-08. Каждая операция local_store открывает новое соединение (low, high)
- Файлы: `local_store.py:239-244` (`_connect()` с `PRAGMA journal_mode=WAL` на каждый вызов), вызовы на строках 444, 476, 509, 517, 550, 577. Контекст-менеджер `sqlite3.Connection` делает commit, но не close; соединение закрывается сборщиком мусора.

---

## Dead code

### X-01. `update_json_array` вызывается только тестом (medium, high)
- Файлы: `json_db/manager.py:103-105`, `appdb/json_store.py:184-204`, `local_store.py:484-505`. Единственный вызов: `tests/test_json_manager_app_db.py:109`. В backend и корневых скриптах вызовов нет.
- Рекомендация: удалить вместе с тестом (это также устраняет B-08) либо оставить с явной пометкой «только тест».

### X-02. `equipment_db.get_all_equipment` не вызывается (medium, high)
- Файлы: `database/equipment_db.py:241-262`. По всему репозиторию: вызовов нет (живой путь — `queries.get_all_equipment`, см. C-01). `queries_new.QUERY_GET_ALL_EQUIPMENT` (`queries_new.py:7-38`) используется только здесь (`equipment_db.py:250`).
- Рекомендация: удалить функцию и константу после решения по C-01.

### X-03. `DatabaseConfig.connection_string` не используется (medium, high)
- Файл: `config.py:80-91`. Поиск `\.connection_string` по всему репозиторию: 0 совпадений. Актуальный построитель: `database/connection.py:47-57`.

### X-04. Одноразовые скрипты в корне backend (medium, high)
Все четыре файла tracked в git; импортёров нет.
- `WEB-itinvent/backend/debug_mail.py`: строка 2 импортирует существующий `services/mail_service.py`, строки 3-4 импортируют `backend.database.session` и `backend.models.user`, которых нет (`database/session.py` и `models/user.py` отсутствуют). Модуль не импортируется, запуск падает с ImportError. Безопасно удалить.
- `WEB-itinvent/backend/find_branches.py`: только чтение (строка 15, `SELECT ... FROM dev_branches`), разовое расследование. Безопасно удалить.
- `WEB-itinvent/backend/delete_branch.py`: разовое жёсткое удаление: город `"tmn"` (строка 10) и название филиала захардкожены; вызов `network_service.delete_branch(..., actor_user_id=1, actor_role='admin')` на строке 20 без dry-run. Безопасно удалить после подтверждения, что удаление уже выполнено. Повторный запуск опасен.
- `WEB-itinvent/backend/migrate_vcs_info.py`: разовая миграция с захардкоженными секретами (B-01); импортирует `api.v1.vcs._save_vcs_info` (строка 6). Безопасно удалить после ротации паролей.
- Не трогать: `scripts/migrate_mail_sqlite_to_app_db.py` (тест `tests/test_mail_sqlite_migration_script.py`), `scripts/merge_ai_bots_into_corp_assistant.py` (тесты `tests/test_ai_bot_merge.py`), бенчмарки `scripts/ai_*_benchmark.py` и `compare_ai_models.py` (задокументированы в docstring).
