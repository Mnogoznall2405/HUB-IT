# Database — аудит, оптимизация и план дальнейших работ

Дата: 2026-09-16. Статус: точечная оптимизация завершена и проверена контролёром
(см. «Вердикт контролёра»); live smoke — при доступе к стенду.
**Дальше работаем по `DATABASE_ROBUSTNESS_PLAN.md` (структурная антихрупкость) —
этот файл заморожен, новые пункты сюда не добавлять.**

## Объём

Страница `/database`: React/Vite/MUI фронтенд (`WEB-itinvent/frontend/src/pages/Database.jsx` + `src/pages/database/*`),
FastAPI бэкенд (`backend/api/v1/equipment.py`, `backend/database/equipment_db.py`), SQL Server ITINVENT
(через pyodbc, per-user выбор БД заголовком `X-Database-ID`), чтение складов 1С через COM-мост
(`warehouse_1c_service.py`, процессный бридж с очередью).

## Уже сделано (проверено тестами/сборкой/браузером)

| Изменение | Эффект |
|---|---|
| Sync-I/O через `run_in_threadpool` | Event loop не блокируется pyodbc |
| Sargable `i.INV_NO IN (...)` вместо `TRY_CONVERT` | Индекс по INV_NO реально используется |
| Batch-загрузка вместо N+1 (`by-inv-nos`) | Один запрос на страницу |
| Кэш count-запросов, детерминированная пагинация | Меньше запросов, стабильные страницы |
| Фикс утечки слота в pyodbc-пуле | Нет исчерпания пула под нагрузкой |
| `Promise.all` + `databaseReady`-гейтинг холодной загрузки | Убраны вотерфолы запросов |
| `employee-compare-summary`: серверный кэш 120с + lock-дедуп + отложенная загрузка | Один бридж-вызов вместо каскада |
| Мобильные hit-areas ≥44px | Проверено реальным Chrome 390px, 26/26 чеков |
| Lazy-чанки диалогов (`React.lazy` + `Suspense` с гейтами) | Database-чанк 395.11 → 230.75 KB (gzip 116.3 → 71.5 KB) |
| Dict-кэш справочников TTL 300с (`EQUIPMENT_DICT_CACHE_TTL_SEC`) | `/branches`, `/types`, `/statuses`, `/locations`, `/models`, `/branches-list` без SQL в пределах TTL |
| `employee-compare-summary` на клиенте через `getOrFetchSWR` (stale 120с, ключ по БД) | Нет лишнего запроса при ре-маунте |
| Фикс `invalidate_equipment_cache`: ключи без частей после db_id не матчились | Dict-ключи корректно инвалидируются мутациями |

## Текущий план (проверенный)

### 1. Gzip для JSON API

Факты: `main.py` без мидлвари сжатия; `web.config` без `urlCompression`/`httpCompression`; API идёт через
IIS ARR-прокси → вероятно несжатый JSON. `all-grouped` со 1000 записей — сотни KB, жмётся ~85–90%.

Ограничение (проверено по starlette 0.52.1): `GZipMiddleware` не флашит буфер при `more_body=True` →
ломает SSE (`gateway.py` отдаёт `text/event-stream`) и файловые стримы (`my_files`, `networks`, `equipment`).

Реализация: кастомный ASGI-мидлварь — жать только ответы с `Content-Type: application/json` и телом >1 KB,
при наличии `Accept-Encoding: gzip` в запросе. Ставить `Content-Encoding: gzip`, `Vary: Accept-Encoding`,
`Content-Length`. Стримы и не-JSON пропускать без буферизации.

Проверки: unit-тест — JSON >1KB жмётся, <1KB нет, SSE/стрим проходит неизменно, `Vary` выставлен;
smoke — `/api/v1/equipment/all-grouped` отдаёт `Content-Encoding: gzip`.

### 2. Cache-Control на справочники

