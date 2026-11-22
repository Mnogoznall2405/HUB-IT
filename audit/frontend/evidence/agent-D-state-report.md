# Отчёт Агента D — аудит состояния, кэша и асинхронности web-фронтенда

- Репозиторий: `C:\Project\HUB-IT-main`, фронтенд `WEB-itinvent/frontend` (React 18 + Vite).
- Дата аудита: 2026-11-22. Режим: **строго read-only** (только чтение файлов и ripgrep/grep; код не менялся, сборки/тесты/ dev-серверы/рестарты не запускались).
- Метод: последовательное чтение перечисленных в задании файлов + точечные grep-обходы по паттернам (`AbortController`, `debounce`, `useParams`, `useSearchParams`, `signal`, `401`, `catch`, `invalidate`, `sequence/seq`, `requestId`, StrictMode и др.). Каждое утверждение сверено с кодом; номера строк указаны по текущему состоянию файлов.

## Резюме

Слой состояния/кэша/асинхронности защищён существенно лучше типичного уровня: детальные страницы используют `AbortController` + sequence-токены/проверки идентичности контроллера, чат — keyed in-flight с dirty-trailing, дедупликацией и seq-упорядочиванием, SWR-кэш — generations + отсоединение in-flight при инвалидации, auth — generation-токены и общий dedup-гейт на refresh. Классическая гонка «старый ответ затирает свежие данные» на перечисленных страницах **не найдена**.

Найдено: **1 дефект отмены запросов (пароли на ItObjectDetail — сигнал игнорируется)**, **1 пробел в сбросе auth-эпохи после входа по passkey/WebAuthn-устройству**, несколько замечаний низкого уровня. Ни одной находки категории «Высокая».

---

## Находки

### D-1. Сводка «Пароли» на ItObjectDetail: AbortSignal не доходит до запроса — запрос не отменяется

- **Категория:** Race conditions / отмена запросов при unmount и смене объекта.
- **Серьёзность:** Средняя (UI-эффект минимальный, но контракт отмены нарушен и запросы утекают).
- **Файлы:** `WEB-itinvent/frontend/src/pages/ItObjectDetail.jsx:58-63` (ветка `passwords`), там же эффект `SectionSummary` `87-99`; корень — `WEB-itinvent/frontend/src/api/passwords.js:6-9`.
- **Статус:** Confirmed.

Цитата (`ItObjectDetail.jsx:58-63`):

```js
async function loadSectionSummary(section, objectRef, signal) {
  if (section === 'passwords') {
    const payload = await passwordsAPI.getEntries({ object_ref: objectRef, limit: SUMMARY_PASSWORDS_LIMIT });
```

Цитата (`api/passwords.js:6-9`) — signal вообще не поддерживается:

```js
getEntries: async (params = {}) => {
  const response = await apiClient.get('/passwords', { params });
  return response.data;
},
```

Объяснение: `SectionSummary` создаёт `AbortController` (строка 88) и передаёт `signal` в `loadSectionSummary`; ветки `computers`/`inventory`/`monitoring` передают его дальше в `itObjectsAPI.*` (те принимают `{ signal }`, см. `api/itObjects.js:28-41`). Ветка `passwords` сигнал теряет, а `passwordsAPI.getEntries` положить его некуда — axios-конфиг не принимает `signal`. В итоге `controller.abort()` в cleanup отменяет все сводочные запросы, кроме паролей.

Сценарии:
1. Смена объекта `/it/objects/A?tab=overview` → `/it/objects/B?tab=overview`: в переходном рендере (`object` ещё A, `objectRef` уже B) эффект `SectionSummary` перезапускается и стартует сводку для B; следом родительский эффект делает `setObject(null)` (`ItObjectDetail.jsx:855-859`) → unmount → все запросы отменены, **кроме passwords**; при повторном монтировании сводка запрашивается снова. Итог: до двух «осиротевших» requests `/passwords` + дублирование.
2. Обновление на месте (кнопка «Обновить»/`runAction` → `load()`): пока идёт старый passwords-запрос, эффект при смене `sectionsKey` делает `setState({})`; старый ответ, придя последним, может записать устаревший счётчик в живой UI (данные того же объекта, поэтому риск отображения минимален).
3. Вкладка «Пароли» целиком (`ObjectPasswordsPanel.jsx:49-67`) страдает тем же корнем: там применён флаг `cancelled` (setState защищён), но сам запрос не прерывается при смене `objectRef`/unmount.

