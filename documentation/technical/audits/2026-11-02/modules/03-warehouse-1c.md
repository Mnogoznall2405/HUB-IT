# 03. Warehouse 1C, каталоги и сверка

Дата: 2026-11-02. Режим: read-only; создан только этот отчёт.
Главный вывод: найдено смешение локальных OWNER_NO разных HUB DB; реальная функция суммировала оборудование двух разных людей и вернула status=ok/exact=True.
Дополнительно обнаружены blocking SQL в async match-to-hub, потеря признака неполноты при HUB-ошибках и незакрытые границы согласования PostgreSQL/SQL Server.
Реестр: **6 находок: 3 High, 3 Medium**. R — изолированное воспроизведение; S — статически подтверждено; H вынесено отдельно.
COM/1C, production PostgreSQL/SQL Server, `.env` и реальные credentials не использовались.

## Архитектура и источники истины

| Слой | Точки входа и зависимости | Граница ответственности |
|---|---|---|
| UI | `frontend/src/pages/Warehouse1C.jsx`, `pages/database/useEmployeeEquipmentData.js` | Каталог, остатки, сотрудники, сравнение, история, ручное подтверждение |
| HTTP | `backend/api/v1/warehouse_1c.py` | Permission, current/all scope, expected state, validation, API error contract |
| Service facade | `backend/services/warehouse_1c_service.py` | COM bridge/pool, каталог/snapshot read, balances, matches, movement attachments |
| Изоляция COM | `WEB-itinvent/backend/services/warehouse_1c_process_bridge.py:454`, `warehouse_1c_process_dispatcher.py` | Ограниченная очередь, один исполнитель, deadline/restart, read operations allowlist |
| App catalogue | `one_c_catalog_snapshot_service.py`, `one_c_catalog_compact_*` | Поколения каталога и индексы, публикация/поиск app-owned snapshot |
| Scope | `WEB-itinvent/backend/services/warehouse_1c_scope.py:23`, `:42`, `:76` | All — явный deployment allowlist, current — выбранная DB |
| Reconciliation | `WEB-itinvent/backend/services/warehouse_1c_reconcile.py:1281`; `WEB-itinvent/backend/services/one_c_reconcile_registry_service.py:176` | Подтверждённый registry link/audit в PostgreSQL, legacy PART_NO projection в SQL Server |
| IT/construction requests | `warehouse_1c_it_requests.py`, `warehouse_1c_construction_requests.py` | Cached snapshot, фильтры, курсор, stages, details |

Warehouse интеграция читает 1С и не создаёт в ней документы или движения; `one_c_sync_state=not_requested` в transfer — это контракт, не забытая доставка.
Registry в app — источник подтверждённых связей; legacy PART_NO и fuzzy name match не являются доказательством точного совпадения.
Числовой OWNER_NO уникален только внутри конкретной HUB DB; объединять его без database key нельзя.
COM worker deadline и HTTP cancellation — разные жизненные циклы; завершение HTTP не доказывает завершения внешней операции.
App snapshot и live 1C могут иметь разное время обновления, поэтому UI нужен явный as_of/status/source.

## Инварианты и текущие результаты

| Проверка | Доказательство | Вывод |
|---|---|---|
| Нет записи в 1С при ручном reconcile | `WEB-itinvent/backend/services/warehouse_1c_reconcile.py:1295-1301` | Сохранено; writes только HUB/app |
| All scope требует admin/allowlist, отсутствие current не расширяет обычный HTTP запрос | `WEB-itinvent/backend/api/v1/warehouse_1c.py:155`; `WEB-itinvent/backend/services/warehouse_1c_scope.py:42` | Fail-closed на API; direct helper fallback отдельно учитывать |
| Ручной apply требует confirm и observed PART_NO | `WEB-itinvent/backend/api/v1/warehouse_1c.py:1103-1111` | Есть explicit guard |
| Registry mutation защищена expected_version | `WEB-itinvent/backend/services/one_c_reconcile_registry_service.py:176`; `WEB-itinvent/backend/services/warehouse_1c_reconcile.py:1354` | CAS/конфликт предусмотрены; не равны distributed transaction |
| Fuzzy автоматический batch не подтверждает связь | `WEB-itinvent/backend/services/warehouse_1c_reconcile.py:1451-1464` | Preview-only, сохранять |
| Incomplete balances не называются точной сверкой | `WEB-itinvent/backend/services/warehouse_1c_service.py:3798`, `:4063` | Есть защита 1C-половины; HUB-side failure отдельный дефект DWH-03 |
| Один owner id в нескольких DB не смешивается | `WEB-itinvent/backend/services/warehouse_1c_service.py:4074`, `:4105`, `:4110` | Нарушен, DWH-01 |
| Async match не блокирует event loop на SQL | `WEB-itinvent/backend/services/warehouse_1c_service.py:4366`; `:4229` | Нарушен, DWH-02 |
| Request IDs bridge не принимают чужой response | `WEB-itinvent/backend/services/warehouse_1c_process_bridge.py:492`, `:521` | Есть correlation/pending bookkeeping |
| Queue bridge ограничена, ожидание имеет timeout | `WEB-itinvent/backend/services/warehouse_1c_process_bridge.py:485`, `:503`, `:531` | Есть backpressure; не объявлять безлимитной |
| Новый каталог не публикуется как незавершённое поколение | `WEB-itinvent/backend/services/one_c_catalog_snapshot_service.py:1-7` и publication paths | Архитектура immutable generations; полная race/DB приёмка не проводилась |
| Переключение сотрудника не принимает старые candidate balances | `useEmployeeEquipmentData.js:270` | Session guard есть |
| Старые warehouse movements не попадают в нового сотрудника | `useEmployeeEquipmentData.js:209-235` | Нет аналогичного guard, DWH-05 |