`Cache-Control: private, max-age=300` + `Vary: X-Database-ID` на `/branches`, `/types`, `/statuses`,
`/locations`, `/models`. `Vary` обязателен: БД выбирается заголовком, URL общий — без него браузер
отдал бы справочники чужой БД после переключения.

### 3. Префетч lazy-чанков по idle

После первой отрисовки списка в `Database.jsx`: `requestIdleCallback` → `import('./database/EquipmentDetailDialog')`
и `import('./database/EmployeeEquipmentDialog')`. Vite дедуплицирует модуль — к моменту клика чанк в памяти,
открытие мгновенное. Fallback `setTimeout`, если `requestIdleCallback` нет.

### 4. App-side SQL/контракт без DBA

Чинится в приложении, доступ к SQL Server и DBA не нужны:

- [x] `search_by_serial` → `SELECT TOP (@limit)` 100–200 + числовой fast-path `INV_NO=?`.
  **Выполнено (не закоммичено), проверено контролёром 2026-09-16 на ITINVENT:**
  цифра `100001` — 3.1 мс (seek по `IX_INV_NO`), текст `CZC7` — 6.2 мс / 22 строки,
  без совпадений — 6.1 мс. Проводка routes → `queries.py` → `equipment_search_reads.py` корректна,
  ключ COUNT-кэша включает параметры, тесты (22 шт.) зелёные.
- [x] `search/universal` → честные `page/pages` (`OFFSET/FETCH` + отдельный кэшированный `COUNT`).
  **Выполнено (не закоммичено), проверено:** `lenovo` p1 — 62.8 мс / total 158 / pages 4,
  p2 — 84.8 мс, цифра — 5.7 мс. Старый контракт `{page:1,pages:1}` удалён из кода.
- [x] `COUNT(*) WHERE CI_TYPE IN (1,4)` и `COUNT_BY_BRANCH` → `_get_cached_equipment_total`
  (сигнатура расширена параметрами, ключ включает params — проверено чтением кода).
  **Выполнено (не закоммичено).**
- [x] `get_all_equipment_flat` → `TOP (@limit)` в SQL (`queries_new.py:113`, `equipment_db.py:251`).
  **Выполнено (не закоммичено).**
- [x] Кэш discovery `_get_table_columns` — уже был (`queries.py:1582-1604`, dict-кэш);
  `locations_has_branch_column` — уже мемоизирован (`equipment_directory_reads.py:64-94`).
  Повторно делать не нужно.
- [x] `LOCATIONS ... WITH_BRANCH_PRIORITY` — уже `LEFT JOIN (SELECT DISTINCT ...)`
  (`equipment_directory_reads.py:24-39`), коррелированного `EXISTS` нет. Пункт закрыт как устаревший.
- [ ] Снять избыточный `LOWER()/LTRIM()/CAST()` на фильтруемых колонках (collation проверена
  прямым опросом 2026-09-16: `Cyrillic_General_CI_AS` — можно снимать):
  `equipment_reference_reads.py:34`, `equipment_act_history_reads.py:246-247,505-506`.
  Ожидание — только CPU (при `%…%` seek не вернётся).
- [ ] Кэш doc-type map `_resolve_doc_type_names` (`equipment_act_history_reads.py:37-75`,
  вызывается на каждое открытие актов/истории, `INFORMATION_SCHEMA`-discovery без кэша).
  Эффект микро (акты сейчас 13 мс, история 3 мс на ITINVENT).
- [ ] Enrich: `item_id not in item_ids` (`equipment_current_act_reads.py:57`) — O(n²),
  заменить на set для membership (порядок — отдельным списком). Эффект микро.

Проверки: unit на `TOP`/числовой fast-path, контракт `page/pages/total` для universal, отсутствие
`INFORMATION_SCHEMA`-запросов в request path карточки (по логам/мокам).

### 5. Фронт quick wins

