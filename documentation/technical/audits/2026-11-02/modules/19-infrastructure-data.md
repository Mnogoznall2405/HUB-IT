# 19. Данные, SQL-пулы, миграции и эксплуатационный контур

Дата: 2026-11-02. Режим: диагностика; изменяется только документация аудита.
Главный вывод: защита Hub-мигратора и изоляция Scan-тестов уже изменены извне, но аналогичные разрушительные пути остаются в других миграторах. В SQL Server pool воспроизведён возврат неисправного соединения после ошибки rollback.

## Границы и карта

| Контур | Точки входа | Владение и завершение |
|---|---|---|
| App PostgreSQL | `WEB-itinvent/backend/appdb/db.py:113`, `:144`, `:168` | Engine/session factories на процесс; session commit/rollback/close в context manager |
| Chat PostgreSQL | `WEB-itinvent/backend/chat/db.py:192`, `:247`, `:464` | Разные read/write pools; schema translation и проверка готовности |
| Legacy SQL Server | `WEB-itinvent/backend/database/connection.py:91`, `:200` | pyodbc pool на connection string; transaction завершается при выходе |
| JSON compatibility | `local_store.py:224`, `:366`, `:439` | SQLite document-store; транзакционная перезапись одного документа |
| Schema deployment | `WEB-itinvent/backend/alembic/env.py:39` | Явная цель; Alembic отдельно от runtime |
| Одноразовый перенос | `scripts/migrate_hub_sqlite_to_postgres.py:47`, `scripts/migrate_network_sqlite_to_postgres.py:41` | Собственный control flow, не единая безопасная библиотека |
| PM2 orchestration | `scripts/pm2/ecosystem.all.config.js:1`, `scripts/pm2/runtime-operations.ps1:23` | Стандартные скрипты, operation locks, проверка ожидаемого набора |
| Tests | `tests/conftest.py:34`, `tests/test_scan_pg_compat.py:21` | Изолированные APP/CHAT/Inventory; теперь отдельный Scan test URL |

Путь обычного доменного запроса: FastAPI dependency → service/store → app_session/DatabaseConnectionManager → DB transaction → serialization. Пул ограничивает соединения, но сам по себе не ограничивает число ожидающих request/threadpool задач. Общий бюджет PostgreSQL должен учитывать все процессы и dedicated realtime connections.

## Инварианты

1. Runtime не применяет DDL к production; несовместимая схема даёт явный отказ.
2. Неудачная миграция не оставляет ранее заполненную цель пустой.
3. Dry-run не должен создавать/изменять доменные данные как побочный эффект инициализации сервисов.
4. DB-тест не выбирает обычный runtime URL из dotenv.
5. Соединение с неизвестным/сломавшимся transaction state не возвращается в pool.
6. Инициализация engine на один URL в одном процессе не размножает pools при конкурентном первом доступе.
7. PM2 online не равен readiness; после согласованной операции проверяются listener/health/effective config.
8. Секреты и сырые jlist environment не попадают в отчёт.

## Находки

### DOPS-01 — другие миграторы сохраняют committed DELETE до копирования

- Severity: **High**, потенциальная полная потеря данных при ручном запуске; S по текущему коду. Связан с OP-01, но относится к оставшимся файлам.
- Доказательства: `scripts/migrate_network_sqlite_to_postgres.py:83` DELETE, `:84` отдельный commit, `:87` пропуск отсутствующей таблицы; `scripts/migrate_mail_sqlite_to_postgres.py:77`, `:78`; `scripts/migrate_mfu_sqlite_to_postgres.py:73`, `:74`; `scripts/migrate_reminders_sqlite_to_postgres.py:72`, `:73`; `scripts/migrate_env_audit_sqlite_to_postgres.py:62`, `:63`.
- Caller: прямой запуск CLI; `WEB-itinvent/README.md:97` описывает перенос сети как обычную процедуру. Автоматического запуска этих файлов не установлено.
- Сценарий: существующая, но неверная/неполная SQLite → DELETE target → commit → пропущенные таблицы или ошибка INSERT. Rollback после ошибки уже не восстанавливает исходные rows.
- Безопасность Hub-мигратора не распространяется на эти пять файлов. Единое имя migrate_* не означает единый контракт.
- Минимальная стратегия: общие preflight-проверки source/target, dry-run по умолчанию, явное execute/overwrite, одна транзакция DELETE+INSERT, контроль количества и обязательных полей. Не переносить эти проверки через вызовы живого runtime с побочными инициализаторами.
- Приёмка: заполненная тестовая цель сохраняется при пустом/неполном источнике, ошибке N-го INSERT, отказе диска и отсутствии execute; overwrite требует отдельного флага.
- Эти миграторы не запускались против PostgreSQL. Полный перечень FK и sequence последствий не проверялся.

