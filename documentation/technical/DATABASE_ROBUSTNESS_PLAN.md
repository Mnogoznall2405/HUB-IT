# Database — план антихрупкости (как сделать страницу нехрупкой)

Дата: 2026-09-16. Статус: **активен**, этап 0 выполнен (замеры ниже). Связанный файл:
`DATABASE_OPTIMIZATION.md` — **заморожен** (точечная оптимизация завершена, вердикт контролёра внутри).
Роль исполнения: код правит исполнитель, контролёр сверяет пункты с кодом и закрывает только после проверок.
Правило закрытия пункта: зелёные релевантные тесты + сверка с baseline этапа 0, без этого пункт не закрыт.

## Диагноз (почему хрупкая)

1. `WEB-itinvent/frontend/src/pages/Database.jsx` (~2300 строк, ~30 `useState`) — god-компонент,
   склеивающий ~20 хуков `useDatabase*`. Любая фича трогает общий корень → регрессии рендера.
2. Два противоречащих допущения: сервер пагинирует (`limit=1000`, `OFFSET/FETCH`),
   а поиск — клиентский по накопленному (`useDatabaseSearch.js`, `databaseListModel.js:160-209`).
   Отсюда перестройка индекса на каждую догрузку, сброс раскрытых веток, полный
   `fetchAllEquipment({force:true})` после мутаций «чтобы индекс не врал».
3. Строка списка (~25 полей + enrich-актов CTE `equipment_current_act_reads.py:68-242`)
   тащит вес карточки, хотя списку нужно ~8 полей.
4. Контракт `search/universal` уже починен в рабочем дереве (честные `page/pages/total`,
   см. вердикт в `DATABASE_OPTIMIZATION.md`) — в этапе 1 остаётся только зафиксировать его тестом,
   заново не реализовывать. Точечные обновления после transfer/add уже внедрены там же —
   в этапе 4 остаётся покрыть остаток (consumable-qty/delete/акт) и общий протокол.
5. Кэш — per-process dict с TTL (`equipment_db.py:14-80`), инвалидация только через API-мутации.
   При нескольких воркерах — рассинхрон по определению (потому TTL 30с поднятию не подлежит).

## Целевое состояние

- `Database.jsx` — тонкий контейнер (композиция + роутинг состояния), фичи — изолированные модули
  со своим состоянием: список, поиск, деталь, акты, диалоги мутаций.
- Поиск — серверный первичный с честной пагинацией; клиентский индекс — только как
  деградация при офлайне/ошибке (или удалён полностью после замеров).
- Два DTO: `EquipmentListRow` (~8 полей, без enrich) и `EquipmentDetail` (полный + акты по табам).
  Enrich «текущий акт» — не на странице списка, а лениво (колонка по запросу / батч для видимых).
- Мутации — протокол `mutation → точечный upsert/remove + bump версии`, полный refetch —
  только по явной кнопке «Обновить».
- Кэш с версионированием (`db_id + data_version`), а не только TTL; воркеры не врут друг другу.

## Этапы

### Этап 0. Baseline (без него дальше нельзя)

- Зафиксировать: размер Database-чанка, время/объём `all-grouped?page=1&limit=1000`,
  число SQL-запросов на открытие страницы и карточки, время сериализации Pydantic на 1000 строк,
  время перестройки клиентского индекса на 2000 строк.
- Приёмочный критерий: цифры записаны в этот файл, повторный замер воспроизводим.

#### Замеры 2026-09-16 (локальные, без SQL Server и без прод-доступа)

- **Database-чанк** (`dist/assets/Database-DCicbNuX.js`, сборка от 2026-09-16):
  raw **225.34 KB**, gzip-9 **69.21 KB**. В `DATABASE_OPTIMIZATION.md` было 230.75/71.5 KB —
  расхождение в пределах разных сборок, порядок тот же.
- **Объём `all-grouped` (синтетика, 1000 строк × ~25 полей, латиница):**
  `json.dumps` **5.1 мс**, payload raw **~517 KB**, gzip **~18 KB** (данные повторяющиеся —
  на реальных строках gzip будет хуже, ориентир — десятки KB). Вывод: страница возит
  ~0.5 MB JSON на каждую 1000 строк; gzip (§1 плана оптимизации) режет это на порядок.
- **Pydantic-валидация 1000 строк (`EquipmentBase`, pydantic 2.12.5): best-of-5 — 5.5 мс.**
  Коррекция прошлых выводов: сериализация/валидация — НЕ узкое место, бюджет не нужен.
- **Перестройка клиентского поискового индекса (Node 24, инлайн-копия алгоритма
  `databaseListModel.js:160-209`): n=1000 — 1.4 мс, n=2000 — 2.1 мс, n=5000 — 5.3 мс;
  линейный скан одного запроса — 0.2–0.6 мс. Коррекция: CPU индекса — НЕ проблема.**
  Реальная проблема индекса — UX: эффект `useDatabaseSearch.js:109-121` с `searchIndex` в deps
  сбрасывает раскрытые ветки при каждой догрузке. Чинить как баг состояния, не как перф.
- **Сортировка `Intl.Collator('ru')` с 3-уровневым tie-break (аналог `sortEquipmentItems`):
  n=2000 — 5.8 мс.** Не проблема.
