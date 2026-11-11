# Аудит фронтенда: pages A..L (read-only)

Область: `WEB-itinvent/frontend/src/pages`, без тестов. Файлы A..L верхнего уровня (About, AccountWorkspace, AdUsers, AddressBook, Admin, Chat, CompanyStructure, Computers, Construction*, Dashboard, Database, Docflow, Feed, FileEgress, GroupsAccess, Help, ItPurchaseRequests, KnowledgeBase, Login) и подпапки account, chat, company-structure, database, docflow, help. Изменения в репозитории не вносились, сборки и тесты не запускались.

Формат: `путь:строка`, описание, сценарий/доказательство, severity, confidence.

---

## Bugs

### B1. Отладочные fetch на localhost:7785 вызываются безусловно в проде
- `WEB-itinvent/frontend/src/pages/Docflow.jsx:1486, 1495, 1561, 1591, 1748, 1753`
- Сырой `fetch('http://127.0.0.1:7785/ingest/...')` с телом, содержащим `task_ref`/`scope`, не обёрнут ни в какую проверку флага. Остальные отладочные вызовы в проекте идут через `emitAgentDebugLog` (`lib/debugClientLog.js`), который гейтится `localStorage.agentDebugLog`/`DEV`. Здесь гейта нет.
- Сценарий: каждый клик «Выполнить», каждый автополл команды (1591) и каждая смена видимости вкладки шлют POST на локальный порт. В проде это ошибки `net::ERR_CONNECTION_REFUSED` в консоли, а на машине с любым процессом на 7785 уходят данные задач 1С.
- Severity: high. Confidence: high.

### B2. `loadingMore` в Computers залипает, подгрузка страниц останавливается
- `WEB-itinvent/frontend/src/pages/Computers.jsx:932-963, 1004-1014, 1050-1059, 1067-1081`
- `load()` инкрементирует `requestIdRef` для каждого вызова. Если append-запрос (`append: true`) перекрыт обычным `load` (ручное обновление, `visibilitychange` в 1212-1230, перезагрузка после смены БД в 1236-1249, перезапуск init-эффекта при смене фильтров), ответ append отбрасывается (`return false` в 963). В `finally` блок `if (requestId === requestIdRef.current)` не выполняется, поэтому `setLoadingMore(false)` не вызывается. Обычный `load` тоже не сбрасывает `loadingMore`. `handleLoadMore` (1051) и sentinel-эффект (1067) проверяют `loadingMore`, поэтому дальнейшая подгрузка заблокирована до перезагрузки страницы. Спиннер «Подгружаем компьютеры в фоне…» (1801-1803) висит бесконечно.
- Сценарий: пользователь доскроллил до конца, во время подгрузки нажал «Обновить» или сменил фильтр.
- Severity: medium. Confidence: high.

### B3. Dashboard теряет обновление сводки документов при коалесцировании событий
- `WEB-itinvent/frontend/src/pages/Dashboard.jsx:751-779` (особенно 753-754 и 758)
- `refresh(event)` при `if (timer) return;` отбрасывает все последующие события в окне 180 мс. Тип события, по которому решается, обновлять ли `loadDocflowSummary`, берётся из первого (замыкание) события.
- Сценарий: за 180 мс приходит `HUB_REALTIME_MAIL_EVENT`, затем `HUB_REALTIME_DOCFLOW_EVENT`. Сводка документов не обновится, пока не придёт следующее событие.
- Severity: medium. Confidence: high.

### B4. Docflow: `loadTaskDetail(force)` возвращает устаревший in-flight промис
- `WEB-itinvent/frontend/src/pages/Docflow.jsx:1324-1340` (проверка `detailInFlight` до запроса), вызовы из realtime-refresh 1420-1445 и `checkTaskCommand` 1521-1584
- При `force: true` кэш очищается, но если запрос по этому `taskRef` уже в полёте, функция возвращает его промис (`if (existing) return existing;`) и не делает новый запрос. Событие realtime, пришедшее во время запроса, даёт свежие данные не дольше уже отправленного запроса.
- Сценарий: 1С меняет задание, пока открыта карточка и идёт загрузка деталей. Realtime-событие приходит внутри окна. Карточка показывает состояние до изменения.
- Severity: medium. Confidence: medium.

