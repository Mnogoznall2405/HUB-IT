# NETWORKS / MONITORING / IT OBJECTS / MFU / DISCOVERY

Дата начала: 2026-11-02; повторная проверка и завершение: 2026-11-03.
Область: текущие файлы рабочего дерева, включая незакоммиченные изменения.
Режим: read-only анализ кода; создан только этот отчёт. Production, сеть и `.env` не читались и не изменялись.
Проверена архитектура и критические переходы; это не доказательство целостности фактических production-данных.
R = воспроизведено изолированно на извлечённой реальной функции; S = подтверждено статическим путём вызовов; H = гипотеза, требующая приёмки/доменного решения.
Severity отдельно от R/S/H: High / Medium / Low. R не означает воспроизведение через боевой HTTP.
Предыдущие результаты не переносились автоматически: SWR и polling в рабочем дереве уже изменены.

## Главный вывод

- Наиболее существенная гонка находится в MFU: результат опроса привязан к key, но не к IP/поколению регистрации.
- MFU выполняет синхронную запись SQL прямо в async callback под общим asyncio-lock.
- Scheduler мониторинга повторно сортирует все target IDs для каждого target; локально 1000 целей дают около 2.37 секунды синхронной работы на reload.
- История мониторинга ограничивает готовый кеш, однако ожидающие одного результата запросы занимают executor threads.
- Передача устройства между IT-объектами атомарна, но проверка доступа и чтение device/history разделены во времени.
- Схемы, реальные IP-дубли, FK и расход соединений в production не измерялись.

## 1. NETWORKS: реестр, порты, розетки и карты

Граф: `frontend/src/pages/Networks.jsx` → `frontend/src/api/networks.js` → `backend/api/v1/networks.py` → `backend/services/network_service.py` → SQL-compat connection / app PostgreSQL либо разрешённое локальное хранилище.
Граф карты: upload → `upload_map` → `network_maps.file_blob` → `get_map_file_for_view` → PDF rasterization или original → Blob URL клиента.
Граф топологии: branch → device → port; branch → map → point; socket синхронизируется с port и map point в сервисе.
Типы `sqlite3.Connection` в аннотациях не доказывают SQLite runtime: сервис импортирует `SqlAlchemyCompatConnection` (`WEB-itinvent/backend/services/network_service.py:17-18`).
В проверенной реализации SQL-параметры отделены от значений; динамические имена полей обновления выбираются из фиксированных списков.

Инварианты:

- Port для точки должен принадлежать её branch и выбранному device (`WEB-itinvent/backend/services/network_service.py:2877-2910`).
- Перенос/создание point не должен образовывать конфликт socket; предусмотрены специальные проверки и repair-путь.
- UI не должен заменять актуальную ветку запоздавшим ответом другой ветки.
- Успешная мутация должна отображаться без восстановления старого кеша.
- Содержимое карты должно иметь разрешённый тип независимо от присланного браузером Content-Type.

### DNET-01 — произвольный тип карты открывается в origin портала

- Статус: S; High; ранее `NEW-FE-01`, остаётся открытым по текущему коду.
- Где: `WEB-itinvent/backend/api/v1/networks.py:731-735`; `WEB-itinvent/backend/services/network_service.py:3937-3991`; `WEB-itinvent/backend/api/v1/networks.py:520-543`; `WEB-itinvent/frontend/src/pages/Networks.jsx:1236`.
- Caller: загрузка карты передаёт `file.content_type`; `upload_map` сохраняет его; download отвечает `inline` с тем же типом; frontend открывает Blob URL.
- Сценарий: пользователь с правом загрузки помещает HTML/SVG; смотрящий открывает оригинал. Принятие MIME от клиента не является проверкой формата.
- Риск: выполнение активного содержимого в контексте Blob origin. Конкретный браузерный exploit/CSP в этом прогоне не проверялся.
- Исправление: allowlist форматов и валидация bytes; неподдержанные активные форматы отдавать attachment, не открывать через Blob.
- Приёмка: HTTP upload/download HTML/SVG не создаёт исполняемый inline-документ; PDF/PNG/JPEG сохраняют обычный просмотр и скачивание.

### DNET-02 — полное обновление сетевого контекста после точечной мутации