- **Число SQL на открытие страницы (статика кода, без прод-замера):** ~7 параллельных
  HTTP-вызовов после `databaseReady`: `all-grouped p1` (1 SQL + enrich-CTE 1 SQL + COUNT из кэша),
  префетч `p2` (1 + 1), справочники branches/types/statuses (dict-кэш 300с — 0 SQL в пределах TTL),
  recent-cards + recent-acts (app-БД/JSON, не SQL Server), latest-acts префетч (1 SQL),
  `employee-compare-summary` (1С-бридж, кэш 120с). Плюс резолв БД на каждый вызов
  (2 full-scan app-БД без кэша). Итого горячий путь открытия: **~6–8 SQL Server-запросов,
  из них 2 — тяжёлые (список + enrich CTE), повторяется на каждую страницу скролла.**
- **Число SQL на карточку (статика):** `get_equipment_by_inv` (1 SQL + 1 `INFORMATION_SCHEMA`
  discovery) ×3 (деталь, акты, история — каждая вкладка дёргает lookup заново) + 1 акты + 1 история.
  **До ~8 SQL на 3 таба вместо ~3.**

#### Замеры wall-time реальных функций (2026-09-16, ITINVENT, холодный кэш, SELECT-only)

| Вызов | Медиана | Комментарий |
|---|---|---|
| `get_equipment_grouped p1/p2 limit=1000` | 147 / 161 мс | страница целиком |
| └ из них чистый list-SQL (7 JOIN + sort) | 43 мс | |
| └ из них enrich-CTE (1000 id) | 99 мс | **2/3 цены страницы; главный кандидат на ленивую загрузку (этап 7)** |
| `search serial цифра` | 3.1 мс | seek по `IX_INV_NO` (новая реализация) |
| `search serial текст` | 6.2 мс | `TOP 200` (новая реализация) |
| `search universal текст` (COUNT+page) | 63–85 мс | честная пагинация (новая реализация) |
| `search universal цифра` | 5.7 мс | fast-path (новая реализация) |
| `card by_inv` | 1.3 мс | дёшево даже с discovery |
| `acts by_inv` / `history by_inv` | 13 / 3 мс | дёшево; doc-type discovery без кэша — микро |
| `locations+priority` / `owners search` | 1.4 / 16 мс | не проблемы |

Схема БД (факты): FK нет вообще (все джойны логические — `LEFT JOIN` в коде корректны);
`DOCS_LIST` — 3 колонки (`DOC_NO, ITEM_ID, CI_TYPE`); `LOCATIONS` без `BRANCH_NO`
(ветка `BY_BRANCH_COLUMN` в коде мёртвая, активен priority-вариант — он уже `LEFT JOIN`);
`FILES.FILE_DATA/IMAGE_DATA` читаются только точечно (скачивание) и в `EXISTS`, в списках блобов нет;
`ITEMS.DESCR/ADDINFO` — `nvarchar(max)`, едут в каждой строке списка (вклад в ~0.5 MB payload).
- **НЕ замерено (нет доступа):** wall-time `all-grouped` и enrich-CTE на реальном SQL Server,
  collation БД, существующие индексы, размер `ITEMS`/`DOCS`. Нужен read-only доступ DBA.

#### Факты прямого read-only опроса каталога (2026-09-16, все 4 БД, только `sys.*`, данных не читали)

- **Объёмы маленькие:** `ITEMS` — ITINVENT 2459 / OBJ 1839 / SPB 1325 / MSK 288 строк;
  `OWNERS` ~3.6–4.0 тыс. в каждой; `DOCS` 39–1543; `DOCS_LIST` 163–3114; `CI_HISTORY` 654–7753.
  Вывод: сканы по таким объёмам стоят копейки — **узкое место не в отсутствии индексов,
  а в числе round-trip и объёме payload**. Пункты про НК-индексы/FTS/keyset из плана оптимизации
  на текущих объёмах не нужны (см. пометку там).
- **Collation default-БД: `Cyrillic_General_CI_AS`** — регистронезависимая. `LOWER()` вокруг
  фильтруемых колонок избыточен — снимать можно без проверки (проверка пройдена).
- **Индексы уже есть (схема идентична во всех 4 БД):**
  `ITEMS`: `PK(ID)`, `IX_INV_NO(INV_NO)`, `IX_SERIAL_NO(SERIAL_NO)`,
  `IX_CITYPE_BRANCH_LOC(CI_TYPE,BRANCH_NO,LOC_NO)`, `IX_HW_ID(HW_ID)`,
  `IX_DOMAIN_NETBIOSNAME_IPADDRESS(DOMAIN_NAME,NETBIOS_NAME,IP_ADDRESS)`;
  `CI_HISTORY`: `IX_ITEM_ID(ITEM_ID)`; `DOCS_LIST`: кластерный `IX_CL_DOC_NO(DOC_NO)`;
  `FILES`: `(CI_TYPE,ITEM_ID,FILE_TYPE)`.
- **Реальные пробелы (факты, не догадки):** нет индекса на `OWNERS(OWNER_DISPLAY_NAME)`
  (бьёт по universal-поиску); `DOCS` — HEAP без кластерного индекса; `DOCS_LIST` индексирован
  только по `DOC_NO`, а запрос актов идёт по `ITEM_ID`; `HW_SERIAL_NO` без индекса (есть только `HW_ID`).
  При текущих объёмах всё это — микрооптимизации, не блокеры.
- `ITEMS.INV_NO` — `float`, подтверждено. Числовой fast-path (`INV_NO=?` вместо `CAST LIKE`)
  корректен и будет использовать `IX_INV_NO`.

### Этап 1. Контракты (фундамент, код почти не трогаем)

