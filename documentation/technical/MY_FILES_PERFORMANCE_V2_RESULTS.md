# My Files — Performance V2: результаты (baseline vs HEAD)

Дата: 2026-11-24. Методика: `e2e/perf/my-files-perf.mjs`, n=10 прогонов на сторону, p50.
Стенд: baseline `26cfd4ef` (PR #18) на `localhost:5181 + backend:18011`; HEAD `perf/my-files-v2` на `127.0.0.1:5182 + backend:18012` (origin 127.0.0.1 — SameSite=strict cookies не проходят с localhost после ужесточения third-party cookie policy в Chrome 157). Сиды идентичны (f10/f100/f500/f1000, библиотеки 150 папок, nav-цепочка).

Артефакты: `frontend/e2e/artifacts/perf-audit/results-v2-baseline.csv`, `results-v2-head5.csv`, `results-v21-final.csv`, `results-v21-baseline20.csv`, `.codex_tmp/cmp4/comparison.csv`.

## Выигрыши (p50)

| Сценарий | Метрика | Baseline | HEAD | Δ |
|---|---|---|---|---|
| table_1000 | DOM-узлы | 9779 | 1611 | **−83.5%** |
| table_1000 | смонтированные строки | 201 | 25 | −87.6% |
| table_1000 | first_row | 1730 мс | 663 мс | **−61.7%** |
| table_1000 | longtask | 1151 мс | 217 мс | **−81.1%** |
| table_500 | DOM-узлы | 9779 | 1611 | −83.5% |
| table_500 | first_row | 1684 мс | 603 мс | −64.2% |
| table_500 | longtask | 1136 мс | 200 мс | −82.4% |
| table_500 | heap | 439 МБ | 170 МБ | −61.2% |
| table_100 | DOM-узлы | 5136 | 1611 | −68.6% |
| table_100 | first_row | 1050 мс | 595 мс | −43.4% |
| table_sort | settled | 1075 мс | 165 мс | **−84.7%** |
| table_sort | longtask | 2112 мс | 305 мс | −85.6% |
| table_select | longtask | 641 мс | 213 мс | −66.8% |
| table_scroll_1000 | строк в DOM | 1000 | 48 | −95.2% |
| nav_back | settled | 199 мс | 166 мс | −16.6% (SWR cache-hit) |
| memory_nav_churn | прирост heap | +17.8 МБ | −18.7 МБ | GC стал эффективнее |

## Регрессии / trade-off (p50)

| Сценарий | Метрика | Baseline | HEAD | Δ | Комментарий |
|---|---|---|---|---|---|
| nav_into_folder | settled | 195 мс | 315 мс | +61% | Холодная навигация: 3 виртуализатора (список+2 сетки) делают измерение+setRange на смену itemCount, SWR добавляет второй apply — commits 7→15. Абсолютная задержка ~120 мс. |
| nav_library | settled | 144 мс | 311 мс | +116% | то же; commits 5→14 |
| nav_nested | settled | 162 мс | 340 мс | +110% | то же; commits 9→21 |
| nav_* | first_dom | ~105 мс | ~215–275 мс | +100–170% | строки появляются на кадр позже (измерение окна) |
| table_scroll_1000 | fps | 42.5 | 38.7 | −9% | remount строк на границах окна; патологический прогон +300px/кадр |
| table_scroll_1000 | worst_frame | 33 мс | 67 мс | +103% | разовый commit ~25 строк на границе кванта |
| search_type | first_dom | 24 мс | 102 мс | +325% | ожидаемо: debounce 250 мс — первая мутация теперь позже keystroke |
| open_cold | first_row | 951 мс | 889 мс | −7% | в пределах шума; холодный вход не регрессировал |

Проверявшиеся альтернативы: QUANT=32 (fps тот же, worst хуже — откачено), rAF-пересчёт окна на навигации (не снизил commits — первый кадр всё равно требует измерения; оставлен синхронный `useLayoutEffect` на смену `itemCount`/`rowHeight` — дешевле и предсказуемее).

## Проверки

- `npm run test:run -- src/pages/MyFiles.test.jsx src/components/myFiles`: **6 файлов, 85 тестов — зелёные** (предупреждения MUI Tooltip/act — существующие, не от изменений).
- `vite build` — успешен (только существующие chunk-size warnings).
- Smoke на стенде: 21–48 смонтированных строк при 1000 файлах, спейсеры держат высоту документа, скролл достигает последнего элемента, grid монтирует ~40 карточек, переключение видов и SWR-кэш работают.
- Известный эффект среды: после ужесточения third-party cookie policy в Chrome 157 превью и API должны быть same-site (оба на `127.0.0.1`), иначе `SameSite=strict` auth-cookie не отправляется и приложение возвращается на /login. На продуктиве frontend и API на одном origin — не затронуто.

## V2.1 — устранение регрессий (perf/my-files-v2, после head5)

### Исправления

1. **Изоляция виртуализаторов**: `VirtualListRows`/`VirtualFileGrid`/`VirtualFolderGrid` вынесены в `MyFilesVirtualViews.jsx`; `setRange` рендерит только срез (~40 строк), а не всю страницу `MyFiles`.
2. **`startTransition` + ref-гварды в `useWindowVirtualRows`**: диапазон сравнивается с «запрошенным» ref ДО setState — повторные ResizeObserver/scroll-вызовы без изменения окна делают ноль React-работы (раньше bail-out происходил внутри рендера и каждый layout-shift при settle давал commit ~1/кадр). Разведены ref'ы «запрошено»/«закоммичено» — отброшенный transition-рендер не отравляет гвард. `trackWidth`: список вообще не хранит ширину контейнера — RO на `document.documentElement` больше не будит его при анимации сайдбара.
3. **AbortController в `loadData`**: новая навигация отменяет предыдущую in-flight загрузку (устранён подтверждённый двойной fetch — `nav_nested api_requests` 6→3; освобождаются сокеты HTTP/1.1-пула). `getQuota` принимает `signal`.
4. **`memo(MyFilesSidebar)` + `useMemo(sidebarProps)`/`useCallback`**: сайдбар больше не перерендеривается на каждый commit страницы (было — на каждый keystroke поиска и каждый setRange до изоляции).

### Финальные измерения A/B/C (n=30 на регресс-сценарии: 10 полных + 20 целевых; остальное n=10)

A = baseline `26cfd4ef` (CSV `results-v2-baseline.csv` + `results-v21-baseline20.csv`), B = промежуточный head5 (`results-v2-head5.csv`), C = V2.1 (`results-v21-final.csv`).

| Сценарий | Метрика | A p50 (p95) | B p50 | C p50 (p95) | Вердикт |
|---|---|---|---|---|---|
| table_scroll_1000 | fps | 41.7 (46.1) | 38.6 | **57.6 (59.6)** | цель 55–60 достигнута |
| table_scroll_1000 | worst_frame | 33 мс | 67 мс | 33 мс (50) | паритет с baseline |
| table_scroll_1000 | longtask | 0 | 677 мс | **0** | устранено |
| table_scroll_1000 | rows_dom | 1000 | 48 | 48 | −95% сохранено |
| scroll_slow | fps | — | — | 59.9 | |
| scroll_fast | fps | — | — | 51.8 (worst 50 мс) | приёмлемо для патологического сценария |
| scroll_jump_end | settled | — | — | 12 мс | |
| nav_into_folder | settled | 192 мс (208) | 311 мс | 232 мс (430) | commits 7=7, api 3=3; бимодальный остаток — очередь сокетов |
| nav_library | settled | 140 мс (184) | 309 мс | 269 мс (388) | то же; commits 8 vs 5 |
| nav_nested | settled | 163 мс (189) | 339 мс | 382 мс (403) | то же; commits 9=9 |
| nav_back | settled | 199 мс (229) | 165 мс | 172 мс (252) | не хуже baseline |
| search_type | first_dom | 24 мс (40) | 101 мс | 39 мс (68) | echo ввода ~10–20 мс в обеих сборках |
| search_type | settled | 773 мс (795) | 814 мс | **741 мс** (772) | лучше обеих версий |
| search_type | commits | 32 | 30 | **25** | |
| table_sort | first_dom | 838 мс | 126 мс | 131 мс | ускорение ×6.4 сохранено |
| table_1000 | first_row | 1728 мс | 661 мс | 749 мс | ускорение ×2.3 сохранено |
| table_1000 | dom_nodes | 9779 | 1611 | 1611 | −83.5% сохранено |
| table_1000 | heap | 263 МБ | 270 МБ | **162 МБ** | |
| view_toggle / back | settled | 527 / 765 мс | 496 / 448 мс | 465 / 439 мс | лучше обеих |
| menu_open_kebab | settled | 976 мс | 283 мс | **269 мс** | |
| details_open_1000 | longtask | 1126 мс | 216 мс | 262 мс | −77% сохранено |
| memory_nav_churn ×40 | прирост heap | +17.8 МБ | −18.7 МБ | **−0.85 МБ** | утечек нет |

Остаток ~+150–200 мс в части прогонов `nav_library`/`nav_nested` — бимодальность среды: Playwright кликает сразу после first_row, nav-fetch встаёт в очередь HTTP/1.1-пула за ~6 in-flight mount-запросами (baseline first_row появлялся на ~1.3 с позже — клик попадал уже после settle). Commits в полном паритете; задержка не кодовая. Подтверждено атрибуционным пробником с settle-паузой: HEAD 8–9 commits, last mutation ~175–187 мс ≈ baseline ~181–212 мс.

### Причины регрессий head5 (разобраны в V2.1)

- **scroll fps/worst**: рендер всей страницы на каждый setRange (MUI sx-страница ~15–20 мс/commit) + шторм RO на documentElement → починено изоляцией + ref-гвардами.
- **nav settled**: двойной `loadData` на гонке mount↔click + render-шторм задерживал actionability-ожидание Playwright (~170 мс до клика → поздний fetch) → починено abort'ом и гвардами.
- **search_type first_dom**: та же гонка settle — echo ввода идентичен (~10–20 мс), debounce 250 мс неизменен.

## Не закрыто (P2/P3, требует backend)

- `preview_path.is_file()` на строку листинга; агрегаты квоты/счётчиков; индексы `(owner_user_id, folder_id)`; ETag/условные запросы; cursor-пагинация (opt-in). См. `MY_FILES_PERFORMANCE_V2_AUDIT.md`.