### B5. Docflow: поллинг команды 1С без лимита и backoff
- `WEB-itinvent/frontend/src/pages/Docflow.jsx:1586-1606` (интервал 3000 мс в 1599)
- При `state_unknown`/`pending` опрос идёт каждые 3 с до смены статуса. Нет лимита попыток, backoff и сообщения о таймауте. Если 1С не отвечает, опрос продолжается, пока открыта страница.
- Severity: medium. Confidence: high.

### B6. Feed: `handleBookmark` без защиты от параллельных запросов
- `WEB-itinvent/frontend/src/pages/Feed.jsx:450-462`
- В отличие от лайков и реакций (`likingIds`, 412-443), закладка не защищена. Откат `patchPost(post.id, { viewer_bookmarked: !nextValue })` выполняется по замыканию, а не по последнему подтверждённому состоянию. Ответы быстрых кликов могут прийти не по порядку.
- Сценарий: два клика подряд, первый ответ приходит позже второго. Итоговое состояние в UI расходится с сервером.
- Severity: medium. Confidence: medium.

### B7. GroupsAccess: нет защиты от устаревших ответов в трёх загрузчиках
- `WEB-itinvent/frontend/src/pages/GroupsAccess.jsx:245-278` (`loadListGroups`), `280-304` (`loadUserSearch`), `305-341` (`loadMatrixGrid`)
- В отличие от `loadGroupDetail` (343-365), у этих функций нет request-id/AbortController. Ответ на старый фильтр может перезаписать ответ на новый. `setError('')` общий для всех режимов.
- Сценарий: быстро сменить филиал или поиск. Медленный ответ старого запроса перезапишет список.
- Severity: medium. Confidence: high.

### B8. KnowledgeBase: внешняя ссылка карточки открывается без проверки схемы
- `WEB-itinvent/frontend/src/pages/KnowledgeBase.jsx:470` (поле ввода), `227` (только trim), `1304` и `1336` (`window.open(selectedCard.external_url | cover_image_url, '_blank', 'noopener,noreferrer')`)
- Поле «Ссылка» принимает любую строку. На клиенте схема (`http`/`https`) не проверяется. Кнопка «Открыть» передаёт значение в `window.open`.
- Сценарий: редактор сохраняет `javascript:...` в карточку. Любой пользователь, нажавший кнопку, выполняет этот код в контексте приложения. Серверную валидацию в рамках аудита не проверял (это за пределами области) — нужно проверить `backend` для `kb` card.
- Severity: high. Confidence: medium.

### B9. Login: дорогая DOM-аудит выполняется даже при выключенной отладке
- `WEB-itinvent/frontend/src/pages/Login.jsx:1163-1225` (эффект), вызов `auditLoginPageOverlays()` в 1208; также `1278` в catch passkey.
- `auditLoginPageOverlays` (`lib/loginPagePresentation.js:17-…`) обходит `document.querySelectorAll('body *')` и вызывает `getComputedStyle`/`getBoundingClientRect` у каждого элемента. Аргументы объекта передаются в `emitAgentDebugLog`, который решает отбрасывать ли запись уже внутри себя. Аргументы вычисляются до вызова. Эффект зависит от `keyboardInset` (1224), который меняется на `visualViewport.scroll` (888-922).
- Сценарий: мобильная клавиатура, прокрутка на экране логина. На каждом кадре с изменением inset выполняется полный обход DOM с layout-reflow.
- Severity: medium. Confidence: high.