- `qrModel.js:1` — статический `import QRCode from 'qrcode'` тянется в initial чанк через `Database.jsx:43`;
  оставить только `await import('qrcode')` внутри `buildEquipmentQrDataUrl`, парсинг ссылок — без зависимости.
- Дебаунс поиска `useDatabaseSearch.js:19` 1200→250–350 мс, `Enter`/clear — мгновенно.
- Виртуализация `DatabaseDataSections.jsx:51-77` (мобильные карточки сейчас без неё);
  пересмотреть `TABLE_VIRTUALIZE_THRESHOLD=120` (`EquipmentTable.jsx:31,277`) — считается на таблицу одной
  локации и почти никогда не срабатывает.
- Точечные `upsertItemInGrouped` / `removeItemFromGrouped` после мутаций вместо полного
  `fetchAllEquipment({force:true})` (`useDatabaseTransferAction.js:476,633,676`, `useDatabaseAddWorkflows.js:390,422`);
  образец уже есть в `useDatabaseDetailRuntime.js:548`, `useDatabaseDeleteEquipment.js:47-52`.
- QR-генерация только при `detailQrOpen===true` (`useDatabaseDetailRuntime.js:426-463`), сейчас eager
  при каждом открытии/обновлении карточки.

## Чек-лист выполнения

Порядок (согласован с контролёром 2026-09-16): §2 Cache-Control → §5 qrModel+debounce → §4 TOP/fast-path/кэши → §1 gzip-мидлварь → §3 idle-префетч → §4 universal-контракт (последним — меняет контракт) → §5 виртуализация (отдельным шагом). Каждый пункт закрывается только после тестов/проверки.

### 1. Gzip для JSON API
- [x] JSON-only gzip мидлварь: `application/json`, тело >1 KB, `Accept-Encoding: gzip`; `Content-Encoding` + `Vary` + `Content-Length` — `backend/services/json_gzip_middleware.py`, подключён в `main.py` (minimum_size=1024)
- [x] Unit: `tests/test_json_gzip_middleware.py` — 5/5 (жмётся, <1KB нет, без gzip-Accept pass-through, SSE/стримы неизменно, `Vary` выставлен)
- [ ] Smoke: `/api/v1/equipment/all-grouped` отдаёт `Content-Encoding: gzip` (на живом бэкенде)

### 2. Cache-Control на справочники
- [x] `Cache-Control: private, max-age=300` + `Vary: X-Database-ID` на `/branches`, `/types`, `/statuses`, `/locations`, `/locations/{id}`, `/models`, `/branches-list` — хелпер `_set_dict_cache_headers` в `api/v1/equipment.py`
- [x] Проверка: `Vary` ключит кэш по заголовку БД; 43/43 backend-тестов; direct-call тесты получают `response=Response()`, conftest чистит equipment-кэш между тестами

### 3. Префетч lazy-чанков
- [x] `requestIdleCallback` (+`setTimeout` fallback) после первого непустого `allEquipment` → prefetch `EquipmentDetailDialog`, `EmployeeEquipmentDialog` (`Database.jsx`, ref-гард от повторов)
- [ ] Проверка: клик «Подробнее» без сетевого запроса чанка — покрыть в browser smoke

