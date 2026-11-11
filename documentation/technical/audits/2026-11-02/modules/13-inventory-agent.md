# 13. Inventory: ingest server, runtime store и Windows agent

Дата задания: 02.11.2026. Проверка свежего рабочего дерева: 03.11.2026.
Режим: read-only аудит кода; запись только этого Markdown; временные isolated harness.
Production DB, .env, сеть, установки MSI, Scheduled Tasks и сервисы не изменялись.
R — воспроизведено; S — подтверждено исходниками; H — гипотеза или непроверенная эксплуатационная граница.
Severity отделена от уверенности: отсутствие production воспроизведения отмечено явно.

## Главный вывод

В Windows agent найден воспроизводимый путь удаления единственной копии отчёта при ошибке dead-letter write.
Корневой `agent.py` и `agent/src/itinvent_agent/agent.py` имеют одинаковый SHA256 на момент проверки.
Поэтому анализ transport/queue функций применим к runtime и packaged source, а не только к одному файлу.
Текущая история inventory на app-store пути уже записывается атомарно со snapshot внешним изменением.
Конструктор queue store больше не сбрасывает processing по умолчанию: прежний maintenance race изменён извне.
Оставшиеся риски — ACK без валидации, недостаточная изоляция host identity и незавершённая межпроцессная модель queue.

## Архитектурная карта

```text
Windows agent collect_inventory → local pending JSON → _post_payload
    → inventory_server.app.receive_inventory → durable SQLite queue
    → InventoryWorker.claim_next_batch → inventory_runtime.process_inventory_payload
    → normalize identity / merge heartbeat / ordering check / hardware diff
    → AppInventoryStore.upsert_host(snapshot, change_events) → PostgreSQL app schema
    → done/retry/dead queue state
Agent scan/fs-egress/browser sidecars → отдельные endpoints/stores, не hardware snapshot
Web inventory read APIs → app inventory store/search indexes → frontend projections
```

Agent runtime: `agent.py:3258`, `:3513`, `:3634`.
Agent package source: `agent/src/itinvent_agent/agent.py`, полностью совпадает с корневым по SHA256.
Ingest API: `inventory_server/app.py:183-204`.
Durable ingest queue: `inventory_server/database.py:13-22`, claim `:108`.
Worker: `inventory_server/worker.py:39-73`, `:96-116`.
Runtime: `WEB-itinvent/backend/inventory_runtime.py:856`.
Snapshot/history store: `WEB-itinvent/backend/appdb/inventory_store.py:944-1006`.
Inventory endpoint не выполняет всю SQL обработку синхронно в HTTP запросе: он подтверждает durable queue.
Это снижает сетевые timeout, но требует честного различения accepted/processed/dead.

## Контракты и инварианты

Agent queue: pending → HTTP accepted → удаление локального JSON.
При transport failure pending сохраняется, attempts/backoff обновляются.
При pruning pending должен перейти в durable dead-letter; ошибка записи не даёт права удалить source.
Server queue: queued → processing → done / queued(next_attempt_at) / dead.
Worker restart должен возвращать только потерянные claims, а maintenance не должен трогать живые claims.
Одновременные процессы не должны выдавать одну запись двум workers.
Dedup key: normalized MAC + timestamp + report_type, `WEB-itinvent/backend/inventory_runtime.py:849-853`.
Snapshot должен быть монотонным по времени, last_seen_at — max старого и нового значения.
Heartbeat не должен стирать hardware поля последнего full snapshot.
Hardware diff event должен коммититься вместе с соответствующим snapshot.
Retry после DB failure не должен потерять diff из-за уже обновлённого previous snapshot.
Одинаковый timestamp не является полной уникальностью payload: нужны условия контракта при конфликте содержимого.
Host ownership не должен определяться только присланной строкой MAC при общем credential.
Операторские soft-hide flags не должны сбрасываться ingest отчётом.

## DINV-01 — pending удаляется после failed dead-letter write

