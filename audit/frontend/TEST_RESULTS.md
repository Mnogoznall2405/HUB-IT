# Результаты автоматизированных проверок

Дата: 2026-11-22. Окружение: production-сервер (read-only), Node из `tools/node-v24.14.0-win-x64-full`.

## ESLint

| Команда | Результат |
|---|---|
| `npm run lint` (chat) | **1144 проблемы: 1 error, 1143 warnings**. Error: `src/components/chat/chatRegressionFlows.test.jsx:426:1` — `'describe' is not defined (no-undef)` — тестовый файл без vitest-globals в ESLint-конфиге (FE-0017). Warnings — в основном `no-unused-vars` (импорты/переменные без использования). |
| `npm run lint:mail` | **735 warnings, 0 errors** — почти все `no-unused-vars` в `Mail.jsx` (объёмные неиспользуемые импорты компонентов). |

## Vitest

| Набор | Результат |
|---|---|
| `npx vitest run src/api/client.test.js` | **265/265 passed** (2.95 s) — перехватчики 401/refresh/фан-аут покрыты тестами и работают; NB: тест на public shared-file 401 (client.test.js:200) проверяет URL, которого нет в рантайме (FE-0006) |
| `npx vitest run src/components/layout/MainLayout.test.jsx` | **67/67 passed** (26.4 s) |
| `npx vitest run src/App.publicRoute.test.jsx src/App.routeLayout.test.jsx src/App.routeErrorBoundary.test.jsx` | **13/13 passed** (4.8 s) |

## Браузерные проверки (production, read-only)

- 36/36 маршрутов открыты живьём; консоль/сеть/переполнения сняты на каждой странице (см. COVERAGE_MATRIX, PERFORMANCE).
- PASS-примеры: дебаунс поиска адресной книги (1 запрос на 10 символов); drawer уведомлений: open/Esc/фокус-возврат; redirect-ы по правам; deep-link `/it/requests/:ref`; невалидный `/shared-files/:token` → корректная ошибка.
- FAIL-примеры: FE-0004 (анонимный `/shared-folders/:invalid` → /login), FE-0011 (overflow /scan-center @1920), FE-0007 (410 вложения ленты), FE-0014 (drawer без dialog-семантики).

## Не запускалось и почему

- `npm run build` / `check:startup-bundle` на живом dist — запрещено (production; build пишет в `dist/`, который раздаёт IIS). Пробная сборка `npx vite build --outDir <вне dist>` не выполнялась: код не менялся, анализ бандла взят агентом C по существующему dist.
- Полный `npm run test:run` (оба проекта, сотни файлов) — сознательно не гонится целиком на production-сервере; запускались только наборы, связанные с находками.
- Playwright E2E — не запускались: полный прогон требует живого стенда; отдельные spec-файлы будут запускаться точечно после повторного входа (см. NEXT_ACTIONS).
