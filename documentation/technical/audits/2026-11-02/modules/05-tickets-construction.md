# Модуль 05 — Tickets/логистика, строительство и VCS

Дата: 2026-11-02. Read-only анализ текущего дерева; записан только отчёт.
Главный вывод: workflow основного Tickets уже использует новый словарь и CAS, но Excel import остался на старом словаре и обходных mutation-путях. Контур строительных работ имеет более последовательные транзакции и версии; подтверждённых аналогичных гонок в просмотренных writes не найдено.
Здесь 7 находок: 3 High, 4 Medium. Отдельно указаны оставшиеся проверки Construction/VCS, а не придуманные дефекты ради одинакового количества.
R — isolated repro, S — code/caller trace, H — непроверенная гипотеза. В этом модуле основные находки S.

## 1. Карта отдельных доменов

| Домен | UI → API → service → persistence |
|---|---|
| Tickets requests | `WEB-itinvent/frontend/src/pages/Tickets.jsx:15` → `WEB-itinvent/frontend/src/components/tickets/TicketRequestList.jsx:81` → `WEB-itinvent/backend/api/v1/tickets.py:285` → `WEB-itinvent/backend/services/tickets_service.py:574` → TicketRequest/Employee/Object. |
| Изменение полей | `WEB-itinvent/frontend/src/components/tickets/TicketRequestCard.jsx:103` → `WEB-itinvent/backend/api/v1/tickets.py:366` → `WEB-itinvent/backend/services/tickets_service.py:757`. |
| Изменение статуса | `WEB-itinvent/backend/api/v1/tickets.py:432` → `WEB-itinvent/backend/services/tickets_service.py:849` → conditional UPDATE version + history + system comment в одной транзакции. |
| Excel import | `WEB-itinvent/backend/api/v1/tickets.py:777`, `:813` → `WEB-itinvent/backend/services/tickets_import_service.py:265`, `:401` → TicketImportJob/RawTrace и поэлементные TicketRequest writes. |
| Вложения Tickets | `WEB-itinvent/backend/api/v1/tickets.py:545`, `:615` → `WEB-itinvent/backend/services/tickets_service.py:1795`, `:1860` → filesystem + TicketAttachment. |
| Уведомления SLA | `WEB-itinvent/backend/services/tickets_notification_service.py:286` → четыре query checker → process-local dismissed set. |
| Объекты строительства | `WEB-itinvent/frontend/src/pages/ConstructionObjectDetail.jsx:41` → `api/v1/construction.py` → `WEB-itinvent/backend/services/construction_management_service.py:265` → object/group/roles. |
| План/факт строительства | `WEB-itinvent/backend/api/v1/construction_work.py:24` → `WEB-itinvent/backend/services/construction_work_service.py:187` и `WEB-itinvent/backend/services/construction_planning_service.py:111` → WorkItem/Entry/Week/Day/Audit. |
| VCS | `WEB-itinvent/frontend/src/pages/Vcs.jsx:47` → `WEB-itinvent/backend/api/v1/vcs.py:387` → App DB helpers и auth runtime token store. |

Tickets в данном репозитории — логистика билетов/поездок, а не универсальная Hub task; статусы и права нельзя смешивать.
Construction связывает управляемый объект с группами 1С и собственной историей работ; внешний склад 1С не становится источником транзакций локального журнала.
VCS отвечает за реестр терминалов и короткоживущий bearer-token запуска; выдача файла без cookie сама по себе не bypass, если token одноразовый и защищён.

## 2. Инварианты и просмотренные сценарии