Замечание: журнал `itObjectsAPI.passwordsAudit` (строки 234-243) сигнал передаёт корректно — дефект только в `passwordsAPI.getEntries`.

Рекомендация (для владельца, не применялось): добавить `signal` в axios-конфиг `getEntries` и передать его из `loadSectionSummary`/`ObjectPasswordsPanel`.

### D-2. После входа по passkey / доверенному устройству не сбрасывается «эпоха отказа auth»

- **Категория:** AuthContext / обработка 401 / состояние после logout→login.
- **Серьёзность:** Низкая (окно проявления узкое, самовосстанавливается успешным refresh).
- **Файлы:** `WEB-itinvent/frontend/src/api/http.js:61-64, 281-283, 371-379`.
- **Статус:** Confirmed (пробел в коде); практическое влияние — Suspected (требует live-проверки).

Цитата (`http.js:61-64`) — счётчики «эпохи»:

```js
let authRequiredNotified = false;
let refreshFailureReported = false;
const resetAuthRejectionEpoch = () => { authRequiredNotified = false; refreshFailureReported = false; };
```

Цитата (`http.js:281-283`) — сброс только на двух URL:

```js
if (responseUrl.includes('/auth/login') || responseUrl.includes('/auth/verify-2fa')) {
  resetAuthRejectionEpoch();
}
```

Проверено grep-ом: `resetAuthRejectionEpoch` вызывается ровно из трёх мест — успешный `/auth/refresh` (`http.js:70`), успешный ответ с URL `/auth/login` или `/auth/verify-2fa` (`http.js:282`). Реальные конечные точки входа: `/auth/login` (`authPasswordLogin.js:5`), `/auth/verify-2fa-login` (`authPasswordLogin.js:25` — покрывается подстрокой `/auth/verify-2fa`), `/auth/verify-2fa` (`authPasswordLogin.js:17`), но **`/auth/passkey-login/verify` (`authPasskeyLogin.js:15`) и `/auth/trusted-devices/auth/verify` (`authTrustedDevices.js:39`) не покрываются**.

Объяснение: если в этой вкладке ранее сессия была окончательно отвергнута (`authRequiredNotified = true` — latch на «эпоху», `http.js:371-379`), то после повторного входа по passkey/WebAuthn-устройству latch не снимается. Если затем новая сессия будет отвергнута сервером (401 + окончательно неудачный refresh) без единого успешного `/auth/refresh` в промежутке, событие `auth-required` не отправится (`http.js:371`), AuthContext не вызовет `invalidateSession` (`AuthContext.jsx:371-379`) — **автоматического разлогина/редиректа на /login не произойдёт**; пользователь останется на странице с падающими API-запросами до ручной перезагрузки. Также останется подавленной телеметрия `client_refresh_failed` (`refreshFailureReported`).

Смягчающие факторы (проверено по коду): первый же успешный `/auth/refresh` (интервал silent refresh ~12 мин, `AuthContext.jsx:471-508`, или refresh из ретрауля 401, `http.js:332-339`) сбрасывает эпоху. Поэтому окно дефекта: ≤ ~12 минут после passkey-входа при одновременном серверном отзыве сессии без успешного refresh.

### D-3. `getOrFetchSWR({force:true})` может присоединиться к уже идущему обычному запросу того же ключа

- **Категория:** Кэш (`lib/swrCache.js`) — семантика force/дедупликация.
- **Серьёзность:** Низкая.
- **Файл:** `WEB-itinvent/frontend/src/lib/swrCache.js:114-136` (`runDedupedFetch`), `138-171` (`getOrFetchSWR`).
- **Статус:** Confirmed (семантическая особенность, не порча данных).

Цитата (`swrCache.js:114-117`):