## DWH-01 — разные люди из разных DB склеиваются по OWNER_NO

**High, R нового углубления; M.**
Код: `WEB-itinvent/backend/services/warehouse_1c_service.py:4074`, `:4105`, `:4110-4124`, `:4153`.
Caller: `WEB-itinvent/backend/api/v1/warehouse_1c.py:307-325`, service `get_balances_with_hub(scope=all)`.
covered_owner_nos — set[int], hub_only_by_owner — dict[int,...], хотя owners принадлежат разным SQL Server DB.
Если A:OWNER_NO=7 — Alice с двумя устройствами, B:OWNER_NO=7 — Bob с тремя, hub_only результат содержит одну строку Alice count=5.
Другой вариант: OWNER_NO из одной DB попал в covered_owner_nos, и реальный другой человек во второй DB исключается на `:4105`.
Выходная hub_only строка не несёт hub_db_id, поэтому caller не может восстановить потерянную идентичность.
Новый isolated harness извлёк реальный async get_balances_with_hub через AST; заменены только imports/DB/COM зависимости и каталог DB.
Набор: balances=[], valid ref/model, две DB, одинаковый owner_no, разные ФИО и counts.
Результат: `CROSS_DB_OWNER_COLLISION [('Alice', 5)]`, `STATUS ok EXACT True`, assert одной строки и суммы=5 прошёл, exit=0.
Это не production query и не E2E; показан реальный механизм агрегации.
Fix outline: ключи `(db_id, owner_no)` во всех covered/count/hub-only структурах и hub_db_id в каждой строке.
Если нужна дедупликация физического человека, нужен явный устойчивый identity key/подтверждённая связь, не совпадение локального PK или только ФИО.
Приёмка: одинаковые OWNER_NO с разными людьми, один человек с разными OWNER_NO, совпадение ФИО разных людей и covered-owner в другой DB.
Проверить навигацию из итоговой строки в правильную DB и карточку сотрудника.

## DWH-02 — синхронные SQL/registry calls внутри async match-to-hub

**High, S; M.**
HTTP: `WEB-itinvent/backend/api/v1/warehouse_1c.py:577-596` непосредственно awaits coroutine service.
Service: `WEB-itinvent/backend/services/warehouse_1c_service.py:4358-4374` синхронно вызывает _resolve_prefer_owner_no_for_db и _match_nomenclature_to_hub_one_db.
SQL owner lookup: `:4205`; equipment query: `:4229`; registry reads: `:4252`.
В отличие от balances_with_hub, где те же SQL-пути используют asyncio.to_thread (`:3865`, `:3948`), этот путь не offloaded.
Один медленный SQL Server запрос блокирует event loop и задерживает другие API/WS на том же runtime.
При all scope задержки нескольких DB выполняются последовательно; конкретные production p95 и loop lag не измерены.
Fix outline: один coherent синхронный read-workflow запускать в existing threadpool с bounded concurrency; не распараллеливать произвольно все configured DB.
Контекст user/db/observability должен сохраниться при переносе, аналогичные mail ContextVar проблемы не повторять.
Приёмка: замедленная fixture SQL query одновременно с быстрым unrelated API; event loop heartbeat/latency не должен ждать blocking query.
Performance baseline: p50/p95/p99 и loop lag при 1/10/30 одновременных match requests, одинаковые DB/объём и query count.

## DWH-03 — ошибка HUB contributor не делает ответ неполным