| Сценарий | Проверка по коду/тестам | Вывод |
|---|---|---|
| Два status update Tickets с одной version | `WEB-itinvent/backend/services/tickets_service.py:939` WHERE id+version и rowcount | CAS реализован; выбранный pytest проверяет этот контур. |
| Поле Tickets из двух старых форм | PATCH fields без expected version | DBIZ-02. |
| Импорт белой/нераспознанной строки | import default new, новый API словарь not_started | DBIZ-01. |
| Два execute одного preview job | SELECT status, затем unconditional assignment running | DBIZ-03. |
| Import update одновременно ручному status | Прямое ORM присваивание status без version/history | DBIZ-04. |
| Два upload на последнем слоте | COUNT перед INSERT без lock общего request | DBIZ-05. |
| Удаление attachment и rollback БД | unlink до commit | DBIZ-06. |
| Большая история Tickets в kanban | `.all()` всей выборки | DBIZ-07. |
| Plan edit одновременно daily fact | Construction `_claim` + parent/direction locks | Явная защита есть; выбранный pytest включает parallel edit и rollback. |
| Удаление direction с работами | `WEB-itinvent/backend/services/construction_management_service.py:329` запрещает unlink | История не исчезает вместе с привязкой. |
| Сохранение недельного плана/дневной сводки | Week/Day version CAS и shared session | Вложенной независимой транзакции для work.save нет. |
| VCS выдаёт сохранённый пароль через config | `WEB-itinvent/backend/api/v1/vcs.py:450` возвращает пустое поле и bool | Старый риск прямой выдачи config в текущем пути не подтверждён. |
| Повтор VCS launch token | `WEB-itinvent/backend/api/v1/vcs.py:499` pop_json | Одноразовое потребление предусмотрено; многопроцессный race самого runtime store здесь не исполнялся. |

## 3. Реестр дефектов Tickets

### DBIZ-01 — High / S: Excel import использует устаревший словарь статусов

Ссылки: `WEB-itinvent/backend/services/tickets_import_service.py:47`, `:55`, `:1180`; `WEB-itinvent/backend/services/tickets_service.py:141`, `:3194`.
Importer допускает new/data_check/missing_data/ready_to_buy/in_progress/cancelled/closed/refund/archive/no_show.
Основной workflow допускает not_started/at_cashier/purchased/exchange_needed/refund_needed/cancel_purchase.
Default import new сохраняется напрямую в TicketRequest; модель содержит обычный String, не enum-normalization (`WEB-itinvent/backend/appdb/tickets_models.py:132`).
Kanban SQL фильтрует по новому VALID_STATUSES или flags urgent/review; обычная новая импортированная строка без flags не попадает на доску.
Для legacy current_status новая state machine также не имеет нормального перехода; «импорт завершён» не подтверждает рабочий пользовательский lifecycle.
AST-анализ реальных assignment вывел оба набора; это безопасная проверка рассогласования, не полный Excel→HTTP E2E.
Исправление: единый канонический словарь + явная migration mapping старых значений; preview показывает результат нормализации, неизвестные fail-closed/needs-review по согласованной политике.
Приёмка: upload→preview→execute на всех цветах/default/legacy→список→kanban→status transition, без невидимых записей.
Согласование: mapping cancelled/closed/archive нельзя угадывать — он меняет бизнес-смысл существующей истории.

### DBIZ-02 — Medium / S: общие поля Tickets редактируются без optimistic concurrency

Ссылки: `WEB-itinvent/backend/api/v1/tickets.py:74`, `:366`; `WEB-itinvent/backend/services/tickets_service.py:772`, `:793`, `:814`.
UpdateRequestBody не содержит expected_version, ORM читает req и пишет explicit fields, не увеличивая version.
Две формы с разными значениями cost/route/note молча перезаписывают друг друга; history каждой может ссылаться на один и тот же старый value.
Одновременная смена статуса защищает только свой UPDATE, но не сопровождающую карточку/версию от обычного edit.
Исправление: единый version contract для fields и status с conditional update; сохранять history победившего изменения в общей транзакции.
Приёмка: два PATCH одного поля с одинаковой версией → один 200/один 409; разные поля по согласованной merge-политике не теряются.
Риск совместимости: API/web/import callers требуют единого переходного решения, не только изменение одного handler.

### DBIZ-03 — High / S: import job claim не атомарен

Ссылки: `WEB-itinvent/backend/api/v1/tickets.py:813`; `WEB-itinvent/backend/services/tickets_import_service.py:415`, `:419`, `:426`, `:565`.
Два execute_import читают previewed до commit другого, затем оба присваивают running без WHERE status=previewed/claim token.
Оба выполняют _detect_duplicates до создания строк, после чего каждый может вставить одинаковую поездку; create/check не защищён уникальным import-row identity.
Долгий импорт усиливает окно; итоговые job counters одного запуска могут затереть результат другого.
Исправление: CAS claim job до любых writes, владелец/token, уникальная идентичность imported row или reconciliation semantics для retries.
Приёмка: два параллельных HTTP execute одного job → ровно один начинает, второй получает conflict; число requests/raw traces/losses соответствует одному запуску.
Не утверждается воспроизведение на production: проверена последовательность реального кода, PostgreSQL concurrency harness не запускался.

### DBIZ-04 — Medium / S: import update обходит state machine, version и историю

