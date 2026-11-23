# A4 — Атомарная очередь и последовательная обработка сообщений ИИ

Этап A4 аудита PR #15 (P0-3). Реализация на ветке `fix/ai-conversation-run-serialization-a4` поверх `main` с уже слитым A1 (PR #16, merge `28a81a10`).

Легенда статусов: **CONFIRMED** — воспроизведено/проверено до исправления; **FIXED** — исправлено и подтверждено тестом; **PARTIAL** — проверено частично; **NOT TESTED** — не проверялось; **BLOCKED** — проверить невозможно в доступной среде.

---

## 1. Исходный дефект — CONFIRMED

`AiChatService._process_single_run` выбирал `queued`-run через `SELECT ... ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED` и переводил его в `running`.

`FOR UPDATE SKIP LOCKED` защищает только конкретную строку очереди. Два воркера (даже потока одного процесса — `start_ai_chat_worker.py` запускает `AI_CHAT_WORKER_CONCURRENCY` параллельных claim'ов) могли одновременно захватить **разные** queued-строки **одного** `conversation_id` и обе перевести их в `running` → параллельная обработка сообщений одного диалога: гонки контекста истории, дублирующиеся ответы/действия, нарушение FIFO.

Это подтверждено чтением кода до исправления: в claim-запросе отсутствовала какая-либо сериализация по `conversation_id` — ни предиката, ни блокировки диалога, ни ограничения схемы.

## 2. Способ воспроизведения — FIXED (доказано на PostgreSQL)

`tests/test_ai_run_serialization_pg.py` выполняет claim из независимых `Session`/подключений/потоков с `threading.Barrier`. До исправления запрос не имел per-conversation предиката: два `SELECT FOR UPDATE SKIP LOCKED` по `status='queued'` возвращали разные строки одного диалога и обе транзакции успешно писали `running`. После исправления:

- `test_pg_four_workers_four_queued_one_running`: 4 барьерно синхронизированных воркера, 4 queued-строки одного диалога → ровно 1 claim (`r1`, голова очереди), 0 гонок.
- `test_pg_two_workers_one_conversation_single_running`: ровно один победитель — `r1`.

## 3. Выбранный механизм синхронизации — FIXED

Два взаимодополняющих уровня:

**Уровень 1 — строковая блокировка диалога (основной механизм).** Claim-транзакция берёт `FOR UPDATE ... SKIP LOCKED` на строке `app.ai_bot_conversations` — той же самой строке, которую enqueue держит при вставке нового run (`_enqueue_run` уже делал `.with_for_update()`). Пока claim держит этот лок: (а) ни один enqueue этого диалога не может закоммитить новый run → `queued`-набор заморожен → голова очереди стабильна; (б) второй claim этого же диалога не может быть в полёте — его пробник пропустит эту строку как залоченную и возьмёт следующую свободную голову **в порядке `(created_at,id)`** (SKIP LOCKED вместо NOWAIT — устранение starvation, цикл 3). Лок держится только до коммита claim-транзакции (миллисекунды) — **не** на время LLM-вызова.

**Уровень 2 — частичный уникальный индекс (backstop).** `uq_app_ai_bot_runs_running_conversation ON ai_bot_runs (conversation_id) WHERE status = 'running'` — декларативная гарантия «не более одного running на диалог» для любого пути, обходящего лок (будущий код, прямой SQL, run без mapping-строки). `CREATE INDEX CONCURRENTLY` в миграции.

**FIFO-ключ — `queue_seq`.** `created_at` задаётся приложением (`_utc_now()`), а не БД — при разнобое часов хостов порядок прибытия искажается. Поэтому добавлен `ai_bot_conversations.last_run_seq`, инкрементируемый под локом mapping-строки при enqueue, и `ai_bot_runs.queue_seq`. Порядок внутри диалога: `(COALESCE(queue_seq,-1), created_at, id)` — NULL `queue_seq` (строки до миграции, dev-вставки) сортируется старейшим и детерминировано тай-брейчится `(created_at, id)`.

**Claim-алгоритм** (`_claim_next_queued_run`, цикл 3 — PostgreSQL-ветка через `SKIP LOCKED`):
1. Пробник: `SELECT r.id FROM ai_bot_runs r JOIN ai_bot_conversations m ON m.conversation_id = r.conversation_id WHERE r.status='queued' AND <head-предикаты> ORDER BY r.created_at, r.id FOR UPDATE OF m SKIP LOCKED LIMIT 1`. Залоченные mapping-строки пропускает **сама БД** в порядке сортировки — первая свободная голова находится одним запросом при **любом** числе залоченных диалогов (8, 32, 1000 — границы нет, проблема starvation устранена конструктивно). Параллельно второй пробник (без локов) берёт старейшую голову **без** mapping-строки (edge-case; `FOR UPDATE` на nullable-сторону outer join невозможен) — из двух кандидатов выбирается более ранний по `(created_at, id)`.
2. `SET LOCAL lock_timeout='5s'`; условный `UPDATE ... SET status='running' WHERE id=:id AND status='queued' AND <те же head-предикаты>` (READ COMMITTED перевычисляет предикаты на момент записи).
3. `rowcount=1` → claim состоялся. Иначе `ROLLBACK` и повторный пробник — не более `_AI_CLAIM_MAX_ATTEMPTS=8` попыток на вызов (защита от теоретического ping-pong на горячих гонках; при исчерпании — `None` + warning, следующий опрос воркера повторит).
4. **Классификация ошибок** (`_is_claim_contention`, цикл 2): пропускается только известный contention — `OperationalError` с SQLSTATE `55P03` (lock_not_available: lock_timeout на строке run), `40P01` (deadlock), `40001` (serialization) и `IntegrityError` 23505 именно от `uq_app_ai_bot_runs_running_conversation`. Все прочие ошибки (08xxx соединение, 42P01 схема, 28xxx auth, чужие constraint'ы, NOT NULL) — `rollback` + `raise`: вызывающий код видит реальный сбой, а не «пустую очередь». На sqlite (нет SQLSTATE) contention распознаётся по busy/locked-сообщению и сообщению unique-индекса.

SQLite-ветка (`_claim_next_queued_run_scan`, только dev/test): прежняя bounded-сканирующая версия с keyset-пагинацией 4×8 — файловая блокировка sqlite и так сериализует писателей.

## 4. Почему не альтернативы

| Вариант | Вердикт |
|---|---|
| `NOT EXISTS (running same conv)` без лока | Отклонён: две параллельные транзакции обе видят отсутствие running — это и есть дефект. Предикат оставлен, но только как фильтр + re-check, не как гарантия. |
| `pg_advisory_xact_lock(hashtext(conversation_id))` | Эквивалентен, но не выбран: mapping-строка уже существует, видима в `pg_locks`/мониторинге, не имеет хэш-коллизий и используется enqueue'ом — один и тот же объект синхронизирует обе стороны. |
| Отдельная таблица локов/лейзов | Не выбрана: требует GC-политики при падении до коммита релиза (лишняя сложность при равной семантике). |
| Долгий лок на время выполнения run | Прямо запрещён требованием «не держать лок на время LLM-вызова» и разрушил бы пул соединений. `status='running'` — персистентный claim-маркер. |

## 5. Доказательство атомарности — FIXED (PostgreSQL 16.15)

| Проверка | Тест | Результат |
|---|---|---|
| 2 конкурентных claim одного диалога | `test_pg_two_workers_one_conversation_single_running` | ровно 1 running — PASS |
| 4 конкурентных claim | `test_pg_four_workers_four_queued_one_running` | 1 победитель `r1` — PASS |
| Backstop-индекс сырой SQL | `test_pg_unique_index_exists_and_enforces` | IntegrityError 23505 — PASS |
| Конфликт не теряет задание | crash/rollback-тест | строка остаётся queued — PASS |

Все PG-тесты работают через независимые engine/Session-подключения — эквивалент независимых процессов-воркеров (на уровне транзакций идентично).

## 6. Доказательство FIFO — FIXED

- `test_pg_fifo_order_strict`: 3 run одного диалога → claim-порядок `r1→r2→r3` только после терминального статуса предыдущего.
- `test_pg_queue_seq_beats_created_at`: run с меньшим `queue_seq`, но **бо́льшим** `created_at` claim'ится первым — ключ enqueue-порядка, а не локальное время.
- `test_pg_same_created_at_deterministic`: NULL-seq + одинаковый `created_at` → детерминированный порядок `(created_at, id)`.
- `test_pg_enqueue_cannot_overtake_during_claim`: enqueue не может закоммитить более ранний run, пока claim держит mapping-лок.
- `test_pg_enqueue_mints_monotone_seq_under_mapping_lock`: 4 конкурентных enqueue → `queue_seq` = 1..4 без дыр и дублей, `last_run_seq=4`.

## 7. Параллельность разных диалогов — FIXED

- `test_pg_different_conversations_claim_in_parallel`: convA+convB, 2 барьерных воркера → оба claim'ятся одновременно → 2 running (по одному на диалог).
- `test_pg_busy_conversation_skipped_not_blocked`: convA(running)+convA2(queued)+convB(queued) → выбирается `b1`; занятый диалог не блокирует очередь.
- `test_pg_claim_skips_32_locked_heads_to_reach_free_conversation` (цикл 3, анти-starvation): **32** старейшие головы на диалогах с mapping-строками, запертыми чужими `FOR UPDATE`-транзакциями (за пределом бывшей границы 4×8 — курсор старого скана обнулялся при каждом вызове, и 33-я свободная голова не достигалась никогда); свободный 33-й диалог claim'ится **в том же вызове** одним `SKIP LOCKED`-пробником. Повторный опрос при удерживаемых локах → чистый `None` без ошибок и busy-loop. После освобождения локов обработка восстанавливается строго в `(created_at, id)`-порядке (`locked00` → `locked01`) — starvation не постоянно.

## 8. Отмена и восстановление — FIXED/PARTIAL

| Сценарий | Проверка | Статус |
|---|---|---|
| Отмена running → следующий claim | `test_pg_cancel_frees_the_slot` | FIXED |
| Ошибка run → следующий claim | `test_pg_error_frees_the_slot` | FIXED |
| Падение до commit claim | `test_pg_crash_before_claim_commit_leaves_run_queued` | FIXED — rollback оставляет queued |
| Падение после commit claim (orphan running) | `test_pg_orphaned_running_recovered_by_watchdog_cas` — CAS-форма watchdog из A1 | FIXED — stale running → failed → следующая голова claim'ится |
| Двойное завершение | `test_pg_late_update_cannot_resurrect_finished_run` | FIXED — CAS `status IN (queued,running)` → rowcount=0 |
| Watchdog vs claim одновременно | CAS watchdog и claim работают на разных строках/локах; пересечение — только через `updated_at` guard | PARTIAL — смоделировано формой запроса, не полным вызовом `reap_stale_runs` на PG |
| Поздние side-effects зависшего инструмента | Статус run ≠ завершение физических потоков (A1 wall-timeout) | PARTIAL — остаточный риск задокументирован; идемпотентность outbox/client-id не изменена |

## 9. Влияние на A1 — CONFIRMED

- Watchdog по-прежнему не reap'ит `queued` (политика цикла 4 сохранена — queued-возраст только диагностика). Сериализация это не нарушает: освобождение слота происходит при terminal-переходе running, что и делает watchdog-CAS.
- `cancel_active_run`, `_raise_if_run_cancelled` (heartbeat), финализация `completed/failed` — все переходы используют `status IN ('queued','running')` CAS → совместимы с уникальным индексом (выход из `running` освобождает слот).
- Heartbeat/deadline/таймауты инструментов не затронуты.
- Новых зависимостей на локальные Python-локи нет: вся сериализация — на уровне транзакций PostgreSQL.

## 10. PostgreSQL-интеграционные тесты — FIXED

- Среда: PostgreSQL **16.15** (Ubuntu, dev-сервер `10.103.0.10`), драйвер `psycopg` 3.3.8, SQLAlchemy 2.0.48.
- Изоляция: отдельная схема `a4test` в dev-БД через `schema_translate_map` + scratch-схемы `a4migtest`/`a4migduptest` для прогона миграции. Таблицы `app.*` не затрагивались. Гард env: `AI_RUN_TEST_DATABASE_URL` + `AI_RUN_TEST_SCHEMA` (должна содержать "test", как `SCAN_TEST_DATABASE_URL`).
- Команда: `pytest tests/test_ai_run_serialization_pg.py` с выставленными env → **22 passed / 0 failed** за ~17 с.
- Миграция прогнана на scratch-схеме: колонки, backfill `queue_seq` (порядок `created_at,id` → `old:1, new:2`), `last_run_seq=2`, оба индекса созданы; при двух running на диалог upgrade падает `RuntimeError` с перечнем — **не** автоисправляет данные.
- `test_pg_migration_0176_rebuilds_invalid_index`: репетиция окна «старые воркеры во время `CREATE UNIQUE INDEX CONCURRENTLY`» — заведомо дублирующий running ломает concurrent-build → остаётся `INVALID` индекс (`pg_index.indisvalid=false`, подтверждено запросом). После ручного разрешения дубля повторный upgrade дропает INVALID-индекс и перестраивает VALID (`indisvalid=true`).

## 11. Нагрузка — FIXED

`test_pg_load_100_runs_20_conversations_4_workers`: 20 диалогов × 5 run = **100 runs**, 4 воркер-потока (claim-commit → пауза-«работа» → complete → повтор).

- Результат: **все 100 run завершены ровно один раз**, очередь полностью осушена, 0 ошибок/дедлоков/потерянных заданий.
- FIFO: для каждого из 20 диалогов порядок завершения совпал с `queue_seq` 1..5.
- Время: **1.11 с** (~90 claim+complete roundtrip/с через сеть к dev-PG; доминирует сетевая латентность, не contention). Конфликтов/бесконечных retry не наблюдалось.

`test_pg_load_with_continuous_enqueue` (цикл 2): 10 диалогов × 3 раунда enqueue **во время** работы 4 воркеров — 30 run, все завершены ровно раз, очередь осушена, порядок завершения в каждом диалоге совпал с enqueue-порядком (`queue_seq`). Гонка enqueue↔claim не роняет задания и не нарушает FIFO.

`test_pg_migration_0176_backfill_large_table_timed` (цикл 2): backfill **3000** пред-существующих runs по 30 диалогам одним `UPDATE ... FROM (ROW_NUMBER() OVER (PARTITION BY ...))` — **0.16 с** на dev-PG, порядок верифицирован полным пересчётом window-функцией (0 расхождений), `last_run_seq=100` на диалог. Прежний коррелированный `COUNT(*)` оставался бы O(n²) по каждому диалогу; новый — один проход O(n). На sqlite-fallback оставлен коррелированный вариант (dev-БД малы, `UPDATE ... FROM` поддержан не везде).

## 12. Изменения схемы БД — FIXED (миграция `20261118_0176`)

| Изменение | Детали |
|---|---|
| `ai_bot_runs.queue_seq BIGINT NULL` | FIFO-ключ; backfill на PG — один `UPDATE ... FROM (ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at, id))` (O(n), 3000 строк ≈ 0.16 с на dev); на sqlite — коррелированный `COUNT` |
| `ai_bot_conversations.last_run_seq BIGINT NOT NULL DEFAULT 0` | счётчик enqueue; backfill `= MAX(queue_seq)` по диалогу |
| `uq_app_ai_bot_runs_running_conversation` | `UNIQUE (conversation_id) WHERE status='running'`, `CONCURRENTLY` + `lock_timeout=5s` |
| `ix_app_ai_bot_runs_conversation_status_queue_seq` | покрывает head-предикаты, `CONCURRENTLY` |
| Dup-guard | `HAVING COUNT(*)>1` по running → `RuntimeError` с перечнем; оператор решает вручную |
| Invalid-index repair (цикл 2) | перед созданием индексов проверяется `pg_index.indisvalid/indisready` — INVALID-остаток упавшего concurrent-build дропается (`DROP INDEX CONCURRENTLY`) и пересоздаётся; VALID-индекс не трогается |
| `lock_timeout` на DDL (цикл 2) | `SET LOCAL lock_timeout='10s'` на `ADD COLUMN`/backfill-фазу транзакции; `5s` на каждый `CONCURRENTLY` — миграция не висит за блокировщиком, повтор безопасен |
| Тестовый крючок | `ITINVENT_MIGRATION_APP_SCHEMA` — переопределение схемы только для этого файла (по умолчанию `app`) |

Rollback: `downgrade()` снимает индексы `CONCURRENTLY` и колонки; данные не теряются.

## 13. Ограничения — CONFIRMED/NOT TESTED

- **FIFO-окно до первого enqueue**: порядок определяется commit-порядком enqueue под mapping-локом — это строгая сериализация, но если клиент шлёт A,B параллельно, их «истинный» порядок определяется захватом лока (эквивалент любому серверному FIFO). CONFIRMED.
- **Поздние side-effects**: сериализация run не отменяет физически выполняющийся поток инструмента после wall-timeout (ограничение A1 — Python не убивает поток). Защита — существующая идемпотентность (client-id/outbox). CONFIRMED остаточный риск.
- **`_process_single_run` end-to-end на PG** (claim→LLM→completion): проверен на уровне claim+terminal transitions; полный прогон с фейковой LLM на PG — NOT TESTED (покрыт sqlite-регрессией).
- **Несколько независимых процессов ОС**: проверено независимыми подключениями/транзакциями, что транзакционно эквивалентно; буквальный spawn процессов — NOT TESTED.
- **Предел повторных попыток claim**: пробник `SKIP LOCKED` не имеет границы по числу залоченных диалогов, но гонка «пробник → UPDATE» (статус сменился между выборкой и записью) повторяет пробник не более 8 раз за вызов; при исчерпании — `None` + warning `ai_run_claim: N probe attempts contended`, следующий опрос воркера повторяет. Проверено повторными опросами — это латентность, не потеря задания. CONFIRMED.
- **Предсуществующие падения** — `tests/test_ai_sandbox_release.py::test_allowlisted_release_imports_worker_without_repository_or_live_env` и `tests/test_ai_sandbox_runtime.py::test_gateway_containerfile_is_a_buildable_pinned_release_artifact` (release-манифест без `shared/llm/json_stream.py` — `ModuleNotFoundError` в собранном бандле). Воспроизводятся на неизменённом `main` теми же командами (`pytest tests/test_ai_*.py`) в этом же окружении — к A4 отношения не имеют и в этом PR не исправляются. CONFIRMED.

## 14. Развёртывание и откат

**Deploy (рекомендуемый порядок, с дренированием AI worker):**

Окно риска, проверенное репетицией: пока **старые** воркеры продолжают claim'ить, конкурентный build уникального индекса может наткнуться на свежий дубль running → build падает → остаётся INVALID-индекс. Миграция это умеет чинить повторным прогоном, но самый чистый путь — остановить воркеры на время перехода (API-процессы и enqueue продолжают работать: новые сообщения копятся в `queued`, теряться не могут).

1. Пред-проверка дублей: `SELECT conversation_id, COUNT(*) FROM app.ai_bot_runs WHERE status='running' GROUP BY 1 HAVING COUNT(*)>1` — при непустом результате разрешить вручную (cancel/finish) до миграции.
2. Остановить AI worker-процессы (дренировать активные run'ы или дать watchdog-CAS перевести их в `failed` по TTL политики A1).
3. `alembic upgrade head` — `ADD COLUMN`/`UPDATE` под `lock_timeout=10s` (при таймауте — повторить позже, транзакция откатывается без следов); `CONCURRENTLY`-индексы с `lock_timeout=5s`.
4. Пост-проверка: `SELECT indisvalid, indisready FROM pg_index WHERE indexrelid='app.uq_app_ai_bot_runs_running_conversation'::regclass` → `t,t`. Если `false` — дубль проскочил окном (см. п.2): разрешить дубли и повторить `upgrade` — INVALID-остаток дропнется и пересоздастся автоматически.
5. Деплой кода (новый claim) → запуск воркеров. Порядок «миграция → код» при остановленных воркерах безопасен; **при работающих старых воркерах — PARTIAL**: допустимо (дополнительные дубли только откажут build'у и будут видимы в `indisvalid`), но требует повторного прогона и потому не рекомендуется.
6. Откат кода — безопасен: старый код игнорирует новые колонки; уникальный индекс остаётся fail-closed backstop'ом (старый claim при гонке двух running получит `IntegrityError` вместо скрытого нарушения — желаемо).
7. Откат миграции: `alembic downgrade -1` — удаляет индексы/колонки; run-данные не затрагиваются.

**Мониторинг:** claim-пропуски видны как `None` → `process_next_run=False` → idle-цикл; warning `ai_run_claim: N probe attempts contended` — непрерывная гонка на головах (не зависит от числа залоченных диалогов); аномальный рост `pg_locks` на `ai_bot_conversations` укажет на зависший enqueue.

## Результаты (итог)

| Категория | PASS | FAIL | BLOCKED |
|---|---|---|---|
| PG конкурентность/FIFO/нагрузка/миграция (`test_ai_run_serialization_pg`) | 22 | 0 | 0 |
| SQLite логика A4 + классификатор ошибок (`test_ai_run_conversation_serialization`) | 12 | 0 | 0 |
| AI-регрессия `tests/test_ai_*` (sqlite) | 643 | 2* | 22 skipped |
| Прогон миграции на scratch-схемах (в т.ч. 3000-строчный backfill, INVALID-index repair) | 4 (внутри 22) | 0 | 0 |

\* оба фейла — предсуществующие на `main`: `test_ai_sandbox_release.py::test_allowlisted_release_imports_worker_without_repository_or_live_env`, `test_ai_sandbox_runtime.py::test_gateway_containerfile_is_a_buildable_pinned_release_artifact` (`shared/llm/json_stream` отсутствует в release-манифесте), не связаны с A4.

## Цикл 2 — правки независимого ревью (итог)

| Риск | Решение | Подтверждение |
|---|---|---|
| Starvation: `LIMIT 8` пробник — свободный 9-й диалог не попадал в выборку за 8 залоченными | keyset-пагинация `(created_at,id)`, до 4×8=32 голов на вызов + warning при исчерпании | `test_pg_claim_skips_32_locked_heads_to_reach_free_conversation` — FIXED (усилено в цикле 3) |
| Backfill O(n²) коррелированным `COUNT` | `UPDATE ... FROM (ROW_NUMBER() PARTITION BY)` на PG | 3000 строк ≈ 0.14 с, полный пересчёт = 0 расхождений — FIXED |
| Concurrent-build во время работы старых воркеров → INVALID-индекс | `_index_state` (indisvalid/indisready) → drop INVALID → dup-check → rebuild; runbook с дренированием воркеров | `test_pg_migration_0176_rebuilds_invalid_index` — FIXED |
| Подавление любых `OperationalError`/`IntegrityError` как «нет работы» | `_is_claim_contention`: только 55P03/40P01/40001 и unique-violation backstop-индекса; прочее — raise | 4 unit-теста классификатора — FIXED |

## Цикл 3 — окончательное устранение starvation

| Риск | Решение | Подтверждение |
|---|---|---|
| Постоянное starvation после 32 залоченных голов: курсор keyset-пагинации обнулялся при каждом вызове — 33-я свободная голова не достигалась ни одним опросом | Пробник переписан на `JOIN ai_bot_conversations ... FOR UPDATE OF m SKIP LOCKED LIMIT 1` — пропуск залоченных mapping-строк выполняет сама БД в порядке `(created_at,id)`; границы по числу contention нет. Runs без mapping-строки — отдельный lock-free пробник, победитель по более раннему `(created_at,id)`. Гонка пробник→UPDATE — bounded retry (≤8), не bounded scan | `test_pg_claim_skips_32_locked_heads_to_reach_free_conversation`: 32 залоченных + 1 свободный → claim в том же вызове; повторный опрос → `None` без busy-loop; после снятия локов `locked00→locked01` по порядку — FIXED |

Гарантия отсутствия starvation на PostgreSQL теперь конструктивная: единственное состояние, когда claim возвращает `None` при наличии свободных голов, — исчерпание 8 retry из-за непрерывной гонки на самих головах (статус меняется между пробником и UPDATE); это не зависит от числа залоченных диалогов и восстанавливается следующим опросом воркера.