### B10. Login: одноразовое состояние потребляется в теле эффекта, StrictMode ломает resume TOTP
- `WEB-itinvent/frontend/src/pages/Login.jsx:724-810` (sessionStorage.removeItem и `history.replaceState` в теле эффекта, затем `await startTwoFactorSetup` и проверка `if (cancelled) return;` в 779-781)
- `main.jsx:92` включает `React.StrictMode`. В dev эффект выполняется дважды: первый запуск снимает `resume_challenge` и очищает sessionStorage, второй ничего не находит и выходит. Первый уже помечен `cancelled` и выходит, не вызвав `setLoading(false)`/`setStep`.
- Сценарий: в dev после сохранения пароля в браузере шаг настройки TOTP не открывается. В проде эффект не дублируется.
- Severity: low (dev). Confidence: medium.

### B11. Login: прямой доступ к sessionStorage без try/catch
- `WEB-itinvent/frontend/src/pages/Login.jsx:987, 999` (`sessionStorage.setItem`, `getItem` в эффекте 983-1000)
- В браузере с заблокированным хранилищем исключение пробрасывается из эффекта и ломает экран входа. В других местах Login хранилище обёрнуто (`writeVpnHintDismissed`, `LAST_LOGIN_USERNAME_KEY`).
- Severity: low. Confidence: medium.

### B12. Branch-фильтры БД: эффект перезапрашивает настройки и может откатить выбор
- `WEB-itinvent/frontend/src/pages/database/useDatabaseListController.js:296-320` (зависимость `branches` в 320)
- `setBranches(normalized)` в `useDatabaseEquipmentData.js:228` создаёт новый массив при каждом fetch, даже если данные не изменились. Эффект на смену `branches` вызывает `settingsAPI.getMySettings` и `mergeServerBranchFilters` (`databaseBranchPreferences.js:52`), которая переписывает локальный кэш ответом сервера. Если локальный выбор ещё не сохранён (debounce `schedulePersistBranchFilters`), серверный ответ его перезаписывает.
- Сценарий: пользователь выбирает филиал, в этот момент срабатывает cache-revalidate списка филиалов. Выбор откатывается.
- Severity: medium. Confidence: medium.

### B13. Computers: `reloadAfterDbSwitch` ждёт busy-loop'ом вместо промиса
- `WEB-itinvent/frontend/src/pages/Computers.jsx:1236-1249`
- Ожидание `inFlightRef` реализовано циклом по 150 мс до 30 раз, без ожидания реального промиса. Два быстрых переключения БД запускают два `load` с `withLoader: true`, и результат последнего неопределён.
- Severity: low. Confidence: medium.

### B14. CompanyStructure: `window.history` напрямую в обход react-router
- `WEB-itinvent/frontend/src/pages/CompanyStructure.jsx:115-123` (`updateUrlState` с `window.history[method](window.history.state, '', nextUrl)`), `182-198` (popstate)
- Прямой `pushState` не обновляет `location` react-router. `history.state` (в нём `key`/`idx` роутера) переиспользуется, что может сломать навигацию «назад» роутера.
- Severity: medium. Confidence: medium.

### B15. AddressBook: после синхронизации список обрезается до 200
- `WEB-itinvent/frontend/src/pages/AddressBook.jsx:322-324`
- `restoreLimit = Math.min(Math.max(items.length, SEARCH_LIMIT), 200)` — если загружено больше 200 записей (через «Загрузить ещё»), после синхронизации список молча станет 200, а `hasMore` останется прежним.
- Severity: low. Confidence: medium.

### B16. Dashboard: `loadDashboard` без защиты от перекрывающихся запросов
- `WEB-itinvent/frontend/src/pages/Dashboard.jsx:701-734`
- Тихие перезагрузки по realtime-событиям и начальная загрузка идут без request-id. Более старый ответ может перезаписать `payload`.
- Severity: low. Confidence: medium.

### B17. Feed: мутация ref во время рендера
- `WEB-itinvent/frontend/src/pages/Feed.jsx:135-143`
- `listRequestRef.current += 1` и присваивания `queryRef.current = query` и т.п. выполняются прямо в теле компонента. В StrictMode и при конкурентном рендере счётчик инкрементируется дважды, поведение становится непредсказуемым.
- Severity: low. Confidence: medium.