```js
const runDedupedFetch = async (cacheKey, fetcher) => {
  if (inFlightStore.has(cacheKey)) {
    return inFlightStore.get(cacheKey);
  }
```

Объяснение: путь `force` (`swrCache.js:169`) тоже идёт через `runDedupedFetch` и не отсоединяет существующий in-flight (это делает только `invalidateSWRCacheByPrefix`, `swrCache.js:72-76`). Если пользователь нажимает «Обновить» (`force`) в момент, когда по тому же ключу уже идёт фоновая revalidate, он получит её результат — запрос не перезапустится. Данные при этом актуальные (запрос свежий), так что это скорее Guarantees-нарушение ручного обновления, чем гонка. В чате слои выше это компенсируют своим keyed in-flight (`chatKeyedInFlight.js:11-41`, joined-вызов помечает `dirty` и получает результат **финального** trailing-прогона).

### D-4. Инвалидация SWR отсоединяет кэш, но не защищает состояние самого вызывающего

- **Категория:** Кэш/гонка read-write.
- **Серьёзность:** Низкая (потребители `getCachedGet` малозначимы; в чате есть собственные seq-проверки).
- **Файлы:** `WEB-itinvent/frontend/src/lib/swrCache.js:70-76, 162-165`; потребители `getCachedGet`: `api/settings.js:32-41`, `api/mailNotifications.js:23-30`.
- **Статус:** Suspected (нужна live-проверка на реальном сценарии мутация+чтение).

Объяснение: комментарий в `swrCache.js:70-71` корректен — отсоединённый in-flight не перезапишет кэш. Но вызывающий код, который уже `await`-ит этот промис, всё равно получит «дофетченный» ответ и, если не перепроверяет актуальность после await, применит его к своему состоянию. В чате все такие места перепроверяются (`useChatThreadController.js:506-508` — `requestSeq !== messagesRequestSeqRef.current || activeConversationIdRef.current !== id`; `useChatConversationsController.js:151`). У двух потребителей `getCachedGet` (push-конфиг, счётчик непрочитанных почты) перепроверки нет — максимум кратковременно устаревший бейдж.

### D-5. ChatOpen: в dev/StrictMode `createDirectConversation` может вызваться дважды

- **Категория:** Дублирование запросов при монтировании (StrictMode).
- **Серьёзность:** Низкая, dev-only (прод-сборка StrictMode-дублирование эффектов не выполняет).
- **Файл:** `WEB-itinvent/frontend/src/pages/ChatOpen.jsx:35-69`; `src/main.jsx:96` (`React.StrictMode`).
- **Статус:** Suspected (требует live-проверки в dev; дедуп direct-беседы — серверная контракт-гипотеза).

Объяснение: эффект (`ChatOpen.jsx:35-69`) кэширует по `key` только промис `resolveUser` (`lookupRef`, строки 43-47), но `chatConversationsAPI.createDirectConversation(id)` (строка 56) выполняется в теле каждого запуска эффекта. В React 18 StrictMode dev эффект монтируется дважды → два POST create-direct. Прод не затронут; влияние в dev зависит от того, дедуплицирует ли бэкенд direct-беседы по паре пользователей (обычно да). В остальном компонент защищён образцово: `cancelled`-флаг, сброс `error/resolved` на повторный запуск, кэш lookup по `${user?.id}:${email}:${attempt}`.

### D-6. Computers: фоновая загрузка изменений без abort/флага cancelled

- **Категория:** setState после unmount / незавершаемый запрос.
- **Серьёзность:** Низкая (React 18 игнорирует setState на размонтированном компоненте; остаётся лишний запрос).
- **Файл:** `WEB-itinvent/frontend/src/pages/Computers.jsx:950-960` (`loadChangesDeferred`).
- **Статус:** Confirmed.

Цитата:

```js
const loadChangesDeferred = useCallback(() => {
  equipmentAPI.getAgentComputerChanges(50)
    .then((changeData) => { if (changeData && typeof changeData === 'object') setChanges(changeData); })
```

Нет ни `AbortController`, ни `cancelled`, ни seq — в отличие от основного загрузчика этой же страницы, который защищён образцово (`Computers.jsx:1012-1051`: `requestId`-seq + abort + ETag). Находка попутная (страница вне основного перечня задания).

