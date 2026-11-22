# Агент C — Performance-аудит web-фронтенда HUB-IT

Дата: 2026-11-22. Режим: **read-only** (продакшен-сервер). Никакие файлы не изменялись, тесты/сборки/серверы не запускались. Инструменты: чтение файлов, ripgrep, PowerShell-чтение существующего `dist/` (только чтение, gzip-размеры посчитаны локально без записи).

Объект аудита: `WEB-itinvent/frontend` (React 18, Vite 7, MUI 5). Каждая находка проверена по коду; пометки Confirmed (подтверждено кодом/артефактами) и Suspected (структура подтверждена, влияние требует live-замера).

Метод сокращения: все маршруты — lazy; поэтому «горячий путь» = startup-бандл (страница входа) + чанки частых маршрутов (`/chat`, `/mail`, `/networks`, `/my-files`, `/dashboard`, `/statistics`, `/computers`, `/warehouse-1c`, `/login`).

---

## 0. Ключевые числа по существующему dist (сборка 20.11.2026, только чтение)

Startup (страница входа): `index-D8jumpjN.js` 152 КБ gzip + `vendor-react` 45 КБ + `vendor-router` 14 КБ + CSS 12 КБ ≈ **223 КБ gzip**. Recharts/excalidraw/xlsx/pdfjs/livekit в entry отсутствуют — проверено сканом содержимого entry-чанка и подтверждает работу guard-скрипта `scripts/check-startup-bundle.mjs` (он запрещает recharts/emoji-picker в entry и modulepreload).

Крупные **lazy**-чанки (грузятся только по действию пользователя): excalidraw-канвас ≈ 1,25 МБ gzip (`subset-shared` 727 + `percentages` 371 + `cynefin` 152), `xlsx.min` 316, `elk.bundled` 434, `livekit-client.esm` 151, `pdf.worker` (worker), `lottie_light` 165 raw, `emoji-picker` 302 raw, `CartesianChart` (recharts) 89.

Чанки маршрутов (gzip): ChatPageContent 189 (+ framer-motion 40), Mail 109 (+ framer-motion 40), MainLayout 64 (общий для всех страниц), Tasks 62, Database 298 raw, Networks 35, MyFiles 33, Computers 22, Monitoring 25 (+ CartesianChart 89), Warehouse1C 19, Login 16, Statistics 8.

Вывод: архитектура разбиения бандла в целом **хорошая**, тяжёлые библиотеки изолированы. Ниже — реальные проблемы.

---

## 1. Находки

### 1.1 [Высокая] Networks: мобильная вкладка «Оборудование» рендерит весь список портов без виртуализации — Confirmed

- Файл: `WEB-itinvent/frontend/src/components/networks/EquipmentTab.jsx:351-433` (мобильная ветка), `:203` (rowHeights), `:217-220` (окно виртуализации только для desktop-таблицы).
- Данные: `src/pages/Networks.jsx:871` — `getBranchPorts(id, { limit: 10000 })` («Все устройства», `resolveDisplayedPorts` → `allBranchPorts`, `src/pages/networks/networkResolution.js:35-47`); поиск: `Networks.jsx:1059` — `{ search, limit: 5000 }`.
- Код (EquipmentTab.jsx:359):
  ```jsx
  ) : isMobile ? (
    ...
    <Stack spacing={0.8}>
      {displayedPorts.map((port) => { ... <Card key={port.id} ...> ... })}
  ```
- Desktop-таблица виртуализируется (порог 120 строк, `TABLE_VIRTUALIZE_THRESHOLD`, спейсеры-«прокладки»), мобильная ветка — нет: все до 10 000 портов монтируются карточками `Card/CardActionArea` (каждая — несколько Typography + иконки). Плюс `rowHeights` (строка 203) считает высоты для **всех** строк даже там, где виртуализация не используется.
- Влияние на пользователя: на телефоне при выборе «Все устройства» в крупном филиале — тысячи DOM-узлов, задержка открытия вкладки на секунды, дрожание прокрутки; на слабых Android возможна почти полная блокировка UI.
- Категория: виртуализация длинных списков.
- Замечание: нужен live-замер на реальном филиале (кол-во портов неизвестно статически; лимит 10 000 — верхняя граница).