### B18. Скачивание файла KB: `decodeURIComponent` и немедленный revoke
- `WEB-itinvent/frontend/src/pages/KnowledgeBase.jsx:271-279` (`decodeURIComponent` без try/catch, `URIError` на битом заголовке), `280-292` (`revokeObjectURL` сразу после `link.click()`)
- В Safari и Firefox немедленный revoke может оборвать скачивание.
- Severity: low. Confidence: low.

### B19. useMultiSelect: побочные эффекты внутри функции-обновления состояния
- `WEB-itinvent/frontend/src/pages/database/useMultiSelect.js:8-24`
- `console.log` и `setSelectionMode` вызываются внутри updater `setSelectedIds`. Updater в StrictMode вызывается дважды, логи дублируются. Логи безусловные. Сам хук в продакшене не используется (см. Dead code).
- Severity: low. Confidence: high.

### B20. Preferences-драфт в useAccountSectionData перезаписывает несохранённые правки
- `WEB-itinvent/frontend/src/pages/account/hooks/useAccountSectionData.js:154-160`
- Эффект по `[preferences]` копирует значения из `PreferencesContext` в локальные `themeMode/fontFamily/fontScale/mobileBottomNavItems`. `setPreferences(next)` в `contexts/PreferencesContext.jsx:178` вызывается при каждом `refreshFromServer`, в том числе на событии `auth-changed` (211-213). Несохранённые правки в настройках откатываются.
- Severity: medium. Confidence: medium.

### B21. Chat: `confirmAiAction` в хуке без защиты от двойного вызова
- `WEB-itinvent/frontend/src/pages/chat/useChatMessageActionsController.js:80-95`
- Защита есть только локально в `AiActionCard` (`components/chat/ChatBubble.jsx:466, 556-580`) через `busy`. Хук не идемпотентен. Отправка письма (`office.mail.*`) при двойном вызове не защищена на клиенте. Проверить серверную идемпотентность (вне области).
- Severity: low. Confidence: medium.

---

## Conflicts

### C1. `selected_database` и событие `database-changed` записываются в 7 местах
- `components/layout/MainLayout.jsx:1922` (dispatch), `pages/database/useConsumableCard.js:264-265`, `pages/database/useDatabaseEmployeeFlow.js:318-319, 383-384, 454-455`, `pages/database/useDatabaseSelection.js:31, 93-94`, `pages/database/useDatabaseUploadActWorkflow.js:303-306`
- Каждый модуль сам вызывает `switchDatabase` + `localStorage.setItem('selected_database')` + `dispatchEvent('database-changed')`. Порядок и обработка ошибок расходятся.
- Рекомендация: один helper `switchActiveDatabase(dbId)` в `lib/`.
- Severity: medium. Confidence: high.

### C2. Состояние URL компании: window.history против react-router
- `pages/CompanyStructure.jsx:115-123, 182-198`. См. B14. Два источника истины для `node`/`block`/`view`.

### C3. Preferences продублированы локальным стейтом
- `pages/account/hooks/useAccountSectionData.js:108-112, 154-160` и `contexts/PreferencesContext.jsx:149`. См. B20.

### C4. Стадии заявок продублированы
- `pages/ItPurchaseRequests.jsx:49-60` (`STAGES`) и `components/construction/ConstructionRequestViews.jsx:20-30` (`REQUEST_STAGES`). Списки одинаковые по содержимому. Две копии, которые надо менять вместе.
- Severity: low. Confidence: high.

### C5. Отладочная инструментация в двух механизмах
- Гейтированный `emitAgentDebugLog` (`lib/debugClientLog.js`) используется в Login и чатах. Сырые `fetch` на 7785 в Docflow (см. B1). Нужен один путь через `emitAgentDebugLog`, либо удалить.
- Severity: medium. Confidence: high.

