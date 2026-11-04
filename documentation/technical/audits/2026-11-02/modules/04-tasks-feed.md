# Модуль 04 — Hub tasks, лента и уведомления

> **Актуализация 2026-11-03:** DTASK-01 связан с BE-03: touch/failed получили claim token во внешних изменениях, но sent ACK и внешний SMTP outcome требуют отдельного разбора. Старое воспроизведение сохраняется как история, не как доказательство отсутствия новых guards. См. [повторную сверку](../INITIAL_FINDINGS_RECHECK_2026-11-03.md).

Дата: 2026-11-02. Режим: read-only аудит текущего рабочего дерева; изменён только этот документ.
Главный вывод: workflow-переходы задач защищены условными UPDATE, но обычное редактирование, подписки realtime, кеши и task-email имеют отдельные нарушения целостности и границ ресурсов.
В реестре этого модуля 7 находок: 1 High и 6 Medium. DTASK-01 развивает ранее описанный BE-03 и не является дополнительным независимым дефектом в общей статистике.
R — изолированное воспроизведение реального кода; S — прослеженный сценарий по реализации; H — гипотеза без достаточного подтверждения.

## 1. Границы и архитектура

| Слой | Точки входа и ответственность |
|---|---|
| UI задач | `WEB-itinvent/frontend/src/pages/tasks/useTasksPageController.jsx:265`: realtime, пачки карточек, snapshot/reconnect. |
| UI списка | `WEB-itinvent/frontend/src/pages/tasks/hooks/useTasksListQuery.js:143`: server filters/pagination; `:256` — patch текущих строк. |
| UI карточки | `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskDetails.jsx:187`: детали, activity, загрузка обсуждения. |
| HTTP | `WEB-itinvent/backend/api/v1/hub.py:1842`: PATCH задачи; `:260` — вычисление capabilities по пользователю. |
| Сервис | `WEB-itinvent/backend/services/hub_service.py:7057`: create; `:7374` — edit; `:9144` — start; `:9305` — submit; `:9490` — review. |
| Участники | `WEB-itinvent/backend/services/task_participant_service.py:20`: исполнители, автор, контролёр, delegates; `:111` — observers как viewers. |
| Workflow | `WEB-itinvent/backend/services/hub_task_transitions.py:15`: start/submit/approve/reject/reopen/complete_direct. |
| Persistence | `WEB-itinvent/backend/services/hub_service.py:9085`: CAS статуса; SQL compatibility слой обслуживает PostgreSQL и dev SQLite. |
| Email | `WEB-itinvent/backend/services/task_email_outbox_service.py:148`: recovery/claim/delivery; `WEB-itinvent/backend/services/hub_service.py:3876` — durable intent. |
| Background | `WEB-itinvent/backend/services/task_due_notification_worker.py:34`; `WEB-itinvent/backend/services/announcement_publish_worker.py:18`. |
| Лента | `WEB-itinvent/backend/services/hub_service.py:5534`: выдача; `:6399` — голос; `:6609` — scheduled publication. |

Путь task: действие пользователя → HTTP permission → проверка доступа к конкретной задаче → запись/история/уведомления → commit → realtime и внешние каналы.
Observers входят в видимость и обсуждение, но не становятся исполнителями: эти множества намеренно различаются.
Несколько исполнителей — один task со списком assignee IDs и legacy primary assignee; нельзя исправлять гонки разделением его на копии.
Путь ленты дополнительно учитывает аудиторию, географию, версию публикации, прочтение и подтверждение.

## 2. Проверенные инварианты и сценарии

