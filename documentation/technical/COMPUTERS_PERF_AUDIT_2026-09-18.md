# Компьютеры — аудит вкладки и план оптимизации загрузки и быстрого поиска (2026-09-18)

## Итог

Вкладка «Компьютеры» медленно грузится и медленно ищет по одной общей причине:
каждый запрос списка/summary делает полный скан всех ПК в Python, а фронт
усугубляет это тремя параллельными тяжёлыми запросами на загрузку, ввод и poll.
Быстрый поиск невозможен, пока дефолтные поля поиска включают
`network/location/database` — этот путь принципиально обходит индекс.

Документ — read-only аудит без изменений кода. Реализация — по фазам ниже.

## Область и файлы

- Фронт: `WEB-itinvent/frontend/src/pages/Computers.jsx` (~2095 строк)
- API-клиент: `WEB-itinvent/frontend/src/api/equipmentComputers.js`
- Тесты фронта: `WEB-itinvent/frontend/src/pages/Computers.test.jsx`
- Бэкенд: `WEB-itinvent/backend/api/v1/inventory.py`
  - построение поискового текста: `~1350-1464`
  - сбор записей: `_collect_scoped_computer_records`, `~1743-1952`
  - поиск + пагинация: `_build_computers_search_payload`, `~2063-2234`
  - роуты: `/computers/summary` (`~2429`), `/computers/search` (`~2500`), `/computers` (`~2550`)
- Индексный слой: `WEB-itinvent/backend/appdb/inventory_store.py` (`list_hosts`, `search_host_keys`, `171-277`)

## Баги и слабые места загрузки (фронт)

1. Тройная нагрузка на каждое действие. Init (`Computers.jsx:931-960`), poll
   (`802-827`), возврат на вкладку (`963-985`), ручной refresh (`829-836`) —
   везде `search + summary + changes` (init/refresh — `Promise.all`, в
   poll/visibility — последовательные await, суммарно та же нагрузка). Бэкенд
   умеет отдать summary одним запросом (`include_summary`, `inventory.py:2081`),
   фронт его не использует (`equipmentComputers.js:64-78`,
   `Computers.jsx:760-768` — `includeSummary: false`).
2. Debounce 200 мс (`Computers.jsx:48,725-730`). Каждый debounce-огонь
   перезапускает init-эффект (deps `load`/`loadSummary` ← `searchFilterParams`),
   т.е. слово «петров» = до ~6 циклов × `search + summary (+changes)`. Abort
   есть, но sync-эндпоинты в threadpool не видят disconnect — сервер доделывает
   Python-скан впустую; реальной отмены нет, компенсируется удешевлением запроса.
3. Poll дорожает по мере скролла. `getBackgroundRefreshLimit()` (`732-735`) =
   `min(500, loadedCount)`. После прокрутки каждые 60–120 с (`45-47`) бэкенд заново
   собирает все записи и обогащает до 500 штук (Outlook, профили, сеть).
4. Бесконечный скролл хрупкий. `handleLoadMore` блокируется `inFlightRef`
   (`839`). Poll идёт с `silent: true` → `refreshing` не меняется → observer не
   пересоздаётся → единственное срабатывание на пересечении съедается poll'ом
   без retry — страница пропускается, пока sentinel не выйдет и не войдёт снова.
5. Скрыть/Вернуть сбрасывает список. `handleHideSelected/handleUnhideSelected`
   (`882-918`) перезагружают `limit: 50`, ручной refresh — `limit: loadedCount`.
   Позиция скролла теряется.
6. Гонка детального drawer. `openComputerDetail` (`863-880`) без `requestId`/abort:
   быстрый клик по двум карточкам — ответ первого может затереть второй. Нет MAC —
   остаёмся с обрезанной карточкой без ошибки.
7. Нет виртуализации. Каждая карточка в `map` (`1437-1549`) заново считает
   `resolveOutlookMeta + resolveCardDriveUsage + resolveOutlookArchiveUsage +
   getStorageHealthStats`. При 200–500 карточках — просадка рендера.
   Ключ `mac || hostname || idx` нестабилен при пустом MAC.
