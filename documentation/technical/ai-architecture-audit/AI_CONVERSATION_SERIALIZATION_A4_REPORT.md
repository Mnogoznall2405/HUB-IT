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

**Уровень 1 — строковая блокировка диалога (основной механизм).** Claim-транзакция берёт `FOR UPDATE NOWAIT` на строке `app.ai_bot_conversations` — той же самой строке, которую enqueue держит при вставке нового run (`_enqueue_run` уже делал `.with_for_update()`). Пока claim держит этот лок: (а) ни один enqueue этого диалога не может закоммитить новый run → `queued`-набор заморожен → голова очереди стабильна; (б) второй claim этого же диалога не может быть в полёте (NOWAIT проваливается мгновенно, воркер переходит к следующему кандидату). Лок держится только до коммита claim-транзакции (миллисекунды) — **не** на время LLM-вызова.

**Уровень 2 — частичный уникальный индекс (backstop).** `uq_app_ai_bot_runs_running_conversation ON ai_bot_runs (conversation_id) WHERE status = 'running'` — декларативная гарантия «не более одного running на диалог» для любого пути, обходящего лок (будущий код, прямой SQL, run без mapping-строки). `CREATE INDEX CONCURRENTLY` в миграции.

**FIFO-ключ — `queue_seq`.** `created_at` задаётся приложением (`_utc_now()`), а не БД — при разнобое часов хостов порядок прибытия искажается. Поэтому добавлен `ai_bot_conversations.last_run_seq`, инкрементируемый под локом mapping-строки при enqueue, и `ai_bot_runs.queue_seq`. Порядок внутри диалога: `(COALESCE(queue_seq,-1), created_at, id)` — NULL `queue_seq` (строки до миграции, dev-вставки) сортируется старейшим и детерминировано тай-брейчится `(created_at, id)`.

**Claim-алгоритм** (`_claim_next_queued_run`):
1. Пробник (без блокировок): queued-строки, являющиеся головами своих диалогов — `NOT EXISTS(running sibling)` и `NOT EXISTS(earlier queued sibling)` — `ORDER BY created_at, id LIMIT 8`.
2. Для каждого кандидата: `SET LOCAL lock_timeout='5s'` → `FOR UPDATE NOWAIT` на mapping-строке → условный `UPDATE ... SET status='running' WHERE id=:id AND status='queued' AND <те же head-предикаты>` (READ COMMITTED перевычисляет предикаты на момент записи).
3. `rowcount=1` → claim состоялся; иначе `ROLLBACK` и следующий кандидат. `IntegrityError` (сработал backstop-индекс) и `OperationalError` (NOWAIT/lock_timeout/deadlock) → пропуск кандидата.

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
- Команда: `pytest tests/test_ai_run_serialization_pg.py` с выставленными env → **18 passed / 0 failed** за ~10 с.
- Миграция прогнана на scratch-схеме: колонки, backfill `queue_seq` (порядок `created_at,id` → `old:1, new:2`), `last_run_seq=2`, оба индекса созданы; при двух running на диалог upgrade падает `RuntimeError` с перечнем — **не** автоисправляет данные.

## 11. Нагрузка — FIXED

`test_pg_load_100_runs_20_conversations_4_workers`: 20 диалогов × 5 run = **100 runs**, 4 воркер-потока (claim-commit → пауза-«работа» → complete → повтор).

- Результат: **все 100 run завершены ровно один раз**, очередь полностью осушена, 0 ошибок/дедлоков/потерянных заданий.
- FIFO: для каждого из 20 диалогов порядок завершения совпал с `queue_seq` 1..5.
- Время: **1.14 с** (~88 claim+complete roundtrip/с через сеть к dev-PG; доминирует сетевая латентность, не contention). Конфликтов/бесконечных retry не наблюдалось.

## 12. Изменения схемы БД — FIXED (миграция `20261118_0176`)