### C6. Два загрузчика одной сущности в одном модуле
- `pages/ItPurchaseRequests.jsx` содержит собственные `RequestList` (386), `RequestListItem` (267), `RequestDetail` (665), `RequestItemsList` (596), `journeyFor`/`RequestJourney`, тогда как `components/construction/ConstructionRequestViews.jsx` экспортирует `ConstructionRequestJourney` (152), `ConstructionRequestCard` (295), `ConstructionRequestDetail` (458). Аналогичный `RequestList` есть в `pages/ConstructionDirectionDetail.jsx:82`.
- Severity: medium. Confidence: high.

---

## Duplication

### D1. `useDebouncedValue` продублирован
- `pages/AddressBook.jsx:126`, `pages/AdUsers.jsx:80`, `pages/GroupsAccess.jsx:58` (та же реализация). Вне области ещё в `components/myFiles/MyFilesShareDialog.jsx:77`, `pages/Warehouse1C.jsx:132`, `pages/scan-center/ScanCenterPage.jsx:174`.
- Вынести в `lib/useDebouncedValue.js`.

### D2. `formatDate` в шести вариантах
- Идентичны: `pages/ItPurchaseRequests.jsx:81-88` и `pages/ConstructionObjects.jsx:58-64`, `components/construction/ConstructionRequestViews.jsx:70` (`formatConstructionDate`). Различаются: `pages/help/KbHelpSection.jsx:69`, `components/addressBook/addressBookUtils.js:85`, `components/tickets/ticketUi.js:52`.
- Вынести в `lib/formatDates.js`, использовать `formatConstructionDate` из components.

### D3. `formatDateTime` в 9+ копиях
- В области: `pages/GroupsAccess.jsx:69`, `pages/KnowledgeBase.jsx:239` (другой fallback «нет данных»), `pages/account/accountUserModel.js:169` (экспортируется), `pages/account/admin/ChatGroupsAdminSection.jsx:30`, `pages/account/admin/MyFilesAdminTab.jsx:36`, `pages/account/settings/MobileNativeAppSettingsCard.jsx:73`, `pages/database/warehouse1cMovementDetail.jsx:78`, `components/addressBook/addressBookUtils.js:100`, `components/tickets/ticketUi.js:59`, `components/chat/ChatGroupActivityDialog.jsx:40`, `components/hub/TaskWorkspacePanel.jsx:76`.
- Вынести одну реализацию с fallback как параметр.

### D4. `formatFileSize` с разными единицами измерения
- `pages/help/KbHelpSection.jsx:61` (МБ/КБ/Б, пустая строка при 0) и `pages/KnowledgeBase.jsx:247` (MB/KB/B, `'0 B'`). Также `lib/myFilesPreview.js:3`, `components/chat/chatHelpers.js:288`, `components/mail/mailMessagePresentation.js:164`, `pages/database/warehouse1cMovementDetail.jsx:85`.
- Одна функция с параметрами локали и fallback.

### D5. `downloadBlobResponse` и `resolveResponseFileName` скопированы
- `pages/help/KbHelpSection.jsx:91-106` и `pages/KnowledgeBase.jsx:271-292` (почти построчно), `pages/database/warehouse1cMovementDetail.jsx:49` (экспорт), `pages/scan-center/ScanCenterPage.jsx:160`.
- Вынести в `lib/downloadBlobResponse.js`.

### D6. `normalizeDbId` продублирован пять раз
- `pages/database/DatabasePageHeader.jsx:23`, `pages/database/uploadAct.js:4`, `components/layout/MobileShellPageHeader.jsx:16`, `components/layout/PageTopBar.jsx:20`, плюс экспорты `pages/database/databaseRecordModel.js:1` и `lib/mainLayoutHelpers.js:1`.

### D7. `formatTs` в Computers и FileEgress различается обработкой ошибок
- `pages/Computers.jsx:147-150` (без try), `pages/FileEgress.jsx:45-52` (с try/catch), также `pages/scan-center/HostDrawer.jsx:47`, `pages/scan-center/ScanCenterPage.jsx:210`.