| Сценарий | Что реально проверено | Результат |
|---|---|---|
| approve одновременно reject | `WEB-itinvent/backend/services/hub_service.py:9107` условно обновляет ожидаемый status | Начальный статус не перезаписывается простым blind UPDATE; конкретный E2E concurrency файл в этом проходе не запускался. |
| submit одновременно submit | Тот же CAS + статус review | Повторная победа по прежнему status не допускается. |
| Несколько исполнителей | Mixin нормализует legacy primary + список (`WEB-itinvent/backend/services/task_participant_service.py:32`) | Не обнаружено потери secondary assignee в просмотренном helper. |
| Observer читает, но не исполняет | `WEB-itinvent/backend/api/v1/hub.py:278` запрещает capabilities; mixin разделяет participant/viewer | Разделение намеренное; permission SQL и helper покрыты выбранными тестами. |
| Одновременное обычное редактирование | `WEB-itinvent/backend/services/hub_service.py:7576` UPDATE только по ID | DTASK-02. |
| Checklist после done | UI capability false, service PATCH без status guard | DTASK-03. |
| Burst из 25 изменений | while draining + batches по 10 | Старые 15 событий больше не выбрасываются одним clear. |
| Повтор ID во время запроса | `latestTaskChanges` identity guard (`WEB-itinvent/frontend/src/pages/tasks/useTasksPageController.jsx:296`) | Старое чтение не патчит при более новой invalidation того же ID. |
| Delete/reconnect в течение burst | force snapshot очищает pending/current identity | Старые item reads обесцениваются; результат reload может требовать пользовательского повтора при error. |
| Изменение server filter membership | patch меняет объект, не состав и total списка | DTASK-04. |
| Долгий поток уникальных ID | Ограничена конкурентность, не размер backlog | DTASK-05. |
| История ленты растёт | LIMIT применяется после materialization/filter/sort | DTASK-06. |
| Долгая жизнь backend и новые poll cursor | TTL проверяется, expired entries не удаляются | DTASK-07. |

## 3. Реестр дефектов

### DTASK-01 — High / S: task-email не подтверждает владельца попытки

Ссылки: `WEB-itinvent/backend/services/task_email_outbox_service.py:151`, `:195`, `:234`, `:251`, `:267`.
Caller: фоновые/email-dispatch пути Hub → claim пачки → последовательная отправка.
Recovery возвращает stale sending в очередь; heartbeat проверяет лишь sending, а sent ACK обновляет по ID.
Если старый worker задержался, новый reclaim уже произошёл, прежний worker снова признаёт строку своей и завершает чужую попытку.
Следствие: дубли писем и ложный sent/failed новой попытки. Ранее BE-03 воспроизведён harness; в данном проходе механизм повторно прочитан, тот harness не повторялся.
Исправление: отдельный claim token/версия во всех touch/sent/failed UPDATE; ошибки неизвестной внешней доставки не превращать автоматически в повторную отправку.
Приёмка: два worker, lease expiry, старый success/error после новой попытки — старый результат не меняет строку; отдельно принять политику SMTP delivery_unknown.
Предел: exactly-once SMTP не возникает от одной CAS-проверки БД.

### DTASK-02 — Medium / S: обычное редактирование и checklist заменяются без версии

Ссылки: `WEB-itinvent/backend/api/v1/hub.py:1842`; `WEB-itinvent/backend/services/hub_service.py:7386`, `:7450`, `:7576`.
PATCH принимает произвольный dict, не expected version; UPDATE имеет только WHERE id.
Сценарий: два исполнителя читают один checklist, первый меняет пункт A, второй — B и отправляет ранее прочитанный массив. Второй массив стирает A.
RLock процесса сериализует выполнение функций, но не делает актуальным старый payload клиента и не синхронизирует несколько процессов.
Аналогично две вкладки автора незаметно перезаписывают одно и то же поле.
Исправление: версия/expected_updated_at для общих edits; для checklist — адресная операция пункта либо CAS всей версии.
Приёмка: параллельные разные toggles сохраняются оба или один получает 409 без потери пользовательского ввода; одинаковое поле не silently last-wins.
Совместимость: добавление обязательной версии меняет публичный контракт; нужен переходный план для web/mobile/AI callers.

### DTASK-03 — Medium / S: capability запрещает checklist done, API разрешает

Ссылки: `WEB-itinvent/backend/api/v1/hub.py:316`, `:1846`; `WEB-itinvent/backend/services/hub_service.py:7390`, `:7395`, `:7450`.
UI сообщает can_update_checklist=false при done. PATCH требует tasks.read и service допускает checklist-only от participant.
В ветке update_task нет проверки status != done перед сохранением checklist_items.
Сценарий: исполнитель сохраняет отложенный checklist payload после закрытия задачи; завершённая задача меняется вопреки выданной capability.
Исправление: явно согласовать допустимость редактирования после done; при действующем UI-контракте отклонять на сервере, проверяя status в атомарной записи.
Приёмка: HTTP PATCH завершённой задачи исполнителем возвращает conflict/forbidden и сохраняет checklist; race submit/complete/edit проверяется по конечному состоянию.
Не считать это обходом доступа к чужой задаче: object-access проверка существует.

