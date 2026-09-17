# Tasks — аудит, baseline и план оптимизации

Дата: 2026-09-16 (аудит). Обновлено: 2026-09-17 — §1–§9 реализованы, код/тесты/сборка проверены,
коммитов нет, прод не трогался (деплой ждёт явного согласования).
Файл — план работ; новые пункты после старта реализации дописывать в «Текущий план», не в «Уже сделано».

## Объём

Страница `/tasks`: React/Vite/MUI фронтенд (`WEB-itinvent/frontend/src/pages/Tasks.jsx` +
`src/pages/tasks/*`: `useTasksPageController.jsx`, `TasksPageContext.jsx`, `TasksListLayout.jsx`,
`TasksDetailPanel.jsx`, `TasksDialogsLayer.jsx`, `TasksAnalyticsPanel.jsx`, хуки `hooks/*`,
вьюмодели `taskViewModes.js`/`taskAnalyticsViewModel.js`, `TasksDataModeRouter` и вьюхи
`src/components/hub/tasks/*`), FastAPI бэкенд (`backend/api/v1/hub.py` routes `/hub/tasks*`,
`backend/services/hub_service.py`: `list_tasks`, `get_task`, `get_task_analytics`), хранилище —
локальный SQLite fallback / PostgreSQL app-БД через тот же `HubService`.

Карта загрузки (порядок на открытие страницы, холодный маунт):

1. `GET /hub/tasks?scope=…&role_scope=…&limit=150&offset=0` — основной список
   (`useTasksListQuery.js:118-182`, `TASKS_PAGE_SIZE=150` — `useTasksListQuery.js:14`).
   Параллельно (не вотерфол): `departmentsAPI.list()` (`useTasksListQuery.js:205-207`).
   Условно (гейты): проекты/объекты — только при `createOpen || editOpen || showFilters ||
   mobileBoardFiltersOpen` (`useTasksListQuery.js:209-218`); контроллеры — только при тех же
   условиях или `controllerFilter` (`useTasksListQuery.js:220-223`).
2. Поиск `q` — debounce 250 мс (`useTasksFilters.js:81-84`); assignee-поиск — debounce 300 мс +
   минимум 2 символа (`useTasksPageController.jsx:100-101`, `useTaskAssigneeDirectory.js:4,52`).
   Гонки закрыты requestId-гардами (`useTasksListQuery.js:119-120,144`, `useTaskAssigneeDirectory.js:60-61,77`).
3. Открытие карточки: `GET /hub/tasks/{id}` по `?task=` в URL + lazy activity
   (`comments`/`history` грузятся только для активной вкладки, `files` — отдельно;
   `useTaskDetails.jsx:140-183,221-228,244-245`). Мобильный checklist — через history-seed
   (`useTaskDetails.jsx:247-271`).
4. Аналитика: `GET /hub/tasks/analytics` только при `pageMode==='analytics'`, дедуп in-flight +
   loadedParamsKey (`useTaskAnalytics.js:50-94`); idle-префетч бандла
   (`useTasksPageController.jsx:367-373`), префетч данных при наведении/переключении
   (`useTasksPageController.jsx:355-365`).
5. Realtime: WS `tasks.task.created/updated/deleted` → window-событие
   (`hubRealtimeSocket.js:30`) → **коалесцинг 75 мс → полный `reloadTasks()` всего списка**
   (+ `loadTaskDetails`, если открыта затронутая карточка; `useTasksPageController.jsx:257-303`);
   reconnect → принудительный полный reload (`useTasksPageController.jsx:289`).
   Точечных обновлений по WS-операциям нет (`patchTaskItem` по WS не вызывается).
   **Статус после реализации: закрыто (§1) — patch по любому событию с `task_id`, кроме
   `created/deleted`/reconnect (см. «Текущий план» §1.1).**
6. Кэширование клиентское: ручное (без SWR/react-query для списка). Дедуп только:
   `loadTaskUserDirectoriesPromiseRef` (`useTasksListQuery.js:48-79`),
   per-mount ref-гарды (`taskDepartmentsLoadedRef`, `taskProjectMetaLoadedRef`),
   3-секундный серверный кэш дефолтного `my`-списка (`hub_service.py:680,8001-8025`).
   `Cache-Control` на `GET /hub/tasks` и справочниках отсутствует (единственный
   `Cache-Control: private, max-age=300` в hub-контуре — превью PDF вложений,
   `hub.py:2071`).
   **Статус после реализации: справочники departments/projects+objects получают клиентский
   SWR (§9), `/hub/task-projects` и `/hub/task-objects` — HTTP `Cache-Control`; список
   остаётся без HTTP-кэша (только серверный кэш 3 с).**

## Baseline (замерено 2026-09-16, медианы)