### D-7. Monitoring: polling overview+detail каждые 10 секунд (информационное, не дефект)

- **Категория:** Дублирование/нагрузка.
- **Серьёзность:** Информационное.
- **Файл:** `WEB-itinvent/frontend/src/pages/Monitoring.jsx:151-156` + эффекты `144-150`, `160-170` (депсы включают `revision`).
- **Статус:** Confirmed как поведение; осознанный дизайн живого дашборда.

Каждые 10 с при видимой вкладке `setRevision(v+1)` перезапускает и `api.overview`, и `api.detail` выбранного устройства. Предыдущие запросы корректно прерываются (`controller.abort()` в cleanup), гонок нет, но при долгом простое на странице трафик постоянный. Владельцу стоит помнить об этом при оценке нагрузки бэкенда от «забытых» вкладок.

---

## Что проверено и подтверждено как защищённое (по пунктам методички)

**1. Race conditions (ответы не по порядку).** Защита подтверждена по коду:
- `ItObjectDetail.jsx:837-859`: `abortRef` + проверка `abortRef.current === controller` перед каждым `setObject/setError/setLoading`; смена `objectRef` сбрасывает объект. `MonitoringTab` (`346-385`): `requestSeqRef` + «poll не накладывается на in-flight»; очистка на unmount (`375-385`).
- `ConstructionObjectDetail.jsx:73-127`: идентичность контроллера + `isConstructionRequestCancelled` (распознаёт `ERR_CANCELED/CanceledError/AbortError` — проверено в `constructionShared.js:44-47`); смена `objectId` сбрасывает состояние (`129-139`); авто-обновление только при видимой вкладке (`164-191`).
- `ConstructionDirectionDetail.jsx:305-456`: поверх контроллеров — `requestContextRef` (`273-277`, проверки `314`, `342`, `393`, `440`), busy-refs против наложений (`370`, `431`); сброс состояния на смену `objectId/groupRef` (`458-471`) и на смену `requestRef` (`473-483`).
- `Monitoring.jsx:144-170`: abort в cleanup, проверки `controller.signal.aborted` в then/catch/finally; `selected`/`interfaces` защищены от чужого `detail` (`92-93`); ручной `probe` — `isCurrent()`-контекст (`172-194`).
- `monitoring/useMonitoringHistory.js:21-49`: AbortController + `if (controller.signal.aborted) return` в then/catch, кэш с TTL 60 c и LRU-лимитом, merge инкрементальных точек по `replace_from`.
- `ChatOpen.jsx`, `Computers.jsx:1012-1051`, `hooks/useScanIncidentInbox.js:26-88` — аналогично защищены (seq + abort).

**2. Показ данных другого объекта после переключения.** Все перечисленные детальные страницы сбрасывают состояние при смене route-параметра (см. выше); `useEffect` с `[]` вместо `[id]` на этих страницах не найдено. `MyFilesEditor.jsx:32-33` + `MyFilesEditorWorkspace.jsx:44-51,167-177`: воркспейс хранит все открытые документы замонтированными (keyed by `item.id`, скрытие через `visibility`) — при переключении fileId/вкладок редакторы и их несохранённые правки не теряются; `requestKey` (location.key) в депсах эффекта не роняет воркспейс при back/forward.

**3. Дублирование запросов.** Дедупликация: `swrCache.js` (`inFlightStore`, generations, отсоединение при `invalidateSWRCacheByPrefix` — `63-77`); чат — `chatKeyedInFlight.js` (same-key join + dirty-trailing, joined-вызов получает результат финального прогона); bootstraps чата сходятся в один keyed in-flight. StrictMode включён (`main.jsx:96`) — двойные эффекты только в dev, и почти все загрузчики имеют abort/seq, гасящие второй прогон. Fetch-вызовов в render не найдено (в render пишутся только ref-значения, напр. `Monitoring.jsx:54-55,74-75`).

