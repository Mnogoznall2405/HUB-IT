# 09. Документооборот, DMService, адресная книга и структура компании

Дата основного прохода: 2026-11-02; актуализация: 2026-11-03.
Режим: read-only код, локальные harness и один узкий существующий test profile; изменён только отчёт.
Итог: семь находок, две проблемы управления состояниями подтверждены AST harness; 25 тестов DMService прошли.
Главные риски: вечный pending после crash, ложный applied для незапущенного поручения, потеря целостности дерева при конкурентных перемещениях.
R = воспроизведён механизм; S = подтверждено исходниками; H = гипотеза или неустановленная runtime-конфигурация.
COM, 1С, DMService, внешние HTTP, production DB и секреты не использовались.

## Fullstack карта

1. `frontend/src/pages/Docflow.jsx` показывает личные задания, командные состояния и создание поручений.
2. `WEB-itinvent/frontend/src/api/docflow.js:112` передаёт task action с Idempotency-Key, `:86` — assignment creation.
3. `WEB-itinvent/backend/api/v1/docflow.py:382` принимает action, `:416` — status-check команды; `:295` создаёт поручение.
4. `WEB-itinvent/backend/services/docflow_service.py:1867` проверяет pilot/write policy, credentials, rules, state token и request hash.
5. `DocflowCommandStore.begin`, `WEB-itinvent/backend/services/docflow_service.py:771`, фиксирует pending в APP до внешней мутации.
6. `Docflow1CAdapter.call`, `:622`, направляет вызов в DMService либо COM bridge/direct adapter.
7. DMService client (`WEB-itinvent/backend/services/docflow_dm_service_client.py:286`) строит только allowlisted SOAP-запросы.
8. COM dispatcher (`WEB-itinvent/backend/services/docflow_1c_process_dispatcher.py:41`) принимает фиксированные операции и собственные credentials.
9. `WEB-itinvent/backend/services/docflow_1c_client.py:1009` выполняет разрешённое действие и перечитывает состояние 1С.
10. `WEB-itinvent/backend/services/docflow_service.py:2040` сохраняет unknown и выполняет reconciliation; `:2110` фиксирует verified applied.
11. `Docflow.jsx:1605` poll-ит pending/state_unknown с ограничением числа попыток и растущей задержкой.
12. `frontend/src/pages/AddressBook.jsx` читает адресную книгу через отдельный `api/addressBook.js`.
13. `WEB-itinvent/backend/api/v1/address_book.py:89` защищает search разрешениями и visibility flags; sync доступен через `:208`.
14. `WEB-itinvent/backend/services/address_book_service.py:2016` собирает сотрудников, контакты, personal fields и absences в один snapshot.
15. `WEB-itinvent/frontend/src/components/docflow/DocflowAbsencesPanel.jsx:24` читает личные отсутствия ДО, не записывая их в общий ЗУП-кеш.
16. `WEB-itinvent/backend/api/v1/docflow.py:47` → `WEB-itinvent/backend/services/docflow_absence_service.py:138` → отдельный ограниченный COM bridge → reconciliation по identity.
17. `frontend/src/pages/CompanyStructure.jsx` и `pages/company-structure/*` работают через companyStructure API.
18. `WEB-itinvent/backend/api/v1/company_structure.py:44` читает дерево, `:132` перемещает узел, `:76` импортирует отделы.
19. `WEB-itinvent/backend/services/company_structure_service.py:328` строит дерево из APP nodes/department links и snapshot адресной книги.

## Инварианты

- Личные команды выполняются от личных credentials с серверной проверкой permissions/pilot/write flags.
- Одному Idempotency-Key соответствует неизменный request hash; неизвестный исход нельзя молча повторять.
- Повторный status-check не выполняет внешний action и не создаёт новое поручение.
- Crash между внешней мутацией и локальным finish обязан иметь безопасный путь восстановления.
- Существование черновика процесса не означает запуск поручения и назначение задачи исполнителю.
- Shared snapshot ЗУП и личные отсутствия ДО имеют разные источники, область доступа и актуальность.
- Несопоставленная identity или неактуальный ЗУП не означают подтверждённое равенство данных.
- Дерево компании должно оставаться ацикличным после любого порядка конкурентных commit.
- Single-process lock не является межпроцессной блокировкой для нескольких backend/chat runtimes.
- БД, COM/HTTP и файловый export не имеют общей транзакции; state machine должна учитывать промежуточные состояния.

## Открытые находки

### DDOC-01 — pending команды действия не восстанавливается после crash/cancel