Методика: сид 150 задач (рус. словарь, описание ~60 слов, чеклист 2 пункта, комментарий
у каждой 3-й, due у ~50%) во временный SQLite HubService (записи только в temp-dir,
production не трогался, секреты не использовались); фаза замеров — строго SELECT-only.
Backend — медиана из 5 прогонов после warm-up; SQL — счётчик `execute` вокруг `_connect`.
Фронт — Node 24, `taskViewModes.js` напрямую, 1 warm-up + 7 прогонов, медиана.
Чанки baseline — `dist` от 16.09 23:35 (код до изменений), raw + gzip level 9, медиана
из 3. Актуальный `dist` от 17.09 (после §1–§9): `Tasks-DrM3Wme-.js` — 226 150 raw /
60 175 gzip (замер контролёра 17.09). Tasks-контур в рабочем дереве грязный (реализация
§1–§9 не закоммичена). Оговорки: синтетика (реальный gzip-ratio ниже на
разнородных данных), SQLite локально (не PG), объём 150 строк; абсолютные мс между
разными машинами не сравнивать — зачётны только дельты на одной машине.

### Bundle (dist/assets)

| Чанк | raw, B | gzip, B | Статус |
|---|---|---|---|
| `Tasks-B-3EvgCQ.js` (роут: контроллер, контекст, фильтры, детали, вьюмодели списка) | 223 499 | 59 232 | initial |
| `TasksAnalyticsCharts-WHEgS-4O.js` (recharts) | 347 770 | 99 130 | lazy ✅ |
| `TasksAnalyticsView-vuRC4z7V.js` | 16 545 | 4 935 | lazy ✅ |
| `TasksCreateMobileSheet-CjdAn4wT.js` | 23 428 | 8 373 | lazy ✅ |
| `TasksCreateDialog-CW51HZTv.js` | 17 719 | 6 262 | lazy ✅ |
| `TasksTaxonomyDialog-DR9i1wBM.js` | 8 501 | 3 028 | lazy ✅ |
| `TasksBoardView-ERZxFc0x.js` | 6 126 | 2 621 | lazy ✅ |
| `TasksBucketColumnsView-q41B_eEZ.js` | 5 577 | 2 286 | lazy ✅ |
| `TasksCalendarView-B9LfImfs.js` | 4 752 | 2 072 | lazy ✅ |
| `TasksGanttView-BpMqnn2a.js` | 4 382 | 1 989 | lazy ✅ |
| Итого lazy-компаньоны Tasks | ~428 KB | ~131 KB | вне initial |

### Backend (150 задач, SELECT-only, медиана 5)

| Операция | ms | SQL | JSON raw | JSON gzip |
|---|---|---|---|---|
| `list_tasks` scope=my, limit=150 | 18.9 | 8 | 382 508 B (~2.5 KB/задача) | 29 662 B |
| `list_tasks` my + q + status | 5.3 | 8 | — | — |
| `list_tasks` scope=department, limit=150 | 44.3 | 9 | 382 516 B | 29 662 B |
| `get_task` (карточка) | 2.3 | 7 | 3 125 B | 1 115 B |
| `get_task_analytics` (год, admin) | 3.8 | 7 | 3 045 B | 660 B |

Состав 8 SQL списка: page-SELECT + `COUNT(*)` + 5 batch (`_build_task_list_batch_context`,
`hub_service.py:2480-2573`: attach/report/comment counts, latest comments, reads) + проекты
(`_load_records_by_ids`); объекты/департаменты — только при наличии id в выборке; каталог
пользователей — in-process кэш 300 с (`hub_service.py:690`). Состав 7 SQL карточки:
задача + отчёт + вложения + саммари комментариев (2) + проект + объект
(`_task_with_latest_report`, `hub_service.py:2822-2876`).

### Frontend view-model (150 задач, медиана 7, Node 24)

| Билдер | ms |
|---|---|
| `buildTaskListSections` (2 сортировки rank+due) | 2.53 |
| `buildDeadlineBuckets` | 0.83 |
| `buildCalendarDays` (сетка 42 дня) | 0.43 |
| `buildGanttRows` | 0.38 |
| Всё вместе за рендер (считаются все 4 вне зависимости от `pageMode`) | 3.63 |

## Уже сделано (исходное состояние на момент аудита 2026-09-16; реализация §1–§9 —
в «Текущем плане» ниже)

| Изменение | Доказательство |
|---|---|
| Lazy-сплит вьюх board/bucket/calendar/gantt/analytics + charts внутри AnalyticsView | `TasksDataModeRouter.jsx:17-25`, `TasksAnalyticsView.jsx:21`; покрыто `Tasks.performance.test.jsx:9-54` |
| Idle-префетч analytics-бандла + префетч по переключению/ховеру | `useTasksPageController.jsx:362-373` |
| Серверная пагинация limit/offset (фронт 150, API max 500) + «Показать ещё» append | `useTasksListQuery.js:14,141-142,307-313`, `hub.py:1466-1467` |
| Batch-контекст списка вместо N+1 (5 GROUP BY) | `hub_service.py:2480-2573` |
| Lean-контракт списка: allow/deny ключей, `description_preview` SUBSTR 200 (было 500 до §5) | `hub_service.py:398-429,432-492` |
| RequestId-гарды от гонок списка/деталей/assignee-поиска | `useTasksListQuery.js:119-120`, `useTaskDetails.jsx:188-190`, `useTaskAssigneeDirectory.js:60-61` |
| Debounce 250 мс поиск / 300 мс + min-chars 2 assignee | `useTasksFilters.js:81-84`, `useTasksPageController.jsx:100-101` |
| 75-мс коалесцинг WS-событий перед reload | `useTasksPageController.jsx:270-280` |
| Серверный кэш дефолтного my-списка 3 с + инвалидация цепочкой мутаций | `hub_service.py:680,8001-8025,9229-9245,9269-9288` |
| Activity карточки lazy по табам; файлы отдельно | `useTaskDetails.jsx:140-183,221-228` |
| Гейты справочников (проекты/объекты/контроллеры — только когда нужны) | `useTasksListQuery.js:209-223` |
| `TaskCard` memo | `TaskCard.jsx:39` |

