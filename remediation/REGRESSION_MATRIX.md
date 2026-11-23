# REGRESSION MATRIX — обязательные проверки по областям

Заполняется по мере выполнения. Формат строки: batch | файлы | обязательные тесты | результат.

## P0

| Batch | Файлы | Обязательные проверки | Статус |
|---|---|---|---|
| auth-2fa | Login.jsx, AuthContext.jsx, App.jsx | vitest: Login 2FA flow (setup→backup codes, remember-device sheet); npm build; Playwright login spec при наличии стенда | pending |
| auth-refresh | http.js, AuthContext.jsx, backend auth.py | refresh matrix A–D (переиспользовать audit harness); pytest auth; vitest http-level координация вкладок | pending |
| account-delegates | useAccountSectionData.js, accountUserModel.js | строгий FE-0232 скрипт (11 checks): bulk 500 + Save без items:[]; control path | pending |
| account-departments | DepartmentsTab.jsx | строгий FE-0239 скрипт (8 checks): delayed D1 + Save D2; PUT id верный | pending |

## P1

| Batch | Файлы | Обязательные проверки | Статус |
|---|---|---|---|
| construction-drafts | ConstructionWorkWorkspace.jsx, useConstructionWorkLeaveGuard.js | строгий FE-0259 (11 checks): F5/close/route при dirty daily+weekly | pending |
| networks-perf | EquipmentTab.jsx, SocketsTab.jsx, Networks.jsx | baseline p50/p95/DOM/heap → after; desktop+mobile viewport; поиск/выбор не сломан | pending |
| warehouse-a11y | Warehouse1C.jsx | клавиатурный проход Tab/Enter/Space, focus-visible, axe-проверка строк | pending |

## Смоук-матрица на каждый PR

1. `npm run test:run -- <затронутые spec>` в WEB-itinvent/frontend.
2. `npx vite build --outDir <вне dist>` (не продакшн-deploy).
3. `git diff --check`.
4. Затронутый backend: `pytest -q tests/test_<area>.py`.
5. UI-видимые изменения: скриншот до/после (desktop 1366 и mobile 390), где поднимается стенд.