**4. AuthContext.** Одиночный `/auth/me` через gate `sessionRefreshGateRef` (`AuthContext.jsx:241-266`); generation-токен блокирует запись ответа, начатого до logout (`190-213`, `515-522`, комментарий в `666-669`); восстановление из фоновой вкладки/онлайна с бэкоффом `[1,2,5,15,30] c` (`298-369`); межвкладочная синхронизация через `storage` с повторной верификацией (`392-467`); silent refresh каждые ~12 мин идёт через общий с 401-интерцептором dedup `refreshAuthSession` (`http.js:66-76`) — параллельные refresh-ы дедуплицированы; logout очищает SWR, черновики чата, mail-кэш, media-session (`195-213`). Redirect-цикл при 401 исключён: один retry после refresh, `authRequiredNotified`-latch, ProtectedRoute (`App.jsx:160-174`) редиректит только по состоянию `user/loading`, а не по событию. Замечание к дизайну: `isDefinitiveSessionRejection` (`AuthContext.jsx:171-174`) трактует и **403** от `/auth/me` как конец сессии.

**5. api/http.js и доменные модули.** 401 → один refresh + один retry (`http.js:311-381`); `/auth/login`, `/auth/refresh`, telemetry и интерактивные auth-флоу исключены из ретрауля; 401 от scan/voice после успешного refresh не роняет основную сессию (`365-367`). Пустых `catch {}` без комментария в `src/pages` не найдено (grep `catch \{\s*\}` — 0 совпадений); все глотаемые ошибки — осознанные best-effort с комментарием. `then` без `catch` в перечисленных загрузчиках не встретились.

**6. WebSocket чата.** `lib/chatSocket.js`: reconnect с нарастающими задержками (`907-930`), heartbeat `chat.ping` с порогом missedPongs и форсированным переподключением (`935-963`), auth-коды закрытия 4401/4403 (`495`), volatile-команды (typing/ping) не копятся офлайн (`51`), очередь офлайн-отправок ограничена 100 с drop-oldest (`43`, `1107-1124`) — backpressure ограничен; дубликаты доставки гасятся: `previewAppliedByConversation` для сайдбара (`useChatSocketEvents.js:305-310`), `hasPersistedThreadMessageEquivalent`/`alreadyRendered` для активного треда (`352`), слияние по `id`/`client_message_id` (`chatThreadMessageMerge.js`); порядок — `sortThreadMessages` + `conversation_seq` (`compareThreadMessagePosition`); защита от «дыр» при has_newer (R27, `useChatSocketEvents.js:396-399`). Polling fallback: при WS-off — интервалы списка/треда (`useChatActiveThreadPolling.js:122-142`); при degraded — инкрементальный poll с экспоненциальным бэкоффом, honour `Retry-After`, отменой при hidden/офлайн и inFlight-гейт (`144-267`); фоновые причины (`poll:*`, `socket:*`, `window:*`) не показывают тосты (`chatThreadTransport.js:105-127`); повторное подключение сокета догоняет тред всегда (`useChatSocketEvents.js:122-143`).

**7. Состояния loading/error/empty.** Во всех проверенных загрузчиках `finally` снимает loading, ошибки пишутся в state и отображаются (ItObjectDetail `927-928`, ConstructionObjectDetail `281-287`, ConstructionDirectionDetail — блоки `Alert` с retry, Monitoring `253-264`, MyFilesEditorSession — фазы `loading/error/blocked/refreshing` с сообщениями и ретраями `60-64, 345-362`); empty-states присутствуют (ItObjectDetail `400-402, 557-559, 792-796`; Monitoring `258`; ConstructionDirectionDetail `RequestList 88-95`). «Вечный loading» при ошибке не найден.

**8. Поиск без debounce.** Серверные поиски защищены: `ConstructionDirectionDetail` — debounce 350 мс в URL-параметр (`279-290`); `Computers` — debounce + мин. длина (`962-970`); AddressBook, AdUsers, MyFilesShareDialog, MailComposeHost, TaskActionDialogs, chat sidebar (`CHAT_SEARCH_DEBOUNCE_MS`) — debounce применён (grep-обход). Локальные фильтры без запросов (ItObjectDetail InventoryTab `705-713`, Monitoring `109`) — debounce не требуется.

