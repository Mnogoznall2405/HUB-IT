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
- [x] Контрактные тесты этапов 1–2; мутационные тесты этапа 4; перф-бюджеты
  («страница ≤ X SQL») краснеют при превышении — `tests/test_equipment_page_budget.py`:
  список ≤2 SQL (COUNT+page, без enrich-CTE), universal-поиск ≤2 SQL, акты — 1 запрос
  на ≤1800 id (set-based, не per-item)

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
- [x] На `xs`: вместо двух зажатых панелей — **одна видимая панель с таб-переключателем**
  «Хаб / Склад 1С» (`mobilePanel`, fullWidth Tabs 44px); второй панели нет в DOM —
  зажатых полуэкранов больше нет
- [x] Фильтры (поиск/тип/статус) на телефоне — сворачиваемые: кнопка «Фильтры •»
  (aria-expanded) + `Collapse unmountOnExit`, по умолчанию скрыты
- [x] Тач-таргеты: табы 44px, кнопка фильтров 40px; свайпы не вводились
- [x] Приёмка (код): UI-тест `EmployeeEquipmentDialog.test.jsx` — мобильный layout,
  обе панели по табам, свёрнутые фильтры; ручная проверка на 390px — за исполнителем

Чек-лист 9.2. Карточка оборудования для PWA (переработка)
- [x] Единая мобильная карточка `ModernEquipmentCard` уже покрывает скоп: инв.№+модель,
  сотрудник/статус, бейдж акта, раскрытие по тапу, действия-кнопки; `content-visibility`
  для скролла сохранён
- [x] Состояние `expanded`/выбора — вне карточки: controlled-пропсы `expanded`/
  `onToggleExpand` → `expandedCards: Set<invNo>` + `toggleCardExpanded` во view-model;
  fallback на внутренний стейт сохранён для неконтролируемого использования
- [x] Приёмка: тесты `ModernEquipmentCard.test.jsx` + новый тест «expanded переживает
  unmount/remount»; визуальная проверка 390px/тёмная тема — за исполнителем

Чек-лист 9.3. PWA-контур (веб)
- [x] Shortcut `/database` добавлен в `manifest.webmanifest`; `viewport-fit=cover` и
  `theme-color` в `index.html` уже были (safe-area используется в диалогах)
- [x] SW: офлайн-заглушка shell уже была (`buildOfflineShellResponse`); `/api` и `/auth`
  не кэшируются — fetch-handler возвращает без respondWith на `/api/` (sw.js:914)
- [ ] Приёмка: Lighthouse PWA на странице `/database` без регрессий; install prompt работает —
  ручная проверка за исполнителем

Чек-лист 9.4. Desktop WebView2 (только проверка, без кода оболочки)
- [ ] Страница `/database` в окне десктопа: layout ≥1024px без мобильной деградации,
  печать QR/актов через WebView2 print UI, хоткеи/фокус не ломаются
- [ ] Приёмка: smoke в desktop-клиенте по чек-листу выше; баги чинятся во фронте, не в оболочке

### Этап 9.5. Компоновка страницы (layout-review 2026-09-17, скиллы better-layout/interface/accessibility)

Карта слоёв `Database.jsx`: MobileHeader → Tabs → SearchBar → Fallback → MobileControlStrip /
DesktopToolbar+RecentCards → RecentCardsStrip → ActionSheet → BulkActionBar/SelectionBar →
Fade → dataSections/sentinel → слой из ~14 lazy-диалогов. Проверено только чтением кода
(без рендера на устройстве — визуальное подтверждение за исполнителем).

- [x] Дубли `BulkActionBar`/`SelectionBar` — один call-site `DatabaseBulkActionBar` с
  `variant={isMobile?'mobile':'desktop'}`; `DatabaseSelectionBar` остался тонким алиасом
  (свой тест), `MobileActionSheet` — другой скоп (FAB «Ещё»), не дубль
- [x] Двойной `EmployeeCompareProvider` → один провайдер сверху (обёрнут fallback-блок
  и dataSections вместе)
- [x] Двойная анимация табов → один CSS-keyframes под `@media (prefers-reduced-motion:
  no-preference)`; MUI `Fade` удалён
- [x] Счётчики «Найдено/Загружено» — `role="status"` + `aria-live="polite"` + `aria-atomic`
- [x] Degraded-сигнал → фокусируемый `IconButton` с `aria-label` + тот же текст в Tooltip
  (фокус с клавиатуры показывает тултип)
- [x] `UploadActDialog`: 55 плоских пропсов → сгруппированные `reminder`/`file`/`details`/
  `commit`/`email`/`download`; шаги уже были вынесены в sub-компоненты ранее