8. `selected` не очищается при закрытии drawer; эффект `1049-1063` при каждом poll
   пересоздаёт `selected` (новый identity массива) — лишние рендеры.
9. `seenChangesByPc` растёт бесконечно в `localStorage` (`1071-1073,1082-1101`) —
   по ключу на ПК, без eviction.
10. Статистика врёт при ошибке summary. `statusRows/branchRows` (`1144-1173`) без
    `searchSummary` считаются только по загруженной странице (50 шт.), а «Всего ПК» —
    по `searchMeta.total`. Ошибки summary только в `console` (`707-710`).
11. Филиалы исчезают из фильтра. `branches` (`1103-1115`) строится из уже
    отфильтрованного summary + загруженных 50 — после выбора филиала остальные
    пропадают из dropdown.
12. Мелочи: `Grid md={2.4}` (`1261-1275`); тоггл локаций — `Box onClick` без
    `role=button`/клавиатуры (`1419-1428`); `formatTs` (`121-124`) даёт
    `Invalid Date` на ISO/ms.

## Почему поиск медленный (бэкенд)

1. Дефолт = полный скан. `COMPUTER_SEARCH_DEFAULT_FIELDS = все 7 полей`
   (`inventory.py:52-53`). `_resolve_scoped_host_keys` (`1727-1740`) возвращает `None`
   («грузи всё»), если в полях есть `network/location/database` (`54`). Любой
   дефолтный поиск с `q` идёт по пути «загрузить все хосты → обогатить →
   отфильтровать в Python» (`1458-1463`, `1406-1455`).
2. Обогащение до фильтра. `_collect_scoped_computer_records` (`1743-1952`) для
   каждого хоста делает `_enrich_status`, `_enrich_outlook_fields_light`, prefetch
   SQL-контекстов (`list_sql_contexts` — один батч-запрос, но по всем хостам ×
   всем доступным БД, `inventory_store.py:324-385`), и только потом
   фильтрует/сортирует/режет страницу.
3. Худший путь — `network` в полях. В `_build_computers_search_payload`
   (`2101-2148`) при `q + "network" in fields` сеть аттачится ко всем записям
   (открытие network-соединения, загрузка всего network-индекса, resolve на каждую
   запись) и только потом фильтр. `_search_network_mac_keys` (`1671-1696`) не используется.
4. Индексный путь тоже без индекса. `search_host_keys`
   (`inventory_store.py:193-277`) — `func.lower(col).like('%needle%')` по 4
   таблицам (hosts, user_profiles, outlook_files, sql_contexts) без
   `pg_trgm`/FTS; существующие btree-индексы этот паттерн не обслуживают.
   `profiles/outlook` грузят все совпавшие MAC без лимита. Guard в
   `_resolve_scoped_host_keys` (`1734`) шире необходимого: `search_host_keys`
   сама отклоняет только `network` (`198-199`), `location`/`database` уже ищет
   по `sql_context` (`252-269`). Плюс `db_ids=None` (`1737`) — индексный путь не
   ограничен БД пользователя, лишние хосты отбрасываются после загрузки.
5. Summary дублирует работу. `get_computers_summary` (`2429-2497`) снова вызывает
   `_collect_...` на все записи + отдельный network-attach. Каждая буква ввода =
   `search(full scan) + summary(full scan)` параллельно.
6. `list_change_events` — ×4 за цикл. `_load_changes` (`979-990`) через
   `app_store.list_change_events()` (`inventory_store.py:538-561`) читает все
   события и декодирует `diff_json/before_json/after_json` каждого. Вызывается
   2× в `/search` (`1786`, `2161`), 1× в `/summary` (через `_collect`), 1× в
   `/changes` — итого ~4 полных скана с JSON-декодом на каждый frontend-цикл.