- Статус: S; Medium; развитие прежнего `NEW-FE-02`, задержки production не измерялись.
- Где: `WEB-itinvent/frontend/src/pages/Networks.jsx:752-765`, `:863-887`; callers `:1265`, `:1281`, `:1308`.
- Caller: `refreshBranchContext` после изменения запускает шесть чтений branch-context плюс branch-ports.
- В двух списках используется `limit:10000`; кеш перед этим инвалидируется.
- Риск: семь запросов и пересборка крупных списков при правке одного объекта; burst мутаций умножает работу.
- Исправление: применять ответ мутации к конкретному объекту, адресно обновлять зависимые summary/ports/map points.
- Приёмка: одинаковый филиал и сценарий до/после; число запросов, bytes, p50/p95 по нескольким повторам; проверить смену филиала во время записи.

### DNET-03 — размер загруженного PDF не ограничивает размер распакованного изображения

- Статус: S; Medium.
- Где: `WEB-itinvent/backend/services/network_service.py:3346-3362`, `:3364-3396`; caller `WEB-itinvent/backend/api/v1/networks.py:528`.
- `_render_pdf_first_page_to_png` делает `get_pixmap(Matrix(2,2))` по размеру страницы без pixel/dimension budget.
- Вход ограничен upload bytes (`WEB-itinvent/backend/api/v1/networks.py:22`, `:731`), но это не ограничивает огромный MediaBox или расход памяти rasterizer.
- Риск: высокое выделение RAM/CPU на корректном небольшом PDF с большой страницей; повторный просмотр повторяет конвертацию.
- Исправление: проверять размер страницы и максимальное число пикселей; уменьшать scale; кешировать безопасный derivative по checksum.
- Приёмка: isolated fixture большого MediaBox остаётся в лимите памяти/времени и выдаёт понятный отказ или ограниченное изображение.

Топологические проверки и границы:

- Проверка branch/device принадлежности port реально присутствует, отсутствие такой проверки не заявляется.
- `delete_device` удаляет родителя (`WEB-itinvent/backend/services/network_service.py:3686-3703`); окончательный результат для port/socket/point зависит от схемы и FK.
- Фактические FK/ON DELETE и orphan rows без запроса к БД не проверены; целостность production-топологии не объявляется подтверждённой.
- Повторная загрузка карты с тем же именем обновляет существующую строку и сохраняет map_id (`WEB-itinvent/backend/services/network_service.py:3968-4011`).
- Сохранение координат при замене плана может быть намеренным; нужен отдельный сценарий смены aspect ratio, это H, не новый доказанный баг.

## 2. MONITORING: scheduler, leases, probe и histories

Граф UI: `pages/Monitoring.jsx`, `pages/monitoring/useMonitoringHistory.js` → `api/monitoring.js` → `api/v1/monitoring.py` → service/store.
Граф записи: `_owned_loop` → `collect` → protocol advisory lease → `NetworkMonitorProbe` → `_record` semaphore → `MonitoringStore.record` → samples/aggregates/current/events.
Граф истории: route → `read_response` → `asyncio.to_thread` → `history/latency_history` → bounded ready cache / pending Future → SQL samples/aggregates → JSON/gzip.
SNMP выполняется async с ограниченным timeout; ICMP вынесен в отдельный 12-thread executor (`WEB-itinvent/backend/services/network_monitor_probe.py:72-87`).
Owner lease удерживается отдельным autocommit connection; target/protocol lease тоже удерживает соединение (`WEB-itinvent/backend/services/network_monitor_service.py:44-76`).

Инварианты:

- Один owner и не более одного активного probe данного target/protocol между процессами.
- Config revision и protocol clock должны отбрасывать старые результаты.
- Отмена HTTP/worker не должна освобождать lease раньше фактического commit.
- SQL pool должен иметь резерв для prepare/read/write при всех удерживаемых leases.
- Неизвестное качество измерения не должно превращаться в доказанную недоступность/нулевую задержку.
- Кеш истории обязан проверять существование target/interface и не смешивать интерфейсы разных target.

### DNET-04 — квадратичная подготовка фаз блокирует event loop

- Статус: R; Medium, при высокой cardinality возможен High.
- Где: `WEB-itinvent/backend/services/network_monitor_service.py:38-40`, `:247-257`; caller `_owned_loop` раз в пять секунд.
- `schedule_phase` сортирует и хеширует все IDs заново для каждого target и каждого протокола.
- Алгоритм reload: примерно O(N² log N), выполняется синхронно внутри async loop.
- AST-harness реальной функции, два протокола, три повтора: N=100 — 22.02/22.12/21.71 ms; N=500 — 598.32/598.59/572.94 ms; N=1000 — 2371.88/2388.63/2358.08 ms.
- Это локальная синтетика, не production baseline и не p95 API; сетевые/SQL вызовы исключены.
- Исправление: один sorted IDs и rank-map на reload; фаза вычисляется из rank за O(1).
- Приёмка: те же IDs/порядок/фазы, те же объёмы и повторы; дополнительно event-loop lag и p95 HTTP при фоне.

