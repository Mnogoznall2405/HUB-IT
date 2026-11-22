# Архитектура фронтенда — карта и находки

## Стек

React 18.3 + Vite 7 + MUI 5 + Tailwind (Login/чат) + react-router-dom 7.18; axios
(общий `apiClient`); vitest (`unit-node`, `ui-dom`); Playwright e2e; PWA со stamped
service worker.

## Карта

- Вход: `main.jsx` → `App.jsx` (BrowserRouter, basename из BASE_URL).
  `AuthenticatedAppShell`: AuthProvider → ScrollToTop → AuthenticatedBootstraps (lazy,
  только после логина) → PostAuthChatCallsProvider (контекст-владелец статический,
  значение из lazy-чанка) → RouteErrorBoundary (chunk-recovery с hard reload).
- Маршруты: public `/login`, `/shared-files/:token`, `/shared-folders/:token`;
  `/about` (onboarding); защищённые `ProtectedRoute` + `PermissionRoute`
  (permissions/adminOnly) внутри `SharedHubRouteLayout`. 36 маршрутов, все lazy
  через `lib/routeLoaders.js`.
- Права: `AuthContext.hasPermission` + `routePermissions` (App.jsx:108–136);
  `MonitoringRoute` — объектный скоуп `?object=`; `AdminAreaRoute` — `canAccessAdminArea`
  (в отличие от adminOnly `role==='admin'` для /dlp, /file-egress).
- API: `api/http.js` — общий axios: Bearer, 401→refresh→retry, `auth-required`
  событие, «эпоха отказа», whitelist public-URL (FE-0006), mobile offline cache;
  доменные модули `api/*.js`; `client.js` — legacy re-export.
- Кэш: `lib/swrCache.js` (dedupe + in-flight join + инвалидация) — точечный, не глобальный.
- Realtime: chat WS (useChatSocketController и др.: reconnect/backoff/degraded-poll),
  push через AuthenticatedBootstraps.
- Polling: MainLayout hub-poll (20 c, visibility-gated, backoff), monitoring 10 c,
  FeedCommentsPanel 15 c.

## Сильные стороны (подтверждено)

- Стартовый бандл ~223 КБ gz; 38/38 lazy; тяжёлые либры dynamic import; guard-скрипт.
- Auth: refresh-гейт (один refresh на N параллельных 401), generation-токены,
  suppressAuthRequired для публичных файлов, восстановление после фоновой вкладки.
- Чат: keyed in-flight, seq-порядок, дедуп, backpressure (очередь ≤100), heartbeat.
- Детальные страницы сбрасывают состояние при смене route-параметра; abort+seq-guard.

## Архитектурные находки

| ID | Суть | Источник |
|---|---|---|
| FE-0030 | Networks.jsx ~80 useState / 3300 строк — god-component | агент C |
| FE-0038 | Двойная система стилей (Tailwind vs MUI) | агент A |
| FE-0039 | Light-only тема, противоречие с AGENTS.md | агент A |
| FE-0006 | Мёртвый whitelist public-URL в 401-цепочке: файловые и папочные эндпоинты обрабатываются по-разному | live + код |
| FE-0015 | Сессия чувствительна к смене UA — проверить UA-пиннинг бэкенда | live |
| — | swrCache точечный: Tasks/Statistics перезабирают данные при переключении вкладок (FE-0042/0045) вопреки правилу «update the cache instead of refetching» | live + агент C |
| — | Файлы-гиганты: MyFiles.jsx (138 КБ), Networks.jsx (146 КБ), Mail.jsx (112 КБ), Docflow.jsx (102 КБ), Warehouse1C.jsx (95 КБ) — lint-noise подтверждает | статика |

## Кросс-дефекты (одна причина — несколько страниц)

- Безымянные Autocomplete (ZWSP) — FE-0009: /tickets, /database, /mail, /my-files,
  /statistics, /warehouse-1c — один общий фикс-хелпер.
- MUI-лейблы без локализации («Open») — FE-0010: 4+ страницы.
- Дубли запросов на монтировании — FE-0005 (poll), FE-0012 (docflow), FE-0045 (tasks),
  FE-0054 (users/controllers): нет общего дедупа по (url, params).
- Кликабельные TableRow без клавиатуры — FE-0022 (Warehouse1C), FE-0035 (Networks).
- Диалоги без заголовка/имени — FE-0053 (create task) vs корректные в MyFiles/чате.