7. Поиск — одна подстрока. `needle in haystack` (`1463`) — «PC-01 petrov» ничего не
   найдёт. Нет токенизации AND, нормализации `ё→е`, нормализации MAC, префиксного
   поиска по IP.
8. Сортировка и пагинация в Python (`1949-1951, 2150-2157`) вместо `LIMIT/OFFSET +
   ORDER BY` в БД.

## План

### Фаза 0 — замеры (до правок, обязательно)

- Зафиксировать baseline на тестовой БД (не prod): число хостов, p50/p95
  `/inventory/computers/search?q=`, `/summary`, poll на 200 записей.
- Добавить stage-тайминги в лог: `snapshot_load`, `sql_prefetch`, `network_attach`,
  `filter`, `trim` + `request id`.
- Без baseline эффект недоказуем; локальный бенчмарк не переносить на прод без оговорки.

### Фаза 1 — фронт, быстрые победы (1–2 дня, без бэкенда)

1. Один запрос вместо двух: `search` с `include_summary=true`; `loadSummary` /
   `getComputersSummary` удалить полностью — `_computer_summary` это дешёвый
   счётчик по уже собранным записям, отдельный запрос чистая потеря.
2. Debounce поиска 450–600 мс, минимум 2 символа (1 символ — по Enter), корректный
   abort + игнор stale-ответов.
3. Poll: база 120 с, потолок фонового refresh 200 (не 500), «обновлено N мин назад».
   На возврате вкладки — лёгкая проверка версии вместо полного рефетча (зависит
   от ETag Фазы 2.4; до неё — обычный refresh по текущему лимиту).
4. Починить: reload после hide с сохранением `loadedCount`; переподписку sentinel
   после poll; гонку drawer (AbortController на detail); стабильные ключи
   (нормализованный MAC); источник списка филиалов (кешировать нефильтрованный);
   очистку `selected` при закрытии; eviction `seenChangesByPc` (последние 500 + TTL 30 дней).
5. Мемоизировать карточку (`React.memo`, вынести `resolve*` в `useMemo`-мапу),
   ограничить «развернуть всё»; далее — виртуализация списка.

### Фаза 2 — бэкенд, основной выигрыш

1. Фильтры в SQL `WHERE` вместо Python-постфильтра — но не все одинаково.
   Переносимо дёшево: `branch` (`sql_context`), `status` (диапазоны
   `last_seen_at`: ≤12 мин online / ≤60 мин stale), `hidden` (`hidden_at`, уже в
   `list_hosts`), `changed_only` (`inventory_change_events`, `detected_at`
   проиндексирован). Требует материализации или остаётся постфильтром по суженным
   кандидатам: `outlook_status` (вычисляется из `payload_json` — хранимая колонка
   при upsert), `hide_vm_172` (нужны все IPv4, а колонка есть только у
   `ip_primary`).
2. Дефолтный поиск: сначала дешёвые поля через индекс; `location`/`database` уже
   поддержаны в `search_host_keys` (`252-269`) — достаточно сузить guard в
   `_resolve_scoped_host_keys` до `network` и передавать `db_ids=db_candidates`.
   Сеть искать по network-индексу через `_search_network_mac_keys` (сейчас dead
   code), `network_link` обогащать только для кандидатов на страницу (в не-search
   пути уже так).
3. `_load_changes` — одна загрузка на запрос: `detected_at >= cutoff` в SQL,
   changes_index без декода `diff/before/after`, переиспользовать между
   `_collect` и `_heavy_enrich` (сейчас 2× на `/search` + 1× на `/summary` + 1×
   на `/changes`).
4. Пагинация и сортировка в БД: `ORDER BY` только по хранимым колонкам
   (hostname — единственная сортировка фронта; status/outlook/changes —
   Python-сортировка по суженным кандидатам). Полная пагинация дефолтного списка
   = JOIN hosts↔sql_context с дедупликацией контекстов — это и есть основная
   работа фазы, а не `LIMIT/OFFSET` поверх текущего merge. Трим тяжёлых JSON уже
   ограничен `page_items` (`_heavy_enrich`), выигрыш — сужение `_collect`.
