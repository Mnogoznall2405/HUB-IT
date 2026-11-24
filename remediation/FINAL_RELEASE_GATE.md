# FINAL RELEASE GATE — frontend remediation (без Sticker V2)

Дата: 2026-11-24
Ветка-кандидат: `integration/frontend-remediation-final` (worktree `C:\Project\HUB-IT-final`)

## 1. SHA

| | SHA | Примечание |
|---|---|---|
| Исходный (удалённая интеграционная ветка) | `a18fc5e7` | origin `integration/frontend-remediation`, верифицированный sign-off |
| Cherry-pick owner-fix | `e68ab6a0` | из `d50ca236` — Networks.jsx `.MuiModal-root` visibility + Login.jsx inert chrome; Sticker V2 не содержит |
| Финальный | `32bd103f` | `e68ab6a0` + фикс post-auth remount + регрессионный тест + E2E-стенд |

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
| **Browser E2E** `e2e/remediation-p0.spec.js` (стенд `local_backend_p0.py`, port 18002/5199, `AUTH_2FA_POLICY=all`) | **2/2 green** |
| Полный vitest | 5147 pass / 12 fail в 7 файлах — все подтверждены pre-existing (см. ниже) |

## 4. P0 E2E — покрытие

- **FE-0197/FE-0198** — полный 2FA flow в реальном браузере: password → TOTP setup (QR + ручной ключ) → verify → **backup-коды показываются** → hold удерживает `/login` до коммита UI-шага. Ранее воспроизводился баг: navigate `/about` до показа экранов — устранён фиксом §2.
- **FE-0059/FE-0083** — реальные вкладки с общей cookie jar: single-flight refresh (ровно 1 запрос ротации на N вкладок), потеря ответа в grace ≠ logout, отказ ротации → logout во всех вкладках.
- **FE-0232** — делегаты сохраняются при сбое bulk-загрузки: `useAccountSectionData.delegates` + `UsersTab.delegates`.
- **FE-0239** — запоздалый ответ D1 не изменяет данные D2: `DepartmentsTab.race`.
- **FE-0259** — дневная сводка/недельный план: F5, beforeunload, leave-guards, чистое состояние без ложных предупреждений: `ConstructionDirectionDetail` (14 тестов).

## 5. Реестр статусов (ревизия по 324 записям)

| Тир | Кол-во | Критерий |
|---|---|---|
| VERIFIED_FIXED | 7 | браузерный E2E или P0-юнит подтверждение на итоговом SHA (FE-0059/0083/0197/0198/0232/0239/0259) |
| IMPLEMENTED | 260 | commit/PR head — ancestor интеграционного SHA; покрыто зелёным unit-suite |
| PARTIALLY_FIXED | 2 | FE-0023 (perf 10k портов не измерен), FE-0215 (EWS-контракт не проверен) |
| BLOCKED | 1 | FE-0064 — PR #10 сознательно исключён, решение владельца |
| NEEDS_EVIDENCE | 0 | — |
| OPEN | 5 | FE-0030/0038/0039/0065/0077 — confirmed-дефекты вне scope (не переведены в REJECTED) |
| REJECTED | 49 | с основаниями |

Машиночитаемый реестр: `PROGRESS.json` → `issues[].verification` + `summary.byTier`.

## 5a. Падающие тесты на финальном SHA — атрибуция

12 падений в 7 файлах, все chat/AI/Database-домены. Проверено: файлы `useChatAiStatusPolling`, `chatNotifications`, `useChatComposePrefillBootstrap`, `Database` падают идентично на `e68ab6a0` без фикса (stash-проверка); `TaskWorkspacePanel`, `Chat.test`, `ChatPageContent.smoke` — те же падения, а дельта коммита (13 строк в `PostAuthChatCallsProvider` + тест-файл + e2e-артефакты) физически не может на них влиять (page-level тесты не рендерят `App`). Вывод: **ноль новых регрессий от финального коммита**. `ChatPageContent.smoke` — документированный baseline-fail на `origin/main`.

## 6. Оставшиеся ограничения

- `ChatPageContent.smoke` — baseline-fail, подтверждён на чистом `origin/main` (не регресс интеграции).
- E2E, требующие SQL Server, — вне локального стенда (seed-стенд на SQLite).
- FE-0023: измерение 10 000 портов (время первого кадра, long tasks, DOM count, heap, прокрутка) не проведено — нет данных такого объёма на стенде.
- FE-0215: проверка EWS-контракта требует Exchange — не проверена.
- 5 OPEN-записей — на решении владельца.
- Sticker V2 (PR #69 + 85 WIP-файлов владельца) — отдельный последующий этап.

## 7. Сохранность WIP владельца

Worktree `C:\Project\HUB-IT-integration` (`integration/frontend-remediation` @ `e6aa9251`+WIP) зафиксирован read-only и **не изменялся**: 85 WIP-файлов, staged `ChatThread.test.jsx` — на месте. Команды reset/clean/stash/checkout/rebase/add в нём не выполнялись. Локальная `integration/frontend-remediation` не двигалась; remote-ветка не перезаписывалась; force-push/merge в main/deploy не выполнялись.

## 8. Артефакты стенда (в ветке)

- `WEB-itinvent/frontend/e2e/stack/local_backend_p0.py` — обёртка local_backend (port 18002, `AUTH_2FA_POLICY=all`, отдельный `.state-p0`, test-only Fernet для challenge-store).
- `WEB-itinvent/frontend/e2e/remediation-p0.config.js` + `remediation-p0.spec.js` — Playwright P0-спека (2 теста).

Запуск: `cd WEB-itinvent/frontend && $env:E2E_LOCAL='1'; npx playwright test --config e2e/remediation-p0.config.js`
