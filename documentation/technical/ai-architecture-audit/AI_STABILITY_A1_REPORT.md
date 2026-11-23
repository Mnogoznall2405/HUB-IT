# A1: Отказоустойчивость AI-воркера — отчёт о реализации

Ветка: `fix/ai-worker-stability-a1` от `origin/main` (`5513db68`). PR #16.
Статусы: `CONFIRMED / FIXED / PARTIAL / NOT REPRODUCED / NOT TESTED`.
Доказательства помечены: **[test]** — настоящий pytest; **[fake]** — pytest с
fake-драйвером/заглушкой; **[static]** — статический анализ кода; **[untested]** —
не проверено.

## 1. Исходное состояние

- Весь AI run выполняется в `asyncio.to_thread`; внутри run инструменты исполняются
  синхронно (параллельные группы — через вложенный `asyncio.run` + `to_thread`).
- `pyodbc.connect(timeout=30)` — только login timeout; statement timeout (`conn.timeout`)
  не устанавливался нигде. Idle-ping (`SELECT 1` в `_PyodbcConnectionPool.acquire()`)
  выполнялся до того, как менеджер успевал установить AI-timeout — потенциально
  безграничный SQL-вызов **[static, подтверждено циклом 3]**.
- `ldap3.Server` / `ldap3.Connection` создавались без `connect_timeout`/`receive_timeout`.
- `reap_stale_runs` имел единый порог для `queued` и `running` — backlog очереди мог быть
  ошибочно «похоронен»; возраст записи оставался единственным доказательством потери.
- `cancel_active_run` делал SELECT + небезопасное присваивание статуса (гонка с финализацией).
- Warehouse `run_coroutine` ждал `future.result()` без таймаута; mail single-flight —
  `event.wait()` без таймаута, а после таймаута КАЖДЫЙ follower запускал собственный
  producer (thundering herd) **[static, подтверждено циклом 3]**.
- Voice-скан обходил и сортировал ВСЕ `*_report.json` до применения лимита —
  ограничение действовало только на выдачу, не на число операций ФС/память
  **[static, подтверждено циклом 3]**.
- `confirm_action` из API — без верхнего bound; document-extractors читали файлы
  без лимитов.

## 2. Проверенные гипотезы аудита

| Гипотеза | Статус | Доказательство |
|---|---|---|
| SQL-вызовы инструментов могут висеть бесконечно | CONFIRMED | `conn.timeout` не устанавливался **[static]** |
| Idle-ping обходит AI-timeout | CONFIRMED | `acquire()` пинговал до установки timeout **[static + fake]** |
| LDAP без таймаутов | CONFIRMED | единая фабрика без connect/receive timeouts **[static]** |
| `asyncio.wait_for` не убивает поток | CONFIRMED | свойство Python **[static]** |
| Watchdog путает backlog с зависанием | CONFIRMED | единый cutoff + отсутствие признака жизни воркера **[static]** |
| 4 зависших инструмента блокируют 5-й запрос | CONFIRMED (по коду) | общий executor, поток не освобождается **[static + test]** |
| Follower-fanout в single-flight | CONFIRMED | каждый таймаутившийся follower запускал producer **[static + test]** |
| Voice-скан без bound на обход ФС | CONFIRMED | лимит применялся после полного скана **[static + test]** |
| submit()-сбой утекает ёмкостью | CONFIRMED (потенциал) | `in_flight` инкрементировался до submit **[static + test]** |

## 3. Архитектура решения — 4 слоя (`backend/ai_chat/timeouts.py`)

1. **Драйверы.** `ai_sql_query_timeout` ContextVar → `conn.timeout` на каждый
   checkout пула внутри AI-инструментов (`AI_SQL_QUERY_TIMEOUT_SEC=60`) и при
   confirm action-карт (`AI_SQL_MUTATION_TIMEOUT_SEC=120`).
   **Idle-ping покрыт тем же таймаутом (цикл 3, P0):** `acquire(ping_timeout=...)`
   передаёт AI-scoped timeout в `_ping()` — `SELECT 1` выполняется уже под
   `conn.timeout`. Установка/восстановление вокруг пинга проверяется read-back'ом;
   отказ драйвера → `SqlStatementTimeoutUnsupportedError` + `_abandon(conn)`
   (закрыто, вычтено из `_created`, в пул не возвращается). Ошибка самого пинга →
   `_abandon` + попытка следующего соединения → при пустом пуле `_create_connection`.
   **Fail-closed (цикл 2, P0-2):** запрошенный timeout, который драйвер не может
   прочитать/установить/подтвердить → ошибка **до выполнения SQL**, conn discard.
   Non-AI путь (timeout не запрошен) атрибут драйвера не трогает вообще.
   ldap3: `connect_timeout=10`/`receive_timeout=30` в единой фабрике.