5. Лёгкий summary через `GROUP BY` в SQL + короткий кеш (10–30 с) по хешу
   фильтров + scope/db_candidates пользователя в ключе; для poll — `ETag/304` по
   `max(updated_at)` всех задействованных таблиц (hosts + sql_contexts +
   change_events), не только hosts.
6. Индексы: существующие btree (`user_name`, `file_path`, `branch_name`,
   `hostname`, `last_seen_at`, `hidden_at` и др.) уже есть и не обслуживают
   `lower(col) LIKE %..%`. Реально нужно: `pg_trgm` GIN по `lower()` для
   `hostname/user_login/user_full_name/ip_primary/file_path/profile_path/
   branch_name/location_name`; btree `sql_contexts.location_name`; композит
   `(db_id, mac_address)`/`(db_id, hostname)` для context-prefetch. Колонок
   `hosts.status`/`outlook_files.status` не существует — индексы под них не
   создавать (см. п.1 про материализацию).

### Фаза 3 — «быстрый поиск» как UX

- Мультитокенный AND, `ё→е`, casefold, нормализация MAC/IP, пресет
  «Только ПК/пользователь» (гарантированно быстрый индексный путь), подсветка
  `matched_fields`, недавние запросы, счётчик «первые 50 из N».
- Ориентиры (уточнить после Фазы 0): p95 поиска <500 мс на ~10k хостов,
  summary <300 мс, фон poll 200 записей <1 с.

### Фаза 4 — тесты и наблюдаемость

- Бэкенд: перф-тест на сиде ~5k хостов (лимит времени поиска/summary, контроль числа
  SQL-запросов).
- Фронт: тесты debounce/abort, гонки detail, sentinel после poll, hide без потери
  скролла, рендер 500 записей.
- Структурные логи стадий + корреляция с frontend `request id`.

## Проверки и риски

- Перепроверено по коду 2026-09-18: исправлены список индексов (Фаза 2.6),
  Фаза 1.1/1.3, уточнены sentinel/poll, guard `search_host_keys` и `db_ids`;
  добавлены `list_change_events` (×4 за цикл) и ограничение «abort не отменяет
  серверную работу». Остальные утверждения и номера строк подтверждены.
- Проверки в рамках аудита не запускались. Перед/после правок Фаз 1–2: `Computers.test.jsx`,
  `client.test.js`, backend-тесты inventory; для БД — upgrade/downgrade и проверка схемы
  на тестовой БД.
- Не проверены: реальный объём хостов и прод-тайминги; полный детальный payload
  (`_build_computer_detail_payload`, `inventory.py:2237+`); desktop/mobile-обёртки вкладки.
- Риски: изменения поиска/summary затрагивают публичный контракт и нагрузку на БД.
  Только через тестовую БД, замеры до/после, откат — предыдущая версия фронта +
  отключение новых индексов/кеша флагом. Рестарты PM2/IIS и действия в prod — только
  по явному запросу.

## Статус реализации (2026-09-18, после аудита)

### Сделано — Фаза 1 (фронт, Computers.jsx)

- 1.1: searchAgentComputers теперь вызывается с includeSummary: true; loadSummary() и
  вызовы getComputersSummary со страницы удалены — summary берётся из ответа /search
  (init, poll, manual refresh, visibility, hide/unhide, db-switch). Метод клиента и
  /computers/summary endpoint оставлены для прочих потребителей.
- 1.2: debounce 500 мс, минимум 2 символа; 1 символ — только по Enter
  (helperText «Минимум 2 символа — или Enter»).
- 1.3: AUTO_REFRESH_BASE_SEC=120, MAX=300, фоновый refresh ограничен 200 записями,
  индикатор «Обновлено: N мин назад» в шапке.
- 1.4: hide/unhide грузит limit=min(200, loadedCount) (loadedCount не теряется);
  sentinel ставит loadMorePendingRef при in-flight и добивается после завершения;
  openComputerDetail — 
