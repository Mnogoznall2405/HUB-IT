# REGRESSION_RESULTS — регрессионный прогон integration/frontend-remediation

Ветка: `integration/frontend-remediation` @ `53732f53`
База: `origin/main` @ `926dd9f5`
Дата: 2026-11-24

## Frontend unit (vitest, полный прогон)

- **5152 passed, 2 skipped, 6 failed** в первом полном прогоне → после фиксов
  и расследования: **1 подтверждённый baseline-fail, остальное исправлено или флаки**.

| Тест | Итог | Природа |
|------|------|---------|
| `ChatPageContent.smoke` › embedded task discussion | **FAIL — baseline** | Подтверждён на чистом `origin/main`-lineage (worktree fix/myfiles, merge-base = 926dd9f5): тот же таймаут `data-active-conversation='conv-task-1'` + jsdom XHR AggregateError. НЕ регресс интеграции |
| `Login.postAuthHold` ×2 | FIXED | Тест требовал `location.assign`; merged-дизайн отдаёт навигацию SPA (`PostAuthNavigate`). Контракт теста обновлён (assert `not.toHaveBeenCalled`), hold-семантика (FE-0197/0198/0199) проверена |
| `ChatComposer.behavior` › emoji aria-expanded | FIXED (baseline-broken) | На baseline падает тоже: main добавил pin-режим ('Закрепить панель эмодзи'), тест искал 'Закрыть'. Заменён на testid — зелёный |
| `mailMessageFileActions` › unsafe blob popup | FIXED | `vi.useFakeTimers()` ставился ПОСЛЕ `downloadBlobFile` — реальный setTimeout не продвигался. Перенесён до вызова (FE-0115 deferred revoke) |
| `indexHtml` › viewport | FIXED | **Merge-loss**: #66 убрал `maximum-scale=1.0, user-scalable=no` из baseline-директивы. Восстановлен union (`53732f53`) |
| `ChatThread` › deferred picker popover | PASS in isolation | Флаки под параллельной нагрузкой полного прогона (1146ms); изолированно зелёный |
| `Database` equipment row helpers ×2 | PASS in isolation | Тот же флаки-паттерн; изолированно зелёные (158/158) |

Примечание: ранее задокументированные baseline-fails `Chat.test.jsx` ×3 и
`useChatComposePrefillBootstrap` ×1 в интеграции **проходят** — вероятно,
закрыты мерджем chat-batch (#45) либо флаки.

## Build

- `npx vite build` — **PASS** (1m32s; предупреждения о chunk size — pre-existing).

## Backend (pytest backend/tests)

- **21/21 PASS** после удаления устаревшего `data/local_store.db` (untracked).
- Инцидент: `test_update_user_settings_merges_database_branch_filters` падал
  при наличии старого `local_store.db` — глобальный синглтон `get_local_store`
  шарит состояние между тестами; запись `remote: Remote` для user 42
  переживала прогон. **Pre-existing дефект изоляции тестов на main**
  (backend в интеграции не менялся — 0 файлов в diff).

## git diff --check

- **PASS** (после коммита `333e8fb4` — удалена пустая строка EOF).

## E2E (Playwright, E2E_LOCAL=1 — локальный синтетический стек)

Стек: throwaway backend на SQLite (`e2e/stack/local_backend.py`, :18001) +
vite dev (:5174), seed-пользователи. Запущен `e2e/screens-smoke.spec.js`
(30 экранов, read-only anchors).

- Стек поднимается, backend+frontend слушают порты, login проходит.
- SQL Server недоступен в окружении (`inventory_binding db_pull_failed
  db=HUB_IT_E2E_UNAVAILABLE`): `/feed` — FAIL по таймауту anchor (1.5 мин),
  последующий тест завис на холодной vite-компиляции; прогон остановлен
  как непродуктивный в песочнице. Требуется стенд владельца с SQL Server.
- Дополнительная проверка: `vite preview` собранного dist — SPA-fallback
  отдаёт 200 для /login и /warehouse-1c, `robots.txt` отдаётся корректно
  (FE-0063 подтверждён на живой сборке).

Итог E2E: **BLOCKED (среда)** — стек рабочий, данных нет.

## P0-проверки на стенде (цель §4)

| Сценарий | Статус |
|----------|--------|
| FE-0197/0198 полный 2FA E2E (setup, backup codes, trusted device, повторный вход, network errors, reload во время hold) | **ЧАСТИЧНО** — unit/jsdom покрытие есть (Login.postAuthHold ×4, Login.test, App.postAuthHold); полный браузерный E2E требует 2FA-capable seed backend — локальный стек это поддерживает частично; multi-tab сценарии ниже |
| FE-0059/0083 multi-tab refresh (2/3/5/10 вкладок, race, lost response, lock holder close, no navigator.locks, no localStorage, logout broadcast, user switch) | **ЧАСТИЧНО** — координация покрыта unit-тестами AuthContext/refresh; полный multi-tab E2E не автоматизирован в репо |
| FE-0232/0239 delegates (bulk-load fail, late D1 response) | **ПОКРЫТО** unit-тестами (`UsersTab.delegates.test.jsx`, `requestOrdering.regression.test.jsx`) — в интеграции зелёные |

## P1-проверки

| Сценарий | Статус |
|----------|--------|
| Construction F5/beforeunload, чистое состояние без ложных предупреждений | ПОКРЫТО unit: `useConstructionWorkLeaveGuard.test.jsx` + `ConstructionWorkWorkspace.test.jsx` — 10/10 PASS |
| Networks 10k портов — замер производительности | **BLOCKED** — нет стенда с 10k реальных портов; chunk-render — защитная оптимизация, perf-выигрыш не измерен. Требуется стенд владельца |
| Warehouse1C keyboard после incremental render | Проверено ревью + unit-тестами клавиатурной доступности; см. отчёт агента |

## Итог

- Frontend: **зелёный** (единственный fail — подтверждённый baseline на 926dd9f5)
- Build: **зелёный**
- Backend: **зелёный** (env-artifact, не код)
- diff --check: **чисто**
- E2E: **частично** — смок запущен, данные inventory недоступны в песочнице