2. **Оркестрация.** `execute_bounded` — выделенный `ThreadPoolExecutor`
   (12 workers + 24 pending, `AI_TOOL_WALL_TIMEOUT_SEC=120`, per-tool override).
   **Admission control (цикл 2, P0-1):** отказ `tool_capacity_exceeded` сверх ёмкости —
   вызов гарантированно не стартовал (проверено `tool.started` в тесте).
   **submit()-safety (цикл 3/4, P1):** три различных сбоя. submit() упал или
   `future.cancel()` успешен (ещё в очереди) → ёмкость освобождена,
   `tool_submit_failed` («не выполнялся»). Callback-registration упала И
   `cancel()=False` (задача уже RUNNING): ёмкость удерживается до фактического
   завершения — daemon done-monitor выполняет освобождение, которое сделал бы
   callback; «не выполнялся» НЕ утверждается — вызов получает реальный
   результат через `future.result()`. Если и monitor не стартует — ёмкость
   остаётся занятой как leaked, `tool_submit_incomplete` («результат
   неизвестен»). Счётчики не уходят в минус.
   Таймаут в очереди → `tool_queue_timeout`; в работе → `tool_timeout` + leak.
   `leaked_now` — gauge по факту завершения потока; `_generation`-guard защищает
   от stale-callback после тестового reset.
3. **Run.** `AiRunDeadlineExceeded` на checkpoint'ах (`AI_RUN_TIMEOUT_SEC=900`) →
   терминальный `failed`. Каждый checkpoint heartbeat'ит `updated_at` (CAS).
4. **Восстановление.** Watchdog opt-in. `running` > 900s reap'ится как раньше.
   **Queued-строки НЕ reap'ятся никогда (цикл 4, P0):** живой claim loop может
   законно держать backlog старше любого порога — возраст (даже со свежим
   heartbeat) не доказывает невозможность обработки. Просроченные queued
   выводятся как диагностическое предупреждение (`stale_queued_run_ids`,
   `skipped_queued`, `worker_alive`, `worker_heartbeat_age_sec` в выводе
   watchdog); выход из `queued` — только claim воркером или явная отмена.
   Claim-loop пишет heartbeat в `app_settings` (`ai_worker.heartbeat`,
   `AI_WORKER_HEARTBEAT_SEC=15`) — чисто диагностический сигнал жизни цикла.
   Dry-run сохранён.

## 4. Таблица блокирующих операций

| Операция | До | После |
|---|---|---|
| pyodbc statements | нет | `conn.timeout` 60/120s, verify+restore/discard |
| pyodbc idle-ping | нет bound | тот же AI timeout на `SELECT 1`, fail-closed |
| ldap3 bind/search | нет | connect 10s + receive 30s |
| 1C bridge coroutines | нет (outer) | 75s bound |
| MFU snapshot | нет | `wait_for` 5s |
| Voice scan | лимит после полного обхода | bound `AI_VOICE_SCAN_MAX_ENTRIES=5000` записей ФС + top-K heap `AI_VOICE_REPORT_MAX_FILES=300` в памяти, 2MB/файл |
| Doc extractors | unbounded read | 50MB cap |
| Mail single-flight | бесконечный wait → fan-out; гонка leader/fallback | 120s wait → max ONE fallback producer на ключ; результат публикуется под локом — первый завершившийся producer выигрывает, все ждущие видят одно значение; fail-fast `MailSingleflightTimeoutError` |
| Confirm action HTTP | нет | `wait_for` 130s → 504 «исход неизвестен» |
| Любой tool call | нет | wall-timeout 120s + admission + leaked-учёт |

## 5. Изменения watchdog

- `running`-порог не изменён; потерянные running-run'ы reap'ятся как раньше.
- **Queued никогда не reap'ится** (цикл 4): backlog — легитимное состояние;
  просроченные queued-строки — только диагностическое предупреждение в лог и
  в вывод watchdog (`stale_queued_run_ids`), не `failed`.
- Heartbeat run'а через checkpoint (`updated_at`) — живой долгий run не reap'ится.
- Heartbeat воркера (`ai_worker.heartbeat`) — диагностический сигнал жизни
  claim-loop'а в выводе watchdog (`worker_alive`, `worker_heartbeat_age_sec`).
- CAS по `(id, status, updated_at)` сохранён; `cancel_active_run` — conditional UPDATE.
- Dry-run сохранён; production — opt-in `AI_RUN_WATCHDOG_ENABLED` (по умолчанию выкл).
- Сценарии **[test]**: живой перегруженный воркер со свежим heartbeat и queued
  старше порога → строка остаётся `queued` и claimable; отсутствующий/упавший
  воркер → то же самое; долгие running reap'ятся независимо от heartbeat.

