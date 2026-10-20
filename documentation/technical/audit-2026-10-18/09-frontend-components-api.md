# Аудит фронтенда HUB-IT: components/, api/, contexts/, hooks/, lib/, App/main, public/sw.js, package.json

Область: `WEB-itinvent/frontend/src` кроме `src/pages`, плюс `public/sw.js`, `package.json`, `vite.config.js`.
Режим: только чтение. Файлы репозитория не менялись. Сборки, тесты и серверы не запускались.
Методика: grep по импортам и вызовам (мёртвый код, дубли, сопоставление endpoint'ов), чтение ключевых файлов, сверка фронтенд-констант с бэкендом (`backend/services/authorization_service.py`, `backend/api/v1/chat/*_ws.py`, `backend/api/v1/chat/ws.py`), read-only запуск ESLint только с правилами `react-hooks` (конфиг вне репозитория, в scratchpad). Результат ESLint: `scratchpad/audit/eslint_out.json`.

Severity: critical / high / medium / low. Confidence: high / medium / low.

---

## Bugs

### B1. taskCanvasSocket не переподключается после rate-limit (1008)
- `frontend/src/lib/taskCanvasSocket.js:10`, `:123`
- Клиент считает 1008 невосстанавливаемым закрытием. Сервер шлёт 1008 при превышении лимита: `backend/api/v1/chat/task_canvas_ws.py:137-139` (`task canvas rate limit exceeded`).
- Сценарий: при всплеске действий на канвасе сокет закрывается с 1008, `scheduleReconnect` не вызывается, доска остаётся офлайн до перезагрузки страницы. В `hubRealtimeSocket.js:28-30` то же самое уже исправлено комментарием, в taskCanvasSocket исправления нет.
- Severity: medium. Confidence: high.

### B2. Незащищённый `.catch` в телеметрии сессии: unhandled rejection
- `frontend/src/api/client.js:244-258` (`void apiClient.post(...)` на строке 248 без `.catch`)
- try/catch не ловит асинхронное отклонение промиса. При сетевой ошибке отправки телеметрии появляется `unhandledrejection`. Обработчик в `main.jsx:40` глушит только ошибки загрузки чанков.
- Severity: low. Confidence: high.

### B3. Подробное логирование запросов к API включено по умолчанию на /chat
- `frontend/src/api/client.js:123-128` (`getItem(KEY) !== '0'`: при отсутствии ключа логирование включено), `:160-167` (`console.log` с полным URL, включая query-параметры вроде поисковых строк), `:163`/`:167`, а также хранение 120 записей в `window.__chatRequestLog` (строка 160).
- Сценарий: в продакшене на любой странице `/chat` в консоль и в глобальный объект попадают все URL запросов. Данные остаются в памяти вкладки и видны любому скрипту/расширению на странице.
- Severity: low. Confidence: high.

### B4. Кэш SWR не привязан к пользователю и не очищается при выходе: данные предыдущего пользователя во вкладке
- `frontend/src/lib/swrCache.js:30` (`clearSWRCache` экспортирован, но нигде не вызывается), `:124-158` (`getOrFetchSWR` сразу отдаёт устаревшую запись, пока не истёк retention, `DEFAULT_RETENTION_MS` = 30 мин, строка 6), `:6`.
- Ключи общего `getCachedGet` (`frontend/src/api/client.js:584-615`) содержат только scope, базу и params, без id пользователя. Пример: `frontend/src/api/mailNotifications.js:23-28` (`'mail-unread-count'`), `frontend/src/api/settings.js:33` (`settings-notification-push-config`).
- `AuthContext.jsx:562-584` (logout) не чистит этот кэш и не перезагружает страницу.
- Сценарий: пользователь A выходит, пользователь B входит в той же вкладке. Пока идёт фоновая ревалидация, B видит счётчик непрочитанной почты A. Для чата ключи включают `userCacheId`, для почты — scope, поэтому риск ограничен этими двумя ключами.
- Severity: medium. Confidence: medium (зависит от того, что логин выполняется без перезагрузки; из кода видно, что перезагрузки в пути logout нет).

### B5. При выходе не очищаются пользовательские данные в localStorage
- `frontend/src/contexts/AuthContext.jsx:562-584` чистит только `user`, mail recent cache и mobile offline cache.
- Не очищаются: `itinvent_toast_history` (`frontend/src/contexts/NotificationContext.jsx:20`, запись в `:52-53`; тексты уведомлений, которые пишет `pushToast`); `clearToastHistory` (`:377`) нигде не вызывается; `web_preferences_cache` (`frontend/src/contexts/PreferencesContext.jsx:18`, запись `:137`); `itinvent_hub_seen_ids` (`NotificationContext.jsx:21`); `selected_database`; `hubit-my-files-uploads` (`frontend/src/api/myFiles.js:19`, имена и id файлов); сохранённые поиски почты (`components/mail/useMailAdvancedSearch.js:51`); избранное адресной книги (`lib/addressBookFavorites.js:40`).
- Сценарий: на общем ПК после выхода следующий пользователь видит тексты уведомлений и имена файлов предыдущего.
- Severity: medium. Confidence: high.

### B6. Service worker отдаёт кэшированные вложения чата без проверки авторизации после выхода
- `frontend/public/sw.js:4` (`CHAT_MEDIA_CACHE`), `:628-640` (`handleChatMediaVariantRequest`, cache-first с фоновым обновлением), `:542-552` (`cleanupOldCaches` сохраняет этот кэш), `:963-976` (fetch-обработчик, `self.addEventListener(fetch)` на строке 963).
- Кэшируются ответы `/api/v1/chat/messages/*/attachments/*/file?inline=1&variant=...`, то есть авторизованные ответы. Logout (`AuthContext.jsx:562-584`) этот кэш не удаляет. Единственное место, где удаляются все кэши, — `frontend/src/lib/routeChunkRecovery.js:69-70`, при восстановлении после ошибки загрузки чанка.
- Сценарий: на общем ПК после выхода пользователь B, зная URL (или получив его из истории), получает превью картинок пользователя A из CacheStorage без запроса к серверу.
- Severity: medium. Confidence: high.

### B7. Печать и открытие blob-вложений всегда падают в «не удалось» из-за `noopener`
- `frontend/src/components/mail/useMailMessageFileActions.js:146-151`: `openWindow('', '_blank', 'noopener,noreferrer,...')`, затем `if (!printWindow)` и ошибка «Не удалось открыть окно печати». Согласно спецификации HTML, при `noopener` `window.open` возвращает `null`, поэтому ветка печати недостижима в браузере.
- `frontend/src/components/mail/mailMessageFileActions.js:297-301`: `popup = window.open(url, '_blank', 'noopener,noreferrer')`; при `popup === null` всегда выполняется скачивание. Ветка iOS standalone (открыть blob в новой вкладке) фактически мертва.
- Severity: medium. Confidence: high (поведение `window.open` с noopener; подтверждено чтением кода, не запуском в браузере).

### B8. Неэкранированные тема и отправитель в HTML документа печати
- `frontend/src/components/mail/mailMessageFileActions.js:314-340` (`buildPrintMailDocumentHtml`): `subject`, `senderLine`, `dateLine` вставляются в HTML без экранирования. Исходные значения приходят из внешнего письма (`useMailMessageFileActions.js:117-135`).
- Документ уходит в `requestMobileAppPrint({ html })` (`useMailMessageFileActions.js:139-141`), то есть в нативную печать мобильного приложения. Сейчас путь `document.write` недостижим (см. B7), но мобильная ветка работает.
- Сценарий: тема письма `</title><img src=x onerror=...>` выполняет код в WebView печати. Санитизация тела письма (`sanitizeMailHtmlFragment`) на шапку не распространяется.
- Severity: medium. Confidence: medium (зависит от того, как нативная печать рендерит HTML).

### B9. Ошибка логина может быть массивом (FastAPI 422) и попасть в UI как объект
- `frontend/src/contexts/AuthContext.jsx:437`, `:466`, `:477`, `:495`, `:506`, `:524`, `:535`, `:553`: `err.response?.data?.detail || '...'` без проверки типа. Для ошибок валидации FastAPI `detail` является массивом объектов.
- `frontend/src/pages/Login.jsx:602-604`: `reportLoginError(message)` передаёт значение в `showLoginNotice` без нормализации.
- Сценарий: при 422 в уведомление попадает массив объектов. React бросает «Objects are not valid as a React child» или показывает `[object Object]`.
- Severity: low. Confidence: medium.

### B10. Неустойчивое кэширование ошибки открытия IndexedDB в очереди фото
- `frontend/src/lib/photoUploadQueue.js:34-48`: промис `opening` кэшируется навсегда. После одного отклонения (blocked, quota, приватный режим) все последующие операции падают до перезагрузки страницы.
- Severity: low. Confidence: high.

### B11. Stale closures в MainLayout (exhaustive-deps, подтверждено ESLint)
- `frontend/src/components/layout/MainLayout.jsx:948` использует `isMobileChatRoute`, но массив зависимостей эффекта (строки ~1012-1020) его не содержит. Значение зафиксировано до изменения `isPhone`.
- `:1259` читает `location.pathname` внутри `useCallback`, который объявлен на `:1281` без `location.pathname` в зависимостях. Вычисленный `isOnChatRoute` для тоста о дельте непрочитанных может быть устаревшим.
- Severity: medium. Confidence: high (правило `react-hooks/exhaustive-deps`).

### B12. MailHtmlBody вставляет HTML без собственной санитизации
- `frontend/src/components/mail/MailHtmlBody.jsx:74-77`: `dangerouslySetInnerHTML={{ __html: bodyHtml }}` в ветке без sandbox. Безопасность держится на том, что вызывающие передают результат `buildRenderedMailHtml` (`useMailMessageRenderState.js:49-104`, `MailConversationReader.jsx:88-92`, которые проходят `sanitizeIncomingMailHtml`). Прямой вызов компонента с сырым HTML станет XSS.
- Severity: low (defense in depth). Confidence: high.

---

## Conflicts

### C1. Модель прав: фронтенд расходится с бэкендом, клиент сам добавляет права
- `frontend/src/contexts/AuthContext.jsx:12-29` (`alwaysGrantedPermissions`: dashboard.read, chat.ai.use, docflow.act/read, mail.access, my_files.read/share/write, settings.read, tasks.create/read и др.), `:128-131` (эти права добавляются к списку прав сервера для **каждого** пользователя, в том числе при ответе сервера), `:30-122` (`rolePermissionFallback`).
- Бэкенд: `backend/services/authorization_service.py:91-97` (`_ALWAYS_GRANTED_PERMISSIONS` — только address_book.read, announcements.read, chat.read, chat.write, company_structure.read), `:99-115` (viewer), `:117-134` (operator), `:136-158` (admin).
- Дрейф: фронтовый fallback у admin не содержит `monitoring.read/manage` (сервер `:137-138`), `mail.quotas.read` (`:154`), `groups_access.read` (`:157`); у operator нет `computers.manage` (сервер `:126`).
- Сценарий: у пользователя, которому сервер не выдал `tasks.create` или `my_files.share`, интерфейс показывает кнопки, которые завершаются 403. Сервер остаётся авторитетным, поэтому ущерб в основном UI.
- Severity: medium. Confidence: high.

### C2. Три политики закрытия WebSocket
- `frontend/src/lib/chatSocket.js:44`: `NON_RECONNECTABLE_CLOSE_CODES = {1008, 4000, 4400, 4401, 4403, 4404, 4503}`; 1008 переводит клиент в `authBlocked`, сбрасывается только при явном сбросе.
- `frontend/src/lib/hubRealtimeSocket.js:28-30`: `{4000, 4400, 4403, 4404}`, явно указано, что 1008 должен переподключаться.
- `frontend/src/lib/taskCanvasSocket.js:10`: как в chatSocket, с 1008 (см. B1).
- Серверы: chat `backend/api/v1/chat/ws.py:275-278` для rate limit использует 4429 (комментарий «1008 stays for policy/auth»), hub `hub_realtime_ws.py:194-196` и canvas `task_canvas_ws.py:137-139` используют 1008 для rate limit.
- Сценарий: поведение при rate limit зависит от того, какой сокет открыт. Для chat сейчас латентно, для canvas проявляется (B1).
- Severity: medium. Confidence: high.

### C3. Два обёртки над `/scan/incidents` с разным поведением
- `frontend/src/api/scanIncidents.js:4-9`: `getIncidents` по умолчанию `view: 'summary'`.
- `frontend/src/api/scanHosts.js:123-131` (`getHostsFallbackFromIncidents`): запрос без `view`, `limit = max(limit*4, 500)`. Тот же эндпоинт, другой формат ответа и объём.
- Severity: low. Confidence: medium.

### C4. Два модуля для одних эндпоинтов оборудования
- `frontend/src/api/equipmentDirectories.js:5, :18, :42` (`/equipment/branches`, `/equipment/locations`, `/equipment/owners/search`) и `frontend/src/api/equipmentDbTransfer.js:29, :37, :47` (те же пути с заголовком `X-Database-ID`). Разделение намеренное (целевая база), но нормализация `branch_no` и параметры продублированы (`equipmentDirectories.js:18-23` и `equipmentDbTransfer.js:47-56`), и они могут разойтись.
- Severity: low. Confidence: high.

### C5. Две реализации `isTaskConversation` с разной семантикой
- `frontend/src/components/chat/chatFolderUtils.js:78-80`: `Boolean(item?.task_id)`, пробельная строка считается задачей.
- `frontend/src/components/chat/chatHelpers.js:619-622`: `String(...).trim()`.
- Severity: low. Confidence: high.

### C6. Форматирование размера файла и «пустых» значений в восьми вариантах
- `components/chat/chatHelpers.js:288` (`'0 Б'`, `КБ/МБ/ГБ`, `toFixed(1)`), `components/mail/mailMessagePresentation.js:164` (десятичная запятая), `lib/myFilesPreview.js:3`, `pages/tasks/taskFormatters.js:38` (`'-'` при 0, латиница `KB/MB`), `components/hub/TaskWorkspacePanel.jsx:89` (`''` при 0, латиница `B/KB/MB`), `pages/help/KbHelpSection.jsx:61` (`'0 B'`, `Math.round` для KB), `pages/KnowledgeBase.jsx:247`, `pages/Warehouse1C.jsx:303` (`''` при 0).
- Сценарий: один и тот же размер выводится как `12 КБ` в чате и `12 KB` в задачах; пустой размер выводится по-разному.
- Severity: low. Confidence: high.

---

## Duplication

### D1. Два независимых механизма загрузки по частям (chat и my-files)
- `frontend/src/api/chatFileUploads.js:10` (`sleepWithSignal`), `:35` (`isAbortError`), `:99` (`shouldFallbackChatUploadSession`), `:131` (`uploadChatFilesMultipart`), `:283-321` (retry, задержки `[1000,3000,7000]`), `:333` (пул из 2 воркеров).
- `frontend/src/api/myFiles.js:144` (`waitForUploadRetry`, аналог sleepWithSignal), `:179` (`isRetriableUploadError`, аналог shouldFallback), `:400-533` (`uploadFile`: пул из 4 воркеров, задержки `[1000..20000]`, watchdog, resume через localStorage). `chatUploadSessions.js` и `myFiles.js:351-399` повторяют один протокол сессий с разными путями.
- Severity: medium (два набора retry/abort-логики, уже разошедшихся по параметрам). Confidence: high.

### D2. Два почти идентичных загрузчика манифеста установщика
- `frontend/src/lib/desktopInstallerFeed.js` (295 строк) и `frontend/src/lib/mobileInstallerFeed.js` (272 строки): одинаковые `hasExactFields`, проверка хоста, таймаут fetch, валидация размеров и полей; отличаются только константы и схема.
- `frontend/src/hooks/useDesktopInstallerFeed.js` (35) и `useMobileInstallerFeed.js` (32): идентичны, кроме имени.
- Для проверки подписи/URL-манифеста это риск расхождения при правках.
- Severity: medium. Confidence: high.

### D3. Один и тот же код reconnect/heartbeat/backoff в трёх WebSocket-клиентах и SSE
- `frontend/src/lib/chatSocket.js:37-38, 904-927, 927-950`; `frontend/src/lib/hubRealtimeSocket.js:24-26, 327-364`; `frontend/src/lib/taskCanvasSocket.js:7, 149-165`; `frontend/src/lib/scanEvents.js:10`.
- Одна и та же таблица `[1s,2s,5s,10s,20s,30s]`, одинаковый jitter и stable-timer. Дрейф уже вызвал B1 и C2.
- Severity: medium. Confidence: high.

### D4. Повторённые мелкие хелперы (вывод по `^export` и `^const`)
- `isAdminUser`: `components/account/accountNavigationConfig.jsx:125` и `components/layout/navigationConfig.jsx:78` (идентичны).
- `normalizePhoneDigits`: `components/addressBook/addressBookUtils.js:61` и `lib/messengerLinks.js:3` (идентичны).
- `parseDownloadFilename`: `components/mail/mailMessageFileActions.js:28` и `lib/networksHelpers.js:49` (отличается только fallback).
- `downloadBlobFile`: `components/mail/mailMessageFileActions.js:293` и `lib/networksHelpers.js:75`.
- `getInitials` ×4: `components/addressBook/addressBookUtils.js:175`, `components/chat/calls/callsModel.js:383`, `components/mail/mailMessagePresentation.js:185`, `pages/tasks/taskFormatters.js:46` (разные правила для одного эмейла/имени).
- `formatDateTime` ×10+: `addressBookUtils.js:100`, `ChatGroupActivityDialog.jsx:40`, `hub/TaskWorkspacePanel.jsx:76`, `myFiles/myFilesVisual.js:16`, `passwords/passwordVaultUtils.js:149`, `tickets/ticketUi.js:59`, `pages/account/accountUserModel.js:169`, `pages/GroupsAccess.jsx:69`, `pages/Mfu.jsx:88`, `pages/Statistics.jsx:102`, `pages/Warehouse1C.jsx:229` и др.
- `normalizeText` ×9, `clamp` ×5 (`components/chat/chatImageEditor.js:11`, `components/mail/MailMessageList.jsx:64`, `components/mail/MailPaneResizeHandle.jsx:4`, `components/networks/InteractiveMapCanvas.jsx:9`, `pages/database/ZoomableImage.jsx:12`).
- Severity: low. Confidence: high.

### D5. Две библиотеки для Excel в одном бандле
- `xlsx`: `frontend/src/lib/excelPreview.js:55`, `lib/groupsAccessExport.js:27, :88` (динамические импорты).
- `xlsx-js-style` (форк SheetJS): `frontend/src/pages/database/employeeEquipmentExcel.js:321`.
- Две библиотеки дают два чанка сопоставимого размера. Дубль в `package.json` (см. X10).
- Severity: medium (размер бандла). Confidence: high.

### D6. Два компонента `TaskCard`
- `components/dashboard/TaskCard.jsx` (278 строк, `React.memo`) и `components/hub/tasks/TaskCard.jsx` (496 строк). Dashboard-версия мертва (см. X1). Имя совпадает, что путает импорты.
- Severity: low. Confidence: high.

### D7. Запрос push-конфигурации в трёх местах
- `frontend/public/sw.js:708` (прямой `fetch('/api/v1/settings/notifications/push-config')`), `:727`, `:744`, `:806`; `frontend/src/api/settings.js:33` (`getNotificationPushConfig`, используется); `frontend/src/api/chatNotifications.js:9` (`getPushConfig`, не используется).
- Severity: low. Confidence: high.

---

## Optimization

### O1. MainLayout: монолитный компонент на 3280 строк
- `frontend/src/components/layout/MainLayout.jsx:203` (начало компонента) — 27 `useState`, 41 `useEffect`, 32 `useRef`, 18 `useMemo`, 12 `useCallback` в одном компоненте. Любое изменение состояния (счётчики, поллинг, тосты, sidebar) перерисовывает весь шелл.
- Также `:1911` и `:2295`: `handleDatabaseChange` объявлен inline и попадает в deps `useMemo`, поэтому мемоизация не работает (подтверждено ESLint).
- Рекомендация: вынести блоки «уведомления/поллинг», «чат-уведомления», «sidebar» в хуки и отдельные компоненты с мемоизацией.
- Severity: medium. Confidence: high.

### O2. AuthContext: значение контекста не мемоизировано
- `frontend/src/contexts/AuthContext.jsx:609-626`: `value` создаётся каждый рендер, без `useMemo`. Любое изменение `loading`, `error`, `mailSessionEnabled` перерисовывает всех потребителей `useAuth`.
- `refreshSession` (`:174`) создаёт новый объект `user` при каждой проверке. Эффект тихого обновления (`:371-408`, deps `[user]`) пересоздаёт таймер при каждом фокусе/видимости.
- Severity: medium. Confidence: high.

### O3. Огромные компоненты чата без мемоизации
- `frontend/src/components/chat/ChatContextPanel.jsx`: 3967 строк, 0 `memo`, 25 `useState`, 10 `useEffect`.
- `frontend/src/components/chat/ChatCommon.jsx`: 1441 строка, 15 `useState`, смешанный набор компонентов.
- `frontend/src/components/chat/ChatThread.jsx`: 1937 строк. `ChatBubble.jsx` (2207) уже использует `memo` через `MemoChatBubble`.
- Severity: medium. Confidence: high.

### O4. Мемоизация с нестабильными зависимостями (подтверждено ESLint)
- `frontend/src/components/feed/FeedPostCard.jsx:82` (`attachments` пересоздаётся каждый рендер), зависимость `useMemo` на строке 112.
- `frontend/src/components/layout/MobileShellPageHeader.jsx:34` (`databases`), `useMemo` на строке 117.
- Severity: low. Confidence: high.

### O5. client.js: 296 геттеров-делегатов и 61 импорт, файл растёт вопреки правилам
- `frontend/src/api/client.js`: 1763 строки, 296 геттеров вида `get x() { return y.x }`, 61 импорт доменных модулей. Любой модуль, импортирующий `client`, подтягивает все доменные API, tree-shaking не помогает.
- Правила проекта (AGENTS.md, Frontend): новые API — отдельные файлы, `client.js` не расширять. В файле продолжают добавляться фасады (scan, mail, voice и др.).
- Severity: medium. Confidence: high.

### O6. Лишние перерисовки в AuthContext и NotificationContext из-за эффектов с setState
- `frontend/src/contexts/NotificationContext.jsx:234-243`: эффект мутирует объекты очереди (`nextChatToast.expiresAt = ...`) и вызывает `setActiveToasts` внутри эффекта, зависящего от `activeToasts`. Это лишний проход рендера на каждое изменение тоста.
- Severity: low. Confidence: medium.

---

## Dead code

### X1. Мёртвый кластер dashboard и связанные хуки (~1000 строк компонентов + хуки)
- `frontend/src/components/dashboard/`: `ActionStrip.jsx`, `FilterBar.jsx`, `MobileAnnouncementsTab.jsx`, `MobileFilterDialog.jsx`, `MobileOverviewTab.jsx`, `MobileTasksTab.jsx`, `TaskQueue.jsx`, `TaskCard.jsx`, `AnnouncementCard.jsx`, `AnnouncementList.jsx` (10 файлов). Поиск по `components/dashboard` даёт ноль импортов.
- `frontend/src/hooks/useAnnouncementFilters.js`, `useDashboardData.js`, `useMobileSections.js`, `useTaskQueues.js` — импортируются только друг другом или не импортируются.
- Severity: high (код и тесты не используются). Confidence: high.

### X2. Мёртвые компоненты тикетов и методы API тикетов
- `frontend/src/components/tickets/`: `TicketDashboard.jsx`, `TicketFinancialOps.jsx`, `TicketImportWizard.jsx`, `TicketKanban.jsx`, `TicketLossReport.jsx`, `TicketNotifications.jsx` — импорта нет, тестов нет.
- `frontend/src/api/tickets.js:49` (`listComments`), `:53` (`addComment`), `:57` (`listHistory`), `:61` (`listAttachments`), `:165` (`updateFinancialOp`) — вызовов вне `client.js` нет.
- Severity: medium. Confidence: high.

### X3. Мёртвый импорт сетей и методы `networks.js`
- `frontend/src/components/networks/ImportDialog.jsx` — импорта нет.
- `frontend/src/api/networks.js`: `updateSocket` (`:56`), `bootstrapSockets` (`:66`), `importSocketsTemplate` (`:71`), `resolveSocketFio` (`:98`), `importData` (`:120`), `createPort` (`:145`), `deletePort` (`:155`) — вызовов нет.
- Severity: medium. Confidence: medium (поиск по имени; динамический доступ не исключён полностью).

### X4. Неиспользуемые компоненты почты
- `frontend/src/components/mail/MailAttachmentIconTile.jsx`, `MailOfficeAttachmentInlinePreview.jsx`, `MailSectionTabs.jsx` — импорта нет.
- Severity: low. Confidence: high.

### X5. API-методы без вызовов (фасады в client.js не используются)
- `api/settings.js:52, :56, :60` (`getNativePushStatus`, `upsertNativePushToken`, `deleteNativePushToken`).
- `api/chatNotifications.js:9, :14, :19` (`getPushConfig`, `upsertPushSubscription`, `deletePushSubscription`; push делает `sw.js`, см. D7).
- `api/hubNotifications.js:9, :14, :19` (`getUnreadCounts`, `markNotificationRead`, `markAllNotificationsRead`).
- `api/scanAgents.js:4` (`getAgents`), `api/scanHosts.js:134` (`getHosts`), `api/voiceJobs.js:19` (`getJob`).
- Также без вызовов: `equipmentRecords.getAllEquipment`, `equipmentComputers.getAgentComputers/getComputersSummary`, `hubTaskDiscussion.getTaskDiscussion`, `chatThreadMessages.searchMessagesGlobal`, `chatStickers.removePack`, `chatGroups.revokeGroupInvites`, `chatFolders.getFolder/setFolderConversations`, `hubAnnouncements.getAnnouncementReads/downloadAnnouncementAttachment`, `equipmentTransferActs.getUploadedActDraft`, `warehouse1c.aiSuggestReconcile`, `docflow.getMetadata`, `adUsers.assignBranch/getPasswordStatus/importToApp`, `departments.syncFromUsers/invalidateDepartmentsListCache`, `companyStructure.setParent/setDepartmentCodes`, `mailMailboxQuotas.listSnapshots`, `chatConfig.resetChatConfigCache`, `authUserAdmin.getTaskDelegates`.
- Severity: low. Confidence: medium.

### X6. Неиспользуемая функция очистки кэша (корень B4)
- `frontend/src/lib/swrCache.js:30` (`clearSWRCache`) — нигде не вызывается.
- Severity: medium (см. B4). Confidence: high.

### X7. Отладочные хвосты в продакшен-коде
- `frontend/src/lib/debugClientLog.js:32-60`: захардкоженный ingest на `http://127.0.0.1:7785/...` и session id `20cb37` (строки 40, 45), включаемые через `localStorage`.
- `frontend/src/lib/debugClientLog.dev.js`: отдельный файл с другим session id `7686a5` и URL локального ingest. Попадает в бандл как динамический чанк, даже если в проде не выполняется.
- Блоки `// #region agent log` в продакшен-коде: 48 вхождений в не-тестовых файлах frontend (например, `lib/chatSocket.js` строки ~412, ~494, ~767, ~873, ~933, ~991). Каждый вызов `emitAgentDebugLog` читает `localStorage` синхронно даже при выключенном логировании (`debugClientLog.js:15-23`).
- Severity: low. Confidence: high.

### X8. Неиспользуемые директивы eslint
- `frontend/src/lib/desktopBridge.js:2` и `frontend/src/lib/networksHelpers.js:67`: `eslint-disable-next-line no-control-regex` без соответствующей ошибки (ESLint: «Unused eslint-disable directive»).
- Severity: low. Confidence: high.

### X9. console.log в коде
- Единственные вызовы `console.log` вне `pages/`: `frontend/src/api/client.js:163` и `:167`, под условием `shouldDebugChatRequests` (см. B3). Других не найдено.

### X10. Неиспользуемые и дублирующие зависимости в package.json
- `rehype-raw` (`^7.0.0`) и `react-hook-form` (`^7.50.0`) — не импортируются ни в `src`, ни в `scripts`, `e2e`, конфигах.
- `xlsx-js-style` и `xlsx` — дубль (см. D5).
- `emoji-datasource-apple` (devDependency) используется в `scripts/emoji-apple-assets-plugin.mjs`, это нормально.
- Severity: medium (размер установки и аудит зависимостей). Confidence: high.

---

## Что проверено и не выявлено
- XSS через `dangerouslySetInnerHTML`: основные вставки в `components/mail/` проходят `sanitizeMailHtmlFragment` (DOMPurify, `mailHtmlContent.js:65-76`) или `buildRenderedMailHtml`. `taskRichText.js:104` парсит HTML редактора в отсоединённый элемент, это self-input; риск низкий, отдельный finding не выставлен.
- Интерцептор 401 (`client.js:300-412`): конкурентные refresh дедуплицируются через `refreshInFlight` (`client.js:110`, `:112-120`); повторная попытка помечается `_retry`. Гонки обнаружены не были.
- Очередь фото: ключи привязаны к пользователю (`mobileOfflineCache.js`, `userId` в `buildCacheKey`), кэш офлайн очищается при выходе.
- Lazy-загрузка тяжёлых библиотек (`@excalidraw`, `livekit-client`, `browser-image-compression`, `pdfjs-dist`, `html5-qrcode`, `lottie-web`, `emoji-picker-react`) выполнена через `import()`. Маршруты в `App.jsx` лениво грузятся через `lazy(loader)` (37 вызовов).
- `window.open` с `noopener` для внешних ссылок — нормальное использование, кроме случаев из B7.

## Ограничения
- Поиск неиспользуемых методов API сделан по имени (`grep -w`) вне `api/client.js`; динамический доступ через строковые ключи не исключён полностью. Поэтому X3, X5 и часть X1 имеют confidence medium/high.
- ESLint запущен только с `react-hooks` и только на подмножестве каталогов, конфиг проекта (ограниченный) не использовался.
- Поведение браузера (B7) и поведение SW (B6) выведены из кода и спецификации, в браузере не воспроизводились.
- Тесты и сборка не запускались по условию задачи.