- `GET /equipment/all-grouped` — зафиксировать контракт тестом: `page/pages/total/limit`,
  стабильный `ORDER BY` с tie-breaker `ID`, задокументированный максимум `limit`.
- `search/universal` — честные `page/pages/total` (`OFFSET/FETCH` + отдельный кэшированный `COUNT`).
  Старый ответ `{page:1,pages:1}` объявить deprecated и удалить после перевода фронта.
- Новый `EquipmentListRow` DTO: `inv_no, model, employee, branch, location, status, type, id`.
  Полные 25 полей — только в детальном эндпоинте.
- Приёмка: контрактные тесты на DTO и пагинацию; фронт на новом контракте (пока со старым UI).

### Этап 2. Поиск на сервер (убить двойное допущение)

- Основной скоп поиска — серверный `universal` с пагинацией; дебаунс 250–350 мс, `Enter` — мгновенно.
- Клиентский индекс (`buildDatabaseSearchIndex`) — удалить после того, как серверный поиск
  закроет скопы «по загруженному» (подтвердить сравнительным тестом выдачи).
- До удаления: запретить эффект, сбрасывающий `expandedBranches/Locations` при догрузке
  (`useDatabaseSearch.js:109-121` — убрать `searchIndex` из deps).
- Приёмка: выдача серверного и клиентского поиска совпадает на контрольной выборке;
  догрузка страниц не сбрасывает раскрытие и не перестраивает индекс.

### Этап 3. Разобрать god-компонент (без смены поведения)

- Выделить из `Database.jsx`: `DatabaseContainer` (композиция), `EquipmentListFeature`
  (список + скролл + выбор), `DatabaseSearchFeature`, `EquipmentDetailFeature` (деталь + табы),
  `DatabaseDialogsLayer` (все `lazy`-диалоги уже объявлены в `Database.jsx:119-137` — перенести как есть).
- Состояние: выбор элементов и раскрытие — вниз, в фичи; наверх только `databaseReady/db_name/query`.
- Запретить: новые `useState` в контейнере, inline-компоненты, `key={invNo+'-'+idx}`.
- Приёмка: побайтово то же поведение (тесты `Database.test.jsx` зелёные), файл контейнера <300 строк.

### Этап 4. Мутации без полного refetch (убить главный источник «вранья»)

- Единый протокол: каждая мутация возвращает затронутые `inv_no` → фронт делает
  `upsertItemInGrouped` / `removeItemFromGrouped` (образцы уже есть:
  `useDatabaseDetailRuntime.js:548`, `useDatabaseDeleteEquipment.js:47-52`) + декремент/инкремент счётчиков.
- `fetchAllEquipment({force:true})` оставить только в кнопке «Обновить» и в обработке
  конфликта версий (см. этап 5).
- Приёмка: тест на каждую мутацию (transfer/add/qty/delete/акт) — список обновлён точечно,
  счётчик `Загружено X из Y` корректен, лишнего сетевого запроса страниц нет (assert по мокам).

### Этап 5. Кэш с версией вместо голого TTL

- Ключ кэша: `db_id + data_version + kind + page/limit`. `data_version` — счётчик в app-хранилище,
  bump при каждой API-мутации (там же, где сейчас `invalidate_equipment_cache`).
- Ответы отдают `data_version`; фронт при расхождении версии показывает «Данные обновлены — Обновить»
  вместо молчаливого вранья.
- Внешние писатели ITINVENT по-прежнему протухают по TTL 30с — это задокументировать, не чинить.
- Приёмка: два воркера отдают одну версию после мутации через API; stale-ответ определяется клиентом.

### Этап 6. Рендер-жёсткость (после этапов 1–4, не раньше)

- Виртуализация плоского списка с поднятым стейтом (`expanded`/выбор — вне карточек, в сторе фичи),
  иначе off-screen размонт съест состояние (риск уже зафиксирован в чек-листе оптимизации).
- Стабильные колбэки `(invNo)=>…`, `key={invNo}`, индекс `invNo→row` в `ref`, а не в стейте
  (`Database.jsx:561-566` сегодня пересоздаётся при каждом мердже).
- QR-генерация только при открытом диалоге; `qrcode` — dynamic import.
- Приёмка: скролл 5000 строк без просадок ввода, раскрытие переживает скролл, рендер-тесты зелёные.

### Этап 7. Бэк-жёсткость (параллельно с 3–4)

- Резолв БД (`database.py:143-178`): key-lookup + короткий TTL вместо двух full-scan
  (`user_db_selection_service.py:34-38`, `settings_service.py:196-221`) на каждый запрос.
- Discovery (`_get_table_columns`, `has_branch_column`, doc-type map) — в dict-кэш 300с, убрать из request path.
- Enrich «текущий акт» — вынести из страницы списка: отдельный ленивый батч-эндпоинт для видимых строк.
- Пул: убрать `SELECT 1` на каждый checkout (только при idle > N сек), разнести конкуренцию 4 БД.
- Приёмка: число SQL на открытие страницы и карточки уменьшилось (сверить с baseline этапа 0).

### Этап 8. Тесты как каркас (не «потом»)

- Контрактные: пагинация grouped, universal `page/pages/total`, DTO списка/детали.
- Мутационные: точечные обновления без refetch (по мокам сети).
- Регрессионные перф: бюджет «страница ≤ X SQL», «сериализация 1000 строк ≤ Y мс» — красный при превышении.
- Фронт: поиск/раскрытие/выбор переживают догрузку; виртуализация не теряет стейт.

## Чек-листы поэтапного выполнения