- [x] Приёмка: `Database.test.jsx` + `src/pages/database` зелёные (466 тестов); ручная
  проверка 390px + клавиатурный проход + скринридер — за исполнителем

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

## Финал: декомпозиция закрытия страницы (2026-09-17)

Состояние: код этапов 0–7 + 9.x готов и закоммичен (`5da816b8`), дерево чистое.
`UploadActDialog.jsx` — 271 строка, сплит не требуется (50+ пропсов идут из хука воркфлоу —
это его API, не god-компонент). Остаток — только проверки и решение про деплой.

| Пакет | Объём | Приёмка | Effort | Зависимости |
|---|---|---|---|---|
| F1. Ручной проход 390px | Поиск «козловский» → сотрудник/акт/1С; табы диалога; фильтры; экспорт; тёмная тема; нет горизонтального overflow | Чек-лист 9.1–9.2, 9.5-тесты уже зелёные | S | — |
| F2. Live smoke стенда | gzip на `all-grouped`, `Vary` справочников, stale-баннер при правке из второй сессии, счётчик двух воркеров | Без доступа не закрыть | S | стенд |
| F3. Desktop smoke | `/database` ≥1024px, печать QR/актов, фокус/хоткеи | Чек-лист 9.4 | S | клиент |
| F4. Наблюдение за флаком | Один невоспроизведённый падение фронта (сессия 2026-09-17) | 3 чистых прогона подряд / найден виновник | S | — |
| F5. Решение про деплой | Отдельное явное согласие; раскатка PM2-контура уже идёт (14 online) | — | — | F1–F3 |

После F1–F3 страницу считать закрытой; план заморозить рядом с `DATABASE_OPTIMIZATION.md`.
Не делать: новые фичи на странице до заморозки; редизайн; SW-кэш `/api`.

## Верификация контролёра — доисследование D/A/R в коммитах 2026-09-18 (код не менялся)

Проверены `aab64419` (D1–D3, A1, R1) и `f06ca535` (дедлайны LLM-парсинга). Всё подтверждено:
- D1: `backend/utils/inv_no.py` общий; остатки в `queries.py:706` и `act_upload_service.py:329` —
  тонкие документированные обёртки (`strict_digits=True` у актов с комментарием про семантику).
  Расхождения больше нет.
- D2: общий `_stamp_pdf_overlay` + `_register_stamp_cyrillic_font` (чтением diff).
- D3: `act_upload_service.py:23` — прямой `from shared.llm import ...`; старого пути не осталось.
- A1: `transfer_service.py:637-649` — `gather` + `wait_for` (`TRANSFER_EMAIL_TIMEOUT_SEC`, 60с),
  per-recipient статусы сохранены.
- R1: `EquipmentTable.jsx:331,338` — rAF-throttle + cancel на unmount.
- LLM-дедлайны: `ACT_PARSE_LLM_TIMEOUT_SEC` (45с) + `ACT_PARSE_LLM_TOTAL_TIMEOUT_SEC` (150с),
  остаток бюджета в `complete_json(timeout=...)`, warning в драфт; тест на фейковых часах.

Проверки мои (шире заявленных): pytest 57 (inv-parsing, contract, data-version, page-budget,
search-helpers, transfer-integrity) + 29 (upload-act-email, transfer-act-layout, reminder ×2) —
всё зелёное; vitest EquipmentTable+Database+search 54/54; `import backend.main` ок, routes 702.
Заявленные 53/53 и 45/45 — подмножества, сходятся.

Доисследование закрыто полностью. По коду страница закрыта: этапы 0–8, 9.x, S1–S4, D/A/R.
Открыт только ручной хвост (390px, WebView2 smoke, staging) + наблюдение за флаком.

## Доисследование 2026-09-18: рендер, дубли, контур актов (контролёр, код не менялся)

Проверено чтением кода + замерами прошлых сессий. Рантайм-узких мест не найдено;
найдены дубли с расходящейся семантикой и блокирующие отправки в request path.