equestId + AbortController (старый detail-запрос не
  затирает новый); ключи карточек — pcChangeKey (стабильные); список филиалов кешируется
  (cachedBranches из summary без branch-фильтра); selected очищается при закрытии
  drawer + abort detail; seenChangesByPc — eviction (500 записей, TTL 30 дней).
- 1.5: карточки вынесены в React.memo ComputerCard; cardMetaByKey — useMemo-мапа
  resolve* по записям.
- Проверки: itest run src/pages/Computers.test.jsx — 8/8; 
pm run build — успешно.
- Computers.test.jsx обновлён под новый контракт (includeSummary: true, summary в
  payload search, getComputersSummary не вызывается).

### Сделано — часть Фазы 2 (backend, без миграций)

- 2.2: _resolve_scoped_host_keys переписан — guard сужен с «любое динамическое поле»
  до только 
etwork; для location/database/user/identity/profiles/outlook
  используется search_host_keys + union с list_unassigned_host_keys (покрывает метку
  «Без привязки» и branch из network_scope) и list_mac_addresses_for_db_ids по
  name-map для database_name; для 
etwork — _search_network_mac_keys по индексу
  (conn+index поднимаются до _collect, переиспользуются attach-шагом — один индекс
  на запрос). search_host_keys расширен: payload_json LIKE (покрывает ip_list,
  current_user, папки профилей, производные outlook-пути; opt-in include_payload),
  employee_name LIKE для поля user. Fallback на полный скан: игла — подстрока
  outlook_status-слова (status не материализован) или network-индекс недоступен.
- 2.3: list_change_events(since_ts) — SQL cutoff по detected_at; /search грузит
  changes один раз (ранее — дважды за запрос, плюс отдельно /summary и /changes);
  /changes и detail-payload тоже с cutoff = 90 дней (HISTORY_RETENTION_DAYS).
- Проверки: pytest tests/test_inventory_computers_api.py tests/test_inventory_app_db_api.py
  tests/test_inventory_api.py — 34/34; py_compile обоих файлов — OK.

### Не сделано (отложено — нужны миграции/тестовая БД/замеры)

- Фаза 0: baseline-замеры (нет тестовой БД/окружения).
- 2.1: SQL-фильтры (hosts.hidden_at, sql_contexts.branch_name, size_bytes для
  outlook warning/critical, inventory_change_events для changedOnly, ip_primary
  для VM172) — частично уже косвенно выиграно индексным путём; status/outlook_status=ok
  не материализуются (отдельное решение: computed-column/upsert + backfill).
- 2.4: пагинация через JOIN (замена _load_inventory_snapshot SELECT *) + поле-мэппинг
  для лёгкой версии карточки.
- 2.5: summary GROUP BY + TTL-кеш 60–120с + last_change_at для ETag/304.
- 2.6: индексы (pg_trgm GIN для LIKE %..%, композитные для prefetch,
  outlook_files.mac+kind, sql_contexts.db+branch) — Alembic, после сверки схемы.
- Фаза 3–4: UI-полировка (skeleton/empty), метрики/логирование, ETag/304, зависимость
  от полей поиска.

### Дополнение — Фаза 2.1 (кандидат-ключи по фильтрам) и Фаза 0 (baseline)

- 2.1 реализована без миграций: _resolve_filter_host_keys строит SQL-кандидатов до
  загрузки снапшота и пересекает с поисковыми ключами:
  - ranch — list_host_keys_for_context(db_ids, branch) (два индексных запроса:
    mac-ключи контекстов + hostname-резолв) объединён с list_unassigned_host_keys
    (метка «Без привязки» и branch из network_scope не индексируются);
  - status — list_host_keys_by_status по диапазонам last_seen_at (online<=720с,
    stale<=3600с; NULL включается всегда — payload.timestamp может дать любой статус,
    сужение делает Python-фильтр);
  - changedOnly — list_changed_host_keys(since=30д) по inventory_change_events;
  - outlook_status и hideVm172 НЕ материализуются (confidence/пороги и ip_list
    в payload) — остаются Python-фильтрами поверх кандидатов.