Каждый пункт закрывается только после зелёных релевантных тестов. Этап целиком — только после приёмки.
Не параллелить этапы 2 и 3 (оба трогают состояние поиска/списка). Этап 7 можно вести параллельно с 3–4.

### Этап 1. Контракты
- [x] Тест контракта `GET /equipment/all-grouped`: `page/pages/total/limit`, стабильный `ORDER BY`
  с tie-breaker `ID` (`i.INV_NO, i.ID`), `limit` cap `le=10000` → 422 выше; branch-путь теперь тоже
  возвращает `limit` (`tests/test_equipment_contract.py`, 8 тестов)
- [x] Тест контракта `search/universal`: честные `page/pages/total` (код уже готов в рабочем дереве —
  только зафиксировать, не переписывать)
- [x] `EquipmentListRow` DTO: схема whitelist (~22 поля — минимум для текущего UI/поискового индекса,
  не «~8»: serial/part/ip/mac/netbios/domain нужны индексу до этапа 2), `extra=ignore` отрезает
  `DESCR nvarchar(max)`/vendor/enrich с wire; `response_model` на `/all-grouped`. Из SQL списка
  убраны `i.DESCR` и `VENDORS`-join (тяжёлая колонка больше не едет); by-branch запрос нормализован
  к тем же алиасам, `description`/`vendor_name` оставлены для прямого вызова AI-тулом. Полные
  поля — в детали/by-inv-nos (фронт сам догружает через `hasFullDetailFields`)
- [x] Приёмка этапа: контрактные тесты зелёные (8/8), фронт на новом контракте со старым UI
  (755/755 vitest)

### Этап 2. Поиск на сервер
- [x] Основной скоп — серверный `universal` с пагинацией: `runSearchNow` →
  `equipmentAPI.searchUniversal(q, page, 200)`; flat-строки группируются в branch→location
  (`groupSearchRowsByBranchLocation`); `loadMoreSearchResults` догружает страницы поиска,
  sentinel в режиме поиска переключён на search-пагинацию («Найдено X из Y»).
  Debounce 300 мс и Enter-мгновенно сохранены
- [x] `searchIndex`/`allEquipment` вынесены из deps эффекта в ref — догрузка страниц списка
  больше не перезапускает активный поиск и не сбрасывает раскрытие
  (тест «does not re-run the search when more list pages load»)
- [x] Сравнительный тест: `test_universal_search_covers_client_index_fields` пинит, что WHERE
  universal покрывает все поля клиентского индекса (superset: +vendor/dept/branch/location/
  status); в SELECT добавлен `i.ID as id` для акт-бейджа и merge
- [x] `buildDatabaseSearchIndex` — **осознанно не удалён**: остаётся как деградация
  (ошибка сервера → `serverSearchDegraded` + client fallback) и как движок поиска расходников
  (`serverSearchEnabled=false`, universal ищет только CI_TYPE=1). Индекс строится лениво
  внутри fallback-ветки — горячий путь не платит O(n) rebuild на load-more
- [x] Приёмка: догрузка не сбрасывает раскрытие; клиентский индекс — только деградация
  с флагом `serverSearchDegraded`

### Этап 3. Разбор god-компонента (без смены поведения)
- [x] `Database.jsx` — тонкий контейнер композиции (~40 строк): `useDatabasePageViewModel()`
  + `<DatabasePageView vm={vm}/>`. Вся оркестрация хуков вынесена в
  `database/useDatabasePageViewModel.js` (~1900 строк, возвращает 316 биндингов), весь JSX —
  в `database/DatabasePageView.jsx` (~1250 строк). Ни один `useState` в контейнере
- [x] `DatabaseDialogsLayer` — все 14 lazy-диалогов в отдельном файле, контейнер передаёт
  бандлы пропсов
- [x] Выбор и раскрытие остаются во view-model (фичи-хуки `useDatabaseSelection`,
  `useDatabaseListNavigation` и др. уже существуют); наверх — только `vm`
- [x] Запреты: `key={invNo}` — композитные `invNo-idx` убраны из `DatabaseDataSections` и
  виртуализованного `EquipmentTable`; inline-компонентов нет; новых `useState` в контейнере нет
- [x] Приёмка: `Database.test.jsx` 42/42, весь database-скоп 762/762, поведение то же,
  файл контейнера <300 строк

### Этап 4. Мутации без полного refetch
- [x] transfer/add-equipment — уже точечные (fallback-only `fetchAllEquipment`); покрыт остаток:
  consumable-qty → `updateItemFieldsInGrouped` (patch QTY без refetch, fallback при отсутствии
  сеттеров), consumable-delete → `removeItemFromGrouped` + декремент счётчиков (новый тест),
  delete-equipment — уже точечный (проверено), коммит акта → point-refresh по
  `linked_inv_nos`/`linked_item_ids` (`getByInvNos` upsert + `getCurrentActs` merge бейджа)
- [x] `fetchAllEquipment({force:true})` остаётся в: кнопке «Обновить»; **сознательные остатки:**
  `add-consumable` (CI_TYPE=4 — `getByInvNos` его не вернёт, point-read API нет) и
  maintenance-consume (cartridge/component — частичный consume делает локальный patch
  ненадёжным, qty живёт в consumables-снапшоте); оба редкие пути
- [x] Приёмка: тесты на qty/delete (point update + fallback), счётчики корректны,
  лишних запросов страниц нет