### 4. App-side SQL/контракт
- [x] `search_by_serial`: `SELECT TOP {limit}` (default 200) + числовой fast-path `INV_NO=?` для `isdigit()`; нечисловые термы → `SERIAL_NO/HW_SERIAL_NO/PART_NO LIKE` (`equipment_search_reads.py`)
- [x] `search/universal`: `OFFSET/FETCH` + кэшированный `COUNT` (dict-TTL через `_get_cached_equipment_total`, в тестовом seam `get_db_fn` кэш пропускается); `isdigit()` → `INV_NO=?` fast-path; честные `page/pages/total`. Мёртвая легаси-константа `queries.QUERY_COUNT_UNIVERSAL` (`COUNT(DISTINCT a,b,c)` — невалидный T-SQL) удалена, новые константы реэкспортированы. Сплит на 2–3 запроса **не делался**: contains-LIKE всё равно сканирует, dedup/ordering-слияние в Python усложнило бы код без выигрыша
- [x] Schema-memo (бессрочный in-process, схема не меняется без рестарта): `_get_table_columns`, `locations_has_branch_column`; conftest чистит между тестами
- [x] `COUNT(*)` для `get_all_equipment` и `get_equipment_by_branch` → `_get_cached_equipment_total` (TTL 30с — сознательно НЕ 60–300с: см. отклонённый пункт про внешние записи; per-branch ключ по params)
- [~] Снять `LOWER()/CAST()` — **отложено: нужен факт collation с прода**; запросы на create-path (`DEFAULT_STATUS_PREFERRED`) и act-search — редкие, `%…%` в любом случае без seek. `UPPER(CAST(INV_NO)) IN` в by-inv-nos **не трогать** — тесты доказывают нечисловые INV_NO («INV/2»)
- [x] `get_all_equipment_flat`: `SELECT TOP {limit}` в SQL вместо `[:limit]` в Python
- [x] `LOCATIONS … WITH_BRANCH_PRIORITY` → `LEFT JOIN (SELECT DISTINCT LOC_NO …)`

### 5. Фронт quick wins
- [x] `qrModel.js`: `qrcode` → dynamic import внутри `buildEquipmentQrDataUrl`; парсинг ссылок без зависимости
- [x] Debounce `useDatabaseSearch.js` 1200 → 300 мс; Enter/<2 символов/clear уже мгновенные
- [x] Виртуализация мобильных карточек — `content-visibility: auto` + `contain-intrinsic-size` на `ModernEquipmentCard`: браузер пропускает off-screen layout/paint, элемент остаётся смонтированным → `expanded`-стейт не теряется (windowing не нужен)
- [x] `TABLE_VIRTUALIZE_THRESHOLD` 120 → 40
- [x] Точечные `upsertItemInGrouped` после мутаций: `refreshTransferredItems` (3 сайта transfer, by-inv-nos + upsert, fallback force-refetch) и `refreshCreatedEquipment` (add-equipment); add-consumable остался на force-refetch — by-inv-nos покрывает только CI_TYPE=1
- [x] QR-генерация только при `detailQrOpen===true` (`useDatabaseDetailRuntime`)

### Финальная проверка
- [x] Focused backend tests — 48/48 (search/locations/reference/scope/gzip/delete)
- [x] Focused frontend tests — 454/454 (весь `pages/database/` + Database)
- [x] `npm run build` — Database-чанк 232.51 KB (gzip 71.89 KB) vs 230.75 до этой сессии: +1.76 KB новый код (prefetch, point-refresh). `qrcode` из Database-чанка убран, но заметного падения нет: библиотека и так сидела в shared index-чанке через статические импорты `Login.jsx`/`PasswordUnlockDialog.jsx` — выигрыш семантический, не по байтам
- [x] Browser smoke на preview (моки, 390px): список, lazy EquipmentDetailDialog, lazy EmployeeEquipmentDialog, без горизонтального overflow, без console errors
- [ ] Live-проверки на реальном бэкенде/БД: `Content-Encoding: gzip` на `all-grouped`, `Vary: X-Database-ID` в браузере, collation факта для LOWER-пункта

## Вердикт контролёра (2026-09-16, проверка выполнения агентом; заменяет заметки до реализации)

Проверено чтением diff, запуском тестов и замером dist. Код не менялся.

**Подтверждено, сделано правильно:**
- §1 gzip: `backend/services/json_gzip_middleware.py` (JSON-only, `minimum_size=1024`,
  обход SSE/стримов через `more_body`-буферизацию только JSON, `pathsend`-passthrough,
  `Vary: Accept-Encoding`, перезапись `Content-Length`) + wiring `main.py:451-452`;
  `tests/test_json_gzip_middleware.py` 5/5. Остаточное замечание (микро): HEAD-запросы на JSON
  получат `Content-Length: 0`; JSON-стримы (если появятся) будут буферизоваться целиком.