Ссылки: `WEB-itinvent/backend/services/tickets_import_service.py:1211`, `:1229`; `WEB-itinvent/backend/services/tickets_service.py:939`, `:969`.
Duplicate strategy update присваивает status и другие поля прямо ORM, без conditional version, TicketChangeHistory и system comment.
Сценарий: оператор завершил ручной переход, одновременно импорт старой Excel строки перезаписывает его результат; версия карточки при этом не меняется.
Это самостоятельный mutation-path defect сверх словаря DBIZ-01: даже после нормализации статусов обход конкуренции останется.
Исправление: явный import application service с тем же CAS/audit contract, batch-режимом и разрешёнными переходами; не дергать HTTP handler из сервиса.
Приёмка: import/manual race не теряет победившее изменение, все фактические updates имеют source=import в истории и предсказуемую version.
Требуется решить допустимость административных import transitions, а не автоматически применять ручную permission матрицу к migration semantics.

### DBIZ-05 — Medium / S: конкурентные attachment upload обходят лимит числа файлов

Ссылки: `WEB-itinvent/backend/services/tickets_service.py:1795`, `:1802`, `:1806`, `:1824`.
Проверяется COUNT attachments до INSERT; общий TicketRequest не блокируется, ограничения count в БД нет.
При N=limit-1 два запроса видят одинаковое значение и каждый добавляет файл, итог limit+1; затраты на bytes также растут сверх принятого лимита.
Исправление: блокировать общий request в транзакции count+insert либо атомарный quota reservation; сохранить проверку размера файла отдельно.
Приёмка: два upload последнего слота → один успешен, второй quota/conflict, на диске и в БД нет лишнего файла.
Отдельный файловый staging нужен для rollback insert после write_bytes; его orphan cleanup не подтверждён этим аудитом.

### DBIZ-06 — High / S: удаление attachment до commit делает rollback неполным

Ссылки: `WEB-itinvent/backend/services/tickets_service.py:1860`, `:1876`, `:1880`, `:1887`, `:1902`.
Файл удаляется до удаления DB record/истории и общего commit app_session.
Если последующий flush/commit падает, metadata откатывается, а bytes восстановить нечем: карточка продолжает ссылаться на отсутствующий файл.
Если unlink падает, исключение только логируется и DB запись удаляется — это противоположный orphan case.
Исправление: tombstone/quarantine и transactional deletion intent, физическое удаление после успешного commit с повторяемым cleanup; без немедленного необратимого unlink.
Приёмка: fault injection на history flush/commit сохраняет скачивание; crash после commit допускает безопасное повторение cleanup; hash bytes сверяется.
Не удалять реальные вложения для проверки; только временные файлы/test DB.

### DBIZ-07 — Medium / S: kanban не ограничивает объём данных

Ссылки: `WEB-itinvent/backend/api/v1/tickets.py:917`; `WEB-itinvent/backend/services/tickets_service.py:3176`, `:3194`, `:3203`, `:3224`.
Запрос выбирает все записи подходящих статусов/flags вместе с relationships, затем сериализует каждую; пагинации/лимита по колонке нет.
Текущий список разрешённых статусов покрывает весь новый workflow, так что большой накопленный архив не исключается отдельным active predicate.
Исправление: SQL counts по колонкам и отдельные bounded страницы, явное правило архивирования/скрытия после согласования; не удалять историю.
Приёмка: 1k/10k/100k requests, равенство counters, ограниченный ответ, p95/SQL time/RSS/query count. Реальные baseline не измерялись.
Наличие joinedload предотвращает очевидный N+1 relationships, но не ограничивает число загруженных ORM-объектов.

## 4. Construction: проверенные защиты и план приёмки

`WEB-itinvent/backend/services/construction_work_service.py:180` выполняет UPDATE version=version+1 WHERE id+expected_version и проверяет rowcount.
`WEB-itinvent/backend/services/construction_work_service.py:193` и `WEB-itinvent/backend/services/construction_management_service.py:285` берут один parent lock перед direction: согласованный порядок уменьшает deadlock/unlink race.
`WEB-itinvent/backend/services/construction_planning_service.py:26` передаёт уже открытый session через session_factory; вложенный work.read/save не берёт второе соединение.
Поэтому первоначальное подозрение о самоблокировке pool из-за nested app_session **отвергнуто** после чтения _work(shared).
`WEB-itinvent/backend/services/construction_work_service.py:100` читает план/факт/тренд одним SQL snapshot; нельзя описывать этот путь как отдельные несогласованные SELECT.
`WEB-itinvent/backend/services/construction_management_service.py:329` запрещает отвязать direction с работами, включая историю архивных work items.
Просмотренные проверки: ежедневный факт абсолютен и retry-safe, один победитель parallel edit, rollback частичного batch, archived restore, запрет переобозначения единиц после факта.
Приёмка после будущих изменений: PostgreSQL parent/direction locking, параллельный unlink/save, одновременные crew/day/week versions и сохранение Audit.
Не проверены реальный объём 1С consumption, внешние warehouse acquisition и все frontend planning affordances.