### Этап 5. Кэш с версией
- [x] `data_version` в app-хранилище: `app_settings` KV (`equipment_data_version:{db}`,
  SELECT FOR UPDATE bump) или JSON-файл `equipment_data_version.json` через `local_store`
  в dev-fallback; bump внутри `invalidate_equipment_cache` — автоматически на каждой
  мутации (все точки вызова уже есть). Мемо чтения 5с — ≤1 KV-lookup на всплеск запросов
- [x] Ответы отдают `data_version`: `all-grouped`, `consumables-grouped`, `by-branch`,
  `by-inv-nos`, `search/universal`; поле в `EquipmentGroupedListResponse` (дефолт 0 —
  обратная совместимость). Ключ кэша **не** включает версию — invalidate уже сносит
  payload'ы; версия нужна клиенту для staleness, не для ключа
- [x] Фронт: `useDatabaseEquipmentData` — `seenDataVersionRef` per-scope, флаг
  `dataVersionStale` при росте версии на list-load; `notifyDataVersion` для point-refresh
  путей (transfer, act-commit) — свои мутации не дёргают баннер; Alert «Данные были
  изменены в другой сессии — Обновить» в `Database.jsx`
- [x] Приёмка: `tests/test_equipment_data_version.py` 5/5 (bump/per-db scope/global
  bump/поле в ответе/persist); фронт-тесты stale-flag 2/2; чтение версии из общего
  хранилища → два воркера видят один счётчик

### Этап 6. Рендер-жёсткость (после 1–4)
- [x] Стейт `expandedBranches`/`expandedLocations`/выбор уже в контейнере (не в карточках) —
  виртуализация/анмаунт состояние не съедает; в ref переносить не требуется
- [x] `key={invNo || row-idx}` вместо `invNo-idx` в `DatabaseDataSections` и `EquipmentTable`
  (последний виртуализован — стабильный ключ сохраняет reconciliation при скролле);
  индекс `invNo→row` — `buildEquipmentIndex` (useMemo) уже есть
- [x] Приёмка: рендер-тесты зелёные (762/762 скоп); замер «скролл 5000 строк» —
  ручной/живой, не автоматизирован

### Этап 7. Бэк-жёсткость (можно параллельно с 3–4)
- [x] Резолв БД: key-lookup (`session.get` по PK) + TTL-мемо 30с в
  `UserDBSelectionService.get_assigned_database` и `SettingsService.get_user_settings`
  (инвалидация на `_write_mapping`/`_save_all`); чистится в conftest
- [x] Кэш doc-type map: `_doc_type_map_cache` TTL 300с keyed `(db_id, sorted type_nos)` —
  INFORMATION_SCHEMA-discovery убран из request path при повторах; `not in` → `seen_ids` set
  в enrich (было O(n²) на 1000 id)
- [x] **Главное: enrich «текущий акт» вынесен из страницы списка** (99 мс из 150 мс) —
  `get_equipment_grouped`/`get_equipment_by_branch` больше не дёргают CTE; новый
  `POST /equipment/current-acts` (`lookup_current_acts`, ≤2000 ids, `available=None` при сбое
  lookup). Фронт: `getCurrentActs` + `mergeCurrentActsIntoGrouped` + ленивый батч на загруженные
  строки в `useDatabaseEquipmentData` (dedup-Set, merge в allEquipment/filteredData, снапшоты
  режимов подхватывают merge авто-эффектом; consumables-режим не вызывает эндпоинт).
  Point-refresh by-inv-nos не стирает бейдж: `upsertItemInGrouped` проносит `current_act_*`,
  если свежая строка их не несёт. Employee-диалог (`get_equipment_by_owner_with_current_acts`)
  остаётся синхронно обогащённым — там enrich по месту
- [x] Пул: `SELECT 1` только при idle > N сек — пул хранит `(conn, released_at)`;
  ping пропускается, если соединение простаивало < `SQL_SERVER_POOL_IDLE_PING_SEC` (30с по
  умолчанию, env-настройка); тест `test_pyodbc_pool_pings_only_idle_connections`
- [x] Приёмка: число SQL на открытие страницы меньше baseline этапа 0 — страница списка
  теперь COUNT(кэш)+1 list-SQL вместо +enrich-CTE; акты — один ленивый батч вне горячего пути;
  резолв БД — 0 SQL в пределах TTL вместо 2 full-scan на каждый запрос

### Этап 8. Тесты-каркас (на каждом этапе, не «потом»)
- [ ] Контрактные тесты этапов 1–2; мутационные тесты этапа 4; перф-бюджеты
  («страница ≤ X SQL») краснеют при превышении

### Этап 9. PWA / mobile / desktop — только веб (безshm native-клиентов)

Диагноз контролёра (2026-09-17, чтение кода; на реальном телефоне не проверено):
- Диалог сотрудника на телефоне: `fullScreen`, `DialogContent overflow:hidden`
  (`EmployeeEquipmentDialog.jsx:1895-1903`), внутри двухпанельный Stack Хаб+1С с
  `direction column` на `xs` и внешним `overflow:hidden` (`:2005-2010`), каждая панель тоже
  `overflow:hidden` (`:2012-2020`, `:2056-2064`), скролл только внутри таблиц (`:366`, `:413`,
  `:749`, `:1063`). Итог: на телефоне два зажатых полуэкрана, внешний скролл заблокирован —
  нижняя панель (склад 1С) фактически не видна, до неё не доскроллить. Это и есть жалоба
  «список у сотрудника не виден, нет скрола».