### D8. `toNumberOrNull` в трёх местах
- `pages/database/UploadActEmailForm.jsx:12`, `pages/Mfu.jsx:79`, `pages/database/databaseRecordModel.js:3` (экспорт).

### D9. Polling-блок видимости + интервал скопирован в четыре страницы
- `pages/ConstructionObjects.jsx:471-497` (интервал 486), `pages/ConstructionObjectDetail.jsx:~170-195` (интервал 182), `pages/ConstructionDirectionDetail.jsx:497-520` (интервал 512), `pages/ItPurchaseRequests.jsx:930-944` (интервал 935). Одинаковы `AUTO_REFRESH_MS = 5*60*1000`, `lastSuccessAtRef`, `refreshRef`, `visibilitychange`, очистка AbortController.
- Вынести в `useVisibilityRefreshInterval({ intervalMs, refresh })`.

---

## Optimization

### O1. Обновление списка AD и полный refetch после импорта
- `pages/AdUsers.jsx:277-286` (`importLogins` вызывает `fetchInitialData()` в конце), `handleFullSync` (300-318) также вызывает `fetchInitialData()`.
- Полная перезагрузка кандидатов после каждого импорта одного пользователя. Можно обновить локальный список по `login`.
- Severity: low. Confidence: high.

### O2. KnowledgeBase: клик по статье перезапрашивает весь список
- `pages/KnowledgeBase.jsx:630-659` (`loadArticles` зависит от `selectedArticleId`, 659), аналогично `661-690` (`selectedTemplateId`) и `692-722` (`selectedCardId`). Клик в `1459-1462` вызывает `setSelectedArticleId(id)` и `loadArticleDetail(id)`. Изменение `selectedArticleId` пересоздаёт `loadArticles`, эффект (729-731) перезапрашивает список (до 100 элементов) и деталь.
- Итог на клик: 1 запрос списка и 2 запроса детали. Также то же при сохранении статьи (817-827).
- Рекомендация: убрать `selectedArticleId` из зависимостей, использовать ref.
- Severity: medium. Confidence: high.

### O3. Login: отладочный DOM-аудит на пути рендера
- См. B9. Удалить блоки `#region agent log` с аудитом либо вычислять аудит только при включённой отладке.
- Severity: medium. Confidence: high.

### O4. GroupsAccess: `loadListGroups` тянет до 5000 записей при каждом изменении запроса
- `pages/GroupsAccess.jsx:245-278`, параметр `limit: 5000` в 252-257. Эффект пересоздаёт загрузку при каждом `debouncedFolderQuery` без отмены предыдущего запроса.
- Severity: medium. Confidence: medium.

### O5. Фиксированные интервалы без backoff
- `pages/database/EquipmentQualityDialog.jsx:180` (5 с, пока OCR running, без in-flight guard), `pages/database/useDatabaseEmployeeFlow.js:210-227` (интервал + focus + visibilitychange одновременно дают двойной fetch на возврате во вкладку).
- `pages/Computers.jsx:875-885` (`loadChangesDeferred`) вызывается на каждом poll (1039, 1229, 1247) — отдельный запрос `getAgentComputerChanges(50)` каждые 120–300 с, без ETag.
- Severity: low. Confidence: medium.

### O6. Слишком крупные компоненты
- `pages/Computers.jsx:784-2357` — компонент 1574 строки, 30 useState, 19 useMemo. Отдельные карточки уже вынесены (`ComputerCard` memo, 665). Вынести панели статистики, фильтров и списка локаций.
- `pages/Docflow.jsx:1172-2361` — компонент 1190 строк, 56 useState. Внутри файла инлайн `CredentialDialog` (231), `TaskActionDialog` (474), `DisconnectDialog` (566), `AssignmentDialog` (612-1171, ~560 строк). Вынести диалоги в `docflow/`.
- `pages/KnowledgeBase.jsx:506-1589` — компонент ~1080 строк, 32 useState; `ArticleEditorDialog` (294) и `CardEditorDialog` (415) в том же файле.
- `pages/Login.jsx` — 2264 строки, 31 useState, 19 useEffect.
- `pages/ItPurchaseRequests.jsx` — 1168 строк, в том числе дубль компонентов из components/construction (см. C6).
- Severity: medium. Confidence: high.

