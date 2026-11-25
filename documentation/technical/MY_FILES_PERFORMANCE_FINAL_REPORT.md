# My Files — итоговый отчёт цикла Performance V2–V3.2

Дата: 2026-11-25. Статус: **завершён, влит в main** — PR #24 (V2/V2.2, ранее) и PR #68 (V3/V3.1/V3.2, merge-commit `a59bedbc`).

Поэтапные отчёты: [V2](MY_FILES_PERFORMANCE_V2_RESULTS.md), [V3](MY_FILES_PERFORMANCE_V3_RESULTS.md), [V3.1](MY_FILES_PERFORMANCE_V31_RESULTS.md), [V3.2](MY_FILES_PERFORMANCE_V32_RESULTS.md). Сырые данные харнесса: `frontend/e2e/artifacts/perf-audit/results-*.csv`.

## Состав цикла

| Раунд | PR | Тема |
|---|---|---|
| V2 | #24 | Виртуализация строк (3 виртуализатора), SWR-кэш листингов, отложенный skeleton |
| V2.2 | #24 | SWR security: cache-paint гварды для shared/trash/library, select-all под abort |
| V3 | #68 | Backend: covering-индексы, `include=tree,quota`, aggregate ETag/304, keyset-пагинация, union-merge библиотек |
| V3.1 | #68 | UI-пагинация (150 строк/страница, prefetch), cost-fix ETag-отпечатка (50→3 мс), memory-фиксы, inert-строки при смене контекста |
| V3.2 | #68 | ETag-корректность по контексту, velocity-gated page apply, удаление deploy-шима с жёстким reload, P1-харденинг, post-review дефекты |

## Итоговые измерения (baseline до цикла → merged state)

Клиент, медианы n=30, изолированные стенды с идентичным сидом (171 папка / 16 804 файла):

| Сценарий | Метрика | Было | Стало | Δ |
|---|---|---|---|---|
| open_route (первый переход) | settled | 4 640 мс | **737 мс** | **−84 %** — корневая причина: deploy-шим с `location.reload()` |
| open_route | nav_retries | 1 в 100 % | **0 в 30/30** | потерянный клик сайдбара устранён |
| nav_back | settled / requests | 305 мс / 6 | **118 мс / 0** | −61 % / ETag-304 |
| nav_nested | requests / bytes | 3 / 2.0 KB | **1 / 300 B** | −67 % / −85 % |
| nav_rapid | settled | never | **456 мс** | впервые сеттлится |
| table_1000 | DOM-узлы / mounted rows | 9 779 / 201 | **1 611 / 25** | −83 % / −88 % |
| table_1000 | heap | 1 091 MB | **216 MB** | −80 % |
| table_5000 / 10000 | first_row / rows / heap | не открывались приемлемо | **~700 мс / 25 / <90 MB** | стоимость не зависит от размера папки |
| scroll_fast | worst_frame | 183 мс (V3.1) | **50 мс** | −73 % — velocity-gated apply |
| memory_nav_churn | рост heap | ~3 MB/цикл | **~0.8 MB/цикл** | ~4× |
| search_type / view_toggle / library_expand | settled | — | parity / parity / −11 % | без деградаций |

Сервер (live HTTP, p50):

| Операция | Было | Стало |
|---|---|---|
| revalidation неизменной папки | 87 мс / 42 KB | **20 мс / 0 B** (ETag→304) |
| f1000 page-1 `limit=150` | 132 мс / 888 KB (все 1000) | **68 мс / 134 KB** |
| ETag-отпечаток folder view | ~50 мс | **~3 мс** (scoped aggregates) |
| quota SUM | 28 мс | **20 мс**, index-only scan |

Нагрузка (SQLite WAL, авторизованные): all-200 при C=1…100; ~207 CPU-мс/req под конкуренцией; 2 uvicorn-воркера ≈ 2× throughput.

## Корректность и безопасность (V3.2 + post-review)

- **ETag**: контекст запроса в отпечатке (view/folder/include/cursor/sort/filters/viewer/role); рекурсивный обход поддерева с seen-guard; owner-wide агрегат квоты (count/max/sum) — size/create/delete/expire в любой папке вращает тег; `member.updated_at` (миграция 0179) видит in-place role-правки.
- **Кэш**: нет optimistic paint для shared/trash/library-скоупов; `hasLibrary` покрывает и папки библиотек; cache-entry привязан к auth-identity.
- **Пагинация**: поздние ответы/ошибки глушатся по идентичности fetch-записи — A→B и A→B→A не коммитят чужие страницы, не стирают выделение, не сбрасывают `loadingMore`; mutation tombstones против воскрешения удалённых строк; select-all под abort+context guard.
- **UI-изоляция**: устаревшие строки inert до прихода свежих данных; pending navigate переживает ремаунт оболочки (module-level timer).

## Проверки на merged HEAD `a59bedbc`

- Frontend: `vite build` зелёная; `MyFiles.test.jsx` **46/46**; `requestOrdering.regression.test.jsx` **17/17**.
- Backend: `tests/test_my_files_*` + revision-check — см. ниже; 4 фейла предсуществующие env (Kaspersky-сканер, Cyrillic temp-path, dbPool-литералы) — воспроизведены на чистом main, к коду ветки отношения не имеют.
- E2E `playwright my-files` (локальный стек): **92/92** — потребовало двух фиксов стека, влиты в ветку: `MAIL_CREDENTIALS_KEY` в `local_backend.py` и поднятие upload-caps (сид-цикл 30 файлов vs cap=5).
- Alembic: единственный head `20261124_0179`, цепочка `…0177→0178→0179` линейна; merge-ревизия `20260328_0010` исторически объединила ветки 0007/0009; идемпотентность + `CONCURRENTLY` проверены на PostgreSQL 17.
- Perf re-run на финальном билде: `open_route` 677 мс / 0 retries, `nav_back` 120 мс / 0 req — ускорение сохранено после всех фиксов.

## Известные оговорки

- `search_type`/`view_toggle` settled — структурные/косметические полы (debounce, MUI ripple teardown), не регрессии.
- Commit +150-страницы (~40–140 мс) ограничен монолитным компонентом страницы; выделение memoized rows-pane — возможный follow-up вне скоупа.
- `http.js` cross-tab refresh coordination (192 строки) вошла в состав ветки из параллельной работы этого же worktree — завершённый, самодостаточный auth-hardening; зафиксировано здесь явно.
- Предсуществующие env-фейлы тестов (4 шт.) не относятся к ветке и воспроизводятся на main.

## Что не сделано (по условиям задачи)

- Деплой и применение миграций на production — **не выполнялись**, ожидают отдельного разрешения. Порядок применения: [MY_FILES_MIGRATION_RUNBOOK.md](MY_FILES_MIGRATION_RUNBOOK.md).
- Новый этап оптимизации не начинался.
