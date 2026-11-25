# FINAL RELEASE GATE — frontend remediation (без Sticker V2)

Дата: 2026-11-24 (обновлено 2026-11-25 — release-gate closure)
Ветка-кандидат: `integration/frontend-remediation-final` (worktree `C:\Project\HUB-IT-final`)

## 1. SHA

| | SHA | Примечание |
|---|---|---|
| Исходный (удалённая интеграционная ветка) | `a18fc5e7` | origin `integration/frontend-remediation`, верифицированный sign-off |
| Cherry-pick owner-fix | `e68ab6a0` | из `d50ca236` — Networks.jsx `.MuiModal-root` visibility + Login.jsx inert chrome; Sticker V2 не содержит |
| Финальный | `32bd103f` | `e68ab6a0` + фикс post-auth remount + регрессионный тест + E2E-стенд |
| Release-gate closure | `cfc5e012` | `79093cb0` = `b435257c` (strict FE-0198 E2E + absorb cross-tab epoch race, FE-0083) + `8270d0f7` (strict FE-0059 lost-rotation E2E) + `79093cb0` (расширенная multi-tab матрица + CAS-claim + post-fix runtime-тесты FE-0232/0239/0259); `cfc5e012` добавляет gate-артефакты (chatcalls-lifecycle, fe0023-bench, serve-prod) |

## 2. Перенесённые исправления

1. **`e68ab6a0`** (cherry-pick `d50ca236`): глобальный Escape/Ctrl+S игнорировал закрытые keepMounted-модалки MainLayout; `inert` расширен на VPN/notice-баннеры при открытом trusted-device диалоге. Отклонено от переноса: staged-изменение мока `ChatThread.test.jsx` владельца (WIP, не переносится).
2. **Фикс post-auth remount (новый)**: `PostAuthChatCallsProvider` в `App.jsx` до логина возвращал `{children}` беz Provider, а после коммита пользователя оборачивал их в `ChatCallsContext.Provider`. Смена типа элемента на этой позиции → React **удалял и пересоздавал всё поддерево маршрутов** (RouteErrorBoundary → Routes → LoginRoute → Login). Последствия, подтверждённые браузерной трассой (instance-id + стеки удаления fibre):
   - уничтожалась вся state-машина post-auth flow Login (backup codes, trusted-device sheet);
   - unmount-cleanup нового/старого Login снимал `postAuthUiHold` → `PostAuthNavigate` коммитил навигацию на `/about` **до** показа обязательных экранов.

   Фикс: Provider оборачивает children **безусловно**; только mount lazy-чанка `ChatCallsProvider` гейтится `isAuthenticated()`. Регрессионный тест: `App.postAuthHold.test.jsx` — «does not remount the login route subtree when the user is committed» (проверен red→green: падает на старом коде, зелёный на фиксе).

## 3. Результаты проверок

| Проверка | Результат |
|---|---|
| Production build (`npm run build`) | green (~1m48s) |
| `git diff --check` | чисто |
| Targeted vitest (Login ×2, App.postAuthHold, AuthContext, client.js, route tests) | 338/338 green |
| P0-юнит (delegates bulk / late-manager race / construction guards) | 14/14 green |
| **Browser E2E** `e2e/remediation-p0.spec.js` (стенд `local_backend_p0.py`, `AUTH_2FA_POLICY=all`) | **5/5 green** (включая strict FE-0198 через виртуальный WebAuthn-аутентификатор на `localhost` и strict FE-0059 через серверную ротацию + отсечённый ответ) |
| **Browser E2E** `e2e/remediation-multitab.spec.js` (2/3/5/10 вкладок, no-locks, offline, logout-propagation, dead-storage) | **5/5 green** |
| Runtime-тесты PR #9 (post-fix) `e2e/runtime/fe0232* / fe0239* / fe0259*` | **3/3 green** |
| ChatCallsProvider lifecycle `e2e/runtime/chatcalls-lifecycle.cjs` (guest-lazy, login-mount, logout-unmount, user-switch remount) | **10/10 checks** |
| **FE-0023 perf A/B** `e2e/perf/fe0023-bench.cjs` на прод-билдах (10k портов + 10k розеток, mobile 390x844) | **verified**: settle 20.8s→1.9s, DOM 180591→2393 (~75x), heap 662→52MB, long-tasks max 10.3s→0.28s, scroll 25/25 janky→0; desktop-паритет |
| Координационный юнит-сюит (`http.js`, CAS-claim) | 276/276 green |
| Полный vitest | 12 fail в 7 файлах — A/B-верифицированы идентичные 10/132 fails на `926dd9f5` и final (те же имена, те же assert-ы); **ноль новых регрессий** |

## 4. P0 E2E — покрытие

- **FE-0197/FE-0198** — полный 2FA flow в реальном браузере: password → TOTP setup (QR + ручной ключ) → verify → **backup-коды показываются** → hold удерживает `/login` до коммита UI-шага. Ранее воспроизводился баг: navigate `/about` до показа экранов — устранён фиксом §2.
- **FE-0059/FE-0083** — реальные вкладки с общей cookie jar: single-flight refresh (ровно 1 запрос ротации на N вкладок), потеря ответа в grace ≠ logout, отказ ротации → logout во всех вкладках.
- **FE-0232** — делегаты сохраняются при сбое bulk-загрузки: `useAccountSectionData.delegates` + `UsersTab.delegates`.
- **FE-0239** — запоздалый ответ D1 не изменяет данные D2: `DepartmentsTab.race`.
- **FE-0259** — дневная сводка/недельный план: F5, beforeunload, leave-guards, чистое состояние без ложных предупреждений: `ConstructionDirectionDetail` (14 тестов).
- **Post-auth remount (§2)** — ChatCallsProvider lifecycle в реальном браузере: ленивый чанк не загружается у гостя на публичных маршрутах (`/about`, `/shared-files/*`), монтируется после логина, размонтируется при logout, перемонтируется чисто при смене пользователя (`chatcalls-lifecycle.cjs`, 10/10).
- **FE-0023** — мобильный 10k-рендер портов/розеток измерен на прод-билдах A/B (`fe0023-bench.cjs`): settle 20.8s→1.9s, DOM 180k→2.4k, heap 662→52MB, скролл 25/25 janky→0; десктопная виртуализация не затронута.