- Severity: High; доказательство R; source `WEB-itinvent/backend/services/docflow_service.py:819`, `:1931-1947`, `:2018`, `:2136-2172`.
- Caller: `WEB-itinvent/backend/api/v1/docflow.py:416` и polling `WEB-itinvent/frontend/src/pages/Docflow.jsx:1605-1642`.
- После begin=pending процесс может завершиться или coroutine получить CancelledError до finish; COM thread при этом может продолжить работу.
- Повтор apply для pending возвращает pending; `get_command` запускает reconciliation только для state_unknown, не pending.
- Ни lease pending, ни переход stale pending→state_unknown в просмотренных command-store/service путях не обнаружен.
- Harness реального AST get_command на pending дал `status=pending`, `reconciliation_calls=0`.
- Итог: UI делает bounded polls, но сервер не делает проверки внешнего состояния и команда может остаться pending навсегда.
- Исправление: timestamp/claim ownership + stale pending recovery в unknown и read-only reconciliation, без повторного action.
- Acceptance: crash после внешнего применения до APP finish; после restart status-check устанавливает подтверждённый итог и не вызывает action.

### DDOC-02 — existence поручения ошибочно достаточно для verified applied

- Severity: High; доказательство R; source `WEB-itinvent/backend/services/docflow_service.py:1502-1528`; caller create_assignment `:1615`, status check `:1716`.
- DMService создаёт объект через DMUpdate, затем отдельно запускает DMLaunchBusinessProcess (`WEB-itinvent/backend/services/docflow_dm_service_client.py:1704-1724`).
- `get_assignment_state`, `:1630-1649`, возвращает exists=True и для объекта без task_ref/без подтверждённого launch.
- `_reconcile_assignment_command` проверяет только exists и фиксирует applied с outcome=verified_after_unknown.
- Crash/timeout после создания объекта, но до launch оставляет черновик; status-check может показать успех без задания исполнителю.
- Harness реального AST reconciliation с exists=True, task_ref=None, state=not-started вызвал finish(status=applied).
- Исправление: проверять устойчивый признак запуска, task/assignee/document state; иначе сохранять partial/unknown.
- Acceptance: оборвать между DMUpdate и launch; UI не сообщает applied, status-check не создаёт второй процесс.

### DDOC-03 — некорректный ответ после write классифицируется как обычный отказ

- Severity: High; доказательство S; `WEB-itinvent/backend/services/docflow_dm_service_client.py:478-563`; caller adapter `WEB-itinvent/backend/services/docflow_service.py:622-635`.
- Только TimeoutException/NetworkError/RemoteProtocolError при write переводятся в Docflow1COutcomeUnknownError.
- Oversize, некорректный Content-Length, malformed XML и HTTP 5xx без достоверного business rejection становятся Unavailable.
- Service action ловит DocflowServiceError и фиксирует rejected (`WEB-itinvent/backend/services/docflow_service.py:2067-2087`).
- Сценарий: 1С применила DMUpdate, proxy вернул HTML 502 либо повреждённый XML; rejected не доказывает отсутствия мутации.
- Повтор того же ключа не исполняется автоматически, однако reconciliation для rejected уже не запускается.
- Исправление: после write boundary любой непроверяемый ответ считать unknown, кроме доказанного business rejection без применения.
- Acceptance: MockTransport применяет запись и возвращает malformed/oversize/502; статус unknown, затем read-only сверка факта применения.
- Текущий timeout test проходит, но не покрывает перечисленные ответные ошибки после записи.

### DDOC-04 — конкурентные move/set_parent могут сформировать цикл дерева

- Severity: High; доказательство S; `WEB-itinvent/backend/services/company_structure_service.py:374-389`, `:518-561`, `:565-588`.
- Caller: `WEB-itinvent/backend/api/v1/company_structure.py:132-149`; изменение parent также доступно через update_node.
- `_would_create_cycle` проверяет snapshot цепочки без row/advisory locks или serializable-retry.
- При независимых A и B транзакция T1 проверяет A→B, T2 проверяет B→A; обе проверки видят прежних roots и проходят.
- Изменяются разные строки, поэтому обычный PK/FK не запрещает оба commit; итог A↔B не имеет корня.
- `get_tree:358` строит только roots; такой компонент исчезает из items, хотя count учитывает rows.
- Исправление: сериализовать hierarchy mutations на один tree scope либо проверять под блокировкой/serializable с retry.
- Acceptance: параллельный boundary move A→B/B→A; ровно один commit, все узлы доступны, cycle check на итоговом graph проходит.
- На реальном PostgreSQL/test DB этот interleaving не исполнялся; статически подтверждена отсутствие общей защиты.