## 6. Результаты тестов

Команды (worktree `C:\Project\HUB-IT-a1-wt`, `.env` скопирован для паритета, не коммитится):

- `pytest -q tests\test_ai_kb_retrieval.py tests\test_ai_tool_permissions.py tests\test_ai_tool_routing.py tests\test_ai_run_retry.py` — **77 PASS**
- `pytest -q tests\test_ai_memory_migration.py tests\test_ai_smart_memory_migration.py tests\test_e2e_ai_smart_memory.py tests\test_ai_tool_validation_diagnostic.py tests\test_ai_chat_document_extractors.py` — **40 PASS**
- `pytest -q tests\test_ai_chat_runtime.py` — **74 PASS**
- `pytest -q tests\test_ai_run_stability.py` — **49 PASS**
- `pytest -q tests\test_ai_run_watchdog.py` — **10 PASS**
- `pytest -q tests\test_db_pool_and_engine_cache.py` — **4 PASS**
- Релевантные suites (mail single-flight runtime, voice): `test_mail_runtime_cache.py`,
  `test_mail_runtime_snapshots.py`, `test_ai_voice_tools.py` — **15 PASS**

**Итого: 269 PASS / 0 FAIL** (191 baseline + 49 stability + 10 watchdog + 4 pool
+ 15 mail/voice). `git diff --check` — чисто.

Матрица «дефект → тест» (новое в цикле 3):

| Дефект | Тест |
|---|---|
| Idle-ping без timeout | `test_idle_ping_runs_under_ai_timeout` (ping видит timeout=30) **[fake]** |
| Ping без запрошенного timeout | `test_idle_ping_without_override_untouched` **[fake]** |
| Драйвер отказал ping-timeout | `test_idle_ping_timeout_refusal_fails_closed` — ошибка до SQL, conn закрыт **[fake]** |
| Битое соединение на ping | `test_idle_ping_broken_conn_recovers_with_fresh_connection` — discard + fresh conn **[fake]** |
| submit() кидает | `test_submit_runtime_error_releases_capacity_and_recovers` — `tool_submit_failed`, ёмкость возвращена, восстановление **[test]** |
| Сбой между резервом и callback (ещё в очереди) | `test_submit_failure_between_reserve_and_callback_is_safe` — future отменён, не стартовал, счётчики нулевые **[test]** |
| Callback-сбой на RUNNING future | `test_callback_failure_on_running_future_keeps_capacity_until_done` — ёмкость держится до завершения, реальный результат возвращён, monitor освобождает **[test]** |
| Callback-сбой + monitor не стартует | `test_callback_failure_monitor_spawn_failure_holds_capacity_as_leaked` — `tool_submit_incomplete` («неизвестен»), ёмкость как leaked **[test]** |
| Повторные submit-сбои | `test_shut_down_executor_rejects_without_negative_counters` — `in_flight` никогда < 0 **[test]** |
| 10 followers + hung leader | `test_singleflight_many_waiters_one_fallback_producer` — ≤1 fallback producer, все разрешились, после освобождения leader новые запросы работают **[test]** |
| Hung leader + hung fallback | `test_singleflight_fallback_hang_fails_fast_not_unbounded` — `MailSingleflightTimeoutError`, без неограниченного ожидания **[test]** |
| Гонка leader/fallback | `test_singleflight_consistent_result_when_leader_wins_race` — единый публичный результат, без ложного пробуждения **[test]** |
| Queued + возраст ≠ потеря | `test_watchdog_queued_never_reaped_age_is_diagnostic_only` — stale queued → диагностика, не reap **[test]** |
| Queued без heartbeat | `test_watchdog_preserves_queued_backlog_without_worker_heartbeat` — queued сохранён, running reaped **[test]** |
| Живой воркер + старый queued | `test_watchdog_queued_survives_fresh_heartbeat_and_gets_processed` — остаётся `queued`, claimable **[test]** |
| Устаревший heartbeat | `test_watchdog_stale_heartbeat_is_conservative` — диагностика, queued не тронут **[test]** |
| Voice: bound обхода ФС | `test_voice_scan_bounds_entries_inspected` — entry-бюджет останавливает walk **[test]** |
| Voice: top-K по mtime | `test_voice_scan_heap_keeps_newest_within_budget` — новейшие среди просмотренных, в памяти ≤ max_files **[test]** |

Дополнительная проверка (пункт 6 ревью):