## 5. VCS: границы и остаточные вопросы

`WEB-itinvent/backend/api/v1/vcs.py:450` возвращает password_configured и пустой password_hex; прямое раскрытие секрета config не подтверждено.
Create/update/delete компьютеров требуют vcs.manage (`:397`, `:419`, `:438`), чтение и launch token — vcs.read (`:480`).
Launch token содержит computer_id, а не plaintext password; redeem использует pop_json (`:499`). URL bearer-token — осознанный обмен для native launcher, а не автоматически auth defect.
Клиентский `WEB-itinvent/frontend/src/pages/Vcs.jsx:117` fetchComputers не имеет generation guard; overlap refresh/mutation может показать старый список. Без трассировки всех вызывающих сохранений это оставлено H, не отдельная подтверждённая находка.
Многопроцессная атомарность pop_json должна проверяться в аудите общего auth-runtime store; реальные launch/native handler и срок token не испытывались.

## 6. Проверки, следующий порядок и покрытие

Безопасный AST-анализ вывел словари: importer 12 статусов, service 6; пересечение только purchased/exchange_needed.
Проходящий status-only test не обнаруживает DBIZ-01, потому что Excel import проверяется отдельными fixtures, продолжающими создавать status=new.
Нужен сквозной локальный upload→preview→execute→kanban/status boundary test; не тест констант ради покрытия.
Выбранный pytest-профиль выполняет `tests/test_tickets_service_status.py`, `tests/test_construction_work_progress.py`, `tests/test_task_observer_sql.py`, `tests/test_task_participant_service.py`.
APP/CHAT URL изолированы conftest, SCAN_DATABASE_URL принудительно пуст, live opt-in выключен; никакой production DML.
Итог выбранного профиля: **50 passed, 4 warnings, 156,81 с, exit=0**. После завершения assertions pytest вывел WinError 5 при cleanup старого pytest-current вне репозитория; тестовые проверки прошли, очистка окружения не полностью успешна.
Не запускались полный Tickets suite, реальные PostgreSQL/SQL Server, Excel на рабочих данных, Android, production metrics и нагрузка.

Порядок: DBIZ-01 (канонический workflow и mapping) → DBIZ-03 (atomic import claim) → DBIZ-04/02 (единая mutation version/audit) → DBIZ-06 (attachment lifecycle) → DBIZ-05 → DBIZ-07 с baseline.
DDL/миграция исторических статусов, retention, production cleanup или deployment требуют отдельного разрешения; этот документ их не выполняет.

Прочитанные файлы:

- `WEB-itinvent/backend/api/v1/tickets.py`, `construction_work.py`, `vcs.py`; часть router/service контракта Construction.
- `WEB-itinvent/backend/services/tickets_service.py`: list/update/status/comments/attachments/financial/kanban; `tickets_import_service.py`: job state, parsing, duplicate/create/update/trace.
- `WEB-itinvent/backend/services/tickets_notification_service.py`: aggregate/dismiss, без claims о долговечности dismiss сверх задокументированной session-based семантики.
- `WEB-itinvent/backend/services/construction_management_service.py`, `construction_work_service.py`, `construction_planning_service.py`; `appdb/tickets_models.py`.
- `WEB-itinvent/frontend/src/pages/Tickets.jsx`, `Vcs.jsx`, import/loader-контракты ConstructionObjectDetail/ConstructionDirectionDetail.
- `WEB-itinvent/frontend/src/components/tickets/TicketRequestList.jsx`, `TicketRequestCard.jsx`: generation guards и version UI.
- Выбранные Python тесты, import_execute tests на legacy statuses и семь realtime specs в смежном модуле 04.
- Это целевой разбор критических путей, не заявление о полном построчном покрытии каждого отчёта/экспорта/поля пользователя.