### DOPS-02 — сломанное rollback-соединение возвращается в SQL Server pool

- Severity: **Medium**, R — реальная функция/context manager с fake transport, без pyodbc connect.
- Источник: `WEB-itinvent/backend/database/connection.py:200`, `:214`, `:216`, `:219`; `:150` release; `:112` acquire.
- При ошибке query вызывается rollback; если rollback тоже падает, finally всё равно делает release. Release ставит conn в очередь с текущим monotonic timestamp. Следующий быстрый acquire не делает idle ping и возвращает тот же объект.
- Harness: реальный AST `_PyodbcConnectionPool` и `DatabaseConnectionManager`; Broken.rollback выбрасывает исключение; после контекста следующий acquire вернул тот же Broken. Вывод: `broken rollback connection returned to pool and borrowed again: True`, exit=0.
- Следствие: повторные ошибки следующих запросов, маскировка исходной ошибки ошибкой rollback, расход времени на заведомо неработающий ресурс. Реальная частота SQL Server disconnect не измерена.
- Исправление: отдельный discard/close с корректным уменьшением created; release только для подтверждённо пригодного transaction state. Ошибку rollback логировать без замены исходной причины, где это позволяет контракт.
- Приёмка: disconnect на execute/commit/rollback; следующий borrow получает новый conn; created/queue не расходятся; pool не зависает после серии discard.

### DOPS-03 — конкурентный первый доступ создаёт несколько App engines на один URL

- Severity: **Medium**, R механизма, фактические DB connections не создавались.
- Источник: `WEB-itinvent/backend/appdb/db.py:144`, `:153`.
- `dict.get → build → dict.set` не защищён единым lock; GIL не делает последовательность атомарной, а реальный builder может отдавать управление во внешние операции.
- Harness: реальный AST get_app_engine, два threads, Barrier внутри заменённого builder. Получено created=2, distinct_returns=True, cached=1.
- Это не доказательство постоянной утечки всех созданных engines: время жизни вытесненного объекта зависит от callers/GC. Подтверждены лишняя инициализация и нарушение singleton-контракта; связанные session factory могут временно ссылаться на разные pools.
- Исправление: lock с повторной проверкой для создания engine/factory; не выполнять создание на каждый запрос и не вводить глобальный lock на сами транзакции.
- Приёмка: 20 одновременных первых обращений → один builder на URL, независимые URL не блокируют дальнейшие обычные чтения; ошибка builder не оставляет битый cache entry.

### DOPS-04 — ожидание SQL Server pool выдаёт соединение без проверки idle health

- Severity: **Low**, S; частота/влияние не измерены.
- Источник: `WEB-itinvent/backend/database/connection.py:112`, `:147`.
- Быстрый get_nowait путь выполняет idle SELECT 1, но blocking get(timeout=30) возвращает conn без той же проверки. При насыщении pool первый путь и путь ожидания имеют разные гарантии health.
- Не каждый выданный после ожидания conn неисправен: обычно его только что вернул другой запрос. Finding ограничен отсутствием единого health/error policy, особенно вместе с DOPS-02.
- Рекомендация: общий validate/discard этап после обоих borrow-путей; измерять acquire wait и discard count. Не добавлять SELECT 1 безусловно на каждый запрос без baseline.
- Приёмка: waiter получает умершее соединение → discard/retry в bounded срок; живой свежий conn не добавляет лишний ping.

## Уточнения к первому проходу

| Пункт | Текущий факт | Статус |
|---|---|---|
| OP-01 Hub | `scripts/migrate_hub_sqlite_to_postgres.py:29` execute, `:34` overwrite, `:87` completeness, `:113` общая транзакция | Исходный небезопасный control flow изменён извне; 4 локальных теста passed. Не утверждается проверка production/release. |
| OP-02 Scan test URL | `tests/conftest.py:53`; `tests/test_scan_pg_compat.py:21` test URL/name guard | Прямой путь обычного runtime URL закрыт в этих файлах; PG тесты намеренно skipped без dedicated URL. |
| Runtime app/chat DDL | `WEB-itinvent/backend/appdb/db.py:47`, `:254`; `WEB-itinvent/backend/chat/db.py:464` | Добавлен fail-closed APP_SCHEMA_DEV_AUTO_CREATE; нельзя повторять прежний общий вывод «development всегда запускает DDL». |
| Scan DDL | `scan_server/db.py:63` | Отдельный контур; остаётся в отчёте 12. |
| OP-03 ignore | `.gitignore:12` | Узкое исключение появилось; portable source tracking/build проверяются в отчёте 15. |