### DDOC-05 — ошибка одного sync может перезаписать свежий snapshot другого процесса

- Severity: Medium; доказательство S; `WEB-itinvent/backend/services/address_book_service.py:1118`, `:2016-2052`; callers `address_book.py:213`, scheduler `WEB-itinvent/backend/services/address_book_service.py:2357`.
- `_sync_lock` защищает только один объект/процесс; sync заранее читает cache, после ошибки сохраняет этот старый snapshot с last_error.
- Если другой runtime успешно опубликовал новый snapshot в этом интервале, error handler первого сохранит поверх него старые items.
- Атомарный save_json предотвращает частичную запись, но не lost update между независимыми read/compute/write.
- Дополнительный край: load_cache выполняется до try/finally, поэтому его исключение оставляет локальный sync lock занятым.
- Исправление: distributed single-owner lease или version-CAS публикация; error metadata обновлять без переписывания старого массива.
- Перенести первое чтение внутрь try/finally после lock acquire.
- Acceptance: два isolated service instances; один публикует новый snapshot, другой падает; новые items остаются, lock освобождён и при load error.

### DDOC-06 — одинаковые запросы отсутствий не объединяются в singleflight

- Severity: Medium; доказательство S; `WEB-itinvent/backend/services/docflow_absence_service.py:147-173`; caller `docflow.py:61` и `DocflowAbsencesPanel.jsx:24`.
- Lock защищает lookup/set cache, но снимается на время COM bridge.call; несколько miss одного key выполняют одинаковое чтение.
- Открытие адресной книги и карточек одного пользователя может занять queue_limit=3 дублирующими запросами.
- Пользователь получает недоступность при заполненной очереди вместо результата уже выполняющегося такого же чтения.
- Исправление: bounded singleflight по полному личному cache key (user/login/fingerprint/date), ошибки не кешировать как успех.
- Acceptance: burst 10 запросов одного key вызывает один source read; смена credentials/date не переиспользует чужой ответ.
- Нагрузочный baseline COM queue wait/p95 не снимался; утверждается дублирование пути выполнения, не фактическая production задержка.

### DDOC-07 — отсутствие записи ЗУП не отражается как отличие от ДО

- Severity: Medium; доказательство S; `_reconcile`, `WEB-itinvent/backend/services/docflow_absence_service.py:95-106`.
- Caller: `list_absences:177` → `DocflowAbsencesPanel.jsx:69` и `AddressBookAbsenceMarks.jsx:28`.
- Для сопоставленного сотрудника при актуальном ЗУП differences вычисляется только если person.absence является dict.
- Когда в ДО отсутствие есть, а в ЗУП отсутствия нет, differences остаётся пустым при zup_comparison=available.
- UI показывает предупреждение о различиях только по differences.length и пропускает именно отсутствие записи второго источника.
- Исправление: явный difference missing_zup_absence при подтверждённой актуальности; unresolved/unavailable не считать расхождением.
- Acceptance: fresh ЗУП + matched employee без absence + ДО отсутствие → warning; stale/error/unmatched → только unavailable/unresolved.
- Не утверждается ложная надпись «равно» в UI: подтверждён пропуск предупреждения, а не наличие текста равенства.

## Ограничения очередей, памяти и сетевых вызовов

- DMService defaults: concurrency 16 (1–64), pending limit 64 (1–1000), queue wait 5 s (`WEB-itinvent/backend/services/docflow_dm_service_client.py:316`, `:331-333`).
- `_slot:393-410` считает pending под lock и уменьшает счётчик в finally; это реальная защита, не неограниченный gather.
- DM response default 25 MiB с clamp до 256 MiB; file content default 50 MiB и отдельный base64 ceiling (`:318-333`).
- Стрим накапливает chunks и затем join; пиковая память больше payload, но response bytes имеют проверенный предел (`:518-536`).
- Потенциальный общий RSS = несколько одновременно больших ответов; без объёмного benchmark OOM не объявляется фактом.
- COM dispatcher держит до 32 cached connections по умолчанию, clamp 1–64 (`WEB-itinvent/backend/services/docflow_1c_process_dispatcher.py:13-25`).
- Личные отсутствия: отдельная очередь 3, ожидание 2 s, message limit 4 MiB, call timeout 90 s (`WEB-itinvent/backend/services/docflow_absence_service.py:126-132`, `:161`).
- Кеш отсутствий ограничен 128 ключами и TTL 30 s; в нём raw может повторяться между датами/учётными записями (`:169-172`).
- Command begin/finish — короткие APP session; внешние вызовы идут между ними, а не внутри общей DB-транзакции.
- CompanyStructure.get_tree держит APP session во время чтения address-book snapshot (`:334`, `_direct_people_map:215`).
- Это кандидат на сокращение времени checkout; измерений pool wait и query time нет, отдельная High находка не заявляется.
- ЗУП search использует version-keyed parsed cache/index (`WEB-itinvent/backend/services/address_book_service.py:1190-1203`), а не повторный COM на каждый поиск.