### DNET-05 — фиксированные SNMP slots могут исчерпать малый SQL pool

- Статус: S, условный по конфигурации; Medium.
- Где: `WEB-itinvent/backend/services/network_monitor_store.py:64-70`; `WEB-itinvent/backend/services/network_monitor_service.py:59-76`, `:157-170`, `:239`.
- ICMP минимум один, SNMP всегда четыре, owner один: до шести удерживаемых lease connections до prepare/record.
- При pool budget <=6 резерв для DB чтения/записи не обеспечивается; доступные настройки не отвергаются как недопустимые.
- Реальный pool в этом прогоне не читался; дефект нельзя описывать как подтверждённую production-сатурацию.
- Исправление: рассчитывать оба protocol limits из общего бюджета с гарантированным резервом; не стартовать background при недостаточном бюджете.
- Приёмка: isolated PostgreSQL pool 4/6/8/20 connections; отсутствие pool timeout при фоне и параллельных read/write; проверить ручные probes.

### DNET-06 — followers истории занимают общие executor threads

- Статус: S; Medium.
- Где: `WEB-itinvent/backend/api/v1/monitoring.py:45-68`; `WEB-itinvent/backend/services/network_monitor_store.py:805-835`.
- Caller: параллельные history HTTP с одним cache key → первый build, остальные `pending.result(timeout=30)` внутри `asyncio.to_thread`.
- Готовый cache ограничен 32 entries, но ожидание одинаковой истории расходует threads default executor до 30 секунд.
- Риск: burst followers мешает unrelated DB offloads/prepare/encode; готовый LRU не ограничивает стоимость ожидания.
- Исправление: ожидать singleflight асинхронно до thread hop либо отдельно ограничивать history work/waiters и отдавать управляемый overload.
- Приёмка: один медленный build, 100 одинаковых HTTP и независимый read; измерить executor queue wait, p95 независимого read, число builders.

### DNET-07 — карты locks/launches не очищаются вместе с удалёнными targets

- Статус: S; Low.
- Где: `WEB-itinvent/backend/services/network_monitor_service.py:110`, `:148`, `:238`, `:251-252`, `:268`, `:288`.
- `_locks` хранит target/protocol навсегда; reload чистит due/full_due, но не launched.
- Caller: длительно работающий процесс с созданием/удалением целей или probes по новым IDs.
- Риск: накопление метаданных пропорционально исторической cardinality, а не текущему числу устройств.
- Исправление: очищать неиспользуемые ключи после завершения задач, не удаляя locks активных probes.
- Приёмка: churn 10000 временных IDs; после завершения/удаления размер возвращается к числу активных targets.

Отвергнутые подозрения:

- `record` берёт parent row lock и сверяет `updated_at`, enabled и protocol timestamps (`WEB-itinvent/backend/services/network_monitor_store.py:482-501`). Старый probe после смены IP не записывается этим путём.
- `_record` ограничен semaphore; запись shielded, cancellation дожидается commit перед release (`WEB-itinvent/backend/services/network_monitor_service.py:115-122`, `:184-194`).
- History проверяет принадлежность interface target даже при cache hit (`WEB-itinvent/backend/services/network_monitor_store.py:698-716`).
- Наличие долгоживущего autocommit advisory connection не является само по себе idle-in-transaction.
- Кеш истории готовых результатов действительно ограничен 32; проблема DNET-06 относится к ожиданию, а не отсутствию LRU.

## 3. IT OBJECTS: разделённые права и scope monitoring

Граф: `pages/ItObjects.jsx`, `ItObjectDetail.jsx` → `api/itObjects.js` → `api/v1/it_objects.py` → `ItObjectsService` / monitoring store / inventory readers.
Идентичность source branch: `database_id:branch_no`; custom object хранит source binding (`WEB-itinvent/backend/services/it_objects_service.py:92-153`).
Права: permission входа в раздел плюс объектный grant/owner; source DB выбирается сервером, не глобальным UI selection.
Monitoring attach/release: conditional UPDATE разрешает free-or-same (`WEB-itinvent/backend/services/network_monitor_store.py:180-192`).

### DNET-08 — объектный scope проверяется отдельно от чтения device/history