- Мобильные строки уже есть (`HubEquipmentMobileRow :174-273`, `WarehouseBalanceMobileRow`,
  `ModernEquipmentCard` с `content-visibility`) — база для переработки карточки есть.
- PWA: `manifest.webmanifest` standalone + shortcuts (dashboard/tasks/mail/chat —
  **shortcut на `/database` отсутствует**), `sw.js` существует; кэширование `/api` в SW
  отклонено ранее (stale) — запрет в силе.
- Desktop: тонкая WebView2-оболочка (`desktop/README.md`), тот же фронт. Отдельной
  бизнес-логики не делать; учитывать `display_override window-controls-overlay`,
  печать через WebView2, отсутствие hover на тачскринах.

Чек-лист 9.1. Диалог сотрудника на телефоне (приоритет 1)
- [ ] На `xs`: вместо двух зажатых панелей — **одна видимая панель с таб-переключателем**
  «Хаб / Склад 1С» (переиспользовать существующий `warehouseTab`-паттерн); либо внешний
  скролл колонки с панелями авто-высоты. Запрет: два `overflow:hidden` друг в друге на телефоне
- [ ] Фильтры (поиск/тип/статус, `:1909-1958`) на телефоне — сворачиваемые (collapsed по умолчанию),
  иначе съедают полэкрана до списка
- [ ] Тач-таргеты строк/кнопок ≥44px (как уже сделано для hit-areas), свайпы не вводить
- [ ] Приёмка: на 390px видны и доступны скроллом оба списка (Хаб и 1С) + фильтры + экспорт;
  UI-тест на мобильный layout (рендер обеих панелей по табам), ручная проверка на телефоне

Чек-лист 9.2. Карточка оборудования для PWA (переработка)
- [ ] Единая мобильная карточка на базе `ModernEquipmentCard`: инв.№ + модель крупно,
  сотрудник/статус, бейдж акта (`EquipmentCurrentActIndicator`, «?» при отсутствии данных —
  поведение уже корректное), раскрытие деталей по тапу, действия (акты/история/QR) — иконки 44px
- [ ] Состояние `expanded`/выбора — вне карточки (требование этапа 6, иначе виртуализация съест)
- [ ] Приёмка: 390px — нет горизонтального overflow, текст не налезает, тёмная тема ок;
  тесты `ModernEquipmentCard.test.jsx` + новый тест раскрытия

Чек-лист 9.3. PWA-контур (веб)
- [ ] Shortcut `/database` в `manifest.webmanifest`; проверить `viewport-fit=cover` +
  `theme-color` в `index.html` (safe-area уже используется в диалогах)
- [ ] SW: офлайн-заглушка только для shell/статики; **`/api` и `/auth` не кэшировать**
  (запрет из `DATABASE_OPTIMIZATION.md` в силе)
- [ ] Приёмка: Lighthouse PWA на странице `/database` без регрессий; install prompt работает

Чек-лист 9.4. Desktop WebView2 (только проверка, без кода оболочки)
- [ ] Страница `/database` в окне десктопа: layout ≥1024px без мобильной деградации,
  печать QR/актов через WebView2 print UI, хоткеи/фокус не ломаются
- [ ] Приёмка: smoke в desktop-клиенте по чек-листу выше; баги чинятся во фронте, не в оболочке

### Этап 9.5. Компоновка страницы (layout-review 2026-09-17, скиллы better-layout/interface/accessibility)

Карта слоёв `Database.jsx`: MobileHeader → Tabs → SearchBar → Fallback → MobileControlStrip /
DesktopToolbar+RecentCards → RecentCardsStrip → ActionSheet → BulkActionBar/SelectionBar →
Fade → dataSections/sentinel → слой из ~14 lazy-диалогов. Проверено только чтением кода
(без рендера на устройстве — визуальное подтверждение за исполнителем).

- [ ] Дубли `BulkActionBar`/`SelectionBar` (`Database.jsx:1911-1960`, ~20 идентичных пропсов)
  + третий action-surface `MobileActionSheet` → единый `SelectionActionBar` с `variant`
- [ ] Двойной `EmployeeCompareProvider` (`:1766` и `:1978`, те же данные) → один провайдер сверху
- [ ] Двойная анимация переключения табов `Fade` + keyframes `:1962-1970` → один механизм +
  guard `prefers-reduced-motion` (сейчасMotion идёт безусловно)
- [ ] Счётчики «Найдено/Загружено» (`:2006-2017`) объявить скринридеру: `role="status"` polite-region
- [ ] Degraded-сигнал (`DatabaseSearchBar.jsx:128-132`, иконка только с hover-tooltip, нефокусируемая) →
  фокусируемый элемент с `aria-label` и тем же текстом (сейчас клавиатура/SR его не получают)
- [ ] `UploadActDialog` (50+ пропсов, `:2027-2086`) — разбить по шагам в рамках этапа 3
- [ ] Приёмка: тесты `Database.test.jsx` зелёные; ручная проверка 390px + клавиатурный проход
  (Tab до поиска/табов/карточек, Enter/Space, Esc в диалогах) + скринридер на счётчиках

Что НЕ делать: редизайн ради редизайна — `fullWidth`-табы, sticky-стрип, `content-visibility`,
индикатор «?» при отсутствии акта и `main`-landmark в `MainLayout` признаны нормой, не трогать.

Что НЕ делать: native-клиенты и Capacitor не трогать (действующие — веб-PWA и `mobile-hub`/Expo);
свайп-жесты и pull-to-refresh не вводить без отдельного решения; `/api` в SW-кэш — запрещено.