## Топ-10 узких мест (доказательства + оценка эффекта)

Статус после реализации (2026-09-17): закрыты п.1 (§1), п.3 (§4, частично — live-PG),
п.4 (§5), п.5 (§7), п.7 (§3), п.8 (§8), п.9 (§9); п.2 (§2) закрыт CSS-скипом —
окном append-buffer; п.6 (§6) — фронт-gate и unread-rewrite закрыты, EXPLAIN/trgm-check
на live-PG — остаётся; п.10 — не трогался (Low).

1. **WS → всегда полный `reloadTasks()` (+ `loadTaskDetails`)** — `useTasksPageController.jsx:257-303`.
   Любой `updated` (в т.ч. чужой задачи, чеклист-тик, комментарий) перезагружает всю страницу
   списка; reconnect — принудительно (`:289`). `patchTaskItem` по WS не используется.
   Эффект: **High** (лишний `GET /hub/tasks` ~383 KB raw на каждое событие).
2. **Списки без виртуализации; append-накопление до `total`** — `useTasksListQuery.js:14,149-158,307-313`;
   рендер всех N: `TasksMobileFeedView.jsx:39-41,59-61`, `TasksBoardView.jsx:59-61`,
   `TasksDesktopListView.jsx` (таблица целиком). `TaskCard` memo (`TaskCard.jsx:39`) не спасает
   от монтирования сотен DOM-узлов. Эффект: **High** (растёт с N; см. Database-прецедент
   с `content-visibility`).
3. **Department-scope: скан батчами по 100 до cap 2000 + `ORDER BY CASE id WHEN…`**
   (`hub_service.py:842-898`; константы `:526-527`), `total=len(visible_ids)`.
   Замер: 44.3 мс против 18.9 мс my-scope на тех же 150. Эффект: **High** для отделов;
   предупреждение «лимит 2000» уже в UI (`TasksListLayout.jsx:111-115`).
4. **Over-fetch строки списка: `description_preview` до 500 символов + полный JSON
   `checklist_items` на строку** (`hub_service.py:398-429`, `_task_to_list_item` `:2684-2756`).
   Замер: ~2.5 KB/задача, 382 KB raw на страницу. Эффект: **Medium** (срез превью и замена
   checklist на counts режут payload десятки процентов; контракт `_TASK_LIST_PUBLIC_KEYS`
   при этом не меняется).
5. **Мутации → `refreshTasksAndDetails` (полный список + детали)**: комментарий
   (`useTaskDetails.jsx:416-431`), add-checklist (`:716-728`), все workflow-переходы
   (`useTaskWorkflowActions.js:63-147`), create/edit (`useTaskCreateForm.js:430`,
   `useTaskEditForm.js:262`). Точечный `patchTaskItem` используется лишь для seen-флага
   и чеклист-тогла (`useTaskDetails.jsx:166,707`). Сервер в переходах возвращает updated task —
   его можно класть в список напрямую. Эффект: **Medium**.
6. **Поиск `LOWER(title/description) LIKE %…%`** (`hub_service.py:8063-8067`) — ведущий `%`,
   индекс не используется (комментарий в коде про PG trgm — только «when present»);
   фильтры unread/focus — коррелированный `EXISTS` с `GROUP BY` по всей таблице комментариев
   (`hub_service.py:2659-2682`). Эффект: **Medium** (на 150 строках дёшево — 5.3 мс, —
   риск растёт с объёмом).
7. **Все 4 вьюмодели считаются при любом изменении payload, вне зависимости от `pageMode`** —
   `taskGroupingNow = new Date()` в deps + sections/buckets/calendar/gantt
   (`useTasksListQuery.js:276-292`); сверху ещё `focusCounts`/`openTasksCount`/сортировка
   (`:294-304`, `TasksDesktopListView.jsx:25-34,92-99`) и `Array.find` проекта на строку
   при рендере (`TasksDesktopListView.jsx:105-109`). Замер: 3.63 мс/150 — сейчас микро,
   но пересчёт идёт и на каждый WS-reload (см. п.1). Эффект: **Medium** в связке с п.1,
   сам по себе Low.
