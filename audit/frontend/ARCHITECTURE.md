# Архитектура фронтенда — карта и находки

## Стек

React 18.3 + Vite 7 + MUI 5 + Tailwind (Login/чат) + react-router-dom 7.18; axios
(общий `apiClient`); vitest (проекты `unit-node`, `ui-dom`); Playwright e2e; PWA со
stamped service worker.

## Карта

- Вход: `main.jsx` → `App.jsx` (BrowserRouter, basename из BASE_URL).
  `AuthenticatedAppShell`: AuthProvider → ScrollToTop → AuthenticatedBootstraps (lazy,
  только после логина) → PostAuthChatCallsProvider (контекст-владелец статический,
  значение из lazy-чанка) → RouteErrorBoundary (в т.ч. chunk-recovery с hard reload).
- Маршруты: public `/login`, `/shared-files/:token`, `/shared-folders/:token`;
  `/about` (onboarding); защищённые через `ProtectedRoute` + `PermissionRoute`
  (permissions/adminOnly) внутри `SharedHubRouteLayout` (MainLayoutRouteShell, lazy).
  36 маршрутов, все страницы — `lazy()` через `lib/routeLoaders.js`.
- Права: `AuthContext.hasPermission` + `routePermissions` (App.jsx:108–136);
  `MonitoringRoute` — объектный скоуп по `?object=`; AdminAreaRoute — `canAccessAdminArea`.
- API: `api/http.js` — общий axios-инстанс, request/response-интерцепторы (Bearer,
  401→refresh→retry, `auth-required` событие, эпоха отказа, whitelist public-URL,
  mobile offline cache); доменные модули в `api/*.js`; `client.js` — legacy re-export.
- Кэш: `lib/swrCache.js` (dedupe + in-flight join + инвалидация) — используется точечно,
  не глобально (Statistics/Tasks вкладки им не покрыты).
- Realtime: chat WS (`components/chat/*Controller`, reconnect/backoff/degraded-poll),
  push через `AuthenticatedBootstraps` (ChatSocketBootstrap, syncChatPushSubscription).
- Polling: MainLayout hub-poll (20 c, visibility-gated, backoff), monitoring 10 c,
  FeedCommentsPanel 15 c.

## Сильные стороны (подтверждено агентами C/D и живыми проверками)

- Стартовый бандл ~223 КБ gz; 38/38 lazy; тяжёлые библиотеки dynamic import; guard-скрипт.
- Auth: refresh-гейт (один refresh на N параллельных 401), generation-токены,
  suppressAuthRequired для публичных файлов, восстановление после фоновой вкладки.
- Чат: keyed in-flight, seq-порядок, дедуп доставки, backpressure (очередь ≤100),
  heartbeat, backoff; черновики не теряются.
- Детальные страницы сбрасывают состояние при смене route-параметра; abort+seq-guard.

## Архитектурные находки

| ID | Суть | Источник |
|---|---|---|
| FE-0030 | Networks.jsx ~80 useState / 3300 строк — god-component; ввод перерисовывает страницу с картой | агент C |
| FE-0038 | Двойная система стилей (Tailwind vs MUI) | агент A |
| FE-0039 | Light-only тема, противоречие с AGENTS.md | агент A |
| FE-0006 | Мёртвый whitelist public-URL в 401-цепочке — файловые и папочные публичные эндпоинты обрабатываются по-разному | live + код |
| FE-0015 | Сессия чувствительна к смене UA (mobile-эмуляция сбросила логин) — проверить UA-пиннинг на бэкенде | live |
| — | swrCache существует, но применяется выборочно; «Update the object/query cache instead of refetching the whole page» (AGENTS.md) соблюдается не везде: Tasks/Statistics перезабирают данные при переключении вкладок (FE-0042/0045) | live + агент C |
| — | Mail.jsx (112 КБ), MyFiles.jsx (138 КБ), Networks.jsx (146 КБ), Warehouse1C.jsx (95 КБ), Docflow.jsx (102 КБ) — файлы-гиганты; lint noise (735 warnings только в mail) подтверждает зону риска | статика |

## Кросс-дефекты (общая причина — несколько страниц)

- Безымянные Autocomplete (ZWSP) — FE-0009: /tickets, /database, /mail, /my-files,
  /statistics, /warehouse-1c… — систематический паттерн, фиксится одним хелпером.
- MUI-лейблы по умолчанию без локализации («Open») — FE-0010: 4+ страницы.
- Дубли запросов на монтировании — FE-0005 (poll), FE-0012 (docflow/tasks), FE-0045
  (tasks): общий приём «инвалидация/дедуп по (url, params)» отсутствует.
- Кликабельные TableRow без клавиатуры — FE-0022 (Warehouse1C), FE-0035 (Networks).