- Статус: S; Medium, узкая гонка раскрытия уже переданного устройства.
- Где: `WEB-itinvent/backend/api/v1/it_objects.py:302-325`; `WEB-itinvent/backend/services/network_monitor_store.py:170-172`, `:180-192`, `:270`, `:698`.
- Caller: `_scoped_read` сначала проверяет object_ref, затем отдельным thread/transaction вызывает detail/history.
- Между этими действиями другой manager может release из A и assign в B; пользователь A получает данные target после передачи.
- Сам history key не содержит authorizing object_ref, а store повторно проверяет target/interface, не объектный scope.
- Исправление: передавать expected_object_ref в read store и проверять scope в той же транзакции чтения/кеширования; определить политику revocation для уже начатых запросов.
- Приёмка: барьер между auth/read, перенос A→B, пользователь только A; последующее чтение даёт 404/403 без history payload.

Границы и исправления, уже присутствующие в дереве:

- Старый polling race больше не заявляется: `ItObjectDetail.jsx:300-335` содержит request sequence, abort и запрет overlap для poll.
- Source cache защищает структуру mutex, но сам miss читает source вне lock (`WEB-itinvent/backend/services/it_objects_service.py:92-114`): stampede возможен, масштаб не измерен; H.
- CAS attach/release исключает успешную одновременную привязку одной цели к двум объектам; это не повторяется как дефект.
- Inventory UI сообщает о частично загруженном списке; лимит страниц не равен молчаливому доказательству полной выборки.

## 4. MFU: runtime, IP identity, persistence и счётчики

Граф: MFU page → `api/mfu.js` → `api/v1/mfu.py` → equipment reader → `register_devices` → ping/SNMP cycles → runtime cache + page/runtime SQL tables.
Ключ устройства включает DB ID и item identity (`WEB-itinvent/backend/api/v1/mfu.py:185-192`), поэтому простое совпадение item ID между БД само по себе не является доказанным конфликтом.
Инварианты: runtime соответствует текущему IP/generation; старый probe не изменяет новый endpoint; исчезнувшие устройства перестают опрашиваться; async loop не ждёт sync SQL.

### DNET-09 — смена IP сохраняет старые счётчики и принимает старый probe

- Статус: R; High.
- Где: `WEB-itinvent/backend/services/mfu_monitor_service.py:1054-1115`, `:1193-1209`, `:1361-1408`, `:1410-1489`.
- Caller: список MFU вызывает register; cycles захватывают `(key, ip)`; apply получает только key/result без expected IP/version.
- При смене IP чистятся SNMP index/backoff и persisted row, но существующий `_runtime_cache[key]` не сбрасывается.
- AST-harness настоящих register/apply: после IP 192.0.2.1→192.0.2.2 остался `page_total=999`; старый ping записал online уже для нового IP.
- Исправление: generation по key+IP, сброс current runtime при смене endpoint, проверка generation в обоих apply; определить сохранение исторических counters отдельно.
- Приёмка: задержать старый ping/SNMP, сменить IP, завершить старый probe; новый runtime не меняется, старые counters не показываются как текущие.

### DNET-10 — синхронная SQL persistence блокирует async loop под общим lock

- Статус: S; High при медленной БД, фактическая задержка не измерена.
- Где: `WEB-itinvent/backend/services/mfu_monitor_service.py:254-265`, `:978-1035`, `:1361-1408`, `:1410-1489`; caller ping/SNMP apply.
- `_persist_runtime_state_for_key` открывает sync compat/SQLite connection, execute и commit без offload; вызывается внутри `async with self._lock`.
- Следствие: SQL wait останавливает loop и все MFU snapshot/register callbacks; формальный semaphore probes это не устраняет.
- Дополнительный вход: async `WEB-itinvent/backend/api/v1/mfu.py:443-457` вызывает sync `get_monthly_page_summary` напрямую.
- Исправление: snapshot state под коротким lock, затем bounded offload persistence; fence generation/order при завершении записи.
- Приёмка: isolated delayed DB commit, heartbeat loop и параллельный snapshot; измерить loop lag и p95, проверить итоговый порядок сохранений.

### DNET-11 — регистрация MFU только добавляет устройства

- Статус: R для отсутствия pruning; Medium.
- Где: `WEB-itinvent/backend/services/mfu_monitor_service.py:1054-1115`, `:1193-1200`, `:1241-1276`; caller `WEB-itinvent/backend/api/v1/mfu.py:353`.
- `_known_devices` и runtime cache пополняются; удаления/TTL активного registry нет, cycles перечисляют все ранее зарегистрированные key.
- Harness: register одного устройства, затем register([]) → `registered_after_empty_snapshot=1`.
- Пустой/фильтрованный HTTP список не обязательно полный snapshot, поэтому нельзя просто удалить всё отсутствующее из очередного ответа.
- Исправление: last_seen/lease TTL с явной семантикой или отдельная авторитетная регистрация по DB, pruning только после bounded grace.
- Приёмка: удалить/сменить устройство в source, пройти TTL, убедиться в прекращении probes и ограничении RAM; посещение другой DB не должно удалять живые устройства первой.