8. **Открытие карточки всегда `GET /hub/tasks/{id}`, хотя строка уже в списке**
   (`useTaskDetails.jsx:244-245,307-330`). Эффект: **Low** (7 SQL / 2.3 мс / 3 KB —
   дёшево; выигрыш только в latency восприятия → stale-while-revalidate).
9. **Справочники без клиентского кэша между маунтами**: `departmentsAPI.list()` на каждый
   маунт (`useTasksListQuery.js:205-207`, гард только per-mount); `getAssignees` без кэша
   повторов (`useTaskAssigneeDirectory.js:49-80`); `Cache-Control` на hub-GET отсутствует
   (см. «Карта загрузки» п.6). Серверный каталог пользователей кэширован 300 с
   (`hub_service.py:690`) — эта часть закрыта. Эффект: **Low**.
10. **Тяжёлые `useMemo`/пропсы с нестабильными deps**: `mobileNavigationDrawerProps` ~30 deps
    (`useTasksPageController.jsx:665-730`), keydown-эффект с объектами в deps
    (`:582-622`, переподписка каждый рендер). Эффект: **Low** (churn подписок/объектов,
    не сеть).

## Текущий план

### 1. Точечные обновления по WS вместо полного reload — реализовано

Факты: `scheduleRefresh` в `useTasksPageController.jsx:257-303` после 75-мс коалесцинга всегда
зовёт `list.reloadTasks()`; для `operation==='updated'` realtime-payload уже содержит
`task_id/status/updated_at` (`hub_service.py:2300-2329`), а серверные переходы возвращают
полный updated task. Полный reload нужен только для `created/deleted/forceSnapshot`
(меняется состав/порядок выборки).

Реализация (выполнена): в `scheduleRefresh` для всех однозадачных событий, кроме
`created`/`deleted` (и кроме reconnect/`forceSnapshot`) — `GET /hub/tasks/{id}` одной
задачи + `list.patchTaskItem(id, stripTaskDetailOnlyKeys(task))`; `reloadTasks` остаётся
для `created/deleted/reconnect` и для событий без `task_id`. Расширение списка операций
против исходного «только `updated`» (started/reopened/submit/approve/reject/comment_added
и т.п.) осознанное: эти операции тоже меняют статус/сортировку и без патча оставляют stale.
Коалесцинг ограничивает patch-выборку десятью задачами за тик; конфликты версий остаются
закрыты 409-механизмом переходов (`hub_task_transitions`).

Проверки: юнит 5/5 в `useTasksPageController.test.jsx`: `updated` → только `getTask`, ноль
`getTasks`; `created` → полный reload; пустой payload → консервативный reload; удаление
открытой карточки закрывает детали (старое поведение `:273-274` сохранено). Remaining:
smoke на живой странице (входит в §10).

### 2. Виртуализация списков + предел append-буфера — реализовано (CSS-скип, не windowing)

Факты: рендер всех N без виртуализации (п.2 топа); `loadMoreTasks` append без предела
(`useTasksListQuery.js:149-158,311-313`). Прецедент Database — `content-visibility: auto`
+ `contain-intrinsic-size` без потери expanded-стейта (`DATABASE_OPTIMIZATION.md` §5).

Реализация (выполнена): `content-visibility: auto` + `contain-intrinsic-size` на карточке
мобильного фида (168px) и досковой карточке (140px) в `TaskCard.jsx`, и на строках
`TasksListTableRow.jsx` (72px). Append-буфер — скользящее окно ≤3 страниц: первые три
"Показать ещё" appended, четвёртая и последующие грузятся с `append=false` и ЗАМЕНЯЮТ
буфер (offset растёт), т.е. глубина ограничена окном, а не total; `hasMoreTasks`/`tasksTotal`
контракт не меняется.

Проверки: юниты буфера/пагинации в `useTasksListQuery.test.jsx` (offset 450 → replace,
items ≤ страница). Осталось: скролл-тест 390px/1440px вручную/браузерный smoke (§10) —
DOM-узлы остаются смонтированными (CSS-скип пропускает layout/paint, как в Mail/Database
прецеденте), строгий «DOM ≤ видимых» не выполняется и не заявляется.

### 3. Гейтинг вьюмоделей по pageMode — реализовано

Факты: `useTasksListQuery.js:276-292` считает sections/buckets/calendar/gantt всегда;
`taskGroupingNow` — `new Date()` в deps. Замер «всё вместе» — 3.63 мс/150 (бенч выше).

Реализация (выполнена): считать `taskListSections` только для `pageMode='list'`,
`deadlineBuckets` — deadlines, `calendarPayload` — calendar, `ganttPayload` — gantt;
вне активного режима возвращаются дешёвые константы-заглушки той же формы
(`EMPTY_TASK_LIST_SECTIONS`/`{days:[],noDueCount:0}`/`{rows:[],noDueItems:[]}`);
`taskGroupingNow` — минутный `setInterval`-тик в state, а не пересоздание на payload.