### 1.2 [Средняя] Networks: мобильная вкладка «Розетки» — то же, без виртуализации — Confirmed

- Файл: `src/components/networks/SocketsTab.jsx:220-229` — мобильная ветка `filteredSockets.map(...)` рендерит все розетки филиала карточками; окно виртуализации применяется только к desktop-таблице (`:140-159`).
- Данные: все розетки ветки грузятся целиком в `loadBranchContext` (`Networks.jsx:780-805`, `sockets` из context-запроса).
- Влияние: аналогично 1.1, масштаб зависит от филиала (/live-замер).

### 1.3 [Средняя] Networks/InteractiveMapCanvas: пересчёт кластеризации точек на каждое движение указателя при перетаскивании — Confirmed (структура), влияние — Suspected

- Файл: `src/components/networks/InteractiveMapCanvas.jsx:530-544`:
  ```jsx
  onPointerMove={(event) => { ... setDraggedPoint({ id: pointId, xRatio: ..., yRatio: ... }); }}
  ```
  Без rAF-троттлинга — `setDraggedPoint` на каждое событие pointermove.
- `clusteredPoints` (`:55-105`) — `useMemo` с зависимостью `draggedPoint`: на каждый pointermove пересчитывается кластеризация всех точек карты (внутри — проход по всем кластерам и `reduce` по их точкам, O(N·C)), затем полный ре-рендер всех маркеров.
- Влияние: при карте с сотнями-тысячами точек перетаскивание маркера «дрожит»; на мобильном (тач-двиг = поток pointermove) — заметные лаги. Требует live-замера на реальной карте (статически верхнюю границу не оценить).
- Категория: вычисления в горячем пути / перерендеры.

### 1.4 [Средняя] Networks: глобальный keydown-листенер пересоздаётся при каждом рендере — Confirmed

- Файл: `src/pages/Networks.jsx:2055-2074`:
  ```jsx
  useEffect(() => { ... window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener(...); },
    [editingPortId, displayedPorts, cancelEditPort, savePortEdit]);
  ```
- `cancelEditPort` (`:1862`) и `savePortEdit` (`:2011`) — обычные функции, не `useCallback`, а `displayedPorts` — новый массив после каждого поиска. Итог: при любом рендере страницы (в т.ч. на каждое нажатие клавиши в поиске портов/розеток/филиалов, при каждом ответе API) листенер снимается и ставится заново.
- Влияние: не баг, но постоянный churn на самом тяжёлом компоненте репозитория (3 300 строк JSX); вносит вклад в лаг набора текста в поиске. Само по себе дёшево — главный маркер того, что любые изменения состояния перерисовывают всю страницу (см. 1.5).
- Категория: подписки/перерендеры.

### 1.5 [Средняя] Networks: монолитный компонент ~80 useState — перерисовка всей страницы на любое действие — Confirmed (структура), влияние — Suspected

- Файл: `src/pages/Networks.jsx:138-311` — один компонент держит ~80 `useState` (поиск, диалоги, формы создания, черновики портов, карта, табы).
- Любое изменение (символ в `branchSearch`/`portSearch`/`socketSearch`/`mapPointSearch`, выбор чипа устройства, открытие диалога) перерисовывает весь компонент: все табы, карту со всеми маркерами (`filteredPointsForMap.map` в `Networks.jsx:2242` и в мобильных панелях `:3015/:3138`), все диалоги.
- Производные данные при этом хорошо мемоизованы (большой набор `useMemo`, строки 411-740), поэтому основной cost — reconciliation всего JSX-дерева.
- Влияние: на десктопе терпимо; на мобильном и на слабых машинах — лаг ввода в поисковых полях. Требует live-профиля (React Profiler) для количественной оценки.
- Категория: большие внутренние состояния / перерендеры.

### 1.6 [Средняя] MyFiles: массовое скачивание выбирает и качает все файлы параллельно, без очереди — Confirmed