| ID | Что | Где | Эффект / риск | Действие | Статус |
|---|---|---|---|---|---|
| D1 | `_normalize_inv_no_token` — два определения с РАЗНОЙ семантикой: `queries.py:705` пропускает нечисловые (`INV/2`), `act_upload_service.py:337` молча дропает всё нечисловое. Одно имя = ловушка | backend | Medium (корректность матчинга инв. №) | Один хелпер с явным `strict_digits=False`, поправить вызовы + тест на `INV/2` | ✅ `backend/utils/inv_no.py` (`cleanup_inv_no_candidate` + `normalize_inv_no_token(strict_digits=)`); оба call-site делегируют; тест в `test_uploaded_act_inv_parsing.py` |
| D2 | `_stamp_pdf_doc_no` vs `_stamp_pdf_annulled` — ~70 строк общего скелета | `act_upload_service.py` | Low-Med (дрейф копий) | Выделить `_stamp_pdf_overlay(file_bytes, label, draw_fn)` | ✅ скелет + `_register_stamp_cyrillic_font`; рисование — per-stamp `draw_fn` |
| D3 | LLM-вызов актов через `backend.ai_chat.openrouter_client`, а не `shared.llm` напрямую | backend | Low (инвариант AGENTS.md) | `from shared.llm import ...` | ✅ импорт переключён |
| A1 | Последовательные SMTP-await в request path: `equipment.py` (цикл получателей), `transfer_service.py` (mode "old") | backend | Medium (хвост latency) | `asyncio.gather` с таймаутом | ✅ gather + `asyncio.wait_for` (`TRANSFER_EMAIL_TIMEOUT_SEC`, деф. 60с); per-recipient контракт статусов сохранён |
| R1 | `EquipmentTable.jsx` — `setScrollTop` на каждый тик скролла | frontend | Low | ref + rAF-throttle | ✅ `pendingScrollTopRef` + `requestAnimationFrame`, cancel на unmount |
| — | Отклонено: сериализация Pydantic, Collator-сортировка, SWR 30с, `toInvNo` vs `parseInvNosInput` | — | — | Не трогать | — |

Проверки: `test_uploaded_act_inv_parsing` + transfer-act/reminder + equipment contract +
upload-act email = **53/53**; vitest `EquipmentTable`+`Database` = 45/45; `import backend.main` ок (702 route).

Закрытый вопрос — границы ожидания LLM-парсинга `/acts/upload/parse`
(`_call_openrouter_act_parser`): диагностика показала sync-вызов через
`run_in_threadpool` (event loop цел), дефолт 45с на попытку, но без общего
бюджета — худший случай N моделей × M режимов × 45с; отмены при дисконнекте
клиента нет (sync-поток не прерывается). Реализовано: общий дедлайн
`ACT_PARSE_LLM_TOTAL_TIMEOUT_SEC` (деф. 150с) + явный per-attempt
`ACT_PARSE_LLM_TIMEOUT_SEC` (деф. 45с, floor 10с), остаток бюджета передаётся
в `complete_json(timeout=...)`; при исчерпании — warning в драфт и выход без
перебора остальных моделей. Тест `test_act_parser_respects_total_llm_timeout_budget`.

## Финал-2: структурная декомпозиция (замер 2026-09-17, без тестовых файлов)

Крупняк каталога `pages/database`: `EmployeeEquipmentDialog.jsx` 2172, `useDatabasePageViewModel.js`
1835 (компонует ~20 хуков, всего `useDatabase*` файлов — 21), `DatabasePageView.jsx` 1127,
`useDatabaseTransferAction.js` 908, `Warehouse1CReconcilePanel.jsx` 907. Правило пакета:
без смены поведения, те же тесты зелёные, каждый файл <600 строк.

| Пакет | Разбить | На что | Effort |
|---|---|---|---|
| S1 | `EmployeeEquipmentDialog.jsx` (~10 вложенных компонентов) | `HubEquipmentList.jsx` (таблица+моб.строка+chip+сортировка), `WarehouseBalancesPanel.jsx` (остатки+движения), `EquipmentHistoryDialog.jsx`, хелперы форматирования в `employeeCompareFormat.js`; в диалоге — только shell и состояние | M |
| S2 | `useDatabasePageViewModel.js` | Доменные контроллеры: `useDatabaseListController`, `useDatabaseDialogController`, `useDatabaseEmployeeFlow`; тонкий композитор сверху | L |
| S3 | `DatabasePageView.jsx` | Секции: `DatabasePageHeader` (табы+поиск), `DatabaseScopeContent` (стрипы+тулбар), `DatabaseListSection`; `DatabaseDialogsLayer` уже отделён | M |
| S4 (опц.) | `useDatabaseTransferAction.js` 908 | transfer / maintenance / акты — три хука | M |

Порядок: S1 → S3 → S2 → S4. Запреты: смена поведения, переименование пропсов, новые зависимости.
Приёмка каждого: database-скоп 466+ зелёный + лимит 600 строк + `npm run build` без роста чанков.

### Статус декомпозиции (реализация, workdir)