- Любой сбой в резолве ключей откатывается на полный скан (как раньше); каждый
  кандидат-набор — надмножество, точность даёт существующий Python-фильтр.
- Фаза 0: scripts/perf/bench_inventory_store.py — SQLite-харнес, синтетика
  (2000 хостов, 1600 контекстов, 600 событий). Замеры (мин. из 3 прогонов):

  | Путь | Время |
  |---|---|
  | list_hosts() — старый полный путь | ~90 мс (2000 записей, decode payload) |
  | search_host_keys + list_hosts(keys) | ~25 мс + ~1 мс (1-7 записей) |
  | list_host_keys_for_context(branch) | ~12 мс (534) |
  | list_unassigned_host_keys | ~10 мс (1466) |
  | list_host_keys_by_status | ~6 мс (1200) |
  | list_changed_host_keys(30д) | ~4 мс (500) |
  | list_change_events(since=90д) vs все | ~10 vs ~12 мс (decode доминирует) |

  Выводы: индексный путь убирает decode/обогащение всех хостов при поиске и при
  включённых фильтрах; OR-JOIN по контекстам (mac OR hostname) оказался хуже полного
  пути (411 мс на SQLite) — заменён на два IN-запроса (0.9-12 мс). На SQLite
  lower() — только ASCII: для кириллических значений (ветки, hostname) добавлены
  raw-варианты IN/фолбэк на широкий набор; на PostgreSQL сравнение точное.
- Проверки: pytest tests/test_inventory_computers_api.py test_inventory_app_db_api.py
  test_inventory_api.py — 34/34; itest run src/pages/Computers.test.jsx — 8/8.

### Дополнение — кеш записей + ETag/304 (прагматичная Фаза 2.4/2.5)

- AppInventoryStore.data_version_probe() — лёгкий отпечаток БД (max(updated_at),
  count, count(hidden_at) для hosts; max/count для sql_contexts; max(detected_at),
  count для change_events) — три агрегатных запроса за ~мс.
- _computers_records_cache (OrderedDict LRU, TTL 60с, max 6 записей, lock) внутри
  _collect_scoped_computer_records: ключ = probe + все параметры фильтра/поиска/scope.
  Попадание возвращает shallow-copy записей — повторные /search (poll, пагинация,
  изменение offset/limit) и /summary переиспользуют коллекцию без повторного снапшота
  и обогащения. Инвалидация — сама собой через probe (hide/unhide, новые снапшоты,
  контексты, события меняют отпечаток) + TTL. При sort=post-filter внутри _collect
  кешируется уже отсортированный список.
- ETag/304: _inventory_data_etag() (weak, sha1(probe)) на /computers/search,
  /computers, /computers/summary. Клиент шлёт If-None-Match по ключу параметров
  (etagsRef, cap 20) — при совпадении сервер отвечает 304, страница обновляет только
  «Обновлено: …» и не трогает список/summary/meta. alidateStatus: 200|304 в
  searchAgentComputers; контракт getAgentComputers (массив) не тронут.
- Итого: poll при неизменных данных — 304 + ~2 лёгких запроса probe вместо полной
  сборки; повторные search/summary в пределах 60с — cache-hit без снапшота.
- Полный JOIN-пейджинг и материализация outlook_status остаются за рамками (нужна
  схема/миграция): post-фильтры по payload полями не дают корректного LIMIT на SQL.
- Проверки: pytest tests/test_inventory_* — 35/35; vitest client.test.js +
  Computers.test.jsx — 307/307; 
pm run build — успешно.

### Дополнение — Фаза 3 (мультитокен-поиск, пресет), Фаза 4 (перф-тест, логи), Фаза 2.6 (миграция)

- Поиск стал мультитокенным AND: запрос бьётся на токены по пробелам
  (_search_tokens, фолдинг = lower + ё→е). search_host_keys возвращает
  пересечение потокенных кандидат-наборов (надмножество AND-ответа); точность —
  _apply_search_filter с all-токен-проверкой по folded-haystack.
