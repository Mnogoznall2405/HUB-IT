# Аудит фронтенда: pages M..Z (WEB-itinvent/frontend/src/pages)

Режим: READ-ONLY. Репозиторий не менялся, сборки, npm и тесты не запускались.
Охват: Mail, MobileMenu, Mfu, Monitoring, MyFiles, Networks, Passwords, Profile, ScanCenter, Search, Settings, SharedFile, SharedFolder, Statistics, Tasks, Tickets, Transfer, Vcs, VoiceVideo, Warehouse1C, Work и подпапки monitoring/, myFiles/, networks/, scan-center/, statistics/, tasks/, voice-video/ (без *.test.*). Размер: около 18k строк в корне и около 17k в подпапках.

Пути указаны относительно `WEB-itinvent/frontend/src/` (если не сказано иное).

Ключевые размеры:
- Networks.jsx: 3380 строк, одна функция Networks (119-3380), 109 useState, 41 useMemo, 25 useEffect.
- Mail.jsx: 3046 строк, одна функция Mail (225-3046), 26 useState, 18 useMemo, 13 useEffect.
- Warehouse1C.jsx: 2297 строк, функция Warehouse1C (1017-2297), 52 useState.
- scan-center/ScanCenterPage.jsx: 2557 строк, 84 useState, 19 useEffect.
- voice-video/VoiceMeetingDrawer.jsx: 3318 строк, 50 useState, 19 useEffect.
- Также: voice-video/VoiceLabelEditor.jsx 987, voice-video/VoiceVideoPage.jsx 890, tasks/useTasksPageController.jsx 1075, tasks/hooks/useTaskDetails.jsx 830, Mfu.jsx 1675, Passwords.jsx 1460, Monitoring.jsx 250.

Проверено без находок: dangerouslySetInnerHTML в scope нет; HTML писем проходит DOMPurify (см. B17); console.log в scope нет; неиспользуемых не тестовых модулей и экспортов вне своего файла не найдено.

---

## Bugs

### B1. Смена БД во время идущей загрузки МФУ применяет данные старой БД
- Файл: `pages/Mfu.jsx:483-488` (reload), `:469-481` (applyPayload), `:572-587` (onDatabaseChanged)
- Описание: при `inFlightRef.current === true` функция `reload` выходит сразу, даже с `force: true`. `onDatabaseChanged` вызывает `reload({ force: true })`, и этот вызов молча пропускается. Ответ старого запроса (уже по старой БД) потом приходит и вызывает `applyPayload`, который пишет payload в `setSWRCache(getMfuCacheKey())`. `getMfuCacheKey` читает `readSelectedDatabaseScope()` в момент применения, то есть уже получает ключ новой БД.
- Сценарий: пользователь открывает МФУ, переключает БД, пока запрос идет (до 60 с). Страница показывает устройства старой БД под новой БД, и эти данные кешируются под ключом новой БД до истечения stale time.
- Severity: high. Confidence: medium-high (по коду, в браузере не воспроизводил).

### B2. Перетаскивание файлов ОС на зону загрузки MyFiles обрабатывается дважды
- Файл: `pages/MyFiles.jsx:1295` (React onDrop), `pages/myFiles/useMyFilesUpload.js:371-381` (window 'drop'), `:325-329` (handleDrop с guard по readingDrop)
- Описание: `onDrop` на drop-zone вызывает `handleDrop`, который не делает `stopPropagation`. Нативное событие всплывает до `window`, где `onDropAnywhere` вызывает `handleDrop` второй раз. Guard `readingDrop` берется из замыкания рендера, и оба вызова видят `false`, потому что `setReadingDrop` не успевает применить состояние между ними.
- Сценарий: файлы перетащены на зону MyFiles, два раза вызываются `collectDataTransferFiles` и `openUploadDialog`. Возможны дубли в очереди загрузки или два диалога.
- Severity: high. Confidence: medium-high (порядок всплытия React 18 к root и затем к window стандартный; в браузере не проверял. Существующий тест MyFiles.test.jsx:311 передает dataTransfer без types Files, поэтому двойной вызов им не покрыт).