### O7. Полный DOM без виртуализации
- `pages/AdUsers.jsx:485-580` — все строки всех отделов рендерятся `departmentUsers.map` (572), без виртуализации. При тысячах записей AD дорого.
- Severity: low. Confidence: medium.

### O8. Прочее, замечено
- `pages/Feed.jsx:951-962` использует `key={index}` для статичного скелетона — безвредно, отмечено для полноты.
- `pages/chat` — `ChatPageContent.jsx` (1939 строк) при 2 useState: состояние вынесено в контроллеры. Построители `buildChatPageDialogsLayerProps.js` (263) и `useChatPageDialogsLayerProps.js` (422) решают похожую задачу. Проверить, нужны ли оба.
- Severity: low. Confidence: medium.

---

## Dead code

### X1. `pages/database/useMultiSelect.js` (и тест) не используется в продакшене
- Единственные импорты — `pages/database/useMultiSelect.test.js:4`. Хук не импортируется ни одной страницей.
- Severity: low. Confidence: high.

### X2. `pages/AccountWorkspace.jsx` — неиспользуемая однострочная реэкспорт-заглушка
- Файл содержит только `export * from './account';`. Импорты `pages/AccountWorkspace` в `src` не найдены. Реальный компонент — `pages/account/AccountWorkspace.jsx`, которым пользуется `pages/account/index.js`.
- Severity: low. Confidence: high.

### X3. `pages/Database.jsx` экспортирует именованные хелперы, которые использует только тест
- Строки 1-38: реэкспорты из `./database/uploadAct` и `./database/equipmentModel`. В продакшене импортируется только default (`lib/routeLoaders.js:57`). Именованные реэкспорты нужны `pages/Database.test.jsx:167`.
- Severity: low. Confidence: high.

### X4. Отладочный код с `#region agent log`
- `pages/Docflow.jsx` (12 вызовов, см. B1), `pages/Login.jsx` (8 блоков, 764-1839), `pages/chat/useChatConversationsController.js:61`, `pages/chat/useChatScrollController.js:64`, `pages/chat/useChatThreadMessageMerge.js:33`. Удалить после завершения отладки.
- Severity: medium. Confidence: high.

### X5. `console.log` в проде
- `pages/database/useMultiSelect.js:8-23` (см. B19). `pages/chat/useChatDebugController.js:120` и `pages/chat/useChatAnchorController.js:156` гейтятся (`isChatDebugEnabled`, `CHAT_SCROLL_DEBUG_STORAGE_KEY`) и не являются проблемой.
- Severity: low. Confidence: high.

---

## Проверено, замечаний нет

- `pages/FileEgress.jsx:1817` — iframe с `srcDoc` имеет `sandbox=""`, скрипты не выполняются.
- `pages/chat/AiMailActionEditDialog.jsx:186` — HTML подписи проходит `sanitizeMailHtmlFragment`.
- `pages/GroupsAccess.jsx` матрица — `components/groupsAccess/GroupsAccessMatrixTable.jsx` использует `react-window` (виртуализация).
- `pages/Feed.jsx:395-410` — лайки и реакции защищены `likingIds`.
- `pages/Help.jsx` — статический контент, без `dangerouslySetInnerHTML`.
- `pages/About.jsx:302-325` — cleanup эффекта корректен.
- `pages/chat/useChatEscapeClose.js`, `useChatMobileNavigation.js`, `useChatConversationNotificationClear.js` — слушатели снимаются в cleanup.

## Ограничения

- Не проверены серверные валидации (`external_url` в KB, идемпотентность `confirmAiAction`).
- Не запускались тесты и линтер, все выводы из чтения кода и grep.
- Строки в некоторых местах приблизительные (±2), где в тексте указано «~».