### DTASK-04 — Medium / R+S: realtime patch не пересчитывает состав server-filtered списка

Ссылки: `WEB-itinvent/frontend/src/pages/tasks/useTasksPageController.jsx:275`, `:298`, `:324`; `WEB-itinvent/frontend/src/pages/tasks/hooks/useTasksListQuery.js:157`, `:256`, `:274`.
Только created/deleted вызывают snapshot. updated/status/assignment меняют текущую строку через map, не добавляют/исключают её и не пересчитывают total/порядок.
Сценарий: открыт status=new; remote start меняет строку на in_progress, она остаётся в списке new. Задача, наоборот попавшая под фильтр, отсутствует до reload.
Node harness извлёк реальный patchTaskItem: начальный `{A,new}, total=1`, patch `{status:done}` → `{A,done}, total=1`.
Это подтверждает механизм patch; браузерная приёмка фильтров и server-scope не выполнялась.
Исправление: классифицировать события, влияющие на membership/order, и обновлять соответствующую страницу/точечный query result; сохранить burst coalescing.
Приёмка: status, assignee, department, unread и due filters остаются корректными после remote updates, totals и сортировка совпадают с API.

### DTASK-05 — Medium / S: realtime backlog не имеет общей границы

Ссылки: `WEB-itinvent/frontend/src/pages/tasks/useTasksPageController.jsx:269`, `:272`, `:293`, `:330`.
Пачка максимум 10 ограничивает параллельные GET, но Map/Set растут по числу уникальных task ID до завершения очереди.
Медленные GET и длительный поток уникальных invalidations допускают неограниченное накопление, включая ID вне видимой страницы.
Исправление: общий порог backlog; при превышении перейти к одной snapshot invalidation и отбросить только заменяемые ею item reads.
Приёмка: burst 10 000 разных ID на медленном API — bounded pending, не более 10 item GET in-flight, один согласованный snapshot, корректные selected details.
Нагрузочного RSS замера не было: это отсутствие лимита по коду, не зарегистрированный OOM.

### DTASK-06 — Medium / S: размер страницы ленты не ограничивает чтение истории

Ссылки: `WEB-itinvent/backend/services/hub_service.py:5562`, `:5570`, `:5576`, `:5655`, `:5663`, `:3565`.
list_announcements загружает все публикации и связанные aggregates, затем строит/фильтрует/sort в Python и лишь в конце slices страницу.
_load_announcement_polls читает все polls/options/votes даже при странице 30 или одной карточке через get_announcement (`:5449`).
Следствие: стоимость запроса и память растут с полной историей и голосами, не page size; несколько пользователей повторяют работу.
Исправление: SQL candidate selection и pagination с корректной видимостью; batch enrichment только candidate IDs. Не переносить pagination до permission filtering без проверки полноты страницы/total.
Приёмка: одинаковый пользователь/filters на 1k/10k/100k публикаций; фиксировать query count, rows read, SQL time, peak RSS, p95/p99 и точное равенство выдачи.
До/после не измерялось, поскольку реализации в этом аудите не было.

### DTASK-07 — Medium / S: TTL notification cache не освобождает устаревшие cursor keys

Ссылки: `WEB-itinvent/backend/services/hub_service.py:706`, `:10041`, `:10049`, `:10396`.
Ключ включает user_id/since/limit/flags. Getter возвращает miss после TTL, но не удаляет entry; store без max entries/retention.
Новые cursor/параметры оставляют deepcopy payload в dict до подходящей invalidation или рестарта.
Обычные writes чистят часть записей, но не обеспечивают верхнюю границу при длительном read-only доступе и множестве уникальных cursors.
Исправление: bounded LRU/TTL eviction под существующим lock; не расширять infrastructure.
Приёмка: 10 000 разных since/limits с монотонным временем — размер ограничен, expired keys удаляются, свежий cache hit сохраняет контракт.
Сходный шаблон есть в task list cache (`:10090`), но его cardinality ограничен более узким набором cacheable запросов; отдельным дефектом не посчитан.