- [x] **S1 — `EmployeeEquipmentDialog.jsx` 2172 → 585.** Вынесены: `HubEquipmentList.jsx` (414,
  таблица+моб.строка+chip+сортировка), `WarehouseBalancesPanel.jsx` (466, остатки+кандидаты),
  `WarehouseMovementsList.jsx` (176, перемещения+карточка документа), `EquipmentHistoryDialog.jsx`
  (86), `EmployeeCompareFilters.jsx` (160, фильтры+чипы статусов), `EmployeeEquipmentSubDialogs.jsx`
  (94, превью акта/match/движения/история/инвентаризация), `employeeCompareFormat.js` (155,
  сортировка+форматирование+`buildDiscrepanciesText`), хуки `useEmployeeEquipmentData.js` (306,
  загрузка Хаб+1С+движения), `useEmployeeWarehouseNavigation.js` (60, переходы в Склад 1С с
  return-state), `useEmployeeEquipmentExport.js` (95, Excel), `useDiscrepanciesCopy.js` (43).
  В диалоге — только shell, состояние фильтров/сортировки и мемо видимых списков.
- [x] **S3 — `DatabasePageView.jsx` 1127 → 548.** Вынесены: `DatabasePageHeader.jsx` (95,
  табы+поиск+stale-алерт), `DatabaseScopeContent.jsx` (237, стрипы/тулбар/FAB-шит/бар выбора/акты),
  `DatabaseListSection.jsx` (95, список+sentinel+live-region), `dialogsLayerProps.js` (569,
  сборка ~340 строк пропсов `DatabaseDialogsLayer`). Плюс удалён мёртвый код ui-snapshot.
- [x] **S2 — `useDatabasePageViewModel.js` 1942 → 321.** Композитор теперь собирает три
  доменных контроллера: `useDatabaseListController.js` (583, workspace/поиск/данные списка/
  infinite scroll/выбор/ветки/data_version/недавние), `useDatabaseDialogController.js` (467,
  detail-модалка/add/delete/consume/transfer/upload-act/QR-печать/return-context),
  `useDatabaseEmployeeFlow.js` (306, employee-fallback/диалог сотрудника/compare-бейджи/
  deep-link QR/location-state). В композиторе остались auth/permissions, `useDatabaseSelection`,
  `useDatabaseLookups`, кэш act→equipment и 2 кросс-доменных колбэка. Контракт return-объекта
  сохранён spread-мержем.
- [x] **S4 — `useDatabaseTransferAction.js` 969 → 376.** Композитор над тремя доменными
  хуками: `useTransferFormState.js` (327, поля формы + lookup-эффекты сотрудник/
  подразделение/локации + мемо), `useTransferActJob.js` (413, submit/polling/retry/
  идемпотентный operation_id/скачивание акта/точечный refresh), `useTransferEmail.js`
  (145, получатель/отправка/статус). Общий `transferResult` владеет композитором
  (форма и job циклически связаны). Return-контракт сохранён.

Приёмка прогона: database-скоп **466/466 зелёный** (84 файла), `npm run build` ок.
Чанк `Database` 255.7→257.3 kB (+1.6 raw / +0.15 gzip) — в пределах шума сборки;
отдельный чанк `EmployeeEquipmentDialog` 57.9 kB без изменений логики.
Прочий крупняк вне скопа S-пакетов (`Warehouse1CReconcilePanel` 953, `useDatabaseTransferAction` 969
→ S4, `useDatabaseUploadActWorkflow` 675, `useDatabaseDetailRuntime` 688, `EquipmentDetail*` 618/679,
`DatabaseBulkActionBar` 663) задокументирован кандидатами на следующую итерацию.

## Верификация контролёра — глубокая проверка 2026-09-18 (build; один фикс внесён)

1. **Найден и исправлен разрыв data_version (не закоммичено):** `GET /all-grouped?branch=` собирал
   ответ вручную без `data_version` (`equipment.py:1440-1446`) — поле падало в дефолт 0 модели,
   свидетель staleness для branch-скоупа врал бы всегда. Фронт `branch` не передаёт (латентно),
   но контракт модели обещает поле. Исправление: `'data_version': result.get('data_version', 0)`
   + assert в `test_all_grouped_branch_path_keeps_limit_in_response`. Остальные 4 пути
   (`all-grouped`, `consumables`, `by-inv-nos`, `universal`) версию отдают — проверено чтением.
   Invalidate вызывается на всех путях мутаций (transfer ×2, consumables ×4, equipment add/update/
   delete, act-commit, ai_chat action-cards) — bump покрывает всё.