- MAC-нормализация: в haystack identity добавлен _normalize_mac; в SQL для
  hex-токенов (>=4 символа) добавлен replace-LIKE по mac_address без
  разделителей — 'aabbcc' находит 'AA-BB-CC-...'.
- SQLite-ограничение lower() (только ASCII) обработано честно: не-ASCII токен
  на SQLite -> search_host_keys возвращает None -> фолбэк на полный скан;
  на PostgreSQL folded-LIKE корректен. _folded_search_expr = lower+ё→е
  зеркалит Python-фолдинг на PG.
- _resolve_scoped_host_keys переписан потокенно: per-token union
  (static ∪ db-name ∪ network ∪ unassigned) -> пересечение -> scope-фильтр;
  unassigned/db-name/network множества строятся один раз и переиспользуются.
- UI: пресет-чип «Быстрый: ПК/пользователь» (searchFields=identity,user —
  гарантированно индексный путь, без network/dynamic). Счётчик «Показано X из N»
  и полевые чипы уже были.
- Фаза 4: tests/test_inventory_perf.py — сид ~5k хостов, 10 тестов: узость
  кандидатов, AND-семантика, MAC без разделителей, не-ASCII фолбэк, ё→е,
  границы status/changed/context ключей, <=6 SQL-запросов на токен (event
  listener), мягкий time budget.
- Структурный лог: computers_search rid= scope= q_len= filters= total= items= ms=
  + cache-hit debug; фронт шлёт X-Request-Id: cmp-<n> на каждый /search.
- Фаза 2.6: миграция 20260918_0118_inventory_search_indexes.py создана (НЕ
  применена): композитные btree (sql_ctx db+branch/db+mac/mac+db/host+db,
  outlook mac+kind, profiles mac+user, updated_at для probe) на обоих диалектах;
  pg_trgm GIN (hosts 4 колонки, profiles 2, outlook 2, sql_ctx 4) — только PG.
  Upgrade/downgrade проверены на SQLite через MigrationContext. Применение —
  после upgrade/downgrade на тестовой PG: CREATE EXTENSION pg_trgm требует
  привилегий; оценить размер GIN на объёме прод-базы.
- Проверки: pytest inventory_* + perf — 45/45; vitest — 307/307; build — ok.

### Дополнение — архив/удаление хоста и остаток Фазы 3 (matched_fields, skeleton, недавние запросы)

- Soft-hide переименован в архивную семантику: «Скрыть»→«В архив», «Вернуть»→
  «Из архива», чип «Скрыт»→«В архиве», фильтр «Скрытые»→«Архив». Механика та же
  (hidden_at/hidden_by/hidden_reason, hiddenOnly).
- Hard-delete: DELETE /inventory/computers/{mac} (computers.manage) ->
  AppInventoryStore.delete_host удаляет хост + user_profiles + outlook_files +
  sql_contexts (mac/hostname) + change_events (mac/hostname). 404/503. Кнопка
  «Удалить» в drawer с window.confirm (предупреждает: агент может пересоздать
  хост следующим отчётом — тогда нужен архив). Инвалидация кеша/ETag — через
  data_version_probe автоматически.
- matched_fields: /search добавляет в каждый page-item список полей поиска,
  где сработал хотя бы один токен (refactor _record_search_text ->
  _record_search_field_texts — полевые folded-haystack, поведение фильтра не
  изменилось). Карточка показывает «Совпадение: ПК, Пользователь».
- Начальный loading — skeleton-заглушки карточек вместо голого спиннера.
- Недавние запросы: localStorage (8 шт., dedupe, delete-чипы), клик — повтор
  поиска. Записываются при срабатывании debouncedQuery.
- Проверки: pytest inventory_* — 38/38 (+2 delete-теста); Computers.test.jsx —
  9/9 (+1 delete-тест); build — ok.
