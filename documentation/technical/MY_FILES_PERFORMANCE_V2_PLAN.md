# My Files — Performance V2: план оптимизации

Статус: реализовано и измерено. База сравнения — `baseline-dist` (коммит `26cfd4ef`, PR #18) на стенде `localhost:5181 + backend:18011`; кандидат — ветка `perf/my-files-v2` на `127.0.0.1:5182 + backend:18012`. Итоговые числа — `MY_FILES_PERFORMANCE_V2_RESULTS.md`.

## Карта узких мест (подтверждено замерами baseline, n=10)

| Приоритет | Узкое место | Доказательство (baseline p50) |
|---|---|---|
| P0 | Нет настоящей виртуализации: после «Показать ещё» монтируются все строки | `table_1000`: 201→1000 строк в DOM, 9779 DOM-узлов, longtask 1151 мс, heap до 539 МБ |
| P0 | Сортировка пересобирает все строки | `table_sort`: longtask 2112 мс, settled 1075 мс |
| P0 | Select-all обновляет все строки | `table_select`: longtask 641 мс |
| P0 | Открытие сведений на 1000 строк | `details_open_1000`: longtask 1130 мс |
| P1 | Меню: MUI Modal + scroll-lock рефлоу всего документа | `menu_open_first`: longtask 588 мс |
| P1 | Переключение список↔сетка = полный unmount/mount | `view_toggle`: 528 мс, `view_toggle_back`: 770 мс |
| P1 | Фильтрация/сортировка на каждый keystroke | `search_type`: settled 762 мс, 31 commit, до 6 API-запросов за ввод |
| P1 | `listFolders` (всё дерево) + квота на каждый переход | `nav_*`: 3 API-запроса на навигацию |
| P2 | Создание `Intl.DateTimeFormat` на строку | статический анализ `MyFilesListItems.jsx` |
| P2 | `entryAccess` — пересчёт прав на каждую строку каждого рендера | статический анализ `MyFiles.jsx` |
| P2 | Нет кэша листингов: повторный заход в папку = 3 запроса + скелетон | `nav_back`/`nav_nested` api_requests=3 |
| P3 | Backend: `preview_path.is_file()` на строку, агрегаты квоты/счётчиков, O(N) по библиотекам | backend-аудит `MY_FILES_PERFORMANCE_AUDIT.md`; без живого SQL-замера не закрывалось |

## Что сделано

1. **Настоящая window-виртуализация** (`useWindowVirtualRows`): видимые строки + overscan, спейсеры сохраняют высоту документа; список и обе grid-секции (папки/файлы). Окно квантовано по 16 строк — коммиты только на границах, а не на каждый scroll-кадр. Callback-ref стабилен (без per-render reattach).
2. **SWR-кэш листингов в памяти страницы**: ключ = вид|библиотека|папка|поиск, TTL 20 с, лимит 30 записей; при повторном входе мгновенный рендер + фоновая ревалидация; инвалидация `clear()` во всех точках мутаций (delete/move/rename/create/restore/purge/bulk/upload/copy/collaborators/versions). Поллинг и явный refresh обходят кэш на чтение, но пишут свежее.
3. **Debounced поиск** (250 мс): фильтрация/сортировка не пересчитываются на каждый keystroke; выбор/сброс остался мгновенным.
4. **`accessOfEntry` memo**: карта прав по id вместо пересчёта на строку.
5. **Общий `Intl.DateTimeFormat`** в `myFilesVisual.js`.
6. **`disableScrollLock`** на контекстных/фильтровых меню.
7. **`useMemo` для `allSelected`/`someSelected`**, стабильный `EMPTY_ARRAY` для сайдбара.
8. **Фиксированные высоты строк/карточек** (50px/58px/202px) — обязательное условие виртуализации.

## Остаточные направления (если метрики не уйдут в цель)

- Пагинация/cursor listing на backend — только opt-in, без слома мобильного/desktop клиентов.
- Backend: убрать per-row `is_file()`, кэш квоты, индексы `(owner_user_id, folder_id)`.
- Single-file status endpoint вместо полного листинга при поллинге обработки.