**High, S; M.**
Код: `WEB-itinvent/backend/services/warehouse_1c_service.py:3864-3868`, `:4094-4096`, `:4174-4183`.
Неудачная загрузка owners или all-owner counts логируется и пропускается; общий status/exact строится только из completeness 1C balances.
В текущем коде count_failed_db_ids учитывает узкий per-owner count path, но не failed list_owners и failed hub-only query.
Сценарий: 1C ответ полный, DB A отдала HUB данные, DB B недоступна; API способен вернуть status=ok/exact=True для частичной HUB выборки.
Даже hub_count_kind=candidate не объясняет, что целый contributor отсутствует.
Сходный пробел в match-to-hub: `:4375-4382` сохраняет error внутри databases, но верхнеуровневый результат не имеет status/has_more для partial aggregate (`:4453`).
Fix outline: объединить completeness всех required contributors, добавлять per-DB errors, unknown counts/общий incomplete; не превращать failure в отсутствие оборудования.
Partial UI может показывать успешные строки, но должен сохранить ошибку и запретить вывод о полной сверке/нуле.
Приёмка: отдельно list_owners failure, per-owner count failure, hub-only count failure и registry unavailable; сравнить current/all scope.
Реальный DB outage/fault injection в этом углублении не запускался; вывод S по error/return paths.

## DWH-04 — crash между PART_NO projection и registry оставляет несогласованность

**Medium, S; L.**
Код: `WEB-itinvent/backend/services/warehouse_1c_reconcile.py:1359-1377`, `:1381-1405`.
Сначала SQL Server PART_NO update завершается, затем отдельной транзакцией сохраняется PostgreSQL registry/audit.
Обычное исключение компенсируется условным PART_NO rollback; процесс crash после первой записи не запускает except.
В рассмотренном flow нет durable intent до projection и recovery queue для незавершённой пары операций.
Legacy consumers могут увидеть PART_NO нового значения при старой/отсутствующей подтверждённой registry link.
Это не утверждение о записи в 1С: внешняя 1C база здесь не меняется.
Fix outline: durable mutation intent/state machine с correlation ID, recovery сверкой обоих stores и CAS; либо явное разделение confirmed link и asynchronous projection.
Rollback не должен перезаписывать новое значение другого оператора; существующий value-CAS полезен, но не заменяет durable ownership.
Приёмка: terminate между projection и registry, недоступность app DB, повтор exact same request, конкурентный apply, recovery после restart.
Нужна бизнес-политика допустимого времени расхождения и источник истины для legacy consumers; автоматический repair production отдельно согласовывается.

## DWH-05 — старый ответ истории склада перезаписывает новый контекст

**Medium, S; S/M.**
Код: `WEB-itinvent/frontend/src/pages/database/useEmployeeEquipmentData.js:209-235`, `:240-246`.
Главная загрузка employee equipment защищена cancelled (`:94`, `:108`), candidate balances — session generation (`:270`).
loadWarehouseMovements не проверяет ни отмену, ни current employee/warehouse/period после await, и finally безусловно снимает loading.
Сценарий: открыть movements A → быстро сменить сотрудника/warehouse на B; старый A завершится после reset и запишет свои строки в B.
Смена диапазона дат также допускает обратный порядок двух ответов и старую append page.
Fix outline: identity `{employee,db,warehouse,dateRange,requestSeq}`, AbortController и guard success/error/finally.
Приёмка: A→B с задержкой A; два диапазона; load more одновременно с reset; закрытие/повторное открытие dialog.
Браузерный E2E здесь не выполнялся; нет основания называть этот путь уже защищённым из-за guards соседних запросов.

## DWH-06 — fallback suggestion разрастается в серию COM запросов

**Medium, S; M.**
Код: `WEB-itinvent/backend/services/warehouse_1c_service.py:3169-3205`.
Если app snapshot/legacy cache не дали путь, алгоритм перебирает tokens и каждую префиксную длину до минимального размера.
Каждая неудачная длина делает отдельный _run_pooled search; на длинном редком запросе число последовательных COM calls растёт с суммарной длиной токенов.
Лимит возвращаемых rows не ограничивает число вызовов, поэтому один пользователь способен долго занимать общий COM контур.
Реальный fallback runtime и max входного текста API следует измерить; в нормальном snapshot режиме проблема может не достигаться.
Fix outline: общий budget/deadline запросов и ограниченный набор fallback префиксов, не сокращать на символ все токены; предпочитать app snapshot.
Приёмка: cache cold/unavailable, длинные неизвестные terms, очередь других пользователей, проверка соблюдения общего deadline.
Не заявляется измеренное ускорение; нужен baseline COM call count/queue wait/p95 по одинаковым строкам и каталогу.