- Файл: `src/pages/MyFiles.jsx:1332-1337`:
  ```jsx
  const handleBulkDownload = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    for (const file of selectedFiles) { void handleDownload(file); }
  }, [handleDownload, selectedFiles]);
  ```
- N выбранных файлов → N одновременных axios-запросов + N blob-объектов в памяти. Для нескольких десятков/сотен файлов: пиковая память, возможные обрывы и повторные запросы; браузер ограничивает соединения, часть запросов висит в очереди без прогресса для пользователя.
- Влияние: «Download all» по большой папке может подвесить вкладку и создать всплеск трафика.
- Категория: избыточные запросы.

### 1.7 [Средняя] Warehouse1C: списки остатков/движений/уволенных без виртуализации — Confirmed

- Файлы/строки: `src/pages/Warehouse1C.jsx:903/923` (склады уволенных — лимит 1000: `src/api/warehouse1c.js:315 getDismissedWarehouses({ limit: 1000 })`, вызов `Warehouse1C.jsx:1283`), `:1922/1970` (остатки, лимит 200 — `warehouse1c.js:112`), `:2121/2162` (движения, лимит 500 — `warehouse1c.js:186`).
- Все ветки (`isMobile` и desktop) рендерят массив целиком; строки (`DismissedWarehouseMobileRow` `:609`, `DismissedWarehouseDesktopRow` `:649`) без `memo`.
- Влияние: ведомость движений на 500 строк × 13 колонок ≈ 6 500 ячеек — заметная задержка отрисовки после ответа медленной 1C-интеграции; на мобильном хуже. В отличие от Networks/Database, здесь нет ни react-window, ни собственного окна рендера.

### 1.8 [Низкая] qrcode импортирован статически в чанке Login (и Passwords) — Confirmed

- Файл: `src/pages/Login.jsx:3` — `import QRCode from 'qrcode';`, используется только при настройке TOTP (`Login.jsx:718 QRCode.toDataURL`).
- Пакет `qrcode` (node-qrcode) тащит заметный объём кода в чанк самой первой страницы. В entry он не попадает (Login — lazy-маршрут), но утяжеляет первый экран входа для всех пользователей.
- Аналогично: `src/components/passwords/PasswordUnlockDialog.jsx:2` (статический импорт в чанке Passwords).
- Влияние: лишние десятки КБ gzip на первой странице (Login-чанк сейчас 16 КБ gz; qrcode внутри него/смежного чанка — требует live-замера веса, т.к. Vite мог вынести в общий чанк).
- Категория: тяжёлые библиотеки не через dynamic import.

### 1.9 [Низкая] SharedFile: ежесекундный re-render всей страницы без необходимости — Confirmed

- Файл: `src/pages/SharedFile.jsx:576-579`:
  ```jsx
  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);
  ```
- `nowMs` используется только для `formatCountdown(payload?.expires_at, nowMs)` (`:623`), т.е. нужен лишь когда ссылка имеет срок жизни и отсчёт вообще отображается. Сейчас тик идёт всегда, пока открыта публичная страница расшаренного файла.
- Влияние: небольшой, но постоянный перерендер публичной страницы (в т.ч. в фоне при открытой вкладке). Исправление тривиально: запускать интервал только при `payload?.expires_at`, останавливать по истечении.

### 1.10 [Низкая] Statistics: каждый переключатель вкладки/периода — новый запрос без кэша — Confirmed

- Файл: `src/pages/Statistics.jsx:290-296` — `useEffect(() => { loadActiveStats(); }, [loadActiveStats])`; `loadActiveStats` (`:259-282`) напрямую зовёт `jsonAPI.*` без `swrCache` (в отличие от Networks/Mail/Chat, где SWR с dedupe уже есть, `src/lib/swrCache.js`).
- Влияние: возврат на ранее открытую вкладку перезагружает те же данные; на медленном backend-JSON каждое переключение — видимая пауза. Плюс смена периода пересоздаёт все четыре загрузчика (`:239-257`).
- Категория: избыточные запросы / отсутствие кэша.