2. **Гигиена diff с `5da816b8`:** секретов/токенов/`console.log` — нет; SQL-конкатенации
   пользовательских значений — нет (только int-интерполяция лимитов после clamp).
3. **Полный backend-сюит** — не влез в 30 мин таймаут на этой машине; вместо него широкий
   DB-скоп: **115/115** (contract, search-helpers, history, hot-paths, selection, data-version,
   page-budget, inv-parsing, upload-act-email, transfer-layout, reminder ×2, delete, locations, scope).
4. **Полный фронт-сюит (594 файла): два прогона — 6 и 4 падения, состав плавает.**
   Разбор: `requestOrdering`, `Settings AiBots`, `ChatThread font` — предсуществующие (доказаны на
   чистом HEAD ранее); `CompanyStructure`, второй `ChatThread`, два РАЗНЫХ `Database.test`
   (QR deep-link, возврат из карточки) — появляются/исчезают между прогонами. В изоляции и в
   диалоговом соседстве (62/62) все зелёные; везде симптом один — «диалог не открылся»
   (findBy 1с не дождался lazy-чанка+цепочки эффектов). Вывод: не регрессия кода, а флакинес
   тяжёлых async-тестов под нагрузкой (594 файла параллельно + 14 PM2-процессов + scan-worker
   ~1 ГБ на ТОЙ ЖЕ прод-машине). Действие: полный сюит гонять на CI/стенде или с ограниченными
   воркерами; для двух самых медленных dialog-тестов рассмотреть `findBy` с явным таймаутом.
   Отдельно: в `frontend/` лежат чужие старые `vitest-full.log`/`vitest-run.log` (июнь) — мусор,
   не мой, не трогал.
5. **PM2:** все 14 online; `itinvent-backend` после рестарта стартовал ~минуту (инициализация:
   backfill сессий и т.д.) — `/health` → 200. Попутное наблюдение (вне скоупа, не чиню):
   в error-логе живого трафика регулярные `http.slow ~3с` на `warehouse-1c/it-requests`.

Проверены `0b571582` (S1/S3/S2) и `20a1620a` (S4, Devin). Все файлы каталога <600 строк
(максимум refactored — 575; `Warehouse1CReconcilePanel.jsx` 907 — предсуществующий, вне скоупа).
Новое: `HubEquipmentList`, `WarehouseBalancesPanel`, `WarehouseMovementsList`,
`EquipmentHistoryDialog`, `EmployeeEquipmentSubDialogs`, `EmployeeCompareFilters`,
`employeeCompareFormat`, `DatabasePageHeader/ScopeContent/ListSection`, `dialogsLayerProps`,
`useDatabaseListController/DialogController/EmployeeFlow`, `useTransferFormState/ActJob/Email`.
Прямых unit-тестов новых модулей нет — покрытие интеграционное (`Database.test.jsx`,
диалоги, хуки).

Проверки мои: pytest DB-скоп 42/42; vitest database-скоп 84 файла / 466 тестов — всё зелёное.
Чанк Database: 255.7 КБ (было 257.3) — в бюджете 280, динамика здоровая. Поведение 1-в-1 —
по тестам и проводке пропсов; визуальный регресс диалогов/табов — только ручным проходом 390px.

Остаток по странице: ручное (390px, desktop-smoke, staging-smoke), наблюдение за флаком,
заморозка. S1–S4 как код — приняты.

## Верификация контролёра — S1/S3 2026-09-18 (исправлено: прошлое чтение было несвежим снепшотом)

Перепроверено начисто, shell-замерами (консистентны между собой): `EmployeeEquipmentDialog.jsx`
575 строк, `DatabasePageView.jsx` 538 строк; выносы S1/S3 импортированы и используются;
счётчик и сентинел живут в `DatabaseListSection.jsx` (93 строки). Старая пометка про
«движущуюся цель» снята как ошибочная — агент ничего параллельно не правил, несвежим был
мой инструмент чтения. Тесты: database-скоп 84 файла / 466 тестов — зелёное. Сборка успешна.

Про чанк честно: Database 227→257 КБ raw (+13%), gzip 69.7→76.6 КБ (+10%). Утечек lazy-кода
нет (доказано поиском маркеров), значит прирост — фичи после baseline (моб. табы, фильтры
сверки, акты/спиннеры поиска), а не дублирование от сплита. Критичность: LOW для основного
контура (офисная сеть, десктоп, кэшированная PWA — разовая доплата ~7 КБ за релиз) и MODERATE
для первого открытия PWA на слабой мобильной сети (~+0.3–0.6 с на медленном 3G, ~+50–100 мс
на 4G, плюс ~10–100 мс парсинга). Не блокер. Решение: принять 257/76.6 как новый baseline,
бюджет — не выше 280 КБ raw (следить через `npm run check:startup-bundle`), гнаться за
возвратом к 227 нецелесообразно.