**9. Черновики/формы.** `useChatDraftsAndPinned.js`: черновик пишется debounce 320 мс (`94-125`); при смене беседы предыдущий ключ флашится с ещё актуальным `latestMessageTextRef` (`160-179`) — порядок эффектов в `ChatPageContent.jsx` гарантирован (drafts-хук через `useChatPageCoreBridge` вызывается на строке 294, draft-restore — 1132, обновление `latestMessageTextRef` — 1144: флаш предыдущего ключа выполняется раньше, чем ref узнает текст новой беседы); флаш на `pagehide` и unmount (`128-157`); запись запечатывается после logout-свипа (`chatDraftsStorage` seal, строки `56-57`); режим редактирования сохраняет снапшот редактируемого, а не текущий текст (`85-92`). Проверено — потери черновика при переключении бесед/вкладок не найдено. Несохранённые правки документов: `useMyFilesEditorSession.js` — `beforeunload` при dirty (`408-413`), discard-подтверждения при закрытии/переоткрытии (`432-441`), чекпоинты-forcesave с ожиданием clean-состояния (`378-390`).

## Что осталось непроверенным

- **Live-поведение WebSocket** (реальные разрывы, дубликаты на сокете, поведение очереди из 100 сообщений под нагрузкой) — статический разбор только; запуски по условиям задачи запрещены.
- **Влияние D-2** (застрявшая auth-эпоха после passkey-входа) — нужна live-проверка сценария «401-эпоха → вход по passkey → серверный отзыв сессии до первого успешного refresh».
- **Серверный TTL access-токена**: silent refresh исходит из `ACCESS_TTL_MS = 15 мин` (`AuthContext.jsx:474`); backend-часть не аудировалась (за пределами фронтенда), соответствие константы фактическому TTL не проверено.
- **Страницы вне перечня задания** — не аудировались (кроме попутных проверок Computers.jsx, useScanIncidentInbox, construction-компонентов): Mail.jsx, Networks.jsx, Database.jsx, tasks/, mail/, scan-center/, voice-video/, addressBook и др.
- **StrictMode-дублирование в dev** — не проверялось запусками; в прод-сборке не проявляется.
- **Микросценарии swrCache** (одновременные force/stale/invalidate по одному ключу в разных частных порядках) — проанализированы статически; полный перебор interleavings не моделировался.

## Прочитанные файлы (полностью или по ключевым секциям)

`contexts/AuthContext.jsx`; `api/http.js`, `api/client.js`, `api/auth.js`, `api/passwords.js`, `api/itObjects.js`, `api/settings.js`, `api/mailNotifications.js`, `api/authPasswordLogin.js`, `api/authPasskeyLogin.js`, `api/authTrustedDevices.js`, `api/authAccountSecurity.js`; `lib/swrCache.js`, `lib/chatSocket.js`; `main.jsx`, `App.jsx`; `pages/ItObjectDetail.jsx`, `ConstructionObjectDetail.jsx`, `ConstructionDirectionDetail.jsx`, `Monitoring.jsx`, `ChatOpen.jsx`, `MyFilesEditor.jsx`, `Computers.jsx` (секции загрузки/поиска); `pages/monitoring/useMonitoringHistory.js`; `pages/chat/useChatThreadController.js`, `useChatSocketController.js`, `useChatScrollController.js`, `useChatDraftsAndPinned.js`, `useChatConversationDraftRestore.js`, `useChatPageController.jsx`, `useChatPageCoreBridge.js`, `useChatConversationsController.js`, `chatThreadTransport.js`, `chatKeyedInFlight.js`, `ChatPageContent.jsx` (секции эффектов); `components/chat/useChatActiveThreadPolling.js`, `useChatSocketEvents.js`; `components/myFiles/MyFilesEditorWorkspace.jsx`, `useMyFilesEditorSession.js`; `components/itObjects/ObjectPasswordsPanel.jsx`; `components/construction/ConstructionWorkCharts.jsx`, `ConstructionWorkWorkspace.jsx`, `constructionShared.js`; `components/itObjects/itObjectsShared.js`; `hooks/useScanIncidentInbox.js`.