- §2 Cache-Control: `_set_dict_cache_headers` (`equipment.py:103-110`, `private, max-age=300`,
  `Vary: X-Database-ID`), 7 точек. Тесты 43/43 по заявлению агента; мой прогон смежных
  backend-тестов — 54/54 зелёных.
- §3 idle-префетч: `Database.jsx:376-390` (ref-гард, `requestIdleCallback` + `setTimeout`-fallback).
  Браузерная часть проверки («клик без сетевого чанка») осталась за smoke.
- §4: TOP/fast-path serial (3–6 мс), честная пагинация universal (63–85 мс, pages=4),
  COUNT-кэш с ключом по params, flat-TOP, schema-memo (`conftest.py:104-116` чистит кэши).
  Сплит universal на 2–3 запроса обоснованно не делался. Мёртвая `queries.QUERY_COUNT_UNIVERSAL` удалена.
- §5: dynamic `qrcode` (`qrModel.js:115`), debounce 300, `content-visibility` (`ModernEquipmentCard.jsx:184-185`),
  threshold 40, точечные `refreshTransferredItems`/`refreshCreatedEquipment` с fallback на force-refetch,
  QR только при `detailQrOpen` (`useDatabaseDetailRuntime.js:431-463`). Оговорка про `qrcode` в shared-чанке
  (`Login.jsx:3`, `PasswordUnlockDialog.jsx:2` — статические импорты остались) — подтверждена чтением кода.
- Тесты: backend 54/54 (мой прогон), фронт 454/454 — **перепроверено моим запуском
  (`vitest run src/pages/database src/pages/Database.test.jsx`: 83 файла, 454 теста, всё зелёное).**
- Чанк: текущий `dist` — `Database-C7DTb2eW.js` 227.06 KB / gzip 69.65 KB (сборка 22:32);
  заявленные в плане 232.51/71.89 к другому хешу сборки — порядок тот же, расхождение в пределах сборок.

**Не подтверждено / осталось:**
- Live smoke на реальном бэкенде: `Content-Encoding: gzip` на `all-grouped`, `Vary: X-Database-ID`
  в браузере, клик «Подробнее» без сетевого чанка. Без прод-доступа не проверяется отсюда.
- Пункт `[~] LOWER`: отговорка «нужен факт collation с прода» устарела — collation снята моим
  прямым read-only опросом (`Cyrillic_General_CI_AS`). Снимать или нет — решение за исполнителем,
  эффект только CPU.
- Вне объёма первого плана в том же грязном дереве лежат правки my_files/warehouse/mobile-hub/pm2
  (всего 83 файла) — мной не проверялись; перед коммитом рекомендую разбить на два коммита
  (Database vs остальное), иначе ревью нечитаемо.

**Что дальше меняем (порядок):**
1. Live smoke (§1–§3) при первом доступе к стенду.
2. Enrich-CTE вынести из страницы списка (99 мс из 150 мс — единственный крупный остаток;
  см. `DATABASE_ROBUSTNESS_PLAN.md`, этап 7).
3. Микро по желанию: кэш doc-type map, `not in` → set в enrich, `LOWER()`.
4. Коммит: разбить Database-часть и остальное.

## Заметки контролёра (2026-09-16, сверка с кодом — до реализации, историческое)