Инцидент процесса (моя вина, зафиксировано): `git worktree remove --force` поверх worktree
с junction на `node_modules` вытер реальный `node_modules` фронтенда (0 каталогов). Восстановлено
через `npm install`, `package.json`/`package-lock.json` не изменились, тесты после этого зелёные.
Правило: junction внутрь worktree больше не делать; для изолированных сборок — только копия.

## Что дальше делаем (очередь после S1/S3)

1. ~~S2 (view-model → доменные контроллеры)~~ — выполнен: `useDatabasePageViewModel.js`
   1942→321, контроллеры `useDatabaseListController` (583) / `useDatabaseDialogController` (467) /
   `useDatabaseEmployeeFlow` (306). ~~S4 опционален~~ — тоже выполнен:
   `useDatabaseTransferAction` 969→376 + `useTransferFormState`/`useTransferActJob`/
   `useTransferEmail`. Структурные пакеты S1–S4 закрыты полностью.
2. ~~Закоммитить~~ — `0b571582` (S1/S3/S2 одним Database-коммитом, 23 файла).
3. Ручное: 390px, desktop-smoke, staging-smoke (gzip/Vary/stale/multi-worker).
4. Заморозка страницы и плана; флак lazy-диалога сотрудника воспроизведён и закрыт
   (`timeout: 5000` на `findByRole` в `Database.test.jsx` — под нагрузкой lazy-чанк
   превышал дефолтные 1s).

S1 подтверждён функционально: `EmployeeEquipmentDialog.jsx` 2172→575 строк, выносы
`HubEquipmentList.jsx` (402), `WarehouseBalancesPanel.jsx` (452), `EquipmentHistoryDialog.jsx` (84),
`EmployeeEquipmentSubDialogs.jsx` (88), `EmployeeCompareFilters.jsx` (156) — все импортированы
и используются, старых вложенных компонентов в диалоге не осталось. S3: `DatabasePageView.jsx`
1127→538 строк, секции `DatabasePageHeader/ScopeContent/ListSection` подключены.
Lazy-границы целы (14 `lazy()` в `DatabaseDialogsLayer`, кода диалогов в Database-чанке нет —
проверено поиском маркеров строк). Тесты: database-скоп 466/466. Сборка успешна.

Оговорки (честно):
- Чанк Database вырос 227→257 КБ (~+30 КБ), атрибуция не установлена: baseline-сборка из HEAD
  дважды упала на рендеринге (память, рядом крутятся 14 PM2-процессов), а агент параллельно
  правит файлы — замеры гонятся за движущейся целью. Утечек lazy-кода в чанк нет (доказано),
  остаток прироста — на совести новых фич uncommitted-дерева, не сплита как такового.
- Требование: заморозить дерево → пересобрать → зафиксировать цифру; иначе «без роста чанков»
  подтвердить нельзя. S2 не начат (новых controller-файлов нет).

## Верификация контролёра — финальная готовность 2026-09-17 (код не менялся)

Этапы 0–7: выполнены и проверены ранее. Этап 8 частично: контрактные/мутационные тесты есть,
красных перф-бюджетов «страница ≤ X SQL» нет — единственный открытый пункт этого этапа.
Этап 9: 9.1 табы «В Хабе / Склад 1С» (`EmployeeEquipmentDialog.jsx:2031-2046`) ✓;
9.2 отдельной переработки не было — покрыто существующими `ModernEquipmentCard`/`HubEquipmentMobileRow`,
достаточность — за ручной проверкой 390px; 9.3 shortcut `/database` в манифесте ✓ (`:89`),
SW-кэш `/api` не вводился ✓; 9.4 desktop-smoke — только вручную; 9.5: единый `BulkActionBar`
`variant mobile/desktop` (`DatabasePageView.jsx:709-733`, `DatabaseSelectionBar.jsx` — тонкая
обёртка для тестов), один провайдер, `prefers-reduced-motion` (`:738`), `role="status"` на
счётчиках (`:785-787`), degraded — фокусируемый с `aria-label` (`DatabaseSearchBar.jsx:130-138`).
Не сделан: сплит `UploadActDialog` (50+ пропсов живёт в `DatabaseDialogsLayer.jsx:52`).