## 5. DISCOVERY: определение рабочего места

Граф: UI identify-workspace → API client → `api/v1/discovery.py` → selected `get_db(db_id)` → ITEMS/OWNERS/CI_HISTORY.
Отдельного discovery service/store слоя нет: SQL и эвристика корреляции находятся прямо в router.
Инварианты: trusted client IP; выбранная DB; неоднозначность IP не должна выдавать уверенную чужую привязку; SQL count не растёт на каждый предмет.

### DNET-12 — последовательный N+1 по истории оборудования

- Статус: S; Medium.
- Где: `WEB-itinvent/backend/api/v1/discovery.py:89-96`, `:100-125`; caller GET `/identify-workspace`.
- После PC/history/owner items router делает отдельный `TOP 1 CI_HISTORY` для каждого предмета и последовательно ждёт threadpool.
- Исправление: batch history для списка items с оконной latest-per-identity выборкой и параметрами; сохранить отсутствие истории как unknown.
- Приёмка: owner 1/100/1000 items, постоянное число SQL round trips, одинаковые linked_inv_nos и p95 на безопасной test DB.

### DNET-13 — неоднозначный IP выбирает последнюю карточку как рабочее место

- Статус: H; Medium, требует доменной проверки данных.
- Где: `WEB-itinvent/backend/api/v1/discovery.py:54-64`, `:69-79`, `:89-96`, `:121-125`.
- `TOP 1 ... IP_ADDRESS=? ... ORDER BY ID DESC` не проверяет единственность, тип PC и устаревание IP.
- NAT/RDP/shared IP, повторная выдача адреса или дубли могут сопоставить другой owner и автоматически отметить его оборудование.
- История фильтруется только ITEM_ID; уникальность ID между CI_TYPE по фактической legacy-схеме здесь не подтверждена.
- Исправление: явно обрабатывать multiple matches, проверять допустимые CI_TYPE/identity и не выполнять уверенный auto-select при ambiguity.
- Приёмка: fixtures с двумя active records на IP, разными CI_TYPE и stale assignment; API возвращает ambiguity вместо произвольного owner.

## Проверки, покрытие и ограничения

- Свежий Node harness SWR: после invalidation старый in-flight завершён позже нового; `fetches=1,cached=NEW`. Старый механизм FE-01 изменён и узко проверен; статус исходного пункта CHANGED, полная UI-приёмка Networks не выполнялась.
- `node node_modules/vitest/vitest.mjs run src/lib/swrCache.test.js`: 1 файл, 6/6 passed, exit 0.
- Python AST-harness schedule_phase: три объёма × три повтора, приведены выше; imports приложения/БД исключены.
- Python AST-harness register/apply: проверены stale counter, old probe acceptance и отсутствие pruning; DB persistence заменена no-op.
- Первый запуск MFU harness остановился на отсутствующем `_SNMP_AVAILABLE`; повтор с явным stub завершился успешно. Это ошибка harness, не продукта.
- Не запускались pytest общих backend fixtures, браузерный E2E, live probes, SQL EXPLAIN, migrations и нагрузка production.
- Найдены профильные тесты: `test_network_monitor_scheduler.py`, `test_network_monitor_probe.py`, `test_e2e_monitoring*.py`, `test_it_object_monitoring.py`, `test_it_objects.py`.
- Дополнительные области тестов: `test_mfu_api.py`, `test_mfu_app_db_service.py`, `test_network_app_db_service.py`, `test_network_map_export.py`, `test_network_equipment_import.py`.
- Frontend: `swrCache.test.js`, `networksBranchContext.test.js`, `pages/networks/networkResolution.test.js`, `e2e/audit-monitoring-races.spec.js`; кроме SWR здесь не запускались.
- Покрытие чтением: Networks CRUD/refresh/maps/point ownership; Monitoring scheduler/lease/probe/write fence/history cache; IT object scope/binding/attach; MFU register/cycles/apply/persist; Discovery IP/history SQL.
- Не проверены реальные row counts, network/IP дубли, orphan records, deployed migrations, runtime pool occupancy, Windows ping locale и реальная SNMP нагрузка.
- Готовность: 13 приоритизированных пунктов для последующей реализации/проверки; DNET-13 остаётся H. Этот отчёт не разрешает deploy/restart/DDL/DML.