| Изменение | Детали |
|---|---|
| `ai_bot_runs.queue_seq BIGINT NULL` | FIFO-ключ; backfill: `ROW_NUMBER`-эквивалент через коррелированный `COUNT` по `(created_at,id)` per-conv |
| `ai_bot_conversations.last_run_seq BIGINT NOT NULL DEFAULT 0` | счётчик enqueue; backfill `= MAX(queue_seq)` по диалогу |
| `uq_app_ai_bot_runs_running_conversation` | `UNIQUE (conversation_id) WHERE status='running'`, `CONCURRENTLY` + `lock_timeout=5s` |
| `ix_app_ai_bot_runs_conversation_status_queue_seq` | покрывает head-предикаты, `CONCURRENTLY` |
| Dup-guard | `HAVING COUNT(*)>1` по running → `RuntimeError` с перечнем; оператор решает вручную |
| Тестовый крючок | `ITINVENT_MIGRATION_APP_SCHEMA` — переопределение схемы только для этого файла (по умолчанию `app`) |

Rollback: `downgrade()` снимает индексы `CONCURRENTLY` и колонки; данные не теряются.

## 13. Ограничения — CONFIRMED/NOT TESTED

- **FIFO-окно до первого enqueue**: порядок определяется commit-порядком enqueue под mapping-локом — это строгая сериализация, но если клиент шлёт A,B параллельно, их «истинный» порядок определяется захватом лока (эквивалент любому серверному FIFO). CONFIRMED.
- **Поздние side-effects**: сериализация run не отменяет физически выполняющийся поток инструмента после wall-timeout (ограничение A1 — Python не убивает поток). Защита — существующая идемпотентность (client-id/outbox). CONFIRMED остаточный риск.
- **`_process_single_run` end-to-end на PG** (claim→LLM→completion): проверен на уровне claim+terminal transitions; полный прогон с фейковой LLM на PG — NOT TESTED (покрыт sqlite-регрессией).
- **Несколько независимых процессов ОС**: проверено независимыми подключениями/транзакциями, что транзакционно эквивалентно; буквальный spawn процессов — NOT TESTED.
- **Предсуществующие падения** `test_ai_sandbox_release`/`test_ai_sandbox_runtime` (release-манифест без `shared/llm/json_stream.py`) — подтверждены на `main`, к A4 отношения не имеют. CONFIRMED.

## 14. Развёртывание и откат

**Deploy:**
1. Убедиться, что нет дублей: `SELECT conversation_id, COUNT(*) FROM app.ai_bot_runs WHERE status='running' GROUP BY 1 HAVING COUNT(*)>1` — миграция сама откажется при дублях; разрешить их вручную (cancel/finish) и повторить.
2. `alembic upgrade head` — `CONCURRENTLY`-индексы не блокируют запись; `lock_timeout=5s` защищает от долгих ожиданий (при таймауте — повторить).
3. Порядок релиза: **миграция → код**. Новый claim читает `queue_seq`, поэтому требует колонку; старый код новой схеме не мешает (игнорирует новые колонки, уникальный индекс для него — лишь дополнительный fail-closed backstop).
4. Откат кода — безопасен: старый код игнорирует новые колонки. Уникальный индекс при откате кода остаётся работать как backstop — старый claim при гонке двух running получит `IntegrityError` вместо скрытого нарушения (fail-closed, желаемо).
5. Откат миграции: `alembic downgrade -1` — удаляет индексы/колонки; run-данные не затрагиваются.

**Мониторинг:** claim-пропуски видны как `None` → `process_next_run=False` → idle-цикл; аномальный рост `pg_locks` на `ai_bot_conversations` укажет на зависший enqueue.

## Результаты (итог)

| Категория | PASS | FAIL | BLOCKED |
|---|---|---|---|
| PG конкурентность/FIFO/нагрузка (`test_ai_run_serialization_pg`) | 18 | 0 | 0 |
| SQLite логика A4 (`test_ai_run_conversation_serialization`) | 8 | 0 | 0 |
| AI-регрессия `tests/test_ai_*` (sqlite) | 639 | 2* | 18 skipped |
| Прогон миграции на scratch-схеме | 2 (внутри 18) | 0 | 0 |

\* оба фейла — предсуществующие на `main` (`shared/llm/json_stream` отсутствует в release-манифесте), не связаны с A4.