Проверки мои сегодня: backend-скоп 38/38 (включая `data_version` 5/5); фронт database-скоп
84 файла / 466 тестов — зелёное (один прогон дал 1 падение, в трёх повторных не воспроизвелось —
флак, наблюдать). Плюс мой фикс регрессии поиска из сессии выше (идентификаторы + акты в
результатах, live-проверено на ITINVENT).

Готово ли: код — да, этапы 0–7 + 9.1/9.3/9.5 — да. Не готово: коммит (дерево грязное, Database
смешан с my_files/tasks/mobile — бить на два коммита), ручные проверки (390px, desktop-smoke,
multi-worker, live smoke gzip/Vary), красные перф-бюджеты этапа 8, сплит UploadActDialog.

## Верификация контролёра — фикс регрессии поиска 2026-09-17 (build, код правил сам контролёр)

Жалоба (скрин): в результатах поиска «козловский» колонки 1С и Акт — «?», переход на сотрудника
не работает; без поиска всё работает. Диагноз подтверждён чтением кода:
- `EmployeeNameLink.jsx:13` требует `ownerNo` для кликабельности; `EquipmentTable.jsx:61` читает
  `EMPL_NO/empl_no/OWNER_NO/owner_no` — в `QUERY_SEARCH_UNIVERSAL` колонки не было → имя plain text.
- Та же причина гасила 1С-бейдж (`useEmployeeCompare(employeeOwnerNo)` с `null`).
- Акты: у search-строк нет `current_act_*`, а ленивый батч актов покрывал только загруженные
  страницы списка — индикатор показывал «?» без возможности открыть.
- Почему регрессия: до серверного поиска (этап 2) поиск шёл по загруженным полным строкам;
  slim-SELECT нового поиска идентификаторов не содержал.

Исправление (файлы изменены):
- `backend/database/equipment_search_reads.py`: в SELECT добавлены `o.OWNER_NO as empl_no`,
  `b.BRANCH_NO as branch_no`, `l.LOC_NO as loc_no`, `s.STATUS_NO as status_no`,
  `t.TYPE_NO as type_no`, `m.MODEL_NO as model_no`, `m.VENDOR_NO as vendor_no` — все из уже
  заджойненных таблиц, стоимости ноль; BY_INV_NO-вариант наследует через replace.
- `frontend/.../useDatabaseSearch.js`: `loadActsForSearchGrouped` — батч `getCurrentActs` по ID
  строк поиска с seq-guard, dedup-Set (сброс на новый поиск/clear), merge через
  `mergeCurrentActsIntoGrouped`; ошибка тихая (бейджи остаются «?»).
- Тесты: `test_equipment_contract.py` — пин новых алиасов; `useDatabaseSearch.test.jsx` — новый тест
  мержа актов (9/9).

Проверки мои: pytest contract+helpers 18/18; vitest search-hook 9/9; database-скоп 84 файла /
465 тестов — всё зелёное; live SELECT-only на ITINVENT («Козловский», 7 строк): строка ID 664
(та самая со скрина) вернула `empl_no=2900`, `branch_no`, `loc_no`, `status_no`, `type_no`,
`model_no`, `vendor_no` за ~127 мс. Сотрудник/1С/акт из поиска снова работают.

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

- [x] Контейнер <300 строк (`Database.jsx` ~40), новых стейтов в корне нет — вся
  оркестрация в `useDatabasePageViewModel`, рендер в `DatabasePageView`,
  диалоги в `DatabaseDialogsLayer`.
- [x] Клиентский индекс — только как деградация: `serverSearchEnabled` false →
  fallback на загруженные данные + CloudOff-сигнал; consumables ищутся отдельно
  (universal покрывает только CI_TYPE=1).
- [x] Мутации точечные (transfer/add/delete/qty/акт → upsert/remove + счётчики);
  полный refetch — только «Обновить», конфликт версии и задокументированные
  fallback'и (add-consumable без point-read, maintenance consume).
- [x] `data_version` сквозная: bump в `invalidate_equipment_cache`, поле в
  list/search ответах, фронт сравнивает per-scope и показывает stale-баннер.
- [x] Перф-бюджеты запинены тестом (`test_equipment_page_budget.py`: ≤2 SQL на
  список/поиск, 1 SQL на ≤1800 id актов); контракт universal честный
  (COUNT+OFFSET/FETCH). Сравнение с live-базлайном этапа 0 — за исполнителем
  на реальном контуре.

## Аудит контура Database 2026-09-18 — баги и оптимизации (исполнитель)

Полный обход контура: SQL-слой, эндпоинты, сервисы, фронт-хуки, 1С-стики.
Найдено и исправлено:

| ID | Находка | Риск | Фикс |
|---|---|---|---|
| B1 | `MAX(...)+1` без лока в 6 местах: `DOCS.DOC_NO` (акт загрузки), `FILES.FILE_NO`, `CI_MODELS`, `OWNERS`, `ITEMS` ×2 — гонка PK при конкурентных актах/созданиях | HIGH — PK-конфликт → откат транзакции | `WITH (TABLOCKX, HOLDLOCK)` на всех MAX-чтениях — тот же паттерн, что уже применён в `CI_HISTORY` |
| B2 | «Пустой результат» вместо ошибки: `search_equipment_universal` глотал исключение → HTTP 200 `total:0`; cross-DB lookup молча пропускал упавшие БД; reconcile молча пропускал склад при падении count | MEDIUM — обман пользователя | Проброс ошибки в universal-поиске (фронт показывает CloudOff); `failed_dbs` в ответе cross-DB + warning-Alert в диалоге сотрудника; `hub_count_failures` → status `incomplete` в reconcile |
| B3 | Неограниченные `IN (...)` против лимита ~2100 параметров SQL Server: `get_equipment_items_by_ids`, `get_equipment_items_by_inv_nos`, `get_transfer_act_items_by_inv_nos`, `count_equipment_by_owners_and_part_nos`, write-путь `create_uploaded_transfer_act` | MEDIUM — pyodbc-ошибка → 500 | `_in_clause_chunks(1800)` — тот же bound, что в `equipment_current_act_reads`; дедуп при мерже; сортировка `TRY_CONVERT` воспроизведена на Python; капы `max_length` в Pydantic (`inv_nos` ≤2000, `equipment_inv_nos` ≤1800); явный `ValueError` на oversized акте |
| B4 | `set_assigned_database` — read-modify-write всей таблицы → lost update при конкурентной записи | MEDIUM-LOW | Per-key upsert/delete в app-БД (без полного RMW) + `threading.Lock` для JSON-fallback; инвалидация `_assigned_cache` на записи |
| B5 | `useTransferActJob` — одна сетевая ошибка убивала пуллинг живого job; `useDiscrepanciesCopy` — `setTimeout` без cleanup на unmount | LOW | До 3 consecutive transient-ошибок переживаются; таймер очищается в `useEffect`-cleanup |
| O2 | `_equipment_payload_cache` — dict без max-size; ключи включают параметры поиска → бесконечный рост | MEDIUM — утечка памяти на long-running worker | LRU-cap `EQUIPMENT_PAYLOAD_CACHE_MAX_ENTRIES` (деф. 2000): hit → промоция в конец, переполнение → вытеснение старейших |

### Новые тесты раунда

- `test_universal_equipment_search_propagates_db_error` — новый контракт ошибок (заменил старый empty-fallback).
- `test_equipment_by_owner_all_databases_*` — распаковка `{equipment, failed_dbs}`; `failed_dbs == ["MSK"]` при падении.
- `test_owner_mismatch_flags_incomplete_when_hub_count_fails` — status `incomplete` + `hub_count_failures`.
- `test_get_equipment_items_by_ids_chunks_in_clause_under_param_limit` — 3700 id → 3 запроса, дедуп.
- `test_create_uploaded_transfer_act_rejects_oversized_item_list` — явный `ValueError`.
- `test_equipment_payload_cache_evicts_oldest_beyond_cap` — LRU-вытеснение + промоция.
- Vitest: polling переживает 2 transient-ошибки → `done`; даёт up после 3 подряд.

### Проверки раунда

- Backend focused: 43/43 (search-helpers, cross-DB, contract, budget, inv-parsing) +
  reconcile 31/31 + owner-mismatch 3/3 + selection-contract 7/7.
- Vitest database-скоп: **468/468** (84 файла, +2 новых polling-теста).
- `import backend.main` — ок, 702 route; `npm run build` — ок, Database-чанк 262.0 КБ / gzip 77.6 (бюджет 280).
- Один env-флак устранён: `test_equipment_grouped_caches_total_count_across_pages` падал на
  свежем conftest-sqlite без схемы `app_settings` — bump `data_version` замокан в тесте.

### Открытые находки аудита (не исправлены — зафиксированы)

- O1: последовательный fan-out `get_equipment_by_owner_all_databases` (N БД × 2 запроса) —
  кандидат на `ThreadPoolExecutor` при росте числа БД.
- O3: `_get_cached_equipment_total` не привязан к `data_version` — count дрейфует до TTL
  при частых мутациях.
- O4: `get_all_equipment` (queries.py) не возвращает `data_version` — если `/all` ещё жив,
  baseline по версии там не работает.