Проверки: юниты 5/5 `useTasksListQuery.test.jsx` (sections/buckets только в своём режиме);
бенч на текущей машине (см. чек-лист) — активная вьюмодель 2.03 мс против «ALL combined»
2.60 мс; сравнение с baseline 3.63 мс с другой машины напрямую некорректно
(абсолютные мс между машинами не сравнивать) — кросс-машинные «~% выигрыша» не заявлять.

### 4. Department-scope: меньше сканирования — реализовано (частично; live-PG обязателен)

Факты: `_collect_department_scope_visible_task_ids` (`hub_service.py:842-882`) идёт батчами
`_DEPARTMENT_SCOPE_FETCH_BATCH=100` до `_DEPARTMENT_SCOPE_SQL_SCAN_CAP=2000`; затем
`_fetch_task_list_rows_by_ids` с `ORDER BY CASE id WHEN…` (`:884-898`). Замер: 44.3 мс
против 18.9 мс my-scope. Пробел честно: корректный ранний выход по offset+limit невозможен
без потери порядка — сортировка требует полного скана видимых.

Реализация (выполнена, app-side без DDL): fetch-batch 100→500; per-process кэш
`visible_ids+truncated` на TTL 3 с (`_department_scope_ids_cache`, ключ:
user_id + sort/dir/tie + where_sql + params) с инвалидацией через существующую
`_invalidate_tasks_list_cache` цепочку; `CASE`-сортировка сохранена (join по временной
выборке — отложено, см. «Отклонено»).

Проверки: backend `tests/test_hub_tasks.py` (57) зелёные — `truncated`-контракт и алерт
`TasksListLayout.jsx:111-115` не сломаны. Замер на локальном SQLite, сид 150: холодный
43.35→42.35 мс, тёплый (кэш) ~39.7 мс; цель «приблизиться к my-scope 18.9» на локальной
SQLite не достигается — узкое место прямо на share бэндлед-обогащении/сериализации, а не
в скане id. **Замер повторить на live-PG — именно там выигрывает сокращение round-trip
и кэш ids; без live-цифр ускорение не заявляется** (см. §10).

### 5. Slim строки списка — реализовано (−13% raw)

Факты: `description_preview` SUBSTR 500 (`hub_service.py:401`) + полный `checklist_items`
JSON в SELECT (`:406`) при наличии готовых `checklist_total/checklist_done`; 382 KB raw
на 150 (замер). Ключи контракта `_TASK_LIST_PUBLIC_KEYS` (`:432-480`) позволяют убрать
тяжёлые поля из SELECT, оставив ключи в ответе.

Реализация (выполнена): превью 500→200; `checklist_items` из `_TASK_LIST_SELECT_COLUMNS`
убран; `checklist_total/checklist_done` считаются SQL-агрегатом по тем же 150 id в
`_build_task_list_batch_context` → `_task_checklist_counts_by_ids` с диалектной веткой
(SQLite `json_each` / PG `jsonb_array_elements`), ключи контракта не меняются.
Промежуточная формулировка в черновике (counts «из обрезанного») снята — counts
СТРОГО из SQL-агрегата, не из частично обрезанного поля.

Проверки: замер на локальном сиде 150: raw 375 197 → 325 913 B (−49 284 B, −13.1%),
время 45.60→43.97 мс (SQLite; аудит-baseline списка на другой машине — 18.9 мс,
абсолютные мс между машинами не сравнивать, зачётна только дельта на одной машине);
backend-тесты 58/58, включая контракт ключей
(`_TASK_LIST_PUBLIC_KEYS`/`_TASK_LIST_FORBIDDEN_KEYS`) — ключи в ответе сохранены; для
описаний длиннее 200 символов карточка видит усечённое превью до полного открытия
(принято: карточка всё равно дозагружает полный `description` через `GET /hub/tasks/{id}`).
Осталось: контрольный визуальный smoke (§10).

### 6. Поиск и unread-фильтр — реализовано (EXPLAIN на PG — остаётся)

Факты: `LOWER() LIKE %…%` (`hub_service.py:8063-8067`), unread-`EXISTS` с inner
`GROUP BY task_id` по всей таблице (`:2659-2682`); покрывающий индекс
`idx_hub_task_comments_task(task_id, created_at)` существует (миграция `20260327_0002`).
Сейчас дёшево (5.3 мс на 150), пункт — про рост.

Уточнение против исходной записи: PG trgm-индекс `idx_hub_tasks_title_trgm` УЖЕ
существует миграцией `20260626_0060_hub_tasks_title_trgm.py` (с
`CREATE EXTENSION IF NOT EXISTS pg_trgm`); новой миграции не нужно — требуется
лишь проверить факт применения на live-PG (`alembic current`/`inspector`, §10).

Реализация (выполнена): min-length q ≥2 (фронт: фильтр-дебаунс пропускает 1 символ,
`loadTasks` — ранний skip; свой const `TASKS_QUERY_MIN_CHARS=2` в «taskConstants»);
unread переписан на коррелированный `EXISTS` с `LEFT JOIN` reads без inner
GROUP-подзапроса. Осознанное отличие от старого поведения (зафиксировано контролёром
17.09): раньше unread требовал, чтобы ПОСЛЕДНИЙ комментарий был чужим и новее метки;
теперь — любой чужой комментарий новее метки (или без метки). Флагов unread станет
больше; возврат к строгой семантике — отдельным решением при жалобах.

