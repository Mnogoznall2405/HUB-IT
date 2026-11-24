# My Files — Performance V2: результаты (baseline vs HEAD)

Дата: 2026-11-24. Методика: `e2e/perf/my-files-perf.mjs`, n=10 прогонов на сторону, p50.
Стенд: baseline `26cfd4ef` (PR #18) на `localhost:5181 + backend:18011`; HEAD `perf/my-files-v2` на `127.0.0.1:5182 + backend:18012` (origin 127.0.0.1 — SameSite=strict cookies не проходят с localhost после ужесточения third-party cookie policy в Chrome 157). Сиды идентичны (f10/f100/f500/f1000, библиотеки 150 папок, nav-цепочка).

Артефакты: `frontend/e2e/artifacts/perf-audit/results-v2-baseline.csv`, `results-v2-head5.csv`, `.codex_tmp/cmp4/comparison.csv`.

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

## Не закрыто (P2/P3, требует backend)

- `preview_path.is_file()` на строку листинга; агрегаты квоты/счётчиков; индексы `(owner_user_id, folder_id)`; ETag/условные запросы; cursor-пагинация (opt-in). См. `MY_FILES_PERFORMANCE_V2_AUDIT.md`.
