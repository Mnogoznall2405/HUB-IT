# A1: Отказоустойчивость AI-воркера — отчёт о реализации

Ветка: `fix/ai-worker-stability-a1` от `origin/main` (`5513db68`).
Статусы: `CONFIRMED / FIXED / PARTIAL / NOT REPRODUCED / NOT TESTED`.

## 1. Исходное состояние

- Весь AI run выполняется в `asyncio.to_thread`; внутри run инструменты исполняются
  синхронно (параллельные группы — через вложенный `asyncio.run` + `to_thread`).
- `pyodbc.connect(timeout=30)` — только login timeout; statement timeout (`conn.timeout`)
  не устанавливался нигде.
- `ldap3.Server` / `ldap3.Connection` создавались без `connect_timeout`/`receive_timeout`.
- `reap_stale_runs` имел единый порог для `queued` и `running` — backlog очереди мог быть
  ошибочно «похоронен»; `updated_at` обновлялся только на смене стадии (нет heartbeat).
- `cancel_active_run` делал SELECT + небезопасное присваивание статуса (гонка с финализацией).
- Warehouse `run_coroutine` ждал `future.result()` без таймаута; mail single-flight —
  `event.wait()` без таймаута; `confirm_action` из API — без верхнего bound; voice-скан и
  document-extractors читали файлы без лимитов.

## 2. Проверенные гипотезы аудита

| Гипотеза | Статус | Доказательство |
|---|---|---|
| SQL-вызовы инструментов могут висеть бесконечно | CONFIRMED | `conn.timeout` не устанавливался (`connection.py`) |
| LDAP без таймаутов | CONFIRMED | `ldap_security.py` — единая фабрика без `connect_timeout`/`receive_timeout` |
| `asyncio.wait_for` не убивает поток | CONFIRMED | свойство Python; зафиксировано как ограничение |
| Watchdog путает backlog с зависанием | CONFIRMED | единый cutoff для queued/running |
| 4 зависших инструмента блокируют 5-й запрос | CONFIRMED (по коду) | воркер разделяет default executor; поток не освобождается |

## 3. Архитектура решения — 4 слоя (`backend/ai_chat/timeouts.py`)

1. **Драйверы.** `ai_sql_query_timeout` ContextVar → `conn.timeout` на каждый checkout пула
   внутри AI-инструментов (`AI_SQL_QUERY_TIMEOUT_SEC=60`) и при confirm action-карт
   (`AI_SQL_MUTATION_TIMEOUT_SEC=120`). Прежнее значение `timeout` восстанавливается до
   возврата в пул; при ошибке восстановления соединение **выбрасывается**, а не возвращается.
   `get_db(..., query_timeout=...)` — opt-in для других потребителей; UI/API-пути не меняются.
   ldap3: `connect_timeout` (`LDAP_CONNECT_TIMEOUT=10`) на `Server`, `receive_timeout`
   (`LDAP_RECEIVE_TIMEOUT=30`) на `Connection` — покрывает bind/search/paged search всех потребителей.
2. **Оркестрация.** `ai_tool_registry.execute_bounded` — выделенный `ThreadPoolExecutor`
   (`AI_TOOL_EXECUTOR_WORKERS=12`, отдельный от default executor воркера) +
   `future.result(timeout=AI_TOOL_WALL_TIMEOUT_SEC=120)`; per-tool override
   (`timeout_sec` на классе: EWS-цепочки 180, workday 300, генерация файлов 300,
   vision-конвертация 600). Таймаут → контролируемый `AiToolResult(ok=False,
   diagnostic.error_code="tool_timeout")`; вызов помечается **leaked** и считается
   (`ai_tool_leaked_count()`) — поток физически не убивается (ограничение Python).
3. **Run.** `AiRunDeadlineExceeded` на кооперативных checkpoint'ах
   (`AI_RUN_TIMEOUT_SEC=900`) → терминальный `failed`, не `cancelled`.
   Каждый checkpoint heartbeat'ит `updated_at` (CAS по `status in (queued,running)`).
4. **Восстановление.** Watchdog (по-прежнему opt-in): `running` старее
   `AI_RUN_WATCHDOG_STALE_SEC=900` И `queued` старее
   `AI_RUN_WATCHDOG_QUEUED_STALE_SEC=1800` (max двух) — backlog не reap'ится.
   CAS-финализация сохранена; `cancel_active_run` переведён на conditional UPDATE.

## 4. Таблица блокирующих операций

| Операция | Инструменты | До | После |
|---|---|---|---|
| pyodbc statements | itinvent.* | нет | `conn.timeout` 60/120s, restore/discard |
| ldap3 bind/search | ad.*, AD sync, LDAP login | нет | connect 10s + receive 30s |
| 1C bridge coroutines | warehouse.* | нет (outer) | 75s bound + `shutdown(wait=False)` |
| MFU snapshot | mfu.device_status | нет | `asyncio.wait_for` 5s |
| Voice scan/read | voice.* | без лимитов | 300 файлов / 2MB на файл, newest-first |
| Doc extractors | kb/files | unbounded read | 50MB cap |
| Mail single-flight wait | office.mail.* | бесконечно | 120s, далее собственный producer |
| Confirm action HTTP | action cards | нет | `wait_for` 130s → 504 «исход неизвестен» |
| Любой tool call | все | нет | wall-timeout 120s + leaked-счётчик |