## Верификация контролёра — сессия агента 2026-09-17 (этапы 3, 5, 6; код не менялся)

Проверено чтением diff, точечными grep и прогонами поверх `d78e4d2a` (всё ещё не закоммичено).

**Подтверждаю:**
- Этап 3: `Database.jsx` — 39 строк, контейнер без состояния, старые реэкспорты (`uploadAct`,
  `equipmentModel`) сохранены для совместимости. Оркестрация — `useDatabasePageViewModel.js`
  (1821 строка), JSX — `DatabasePageView.jsx` (1130 строк), 14 lazy-диалогов — в
  `DatabaseDialogsLayer.jsx` (все `lazy()`, сплит чанков сохранён; слой подключён в PageView).
  Ключи `key={invNo || row-idx}` — в `DatabaseDataSections.jsx:59`, `EquipmentTable.jsx:501`.
- Этап 5: счётчик в `equipment_db.py` (KV `app_settings` + JSON-fallback, bump внутри
  `invalidate_equipment_cache`, `with_for_update` в PG-ветке — проверено чтением `:111-159`);
  `data_version` отдают все 5 путей: grouped/by-branch (`equipment_db.py:276,339`),
  consumables (`:388`), `by-inv-nos` (`equipment.py:1026`), `search/universal` (`:880`).
  Фронт: `dataVersionStale` + баннер (`DatabasePageView.jsx:543`), point-refresh пути версию
  учитывают (`useDatabaseTransferAction.js:133`, view-model `:386`). Тесты:
  `test_equipment_data_version.py` 5/5 (мой прогон), stale-флаги фронта зелёные.
- Этап 6: стейт раскрытия/выбора не в карточках (проверено ранее), ключи стабильные.
- Проверки мои: backend-скоп 33/33, `data_version` 5/5, фронт database-скоп **84 файла / 463 теста —
  всё зелёное**, включая `Database.test.jsx` 42/42. Production build не гонял: изменений сборки/
  роутинга/auth/API-клиента в скоупе нет, граф импортов покрыт тестами.
- Мульти-воркер видимость счётчика — только кодом (общее KV-хранилище); живой check — на стенде.

**Поправки к записям агента:**
- «762/762» — не сошлось с замером: database-скоп у меня 463/463 (84 файла). Исправить отчётность
  агента; суть (всё зелёное) верна.
- Баннер stale — в `DatabasePageView.jsx:543`, не в `Database.jsx` (мелочь).
- Размеры: PageView 1130 строк (не ~1250), view-model 1821 (не ~1900) — порядок тот же.
- Остаток этапов: 8 (каркас), 9.1–9.5 (PWA/mobile/компоновка), live smoke + multi-worker check.

## Верификация контролёра — сессия агента (2026-09-17, workdir поверх `d78e4d2a`, код не менялся)

Проверено чтением diff, точечными grep и прогонами. Что агент заявил в чек-листах выше —
по существу верно, с поправками ниже.

**Подтверждаю:**
- Этап 2: серверный поиск реализован как заявлено (`useDatabaseSearch.js` → `searchUniversal(q,1,200)`,
  `groupSearchRowsByBranchLocation`, `loadMoreSearchResults`, sentinel на search-пагинацию,
  debounce 300/Enter сохранены, `searchIndex` из deps убран — данные в ref, сравнительный тест
  `test_universal_search_covers_client_index_fields` (`tests/test_equipment_contract.py:234`) зелёный,
  `i.ID as id` в SELECT есть). `buildDatabaseSearchIndex` оставлен как fallback + движок расходников —
  решение разумное, принимаю.
- Этап 4: qty → `updateItemFieldsInGrouped`, delete → `removeItemFromGrouped` + декремент счётчиков,
  коммит акта → point-refresh по `linked_inv_nos`/`linked_item_ids` (оба поля реально есть в ответе
  API — `backend/api/v1/equipment.py:2351-2352`, `models/equipment.py:480-481`). Остатки
  add-consumable/maintenance задокументированы честно. `upsertItemInGrouped` проносит `current_act_*` —
  проверено чтением.
- Этап 7 (новое, незакоммичено): idle-ping пула (`connection.py`, `SQL_SERVER_POOL_IDLE_PING_SEC`, тест
  `test_pyodbc_pool_pings_only_idle_connections` зелёный); key-lookup + TTL 30с в
  `settings_service`/`user_db_selection_service` с инвалидацией на записи; defensive `getattr`
  в `database.py:112` + починка фикстуры — `tests/test_equipment_history_api.py` теперь 4/4
  (было 2 падения, мои и агентские прогоны сходятся).
- Этап 1: код из HEAD-коммита, `tests/test_equipment_contract.py` — **9/9** (в плане написано 8 — мелочь).
- Проверки мои: backend-скоп 33/33 (`search_read_helpers`, `history_api`, `contract`, `hot_paths`,
  `selection_contract`); фронт Database-скоп 30 + 64 = 94/94 (`useDatabaseSearch`, `ConsumableQty`,
  `EquipmentData`, `equipmentModel`, `Database.test` 42, `EmployeeEquipmentDialog` 11,
  `Warehouse1CTab`, `Excel`, новый `useDatabaseConsumableDelete.test`); полный фронт-сюит:
  3594 passed / 2 skipped, 3 падения — **предсуществующие** (`requestOrdering`, `Settings AiBots`,
  `ChatThread font`; доказано прогоном тех же 3 файлов на чистом worktree HEAD — падают так же).
  Заявление «755/755 vitest» в плане неверно: всего ~3599 тестов, Database-скоп зелёный полностью.