## Производительность, лимиты и recovery

| Контур | Что найдено | Что сохранять/проверить |
|---|---|---|
| Process bridge | Capacity slots, execution lock, bounded queue, request correlation, deadline restart (`process_bridge.py:485-583`) | Не убирать serial COM ownership ради throughput; мерить queue wait и worker occupancy |
| Catalogue snapshot | Immutable generation и отдельные compact/token read paths (`catalog_snapshot_service.py:1`) | Не публиковать частичный каталог; проверить transaction promotion и old-reader retention на test DB |
| Multi-DB balances | Owners/counts offloaded, DB обход последовательный (`service.py:3857`) | Ошибки contributor видимы, лимит DB explicit, query time по DB |
| Reverse match | Blocking reads в event loop, DWH-02 | Offload не должен менять permission/scope и error contract |
| Employee warehouses | Candidate load concurrency ограничена в `useEmployeeEquipmentData.js:313` | Сумма возможна только при полной успешной загрузке всех кандидатов (`:322`) |
| Movement pagination | Лимит/cap отражаются как incomplete (`service.py:4953`, `:5032`) | Не менять incompleteness на пустой успешный список |
| File preview | Вынесен в document preview job service (`service.py:5687`) | Отдельные timeout, content bytes/hash и принадлежность registrar |

## Тесты, пробелы и приёмка

Существующие relevant suites: `tests/test_warehouse_1c_scope.py`, `test_warehouse_1c_balances_with_hub.py`, `test_warehouse_1c_match_to_hub.py`.
Reconcile: `tests/test_warehouse_1c_reconcile.py`, `test_warehouse_1c_reconcile_api.py`, `test_one_c_reconcile_registry_service.py`.
Snapshot/bridge: `tests/test_one_c_catalog_snapshot_service.py`, `test_warehouse_1c_process_bridge.py`, `test_one_c_catalog_compact_versioned_rebuild.py`.
Employee aggregation: `tests/test_warehouse_1c_employee_compare_summary.py`, `test_warehouse_1c_owner_mismatch.py`, `test_warehouse_1c_hub_over_1c.py`.
Movements: `tests/test_warehouse_1c_warehouse_movements.py`; frontend `EmployeeEquipmentDialog.test.jsx` и связанный hook через компонент.
В этом углублении обычные suites не запускались; выполнен новый isolated AST async harness DWH-01, exit=0.
Первый harness запуск не имел aggregate_balance_rows stub и завершился AttributeError, после добавления только этого dependency успешен; это ошибка harness, не продуктовый результат.
Нужно добавить boundary сценарии same OWNER_NO разных DB, error contributor, event-loop contention и перемена контекста движений.
Наличие тестов per-owner count failure не закрывает failed owners/hub-only contributors.
Тесты compact PG и bridge нужно отдельно проверять на явную тестовую цель/искусственный dispatcher до запуска.

## Отвергнутые подозрения и открытые вопросы

- All scope не равно всем configured DB: явный allowlist уже есть; старую претензию о безусловном широком доступе не повторять.
- API apply-part-no требует expected_part_no: отсутствие этого параметра в service default не является обходом текущего HTTP guard.
- Fuzzy FIO/part candidate помечается candidate; не называть его подтверждённой immutable registry link.
- Неполные остатки обнуляют confident comparison, поэтому limit сам по себе не доказывает ложное равенство.
- Bridge имеет bounded очередь; не объявлять его queue безлимитной только из-за числа клиентов.
- Race публикации compact generations требует PG test с двумя rebuild writers; без него не утверждается lost update.
- Compensation при исключении есть; DWH-04 относится к process crash, а не к каждому PostgreSQL error.

## Покрытие чтением и ограничения

Прочитаны relevant blocks `warehouse_1c_service.py` balances/match/movements/requests/suggestion, `warehouse_1c_scope.py` целиком, apply-part-no/reconcile helpers и API guards.
Прочитан основной process bridge call/queue/restart path и описание/entrypoints catalog snapshot; compact writer/search/backfill не прочитаны целиком.
Просмотрены registry mutation/query entrypoints, frontend employee hook и его guards, список/ключевые existing assertions тестов.
Не проверены реальные 1C metadata/register semantics, доступ service user, COM crash dumps, catalogue volume, PG query plans, текущие migrations/данные и физический Android.
Нужны отдельные safe integration/fault tests и production read-only baseline перед оценкой времени/приоритетов rollout.
Исходники и runtime не изменены. Исправления, schema changes, config, restart/deploy и repair данных требуют отдельного согласованного запроса.