### 1.11 [Низкая] FeedCommentsPanel: опрос комментариев каждые 15 с + отдельный запрос на каждую раскрытую ветку — Confirmed

- Файл: `src/components/feed/FeedCommentsPanel.jsx:130-138`:
  ```jsx
  const intervalId = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void loadComments({ background: true });
    expandedRoots.forEach((rootId) => void loadReplies(rootId, { background: true }));
  }, 15000);
  ```
- При K раскрытых ветках каждые 15 секунд уходит K+1 запрос, пока панель открыта. Опрос не останавливается, когда комментарии не видны (лишь по `visibilityState` всей вкладки).
- Влияние: фоновая нагрузка на backend и вкладку при оставленной открытой панели; рост линейно числу раскрытых веток. Нужен live-замер частоты использования.

### 1.12 [Низкая/информация] framer-motion статически в чанках /chat и /mail — Confirmed

- `src/components/chat/ChatThread.jsx:27`, `ChatSidebar.jsx:35`, `ChatMessageList.jsx:18`, `ChatPageDesktopLayout.jsx:4`, `MailComposeDialog.jsx:29`, `MailMessageList.jsx:32` и др. — статические импорты; в dist это общий чанк `ForwardRounded-*` 40 КБ gzip, грузится вместе с чанком маршрута.
- Влияние: +40 КБ gzip к двум самым частым маршрутам. Учитывая повсеместные анимации — осознанный трейд-офф; кандидат на оптимизацию только при live-замере медленного первого открытия чата (например, `useReducedMotion` из framer-motion в `useChatPageInitialState.js:5` можно заменить нативным `matchMedia`).

### 1.13 [Низкая/информация] Monitoring: recharts грузится вместе с маршрутом до выбора устройства — Confirmed

- `src/pages/Monitoring.jsx:20` — статический `import MonitoringChart from './monitoring/MonitoringChart'`; `MonitoringChart.jsx:4` — статический импорт recharts. В dist: чанк Monitoring 25 КБ gz + обязательный `CartesianChart` 89 КБ gz (подтверждено: Monitoring-чанк ссылается на CartesianChart).
- В отличие от Tasks, где recharts вынесен в lazy и защищён тестом (`src/pages/tasks/Tasks.performance.test.jsx:52`), здесь графикам не хватает `lazy(() => import('./MonitoringChart'))` с fallback-скелетом: без выбранного устройства страница всё равно тащит 89 КБ gzip.
- Влияние: лишние ~89 КБ gzip при каждом первом открытии /monitoring.

### 1.14 [Информация] Excalidraw-канвас стоит ~1,25 МБ gzip JS — Confirmed

- `src/components/hub/tasks/TaskCanvasWorkspace.jsx` — единственный потребитель `@excalidraw/excalidraw`; он корректно ленив (`TasksDetailWorkspace.jsx:28`), в dist это отдельные чанки `subset-shared` 727 КБ gz + `percentages` 371 КБ + `cynefin` 152 КБ.
- Нарушения нет, но стоимость фичи высока: первое открытие «канваса» в задаче скачивает мегабайт кода. Стоит держать в голове при развитии (например, рассмотреть экспорт в PDF/изображение вместо полного редактора для view-only сценариев) — решение за владельцем.

---

## 2. Проверено и подтверждено как «хорошо» (находок нет)