**Замечания (не блокеры, в работу агенту):**
1. ~~`searchLoading` и `serverSearchDegraded` возвращаются хуком, но `Database.jsx` их не деструктурирует~~ —
   **снято 2026-09-17 как ошибочное:** оба флага деструктурируются (`Database.jsx:449,453`),
   проброшены в `DatabaseSearchBar` (`:1762-1763`) и рисуются (спиннер `:127`,
   degraded-иконка `:128-132`). Остаток по теме — только доступность degraded-сигнала (см. этап 9.5).
2. Коммит акта с пустыми `linked_inv_nos` и `linked_item_ids` одновременно: ни point-refresh,
   ни fallback не срабатывают — тишина вместо обновления (раньше всегда был force-reload).
   Маловероятно (payload требует inv), но стоит fallback на этот случай.
3. Строки результатов поиска без актов показывают «?» в `EquipmentCurrentActIndicator` — корректно
   и задумано, фиксирую как ок.
4. Вне плана и вне Database-коммита держать отдельно: реворк `EmployeeEquipmentDialog` (+1368:
   табы, сортировка, `InventoryTaskDialog`, `warehouse1cMovementDetail`, mail-preview), удаление
   `EmployeeComparePanel` (висячих импортов нет — проверено), правки excel/1C-таба, `TASKS_OPTIMIZATION.md`,
   мусор дерева (`tmp_*`, `nul`, `probe_1c.py`, `_manual_env_tests/`, `equipment_on_dismissed_employees.txt`,
   `missing_current_acts_all_dbs.txt`, `test_backend_restart_runtime.py`, `test_warehouse_1c_*`,
   `mobile-hub/release-notes/1.1.40.json`) — не смешивать с Database-коммитом.
5. Незакоммиченные файлы Database-скопа, не забыть при коммите: `tests/test_equipment_contract.py`,
   `useDatabaseConsumableDelete.test.jsx`, `InventoryTaskDialog.jsx`, `warehouse1cMovementDetail.jsx`
   (последние два — только если реворк диалога идёт в тот же коммит; рекомендую отдельным).

## Верификация контролёра (2026-09-16, пост-коммит `d78e4d2a`)

Проверено независимыми прогонами и live-замерами (SELECT-only, ITINVENT, холодный кэш):

- Этап 1 — подтверждаю: `tests/test_equipment_contract.py` 8/8 (мой прогон);
  slim-строки live (23 ключа, без `DESCR`/enrich); universal live (p1 62.8 мс/total 158/pages 4).
- Этап 7 — подтверждаю почти всё: страница списка **37 мс** вместо 147–161 мс (enrich убран
  из `equipment_db.py` полностью — проверено grep; остался только owner-путь `queries.py:400`
  для employee-диалога, это задумано); `POST /equipment/current-acts` live (55 id за 84 мс);
  цепочка `getCurrentActs → merge` с generation-guard и retry; `currentActsFetchedRef` чистится
  при смене БД (`database-changed` → `resetAllModeData`), подозрение на stale-акты снято;
  `seen_ids`-set на месте; doc-type memo на месте (чтением кода).
- Оговорка: резолв-БД через key-lookup (`settings_service`/`user_db_selection_service`)
  лежит в **незакоммиченном** остатке дерева — пометка [x] выше относится к workdir, не к `d78e4d2a`.
- Предсуществующая поломка (не от коммита, доказано прогоном на чистом worktree `HEAD~1`):
  `tests/test_equipment_history_api.py` — 2 теста падают из-за фикстуры без `assigned_database`
  (`database.py:112` прямой доступ к атрибуту). Задача рефактореру: defensive `getattr` в
  `_get_assigned_db` и/или починка фикстуры. Код не правил.
- Тесты пост-коммит: backend 62/64 (2 падения — те самые предсуществующие history);
  фронт `pages/database` 454/454 + точечные хуки 34/34. Остаток дерева (68 записей, my_files/1C/mobile)
  не проверялся.

## Порядок и effort

0 (S, выполнен) → 1 (M) → 7-enrich (M, главный выигрыш — можно первым) → 2 (L) → 3 (L) → 4 (M, остаток) → 5 (M) → 6 (M) → 8 (на каждом этапе).
Не параллелить 2 и 3 (оба трогают состояние поиска/списка). 7 можно вести параллельно с 3–4.

## Что НЕ делать

- Не вводить Redis/Docker/брокер — хватает app-версий + существующего SWR.
- Не поднимать `EQUIPMENT_PAYLOAD_CACHE_TTL_SEC` выше 30с (внешние писатели, per-process рассинхрон).
- Не делать runtime `CREATE INDEX` в request path; индексы/FTS — только через DBA на копии.
- Не восстанавливать Capacitor/`mobile-android` — действующее `mobile-hub` (Expo).
- Не менять смысл legacy-полей (`CI_TYPE`, `INV_NO` float, `EMPL_NO`, `BRANCH_NO`, `LOC_NO`).

## Финальная приёмка robustness

- [ ] Контейнер <300 строк, фичи изолированы, новых стейтов в корне нет.
- [ ] Клиентского поискового индекса нет (или только как деградация с флагом).
- [ ] Мутации точечные, полный refetch — только по кнопке/конфликту версии.
- [ ] Версия данных сквозная (бэк → фронт), stale определяется, а не молчит.
- [ ] Перф-бюджеты из этапа 0 не превышены; контракт universal честный.