## Проверки, результаты и acceptance gaps

- Прочитаны tests/conftest.py и test_docflow_dm_service_client.py: HTTP идёт через httpx.MockTransport.
- Запуск: `python -m pytest -q tests/test_docflow_dm_service_client.py --disable-warnings -p no:cacheprovider`.
- Перед запуском process-only env: PYTEST_USE_LIVE_APP_DATABASE=0, SCAN_TEST_DATABASE_URL пуст; конфигурационные файлы не менялись.
- Результат: **25 passed, 1 warning**, pytest exit 0; 1.66 s test duration, 25 collected.
- Suite проверяет personal scopes/limits, SOAP/DTD parsing, auth failures, allowlisted writes, unknown timeout и file bounds.
- AST get_command harness: pending остаётся pending, reconciliation не вызывается; без DB/adapter imports.
- AST assignment reconciliation harness: незапущенный exists-процесс получает applied; использован локальный stub внешнего state boundary.
- Не запускались COM/1С, gateway, реальные HTTP, PostgreSQL concurrency и browser E2E; 25 green не закрывают DDOC-01…07.
- Нужны crash/cancel boundary tests, partial create/launch recovery, malformed-after-write и barrier tests tree/sync.
- Performance baseline production p50/p95/p99, SQL time и queue pressure не измерялись; оптимизация не заявляется выполненной.

## Рассмотрено и признано оправданным

- Dispatcher allowlist не принимает произвольные query/COM method names (`WEB-itinvent/backend/services/docflow_1c_process_dispatcher.py:41-138`).
- DMService запрещает отключение TLS verify и требует явного флага для временного HTTP (`WEB-itinvent/backend/services/docflow_dm_service_client.py:299-312`).
- XML parser отключает entities/network/DTD (`:422-443`); SOAP Fault нельзя автоматически считать XML parser vulnerability.
- Удалённые credentials запрещают использование личного кеша: store.get вызывается до cache lookup (`WEB-itinvent/backend/services/docflow_absence_service.py:141-147`).
- Новый fingerprint password_enc разделяет результаты заменённых credentials; отсутствия не пишутся в общий ЗУП-кеш.
- Для выбранной даты, отличной от today, comparison становится unavailable (`:180-183`), что сохраняет границу исторических данных.
- Несопоставленные/неоднозначные email и фамилии не подставляются как уверенная identity (`:66-88`).
- Department code защищён unique index (`WEB-itinvent/backend/appdb/models.py:237`); конкурентный duplicate code даст отказ, а не тихое раздвоение связи.
- Начальный command begin имеет UNIQUE-race handling (`WEB-itinvent/backend/services/docflow_service.py:837-852`); нельзя переносить на него вывод о незащищённом initial claim.
- Автопроверка команды ограничена UI attempts (`Docflow.jsx:1609-1637`); проблема DDOC-01 находится на сервере.

## Coverage list и оставшиеся вопросы

- Прослежены Docflow task read/action/status, assignment create/reconcile, credentials store, adapter/direct/bridge/DMService границы.
- Прочитаны SOAP queue/bounds/parser, COM dispatcher limits, личный absence service/reconciliation и соответствующий UI.
- Прослежены address book permissions/search/snapshot/sync и versioned cache, company tree/move/parent/import/department links.
- Изучены существующие test_docflow_service, test_docflow_absences_api и test_company_structure_service; запускался только профиль выше.
- Полностью не проверены все типы 1С-процессов, внешние права исполнителей, notification delivery и физические файловые тома.
- Фактическое число backend runtimes, write flags, текущая APP schema и реальные размеры ЗУП не выводятся из документации как production-факт.
- Для multi-process sync требуется подтвердить реальные владельцы scheduler; риск версии snapshot существует при любом втором writer.
- Предложения по исправлению не реализованы; изменения схемы, restart, .env и deployment требуют отдельного запроса.