- **Lazy-роутинг**: все 38 маршрутов через `lib/routeLoaders.js` (`App.jsx:65-106`), включая Mail/Chat/MyFiles; guard-скрипт `scripts/check-startup-bundle.mjs` автоматически запрещает попадание recharts/emoji-picker в startup и проверяет наличие lazy-чанков. `AuthenticatedBootstraps` (`App.jsx:294`) и чанк звонков (`App.jsx:390`) — lazy; пост-аутент инфраструктура не грузится на публичных страницах.
- **Тяжёлые библиотеки**: `xlsx-js-style` — только `await import` (`lib/excelPreview.js:77`, `lib/groupsAccessExport.js:27,88`); `pdfjs-dist` — dynamic + worker (`lib/pdfPreview.js:20-21,66-72`); `@excalidraw` — lazy-обёртка; `@xyflow/react` — lazy (`CompanyStructure.jsx:47`, `CompanyStructureAdmin.jsx:56`), `elkjs` — dynamic (`CompanyStructureOverview.jsx:48`); `livekit-client` — dynamic (`livekitSession.js:43`); `lottie-web` light — dynamic (`ChatStickerMedia.jsx:17`); `html5-qrcode` — dynamic (`useDatabaseQrScanner.js:281`); `emoji-picker-react` — lazy (`ChatEmojiPanel.jsx:11`, `ChatFileUploadDialog.jsx:18`) + регресс-тест; recharts в Tasks — lazy + perf-тест.
- **swrCache (`src/lib/swrCache.js`)**: dedupe in-flight, отсечение по возрасту/размеру (80 записей/30 мин), инвалидация по префиксу с отцеплением in-flight — грамотно; используется в Networks/Mail/Chat (устраняет дубль запросов StrictMode при монтировании и повторные фетчи).
- **Виртуализация там, где есть**: Networks desktop (свой `useVirtualizedTableWindow`, порог 120), EquipmentTable Database (своя виртуализация + memo-строки + infinite scroll), ScanCenter (`react-window` + AutoSizer), VoiceMeetingDrawer (`react-window`), GroupsAccess (`FixedSizeGrid/List`).
- **Chat**: окно рендера ленты ≤240 сообщений (`lib/chat/chatThreadRenderWindow.js:16-17`, `ChatMessageList.jsx:734`), `MemoChatBubble` с компаратором props (`ChatBubble.jsx:2275`), memo-строки сайдбара; опросы только при отключённом WS (6 с тред / 15 с список, `chatPageConstants.js:3-4`) с бэкоффом и cooldown 10 с.
- **Polling**: все интервалы адекватны и почти все гейтятся видимостью: Computers 120 с + min-gap 30 с (`Computers.jsx:52,56`); Monitoring 10 с visible-only (`Monitoring.jsx:153`); Mfu 60 с (`Mfu.jsx:49`); ScanCenter 3 с — только fallback при отсутствии SSE (`ScanCenterPage.jsx:1461`); AI-статус 1 с только при активном AI-прогоне и без WS (`chatPageConstants.js:6-7`); MyFiles adaptive 4→15 с только при-processing-файлах (`MyFiles.jsx:609-627`); AuthContext silent refresh ≥60 с (`AuthContext.jsx:475`); MainLayout notify-poll 20 с с релаксацией при живом realtime (`MainLayout.jsx:190-192,1577-1588`).
- **Утечки подписок**: не найдено. Все компонентные `addEventListener`/`setInterval`/Observer имеют cleanup (выборочно проверены Networks, Login, MainLayout, Mail, MyFiles, chat-hooks, AuthContext, PreferencesContext). Файлы с addEventListener без removeEventListener — модульные синглтоны на время жизни вкладки (chatSocket `ensureConnectivityWatchers` с защитой от повторного навешивания, photoUploadQueue, desktopBridge, main.jsx) — корректно. WebSocket-менеджеры (`lib/hubRealtimeSocket.js`, `lib/chatSocket.js`) — refcount retain/release, heartbeat с лимитом пропущенных pong, backoff с jitter, `bufferedAmount`-guard, аккуратный `close()`.
- **Перерендеры в частых компонентах**: MainLayout (все страницы) — навигация/уведомления мемоизованы; MailMessageList — `MemoMessageRow` + прогрессивный лимит рендера + IntersectionObserver load-more; MyFiles — прогрессивный рендер чанками, `reconcileById` (стабильные ссылки), ленивые thumbnail'ы через IntersectionObserver с `disconnect()` и отзывом blob-URL; Dashboard — коалесинг событий 180 мс + freshness-гварды (`Dashboard.jsx:785-840`); ComputerCard/EquipmentRow/dialog-компоненты Database — `memo`.
- **JSON/RegExp в render**: грубый поиск по горячим страницам проблемных мест не выявил — крупные сортировки/фильтрации обёрнуты в `useMemo` (Networks: 411-740; Statistics: 346-391; Dashboard: 870-934; Computers: 1502-1596). Единственный `JSON.parse(JSON.stringify(...))` — в тесте.