### B3. Window-обработчик drop в MyFiles не учитывает isSpecialView
- Файл: `pages/myFiles/useMyFilesUpload.js:371-381`, `:325-329`
- Описание: React-обработчик в `MyFiles.jsx:1295` проверяет `!isSpecialView` (корзина и общие файлы), а `onDropAnywhere` и `handleDrop` такой проверки не делают. Эффект зависит от `isSpecialView`, но внутри обработчика он не используется.
- Сценарий: файлы брошены на страницу в представлении «Корзина» или «Общие» мимо drop-zone: открывается диалог загрузки, и загрузка идет в специальное представление.
- Severity: medium. Confidence: medium (зависит от поведения openUploadDialog в специальном представлении, не проверял).

### B4. Ответ probe для старого устройства перезаписывает detail выбранного
- **Статус 19.10.2026: RESOLVED локально**, подтверждено red → green в настоящей странице; 8 браузерных сценариев и изолированная сборка. [Подробности и ограничения — продолжение 13](../AUDIT_PLAN_2026-10-18.md#продолжение-13--поздние-ответы-ручного-опроса-мониторинга-19102026). Production-публикация отдельно. Ниже сохранено исходное наблюдение аудита.
- Файл: `pages/Monitoring.jsx:147-151` (probe), `:137-145` (эффект графиков, guard `detail?.id !== selectedId`), `:126-136` (эффект detail)
- Описание: `probe()` использует `selectedId` из замыкания и не проверяет, что выбор уже сменился. Ответ `setDetail(result)` относится к старому устройству. Эффект графиков тогда не запускается, а эффект detail не перезапрашивает, поэтому интерфейсы и графики нового устройства пусты до следующего 30-секундного обновления.
- Сценарий: оператор нажал «опросить» на устройстве A и сразу выбрал устройство B. Ответ по A приходит позже, и по B графики не появляются до следующего цикла.
- Severity: medium. Confidence: high.

### B5. Realtime-патчи задач сверх 10 отбрасываются молча
- Файл: `pages/tasks/useTasksPageController.jsx:311-318` (`taskIds.slice(0, 10)`, затем `patchTaskIds.clear()` в таймере)
- Описание: при пачке изменений (больше 10 разных задач за 75 мс) обрабатываются только первые 10. Остальные id удаляются из Set и никогда не перезапрашиваются. Ошибки не видно (`catch {}` с комментарием).
- Сценарий: массовая операция над задачами по WebSocket: часть строк в списке остается со старым статусом до ручной перезагрузки.
- Severity: medium. Confidence: high.

### B6. Ручное обновление Scan Center молча не работает, пока идет фоновый опрос
- Файл: `pages/scan-center/ScanCenterPage.jsx:1156-1160` (`if (refreshAllInFlightRef.current) return;` до `setRefreshing(true)`), вызов `:1962` (`refreshAll({ silent: false })`)
- Описание: если в этот момент идет тихий refreshAll (каждые 30 с или по SSE), ручной вызов выходит без действий: нет спиннера, нет ожидания, нет повтора.
- Сценарий: пользователь нажимает «Обновить» во время тихого цикла и видит, что данные не изменились.
- Severity: medium. Confidence: high.

### B7. Гонки ответов в загрузчиках Scan Center без requestId и AbortController
- Файл: `pages/scan-center/ScanCenterPage.jsx:1540-1560` (loadHostOverview; вызовы `:1291` при смене фильтров и `:1624` при открытии), `:797-807` (loadDashboard), `:833-857` (loadBranchOptions)
- Описание: в отличие от loadAgents, loadHosts и loadReviewItems, эти функции не сравнивают requestId и не отменяют предыдущий запрос. Более старый ответ перезаписывает новый, а `finally` старого запроса сбрасывает `setHostOverviewLoading(false)`, пока новый запрос еще идет.
- Сценарий: быстрая смена фильтра инцидентов: на экране результаты старого фильтра, индикатор загрузки уже погашен.
- Severity: medium. Confidence: medium.

### B8. Excel-книга в SharedFile скачивается заново при каждом закрытии полного просмотра
- Файл: `pages/SharedFile.jsx:330-360` (эффект с `fullPreviewOpen` в deps, ранний return при открытом просмотре, `setExcelWorkbook(null)` на `:340`)
- Описание: при закрытии полного просмотра эффект снова скачивает весь файл (`fetch` на `:342`), сбрасывает книгу в null, и затем повторно запрашивает мета превью.
- Сценарий: большой публичный Excel открыт и закрыт несколько раз: каждый раз полная загрузка и пустое состояние.
- Severity: medium. Confidence: high.

### B9. Поиск по сотруднику показывает только первые 20 записей (условно: страница не подключена, см. X1)
- Файл: `pages/Search.jsx:60-72` (`handleEmployeeSearch(page = 1)`, вызывается с лимитом 20), `:195-225` (таблица без пагинации)
- Описание: параметр `page` не используется ни в одном вызове, пагинации в UI нет. Заголовок показывает `results.data.total`, но выводится только первая страница.
- Сценарий (если маршрут будет восстановлен): поиск по отделу с 45 сотрудниками: заголовок «Найдено сотрудников: 45», в таблице 20 строк и нет способа увидеть остальные.
- Severity: low (пока не подключено); medium, если маршрут вернут. Confidence: high.

### B10. Гонки и двойная отправка в Search (условно: см. X1)
- Файл: `pages/Search.jsx:46-58` и `:60-72` (нет сравнения запросов), `:150` (заголовок берет живое значение `serialSearch`, а не выполненный запрос), `:103` и `:128` (Enter обходит disabled-кнопку)
- Описание: побеждает последний пришедший ответ, а не последний запрос. Заголовок показывает текст из поля, который мог измениться после поиска. Enter запускает поиск даже во время загрузки.
- Сценарий: ввели «A», нажали Enter, сразу ввели «B» и Enter: более медленный ответ по «A» может перезаписать ответ «B», а заголовок покажет «B».
- Severity: low. Confidence: medium.

### B11. Автосохранение разметки может не перепланироваться после пропущенного сохранения
- Файл: `pages/voice-video/VoiceLabelEditor.jsx:392-396` (эффект автосохранения, deps без `saving`), `:360` (save, ранний return при `st.saving`), `:64` (AUTOSAVE_MS = 30000)
- Описание: если save() длится дольше 30 с, таймер срабатывает при `st.saving === true`, функция сразу возвращается, и эффект не перезапускается, потому что `saving` не входит в deps. Несохраненные правки остаются до следующего изменения или ручного сохранения.
- Severity: low. Confidence: medium (зависит от длительности запроса).

### B12. Накапливаются слушатели loadedmetadata при частых сменах источника плеера
- Файл: `pages/voice-video/VoiceMeetingDrawer.jsx:855-864`
- Описание: на каждый переход (seek на другую часть медиа) добавляется новый `loadedmetadata` с `{ once: true }`. Если src сменился до события, предыдущий слушатель не удаляется; guard `el.src !== expected` срабатывает и все равно съедает `once`.
- Сценарий: быстрые переходы по таймкодам между частями медиа: слушатели копятся на элементе video.
- Severity: low. Confidence: medium.

### B13. Гонка загрузки статистики при смене вкладки
- Файл: `pages/Statistics.jsx:256-270` (loadActiveStats без requestId и abort), эффект `:300-306`
- Описание: `finally` более старого запроса выставляет `setLoading(false)`, пока новый запрос еще идет. Ошибка старой вкладки может показаться на новой (`setError` с подписью старой вкладки).
- Severity: low. Confidence: medium.

### B14. Перемещение маркера на карте: при частичном сбое UI не обновляется
- Файл: `pages/Networks.jsx:1299-1312` (onMapPointDrop)
- Описание: `Promise.all` по нескольким точкам отклоняется при первой ошибке, но часть точек уже сохранена на сервере. `refreshBranchContext()` стоит внутри try после `Promise.all` и не вызывается при ошибке. Пользователь видит общее сообщение «Ошибка перемещения маркера», а позиции на экране остаются старыми, хотя на сервере часть изменилась.
- Сценарий: группа маркеров перетащена, одна точка отклонена сервером: на экране все точки на старых местах, на сервере часть на новых.
- Severity: medium. Confidence: high.

### B15. Launch-токен VNC передается в query-строке vnc:// URI и в src iframe
- Файл: `pages/Vcs.jsx:101-115` (buildVncUri: `launch_token` и `api_base` в query), `:239-262` (handleConnectClick: скрытый iframe, `f.src = uri` на `:262`), `handleDownloadClick` (тот же токен в downloadVncLaunchFile)
- Описание: токен подключения попадает в URL, который передается обработчику протокола ОС. Бэкенд предусматривает этот поток (`backend/api/v1/vcs.py:408` create и `:426` redeem launch token), поэтому это скорее проектное решение с остаточным риском (аргументы обработчика протокола, логи ОС). Правило проекта о секретах касается кода, команд, логов и отчетов, а не URL как таковых.
- Severity: low. Confidence: medium (TTL и одноразовость redeem не проверял).

### B16. Письма (Mail): небезопасный путь без sandbox включен по умолчанию (defense in depth)
- Файлы: `components/mail/mailHtmlSandboxFlags.js` (parseFlag с default false), `components/mail/MailHtmlBody.jsx:70-75` (`dangerouslySetInnerHTML` при выключенном sandbox), `components/mail/mailHtmlContent.js:65-72` (DOMPurify с USE_PROFILES html, FORBID script, iframe, object, embed, link, meta, а также FORBID_ATTR srcdoc)
- Описание: HTML писем выводится через `dangerouslySetInnerHTML` с единственной защитой DOMPurify, а iframe-sandbox включается флагом, который по умолчанию выключен. Сейчас санитизация выглядит корректной, но при регрессии конфига DOMPurify письмо получит выполнение скриптов в origin приложения.
- Severity: low (defense in depth). Confidence: high (по коду).

---

## Conflicts

### C1. Права на маршрут /dlp задаются в двух местах (cross-area: App.jsx и layout)
- Файлы: `App.jsx:130` (`{ path: '/dlp', adminOnly: true }`), `components/layout/navigationConfig.jsx:64` (`permission: 'scan.read', adminOnly: true`)
- Описание: App проверяет только `adminOnly`, меню дополнительно требует `scan.read`. Администратор без `scan.read` может открыть DLP по прямому URL, но не видит пункт меню. Расхождение небольшое, но списки маршрутов поддерживаются вручную в двух местах.
- Severity: low. Confidence: high.

### C2. Префикс /networks и списки путей продублированы в 6 местах
- Файлы: `components/layout/MainLayout.jsx:605-606` и `:1851-1852`, `components/layout/navigationConfig.jsx:123-124` (одинаковая проверка `pathname === '/networks' || startsWith('/networks/')`); литералы путей в `components/feedback/toastActions.js:7-14`, `lib/desktopProtocolHandoff.js:22-24`, `lib/routeLoaders.js:115`.
- Severity: low. Confidence: high.

### C3. Несколько источников текущей БД: прямое чтение localStorage и хелперы
- Файлы: `pages/Networks.jsx:129-130` (чтение `selected_database` напрямую), `pages/Statistics.jsx:300-301` и `pages/Mfu.jsx:589-590` (слушатель storage на `selected_database`), `pages/Mfu.jsx:421-428` (`readSelectedDatabaseScope` для ключа кеша).
- Описание: часть страниц читает localStorage напрямую, часть через хелпер. Для B1 это и привело к смешению данных: ключ кеша вычисляется в момент, отличный от момента запроса.
- Severity: medium. Confidence: medium.

### C4. 12 подавлений react-hooks/exhaustive-deps в ScanCenterPage
- Файл: `pages/scan-center/ScanCenterPage.jsx:1232, 1244, 1254, 1262, 1269, 1278, 1294, 1311, 1331, 1349, 1355, 1424`
- Описание: линтер отключен для всех эффектов загрузки. Если в загрузчике появится новая зависимость из замыкания, stale closure не будет замечен. Часть эффектов обходит это через ref (`refreshAllRef`).
- Severity: medium. Confidence: medium.

### C6. Search использует общий legacy-клиент (условно: см. X1)
- Файл: `pages/Search.jsx:25` (`equipmentAPI` из `api/client.js`)
- Описание: по правилам проекта новые домен-API не добавляются в legacy client.js. Страница использует существующий метод, но переход на отдельный модуль не сделан.
- Severity: low. Confidence: high.

---

## Duplication

### D1. useDebouncedValue переопределен в 7 файлах, хотя есть hooks/useDebounce.js
- Файлы: `pages/Warehouse1C.jsx:132-138`, `pages/scan-center/ScanCenterPage.jsx:174`, `pages/AddressBook.jsx:126`, `pages/AdUsers.jsx:80`, `pages/GroupsAccess.jsx:58`, `components/myFiles/MyFilesShareDialog.jsx:77`; плюс инлайн-debounce в `pages/Passwords.jsx:275-278`.
- Что вынести: использовать `hooks/useDebounce.js` (его уже использует Mail.jsx).
- Severity: medium. Confidence: high.

### D2. Подписка на «database-changed» и storage('selected_database') скопирована
- Файлы: `pages/Mfu.jsx:589-606`, `pages/Networks.jsx:129-153`, `pages/Statistics.jsx:296-306`, `pages/Computers.jsx:1257-1265`; строковый литерал `'database-changed'` есть примерно в 15 файлах (включая `components/layout/MainLayout.jsx:1922`).
- Что вынести: хук `useDatabaseChangeListener(callback)` и константу `DATABASE_CHANGED_EVENT`.
- Severity: medium. Confidence: high.

### D3. Шаблон «requestId + AbortController» скопирован 6 раз в ScanCenter
- Файл: `pages/scan-center/ScanCenterPage.jsx:809-830` (loadReviewItems), `:859-895` (loadAgents), `:896-930` (loadHosts), `:933-1000` (loadHostIncidents), `:1003` (loadHostNewCount), `:1051` (loadHostScanRuns); одинаковые проверки `error?.name === 'CanceledError' || ...`.
- Что вынести: хук `useLatestRequest()`, который возвращает `begin()` и `isCurrent()`.
- Severity: medium. Confidence: high.

### D5. Дубли форм и таблиц в Search (условно: см. X1)
- Файл: `pages/Search.jsx:97-115` и `:122-140` (почти одинаковые формы поиска), `:147-193` и `:195-225` (таблицы).
- Что вынести: компонент формы поиска и компоненты таблиц.
- Severity: low. Confidence: high.

---

## Optimization

### O1. После каждого изменения Networks перезапрашивает весь контекст филиала
- Файл: `pages/Networks.jsx:879-890` (refreshBranchContext), 14 вызовов (`:1265, 1281, 1306, 1357, 1400, 1415, 1495` и другие), включая `onMapPointDrop` `:1299-1312` и `updatePort` `:1997-2010`
- Описание: одно перетаскивание маркера или сохранение порта инвалидирует кеш и повторно запрашивает branch-context (6 эндпоинтов, включая audit и sockets limit 10000) и все порты филиала (limit 10000). Это противоречит правилу проекта «обновлять кеш, а не перезагружать страницу».
- Severity: high. Confidence: high.

### O2. Загрузка филиала тянет до 10000 строк портов и розеток
- Файл: `pages/Networks.jsx:752-776` (`getBranchSockets(id, { limit: 10000 })`), `:862-875` (`getBranchPorts(id, { limit: 10000 })`)
- Описание: объем ответа растет с размером филиала и повторяется на каждый выбор филиала и после каждой правки (см. O1).
- Severity: medium. Confidence: high.

### O3. Networks: одна функция на 3262 строки
- Файл: `pages/Networks.jsx:119-3380`. 109 useState, 41 useMemo, 25 useEffect.
- Описание: изменение любого состояния (например, полей диалога) перерисовывает всю страницу с картой. Выделить карту, список портов, диалоги и загрузку в отдельные компоненты и хуки.
- Severity: high. Confidence: high.

### O4. Mail: функция на 2821 строку, ref-зеркала обновляются через useEffect
- Файл: `pages/Mail.jsx:225-3046`; ref-зеркала `pages/Mail.jsx:372-377` и синхронизация `:509-513` (`listDataRef.current = listData` в эффекте).
- Описание: ref обновляется после коммита, поэтому обработчики, вызванные между рендером и эффектом, видят старые данные. Эффекты, которые сами выставляют состояние (`:521-548`), дают лишние проходы рендера.
- Severity: high. Confidence: high (размер); medium (последствия ref).

### O5. Warehouse1C: функция на 1280 строк с 52 useState
- Файл: `pages/Warehouse1C.jsx:1017-2297`.
- Описание: панели баланса, движений, брошенных сотрудников и каталога перерисовываются вместе. Выделить панели и мемоизировать таблицы.
- Severity: high. Confidence: high.

### O6. ScanCenterPage: 2557 строк, 84 useState
- Файл: `pages/scan-center/ScanCenterPage.jsx` (весь файл); рядом `scan-center/HostDrawer.jsx` (832 строки), `scan-center/AgentsSection.jsx` (599).
- Описание: состояние нескольких секций (агенты, хосты, инциденты, обзор, drawer) в одном компоненте. Каждый тик опроса (3 с при отсутствии SSE) и каждый SSE-инвалидейт перерисовывают все секции.
- Severity: high. Confidence: high.

### O7. VoiceMeetingDrawer: 3318 строк, 50 useState
- Файл: `pages/voice-video/VoiceMeetingDrawer.jsx` (весь файл, функция с `:707`). Троттлинг timeupdate уже есть (`:786`, `:1691-1700`), но остальные состояния живут в одном компоненте.
- Severity: medium. Confidence: high.

### O8. TasksPageContext: useMemo не работает, потому что controller каждый рендер новый
- Файлы: `pages/tasks/TasksPageContext.jsx:14` (`useMemo(() => ({...}), [controller])`, pick из 286 ключей), `pages/tasks/useTasksPageController.jsx:788` (`return {` без мемоизации).
- Описание: новый объект controller на каждом рендере делает значение контекста новым, и все потребители слайсов перерисовываются при любом изменении контроллера.
- Severity: medium. Confidence: medium-high (по коду; React Profiler не запускал).

### O9. Monitoring: полный опрос каждые 30 с и цепочка перезапросов
- Файл: `pages/Monitoring.jsx:117-122` (интервал 30 с меняет revision), `:110-116` (overview всех устройств), `:126-136` (detail, зависит от revision), `:137-145` (графики, зависят от `detail?.current?.checked_at`).
- Описание: три запроса на цикл, график перезапрашивается при каждом изменении checked_at. При ошибках интервал не меняется (нет backoff), в отличие от VoiceVideoPage.
- Severity: medium. Confidence: high.

### O11. Passwords: секундный таймер перерисовывает всю страницу при раскрытом пароле
- Файл: `pages/Passwords.jsx:286-290` (`setInterval(() => setNowTs(Date.now()), 1000)`, пока есть раскрытые пароли), `:544` (scheduleHide).
- Описание: из-за обратного отсчета перерисовывается весь 1460-строчный компонент со списком. Вынести отсчет в дочерний компонент.
- Severity: medium. Confidence: high.

### O12. SharedFile: секундный интервал на всю публичную страницу без остановки
- Файл: `pages/SharedFile.jsx:514-518` (setInterval 1000 мс; `nowMs` используется только в `formatCountdown` на `:544`)
- Описание: интервал работает всегда, даже если срока действия нет или он истек. Вынести в отдельный компонент отсчета.
- Severity: low. Confidence: high.

### O13. Scan Center: авто-обновление каждые 30 с без учета видимости вкладки; SSE перезапускает опрос агентов
- Файл: `pages/scan-center/ScanCenterPage.jsx:1358-1364` (AUTO_REFRESH_MS = 30000, тихий refreshAll без проверки document.hidden), `:1419-1425` (эффект опроса агентов зависит от `scanSsePulse`, который инкрементируется на каждое SSE-событие; эффект сразу вызывает tick).
- Описание: при каждом SSE-инвалидейте стартует лишний getAgentsActivity; тихий refreshAll грузит дашборд даже во фоновой вкладке.
- Severity: medium. Confidence: medium.

### O14. MyFiles: опрос во время обработки перезапрашивает файлы, квоту и все папки
- Файл: `pages/MyFiles.jsx:186-216` (loadData: listFiles, getQuota, listFolders), `:340-355` (адаптивный опрос с backoff до 15 с)
- Описание: backoff есть, но каждый тик грузит квоту и полный список папок, хотя менялся только статус файла.
- Severity: medium. Confidence: high.

### O16. Mfu: applyPayload всегда заменяет payload, даже если данные не изменились
- Файл: `pages/Mfu.jsx:469-481`; опрос каждые 60 с `:562-566`.
- Описание: новый объект каждые 60 с перерисовывает весь 1675-строчный компонент. Сравнение по generated_at или по содержимому позволит пропускать ререндер.
- Severity: medium. Confidence: medium.

### O17. Tickets: список пересоздается по ключу при каждом изменении
- Файл: `pages/Tickets.jsx:80` (`key={`list-${refreshKey}`}`), `:33-38` (loadObjects)
- Описание: любая операция (создание заявки, смена статуса) размонтирует список, теряя прокрутку и локальное состояние. Вместо этого стоит обновить кеш.
- Severity: low. Confidence: high.

### O19. SharedFile: Excel скачивается через сырой fetch без AbortController
- Файл: `pages/SharedFile.jsx:342-357`
- Описание: при уходе со страницы загрузка файла (возможно десятки МБ) дочитывается до конца; cancelled-флаг только игнорирует результат.
- Severity: low. Confidence: high.

---

## Dead code

### X1. Search.jsx не подключен к маршрутам
- Файл: `pages/Search.jsx` (весь файл, 233 строки). Не импортируется в `App.jsx` и не имеет загрузчика в `lib/routeLoaders.js`.
- Расхождение документа и кода: `WEB-itinvent/CLAUDE.md` перечисляет `Search.jsx`, `Transfer.jsx` и `Work.jsx` как страницы приложения, а код их не подключает. Зафиксировано, решение не принималось.
- Severity: medium (мертвый код). Confidence: high. Что делать: подключить маршрут или удалить. Пункты B9, B10, C6, D5 относятся только к этому файлу и актуальны, если маршрут вернут.

### X2. Transfer.jsx и Work.jsx: заглушки без маршрутов (дубли друг друга)
- Файлы: `pages/Transfer.jsx` (21 строка), `pages/Work.jsx` (21 строка), текст «Страница в разработке.», отличаются только заголовком. Не подключены ни в `App.jsx`, ни в `lib/routeLoaders.js`. Расхождение с CLAUDE.md то же, что в X1.
- Severity: medium. Confidence: high.

### X3. Лог-вызовы в production-коде
- Файлы: `pages/Networks.jsx:132` (console.warn о некорректном branchId), `pages/Warehouse1C.jsx:1094` (console.warn), `pages/Mfu.jsx:548` (console.error), `pages/scan-center/ScanCenterPage.jsx:803, 826, 852, 882, 919, 986, 1027, 1043, 1087, 1124, 1146, 1413` (console.error в загрузчиках и опросе).
- Описание: console.log в scope не найден. Остальные вызовы — диагностика ошибок, но часть из них дублирует уведомления (notifyApiError).
- Severity: low. Confidence: high.


## Не проверено и ограничения
- Неиспользуемые модули и экспорты: в scope не найдено (не тестовые модули импортируются; экспорты с нулевым использованием вне файла не найдены).
- Поведение в браузере (React Profiler, реальные гонки, блокировщик всплывающих окон, drop) не воспроизводилось: все выводы по коду.
- Тесты и E2E не запускались (по правилам задания).
- Компоненты из components/mail, components/hub и lib/ смотрены только в объеме, нужном для конкретных пунктов (B16, C1, C2).