## 5. Изменения watchdog

- Раздельные пороги queued/running; `running`-порог не изменён.
- Heartbeat через `_raise_if_run_cancelled` — живой долгий run не reap'ится,
  пока проходит checkpoint'ы.
- CAS по `(id, status, updated_at)` сохранён; `cancel_active_run` — conditional UPDATE,
  терминальные статусы не перезаписываются; поздняя финализация — guarded updates.
- Dry-run сохранён. В production по-прежнему `AI_RUN_WATCHDOG_ENABLED` opt-in.

## 6. Результаты тестов

Команды (worktree `C:\Project\HUB-IT-a1-wt`, `.env` скопирован для паритета, не коммитится):

- `pytest -q tests\test_ai_kb_retrieval.py tests\test_ai_tool_permissions.py tests\test_ai_tool_routing.py tests\test_ai_run_retry.py` — **77 PASS** (baseline воспроизведён)
- `pytest -q tests\test_ai_memory_migration.py tests\test_ai_smart_memory_migration.py tests\test_e2e_ai_smart_memory.py tests\test_ai_tool_validation_diagnostic.py tests\test_ai_chat_document_extractors.py` — **40 PASS**
- `pytest -q tests\test_ai_chat_runtime.py` — **74 PASS**
- `pytest -q tests\test_ai_run_stability.py` — **22 PASS** (новые)
- `pytest -q tests\test_ai_run_watchdog.py` — **10 PASS**
- `pytest -q tests\test_db_pool_and_engine_cache.py` — **4 PASS**

**Итого: 227 PASS / 0 FAIL.** `git diff --check` — чисто.

Новые тесты (`tests/test_ai_run_stability.py`, 22): fake-pyodbc conn с
timeout-getter/setter; применение и восстановление `conn.timeout`; discard при
невозможности восстановить; indefinitely-blocking tool (threading.Event) →
контролируемый `tool_timeout`; executor продолжает обслуживать новые вызовы после
таймаута (освобождение оркестрационных ресурсов доказано, не по статусу);
конкурентные hung-вызовы не блокируют независимый call; heartbeat обновляет
`updated_at`; cancelled не заменяется deadline-failed; CAS-гонки cancel/finalize;
stale vs queued watchdog; dry-run; post-reap защита; voice caps; LDAP
connect/receive timeout парсинг; single-flight leader timeout → own producer.

## 7. Сценарий «4 зависших + 5-й запрос» (PM2 concurrency=4)

- 4 hung-инструмента занимают 4 потока выделенного executor'а (12 слотов).
- Run'ы получают `tool_timeout` через ≤120s и завершаются `failed` —
  слоты воркера `process_next_run` освобождаются.
- 5-й запрос: claim через `SKIP LOCKED` → выполняется — до исчерпания 12 слотов
  executor'а. При истощении новые вызовы ждут submit-очереди и тоже ограничены
  wall-timeout — бесконечного роста ожидания нет.
- Зависшие потоки освобождаются driver-таймаутом (SQL 60s/LDAP 30s); если драйвер
  мёртв — поток остаётся leaked и **учитывается** (ограничение, ниже).

## 8. Безопасность бизнес-операций

- Проверки прав `user_can_use_tool`/`tool_required_permissions` не изменялись
  (`execute_bounded` делегирует в `execute` — тот же путь авторизации).
- Таймаут мутации → `ok=False` + «результат неизвестен»; автоматический retry
  отсутствует; confirm-504 явно просит проверить карточку перед повтором.
- Идемпотентность `client_message_id=ai-run:{id}` и outbox-dedup не тронуты.
- Поздняя финализация reaped-run'а: guarded updates по `status in (queued,running)`
  — терминал не перезаписывается.

## 9. Остаточные риски

- Поток, зависший в драйвере без прерываемого таймаута (COM/Win32, deadlock внутри
  pyodbc на уровне TDS-пакета, сетевая папка), НЕ может быть убит из Python —
  только учтён (leaked counter) и ограничен ёмкостью executor'а. Полная изоляция
  требует process-level isolation (worker pool на подпроцессах) — за рамками A1.
- `run_coroutine` (warehouse): брошенный поток executor'а — non-daemon; при рестарте
  PM2 интерпретатор дождётся его завершения (до внутреннего 45s-бюджета 1C).
- LDAP `receive_timeout` ограничивает ожидание ответа на операцию; разрыв TLS-
  handshake в середине покрыт `connect_timeout` только частично.
- `asyncio.wait_for` на confirm отменяет корутину, но не поток — action может
  завершиться в фоне (поэтому 504 говорит «исход неизвестен», repair-слой согласует).

## 10. Развёртывание и откат

Deploy: обычный деплой кода; все новые env — опциональны, дефолты консервативны.
Watchdog остаётся opt-in; рекомендуется сначала `AI_RUN_WATCHDOG_DRY_RUN=1`.
Rollback: revert коммита; новые поля в БД не добавлялись, миграций нет.
Мониторинг: `ai_tool_timeout ... leaked=N` в логах воркера; `ai_tool_leaked_count()`.