## Проверенные сценарии и границы

| Сценарий | Метод | Результат |
|---|---|---|
| Пустой Hub source поверх заполненного target | Существующий pytest с временными SQLite | Refused, прежняя строка сохранена |
| Неполный Hub source | Тот же профиль | Refused |
| Заполненная цель без overwrite | Тот же профиль | Refused |
| Execute+overwrite с корректным source | Тот же профиль | Успешная замена тестовых rows |
| Scan test без test URL | Три local checks + два PG tests | 3 passed, 2 skipped |
| Query exception + rollback exception | AST real context manager | Неисправный conn повторно выдан |
| Два первых get_app_engine | AST real getter + builder Barrier | Два engines, один cache entry |
| Production migrations, restart, DDL, integrity SQL | Не запускались | Непроверено |

Команда: `python -m pytest -q tests/test_migrate_hub_sqlite_script.py tests/test_scan_pg_compat.py`.
Результат: **7 passed, 2 skipped, 4 warnings, 14,23 с, exit=0**. Atexit pytest: WinError 5 при очистке старого pytest-current вне repo; assertions успешны, уборка окружения не полностью успешна.
APP_ENV=development, live opt-in выключен, SCAN_DATABASE_URL и SCAN_TEST_DATABASE_URL явно пустые. Conftest задаёт изолированные APP/CHAT/Inventory пути.

## Производительность и ресурсный бюджет

- App pool: size+overflow на процесс (`WEB-itinvent/backend/appdb/db.py:132`); Chat считает read+write отдельно (`WEB-itinvent/backend/chat/db.py:192`). Числа из конфигурации не равны текущим server connections.
- `scripts/pm2/postgres_connection_budget.js:1` учитывает явные pool caps и dedicated realtime connections; unmanaged clients должен учитывать живой server-wide запрос, который здесь не выполнялся.
- SQL Server pool ограничен на connection string, но `_POOLS` хранит конфигурационные ключи весь срок процесса. Сценарий неограниченной динамической смены config не подтверждён, поэтому отдельной утечкой это не названо.
- Baseline для исправлений: p50/p95/p99 acquire wait, SQL time, rollback/discard errors, число pools и фактических connections, queueing time внешнего threadpool.
- Нагрузку повторять с теми же DB/объёмом/concurrency. Ни оптимизация, ни production slowdown этим аудитом численно не доказаны.

## Что проверено и не стало дефектом

- `WEB-itinvent/backend/alembic/env.py:39` не берёт URL из root .env: полезный fail-closed guard.
- `runtime-operations.ps1:23` использует bounded client timeout, Hidden window, удаляет временный сырой jlist. Сам скрипт не запускался.
- `pm2-boot-resurrect.ps1:1` описывает staged startup/readiness; по статике нельзя заявлять, что live Task Scheduler/PM2 соответствует этому сценарию.
- Транзакционный save_json документа — атомарная запись документа. Lost update зависит от caller read-modify-write; общий метод не объявляется причиной потери без caller trace.

## План исправлений и дополнительной приёмки

1. DOPS-01: безопасный общий контракт всех одноразовых миграторов; блокирующий gate до их применения.
2. DOPS-02: pool discard и fault-injection на реальные transaction boundaries.
3. DOPS-03: сериализация первого создания engine/session factory.
4. Проверить upgrade/downgrade всей новой цепочки на test DB, включая schema translate chat/public, индексы/FK и rollback.
5. Только по отдельному production-согласованию: фактическая схема, duplicates/orphans, locks, disk, readiness/listeners и backup/restore drill.

Прочитаны: appdb/db.py, chat/db.py (релевантные engine/schema sections), database/connection.py, local_store.py (load/save sections), alembic/env.py, migrate_hub/network/mail/mfu/reminders/env_audit и AST-инвентарь остальных migrate_*; conftest, test_migrate_hub_sqlite_script, test_scan_pg_compat, test_postgres_connection_budget_script; ecosystem.all, runtime-operations, runtime-policy, postgres_connection_budget, boot-resurrect/restart-backend sections.
Не проверены целиком все PowerShell deployment scripts, live dump.pm2/Windows tasks, исторические БД и backup bytes. Секреты не читались и не выводились.