## 4. Тесты, производительность и план закрытия

Существующий `WEB-itinvent/frontend/e2e/audit-task-realtime.spec.js:91` содержит семь сценариев: burst, overlap, duplicate, old response, partial failure, deletion snapshot, reconnect.
Файл действительно расширен относительно старой незавершённой проверки, но в этом проходе Playwright не запускался: наличие тестов не считается их прохождением.
Существующий `tests/test_hub_task_transitions_concurrency.py:1` упражняет реальный TestClient и отключает in-process lock, чтобы проверить CAS.
Выбранный профиль завершён: **50 passed, 4 warnings, 156,81 с, exit=0**. Проверены Tickets status, Construction journal и participant/observer helpers; это не полный task E2E gate. После pytest был WinError 5 при cleanup старого pytest-current вне репозитория: assertions прошли, очистка окружения не полностью успешна.
Изолированная проверка Node завершилась exit=0; первая попытка извлечения функции упала из-за CRLF при выделении фрагмента, затем extractor исправлен.
Никакие network/API/БД production не использовались; harness не является browser acceptance.

Порядок исправлений:

1. DTASK-01: fencing task-email; предусмотреть неизвестный внешний результат.
2. DTASK-02/03: согласовать серверную mutation-модель/checklist и closed-state contract.
3. DTASK-04: membership/order при realtime, дополнив существующие семь burst-сценариев.
4. DTASK-05: добавить bounded backlog и проверить 10k-event overload без потери snapshot.
5. DTASK-07: eviction кеша; затем DTASK-06 с измерением baseline перед изменением SQL выдачи.

## 5. Отклонённые выводы и пробелы

- Ошибка «25 событий → обработаны лишь первые 10» больше не соответствует while drain текущего кода.
- Map dedup — корректная оптимизация повторов одного ID; дефект DTASK-05 относится к разным ID, не к duplicate delivery.
- Статусные start/approve/reject используют CAS, поэтому нельзя переносить DTASK-02 на все workflow transitions.
- observers намеренно не являются исполнителями; их отсутствие в assignee membership не дефект.
- Canvas использует expected_revision и rowcount (`WEB-itinvent/backend/services/hub_service.py:7881`), а не тот же blind edit задачи.
- Возможная старая detail response после close (`WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskDetails.jsx:294`) требует UI-сценария; скрытое state само по себе не доказательство видимого resurrection.
- Crash между commit scheduled publication (`WEB-itinvent/backend/services/hub_service.py:6634`) и постановкой push (`:6635`) оставляет риск отсутствия push. In-app notifications пишутся раньше, поэтому это не потеря самой публикации; требуется отдельный crash harness.
- Полная матрица department-manager/delegates с изменением прав во время запроса не исполнялась.
- Не проверялись реальные applied indexes, объём feed/votes, delivery SMTP и живой reconnect IIS.

## 6. Прочитанные файлы и предел покрытия

- `WEB-itinvent/backend/api/v1/hub.py`: capabilities, task patch, canvas contract.
- `WEB-itinvent/backend/services/hub_service.py`: участники/доступ, create/edit, transition CAS, feed read/polls/publish, notification caches и email orchestration.
- `WEB-itinvent/backend/services/hub_task_transitions.py`, `task_participant_service.py`, `task_email_outbox_service.py`.
- `WEB-itinvent/backend/services/task_due_notification_worker.py`, `announcement_publish_worker.py`.
- `WEB-itinvent/frontend/src/pages/tasks/useTasksPageController.jsx` и hooks `useTasksListQuery.js`, `useTaskDetails.jsx`.
- `WEB-itinvent/frontend/e2e/audit-task-realtime.spec.js`, соответствующий list hook test, выбранные Python тесты по участникам/observer/переходам.
- Это глубокая трассировка перечисленных путей, не построчное ревью всех 10k строк HubService и каждого feed widget.
- Изменять source, migrations, runtime config, production или публиковать исправления этот документ не разрешает.