Severity: High. Доказательство: R. Статус: OPEN, NEW.
Код: `agent.py:3395-3408`, идентично `agent/src/itinvent_agent/agent.py:3395-3408`.
Callers: `_inventory_queue_prune_limits`, `agent.py:3435-3466`; invalid payload path `:3547-3549`.
При disk full/ACL failure `_inventory_queue_write(dead_path, payload)` падает.
Исключение логируется, затем source всё равно удаляется через path.unlink.
Утрачивается единственный локальный report, который ещё не получил server ACK.
Особенно опасен overload сценарий: лимит очереди срабатывает именно при проблемах доставки и диска.
AST harness исполнил текущую функцию, writer детерминированно бросал OSError.
Исходный временный JSON после вызова отсутствовал, dead-letter не был создан; assertion подтвердил потерю.
Минимальное исправление: return/raise при ошибке сохранения, unlink только после успешного durable transition.
Можно использовать атомарный rename с сохранением причины; учитывать collision/cross-volume отдельно.
Acceptance: source SHA256 сохраняется при write failure, повтор успешного move создаёт одну целевую запись.
Проверить обе копии agent source и MSI build input, чтобы исправление не осталось только в root runtime.

## DINV-02 — HTTP 2xx принимается без проверки application ACK

Severity: Medium. Доказательство: S. Статус: OPEN.
Код: `agent.py:3339-3361`, caller `send_data`, `:3552-3560`.
После `raise_for_status()` `_post_payload` возвращает True, не читая JSON success/queued/id.
`send_data` удаляет локальный pending сразу по этому bool.
Ответ 200 с ошибочным JSON, false success или HTML от неверной proxy target приводит к потере retry copy.
Нормальный текущий ingest всегда отдаёт success=true; дефект относится к ошибке маршрутизации/контракта и регрессиям API.
Данный сценарий не воспроизводился через реальный IIS; поведение функции подтверждено исходниками.
Минимальное исправление: проверять ожидаемый JSON contract и accepted/dedup status перед удалением.
Для dead duplicate сервер должен честно сообщать терминальную ошибку или предоставлять контролируемое переоткрытие.
Acceptance: 200 HTML, malformed JSON и success=false сохраняют pending; валидный accepted удаляет его.
Отдельно проверить timeout после durable server enqueue: повтор должен возвращать тот же queue id без дублей.

## DINV-03 — общий agent key даёт чтение чужих probe данных

Severity: High. Доказательство: S. Статус: OPEN, прежняя NEW-SC-02.
Код: `inventory_server/app.py:119-126`, GET endpoints `:219-237`, `:305-326`, `:387-404`, `:461-489`.
Проверяется membership API key, но не scope/host ownership.
Ключ на одной рабочей станции позволяет читать egress/browser/chat отчёты других computer_name.
Ограничение listen address может снижать доступность, но конфигурация IIS/ACL в этом аудите не проверялась.
Не использовались реальные ключи, payload или network requests.
Минимальное исправление: отделить ingest credential от reader authorization и закрыть agent GET.
Чтение для портала проводить через существующий backend JWT/permission слой.
Acceptance: enrolled agent A не читает данные B; portal permission matrix покрывает списки, HTML и media.
Raw report HTML требует отдельного sandbox/CSP контракта; stored XSS здесь не воспроизводился.

## DINV-04 — очередь не имеет атомарного межпроцессного claim

Severity: Medium. Доказательство: R. Статус: OPEN при нескольких независимых store/workers/processes.
Код: `inventory_server/database.py:106-132`; mark_done/retry/dead `:153-190`.
SELECT queued и UPDATE processing защищены process-local RLock, не общей DB claim транзакцией с CAS.
SELECT в sqlite3 сам по себе не начинает write transaction; два процесса могут увидеть одинаковые rows.
UPDATE не содержит status='queued', claim token и проверки количества обновлённых строк.
Свежий harness создал два store одного временного SQLite и синхронизировал SELECT через barrier перед UPDATE.
Оба claim_next_batch вернули один и тот же id; обработка и SQL исполнялись исходными методами, exit 0.
Два независимых store в потоках воспроизводят ту же границу, что разные процессы: RLock у каждого свой.
Обычный одиночный inventory_server worker сериализован и этим сценарием не затронут.
`app.py:41` явно recover_interrupted=True на каждом старте приложения; владельцы не маркируются в таблице.
Параллельный старт другого приложения может вернуть живую processing запись в queued.
Maintenance больше не вызывает этот reset по умолчанию: прежняя конкретная ошибка изменилась.
Минимальное исправление: атомарный claim/CAS в write transaction плюс token/lease или гарантированный single owner lock.
Acceptance: два процесса и N jobs — каждая job принадлежит одному claim; stale done/retry не меняют новый claim.
Multiprocessing acceptance ещё нужен для полной модели запуска; production workers для проверки не запускались.