Проверки: юнит 4/4 (q из 1 символа не уходит в сеть, q≥2 уходит с `q`-параметром);
backend 58/58 (в т.ч. unread-фильтр). Осталось (§10): `EXPLAIN (ANALYZE, BUFFERS)`
unread до/после на тестовой PG, перф-тест unread на сиде 10k комментариев — на SQLite
не репрезентативно.

### 7. Мутации → patch вместо refreshTasksAndDetails — реализовано

Факты: полный reload после комментария/чеклиста/переходов/создания/редактирования
(ссылки — п.5 топа). Переходы и `updateTask` возвращают updated task
(`hub_service.py:6836-6890`, `get_task` после мутаций).

Реализация (выполнена): по возвращённой задаче — `applyTaskUpdate(taskId, task)`
(`useTaskDetails.jsx`): `patchTaskItem` со срезом detail-only ключей +
обновление `detailsTask`, если карточка открыта; полный `loadTasks` остаётся на
create/delete (смена состава) и при applyTaskUpdate недоступен.
Переходы: submit/review/close/start/reopen — патч; comment — локальный патч счётчиков
(`comments_count+1`, latest_comment_*) и добавление в `detailsComments` без сети;
add-checklist и checklist-toggle — патч от возвращённой задачи (toggle перестал
протекать `checklist_items` в лист-item — это скрытый баг старого кода).

Проверки: юниты `useTaskWorkflowActions.test.js` (submit/review/close/start/reopen →
`applyTaskUpdate`, ноль `loadTasks`) и `useTaskDetails.test.jsx` (comment/add-checklist/
toggle — 0 `GET /hub/tasks`); конфликт-версий остаётся 409-путь.

### 8. Stale-while-revalidate деталей карточки — реализовано

Факты: `openTaskDetails` сбрасывает `detailsTask` и ждёт сеть (`useTaskDetails.jsx:307-330`),
хотя строка списка уже содержит lean-версию.

Реализация (выполнена): при открытии подставлять item из `visibleTaskItems` мгновенно
(иначе — прежняя загрузка-скелет), фоном — существующий `loadTaskDetails` по
`selectedTaskId` (гонки закрыты `loadTaskDetailsRequestRef`); в lean-версии снимается
`detailsLoading`, фоновый fetch всё равно запускается и сверяет/обновляет стейт.

Проверки: юнит 18/18, в т.ч. «детали рисуются до резолва getTask»; activity-табы lazy
не тронуты.

### 9. Кэш справочников + Cache-Control — реализовано (с зафиксированным допущением)

Факты: departments refetch каждый маунт (`useTasksListQuery.js:205-207`); assignee-поиск
без кэша повторов; `Cache-Control` на hub-GET нет (п.6 карты). Прецедент Database —
`getOrFetchSWR` stale 120 с + `Cache-Control: private, max-age=300` на справочниках.

Реализация (выполнена): клиентский SWR — departments stale 300 с
(ключ `['hub','tasks','departments']`), projects+objects stale 120 с (единый ключ
`['hub','tasks','taskProjectMeta']`; force-ветка сохранена для таксономии —
`loadTaskUsers({force:true})` обновляет и кэш). HTTP `Cache-Control: private, max-age=300`
добавлен ТОЛЬКО на `GET /hub/task-projects` и `GET /hub/task-objects` — это глобальные
справочники. `/hub/users/assignees`, `/hub/users/controllers` и список `/departments` —
БЕЗ HTTP Cache-Control: ответы per-user (`is_current_user_manager`, видимость,
PII-каталог) — риск кросс-пользователевых ошибок выше пользы; повторный assignee-поиск
также остаётся без кэша повторов. Если позже добавить — только с user-id в ключе,
отдельное решение (§10).

Проверки: юнит 5/5 (`useTasksListQuery.test.jsx`): повторный маунт departments — 0
сетевых запросов в TTL; таксономия форсирует перезагрузку (force) и обновляет кэш; backend-тест
`test_taxonomy_support_routes_send_private_cache_control` (Cache-Control на projects/
objects; отсутствие на assignees). Smoke gzip — в §10 (после deploy).

### 10. Деплой, live-проверки и хвост (новое, осталось сделать)

Порядок:
1. Коммит diff (по явной просьбе; сейчас дифф не закоммичен, живёт в рабочем дереве).
2. `scripts/pm2/restart-backend.ps1` — только по явному согласию (тянет restart-scan).
3. После рестарта: smoke `Content-Encoding: gzip` на `GET /hub/tasks` (read-only),
   `Cache-Control` на `/hub/task-projects`.
