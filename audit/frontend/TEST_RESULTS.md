# Результаты автоматизированных проверок

Дата: 2026-11-22. Окружение: production-сервер (read-only), Node из `tools/node-v24.14.0-win-x64-full`.

## ESLint

| Команда | Результат |
|---|---|
| `npm run lint` (chat) | **1144 проблемы: 1 error, 1143 warnings**. Error: `src/components/chat/chatRegressionFlows.test.jsx:426:1` — `'describe' is not defined (no-undef)` — тестовый файл без vitest-globals в ESLint-конфиге (FE-0017). Warnings — в основном `no-unused-vars`. |
| `npm run lint:mail` | **735 warnings, 0 errors** — почти все `no-unused-vars` в `Mail.jsx` (объёмные неиспользуемые импорты компонентов). |

## Vitest

| Набор | Результат |
|---|---|
| `npx vitest run src/api/client.test.js` | **265/265 passed** (2.95 s) — перехватчики 401/refresh/фан-аут покрыты и работают; NB: тест на public shared-file 401 (client.test.js:200) проверяет URL-паттерн, которого нет в рантайме (FE-0006) |
| `npx vitest run src/components/layout/MainLayout.test.jsx` | **67/67 passed** (26.4 s) |
| `npx vitest run src/App.publicRoute.test.jsx src/App.routeLayout.test.jsx src/App.routeErrorBoundary.test.jsx` | **13/13 passed** (4.8 s) |

## Браузерные проверки (production)

- 36/36 маршрутов открыты; консоль/сеть/переполнения сняты на каждой странице.
- Мутационные сценарии (тестовые данные, согласовано): задачи, папка MyFiles,
  сообщение чата, черновик письма — все выполнены, данные полностью зачищены.
- PASS-примеры: дебаунс поиска (1 запрос на 10 символов); drawer: open/Esc/фокус;
  redirect-ы по правам; deep-link `/it/requests/:ref`; невалидный `/shared-files/:token`;
  создание задачи с каскадной валидацией; диалоги MyFiles с корректными заголовками.
- FAIL-примеры: FE-0004 (анонимный `/shared-folders/:invalid` → /login), FE-0011
  (overflow /scan-center @1920), FE-0007 (410 вложения), FE-0014 (drawer без dialog-семантики),
  FE-0056 (удаление/перемещение черновика → 400, UI молчит).

## Не запускалось и почему

- `npm run build` — запрещено на production (пишет в `dist/`, который раздаёт IIS);
  пробная сборка не выполнялась: код не менялся, анализ бандла взят агентом C по существующему dist.
- Полный `npm run test:run` — не гонится целиком на production-сервере; запускались
  наборы, связанные с находками.
- Playwright E2E — не запускались (полный прогон требует стенда; отдельные spec —
  в NEXT_ACTIONS).
- Lighthouse — не запускался (см. NEXT_ACTIONS).

## Цикл 9 (локальный стек E2E_LOCAL=1, 23.11.2026)

- `npx playwright test e2e/auth-guards.spec.js`: **5/6 PASS**.
  FAIL: «non-admin is redirected out of the admin area» — expected /dashboard,
  received /admin. Разбор: не дефект продукта — operator имеет scan.tasks
  (authorization_service.py), scan.tasks ∈ ADMIN_AREA_PERMISSIONS →
  canAccessAdminArea=true. Ожидание спеки устарело → FE-0136.
- probe_zoom.mjs (прямой playwright, Chrome): dashboard/chat/my-files — без
  переполнений при 80/100/150%; scan-center — переполнение ~10-18px на всех
  масштабах (FE-0011). Evidence: probe-zoom-results.json, zoom-*.png.
- probe_cookies.mjs: свежий контекст — куки пустые, /login чист (гипотеза
  шаринга сессии между запусками опровергнута).
- probe_spy2.mjs: POST /auth/login для e2e_fresh → 200 → /about — штатный
  гейт онбординга (не дефект).