## 3. Что осталось непроверенным (нужен live-замер)

1. **Реальные объёмы данных**: кол-во портов/розеток/точек карты в крупных филиалах (пределы 10 000/5 000 — верхние границы; фактическая тяжесть 1.1–1.3, 1.5 зависит от данных). Замер: React Profiler на /networks при открытии «Оборудование» на мобильном.
2. **Фактический вес qrcode внутри Login-чанка** (1.8): в dist не удалось однозначно атрибутировать модуль qrcode по строкам; нужен `npx vite-bundle-visualizer`/source-map локально.
3. **Долгая работа вкладки**: накопление памяти при многочасовой сессии чата/почты (blob-URL превью, кэши) — только ручное heap-профилирование; статически всё подозрительное закрыто.
4. **Эффект framer-motion (1.12) и recharts в Monitoring (1.13)** на медленных сетях: замер TBT/LCP при первом открытии /chat и /monitoring.
5. **StrictMode-двойной монтирование**: в PROD StrictMode не дублирует эффекты; в dev дублей запросов не наблюдается благодаря `useRequestGuard`/SWR-dedupe — но live-проверка в dev-режиме не выполнялась (запрещено запускать dev-сервер).

## 4. Сводный список по убыванию серьёзности

| # | Серьёзность | Файл:строка | Суть | Статус |
|---|---|---|---|---|
| 1.1 | Высокая | `components/networks/EquipmentTab.jsx:351-433` (+`Networks.jsx:871`) | Мобильный список портов (до 10 000) без виртуализации | Confirmed |
| 1.2 | Средняя | `components/networks/SocketsTab.jsx:220-229` | Мобильный список розеток без виртуализации | Confirmed |
| 1.3 | Средняя | `components/networks/InteractiveMapCanvas.jsx:530-544,55-105` | Пересчёт кластеризации на каждый pointermove при драге | Confirmed (влияние — live) |
| 1.4 | Средняя | `pages/Networks.jsx:2055-2074` (+`1862,2011`) | Глобальный keydown пересоздаётся каждый рендер | Confirmed |
| 1.5 | Средняя | `pages/Networks.jsx:138-311` | ~80 useState в одном компоненте — полный ре-рендер на любой ввод | Confirmed (влияние — live) |
| 1.6 | Средняя | `pages/MyFiles.jsx:1332-1337` | Bulk download: все файлы параллельно, без очереди | Confirmed |
| 1.7 | Средняя | `pages/Warehouse1C.jsx:903,923,1922,1970,2121,2162` | Списки 200–1000 строк без виртуализации и memo | Confirmed |
| 1.8 | Низкая | `pages/Login.jsx:3` (+`components/passwords/PasswordUnlockDialog.jsx:2`) | `qrcode` статически в чанке Login/Passwords, нужен только для TOTP-QR | Confirmed |
| 1.9 | Низкая | `pages/SharedFile.jsx:576-579` | Ежесекундный re-render публичной страницы без условия | Confirmed |
| 1.10 | Низкая | `pages/Statistics.jsx:290-296` | Переключение вкладок = повторный fetch без кэша | Confirmed |
| 1.11 | Низкая | `components/feed/FeedCommentsPanel.jsx:130-138` | Опрос 15 с: K+1 запросов при K раскрытых ветках | Confirmed |
| 1.12 | Низкая/инфо | `ChatThread.jsx:27` и др.; dist `ForwardRounded-*` 40 КБ gz | framer-motion статически в чанках /chat и /mail | Confirmed |
| 1.13 | Низкая | `pages/Monitoring.jsx:20` + `MonitoringChart.jsx:4` | recharts (89 КБ gz) грузится до выбора устройства | Confirmed |
| 1.14 | Инфо | `TaskCanvasWorkspace.jsx` (lazy) | Excalidraw-канвас ≈1,25 МБ gzip при первом открытии | Confirmed |

Секретов в отчёте нет. Единственный созданный файл — сам отчёт.