## DINV-05 — отсутствует server backpressure для inventory reports

Severity: Medium. Доказательство: S; фактическая перегрузка — H.
Код: `inventory_server/app.py:183-204`, `inventory_server/database.py:67-92`.
Каждый новый dedupe key сохраняет JSON; API всегда сообщает retry_after_sec=0.
Нет прикладного лимита active depth, payload bytes или свободного места перед enqueue.
Долгий отказ SQL backend растит durable SQLite быстрее, чем worker может разгрузить очередь.
Агент имеет собственные ограничения pending; сервер не передаёт ему сигнал 429/Retry-After.
Pydantic InventoryPayload содержит неограниченные списки/Dict, `WEB-itinvent/backend/inventory_runtime.py:56-87`.
Минимальное действие: измерить ingest/flush, установить bounded queue/byte budget с fail-closed 429.
Acceptance: при недоступном target store очередь ограничена; agent сохраняет retry copy, запрос не подтверждается ложно.
Считать count/bytes через дешёвые cached metrics, чтобы сам admission не стал тяжёлым full scan.

## DINV-06 — latest-first backlog и история изменений

Severity: Medium. Доказательство: S/H. Статус: OPEN QUESTION бизнес-контракта.
Код: `agent.py:3524-3536`; stale guard `WEB-itinvent/backend/inventory_runtime.py:883-892`.
Agent намеренно отправляет текущий report раньше backlog; это проверяется существующим test_send_data_sends_current_payload_before_backlog.
После принятия более свежего snapshot/heartbeat старые queued reports могут быть отброшены как stale.
Для текущего состояния это защита от rollback; для истории аппаратных переходов это потеря промежуточных событий.
Гарантия хранения всех offline hardware transitions в документации не установлена.
Не считать это дефектом без согласованного значения истории: latest state против полноценного event history.
Если история обязательна, сохранять исторические факты отдельно от обновления current snapshot.
Acceptance: сценарий A→B→C offline имеет заранее согласованный результат в current state и audit history.
Нельзя просто убрать stale guard: это вернёт старое оборудование в актуальный snapshot.

## DINV-07 — sidecar backoff сбрасывается до проверки стабильности

Severity: Low/Medium. Доказательство: S/H. Статус: прежний AUD9-038 остаётся частично открытым.
Код: `agent.py:3673-3698`, аналогичные fs-egress/browser supervisors `:3700-3752`.
После Thread.start немедленный is_alive обычно True даже если target упадёт через миллисекунды.
На этой ветке attempt reset=0 и next_restart=now, поэтому заявленный exponential backoff не срабатывает при delayed crash.
Повторная попытка зависит от основного heartbeat loop, поэтому это не tight busy loop.
Минимальное исправление: считать стабильный uptime/успешную готовность, а не мгновенный thread liveness.
Acceptance: delayed crash series приводит к 10/30/60/300 интервалам; стабильная работа сбрасывает счётчик.
Windows sidecars и Scheduled Task recovery в реальном окружении не запускались.

## Статусы предыдущих выводов и false positives