4. IIS-фронт: выложить собранный `dist` (Tasks-чанк 226.15 kB / gzip 60.69 kB).
5. Live-PG замеры (read-only): list my/department, карточка, аналитика, gzip-ratio;
   `EXPLAIN (ANALYZE, BUFFERS)` unread до/после — на изолированной тестовой копии;
   проверка `alembic current` (применён ли `20260626_0060_hub_tasks_title_trgm`);
   перф unread на сиде 10k комментариев.
6. Ручной браузерный smoke 390px/1440px без console errors (виртуализация/SWR).
7. При расхождении живых цифр с локальными — дописать сюда фактические, не урезать план.

## Чек-лист выполнения

Порядок: §9 gzip-smoke (только проверка) → §7 patch-мутации → §1 WS-patch → §3 гейтинг
вьюмоделей → §5 slim → §2 виртуализация → §4 department-scope → §6 поиск/unread →
§8 SWR деталей → §9 Cache-Control/SWR справочников. Каждый пункт — тесты + замер до/после.

- [x] §9-smoke: `GET /hub/tasks` отдаёт `Content-Encoding: gzip` — middleware добавлен в коммите
  d78e4d2a (16.09 23:27), но живой процесс 8001 стартовал 16.09 17:45 и гоняет код до коммита —
  в 8001 header отсутствует. Локальный инстанс того же кода подтверждает gzip на `/hub/tasks`
  (38.7 KB payload → `content-encoding: gzip` + `Vary: Accept-Encoding`; контроль без
  `Accept-Encoding` — без gzip). Нужен `restart-backend.ps1` для прода.
- [x] §7: submit/review/close/comment/add-checklist/toggle/edit — без `GET /hub/tasks`
  (юниты по мокам): все тесты переходов в `useTaskWorkflowActions.test.js` (6) +
  мутации в `useTaskDetails.test.jsx` (18) зелёные
- [x] §1: WS `updated` — без `GET /hub/tasks`; `created/deleted/reconnect` — с reload (юниты) —
  5/5 (`useTasksPageController.test.jsx`)
- [x] §3: вьюмодели вне активного `pageMode` не считаются (юнит + бенч) — gated per-mode bench
  sections 2.03 / buckets 0.35 / calendar 0.22 / gantt 0.24 мс/150; ALL-combined на этой машине
  2.60 мс (baseline 3.63 мс снят на другой машине — напрямую не сопоставимо;
  кросс-машинные «~% выигрыша» не заявлять, зачётен gated-замер на одной машине)
- [x] §5: raw сид-150: до 375 197 B → после 325 913 B (−13.1%); время 45.60→43.97 мс (локальная
  SQLite; аудит-baseline на другой машине — 18.9 мс, абсолютные мс не сравнивать);
  backend-тесты контракта зелёные (итоговый прогон — 58/58)
- [x] §2: `content-visibility: auto` + `contain-intrinsic-size` на `TaskCard` (мобильный фид и
  доска) и `TasksListTableRow`; append-буфер скользит (≤ 3 страницы), контракт
  `hasMoreTasks`/`tasksTotal` и юниты зелёные (CSS-скип — не windowing: DOM остаётся
  смонтированным, браузер пропускает layout/paint; ручной скролл-тест 390px/1440px — §10)
- [x] §4: до 43.35 мс → после (холодный) 42.35 мс / (тёплый ids-кэш 3 с) ~39.7 мс на локальной
  SQLite по 150; batch 100→500; `truncated`-контракт тесты зелёные; live-PG замер обязателен
- [x] §6: q<2 не уходит в сеть (ранний skip в `loadTasks` + пропуск 1 символа в фильтр-дебаунсе);
  unread переписан на коррелированный `EXISTS` без внутреннего `GROUP BY`; backend 58/58;
  EXPLAIN на PG не прогонялся (на локальной SQLite не репрезентативно)
- [x] §8: детали рисуются из кэша списка до резолва сети (юнит, 18/18)
- [x] §9: повторный маунт departments — 0 сетевых запросов в TTL (юнит, 5/5); SWR на
  projects/objects (stale 120 с) + на departments (300 с); Cache-Control `private, max-age=300`
  на `GET /hub/task-projects`, `/hub/task-objects`; per-userные — `/hub/users/*` и `/departments`
  — БЕЗ HTTP Cache-Control (per-user `is_current_user_manager`/visibility), только клиентский
  SWR — допущение; при желании выносится на сервер после отдельного решения
- [x] Финальная проверка: фронт — 115 файлов / 647 теста зелёные (скоп команды исполнителя,
  точную команду дописать; проверенный контролёром скоп tasks: 55 файлов / 223 теста);
  `tests/test_hub_tasks.py` 58/58; `npm run build` — Tasks-чанк сборки исполнителя
  226 151 B / gzip 60 687 B; `dist` в дереве (17.09 3:47) — 226 150 B / gzip 60 175 B
  (замер контролёра; базовый 223 499 / 59 232: +~2.6 KB/+~1 KB от новой логики,
  ленивые компаньоны не растут)
- [ ] Браузерный smoke 390px/1440px без console errors — НЕ ПРОГОНЯЛСЯ (браузер
  вне сессии; ручная проверка по §10.6)