- **Run после `tool_timeout` завершается `completed`** — `execute_bounded` возвращает
  контролируемый `AiToolResult(ok=False)` (не исключение); `_execute_tool_calls`
  передаёт его модели, цикл продолжается до `generating_answer` → `completed`
  **[test — `test_tool_call_timeout_integration_in_execute_tool_calls`,
  `test_executor_still_serves_calls_after_a_timeout`; e2e-путь `completed`
  покрыт `test_ai_chat_runtime`]**. Отчёт нигде не утверждает обратное.
- **Метрики при гонках** — saturation/queue-timeout/submit-failure тесты проверяют
  `in_flight`/`leaked_now`/`rejected_total` под параллельными callback/timeout/submit;
  отрицательных счётчиков и двойных освобождений нет **[test]**.
- **Нет скрытых стартов при полной ёмкости** — `assert not rejected.started.is_set()`
  в saturation-тесте **[test]**.
- **Нет повторов после «исход неизвестен»** — `tool_timeout` требует ручной проверки,
  автоматический retry отсутствует **[static]**; мутации идут через action-карты с
  идемпотентным confirm **[static]**.
- **Завершение воркера** — graceful: `process_next_run` завершает текущий run,
  потоки TPE non-daemon — зависший поток блокирует exit до kill-эскалации PM2;
  crash: run'ы остаются running/queued → heartbeat останавливается → watchdog
  консервативно не трогает queued, stale running reap'ит **[static + test]**.

## 7. Ограничение P2: voice-скан

Строгий лимит обхода и гарантия «самых новых из ВСЕХ» несовместимы без индекса:
heap отдаёт новейшие среди ПРОСМОТРЕННЫХ (до 5000 записей ФС). **[static]**
Минимальная индексная архитектура (вне объёма A1): producer voice-отчётов
пишет append-only `index.jsonl` (`path`,`mtime`) рядом с отчётом; скан читает
хвост индекса O(K) вместо walk O(N). Задокументировано в docstring
`_iter_report_files`.

## 8. Безопасность бизнес-операций

- Проверки прав `user_can_use_tool`/`tool_required_permissions` не изменялись.
- Таймаут мутации → «результат неизвестен»; автоматический retry отсутствует;
  confirm-504 просит проверить карточку.
- Идемпотентность `client_message_id=ai-run:{id}` и outbox-dedup не тронуты.
- Поздняя финализация reaped-run'а: guarded updates — терминал не перезаписывается.
- Single-flight fallback: все зарегистрированные producer'ы single-flight —
  read-only операции кеша (folder summaries/trees, message/conversation details,
  mailbox listing) **[static]**; повторный вызов чтения безопасен и ограничен
  одним fallback на ключ. Мутирующих producer'ов в call sites не найдено.

## 9. Остаточные риски

- Поток, зависший в драйвере без прерываемого таймаута, из Python не убивается —
  bounded по ёмкости, виден в `leaked_now`/`degraded`; восстановление — перезапуск
  воркера (процесс-изоляция — за рамками A1).
- Пинг под timeout защищает от зависшего `SELECT 1`, но зависший `conn.cursor()`
  ДО установки timeout в ping-пути остаётся теоретически возможным (курсор
  создаётся после установки timeout — окно минимально, pyodbc `cursor()` —
  локальная операция, не сетевая) **[static]**.
- Heartbeat — диагностический сигнал жизни CLAIM-LOOP'а (не отдельных run'ов):
  выводится в watchdog-отчёте; на reap-решения НЕ влияет — queued не reap'ится
  никогда. Зависшая навсегда очередь разбирается оператором по диагностике
  (`stale_queued_run_ids`), не watchdog'ом.
- LDAP `receive_timeout` покрывает ожидание ответа; разрыв TLS-handshake в
  середине покрыт `connect_timeout` частично.
- `run_coroutine` (warehouse): брошенный поток non-daemon — до внутреннего
  45s-бюджета 1C при рестарте.
- `asyncio.wait_for` на confirm отменяет корутину, не поток — действие может
  завершиться в фоне (поэтому 504 «исход неизвестен», repair-слой согласует).
- Heartbeat single-writer: два воркера на одной БД пишут один ключ — `worker_alive`
  в выводе показывает «хотя бы один живой цикл»; на reap-решения heartbeat не
  влияет (queued не reap'ится никогда), точность диагностики при нескольких
  воркерах — приближённая.

## 10. Развёртывание и откат

Deploy: обычный деплой; новые env опциональны, дефолты консервативны. Миграций нет
(heartbeat — строка в существующей `app_settings`). Watchdog opt-in; рекомендуется
`AI_RUN_WATCHDOG_DRY_RUN=1` сначала. Rollback: revert коммита.
Мониторинг: `ai_tool_*`, `ai_run_watchdog` логи; `ai_tool_executor_stats()`,
`skipped_queued` в выводе watchdog.