SC-04 / NEW-SC-12 maintenance reset: CHANGED — default recover_interrupted=False, `database.py:13-22`.
`inventory_server/__main__.py:30` создаёт store без recovery; старый двух-store startup harness больше не применим как есть.
Остаточная multi-owner проблема вынесена DINV-04; single process maintenance не обвиняется в повторном claim.
SC-05 snapshot/history split: CHANGED — runtime передаёт change_events в upsert, `WEB-itinvent/backend/inventory_runtime.py:936-940`.
Store применяет events в той же app_session, `inventory_store.py:956-1006`.
Это устраняет прежний конкретный crash window на app-store пути; legacy JSON path остаётся отдельным контрактом.
Heartbeat merge сохраняет отсутствующие hardware поля; не считать каждый partial payload стиранием snapshot.
Store использует with_for_update для существующего host и stale timestamp guard; это реальная защита от rollback.
Операторские hide flags не сбрасываются agent ingest, `inventory_store.py:999-1002`.
SHA256 root/package равен: 2751243C075818AA4A4169D8E14B3C1A7F73CF9CF91C5361F88B5CF6100F7454.
Одинаковые исходники — положительная проверка целостности, но не доказательство подписи или содержимого установленного MSI.
Agent TLS verify не отключён по умолчанию: `_requests_verify_arg`, `agent.py:3335-3336`.
Local pending write использует atomic helper; atomic rename сам по себе не доказывает fsync при потере питания.

## Проверки и безопасный performance baseline

Изолированный первый проход воспроизвёл startup recovery race до внешней правки конструктора.
Свежий fault injection DINV-01 подтвердил потерю pending на реальном текущем source через AST, без Windows imports.
Свежий SQLite barrier harness DINV-04 подтвердил duplicate claim двумя независимыми store; exit 0, temp очищен.
Focused pytest: 25 passed, 2 warnings, exit 0, включая 16 tests/test_inventory_server.py и Scan recovery/OCR/backpressure.
Команда: `python -m pytest -q tests/test_scan_server_tables.py::test_repeated_crash_recovery_ends_in_failed_instead_of_retrying_forever tests/test_scan_server_tables.py::test_stale_owner_cannot_finish_or_record_findings_for_a_reclaimed_job tests/test_scan_server_worker.py::test_ocr_task_over_deadline_does_not_block_the_next_job_and_shutdown_is_bounded tests/test_inventory_server.py tests/test_scan_agent_backpressure.py`.
Все 16 inventory tests прошли, включая maintenance-open regression, ordering и retry/dead-letter worker.
После summary atexit cleanup pytest сообщил WinError 5 на pytest-current; assertions прошли, общий cleanup неполный.
Продуктовый defect не выводится из ошибки cleanup; чужие temp каталоги не удалялись.
Не запускались SQL Server, production PostgreSQL, network endpoints, реальные Windows registry/WMI и MSI update.
Оценки throughput/p95/p99 в этом отчёте отсутствуют: нагрузочного baseline не было.
Нужен test workload с одинаковыми host count, report bytes, full/heartbeat ratio и outage duration.
Измерять enqueue p95/p99, SQLite busy, worker flush, target SQL time, queue oldest age, RSS и диск/WAL.
Для merge/ordering: empty fields, heartbeat до первого full, equal timestamp conflicting payload и clock rollback.
Для durability: crash после local write, после server enqueue, после target commit и перед mark_done.
Для retry: timeout after commit должен дедуплицироваться; exhausted dead должен быть явно виден оператору.
Для concurrency: два независимых процесса, host first insert и parallel full/heartbeat с разными timestamps.

## Охват и ограничения

Прочитаны agent collect/send/prune/backoff/status/supervisor и packaged source parity.
Прочитаны inventory app endpoints, queue store claim/recovery/retention и worker loop.
Прочитаны runtime normalization/merge/dedupe/stale/history и app-store snapshot/event transactions.
Прочитаны текущие tests/conftest guards и релевантные tests/test_inventory_server.py/test_agent.py.
Probe media storage и весь browser/Telegram collection не проходили полный построчный аудит.
Первичная identity collision MAC/hostname, reinstallation и first-insert race требуют самостоятельного test matrix.
Нет утверждения, что live inventory database цела: это требует отдельно разрешённого read-only DB audit.
Документ не разрешает cleanup, vacuum, retention delete или развёртывание.
Следующий приоритет: DINV-01, затем application ACK/reader scope; queue/perf исправлять после isolated acceptance.
Файлы кода этот аудитор не менял; публикация и restart потребуют отдельного запроса.