С чем согласен: §1 (gzip — `main.py` без мидлвари сжатия, starlette 0.52.1 подтверждена, SSE/стримы надо обходить);
§2 (на `/branches`, `/types`, `/statuses`, `/locations`, `/models` в `api/v1/equipment.py:1143-1702`
`Cache-Control` сейчас нет — пункт не выполнен, `Vary: X-Database-ID` обязателен); §3 (префетча по idle
на странице Database нет — `requestIdleCallback` есть только в scan-center/tasks/chat, не в `database/*`);
§4 полностью (serial без `TOP` — `equipment_search_reads.py:9-42,94-105`; universal `page=1/pages=1/total=len()` —
`equipment_search_reads.py:119-146`; `CAST(INV_NO) LIKE` — `:40,72`; `COUNT(*)` без кэша —
`equipment_db.py:121-143,146-177`; срез `[:limit]` в Python — `equipment_db.py:239-253`);
§5 полностью (`qrModel.js:1` статический импорт; дебаунс 1200 — `useDatabaseSearch.js:19`).
С чем не согласен: формулировка чек-листа §4 про `LOWER()/CAST()` уже сама содержит верное уточнение
(CPU, не seek при `%…%`) — при реализации не продавать это как «возврат seek».
`TESTING_CHECKLIST.md` в корне — про bot-инструменты, к этому плану не относится; релевантный чек-лист —
раздел «Чек-лист выполнения» этого файла.
Можно реализовывать сейчас (порядок): §2 (Cache-Control) → §5 qrModel+debounce → §4 TOP/fast-path/кэши →
§1 gzip-мидлварь → §3 idle-префетч → §4 universal-контракт (последним, меняет контракт) →
§5 виртуализация (отдельным шагом, риск потери `expanded`-стейта уже зафиксирован в чек-листе).

## Отклонено / отложено (с причинами)

| Кандидат | Статус | Причина |
|---|---|---|
| Слияние двух `employee-warehouse` вызовов в диалоге | Отклонено | Осознанный прогрессивный паттерн: match по локальному снапшоту (быстро, без моста), балансы — тяжёлый бридж-вызов. Слияние откладывает показ склада на время балансов. Тест `shows the matched warehouse before its live 1C balances finish loading` фиксирует контракт |
| Поднять `EQUIPMENT_PAYLOAD_CACHE_TTL_SEC` 30→120с | Отклонено | Инвалидация работает только на мутации через API; внешние писатели в ITINVENT протухают только по TTL — 30с это граница свежести. Кэш per-process — при нескольких воркерах и так не синхронен |
| IIS `urlCompression`/server-level gzip | Отложено | Нет доступа к applicationHost.config; dynamic compression через ARR для SSE — отдельный риск. JSON-мидлварь закрывает потребность |
| Prefetch страниц >1 / увеличение `PAGE_LIMIT` | Отложено | Нужны замеры на реальной БД; сейчас 1000/стр + SWR |
| НК-индексы/FTS/keyset глубокого `OFFSET` | Снято 2026-09-16 | Прямой read-only опрос `sys.*` всех 4 БД: объёмы маленькие (`ITEMS` 288–2459 строк), нужные индексы уже есть (`IX_INV_NO`, `IX_SERIAL_NO`, `IX_CITYPE_BRANCH_LOC`, `IX_ITEM_ID` на истории). Не нужно на текущих объёмах; вернуться только при росте на порядок. Зафиксированные пробелы (не блокеры): нет индекса на `OWNERS(OWNER_DISPLAY_NAME)`, `DOCS` — HEAP, `DOCS_LIST` только по `DOC_NO` |
| SW-кэширование `/api` | Отклонено | Риск stale-данных; уже мешал E2E (кэшированный `/auth/me` давал редирект) |

## Замечания по эксплуатации

- E2E на preview: на origin регистрируется service worker — перед тестом с моками делать
  `unregister()` + `caches` clear, иначе stale `/auth/me` ломает авторизацию (видели редирект на /dashboard).
- Playwright route-моки: консультируются в обратном порядке регистрации — catch-all `**/api/**`
  регистрировать первым. Glob `*` — один сегмент пути, `**` — любой.
- Baseline для сравнения: Database-чанк 395.11 KB raw / 116.28 KB gzip до lazy-сплита.