- [ ] Live-замеры на стенде с реальной БД (PG) + деплой: коммит diff, `restart-backend.ps1`
  (по явному согласию), выгруз `dist` в IIS, gzip/Cache-Control smokes, list/department/
  карточка/аналитика, EXPLAIN unread, проверка применения trgm-миграции — см. §10

## Отклонено / отложено (с причинами)

| Кандидат | Статус | Причина |
|---|---|---|
| Redis / Docker / брокер для realtime-кэша или очередей | Отклонено | Запрет без прямого указания; per-process TTL (3 с список, 300 с каталог) закрывают текущие объёмы (19 мс/страница) |
| Runtime `CREATE INDEX` в request path / руками на проде | Отклонено | Запрет; индексы только через Alembic после `inspector`-проверки фактической схемы (инвариант `chat` vs `public` из AGENTS.md касается и hub-таблиц) |
| SW-кэширование `/api` | Отклонено | Прецедент Database: stale `/auth/me` ломал E2E и авторизацию |
| Слияние `getTask` + comments + statusLog в один запрос карточки | Отложено | Activity и так lazy по табам (`useTaskDetails.jsx:221-228`); карточка 7 SQL / 2.3 мс / 3 KB — не узкое место |
| Вынос transfer-act enrich из request path списка | Отклонено | Enrich коллекции — in-memory (`hub.py:1493` → `enrich_tasks`); SQL-активности чтением кода не зафиксировано; при подозрении — сначала профилировать, не выносить |
| Поднятие `TASKS_PAGE_SIZE` 150→500 / префетч страниц | Отложено | Нужны замеры на реальной PG; append-буфер и так растёт до total |
| Keyset-пагинация вместо `OFFSET/FETCH` | Отложено | `total` нужен контракту «Показать ещё»; объёмы малые, OFFSET дёшев |
| Серверная сортировка `updated_at` для десктоп-списка (убрать клиентский re-sort) | Отложено | Микро (сортировка 150 в памяти); контракт `sort_by/sort_dir` уже серверный (`hub.py:1464-1465`) |
| Полный вынос аналитики в воркер/кэш | Отложено | 7 SQL / 3.8 мс на 150; вернуться при росте на порядок или жалобах на экспорт Excel |
| НК-индексы под `LOWER(title)` (кроме trgm через Alembic) | Отложено | Сначала min-length + замер; `%…%` seek не вернёт в любом случае |

## Замечания по эксплуатации

- После реализации (2026-09-17) Tasks-дифф НЕ закоммичен. Инвентарь изменённых Tasks-файлов:
  backend — `hub_service.py`, `api/v1/hub.py`; frontend — `useTasksListQuery.js(+test)`,
  `useTaskDetails.jsx(+test)`, `useTaskWorkflowActions.js(+test)`, `useTaskEditForm.js`,
  `useTaskCreate.jsx`, `useTasksPageController.jsx(+test)`, `taskApiHelpers.js`,
  `taskConstants.js`, `useTasksFilters.js`, `TaskCard.jsx`, `TasksListTableRow.jsx`,
  `Tasks.test.jsx`. Грязная часть дерева вне Tasks (my_files, warehouse_1c, database,
  mobile, PM2-скрипты — меняется другими сессиями) не трогать, коммитить только Tasks-дифф.
- Собранный `dist` (Tasks 226.15 kB / gzip 60.69 kB) получен локально; для IIS-прода
  нужен выгруз и перезапуск backend (§10), иначе часть правок не видима.
- E2E на preview: service worker + порядок route-моков (catch-all `**/api/**` первым) —
  см. «Замечания по эксплуатации» в `DATABASE_OPTIMIZATION.md`; относится и к Tasks smoke.
- Baseline-харнес (`tasks_baseline.py`, `tasks_viewmodes_bench.mjs`) — вне репозитория,
  во временном каталоге; сид 150 — синтетика (реальный gzip-ratio и PG-план могут отличаться —
  live-замеры из чек-листа обязательны перед заявлениями об ускорении). Замеры этой
  сессии выполнялись локально (SQLite + Node) и фиксируются как относительные.
- Серверные кэши hub — per-process (`_tasks_list_cache_ttl_sec=3.0`, user directory 300 с,
  новый `_department_scope_ids_cache_ttl_sec=3.0`): при нескольких воркерах возможна
  рассинхронизация до TTL — для списка и dept-scope это принято осознанно (мутации шлют
  realtime + инвалидируют свой процесс).
- Клиентские SWR-ключи (`hub.tasks*`) не размешивать с ключами других страниц;
  в тестах, создающих страницы Tasks, обязан стоять `clearSWRCache()` в beforeEach —
  кэш модуль-уровня живёт дольше теста.
- Legacy-поля (`INV_NO`-подобные в hub-контексте: `protocol_date`, `assignee_user_ids` JSON)
  смысл не менять без проверки потребителей (чат-AI `ai_chat/tools/office.py:416-490`,
  `chat_serialization.py:242-256` читают те же serializ
...[truncated 208 chars]