## 5. Реестр статусов (ревизия по 324 записям)

| Тир | Кол-во | Критерий |
|---|---|---|
| VERIFIED_FIXED | 8 | браузерный E2E / измеренный perf-бенч / P0-юнит на итоговом SHA (FE-0023/0059/0083/0197/0198/0232/0239/0259) |
| IMPLEMENTED | 260 | commit/PR head — ancestor интеграционного SHA; покрыто зелёным unit-suite; 23 записи без PR (commit-only: `1998a488`, `37317636`, `6d700d6b`) и 8 preventive из PR #67 (`5b9f7bd6`) повторно проверены `git merge-base --is-ancestor` на `cfc5e012` — все ancestor |
| PARTIALLY_FIXED | 1 | FE-0215 (EWS-контракт не проверен — нет Exchange-стенда) |
| BLOCKED | 1 | FE-0064 — PR #10 сознательно исключён, решение владельца |
| NEEDS_EVIDENCE | 0 | — |
| OPEN | 5 | FE-0030/0038/0039/0065/0077 — confirmed-дефекты вне scope (не переведены в REJECTED) |
| REJECTED | 49 | с основаниями (включая бывшие Suspected FE-0004/0051/0323/0324 — резолюция PR #67) |

Машиночитаемый реестр: `PROGRESS.json` → `issues[].verification` + `summary.byTier`.

## 5a. Падающие тесты на финальном SHA — атрибуция

12 падений в 7 файлах, все chat/AI/Database-домены. Финальная A/B-проверка: изолированный прогон 7 файлов на baseline-worktree `926dd9f5` (HUB-IT-stand-a) и на кандидате дал **идентичные 10/132 fails — те же имена тестов, те же assert-ы** (spy-called-0-times, canonical-route mismatch); `Database.test.jsx` прошёл на обеих сторонах. Дельта ветки затрагивала только `TaskWorkspacePanel.jsx`, физически не влияя на остальные файлы. Вывод: **ноль новых регрессий от финальной ветки**. `ChatPageContent.smoke` — документированный baseline-fail на `origin/main`.

## 6. Оставшиеся ограничения

- `ChatPageContent.smoke` — baseline-fail, подтверждён на чистом `origin/main` (не регресс интеграции).
- E2E, требующие SQL Server, — вне локального стенда (seed-стенд на SQLite).
- FE-0215: проверка EWS-контракта требует Exchange — не проверена.
- 5 OPEN-записей — на решении владельца.
- Sticker V2 (PR #69 + 85 WIP-файлов владельца) — отдельный последующий этап.

## 7. Сохранность WIP владельца

Worktree `C:\Project\HUB-IT-integration` (`integration/frontend-remediation` @ `e6aa9251`+WIP) зафиксирован read-only и **не изменялся**: 85 WIP-файлов, staged `ChatThread.test.jsx` — на месте. Команды reset/clean/stash/checkout/rebase/add в нём не выполнялись. Локальная `integration/frontend-remediation` не двигалась; remote-ветка не перезаписывалась; force-push/merge в main/deploy не выполнялись.

## 8. Артефакты стенда (в ветке)

- `WEB-itinvent/frontend/e2e/stack/local_backend_p0.py` — обёртка local_backend (`AUTH_2FA_POLICY=all`, отдельный `.state-p0`, test-only Fernet для challenge-store, `REFRESH_ROTATION_GRACE_SECONDS=10`, 6 seed-пользователей).
- `WEB-itinvent/frontend/e2e/remediation-p0.config.js` + `remediation-p0.spec.js` — Playwright P0-спека (5 тестов; origin `localhost` — Chrome WebAuthn отвергает IP-literal RP ID).
- `WEB-itinvent/frontend/e2e/remediation-multitab.spec.js` — многовкладочная матрица FE-0083 (sweep 2/3/5/10, no-locks, offline, logout-propagation, dead-storage).
- `WEB-itinvent/frontend/e2e/runtime/fe0232-delegates.cjs`, `fe0239-departments.cjs`, `fe0259-construction.cjs` — post-fix runtime-тесты PR #9 (стенд `local_backend.py` + vite dev).
- `WEB-itinvent/frontend/e2e/runtime/chatcalls-lifecycle.cjs` — ChatCallsProvider lifecycle: guest-lazy / login-mount / logout-unmount / user-switch remount (vite dev с `VITE_CHAT_ENABLED=1`).
- `WEB-itinvent/frontend/e2e/stack/serve-prod.mjs` + `e2e/perf/fe0023-bench.cjs` + `fe0023-results.md` — FE-0023 прод-билд A/B бенч (static+`/api` proxy; `serviceWorkers:'block'` обязателен — prod SW роняет страницу на in-app навигации).

Запуск P0-стенда: `cd WEB-itinvent/frontend && $env:E2E_LOCAL='1'; npx playwright test --config e2e/remediation-p0.config.js`
