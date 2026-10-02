# Веб-чат: план стабилизации и доработки UX — 2026-09-30

Статус: **план для исполнителя**. Код не менялся. Production, deployment и рестарты вне объёма.
Область: веб-чат (`WEB-itinvent/frontend`, общий для браузера и Desktop/WebView2) и backend `WEB-itinvent/backend/chat`, `api/v1/chat`. `mobile-hub/` (Expo) не входит.

## 1. Итог аудита

Чат в целом зрелый: есть идемпотентная отправка через `client_message_id`, outbox и relay, отключение медленных клиентов, «якорь» при догрузке истории и опрос при деградации WebSocket. Прокрутка в штатном сценарии на стенде работает. При открытии беседа стоит внизу. Входящее сообщение внизу докручивается. Входящее во время чтения истории позицию не сбивает. Сдвиг якоря при догрузке истории — 6 px.

Надёжность ломается на краевых сценариях. Это и есть «прерывания» и «сообщения не пришли/не обновились»:

| ID | Приоритет | Проблема | Подтверждение |
|---|---|---|---|
| P0-1 | P0 | Один сбой загрузки ленты (503/сеть) — беседа навсегда остаётся на скелетоне: ни повтора, ни ошибки, ни кнопки | Стенд на production-сборке |
| P0-2 | P0 | Обновления сообщений по сокету отбрасываются: голоса в опросах, реакции (при пересинхронизации), карточки действий AI, `forward_preview` | Probe + стенд |
| P1-1 | P1 | Rate-limit WS: нарушения не «остывают», лимитер общий на все вкладки пользователя; после 3 нарушений закрытие 1008 → клиент считает это запретом и **больше не переподключается** | Код + тесты |
| P1-2 | P1 | Ошибка отправки через WS закрывает сокет без переподключения; серверная ошибка валидации трактуется как обрыв; ожидание до fallback — 15 с | Код |
| P1-3 | P1 | Входящее сообщение отмечается прочитанным, даже если пользователь читает историю вверху. Счётчик на кнопке «вниз» обнуляется, у отправителя ложные ✓✓ | Код + стенд (бейдж не появился) |
| P1-4 | P1 | Нет индикатора соединения: `socketStatus` протаскивается в UI, но нигде не рисуется | Код + стенд |
| P1-5 | P1 | При деградации WS каждая открытая вкладка опрашивает ленту **каждую 1 с**, без backoff на ошибки и без паузы офлайн. При падении backend получается шторм запросов | Код |
| P1-6 | P1 | После переподключения догрузка активной ленты пропускается, если список бесед грузился <3 с назад или грузится сейчас | Код |
| P2-1 | P2 | Сортировка ленты — строковым сравнением `created_at`. Смешанные форматы (`Z` / `+00:00`) и часы клиента у оптимистичных сообщений дают неверный порядок и «перескок» | Probe |
| P2-2 | P2 | Превью ссылки появляется после загрузки и сдвигает ленту. При открытии высота контента выросла на ~290 px через ~0,7 с — видимый прыжок | Стенд |
| P2-3 | P2 | В группах у своих сообщений нет индикатора отправки, ✓ или ✓✓ (есть только в личных) | Код + стенд |
| P2-4 | P2 | На телефоне при открытии беседы по ссылке или уведомлению нижняя навигация остаётся видимой: прячется только по завершении анимации перехода | Код + стенд (нужно подтвердить на устройстве) |
| P2-5 | P2 | Детектирование «мёртвого» сокета занимает до ~75–100 с (3 пропущенных pong по 25 с); при принудительном закрытии висящие команды не отклоняются | Код |
| P2-6 | P2 | Красный тест `ChatThread.test.jsx`: композер `minHeight: 44px` | Прогон тестов |
| P3 | P3 | Отладочный мусор `#region agent log` в горячих путях; неограниченный рост DOM без виртуализации; несколько независимых «писателей» `scrollTop` | Код; вынести в отдельный этап |

## 2. Как проверялось

- Frontend-тесты чата (`src/lib/chatSocket.test.js src/lib/chat src/pages/chat src/components/chat src/pages/Chat*.test.jsx`): **868/869**, 134 файла, 82 с. Падает `ChatThread.test.jsx › uses one compact desktop primary font size…` (ожидается `minHeight: 44px` у композера).
- Изолированная production-сборка во временную папку (2 мин 50 с). Хеши рабочих `dist/index.html` и `dist/sw.js` не изменились.
- Playwright-стенд на моках API и WebSocket (`page.routeWebSocket`), desktop 1440×900 light и mobile 390×844 dark. Сценарии: открытие беседы, замер `scrollTop` 3,5 с, входящее внизу, входящее при чтении истории, догрузка старых, `message.updated`, обрыв WS, 503 на bootstrap.
- Логические probe чистых модулей через `vite-node`: `areThreadMessagesEquivalent`, `upsertThreadMessagesInList`, `sortThreadMessages`.
- Backend-тесты **не запускались**: gate-скрипт может подхватить корневой `.env` (production БД). Для P1-1 нужен изолированный запуск (см. раздел 6).

Артефакт dev-режима: под `React.StrictMode` лента не грузится вообще (отменённый bootstrap не повторяется). В production-сборке этого нет, но корень тот же, что у P0-1: отменённая или упавшая загрузка не перезапускается.

## 3. Находки и что сделать

### P0-1. Беседа зависает на скелетоне после сбоя загрузки

**Где:** `pages/chat/useChatThreadController.js` (`loadThreadBootstrap`, catch/finally ~370–400), `pages/chat/chatThreadMessages.js` (`resolveActiveThreadRenderState`: `loading = !hydrated || messagesLoading`), `pages/chat/useChatActiveConversationThreadBootstrap.js` (`lastHandledThreadLayoutKeyRef`), `components/chat/ChatMessageList.jsx`.

**Сценарий (воспроизведён):** первый `GET …/thread-bootstrap` → 503. Через 12 с: 0 сообщений, скелетон, повторного запроса нет, тоста нет. WS при этом здоров, поэтому деградационный опрос не включается.

**Сделать:**
1. Ввести явное состояние ошибки ленты для активной беседы (`threadLoadError`), отдельно от `messagesLoading`.
2. Автоповтор для временных ошибок (`isTransientLoadMessagesError`: 0/502/503/504, плюс read-concurrency с `retry-after`): 1 → 2 → 5 → 10 → 30 с с джиттером. Прекращать при смене беседы или unmount.
3. После исчерпания или неповторяемой ошибки (403/404) показать в ленте блок «Не удалось загрузить сообщения» с кнопкой «Повторить», вместо скелетона.
4. Отмена bootstrap (`abortActiveThreadLoad` на unmount или в StrictMode) не должна оставлять `lastHandledThreadLayoutKeyRef` в «обработанном» состоянии. Повторный mount обязан загрузить ленту.

**Приёмка:** тест «503, затем 200» → лента появляется без действий пользователя. Тест «403» → блок ошибки с кнопкой, клик → повторный запрос. В dev-режиме (StrictMode) беседа открывается.

### P0-2. Обновления сообщения отбрасываются при слиянии

**Где:** `pages/chat/chatThreadMessages.js` → `buildThreadMessageSignature` / `areThreadMessagesEquivalent`; используется в `chatThreadMessageMerge.js#upsertThreadMessagesInList` и `reconcileThreadMessages`.

**Суть:** подпись не включает `poll`, `reactions`, `action_card`, `forward_preview`, `is_deleted`/`deleted_*`, `conversation_seq`, размеры и `variant_urls` вложений. Если меняется только одно из этих полей, новое сообщение считается «эквивалентным» и не применяется.

**Доказательства:** probe — `POLL_EQUIV true`, `REACTION_EQUIV true`, `ACTIONCARD_EQUIV true`, `UPSERT_POLL_APPLIED false`. Стенд: `chat.message.updated` с новыми реакциями не изменил DOM. Голос в опросе (`poll-vote` → `chat.message.updated`) у других участников не отображается вживую. После переподключения полная пересинхронизация оставляет устаревшие реакции и карточки.

**Сделать:** включить в подпись все поля серверного payload, влияющие на рендер: `poll` (варианты, голоса, `closed`, мой голос), `reactions` (emoji, count, `reacted_by_me`), `action_card` (статус), `forward_preview`, `is_deleted`, `deleted_at`, `conversation_seq`, а у вложений — `width`, `height`, `variant_urls`, `duration_seconds`. Альтернатива: сравнивать стабильную сериализацию всего серверного объекта без клиентских полей (`renderKey`, `uploadProgress`). Ссылочное равенство для неизменённых сообщений сохранить, иначе MemoChatBubble начнёт перерисовывать всё.

**Приёмка:** unit-тесты на каждое поле. Тест `useChatSocketEvents`: `message.updated` с новым `poll` меняет state. Существующий тест производительности `Chat.performance.test.jsx` зелёный.

### P1-1. Rate-limit WS «навсегда» глушит сокет

**Где:** backend `chat/realtime.py` (`ChatWsCommandRateLimiter`, `allow_ws_command`, ~142–165 и ~757–768), `api/v1/chat/ws.py` (~195–225); frontend `lib/chatSocket.js` (`NON_RECONNECTABLE_CLOSE_CODES`, `handleMessage` для `error`).

**Суть:**
- `violations` только растёт. Сравнение: в `task_canvas/realtime.py:71` счётчик сбрасывается.
- Лимитер общий на пользователя (все вкладки плюс Desktop) и удаляется только когда у пользователя не осталось соединений.
- После `CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS=3` — `close(1008)`. Клиент держит 1008 в `NON_RECONNECTABLE_CLOSE_CODES` → `authBlocked = true` → переподключение только по событию обновления сессии.
- Ответ `error/rate_limited` отправляется **без `request_id`**. Команда на клиенте висит до таймаута в 15 с.

**Сделать (backend):** сбрасывать `violations` после окна без нарушений (например, 60 с). Отвечать `rate_limited` с `request_id` исходной команды, если его удалось извлечь. Для закрытия по rate-limit использовать отдельный код, например `4429`, с `retry_after_ms` в reason или отдельном событии; 1008 оставить только для политики и авторизации.

**Сделать (frontend):** код `4429` → переподключение не раньше `retry_after`, без `authBlocked`. `error` с `code=rate_limited` и `request_id` → отклонить конкретную команду. `flushQueue` после переподключения: схлопывать `chat.mark_read` до последнего на беседу, чтобы очередь до 100 команд не выбивала burst в 40.

**Приёмка:** pytest — нарушения сбрасываются после окна, `rate_limited` содержит `request_id`, закрытие кодом 4429. Vitest — `onclose(4429)` планирует reconnect, `authBlocked === false`; flush схлопывает mark_read.

### P1-2. Сбой отправки через WS ломает сокет

**Где:** `components/chat/useChatComposerSending.js` (catch вокруг `chatSocket.sendMessage` → `chatSocket.close()`), `lib/chatSocket.js` (`close`, `sendCommand`, `REQUEST_TIMEOUT_MS`).

**Суть:** `close()` снимает `onclose`, поэтому `scheduleReconnect` не вызывается. Сокет «мёртв», пока что-то не вызовет `send`/`connect` (например, начало набора текста). Любой `chat.error` (валидация, права) тоже приводит к закрытию сокета и повтору по HTTP.

**Сделать:**
- Разделить ошибки: транспортные (таймаут, обрыв) → HTTP fallback с тем же `client_message_id` и **переподключение** через новый метод `chatSocket.reconnectNow()` (без ручного `close`). Серверные `chat.error` с кодом → показать ошибку, без fallback и без закрытия.
- Таймаут подтверждения `send_message` — 6–8 с вместо общих 15 (параметр `sendCommand`).

**Приёмка:** vitest — таймаут send → HTTP fallback → сокет снова `connecting`/`connected`. Серверная ошибка → сообщение об ошибке, один запрос, сокет не закрыт.

### P1-3. Прочтение без фактического просмотра

**Где:** `components/chat/useChatSocketEvents.js#handleMessageCreated` (~291–377: `shouldTreatAsRead = isActive && tabIsVisibleAndFocused`, `markConversationReadLiveRef`), `components/chat/useReadReceipts.js` (IntersectionObserver уже есть), бейдж кнопки «вниз» в `ChatThread.jsx` (~1504, `activeConversation.unread_count`).

**Сделать:** отмечать прочитанным только если `threadNearBottomRef.current === true` (или сообщение видно через `useReadReceipts`). Иначе увеличивать счётчик непрочитанных активной беседы. Кнопка «вниз» показывает его, по мере прокрутки счётчик уменьшается через `useReadReceipts`. Разделитель «Непрочитанные» при возврате в беседу строить от реального `viewer_last_read`.

**Приёмка:** тест «пользователь вверху + входящее» → `markRead` не вызван, бейдж = 1. Прокрутка вниз → `markRead` с последним id, бейдж 0. Сценарий «внизу» без изменений.

> Нужно решение пользователя (раздел 7, вопрос 1): это меняет семантику «прочитано» для отправителя.

### P1-4. Индикатор соединения

**Где:** `components/chat/ChatThreadHeader.jsx` (подзаголовок), проброс `socketStatus` уже идёт через `useChatThreadSection.jsx` → `ChatThread.jsx`; `navigator.onLine`.

**Сделать:** в подзаголовке шапки вместо «N участников» показывать «Соединение…» (reconnecting/connecting) или «Нет сети» (offline). Показывать только если состояние держится ≥2 с, чтобы не мигать при коротком переподключении. При `unauthorized` — «Сессия истекла», дальше действует штатный auth flow. Смену подписи сделать через плавный переход без изменения высоты шапки.

**Приёмка:** тест — `reconnecting` 1 с → индикатора нет; 2,5 с → есть; `connected` → исчез. Скриншоты light/dark, desktop/mobile.

### P1-5. Шторм опросов при деградации WS

**Где:** `pages/chat/chatPageConstants.js` (`CHAT_ACTIVE_THREAD_INCREMENTAL_POLL_MS = 1_000`), `components/chat/useChatActiveThreadPolling.js` (incremental loop, backoff только на read-concurrency).

**Сделать:** стартовый интервал 3 с, экспоненциальный backoff на любую ошибку (до 30 с, джиттер ±20 %), пауза при `navigator.onLine === false` с немедленным опросом на `online`, сброс на успехе. Не опрашивать скрытую вкладку (уже есть).

**Приёмка:** fake timers — 3 ошибки подряд → интервалы растут, при `offline` запросов нет.

### P1-6. Пропуск догрузки после переподключения

**Где:** `components/chat/useChatSocketEvents.js#handleSocketStatus` (~84–104): `return` при `lastConversationsLoadAt < 3 с` или `conversationsLoadingRef` срабатывает до догрузки ленты.

**Сделать:** троттлинг применять только к `loadConversations`. Для активной беседы на каждом переходе в `connected` (кроме самого первого подключения) выполнять `loadMessages(active, buildActiveThreadPollLoadOptions(messages))` — инкрементально после последнего id. Дедупликация — существующим keyed in-flight.

**Приёмка:** тест «reconnect через 1 с после загрузки списка» → запрос `after_message_id` выполнен.

### P2-1. Порядок сообщений

**Где:** `pages/chat/chatThreadMessages.js` (`sortThreadMessages`, `compareThreadMessagePosition`).

**Probe:** `2026-09-30T10:00:00Z`, `…00.5+00:00`, `…00.100000+00:00` сортируются как `c,b,a` вместо `a,c,b`.

**Сделать:** если у обоих `conversation_seq > 0`, сравнивать по seq. Оптимистичные (без seq, `isOptimistic`) — всегда после сохранённых, между собой по времени создания на клиенте. Иначе сравнивать `Date.parse`, затем id. Функции сравнения должны совпадать с `shouldPreserve*` в `reconcileThreadMessages`.

**Приёмка:** unit-тесты на смешанные форматы, на отставание часов клиента на 2 минуты (оптимистичное остаётся внизу и не «прыгает» при подтверждении), на seq.

### P2-2. Сдвиги ленты от превью ссылок и поздних блоков

**Где:** `components/chat/ChatLinkPreview.jsx` (`preview === undefined → return null`, «no skeleton — no layout shift» — неверно), `components/chat/ChatThread.jsx` (content ResizeObserver докручивает только когда лента прижата к низу), `pages/chat/useChatAnchorController.js`.

**Стенд:** после открытия высота контента 3620 → 3911 px через ~0,7 с (превью ссылок), лента дёргается при повторной докрутке вниз. При чтении истории такой рост выше видимой области сдвигает текст, потому что `overflow-anchor: none`.

**Сделать:**
1. Пока превью грузится, резервировать место: компактная карточка фиксированной высоты (домен + заглушка) той же высоты, что итоговая. При ошибке оставить компактную карточку «домен», не схлопывать.
2. Общая компенсация роста контента над якорем, когда лента не прижата: в content ResizeObserver запоминать первый видимый `data-chat-message-id` и его offset, после роста корректировать `scrollTop`. Логику брать из `capturePrependScrollRestoreState`/`computePrependScrollRestoreTop`.
3. Мёртвый код виртуального режима (`CHAT_THREAD_VIRTUAL_CONTENT_SELECTOR`) не трогать в этом этапе.

**Приёмка:** стенд — при открытии ≤1 записи `scrollTop` и отсутствие роста контента более чем на 8 px после 300 мс. При чтении истории offset якорного сообщения меняется ≤2 px.

### P2-3. Статус своих сообщений в группах

**Где:** `components/chat/ChatBubble.jsx` (~671: индикатор только при `isOwnDirect`).

**Сделать:** для своих сообщений в группах показывать спиннер (отправляется), ✓ (доставлено), ✓✓ (`read_by_count > 0`). Клик по ✓✓ открывает существующий список прочитавших (`onOpenReads`). Ошибку отправки показывать иконкой ⚠ (см. вопрос 2).

### P2-4. Нижняя навигация в открытой беседе на телефоне

**Где:** `pages/chat/useChatMobileThreadAnimation.js` (скрытие только по окончании анимации `center`), `pages/chat/useChatMobileBottomNavEffects.js` (без анимации скрывает только при `mobileMotionDisabled`).

**Сделать:** при `resolvedMobileView === 'thread'` скрывать навигацию и при открытии без анимации (deep link, уведомление, «назад»). Анимацию при обычном переходе сохранить.

**Приёмка:** тест хука; скриншот 390×844 при открытии `/chat?conversation=…`. Проверить на реальном телефоне.

### P2-5. Детектирование мёртвого соединения

**Где:** `lib/chatSocket.js` (`startHeartbeat`, `HEARTBEAT_MS`, `maxMissedPongs`).

**Сделать:** на `online` и на `visibilitychange → visible` отправлять внеочередной ping с таймаутом 5 с; без ответа — переподключение. Считать соединение мёртвым после 2 пропусков. При принудительном закрытии по heartbeat вызывать `rejectPendingRequests`.

### P2-6. Красный тест композера

`src/components/chat/ChatThread.test.jsx:393` ждёт `minHeight: 44px`. По `git log -p` определить, что изменилось последним: компонент или ожидание. Дизайн-система требует touch-target ≥44 px на мобильных. Для компактного desktop допустимо меньше, если это осознанное решение. Привести код и тест к одному решению, не удалять проверку.

### P3 (не в этом этапе, отдельные задачи)

- Удалить отладочные `#region agent log` / `emitAgentDebugLog` из горячих путей: `chatSocket.js`, `useChatSocketEvents.js`, `useChatScrollController.js`, `ChatThread.jsx`, `useChatThreadMessageMerge.js`. Аргументы строятся даже при выключенном логировании (`Array.from(activeConversationIds)` и т. п.).
- Ограничение DOM: на стенде ~28 DOM-узлов на сообщение. При возврате вниз обрезать ленту до последних ~200 сообщений; виртуализацию рассматривать отдельно.
- Единый владелец прокрутки: сейчас `scrollTop` пишут pinned-scroll в `ChatThread`, autoScroll страницы, anchor guard, keyboard settle (150/320 мс), prepend restore. Консолидировать только после P0–P2, с метриками стенда до и после.

## 4. Пакеты работ для исполнителей

Пакеты одной фазы не пересекаются по файлам и выполняются параллельно. Тесты — рядом с кодом в тех же пакетах.

| Фаза | Пакет | Находки | Файлы (владение) |
|---|---|---|---|
| 1 | A. Backend WS | P1-1 (backend) | `backend/chat/realtime.py`, `backend/api/v1/chat/ws.py`, `tests/test_chat_websocket_rate_limiter.py` |
| 1 | B. Клиент сокета и отправка | P1-1 (клиент), P1-2, P2-5, P2-7 (логика) | `src/lib/chatSocket.js`, `src/lib/chatSocket.test.js`, `src/components/chat/useChatComposerSending.js` (+ тест) |
| 1 | C. Модель сообщений | P0-2, P2-1, P2-7 (сохранение failed в reconcile) | `src/pages/chat/chatThreadMessages.js`, `src/pages/chat/chatThreadMessageMerge.js`, их тесты |
| 2 | D. Загрузка и события | P0-1 (логика), P1-3 (логика), P1-5, P1-6 | `src/pages/chat/useChatThreadController.js`, `useChatActiveConversationThreadBootstrap.js`, `chatPageConstants.js`, `src/components/chat/useChatSocketEvents.js`, `useChatActiveThreadPolling.js`, `useReadReceipts.js`, их тесты |
| 3 | E. UI и дизайн | P0-1 (блок ошибки), P1-3 (бейдж), P1-4, P2-2, P2-3, P2-4, P2-6, P2-7 (⚠ и меню) | `src/components/chat/ChatMessageList.jsx`, `ChatThread.jsx`, `ChatThreadHeader.jsx`, `ChatBubble.jsx`, `ChatLinkPreview.jsx`, `src/pages/chat/useChatMobileThreadAnimation.js`, `useChatMobileBottomNavEffects.js`, `useChatAnchorController.js`, тесты |

Контракты между фазами:
- D отдаёт в E: `threadLoadError` + `retryThreadLoad()` и `activeThreadPendingNewCount` через существующий проброс props `useChatThreadSection.jsx`. Правка `useChatThreadSection.jsx` / `ChatPageContent.jsx` для проброса разрешена пакету D.
- B отдаёт в D: `chatSocket.reconnectNow()`. D не меняет `chatSocket.js`.
- Новые зависимости, Redis, брокеры и сервисы не добавлять. Схема БД и миграции не нужны.

## 5. Общие правила для исполнителя

- Минимальный diff, стиль соседнего кода, слои `router → service → store`; не раздувать `client.js`.
- Не ломать silent refresh, WS reconnect, auth flow, dark theme и мобильную вёрстку.
- `vite build` без `--outDir` во временную папку **не запускать**: `dist` обслуживает IIS.
- Backend-тесты запускать только в изолированном окружении без production `.env` и сетевых БД (см. раздел 6).
- Не коммитить без просьбы. Deployment и рестарты вне объёма.

## 6. Проверки для приёмки

1. Узкие vitest-наборы пакета, затем весь набор чата (из `WEB-itinvent/frontend`):
   `npx vitest run src/lib/chatSocket.test.js src/lib/chat src/pages/chat src/components/chat src/pages/Chat.test.jsx src/pages/Chat.performance.test.jsx` — ожидается **0 падений** (сейчас 1).
2. Backend (пакет A): `pytest -q tests/test_chat_websocket_rate_limiter.py tests/test_chat_async_api.py`. Перед запуском убедиться, что fixtures не подключают production БД; при сомнении — изолированный launcher без dotenv, как в `CHAT_WEB_BACKEND_REMAINING_BUGS_2026-09-06.md`.
3. ESLint изменённых файлов, `git diff --check`.
4. Изолированная сборка: `vite build --outDir %TEMP%\…`; хеши `dist/index.html`, `dist/sw.js` до и после совпадают.
5. Проверяющий повторно прогоняет Playwright-стенд (моки API + WebSocket, desktop/mobile, light/dark). Целевые метрики:
   - 503 → лента загружается сама;
   - `message.updated` (реакции/опрос) виден в DOM;
   - индикатор «Соединение…» появляется при обрыве дольше 2 с;
   - при открытии беседы рост контента после 300 мс ≤8 px;
   - якорь при догрузке и при превью смещается ≤2 px;
   - входящее при чтении истории → бейдж «вниз» = 1, `mark_read` не отправлен.
6. Не проверяется локально (нужна ручная приёмка после деплоя): реальный телефон (навигация, клавиатура), Desktop/WebView2, сон и пробуждение ПК, несколько вкладок одного пользователя под нагрузкой, реальная конкурентность PostgreSQL.

## 7. Решения пользователя (2026-09-30)

1. **Прочтение (P1-3):** отмечать прочитанным только реально увиденное — **принято**, P1-3 выполняется как описано.
2. **Неотправленное сообщение — принято: пузырь с ⚠ и «Повторить».** Новая находка **P2-7**:
   - Сейчас в `useChatComposerSending.js` при ошибке оптимистичный пузырь удаляется (`removeThreadMessage`), а текст возвращается в поле ввода.
   - Нужно: оставлять пузырь со статусом `optimisticStatus: 'failed'` и ⚠. По клику меню «Повторить» / «Удалить».
   - «Повторить» отправляет с **тем же** `client_message_id` (сервер идемпотентен) и сохраняет `reply_to_message_id`.
   - Неотправленные тексты хранить в памяти страницы по беседе. Сохранять их между перезагрузками не нужно.
   - При смене беседы и возврате пузырь остаётся на месте.
   - Логика отправки и повтора — пакет B. Отрисовка ⚠ и меню — пакет E (`ChatBubble.jsx`). `reconcileThreadMessages` (пакет C) не должен выбрасывать failed-пузыри при обновлении ленты.
   - Приёмка: ошибка → пузырь с ⚠; «Повторить» → ровно одно сообщение на сервере; «Удалить» → пузырь исчез.
3. **Нижняя навигация (P2-4):** прятать всегда в открытой беседе — **принято**.
4. **TypeScript:** решение отложено, пользователь запросил пояснение (раздел 8). В текущий объём не входит.

## 8. TypeScript: переносить ли чат

**Рекомендация: не переносить чат целиком сейчас.** Около 46 тыс. строк JS и 869 тестов; перенос займёт недели и остановит исправления. Найденные ошибки — логические и протокольные (слияние, повторы, прочтение, переподключение), типы их почти не ловят. P0-2 поймали бы только при строгом типе payload и сверке полей, а это решается тестом.

Разумный поэтапный вариант, если нужен:
1. После P0–P2 добавить `typescript` как dev-зависимость (это новая зависимость — нужно согласие) и `tsconfig` с `allowJs`/`checkJs: false`.
2. Типизировать только протокол: `ChatMessage`, `ChatConversationSummary`, WS-события/команды в новом `src/lib/chat/protocol.ts` (по `backend/chat/schemas.py`); `chatSocket.js` и `chatThreadMessages.js` перевести первыми.
3. `tsc --noEmit` в проверку; новые модули чата писать на TS, старые переводить только при существенной правке.

`mobile-hub` уже на TypeScript. Общие типы протокола в будущем можно сверять между клиентами.

## 9. Журнал выполнения

### Фаза 1 — 2026-09-30, исполнитель

#### Пакет A. Backend WS rate-limit (P1-1, backend)

- **Статус:** выполнено.
- **Пункты плана:**
  - P1-1 (backend): `ChatWsCommandRateLimiter` получил `last_violation_at`; `allow()` обнуляет `violations`, если с последнего нарушения прошло ≥60 с (`CHAT_WS_RATE_LIMIT_VIOLATION_RESET_SEC`, env-переопределяемо, минимум 1 с). Паттерн тот же, что в `backend/task_canvas/realtime.py` (сброс по `time.monotonic()`), но по факту окна без нарушений, а не по успешному запросу.
  - Ответ `rate_limited` теперь несёт `request_id` исходной команды (извлекается отдельным `json.loads` в ветке rate-limit; при битом payload — `None`).
  - Закрытие по превышению лимита: код `4429`, reason `chat websocket rate limit exceeded retry_after_ms=<ms>`; `close_code`/`close_reason` пробрасываются в `disconnect`, как раньше. `1008` оставлен для политики/авторизации.
- **Изменённые файлы:** `WEB-itinvent/backend/chat/realtime.py`, `WEB-itinvent/backend/api/v1/chat/ws.py`, `tests/test_chat_websocket_rate_limiter.py`.
- **Новые/изменённые тесты:** `tests/test_chat_websocket_rate_limiter.py` → `test_chat_ws_rate_limiter_resets_violations_after_quiet_window` (сброс после 60 с и новый отсчёт), `test_rate_limited_command_echoes_request_id_and_closes_with_4429` (AST-exec endpoint'а без импорта приложения: request_id в `chat.error`, `None` для битого payload, close 4429, `disconnect(close_code=4429)`).
- **Проверки:** `pytest -q tests/test_chat_websocket_rate_limiter.py` → **6 passed**. Изоляция: `tests/conftest.py` подменяет `APP_DATABASE_URL` на sqlite в `.pytest_runtime/` до импортов backend; endpoint-тест не импортирует приложение вообще.
- **Не проверено:** `tests/test_chat_async_api.py` (упомянут в разделе 6, в явном списке проверок пользователя отсутствует) — не запускался.
- **Отклонения от плана и решения исполнителя:** окно сброса параметризовано env `CHAT_WS_RATE_LIMIT_VIOLATION_RESET_SEC` (default 60) по стилю соседних констант; константу кода 4429 в `realtime.py` не вводил — в `ws.py` используются литералы кодов, как у соседних 4401/1011.
- **Открытые вопросы к проверяющему:** лимитер по-прежнему общий на все вкладки пользователя (как и требовал план — только «остывание» violations); вопрос разнесения по вкладкам в фазу 1 не входил.

#### Пакет B. Клиент сокета и отправка (P1-1 клиент, P1-2, P2-5, P2-7 логика)

- **Статус:** выполнено.
- **Пункты плана:**
  - P1-1 (клиент): `onclose` при коде `4429` планирует `scheduleReconnect(minDelayMs = retry_after)` — `retry_after_ms` читается из close reason, fallback — значение из последнего `chat.error rate_limited` (`rateLimitRetryAfterMs`, сбрасывается на `onopen`). `authBlocked` не ставится (4429 не в `NON_RECONNECTABLE_CLOSE_CODES`).
  - `chat.error`/`error` с `code` → `reject` именно той команды, чей `request_id` пришёл; ошибка несёт `chatErrorCode`, `requestId`, `retryAfterMs`.
  - P1-2: новый `chatSocket.reconnectNow()` — снимает обработчики со старого сокета, чистит heartbeat, отклоняет pending, ставит `disconnected` и сразу `connect()` (очередь не трогает). В `useChatComposerSending` ручной `close()` заменён на `reconnectNow()`; транспортная ошибка/timeout → HTTP fallback с тем же `client_message_id` + `reconnectNow()`; `chat.error` с кодом (`socketError.chatErrorCode`) → `throw` → `notifyApiError`, без fallback и без закрытия.
  - Таймаут `send_message` — **7 с** (`SEND_MESSAGE_TIMEOUT_MS`, параметр `timeoutMs` в `sendCommand`), остальные команды — 15 с.
  - P2-5: `maxMissedPongs` 3→2; внеочередной ping (`chat.ping`, timeout 5 с) на `window 'online'` и `document 'visibilitychange'` при `visible`; слушатели вешаются один раз в `connect()` (`ensureConnectivityWatchers`). Принудительное закрытие вынесено в `forceSocketReconnect()` — вызывает `rejectPendingRequests`, ставит `disconnected`, `scheduleReconnect()`.
  - P2-7 (логика): при окончательной ошибке текст не возвращается в черновик — пузырь остаётся с `optimisticStatus: 'failed'`; хранение — `failedMessagesRef` (Map: conversation_id → Map message_id → {clientMessageId, body, bodyFormat, replyToMessageId, message}), в памяти страницы, переживает смену беседы. Экспортированы `retryFailedMessage(messageId)` (повтор с тем же `client_message_id` и `reply_to_message_id`, при успехе запись удаляется) и `discardFailedMessage(messageId)`.
  - `flushQueue()` схлопывает `chat.mark_read` до последнего на беседу; отброшенные маркеры резолвятся `{collapsed: true, message_id: <выжившая позиция>}`, чтобы `useChatMarkReadLive` не делал HTTP-fallback со старой позицией.
- **Изменённые файлы:** `WEB-itinvent/frontend/src/lib/chatSocket.js`, `src/lib/chatSocket.test.js`, `src/components/chat/useChatComposerSending.js`, `src/components/chat/useChatComposerSending.test.jsx`.
- **Новые/изменённые тесты:**
  - `chatSocket.test.js` → 6 новых: reconnect по 4429 с полом `retry_after` (1500 мс, без authBlocked); reject только целевой команды на `rate_limited` с `chatErrorCode`/`retryAfterMs`; `reconnectNow` (новый сокет сразу, pending отклонены); схлопывание `mark_read` на flush; внеочередной ping на `online`/`visibilitychange`; форс-реконнект при таймауте пробы 5 с; форс-реконнект после 2 пропущенных pong.
  - `useChatComposerSending.test.jsx` → обновлён тест fallback (ожидается `reconnectNow`, а не `close`); новые: серверный `chat.error` без fallback/реконнекта и с пузырём `optimisticStatus:'failed'`; `retryFailedMessage` шлёт тот же `client_message_id` и подменяет пузырь; `discardFailedMessage` удаляет пузырь.
- **Проверки:** `npx vitest run src/lib/chatSocket.test.js src/components/chat/useChatComposerSending.test.jsx` → **43 passed** (36 + 7).
- **Не проверено:** реальное поведение `online`/`visibilitychange` в браузере — проверено только на jsdom-слушателях.
- **Отклонения от плана и решения исполнителя:**
  - `send_message` таймаут выбран **7000 мс** (середина диапазона 6–8 с).
  - `retry_after` для 4429 передаётся в close reason (`retry_after_ms=<ms>`) + запоминается из `chat.error`; отдельного события не вводил — reason и так есть в протоколе.
  - `setSocketStatus` убран из параметров хука (статус теперь ставит `reconnectNow` через `setStatus`); пропс со стороны родителя безвреден.
  - Отброшенные `mark_read` резолвятся, а не отклоняются — иначе `useChatMarkReadLive` сделал бы HTTP-fallback со старой позицией прочтения.
- **Открытые вопросы к проверяющему:** `useChatPageComposerStack.js` (вне файлов пакета B) пока возвращает только `{handleComposerSend, sendMessage}` — для пакета E при показе ⚠/меню нужно прокинуть `retryFailedMessage`/`discardFailedMessage` выше. Файл не трогал по требованию «файлы вне пакета не менять».

#### Пакет C. Модель сообщений (P0-2, P2-1, P2-7 в reconcile)

- **Статус:** выполнено.
- **Пункты плана:**
  - P0-2: `buildThreadMessageSignature` теперь включает `is_deleted`, `deleted_at`, `conversation_seq`, `poll` (question/options/anonymous/closed/total_voters/my_option_index), `reactions` (emoji/count/user_ids — `user_ids` сортируются, порядок реакций сохраняется), `action_card` и `forward_preview` (стабильный stringify с сортировкой ключей — поля не фиксированы), у вложений `kind`, `width`, `height`, `duration_seconds`, `variant_urls`. Неизменённые сообщения сохраняют ссылочное равенство (проверено тестом).
  - P2-1: `compareThreadMessagePosition` — при `conversation_seq > 0` у обоих сравнение по seq; оптимистичные (`isOptimistic` или id `optimistic:*`, без seq) всегда после сохранённых; иначе `Date.parse(created_at)` (невалидная дата — в конец), затем `id`. `sortThreadMessages` использует его же; `shouldPreserve*` в reconcile и так делили функцию — согласованность сохранена.
  - P2-7 (reconcile): `reconcileThreadMessages` сохраняет пузыри `optimisticStatus:'failed'` при любом обновлении (включая `replaceWindowButPreserveFreshLocal`); карта `currentOptimisticByClientId` теперь покрывает и failed, поэтому серверный echo по `client_message_id` корректно заменяет failed-пузырь (с наследованием `renderKey`). `upsertThreadMessagesInList` матчит optimistic-строку по `client_message_id` — это и есть дедуп echo для failed, которых `isLikelyOptimisticReplacement` (только `sending`) не ловит.
- **Изменённые файлы:** `src/pages/chat/chatThreadMessages.js`, `src/pages/chat/chatThreadMessages.test.js`, `src/pages/chat/chatThreadMessageMerge.js`, `src/pages/chat/chatThreadMessageMerge.test.js`.
- **Новые/изменённые тесты:**
  - `chatThreadMessages.test.js` → новые: `isFailedOptimisticThreadMessage`; изменение signature по poll/reactions/action_card/forward_preview/is_deleted/deleted_at/conversation_seq/width/height/duration_seconds/variant_urls при том же id; эквивалентность при перестановке `user_ids` и ключей `action_card`; сортировка seq → дата → id, optimistic после сохранённых; failed-пузырь при refresh, замена его серверным echo, сохранение в режиме `replaceWindowButPreserveFreshLocal`.
  - `chatThreadMessageMerge.test.js` → новый: upsert заменяет failed-пузырь по `client_message_id` (echo), сохраняя `renderKey`.
- **Проверки:** `npx vitest run src/pages/chat/chatThreadMessages.test.js src/pages/chat/chatThreadMessageMerge.test.js` → **31 passed** (23 + 8).
- **Не проверено:** `useChatThreadMessageMerge.js` (хук-обёртка) не менялся — не входит в пакет C; его поведение покрывается обновлёнными чистыми функциями.
- **Отклонения от плана и решения исполнителя:** для `action_card`/`forward_preview`/`variant_urls` использован общий `stableSignatureStringify` (сортировка ключей рекурсивно) — их схема не фиксирована, а ручная нормализация всех вложенных полей дала бы хрупкий diff. `normalizeThreadMessageClientId` экспортирован для переиспользования в merge-модуле.
- **Открытые вопросы к проверяющему:** `reactions`-массив в signature не сортируется — порядок реакций влияет на рендер (ReactionsBar); если сервер отдаёт реакции в нестабильном порядке, это даст лишний re-render, а не баг.

#### Замечания к плану / новые находки

1. `useChatComposerSending.js` (см. diff): в отличие от описания в разделе 7 («при ошибке текст возвращается в поле ввода»), текст также писался в `localStorage`-черновик, если поле занято — обе ветки возврата текста убраны по P2-7; черновик просто очищается при отправке, как раньше.
2. `src/pages/chat/useChatPageComposerStack.js:48` — после пакета B `retryFailedMessage`/`discardFailedMessage` есть в возврате хука, но не проброшены наверх: файл вне пакета B, правка отложена на пакет E.
3. `src/lib/chatSocket.js` `sendCommand` — heartbeat-ping тоже переведён на таймаут 5 с (вместо 15 с), чтобы зависшая команда ping не жила дольше цикла пропуска.

#### Итог фазы 1

- Узкие тесты: backend `pytest -q tests/test_chat_websocket_rate_limiter.py` → **6/6 passed**; frontend узкие наборы → **74/74** (chatSocket 36, useChatComposerSending 7, chatThreadMessages 23, chatThreadMessageMerge 8).
- Полный набор чата (`npx vitest run src/lib/chatSocket.test.js src/lib/chat src/pages/chat src/components/chat src/pages/Chat.test.jsx src/pages/Chat.performance.test.jsx`) → **888 passed / 889**, 1 падение — известное `ChatThread.test.jsx` `minHeight 44px` (пакет E, было до изменений; baseline 868/869 → теперь 888/889, новых падений нет).
- ESLint изменённых файлов: `useChatComposerSending.js`, `chatThreadMessages.js`, `chatThreadMessageMerge.js` — чисто; в `chatSocket.js` и тестах только те же `no-undef` (`window`/`WebSocket`/`document` — flat-конфиг не даёт browser-globals на `src/lib`, та же картина на исходной версии файла: 41 проблем до → 50 после, дельта — новые строки с теми же globals) и предупреждения baseline-класса (`React`/`Harness` unused, `no-empty` catch как у соседнего кода).
- `git diff --check` — для изменённых файлов чисто (единственное замечание — чужое trailing whitespace в `documentation/technical/POSTGRES_APP_SCHEMA_DDL.md:3`, не трогал).

### Фаза 2 — 2026-09-30, исполнитель

#### Пакет D. Загрузка и события (P0-1 логика, P1-3 логика, P1-5, P1-6)

- **Статус:** выполнено.
- **Пункты плана:**
  - P0-1: в `useChatThreadController` добавлен `threadLoadError` (отдельно от `messagesLoading`) и `scheduleThreadLoadRetry` — автоповтор временных ошибок (`isTransientLoadMessagesError`: 0/502/503/504 + read-concurrency с `retry-after`) по расписанию 1/2/5/10/30 с с джиттером ±20% (`CHAT_THREAD_LOAD_RETRY_DELAYS_MS`, `CHAT_THREAD_LOAD_RETRY_JITTER`). Таймер очищается при смене беседы, новом bootstrap и `clearThreadLoadRetry`. После исчерпания попыток или неповторяемой ошибки ставится `threadLoadError`. `retryThreadLoad` — сброс ошибки + `loadThreadBootstrap(force: true)`. Пока запланирован повтор, `messagesLoading` не снимается (скелетон вместо ложного empty-state); при `silent`-повторе счётчик seq перехватывается веткой `messagesLoadingRef.current`. В `useChatActiveConversationThreadBootstrap` отмена bootstrap (unmount/StrictMode) сбрасывает `lastHandledThreadLayoutKeyRef`, поэтому повторный mount загружает ленту.
  - P1-3 (логика): `useReadReceipts` возвращает `pendingNewCount` — входящие после `viewerLastReadMessageId`, пока пользователь не внизу/не смотрит их. `useChatSocketEvents.handleMessageCreated` не шлёт `markRead`, если `threadNearBottomRef.current !== true`; значение проброшено как `activeThreadPendingNewCount` через `ChatPageContent` → `pickChatPageLayoutSections`/`buildChatPagePanesBags` → `useChatThreadSection` → `ChatThread` (`pendingNewCount`).
  - P1-5: `CHAT_ACTIVE_THREAD_INCREMENTAL_POLL_MS` 1000→3000; в `useChatActiveThreadPolling` экспоненциальный backoff на любой ошибке (cap 30 с, джиттер ±20%), read-concurrency — по `retry-after`; пауза при `navigator.onLine === false`; немедленный опрос на `online`, с пропуском, если foreground-reconciliation только что запустил загрузку (`lastForegroundRefreshAtRef`, <250 мс) — иначе два слушателя `online` давали двойной запрос. Параллельных запросов нет (guard по in-flight).
  - P1-6: в `handleSocketStatus` троттлинг по `lastConversationsLoadAt`/`conversationsLoading` применён только к `loadConversations`; для активной беседы на каждом переходе в `connected` (кроме первого подключения) вызывается `loadMessages(active, buildActiveThreadPollLoadOptions(...))` — инкрементально после последнего id, дедуп по keyed in-flight.
- **Изменённые файлы:** `pages/chat/useChatThreadController.js`, `pages/chat/useChatActiveConversationThreadBootstrap.js`, `components/chat/useReadReceipts.js`, `components/chat/useChatActiveThreadPolling.js`, `components/chat/useChatSocketEvents.js`, `pages/chat/chatPageConstants.js`, `pages/chat/ChatPageContent.jsx`, `pages/chat/pickChatPageLayoutSections.js`, `pages/chat/buildChatPagePanesBags.js`, `pages/chat/useChatThreadSection.jsx`, `pages/chat/useChatPageComposerStack.js` (проброс `retryFailedMessage`/`discardFailedMessage` — связка B→E).
- **Новые/изменённые тесты:**
  - `useChatThreadController.test.js` → автоповтор 503 с применением payload, `threadLoadError` на 403 без повторов, `retryThreadLoad` перезагружает ленту.
  - `useChatActiveConversationThreadBootstrap.test.js` → сброс `lastHandledThreadLayoutKeyRef` при отмене (StrictMode-remount загружает ленту).
  - `useReadReceipts.test.jsx` → `pendingNewCount` считает входящие после маркера прочтения.
  - `useChatActiveThreadPolling.test.jsx` → backoff на ошибках, пауза offline, немедленный опрос на `online` без дубля от foreground-пути.
  - `useChatSocketEvents.test.jsx` → без `markRead` когда пользователь не внизу; догрузка ленты на `connected` после reconnect.
  - `chatPageSlice37.test.js` → ожидание `CHAT_ACTIVE_THREAD_INCREMENTAL_POLL_MS` обновлено 1000→3000 (соответствует п. P1-5 «стартовый интервал 3 с»).
- **Проверки:** `npx vitest run src/pages/chat/useChatActiveConversationThreadBootstrap.test.js src/components/chat/useReadReceipts.test.jsx src/components/chat/useChatActiveThreadPolling.test.jsx src/pages/chat/useChatThreadController.test.js src/components/chat/useChatSocketEvents.test.jsx` → **5 файлов, 49/49 passed** (повтор после правки `threadLoadRetryScheduled` — тоже 49/49).
- **Не проверено:** реальные интервалы в браузере — покрыто fake timers.
- **Отклонения от плана и решения исполнителя:**
  - Пока запланирован автоповтор, лента держит скелетон (`messagesLoading` не снимается через `threadLoadRetryScheduled`), иначе пользователь видел бы «Здесь пока тихо» до ~48 с. `threadLoadError` при этом по-прежнему `null` до исчерпания попыток — блок ошибки не мигает на транзиентных сбоях.
  - Немедленный опрос на `online` пропускается, если foreground-reconciliation (`focus`/`online` слушатель того же хука) уже запустил загрузку — порог 250 мс по `lastForegroundRefreshAtRef`; это реализация «не дублировать reload» из плана.
  - `scheduleThreadLoadRetry` не срабатывает для уже гидратированной беседы — silent-ревалидация с контентом на экране сохраняет прежнее поведение.
- **Открытые вопросы к проверяющему:** при silent-ошибке bootstrap на пустой ленте (loading=false) во время окна повторов виден empty-state, не скелетон — ошибка появится только после исчерпания попыток; сценарий узкий (лента пуста и не в loading).

#### Замечания к плану / новые находки (фаза 2)

1. `useChatActiveThreadPolling` имел два слушателя `online` (poll-цикл и foreground-эффект) — без дедупликации `online` давал два запроса ленты; исправлено через `lastForegroundRefreshAtRef` (см. выше).
2. `chatPageSlice37.test.js` фиксировал `CHAT_ACTIVE_THREAD_INCREMENTAL_POLL_MS === 1000` — ожидание обновлено до 3000 согласно P1-5; зафиксировано здесь, т.к. план требует журналировать смену ожиданий.

#### Итог фазы 2

- Узкие тесты пакета D → **49/49 passed**.
- Полный набор чата в этой точке не прогонялся отдельно — см. итог фазы 3 (общий прогон после D+E).

### Фаза 3 — 2026-09-30, исполнитель

#### Пакет E. UI-статусы и стабильность ленты (P0-1 UI, P1-3 UI, P1-4, P2-2, P2-3, P2-4, P2-6, P2-7 UI)

- **Статус:** выполнено.
- **Пункты плана:**
  - P0-1 (UI): `ChatMessageList` рендерит `ThreadLoadErrorBlock` (testid `chat-thread-load-error`): «Не удалось загрузить сообщения» + кнопка «Повторить» (`chat-thread-load-retry` → `onRetryThreadLoad`). Блок ошибки имеет приоритет над скелетоном и empty-state.
  - P1-3 (UI): бейдж кнопки «вниз» в `ChatThread` показывает `pendingNewCount ?? unread_count`; при явном `pendingNewCount === 0` бейдж скрыт (`invisible`), даже если `unread_count > 0`.
  - P1-4: `ChatThreadHeader` принимает `socketStatus`; `useChatConnectionLabel` показывает подзаголовок «Соединение…» (любой статус кроме connected/пустого), «Нет сети» (offline-события `navigator.onLine`), «Сессия истекла» (unauthorized/forbidden) — только если состояние держится ≥2 с (`CHAT_CONNECTION_INDICATOR_DELAY_MS`); при восстановлении подпись исчезает сразу. Высота шапки не меняется — подпись подменяет существующий subtitle.
  - P2-2: `ChatLinkPreview` в состояниях loading/failed рендерит компактную карточку `chat-link-preview-compact` фиксированной высоты 64 px (домен + «Загрузка превью…» / без неё), ссылка кликабельна сразу; роста «пусто → карточка» больше нет. В `ChatThread` content ResizeObserver при отпущенной ленте теперь восстанавливает позицию по якорю первого видимого сообщения (`capturePrependScrollRestoreState`/`computePrependScrollRestoreTop`, приоритет `compensation`) — снапшот обновляется в `handleThreadScroll` и после каждой коррекции.
  - P2-3: `ChatBubbleMeta` показывает статус доставки для своих сообщений в группах (`isOwnGroup`): спиннер при отправке, ✓ при `sent`, кликабельная ✓✓ (`chat-message-group-read` → `onOpenReads`) при `read_by_count > 0`. Резерв ширины inline-меты учитывает иконку для групп и failed (`isOwnDirect || isOwnGroup || isSendFailed` в вызове `getChatInlineMetaReserveWidth`).
  - P2-4: `useChatMobileBottomNavEffects` скрывает нижнюю навигацию при `resolvedMobileView === 'thread'` всегда — включая deep link/уведомление/history-навигацию без анимации; анимированный путь сохранён (`useChatMobileThreadAnimation` оставлен, его вызов теперь избыточен, но безвреден). Параметр `mobileMotionDisabled` из хука убран за ненадобностью.
  - P2-6: `composerCapsuleMinHeight` compact-desktop 34→44 px в `buildChatDensityTokens`; spacious 42→48 px (иначе нарушался инвариант `compact < spacious` в `chatUiTokens.test.js`). Красный тест `ChatThread.test.jsx:393` (`minHeight: 44px`) теперь зелёный — выбран вариант «код под дизайн-требование ≥44 px».
  - P2-7 (UI): failed-пузырь остаётся в ленте; в мете — иконка ⚠ (`chat-message-failed-action`, aria-label «Сообщение не отправлено») с меню «Повторить отправку» (`chat-message-failed-retry` → `onRetryFailedMessage(id)`) и «Удалить» (`chat-message-failed-discard` → `onDiscardFailedMessage(id)`). Колбэки проброшены: `useChatComposerSending` → `useChatPageComposerStack` → `ChatPageContent` → layout-секции → `ChatThread` → `ChatMessageList` → `MemoChatBubble`.
- **Изменённые файлы:** `components/chat/ChatMessageList.jsx`, `components/chat/ChatBubble.jsx`, `components/chat/ChatLinkPreview.jsx`, `components/chat/ChatThreadHeader.jsx`, `components/chat/ChatThread.jsx`, `components/chat/chatUiTokens.js`, `pages/chat/useChatMobileBottomNavEffects.js`, `pages/chat/useChatThreadSection.jsx` (снят дубль `socketStatus` в деструктуризации), плюс тестовые файлы ниже.
- **Новые/изменённые тесты:**
  - `ChatMessageList.test.jsx` → блок ошибки + клик «Повторить»; приоритет ошибки над скелетоном.
  - `ChatLinkPreview.test.jsx` → резерв 64 px при загрузке; компактная карточка домена при ошибке запроса.
  - `useChatMobileBottomNavEffects.test.js` (новый) → скрытие на `thread`, восстановление на `inbox`, no-op на desktop.
  - `ChatThread.test.jsx` → describe «chat stability UI (package E)»: бейдж `pendingNewCount`, `pendingNewCount=0` скрывает бейдж, индикатор «Соединение…» только после 2 с, failed-пузырь с retry/discard, статусы ✓/✓✓ в группе.
  - `chatUiTokens.test.js` → ожидание `composerCapsuleMinHeight` 34→44.
  - `ChatComposer.behavior.test.jsx` → ожидание капсулы 34→44 px.
- **Проверки:**
  - Узкие E: `npx vitest run src/components/chat/ChatMessageList.test.jsx src/components/chat/ChatLinkPreview.test.jsx src/components/chat/chatUiTokens.test.js src/components/chat/ChatThread.test.jsx src/pages/chat/useChatMobileBottomNavEffects.test.js src/pages/chat/useChatMobileNavigation.test.js` → **6 файлов, 103/103 passed**.
  - Полный набор чата: `npx vitest run src/lib/chatSocket.test.js src/lib/chat src/pages/chat src/components/chat src/pages/Chat.test.jsx src/pages/Chat.performance.test.jsx` → **135 файлов, 912/912 passed** (предыдущее известное падение `minHeight 44px` исправлено через P2-6).
  - ESLint изменённых файлов фазы 2+3 → **0 errors** (151 warnings — все `no-unused-vars` baseline-класса: flat-конфиг не считает JSX-использование компонентов; те же предупреждения на неизменённых файлах, напр. `ChatThreadHeader.jsx` — 18 warnings и до правок).
  - `git diff --check` — для файлов фаз чисто (единственное замечание по репозиторию — чужое trailing whitespace в `POSTGRES_APP_SCHEMA_DDL.md:3`, не трогал).
- **Не проверено:** якорная компенсация роста контента (P2-2 п.2) покрыта косвенно — jsdom не даёт реальной геометрии; модель `chatThreadScrollModel` уже покрыта своими тестами, интеграция проверена компиляцией и полным прогоном. Скриншоты light/dark и проверка на реальном телефоне из приёмок P1-4/P2-4 не выполнялись — нет браузерного стенда в этой сессии.
- **Отклонения от плана и решения исполнителя:**
  - P2-2 п.1: резерв реализован фиксированной высотой 64 px с мини-строкой «Загрузка превью…»; при ошибке — та же карточка с доменом (не схлопывается). Итоговая карточка превью может быть выше резерва — остаток роста компенсирует якорная коррекция из п.2, как и предложено в плане.
  - P2-6: выбран вариант «поднять токен до 44 px» (критерий плана — тест `ChatThread.test.jsx`); соседние ожидания 34 px в `chatUiTokens.test.js` и `ChatComposer.behavior.test.jsx` обновлены до 44, spacious-кapsule поднят до 48 px ради инварианта `compact < spacious`.
  - P1-4: «Сессия истекла» также проходит через ту же 2-секундную задержку — показ не мгновенный, зато не мигает при кратком unauthorized-flap; auth flow при этом действует независимо от подписи.
  - `useChatMobileThreadAnimation` не удалён: его колбэк `setMobileBottomNavHidden(true)` по окончании анимации теперь дублирует эффект, но сохраняет явную точку синхронизации для анимированного перехода.
- **Открытые вопросы к проверяющему:** обвязка `pendingNewCount` на странице рассчитывается в `useReadReceipts`; если где-то читается старый `unread_count` для кнопки «вниз» вне `ChatThread` — проверить макет отдельно (в найденных путях такого нет).

#### Замечания к плану / новые находки (фаза 3)

1. `useChatThreadSection.jsx` при пробросе получил `socketStatus` дважды (из `thread` и `rightPanel` багов) — esbuild падал с «symbol already declared»; оставлено одно значение из `thread` (источник тот же — `input.socketStatus`).
2. `chatUiTokens.test.js` и `ChatComposer.behavior.test.jsx` фиксировали компактную капсулу 34 px — обновлены до 44 px по P2-6 (см. «Отклонения»).
3. `POSTGRES_APP_SCHEMA_DDL.md:3` — чужое trailing whitespace, флагается `git diff --check`; не трогал (вне пакетов).

#### Итог фаз 2+3

- Узкие тесты: пакет D → **49/49**, пакет E → **103/103**.
- Полный набор чата → **135 файлов, 912/912 passed**; падений нет (в фазе 1 было 888/889 с известным P2-6 — теперь исправлен).
- ESLint изменённых файлов → **0 errors**.
- `git diff --check` — чисто по файлам фаз.

## 10. Проверка фаз 1–3 (проверяющий, 2026-09-30)

**Вердикт:** большая часть плана выполнена и подтверждена. **К выкатке не готово** — замечания R1–R4 блокирующие.

### Что проверено

- Frontend-набор чата: **912/912**, 135 файлов (повторный прогон проверяющим).
- `pytest -q tests/test_chat_websocket_rate_limiter.py` → **6 passed**. Запуск с `CHAT_DATABASE_URL` на sqlite в `.pytest_runtime/` и `CHAT_REALTIME_TRANSPORT=local`.
- Изолированная сборка во временную папку → успешно. Хеши `dist/index.html` и `dist/sw.js` не изменились.
- Playwright-стенд на production-сборке (моки API и WebSocket), desktop light и mobile dark:
  - 503 на bootstrap → автоповтор через ~1,6 с, лента загружается ✅;
  - `message.updated` с реакциями виден в DOM ✅;
  - входящее при чтении истории → бейдж «1», `mark_read` не отправлен ✅;
  - ✓/✓✓ в группах ✅;
  - нижняя навигация скрыта в беседе (mobile) ✅;
  - рост контента после открытия: **+3 px** (было +291) ✅.
- Прочитаны диффы пакетов A–E. Разделы 1–8 плана исполнителем не изменены.

### Блокирующие замечания

**R1. «Соединение…» висит постоянно при подключённом сокете.**
- Стенд: сокет `connected` через 0,34 с, подпись в шапке с 3-й секунды и до конца наблюдения.
- Причина: `pages/chat/useChatSocketController.js:24` — начальное состояние `'connecting'`. Страница чата монтируется после `ChatSocketBootstrap`, событие `chat-ws-status: connected` к этому моменту уже прошло. Текущее `chatSocket.getConnectionState()` при монтировании не читается.
- Ошибка существовала и раньше, но была скрыта. Индикатор P1-4 сделал её видимой всем. Из-за неё же `activeThreadTransportState` постоянно `degraded`.
- Сделать: при монтировании инициализировать и синхронизировать `socketStatus`/`socketStatusRef` из `chatSocket.getConnectionState()`. Проверить `skippedInitialSocketRefreshRef` — первое «connected» не должно теряться или удваиваться.

**R2. `loadMessagesRef` и `loadConversationsRef` нигде не присваиваются.** Старая ошибка, присваивание потеряно в `20f29fec`.
- No-op вызовы через `?.`:
  - `components/chat/useChatActiveThreadPolling.js:77, 196` — foreground-refresh и деградационный опрос;
  - `components/chat/useChatSocketEvents.js:177` — догрузка по `chat.conversation.updated`;
  - `components/chat/useChatSocketEvents.js:522` — после завершения AI-run;
  - `pages/chat/useChatPanelsController.js:157`.
- Стенд: обрыв WS на 6 с → **0 HTTP-запросов ленты**. Логи `threadPoll:degradedRevalidate` при этом пишутся. Юнит-тесты не ловят, потому что сами передают ref.
- Сделать: присваивать `loadMessagesRef.current = loadMessages` и `loadConversationsRef.current = loadConversations` там, где создаются функции (по образцу `markConversationReadLiveRef` в `useChatMarkReadLive.js`). Добавить интеграционный тест, который не подменяет ref.
- **R1 и R2 исправлять в одном изменении.** Если починить только R2, при залипшем `connecting` каждая открытая беседа будет опрашиваться каждые 3 с при здоровом сокете. При 300+ пользователях это ~100 запросов/с.

**R3. P2-7/P1-2: отправки, которые раньше доходили по HTTP, теперь падают в ⚠.**
- `useChatComposerSending.js#deliverOptimisticMessage`: любой `chatErrorCode` → `throw`, без HTTP fallback.
- Backend (`api/v1/chat/ws.py`, ветка `except` вокруг `dispatch_chat_ws_command`) отдаёт `code="command_failed"` на **любое** исключение, в том числе `sqlalchemy.exc.TimeoutError` и `WriteSlotTimeoutError` (в логах production за неделю — 22 и 9 случаев). Ещё есть `rate_limited`.
- **Уточнение плана (ошибка формулировки P1-2):** «серверный chat.error с кодом → без fallback» верно только для явных отказов.
- Сделать:
  - frontend: для `command_failed` и `rate_limited` — HTTP fallback с тем же `client_message_id` (идемпотентно);
  - backend (`ws.py`): для `ValueError` → `code="validation_error"`, `PermissionError`/403 → `code="forbidden"`, прочее — `command_failed`;
  - frontend без fallback только для `validation_error` / `forbidden`.

**R4. P2-7: пузырь ⚠ не переживает смену беседы.** Требование раздела 7 не выполнено.
- `failedMessagesRef` хранит записи, но при возврате в беседу лента загружается заново (`startColdThreadLoad` → `setMessages([])` или кэш), и failed-пузыри обратно не подмешиваются.
- Если ошибка пришла, когда активна другая беседа (таймаут 7 с), `applyOutgoingThreadMessage` отфильтрует пузырь по активной беседе, и он не появится.
- Сделать: после применения payload ленты (`applyLatestThreadPayload` или хук над ним) подмешивать failed-записи текущей беседы, дедуп по `client_message_id` с серверными сообщениями. Тест: отправка A → ошибка → переход в B → возврат в A → пузырь ⚠ на месте. Сюда же: ошибка во время пребывания в B → пузырь есть при возврате в A.

### Неблокирующие замечания

- **R5.** `useReadReceipts#pendingNewCount` возвращает `0`, если маркера прочтения нет в загруженном окне или он пуст. `ChatThread` при `pendingNewCount === 0` скрывает бейдж даже при `unread_count > 0`. Возвращать `null` («нет данных»), чтобы работал fallback на `unread_count`.
- **R6.** Сдвиг якоря при догрузке истории на desktop — 10 px (было 6, цель ≤2). Проверить взаимодействие новой компенсации в content ResizeObserver с `schedulePrependScrollRestore`.
- **R7.** `chatSocket.flushQueue`: схлопывание `mark_read` фактически не срабатывает (`markRead` с `requireOpen` не попадает в очередь). Перевзвод таймаутов pending игнорирует сохранённый `timeoutMs`. Не критично.
- **R8.** Исполнитель не делал runtime и скриншотов. Для R1–R4 обязательна проверка стендом проверяющего.

## 11. Фаза 4 — исправление замечаний проверки (исполнитель, 2026-09-30)

Замечания R1–R7 из раздела 10 реализованы и покрыты тестами. Финальные статусы (закрытие/повторная проверка стендом) — за проверяющим, см. R8.

### R1. Статус сокета при монтировании — выполнено

- `useChatSocketController` инициализирует `socketStatus`/`socketStatusRef` из `chatSocket.getConnectionState()` вместо константы `'connecting'`; при `'connected'` сразу засекается `lastSocketActivityAt` — транспорт стартует `healthy`, деградационный опрос не включается.
- `useChatSocketEvents` на маунте повторяет живое состояние сокета (replay): статус ≠ `'connecting'` помечает `skippedInitialSocketRefreshRef` (следующий `'connected'` — реальный реконнект с обновлением данных), `'connected'` дополнительно пишет активность. Replay одноразовый (`initialSocketStatusReplayedRef`): эффект перезапускается при смене dep-идентичностей, и без гарда повторный replay затирал бы реальный переход устаревшим `getConnectionState()`.
- Файлы: `pages/chat/useChatSocketController.js`, `components/chat/useChatSocketEvents.js`.
- Тесты: `pages/chat/useChatSocketInitPolling.test.jsx` (интеграционный, без подмены ref: сокет жив до маунта → `connected`/`healthy`, опроса нет; `disconnected→connected` после маунта → refresh и инкрементальная догрузка не теряются); `useChatSocketController.connected.test.js` (инициализация из `getConnectionState`, `healthy`).

### R2. Общие loader-ref'ы — выполнено

- `loadMessagesRef`/`loadConversationsRef` созданы в `useChatPageRefs`; присваивание в owning-контроллерах по образцу `markConversationReadLiveRef`: `useChatThreadController` (`loadMessagesRef.current = loadMessages`), `useChatConversationsController` (`loadConversationsRef.current = loadConversations`).
- Все точки из раздела 10 используют ref: `useChatActiveThreadPolling.js` (foreground-refresh, деградационный опрос), `useChatSocketEvents.js` (догрузка по `conversation.updated`, после AI-run), `useChatPanelsController.js` (refresh панелей).
- R1 и R2 сделаны одним изменением: без R1 залипший `connecting` гнал бы опрос каждые ~3 с при живом сокете.
- Файлы: `pages/chat/useChatThreadController.js`, `pages/chat/useChatConversationsController.js`, `pages/chat/useChatPageRefs.js`.
- Тесты: `useChatSocketInitPolling.test.jsx` (деградационный опрос делает реальный вызов через controller-assigned `loadMessagesRef` → `chatAPI.getThreadBootstrap`); `useChatThreadController.test.js`, `useChatConversationsController.test.js` (ref указывает на реальный колбэк и рабочий).

### R3. Маппинг ошибок и HTTP-fallback — выполнено

- Backend `ws.py`, `except` вокруг `dispatch_chat_ws_command`: `PermissionError`/HTTP 401–403 → `forbidden`; `ValueError`/прочие HTTP <500 → `validation_error`; остальное → `command_failed`. `chat.error` несёт стабильный `code` + `request_id`.
- Frontend `useChatComposerSending.deliverOptimisticMessage`: `validation_error`/`forbidden` — финальная ошибка без fallback; `command_failed`, `rate_limited` и транспортные ошибки — HTTP fallback с тем же `client_message_id` (идемпотентно на сервере). `reconnectNow` — только при ошибке без кода (мёртвый транспорт).
- Файлы: `backend/api/v1/chat/ws.py`, `components/chat/useChatComposerSending.js`.
- Тесты: `tests/test_chat_websocket_error_codes.py` (ValueError→validation_error, PermissionError→forbidden, HTTP 403→forbidden, RuntimeError/HTTP 503→command_failed, смешанная сессия с echo request_id); `useChatComposerSending.test.jsx` (каждый код, сохранение `client_message_id` в fallback).
- Замечания к плану / новые находки: формулировка раздела 10 — «прочее → command_failed». Реализация чуть шире: HTTPException <500 (кроме 401/403) → `validation_error`, а не `command_failed`. Семантически это тот же класс явного отказа (клиентская 4xx), и повтор по HTTP вернул бы тот же ответ — fallback пропускается корректно. Сужение до буквального текста плана не делал, чтобы не гонять заведомо бесполезный HTTP-retry.

### R4. Failed-пузыри переживают смену беседы — выполнено

- `failedThreadMessagesRef` (Map по conversationId) создан на уровне страницы в `useChatPageRefs`, проброшен через `useChatPageCoreBridge`/`useChatPageComposerStack` в `useChatComposerSending` и `useChatThreadController`; запись — {conversationId, clientMessageId, body, bodyFormat, replyToMessageId, message}.
- `applyLatestThreadPayload` после применения payload подмешивает failed-записи текущей беседы (`preserveSendingOptimistic`), дедуп по `client_message_id` с серверными сообщениями: эхо с тем же `client_message_id` снимает запись. Ошибка по A при активной B не попадает в ленту B (фильтр `upsertThreadMessages` по активной беседе) и восстанавливается при возврате в A.
- Файлы: `pages/chat/useChatPageRefs.js`, `useChatPageCoreBridge.js`, `useChatPageComposerStack.js`, `ChatPageContent.jsx`, `useChatThreadController.js`, `components/chat/useChatComposerSending.js`.
- Тесты: `useChatThreadController.test.js` — A → ошибка → B → A (пузырь ⚠ на месте), ошибка по A при активной B → пузырь в A при возврате, серверное эхо по `client_message_id` → запись снята; `useChatComposerSending.test.jsx` — запись в shared ref.

### R5. pendingNewCount при отсутствии маркера — выполнено

- `useReadReceipts` возвращает `null`, если read-маркер отсутствует в загруженном окне или пуст (`markerIndex` не конечен); `ChatThread` использует `pendingNewCount ?? activeConversation?.unread_count` — бейдж не скрывается ложным `0`.
- Файлы: `components/chat/useReadReceipts.js`, `components/chat/ChatThread.jsx`.
- Тесты: `useReadReceipts.test.jsx` (null-путь: маркер пуст и вне окна; валидный маркер → счётчик как раньше).

### R6. Сдвиг якоря при догрузке истории — выполнено

- Причина ~10 px: пока `prependScrollRestoreRef` pending, content `ResizeObserver` компенсацию откладывает, но `contentAnchorSnapshotRef`/`threadContentHeightRef` остаются домерянными до prepend — после restore применялась устаревшая компенсация поверх восстановления.
- В `onSettled` ветке `schedulePrependScrollRestore` обновляются `contentAnchorSnapshotRef` (переснятый якорный снапшот) и `threadContentHeightRef` — следующий RO-проход стартует с актуального baseline.
- Файл: `components/chat/ChatThread.jsx`.
- Тест: `ChatThread.test.jsx` — «R6: resyncs the content-resize baseline when a prepend restore settles»: рост контента в pending-окне откладывается, после settle снапшот пересинхронизирован и поздний RO-проход не сдвигает `scrollTop`.

### R7. Таймауты в flushQueue — выполнено (тривиальная правка)

- `flushQueue` перевзводит pending-запросы с сохранённым `timeoutMs` каждой записи вместо общего `REQUEST_TIMEOUT_MS`; схлопывание `mark_read` по беседе на flush оставляет последний маркер и резолвит вытесненные request_id.
- Файл: `lib/chatSocket.js`.
- Тест: `chatSocket.test.js` — «R7: re-arms a queued request timeout with its original timeoutMs».

### Прогоны

- Узкие frontend (R1–R6 файлы): `useChatSocketInitPolling` 3, `useChatSocketController.connected` 1, `useChatThreadController` 12, `useChatConversationsController` 4, `useChatComposerSending` 11, `useReadReceipts` 20 → **51/51**; `ChatThread` + `useChatSocketEvents` + `useChatActiveThreadPolling` + `chatSocket` → **138/138**.
- Полный набор чата: `npx vitest run src/lib/chatSocket.test.js src/lib/chat src/pages/chat src/components/chat src/pages/Chat.test.jsx src/pages/Chat.performance.test.jsx` → **137 файлов / 930 тестов, 0 падений** (baseline был 135/912).
- Backend: `pytest -q tests/test_chat_websocket_rate_limiter.py tests/test_chat_websocket_error_codes.py` (`CHAT_DATABASE_URL` → sqlite в `.pytest_runtime/`, `CHAT_REALTIME_TRANSPORT=local`) → **11 passed**.
- ESLint изменённых файлов фазы 4 → **0 errors** (48 warnings — baseline-класс `no-unused-vars`, включая JSX-идентификаторы; тот же класс есть в неизменённых файлах).
- `git diff --check` по файлам фазы 4 → чисто.

### Отклонения и открытые вопросы

- Расширенный маппинг HTTPException в `ws.py` — см. «Замечания к плану» в R3.
- R8 (Playwright-стенд на production-сборке, скриншоты) — за проверяющим: исполнительская проверка ограничена JSDOM/Vitest/pytest, реальный socket+БД стенда не поднимались.

## 12. Проверка фазы 4 (проверяющий, 2026-09-30)

**Вердикт:** R1–R3 подтверждены в браузере. **R4 в реальной сборке не работает — к выкатке не готово.**

### Что проверено

- Frontend-набор чата: **930/930**, 137 файлов (повторный прогон проверяющим).
- Изолированная сборка → успешно. Хеши `dist/index.html` и `dist/sw.js` не изменились.
- Playwright-стенд на production-сборке, моки API и WebSocket:
  - **R1 ✅** — сокет подключён до монтирования страницы, подпись «Соединение…» не появляется. При реальном обрыве появляется;
  - **R2 ✅** — обрыв WS на 6 с → 6 инкрементальных запросов ленты (было 0);
  - **R3 ✅** — `chat.error command_failed` → HTTP fallback с тем же `client_message_id`; `validation_error` → HTTP-запроса нет;
  - 503 на bootstrap → лента загружается сама ✅;
  - **R4 ❌** — см. ниже.

### Блокирующее

**R9 (продолжение R4). Неотправленное сообщение не помечается ⚠.**
- Стенд: WS отвечает `chat.error`, HTTP — 500. Через 30 с иконки `chat-message-failed-action` нет, пузырь показывает спиннер «отправляется». В списке бесед у сообщения стоит ✓, как у отправленного.
- Состояние сообщения в ленте (React props): `isOptimistic: false`, `optimisticStatus` отсутствует, `delivery_status: 'sending'`.
- Причина: `markOptimisticMessageFailed` (`components/chat/useChatComposerSending.js`) → `applyOutgoingThreadMessage` → `upsertThreadMessagesInList` → `withStableThreadMessageRenderKey` → `mergeIncomingThreadMessage` (`lib/chat/chatSendAck.js:29`). Функция принимает локальную пометку ошибки за серверный ACK: ставит `isOptimistic = false` и удаляет `optimisticStatus`.
- Юнит-тесты проверяют пометку ошибки и слияние по отдельности, связку — нет.
- Сделать:
  - локальные переходы статуса собственного оптимистичного сообщения (`sending → failed → sending` при повторе) применять без логики слияния серверного ACK. Альтернатива: `mergeIncomingThreadMessage` не снимает оптимистичные флаги, если входящее сообщение само оптимистичное (`isOptimistic: true` / `optimisticStatus` задан);
  - превью беседы для failed-сообщения не показывает ✓ (как минимум без статуса доставки);
  - тест полной цепочки через реальные `useChatComposerSending` + `upsertThreadMessagesInList` + `ChatBubble`: ошибка → `optimisticStatus: 'failed'` в ленте → кнопка ⚠ → «Повторить» → один запрос с тем же `client_message_id` → серверное сообщение заменяет пузырь.

### Неблокирующее

- **R10. Опрос при обрыве обходит интервал и backoff.** Каждая попытка переподключения меняет `socketStatus` (`disconnected` ↔ `reconnecting`), эффект в `useChatActiveThreadPolling.js` перезапускается и вызывает `pollOnce()` сразу. Фактически опрос идёт ~1 раз/с, а не раз в 3 с с backoff. Сделать: не перезапускать цикл при смене одного нездорового состояния на другое (зависеть от булева «нужен опрос», состояние backoff хранить в ref).
- **R11. «Соединение…» при обрыве появляется через ~5 с вместо 2.** Таймер в `ChatThreadHeader.jsx#useChatConnectionLabel` сбрасывается на каждой смене статуса. Сделать: отсчитывать от момента выхода из `connected`; метку менять без сброса таймера, пока состояние не `connected`.
- **Поправка проверяющего к R6 (раздел 10):** замер «10 px» оказался некорректным — к моменту замера вся история уже была загружена. Сдвиг вероятнее вызван исчезновением кнопки «Показать ранние сообщения» при конце истории, а не prepend-restore. Исправление R6 подтверждено только тестом, в браузере не проверено.
- R5 и R7 — проверены по коду и тестам, замечаний нет. Расширенный маппинг 4xx → `validation_error` в `ws.py` принят.

## А1. Аудит: поле ввода, эмодзи, стикеры, вложения, лента (проверяющий, 2026-09-30)

Раздел без номера фазы — это новый аудит, а не журнал. Исполнитель фазы 5 ведёт свой журнал в разделе 13 независимо.
Работы по этому разделу — **фаза 6**, после приёмки фазы 5: пакет B фазы 5 тоже меняет `useChatComposerSending.js`.

### Как проверялось

- Код: `ChatComposer.jsx`, `ChatEmojiPanel.jsx`, `TelegramStickersTab.jsx`, `useChatStickerSending.js`, `useChatComposerUiController.js`, `useChatFileSending.js`, `chatUploadPrep.js`, `chatOptimisticMessages.js`, `ChatDialogs.jsx` (меню вложений), `backend/api/v1/chat/stickers.py`, `backend/chat/telegram_sticker_service.py`.
- Playwright на production-сборке фазы 4 (моки API и WebSocket), desktop 1440×900 и mobile 390×844.
- Не проверялось: полная загрузка файла через upload sessions (прогресс, чанки), вставка картинки из буфера, drag&drop, запись голоса (нужен микрофон), реальная отправка GIF и импорт стикеров (нужен интернет).

### Что работает (подтверждено стендом)

- Набор 73 символов: ~2,1 с, одна long task 75 мс — поле ввода отзывчивое.
- Enter отправляет, Shift+Enter — новая строка. Поле растёт до 8 строк (152 px), дальше внутренняя прокрутка. На телефоне Enter — перенос строки.
- Эмодзи вставляется в позицию курсора («Привет😀 мир»), фокус возвращается в поле. На телефоне панель заменяет клавиатуру, кнопка меняется на значок клавиатуры.
- Меню вложений: «Фото или видео», «Файл», «Задача». Выбор фото — `image/*,video/*`, множественный.
- Диалог отправки изображений: превью альбомом, редактирование и удаление каждого фото, «Отправить как файл», подпись с эмодзи.
- 10 входящих сообщений подряд, пользователь внизу: лента ни в одном из 111 кадров не отошла от низа. Своё отправленное сообщение — лента внизу. Входящее при чтении истории — бейдж, без прыжка (проверено ранее).

### Находки

| ID | Приоритет | Проблема | Подтверждение |
|---|---|---|---|
| C1 | P1 | Сбой GIF заменяет черновик ссылкой и сразу отправляет её | Код |
| C2 | P1 | GIF напрямую из браузера в `api.giphy.com` с ключом в коде; без доступа — вечная «Загрузка GIF…» | Стенд + код |
| C3 | P2 | Встроенных стикеров нет, только импорт из Telegram (нужен `TELEGRAM_BOT_TOKEN` и интернет на сервере); `STICKER_PACKS` — мёртвый код | Стенд + код |
| C4 | P2 | Стикер: нет оптимистичного пузыря и `client_message_id` — двойной клик даёт дубли | Код |
| C5 | P2 | 6+ фото за раз отклоняются целиком | Стенд |
| C6 | P2 | Оптимистичный пузырь фото всегда 216×176 — при ответе сервера пузырь меняет размер, лента дёргается | Код |
| C7 | P3 | Текст длиннее 12 000 символов молча обрезается | Код |
| C8 | P3 | Мелкие проблемы дизайна поля ввода и диалога вложений | Стенд |
| C9 | вопрос | В вебе нельзя создать опрос, контакт или геопозицию, хотя показ поддерживается | Код |

**C1.** `pages/chat/useChatComposerUiController.js:52–64`, `handleSendGif`: при ошибке `fetch(gif.fullUrl)` выполняется `setMessageText(gif.fullUrl)` и `handleComposerSend()`. Набранный пользователем текст заменяется ссылкой и уходит без подтверждения. Сделать: при ошибке показать уведомление, черновик не трогать, ничего не отправлять.

**C2.** `components/chat/ChatEmojiPanel.jsx`: `GIPHY_API_KEY` в исходнике, запросы `trending`/`search` к `api.giphy.com` из браузера.
- Поисковые запросы сотрудников уходят третьей стороне.
- При закрытом доступе вкладка бесконечно показывает «Загрузка GIF…» (стенд, mobile).
- Минимум: таймаут и состояние ошибки «GIF недоступны».
- Дальше — решение пользователя (раздел А1, вопросы).

**C3.**
- `TelegramStickersTab.jsx` показывает только импортированные наборы. Пустое состояние «Добавьте первый набор… t.me/addstickers» (стенд).
- Импорт требует `TELEGRAM_BOT_TOKEN` и доступ сервера к `api.telegram.org` (`backend/chat/telegram_sticker_service.py:50,94`).
- `STICKER_PACKS` (~100 строк эмодзи-«стикеров») в `ChatEmojiPanel.jsx` объявлен и не используется.

**C4.** `pages/chat/useChatStickerSending.js`: ждёт ответ сервера без оптимистичного пузыря. `POST …/messages/sticker` (`backend/api/v1/chat/stickers.py`) не принимает `client_message_id`, поэтому повтор и двойной клик создают дубли. Сделать:
- `client_message_id` в запросе и в backend через существующий механизм идемпотентности `message_persistence`;
- блокировать повторное нажатие до ответа;
- оптимистичный пузырь — по решению пользователя.

**C5.** `useChatFileSending.js:~168`: при `existing + incoming > CHAT_MAX_FILE_COUNT (5)` не добавляется ни один файл («Можно отправить не более 5 файлов за один раз.», стенд). Варианты — решение пользователя (вопросы).

**C6.** `pages/chat/chatOptimisticMessages.js:131`: у всех изображений оптимистичного сообщения `width: 216, height: 176`. Когда приходит серверное сообщение с реальными размерами, пузырь меняет высоту — лента дёргается сразу после отправки фото. Сделать: читать реальные размеры (`createImageBitmap` / `Image` по objectURL) до создания оптимистичного сообщения и учитывать EXIF-поворот (как на сервере — `ImageOps.exif_transpose`).

**C7.** `ChatComposer.jsx`: `maxLength={CHAT_MESSAGE_BODY_MAX_LENGTH}` (12 000) на textarea. Вставленный длинный текст молча обрезается. Сделать: не обрезать; при превышении — счётчик красным, кнопка отправки неактивна, подсказка «Слишком длинное сообщение» (опционально «Отправить как файл .txt»).

**C8. Дизайн**
- Многострочный текст в поле ввода прилипает к верхней границе — нужен внутренний отступ сверху.
- «3 файл(ов)» — нужна нормальная форма множественного числа.
- Полоса выбранных файлов над полем ввода дублирует открытый диалог отправки.
- В диалоге все действия — текстовые ссылки в строку: «Отправить» сделать основной кнопкой справа, «Добавить» — слева.

**C9.** Меню вложений в вебе — 3 пункта. Опросы, контакты и геопозиция отображаются (пришли из мобильного клиента), но создать их в вебе нельзя. Нужно ли — решение пользователя.

### Пакеты фазы 6 (после приёмки фазы 5)

| Пакет | Находки | Файлы |
|---|---|---|
| F. Эмодзи и GIF | C1, C2 (минимум), C3 (удаление мёртвого кода), C7, C8 (поле ввода) | `ChatEmojiPanel.jsx`, `useChatComposerUiController.js`, `ChatComposer.jsx` + тесты |
| G. Стикеры | C4 | `useChatStickerSending.js`, `api/chatStickers.js`, `backend/api/v1/chat/stickers.py` + тесты |
| H. Фото и файлы | C5, C6, C8 (диалог) | `useChatFileSending.js`, `chatOptimisticMessages.js`, `ChatFileUploadDialog.jsx`, `ChatFileUploadPanel.jsx` + тесты |

Приёмка — стенд проверяющего:
- ошибка GIF не трогает черновик;
- вкладка GIF без сети показывает ошибку за ≤10 с;
- двойной клик по стикеру — одно сообщение;
- отправка фото — высота пузыря до и после ответа сервера отличается ≤2 px;
- 6 фото — поведение по решению пользователя;
- длинный текст не обрезается.

### Решения пользователя по А1 (2026-09-30)

1. **GIF — убрать вкладку.**
   - C2 выполняется удалением вкладки GIF, `GifTab`, `GIPHY_API_KEY` и обработчика `handleSendGif` (C1 закрывается вместе с ним).
   - Проверить, что в бандле не остаётся обращений к `api.giphy.com`.
   - Уже отправленные GIF-файлы продолжают показываться как изображения.
2. **Стикеры — встроенный набор.**
   - 1–2 набора, доступных всем без импорта, отдаёт сервер; импорт из Telegram остаётся.
   - Источник изображений — только с лицензией, допускающей использование в компании (например, Noto Emoji — Apache 2.0, или собственные корпоративные). Наборы из Telegram как встроенные **не использовать**.
   - Исполнитель предлагает источник и способ поставки (файлы в репозитории или сид-данные) и **согласует до реализации**. Миграции БД — только штатным Alembic.
   - Мёртвый `STICKER_PACKS` в `ChatEmojiPanel.jsx` удалить.
3. **Больше 5 фото — разбить на несколько сообщений.**
   - Выбор N фото → альбомы по 5 в исходном порядке, одна отправка.
   - Подпись — только к первому альбому.
   - У каждого сообщения свой `client_message_id`.
   - Ошибка одного альбома не отменяет уже отправленные; неотправленный альбом — пузырь ⚠ (как P2-7).
4. **Создание в вебе: опрос, контакт, геопозиция — нужны все три.** Новые пункты меню вложений.
   - Backend уже принимает `kind: location | contact | poll` (`SendMessageRequest` в `backend/chat/schemas.py`), форматы тела разбирает `components/chat/chatStructuredContent.js`. Формат создания сверить с мобильным клиентом (`mobile-hub/src/chat/`), чтобы сообщения одинаково отображались везде.
   - Опрос: вопрос + 2–10 вариантов (лимиты сверить с backend).
   - Контакт: выбор из адресной книги.
   - Геопозиция: `navigator.geolocation` с понятной ошибкой при отказе в доступе.

### Пакеты фазы 6 с учётом решений

| Пакет | Находки | Файлы |
|---|---|---|
| F. Эмодзи и поле ввода | C1+C2 (удаление GIF), C3 (мёртвый код), C7, C8 (поле ввода) | `ChatEmojiPanel.jsx`, `useChatComposerUiController.js`, `ChatComposer.jsx`, проброс `onSendGif` в `ChatThread.jsx`/`useChatThreadSection.jsx` + тесты |
| G. Стикеры | C3 (встроенный набор — после согласования источника), C4 | `useChatStickerSending.js`, `api/chatStickers.js`, `TelegramStickersTab.jsx`, `backend/api/v1/chat/stickers.py`, `backend/chat/telegram_sticker_service.py` + тесты |
| H. Фото и файлы | C5 (разбиение на альбомы), C6, C8 (диалог) | `useChatFileSending.js`, `chatOptimisticMessages.js`, `ChatFileUploadDialog.jsx`, `ChatFileUploadPanel.jsx` + тесты |
| I. Опрос, контакт, геопозиция | C9 | `ChatDialogs.jsx` (меню), новые диалоги в `components/chat/`, `api/chatMessageSending.js` (передача `kind`) + тесты |

Конфликт файлов: F и I могут пересекаться в `ChatDialogs.jsx` / `ChatThread.jsx`. Выполнять их последовательно или отдать одному исполнителю.

## 13. Фаза 5 — исправление замечаний R9–R11 (исполнитель, 2026-09-30)

### R9. Неотправленное сообщение помечается ⚠ — выполнено

- Выбран вариант «правило в mergeIncomingThreadMessage»: входящее сообщение с `isOptimistic`/`optimisticStatus` — локальная смена статуса (`sending → failed → sending`), флаги не снимаются; серверные ACK/echo флагов не несут и снимают их как раньше. Вариант минимальнее отдельного пути: `markOptimisticMessageFailed` и retry идут одним upsert-путём, одна проверка покрывает оба перехода, а дедуп по `client_message_id` в `upsertThreadMessagesInList` продолжает заменять пузырь серверным echo.
- Превью беседы: `syncConversationPreview` ставит `last_message_delivery_status: null` для failed-сообщения — ✓ в сайдбаре не рисуется (`ChatSidebarRows` показывает чеки только при непустом статусе).
- Файлы: `src/lib/chat/chatSendAck.js`, `src/pages/chat/useChatConversationSyncCallbacks.js`.
- Тесты:
  - `src/components/chat/useChatComposerSending.chain.test.jsx` → полная цепочка без подмены внутренних модулей (реальные `useChatComposerSending` + `upsertThreadMessagesInList` + `ChatBubble` + `syncConversationPreview`; моканы только `chatSocket`/`chatAPI`): ошибка WS + ошибка HTTP → `optimisticStatus:'failed'`/`isOptimistic:true` в ленте → `chat-message-failed-action` в DOM → превью `null` → «Повторить» → ровно один запрос с тем же `client_message_id` → `server-9` заменяет пузырь, флаги сняты, превью `'sent'`;
  - `src/pages/chat/chatOptimisticMessages.test.js` → merge сохраняет флаги для `sending→failed` и `failed→sending`;
  - `src/pages/chat/useChatThreadController.test.js` (существующие R4-кейсы) → A→B→A и «ошибка при активной B»: восстановленный пузырь хранит `optimisticStatus:'failed'`; DOM-⚠ для восстановленного состояния покрыт цепочным тестом и прямым `ChatBubble`-кейсом в `ChatThread.test.jsx`.
- Проверки: `npx vitest run …` полный набор → 139 файлов, 936/936; узкий прогон → 46/46.
- Отклонений нет.

### R10. Опрос при обрыве не обходит интервал и backoff — выполнено

- `shouldPoll` вычислен до эффекта и стал зависимостью вместо `activeThreadTransportState`; `inFlight`/`backoffAttempt`/`backoffUntil` перенесены в `pollStateRef` — смена нездоровых состояний (`offline ↔ degraded`, т.е. `disconnected ↔ reconnecting`) не пересоздаёт цикл, не вызывает `pollOnce` и не сбрасывает backoff. Текущий transport для debug-лога читается из `transportStateRef`, обновляемого при рендере. Смена `activeConversationId` по-прежнему перезапускает цикл (осознанно).
- Файлы: `src/components/chat/useChatActiveThreadPolling.js`, `src/components/chat/useChatActiveThreadPolling.test.jsx`.
- Тесты (fake timers): 5 переключений `offline ↔ degraded` за 5 с при интервале 3 с → ровно 2 запроса (t=0 и t=3); смена статуса внутри backoff-окна → немедленного запроса нет, следующий строго по расписанию.
- Проверки: файл → 8/8.

### R11. «Соединение…» через 2 с от выхода из connected — выполнено

- `unhealthySinceRef` фиксирует первый уход из `connected`; при каждой смене нездорового статуса таймер перевзводится на остаток `2000 − elapsed`, при `connected` сбрасывается и метка прячется немедленно.
- Файлы: `src/components/chat/ChatThreadHeader.jsx`, новый `src/components/chat/ChatThreadHeader.test.jsx`.
- Тесты: disconnected@0 → reconnecting@+1 с → disconnected@+2 с → подпись видна на 2-й секунде от первого выхода; возврат `connected` → подпись скрыта сразу.
- Проверки: файл → 2/2.

### Прогоны

- Узкие: `useChatComposerSending.chain.test.jsx` 1/1; `useChatActiveThreadPolling.test.jsx` 8/8; `ChatThreadHeader.test.jsx` 2/2; `chatOptimisticMessages.test.js` 12/12; `useChatComposerSending.test.jsx` 11/11; `useChatThreadController.test.js` 12/12 — итого 46/46.
- Полный набор: `npx vitest run src/lib/chatSocket.test.js src/lib/chat src/pages/chat src/components/chat src/pages/Chat.test.jsx src/pages/Chat.performance.test.jsx` → **139 файлов, 936/936** (было 930, +6 новых).
- ESLint изменённых файлов → **0 errors** (29 warnings — baseline `no-unused-vars` на JSX-идентификаторах, как в соседних файлах).
- `git diff --check` → чисто.

### Замечания к плану / новые находки

- Диагноз раздела 12 подтверждён: локальная пометку ошибки шла через `mergeIncomingThreadMessage` и теряла `isOptimistic`/`optimisticStatus`. Дополнительно: stripped-сообщение переставало распознаваться `isFailedOptimisticThreadMessage`, поэтому без фикса пузырь мог исчезнуть и при следующем payload — восстановление R4 идёт через `reconcileThreadMessages`, не через этот merge.
- В тестовом харнессе `buildActiveThreadPollLoadOptions`/`shouldPollActiveThreadIncrementally` обязаны быть стабильными ссылками: на странице это стабильные импорты (`useChatSocketController`, `useChatPageRealtimeEffects`), но нестабильная ссылка сама по себе пересоздаёт эффект — учитывать в будущих тестах.
- Не проверено в реальном браузере: стенд проверяющего (моки API/WS на production-сборке) не воспроизводился — проверка jsdom-цепочкой с реальными модулями и моком только транспорта.

## А2. Аудит: появление сообщений, уведомления, счётчики непрочитанных (проверяющий, 2026-09-30)

Работы по этому разделу — **фаза 7** (можно параллельно с фазой 6, если файлы не пересекаются: см. таблицу пакетов). Проверено по коду; стенд — при приёмке.

### Находки

| ID | Приоритет | Проблема |
|---|---|---|
| U1 | P1 | Непрочитанные AI-бесед считаются во вкладку «Личные», а у вкладки «ИИ» счётчика нет |
| U2 | P1 | Счётчики вкладок и папок считаются только по загруженным беседам (первая страница 50) — у пользователей с >50 чатами занижены и расходятся с общим бейджем |
| U3 | P2 | Анимация появления проигрывается для **всех** входящих при открытии беседы и догрузке истории; свои сообщения не анимируются; на телефоне входящие не анимируются |
| N1 | P2 | Нет звука нового сообщения чата (звук есть только у hub-уведомлений) |
| N2 | P2 | На странице чата при открытой беседе A сообщение в беседу B даёт всплывающий тост, хотя список бесед уже показывает его |
| N3 | P3 | Заголовок вкладки браузера при скрытой вкладке: «(N) Новое уведомление — …» без различия чата и hub |

**U1.** AI-беседы отображаются в отдельном разделе «ИИ», но их непрочитанные попадают в «Личные». Бейдж на «Личных» есть, а соответствующей строки в списке нет.
- Frontend: `components/chat/chatFolderUtils.js#buildFolderUnreadCounts` — `personal` считается через `isPersonalConversation`, где `kind === 'ai'` включён. Для списка используется `isPersonalSidebarConversation`, где ИИ исключён.
- Backend: `backend/chat/folder_unread.py:34` — `kind in {"direct","notes","ai"}` → `personal`.
- Вкладка «ИИ» (desktop `ChatSidebarDesktopHeader.jsx`, mobile `ChatSidebar.jsx:~586`) бейджа не имеет.
- Сделать:
  - `ai` исключить из `personal` на frontend и backend (обновить тесты `folder_unread`);
  - добавить счётчик `ai` в оба места;
  - показывать бейдж на вкладке «ИИ» (стиль как у вкладок папок), с учётом mute AI-бесед;
  - общий бейдж раздела «Корпоративный чат» и значок приложения — по решению пользователя (см. вопросы).

**U2.** `pages/chat/useChatSidebarDerivedState.js` → `buildFolderUnreadCounts(conversations…)` считает по загруженному списку (`getConversations({ limit: 50 })` + догруженные страницы). Backend уже отдаёт `folder_unread_counts` (`chat_folder_service.py:89`, схема `schemas.py:686`), frontend их не использует.
- Сделать: основой бейджей вкладок сделать серверные `folder_unread_counts` (с новым ключом `ai`, см. U1) и обновлять их по `chat.unread.summary` / `chat.conversation.updated`.
- Локальный пересчёт — только как оптимистичная поправка для загруженных строк (прочитал беседу → минус её `unread_count`), без замены серверного итога.

**U3. Появление сообщений «как в Telegram».**
- `ChatBubble.jsx:~1117`: `animation: messageAppear 150ms` для всех входящих при монтировании; `chatBubbleGesturePolicy.js#shouldAnimateChatBubble`: свои — никогда, на телефоне входящие — нет.
- Итог: при открытии беседы и догрузке истории одновременно «въезжают» десятки пузырей, а живые сообщения выглядят так же, как история.
- Сделать:
  - анимировать только **живые** сообщения — пришедшие по сокету или отправленные после открытия беседы; маркер ставить в момент merge из сокета или оптимистичной отправки, не по монтированию;
  - своё сообщение: короткий подъём снизу из поля ввода; входящее: fade + сдвиг 8–10 px, 150–180 мс; на телефоне — так же;
  - история, bootstrap, prepend и восстановление из кэша — без анимации;
  - `prefers-reduced-motion` — без анимации (сохранить);
  - анимация не должна влиять на расчёт прокрутки: только `transform` и `opacity`, без изменения высоты.

**N1. Звук.** Для чата звука нет: `MainLayout.jsx` проигрывает `/sounds/notification.mp3` только в ветке hub-уведомлений. Сделать по решению пользователя: короткий звук нового сообщения с учётом mute беседы и упоминаний, тихих часов (если есть в настройках уведомлений) и дедупликации по `messageId` (`claimChatMessageNotification`). Переключатель — в настройках уведомлений чата.

**N2.** `lib/chatSocketNotificationPlan.js`: тост подавляется только для активной видимой беседы и на мобильном маршруте чата. На desktop-странице чата сообщение в другую беседу даёт тост поверх уже видимого списка бесед. Сделать по решению пользователя (см. вопросы).

**N3.** `MainLayout.jsx:~1915`: заголовок «(N) Новое уведомление — …». Предложение: «(N) HUB-IT» или «(N) Имя отправителя» для последнего сообщения чата, чтобы на вкладке было понятно, что пришло сообщение.

### Пакеты фазы 7

| Пакет | Находки | Файлы |
|---|---|---|
| J. Счётчики | U1, U2 | `chatFolderUtils.js`, `useChatSidebarDerivedState.js`, `ChatSidebarDesktopHeader.jsx`, `ChatSidebar.jsx`, `ChatFolderTabs.jsx`, `backend/chat/folder_unread.py`, `backend/chat/chat_folder_service.py` + тесты |
| K. Появление сообщений | U3 | `ChatBubble.jsx`, `chatBubbleGesturePolicy.js`, `chatThreadMessageMerge.js`/`useChatThreadMessageMerge.js` (маркер «живого» сообщения) + тесты |
| L. Уведомления | N1, N2, N3 | `lib/chatSocketNotificationPlan.js`, `components/layout/MainLayout.jsx`, настройки уведомлений + тесты |

Конфликты: K трогает `ChatBubble.jsx`, как и пакеты H/I фазы 6 — выполнять после них или одним исполнителем.
Приёмка (стенд проверяющего):
- непрочитанное AI-сообщение даёт бейдж на «ИИ» и не меняет «Личные»;
- 60 бесед, непрочитанная — 55-я: бейдж вкладки корректен до догрузки списка;
- открытие беседы с 30 сообщениями — ни одной анимации появления; новое по сокету — одна анимация;
- звук и тост — по решениям пользователя.

### Решения пользователя по А2 (2026-09-30)

1. **Звук — включён по умолчанию.**
   - Звучит на новое сообщение, кроме заглушённых бесед (упоминание в заглушённой — звучит), своих сообщений и открытой видимой беседы.
   - Не чаще одного раза в ~1,5 с при пачке сообщений.
   - Переключатель «Звук сообщений» — в настройках уведомлений.
   - Браузер может блокировать автозвук до первого действия пользователя — ошибку `play()` молча игнорировать.
2. **Тост на странице чата (desktop) для другой беседы — не показывать.** Достаточно подъёма беседы в списке, бейджа и звука. На остальных страницах портала тост остаётся. Мобильное поведение — без изменений.
3. **ИИ в общем бейдже — учитывать.** Общий бейдж «Корпоративный чат», значок приложения и заголовок вкладки включают непрочитанные ИИ. Внутри чата они видны только на вкладке «ИИ» (U1).
   Серверный итог (`chat_conversation_read_store.py`, `messages_unread_total`) уже не фильтрует по `kind` — ИИ включены, менять не нужно.

**N4 (P3, вопрос на будущее).** Тот же серверный итог не исключает заглушённые беседы: заглушённый чат продолжает увеличивать общий бейдж. В Telegram по умолчанию заглушённые в общий счётчик не входят. В фазе 7 не менять без решения пользователя.

## А3. Дополнительные решения пользователя (2026-09-30)

1. **Выкатка — одним релизом после фаз 6–7.**
   - До этого изменения остаются в рабочем дереве, deployment и рестарты не выполняются.
   - Перед релизом проверяющий готовит отдельный план: сборка frontend, штатные `scripts/pm2/restart-chat.ps1` / `restart-backend.ps1` (последний перезапускает и scan), откат, post-check.
   - Выполнение — только после явного «да» пользователя и согласованного окна.
2. **N4 — заглушённые беседы не учитывать в общем бейдже** (пакет L фазы 7 + backend).
   - `messages_unread_total` / `conversations_unread` в `chat_conversation_read_store.py` исключают беседы с активным mute (`is_muted` и не истёкший `muted_until`).
   - Если backend хранит признак непрочитанного упоминания — такие беседы учитывать и при mute; если нет — просто исключать, а упоминания вынести отдельным вопросом.
   - В списке бесед счётчик заглушённой беседы — серый (проверить текущий стиль).
3. **Стикеры — рекомендованные наборы из Telegram (заменяет п. 2 решений А1).**
   - Предзагрузить несколько популярных наборов через **существующий** механизм импорта (`telegram_sticker_service.py`; `TELEGRAM_BOT_TOKEN` в `.env` задан) и сделать их доступными всем по умолчанию.
   - Список наборов исполнитель согласует с пользователем до импорта.
   - Требование пользователя: наборы должны **быстро загружаться и корректно проигрываться** — статичные WEBP, анимированные TGS (Lottie) и видео WEBM. Проверить `ChatStickerMedia.jsx`, превью в панели, кэширование файлов на сервере и браузере, работу при медленной сети.
   - Риск, зафиксированный проверяющим: права на наборы принадлежат их авторам; массовая предзагрузка для всей компании — решение пользователя, принято осознанно.

## А4. APP_ENV=development на production (проверка проверяющего, только чтение, 2026-09-30)

**Итог:** часть рисков уже закрыта явными флагами в `.env`, но режим разработки на production оставляет несколько опасных веток. Рекомендуется перевести на `APP_ENV=production` отдельной согласованной операцией с preflight.

**Уже закрыто флагами** (значения проверены без вывода секретов):
- `APP_SCHEMA_DEV_AUTO_CREATE=0` — dev-DDL основной app-БД отключён (`appdb/db.py:47`);
- `AUTH_COOKIE_SECURE=true`;
- `MY_FILES_ANTIVIRUS_ENABLED=1` и `MY_FILES_ANTIVIRUS_FAIL_CLOSED=1`.

**Остаётся из-за development** (`config.app.is_production == False`):
- `services/user_service.py:658–665` — если хранилище пользователей окажется пустым (например, ошибка конфигурации БД), создаются пользователи по умолчанию, включая `admin`. В production это запрещено исключением;
- `services/auth_runtime_store_service.py:70–84` — при недоступности `APP_DATABASE_URL` хранилище отзывов токенов и сессий молча переходит в память процесса. Отзыв сессии в одном процессе не виден другим (backend, chat-a, chat-b);
- `config.py:573–583` — не проверяется, что JWT-ключи не являются заглушкой;
- `services/secret_crypto_service.py:28–37` — не отклоняются ключи-заглушки шифрования;
- `json_db/manager.py:36,48` — хранилище JSON может молча перейти на SQLite (прямо запрещено AGENTS.md для production);
- `chat/db.py:419–443` — при старте чата выполняются `create_all` и `_ensure_*_columns` (runtime DDL) вместо проверки схемы `_verify_production_schema`. Флаг `APP_SCHEMA_DEV_AUTO_CREATE` этот путь не отключает.

**Предлагаемая операция** (не выполнялась, нужно отдельное «да» и окно; лучше вместе с релизом фаз 6–7):
1. Preflight (только чтение):
   - JWT-ключи не заглушки;
   - `APP_DATABASE_URL` и `CHAT_DATABASE_URL` доступны;
   - актуальная Alembic-ревизия app и chat, `_verify_production_schema` для фактической runtime-схемы (`chat` или legacy `public`, см. инвариант в AGENTS.md);
   - хранилище пользователей не пустое;
   - JSON runtime на PostgreSQL.
2. Замена `APP_ENV=production` в корневом `.env` (с резервной копией файла).
3. Перезапуск штатными скриптами PM2 (весь контур использует общий `.env`).
4. Post-check: `scripts/pm2/health-check.ps1` без repair-флагов, вход в портал, отправка сообщения в чат, логи без `ConfigurationError`.
5. Откат: вернуть `.env` из резервной копии и перезапустить тем же скриптом.

## 14. Фаза 6 — пакеты F–I по решениям А1/А3 (исполнитель, 2026-09-30)

### Пакет F (C1–C3, C7, C8)

- Статус: выполнено.
- GIF-вкладка, `handleSendGif`, `GIPHY_API_KEY`, прямые запросы к `api.giphy.com` и мёртвый `STICKER_PACKS` удалены целиком (C1/C2 закрыты удалением функции — по решению А1). Файлы: `components/chat/ChatEmojiPanel.jsx`, `pages/chat/useChatComposerUiController.js`, `components/chat/ChatComposer.jsx`, `components/chat/ChatThread.jsx`, `pages/chat/ChatPageContent.jsx`.
- C7: `maxLength` снят с textarea — текст не обрезается; при превышении 12 000 счётчик красный, отправка заблокирована (кнопка и Enter), подсказка «Слишком длинное сообщение». Файлы: `ChatComposer.jsx`, `useChatComposerSending.js`.
- C8: внутренний отступ сверху у многострочного поля.
- Тесты: `ChatEmojiPanel.test.jsx`, `ChatComposer.behavior.test.jsx`, `ChatThread.test.jsx` — GIF-кейсы заменены на отсутствие вкладки; добавлены кейсы счётчика/блокировки.

### Пакет G (C4)

- Статус: выполнено.
- `client_message_id` генерируется на клиенте и проброшен через `api/chatStickers.js` → `POST messages/sticker`; backend принимает поле и переиспользует идемпотентность `message_persistence` (дублирующий ответ возвращает исходное сообщение, скопированный файл стикера при dedup-hit удаляется). Файлы: `api/chatStickers.js`, `backend/api/v1/chat/stickers.py`, `backend/chat/telegram_sticker_service.py`.
- Повторный клик по стикеру блокируется до ответа (`useChatStickerSending.js`); оптимистичный пузырь не добавлен — по А1 «по решению пользователя», вопрос не закрыт.
- Тесты: `useChatStickerSending.test.jsx` (id в запросе, блок повторного клика), backend-тест дедупа `send_sticker` в `tests/test_chat_files_and_notifications_service.py`.

### Пакет H (C5, C6, C8-диалог)

- Статус: выполнено.
- C5: отправка >5 изображений разбивается на альбомы по `CHAT_MAX_FILE_COUNT` (5) — лимит применяется на альбом, а не на всю пачку (решение А3).
- C6: `chatUploadPrep.js` читает реальные размеры изображения до создания оптимистичного пузыря (objectURL + EXIF-ориентация) — пузырь не меняет размер при ответе сервера.
- Файловые сообщения получают `client_message_id` (оптимистичный → upload-session → `persist_file_message`); сбой файловой отправки регистрирует ⚠-пузырь через `registerFailedOutgoingMessage` с повтором тем же id. Файлы: `useChatFileSending.js`, `chatFileUploads.js`, `chatOptimisticMessages.js`, `useChatComposerSending.js` + контроллеры проброса.
- C8-диалог: форма множественного числа, дублирующая полоса файлов и кнопки диалога приведены к дизайн-системе (`ChatFileUploadPanel.jsx`).
- Тесты: `useChatFileSending.test.jsx` (альбомы, failed-регистрация), `chatUploadPrep.test.js` (размеры/EXIF), `client.test.js` (`client_message_id` в session create).

### Пакет I (C9)

- Статус: выполнено.
- В меню вложений добавлены «Опрос», «Контакт», «Геопозиция»: диалоги `ChatPollCreateDialog`, `ChatContactPickDialog`, `ChatLocationDialog`; отправка через `useChatStructuredSend` → `chatAPI.sendMessage` с `kind`. Форматы сверены с backend (`location {latitude, longitude}`, `contact {name, phone, organization}`, `poll {question, options, anonymous}`; серверная валидация poll: 2–10 опций ≤100, вопрос ≤300 — зеркалится в диалоге).
- Файлы: `api/chatMessageSending.js` (kind в payload), `useChatStructuredSend.js`, `ChatDialogs.jsx`, `ChatComposer.jsx`, цепочка `pickChatPageLayoutSections`/`useChatPageComposerStack`/`useChatPageDialogsLayerProps`.
- Тесты: `ChatDialogs.test.jsx` (диалоги), поведенческие кейсы отправки с `kind`.

### Замечания к плану / новые находки (фаза 6)

- Оптимистичный пузырь для стикеров (C4, «по решению пользователя») не реализован — вопрос оставлен открытым, текущее поведение: блок повторного клика до ответа сервера.
- «Отправить как файл .txt» при переполнении (C7, опционально) не добавлено.

## 15. Фаза 7 — пакеты J–L по решениям А2/А3 (исполнитель, 2026-09-30)

### Пакет K (U3) — сделан первым, меняет общий merge

- Статус: выполнено.
- `mergeMessageIntoThread(message, { liveAppear: true })` — маркер ставится только для живых socket-созданных сообщений (`useChatSocketEvents.js`); история, поллинг, SWR-восстановление и копии failed-реестра флаг не получают или теряют его при записи ленты в кэш (`useChatThreadMessageMerge.js`, `chatOptimisticMessages.js`).
- Тесты: `chatThreadMessageMerge.test.js`, `chatOptimisticMessages.test.js` (флаг снимается), `useChatSocketEvents.test.jsx` (ассерты обновлены на второй аргумент).

### Пакет J (U1/U2)

- Статус: выполнено.
- Backend `chat/folder_unread.py`: `SYSTEM_FOLDER_UNREAD_KEYS` += `ai`; AI-беседы исключены из `personal`; по решению А3-2 эффективно заглушённые (mute/muted_until) беседы исключены из счётчиков папок и из `messages_unread_total`/`conversations_unread`.
- Frontend: `folderUnreadCounts` из `GET /chat/folders` — основной источник бейджей (`useChatFoldersController` → `useChatPageInitialState` → `useChatSidebarDerivedState`), подсчёт по загруженным строкам — fallback; `chatFolderUtils.js`: `resolveConversationFolderKeys`, дельта-мердж серверных счётчиков.
- `useChatSocketEvents`: debounced `loadChatFolders({ silent: true })` на `chat.unread.summary` и `chat.conversation.updated`.
- Бейдж непрочитанных на вкладке «ИИ»: `ChatSidebarDesktopHeader.jsx`, мобильный таб (`ChatSidebar.jsx`).
- Тесты: `useChatFoldersController.test.js`, `useChatSidebarDerivedState.test.jsx`, `useChatSocketEvents.test.jsx`, `tests/test_chat_folder_unread.py` (ожидание с `ai`), `tests/test_chat_presence_and_receipts_service.py` (mute исключает из бейджа; истёкший `muted_until` возвращает).

### Пакет L (N1–N3, N4/A3-2)

- Статус: выполнено.
- N1: звук нового сообщения — `lib/chatMessageSound.js` (WebAudio-блип, без аудиофайла — в репозитории нет звуковых ассетов; `/sounds/notification.mp3` в `public` отсутствует), троттлинг 1,5 с, ошибки AudioContext глушатся. Переключатель `chat_sound` в настройках чат-уведомлений (`notificationPreferences.js`, `NotificationChannelsSettingsCard.jsx`; backend `notification_preferences_service.py` + схема patch). Учитывает mute/mention: mention в заглушённой беседе звучит.
- N2: на desktop-маршруте чата hub-уведомления о чате не дублируют тосты (socket уже обрабатывает); та же логика в foreground-push ветке `layoutPushDecisions.js`; `lastNotificationLabel` сбрасывается в hub-пути — hub-уведомления не наследуют чужое имя отправителя.
- N3: заголовки тостов/системных уведомлений — имя отправителя (`chatSocketNotificationPlan.js`), а не «Новое сообщение».
- N4/A3-2: muted-беседы — серый бейдж в строках списка (токены + `ChatSidebarRows.jsx`), исключены из общего счётчика на backend.
- Файлы: `MainLayout.jsx` (интеграция звука, prefs, активная беседа → service worker), `chatSocketNotificationPlan.js`, `layoutPushDecisions.js`, `ChatSidebarRows.jsx`, backend `folder_unread.py`, `notification_preferences_service.py`, `api/v1/settings.py` схема.
- Тесты: `chatMessageSound.test.js` (троттлинг, ошибки AudioContext, reset), `notificationPreferences.test.js` (chat_sound в exact-объектах), `chatSocketNotificationPlan.test.js` (N1/N2/N3-кейсы), `layoutPushDecisions.test.js` (foreground-push подавление), `tests/test_chat_presence_and_receipts_service.py` (N4).

### Замечания к плану / новые находки (фаза 7)

- Тихие часы (N1, «если есть в настройках»): quiet hours сейчас применяются только сервером к push; клиентский звук ими не ограничен — в клиентских prefs `quiet_hours` не приходит (endpoint отдаёт, но `normalizeNotificationPreferences` берёт только channels). Открытый вопрос: глушить ли in-app звук в тихие часы для активного пользователя.
- `POSTGRES_APP_SCHEMA_DDL.md:3` содержит trailing whitespace (чужое изменение, не трогал) — единственная метка `git diff --check`.
- ESLint: `src/lib/**` линтится без browser-globals — `no-undef` на `window`/`WebSocket`/`console` является baseline (в `chatSocket.js` их 50). В новом `chatMessageSound.js` использован `globalThis`, файл чист.

### Проверки (фазы 6–7, фактический результат)

- `npx vitest run src/lib/chatSocket.test.js src/lib/chat src/pages/chat src/components/chat src/pages/Chat.test.jsx src/pages/Chat.performance.test.jsx` → **142 файла / 977 тестов, 0 падений** (база фазы 5: 930).
- `pytest -q tests/test_chat_folder_unread.py tests/test_chat_presence_and_receipts_service.py tests/test_chat_files_and_notifications_service.py tests/test_notification_preferences_service.py` → **70 passed**.
- ESLint изменённых файлов → **0 errors** (warnings — baseline `no-unused-vars` на JSX-идентификаторах).
- `git diff --check` → чист для файлов фаз 6–7.
- Не проверено: runtime-стенд проверяющего (реальные push/system notification, звук в живом браузере, мобильный клиент с новым ключом `ai` в `folder_unread_counts` — мобильный потребитель может игнорировать неизвестный ключ, проверить на стенде).

## 16. Проверка фаз 5–7 (проверяющий, 2026-09-30)

**Итог:** фазы 5–7 в основном приняты. Одно блокирующее замечание (R12), не выполнена предзагрузка стикеров (А3-3), есть некритичные замечания R13–R18. Работы — **фаза 8**.

### Что проверено

- `npx vitest run` (чат + `chatMessageSound`, `chatSocketNotificationPlan`, `layoutPushDecisions`, `notificationPreferences`) → **144 файла, 1004/1004**.
- `pytest -q tests/test_chat_folder_unread.py tests/test_chat_presence_and_receipts_service.py tests/test_chat_files_and_notifications_service.py tests/test_notification_preferences_service.py` (`CHAT_DATABASE_URL` на sqlite, `CHAT_REALTIME_TRANSPORT=local`) → **70 passed**.
- Production-сборка во временный каталог — успешно; `api.giphy.com` в бандле нет (упоминание `giphy.com` — только в сторонней embed-библиотеке).
- Стенд (production-сборка, моки API/WS, Playwright):
  - R9: ⚠ виден, переживает A→B→A; `validation_error` — без HTTP, `command_failed` — HTTP-fallback с тем же `client_message_id`;
  - R10: 2 опроса за 6 с обрыва (было 6);
  - R11: «Соединение…» появляется на 2–3-й секунде после выхода из `connected`;
  - U3: открытие беседы с 30 сообщениями — 0 анимаций; новое по сокету — ровно 1;
  - U1: бейдж «ИИ 3» на вкладке ИИ, «Личные» его не включают;
  - N1/N2: сообщение в другую беседу — один звук, тоста нет; в открытой беседе — звука нет;
  - C7: 13 000 символов не обрезаются, отправка заблокирована, подсказка «Слишком длинное сообщение»;
  - C5/C6: 7 фото → 2 сообщения (5 + 2), разные `client_message_id`; высота пузырей до и после ответа сервера совпадает (258/129 px);
  - C9: меню «Фото или видео / Файл / Задача / Опрос / Контакт / Геопозиция»; двойной клик «Создать» — один опрос.

### Блокирующее

**R12. «Повторить отправку» не работает после смены беседы.**
- Стенд: ошибка отправки → беседа B → беседа A → ⚠ → «Повторить отправку» → запросов нет, пузырь остаётся ⚠. Без смены беседы повтор работает. Прямой вызов обработчика возвращает `false` — записи в реестре нет.
- Причина: `buildActiveThreadCachePayload` (`useChatSessionPersistenceEffects.js`) кладёт в SWR-кэш ленты и неотправленные оптимистичные сообщения. При возврате `loadMessages` применяет кэш через `applyLatestThreadPayload` (`useChatThreadController.js:428`), и там `persistedClientIds` (строки 231–241) строится из `items` кэша — failed-сообщение считается сохранённым на сервере и удаляется из `failedThreadMessagesRef`. Пузырь остаётся из кэша, повторять нечего.
- Сделать:
  - в `applyLatestThreadPayload` считать «сохранёнными» только элементы без `isOptimistic`/`optimisticStatus`;
  - не класть оптимистичные сообщения в кэш ленты (их восстанавливает реестр);
  - тест на путь с попаданием в SWR-кэш: A→B→A → «Повторить» → ровно один запрос с исходным `client_message_id`, пузырь заменён серверным; то же для неотправленного альбома фото.

### Не выполнено по решениям

**А3-3. Стикеры из Telegram** — предзагрузка не начата, в журнале фазы 6 не упомянута. Проверка загрузки и проигрывания (WEBP/TGS/WEBM, кэш, медленная сеть) не выполнена.

### Некритичные замечания

- **R13. Геопозиция уходит сразу по клику в меню** (`useChatStructuredSend.js#sendLocationMessage`) — случайный клик раскрывает местоположение.
- **R14. Открытие беседы.** Сервер всегда открывает беседу внизу (`chat_thread_read_store.py:463`), кроме перехода к конкретному сообщению. На стенде при `viewer_last_read_message_id = null` клиент встаёт у начала ленты, и своя отправка не прокручивает вниз (d = 962 → 1004 px). Проверено на моках.
- **R15.** При росте поля ввода (длинный текст, 154 px) лента отходит от низа на ~110 px и не остаётся прижатой.
- **R16.** Звук hub-уведомлений (`MainLayout.jsx:~1471`, `/sounds/notification.mp3`) не играет — файла в `public/` нет (давняя ошибка).
- **R17.** Диалог отправки фото: «Отправить» стоит в одной группе с «Добавить»/«Отмена», а не справа (C8).
- **R18.** При открытой вкладке «ИИ» на вкладке «Чаты» нет счётчика непрочитанных.
- Мусор в рабочем дереве: `WEB-itinvent/frontend/%TEMP%/`, `WEB-itinvent/frontend/%TEMP%esbuild-check2/`, `WEB-itinvent/frontend/nul`. Происхождение не установлено (часть старше этого плана) — удалять после просмотра содержимого и с согласия пользователя.
- Mobile-hub: `folder_unread_counts` читается как `Record<string, number>`, новый ключ `ai` не ломает; «Личные» с сервера теперь согласованы со списком мобильного клиента.

### Решения пользователя (2026-09-30, по итогам проверки)

1. **Стикеры:** исполнитель предлагает 3–5 популярных наборов Telegram (ссылки `t.me/addstickers/...`) и **согласует список до импорта**.
2. **Стикер — мгновенный пузырь**, как у текста: появляется по клику, при ошибке ⚠ и «Повторить» с тем же `client_message_id`.
3. **Тихие часы — только для push.** Звук внутри портала управляется переключателем «Звук сообщений».
4. **Геопозиция — с подтверждением:** окно «Отправить мою геопозицию?» с координатами и точностью; «Отмена» ничего не отправляет.
5. **Открытие беседы с непрочитанными — на первом непрочитанном** (как в Telegram): разделитель «Непрочитанные сообщения», кнопка ↓ ведёт вниз; своя отправка **всегда** прокручивает вниз.
6. **Счётчик на вкладке «Чаты»** при открытой вкладке «ИИ» — показывать (без заглушённых).
7. **Mobile-hub** — отдельным этапом после выкатки веба (аудит и план — проверяющий).
8. **Звук hub-уведомлений** — использовать звук чата (`chatMessageSound`) с тем же переключателем.

### Пакеты фазы 8

| Пакет | Что | Основные файлы |
|---|---|---|
| M. Неотправленные | R12 | `useChatThreadController.js`, `useChatSessionPersistenceEffects.js`, `useChatComposerSending.js` + тесты |
| N. Стикеры | А3-3, мгновенный пузырь | `telegram_sticker_service.py`, `api/v1/chat/stickers.py`, `useChatStickerSending.js`, `chatOptimisticMessages.js`, `TelegramStickersTab.jsx`, `ChatStickerMedia.jsx` + тесты |
| O. Открытие и прокрутка | R14, R15 | `chat_thread_read_store.py` (режим `first_unread`), контроллер якоря и прокрутки ленты + тесты |
| P. Мелочи | R13, R16, R17, R18 | `useChatStructuredSend.js`/`ChatDialogs.jsx`, `MainLayout.jsx`, `ChatFileUploadPanel.jsx`, `ChatSidebarDesktopHeader.jsx`/`ChatSidebar.jsx` + тесты |

Приёмка (стенд проверяющего):
- R12: A→B→A → «Повторить» → один запрос, тот же `client_message_id`, пузырь заменён;
- стикеры: двойной клик — одно сообщение; пузырь сразу; WEBP/TGS/WEBM проигрываются; повторное открытие панели — из кэша браузера;
- беседа с 10 непрочитанными открывается на разделителе; своя отправка → расстояние до низа 0; беседа без непрочитанных — внизу;
- рост поля ввода не отрывает ленту от низа;
- геопозиция: «Отмена» — 0 запросов;
- бейдж «Чаты» виден на вкладке «ИИ».

## 17. Фаза 8 — пакеты M–P (исполнитель, 2026-09-30)

### M. Неотправленные сообщения (R12) — выполнено

- `useChatThreadController.js` — `applyLatestThreadPayload`: `persistedClientIds` собирается только из элементов без `isOptimistic`/`optimisticStatus` — грязный SWR-кэш больше не выбивает запись из `failedThreadMessagesRef`.
- `useChatSessionPersistenceEffects.js` — оптимистичные сообщения не попадают в кэш ленты (их восстанавливает реестр).
- Тесты `useChatThreadController.test.js` (реальный `useChatThreadController` + настоящий SWR-кэш): A→B→A → «Повторить» → ровно один запрос с исходным `client_message_id`, пузырь заменён серверным — для текста и для неотправленного альбома фото. **16/16 passed.**

### P. Мелочи (R13, R16, R17, R18) — выполнено

- R13: диалог подтверждения геопозиции (`ChatDialogs.jsx`, цепочка `useChatStructuredSend` → `buildChatPageDialogsLayerProps` → `useChatPageDialogsLayerProps`); «Отмена» — 0 запросов.
- R16: hub-уведомления используют `playChatMessageSound()` вместо несуществующего `/sounds/notification.mp3`; переключатель — `chat_sound` (`MainLayout.jsx` + тесты).
- R17: `ChatFileUploadPanel.jsx` — «Добавить» слева, «Отмена»+«Отправить» справа (`margin-left:auto`, primary).
- R18: бейдж «Чаты» при открытой «ИИ» — `chatsUnreadCount` из `folder_unread_counts` (все папки кроме `ai`/`archived`), desktop+mobile; локальный fallback исключает эффективно-заглушённые (`isConversationEffectivelyMuted`, с учётом `muted_until`).
- Тесты: `ChatDialogs`, `MainLayout`, `ChatFileUploadPanel`, `useChatSidebarDerivedState` — **107/107 passed.**

### O. Открытие и прокрутка (R14, R15) — выполнено

- Backend `chat_thread_read_store.py`: bootstrap без `focus_message_id` ищет первое непрочитанное входящее (`last_read_seq`, иначе `last_read_message_id`), окно вокруг якоря через существующую ветку «message»; payload: `initial_anchor_mode` (`first_unread`/`message`/`bottom`), `initial_anchor_message_id`, `has_newer`, `viewer_last_read_*`. Явный `focus_message_id` имеет приоритет.
- Frontend: `chatAnchorModel`/`useChatAnchorController` — `first_unread` → `first_unread_top` (отступ 14 px), без перебивания авто-прокруткой вниз; `null` last_read без непрочитанных → дно. Свои отправки (текст/файл/стикер/структурированные) — `scroll: true`.
- Тесты: backend `test_chat_thread_read_store.py` **8/8**; frontend anchor/scroll **103/103**.
- Разделитель «Непрочитанные сообщения» и кнопка ↓ — существующий UI потребляет `has_newer`/якорь; прочтение остаётся «только увиденного» (P1-3 без изменений).

### N. Стикеры (А3-3) — выполнено

- **Наборы утверждены пользователем** (все 5): `peach_goma` (WEBP, 53), `HotCherry` (TGS, 34), `DonutTheDog` (TGS, 31), `fullduck` (TGS, 120), `X264WebmPack` (WEBM, 34). Типы/счётчики проверены через `getStickerSet` (read-only).
- **Предзагрузка:** `_DEFAULT_STICKER_PACK_SHORT_NAMES` + `CHAT_DEFAULT_STICKER_PACKS` (env-переопределение, через запятую); `list_packs` вызывает `_ensure_default_packs` — ленивая установка кэшированных наборов каждому пользователю (файлы + маркер превью проверяются, членство создаётся один раз — идемпотентно, без миграции БД).
- **Поставка:** `python -m backend.scripts.seed_chat_sticker_packs --user-id 1` (`backend/scripts/seed_chat_sticker_packs.py`, флаг `--pack` для точечного импорта). Повторный запуск безопасен: `import_pack` выходит через `_add_cached_pack` при готовом кэше. На production **не запускался** — команда для релиза.
- **Мгновенный пузырь:** `buildOptimisticStickerMessage` (`chatOptimisticMessages.js`, kind `file` + attachment `media_kind: sticker`, реальные `width/height` — без прыжка высоты); `useChatStickerSending` применяет пузырь сразу (`scroll: true`), серверное сообщение заменяет по `replaceId` (`scroll: false`); ошибка → ⚠ через `registerFailedOutgoingMessage` с `stickerResend`; `retryFailedMessage` повторяет `sendSticker` с тем же `client_message_id`. В `TelegramStickersTab` стикерам добавлен `pack_short_name` (диалог набора, имя файла).
- **Форматы (код-проверка):** `ChatStickerMedia` — WEBP `<img lazy + onError>`, TGS `fetch→fflate→lottie` с AbortController и эмодзи-заглушкой при ошибке, WEBM `<video poster + onError>`; вне вьюпорта анимации ставятся на паузу (IntersectionObserver, `+240px`); вечных спиннеров нет. Сервер: `Cache-Control: private, max-age=31536000, immutable` на всех 4 endpoint'ах стикеров.
- Тесты: backend `test_chat_telegram_stickers.py` **24/24** (дефолтная установка, пропуск уже установленных, env-override); frontend **36/36** (`useChatStickerSending`, `useChatComposerSending` incl. стикер-retry, chain, `TelegramStickersTab`, `ChatStickerMedia`).

### Проверки фазы 8

- Полный набор frontend: `vitest run` по prescribed-списку — **144 файла / 1016 тестов, 0 падений** (база до фазы 8: 977).
- Backend затронутые: `test_chat_telegram_stickers.py` + `test_chat_thread_read_store.py` — **32/32** (`CHAT_DATABASE_URL` sqlite, `CHAT_REALTIME_TRANSPORT=local`).
- ESLint изменённых файлов — **0 errors** (warnings — baseline `no-unused-vars` на JSX-импортах).
- `git diff --check` — чисто по изменённым файлам (единственное trailing whitespace — чужой `POSTGRES_APP_SCHEMA_DDL.md`).

### Отклонения и открытые вопросы

- Разделитель «Непрочитанные сообщения» и кнопка ↓ — использован существующий UI, новых элементов не добавлялось; визуальная приёмка — на стенде.
- `_ensure_default_packs` применяет дефолты при первом открытии панели стикеров каждым пользователем; до сид-импорта наборов их просто нет в кэше — список пуст (без ошибок).
- Сид-скрипт требует `TELEGRAM_BOT_TOKEN` и существующего `user_id`; на тестовом контуре импорт не выполнялся (загрузка ~300 файлов с Telegram — оставлена на релиз/стенд).
- Runtime-приёмка пакетов M/N/O/P (реальный стенд, медленная сеть) — за проверяющим, т.к. требует живого контура.

## 18. Проверка фазы 8 (проверяющий, 2026-10-01)

**Итог:** фаза 8 не принята. R12, R13, R16–R18 и стикеры работают. Открытие на первом непрочитанном (R14) сделало недостижимыми самые свежие сообщения — блокирующие R19 и R20. Работы — **фаза 9**.

### Что проверено

- `npx vitest run` (чат, `src/components/layout`, `lib/*` из раздела 16) → **144 файла, 1103/1103**.
- `pytest -q tests/test_chat_telegram_stickers.py tests/test_chat_folder_unread.py tests/test_chat_presence_and_receipts_service.py tests/test_chat_files_and_notifications_service.py tests/test_chat_websocket_error_codes.py` → **94 passed**; `WEB-itinvent/backend/tests/test_chat_thread_read_store.py` → **8 passed** (sqlite, `CHAT_REALTIME_TRANSPORT=local`).
- Production-сборка во временный каталог — успешно.
- Стенд (production-сборка, моки API/WS):
  - R12: A→B→A → «Повторить» → один HTTP-запрос с исходным `client_message_id`, пузырь заменён серверным;
  - R13: окно «Отправить мою геопозицию?» с координатами и точностью; «Отмена» — 0 запросов;
  - R18: при открытой «ИИ» вкладка «Чаты» показывает счётчик;
  - стикер: пузырь через 300 мс, двойной клик — один запрос, высота 236 px до и после ответа сервера;
  - R14: беседа с 80 непрочитанными из 120 открывается на первом непрочитанном (вверху m41 с отступом, виден край m40).

### Блокирующее

**R19. Свежие сообщения недостижимы при открытии на первом непрочитанном.**
- Стенд: 120 сообщений, прочитано 40, bootstrap — окно m31..m64, `has_newer: true`. Прокрутка до конца окна останавливается на m64; запросов `after_message_id` нет; кнопки `chat-jump-to-latest` у низа нет. Сообщения m65..m120 не видны, пользователь считает m64 последним.
- Причина: более новые страницы грузятся только в `jumpToLatest` (`useChatThreadInteractionController.js:67`), по кнопке ↓. Догрузки вниз при прокрутке нет. Раньше окно с `has_newer` появлялось только при переходе к найденному сообщению, теперь — при каждом открытии беседы с непрочитанными.
- Сделать:
  - при `has_newer` и приближении к низу окна (порог как у догрузки истории вверх) грузить следующую страницу `after_message_id` последнего сообщения. Один запрос в полёте, без прыжка прокрутки (якорь — видимое сообщение);
  - пока `has_newer = true`, кнопка ↓ видна всегда (у низа окна тоже) и ведёт к самому свежему;
  - счётчик на кнопке ↓ — число непрочитанных ниже видимой области.

**R20. Ответ из середины истории создаёт дыру.**
- Стенд: окно m31..m64 (`has_newer`), своё сообщение → лента m53..m64, затем `srv-1`. Сообщения m65..m120 пропущены.
- Сделать: при своей отправке (текст, файл, стикер, опрос, контакт, геопозиция) и `has_newer = true` сначала загрузить последнее окно (как `jumpToLatest`), затем показать оптимистичный пузырь внизу. Прокрутка в самый низ.

### Некритичное

- **R21. Разделителя «Непрочитанные сообщения» нет** (решение 5 раздела 16). Показывать над первым непрочитанным при открытии. После прочтения разделитель не прыгает; при следующем открытии без непрочитанных его нет.
- **R22. Рост поля ввода отрывает ленту от низа.** Стенд: 8 строк в поле → расстояние до низа 111 px (R15 не исправлен). Если лента была прижата к низу, при изменении высоты поля ввода (набор, вставка, ответ/редактирование, панель эмодзи) она остаётся прижатой.
- **R23. Стандартные наборы стикеров нельзя удалить.** `_ensure_default_packs` вызывается в каждом `list_packs` и возвращает удалённый пользователем набор. Сделать: запоминать удаление стандартного набора и не устанавливать его повторно. Если без изменения схемы нельзя — предложить вариант (штатный Alembic или скрытие кнопки «Удалить» для стандартных наборов) и согласовать до реализации.
- **R24. Открытие беседы без отметки прочитанного.** `_find_first_unread_message` (`service.py:3538`) при `last_read_seq = 0` и пустом `last_read_message_id` возвращает самое первое чужое сообщение за всю историю. Пользователь, добавленный в старую группу, откроет её с начала. Сделать: режим `first_unread` только при `unread_count > 0` в состоянии пользователя и известной границе прочтения; иначе `bottom`.
- **R25. Тест не попадёт в репозиторий.** `WEB-itinvent/backend/tests/test_chat_thread_read_store.py` игнорируется `.gitignore:221` (`test_*.py`), в git из этой папки отслеживается только `__init__.py`. Перенести новые кейсы в корневой `tests/` (например, `tests/test_chat_thread_bootstrap_anchor.py`).

### Мусор в рабочем дереве (решение пользователя ожидается)

Не относятся к чату и сборке:
- `WEB-itinvent/frontend/%TEMP%/` (84 КБ) и `WEB-itinvent/frontend/%TEMP%esbuild-check2/` (100 КБ) — результаты пробной esbuild-сборки компонентов раздела базы и QR-этикеток (25–30.09);
- `WEB-itinvent/frontend/nul` (150 байт) — вывод ошибок неудачной команды `findstr`.

Удаляются только после явного согласия пользователя. Исполнитель их не трогает.

### Пакеты фазы 9

| Пакет | Что | Основные файлы |
|---|---|---|
| Q. Окно ленты | R19, R20, R21 | `useChatThreadController.js`, `useChatThreadInteractionController.js`, `useChatAnchorController`/`chatAnchorModel`, `ChatThread.jsx`/`ChatMessageList.jsx`, отправка в `useChatComposerSending.js`, `useChatFileSending.js`, `useChatStickerSending.js`, `useChatStructuredSend.js` + тесты |
| R. Поле ввода | R22 | контроллер прокрутки ленты, `ChatComposer.jsx` + тесты |
| S. Backend | R23, R24, R25 | `telegram_sticker_service.py`, `service.py#_find_first_unread_message`, `chat_thread_read_store.py`, корневой `tests/` |

Приёмка (стенд проверяющего):
- 120 сообщений, прочитано 40: открытие на первом непрочитанном с разделителем; прокрутка вниз догружает m65..m120 без прыжков; ↓ видна до конца окна и ведёт к m120;
- ответ из середины: лента m…m120, затем своё сообщение внизу, без дыры;
- 8 строк в поле ввода — расстояние до низа 0;
- удалённый стандартный набор не возвращается после повторного открытия панели;
- беседа без отметки прочитанного и без непрочитанных открывается внизу.

## 19. Этапы после фазы 9 (проверяющий, 2026-10-01)

1. **Выкатка одним релизом** — план готовит проверяющий после приёмки фазы 9:
   - сборка frontend;
   - `scripts/pm2/restart-chat.ps1` / `restart-backend.ps1` (последний перезапускает и scan);
   - импорт стикеров `python -m backend.scripts.seed_chat_sticker_packs --user-id <id>`;
   - переключение `APP_ENV=production` с проверками из раздела А4;
   - откат и post-check.

   Выполнение только после явного «да» пользователя.
2. **Нагрузочный тест** (после выкатки, на изолированной копии, не на production). Нужна тестовая база PostgreSQL от пользователя.
   - Сценарии: 300 / 600 / 1000 одновременных WS-клиентов, отправка и чтение.
   - Метрики (p50/p95/p99): ACK отправки, доставка собеседнику, открытие беседы; ошибки; CPU и память узлов chat-a/chat-b; event-loop lag; задержка relay PostgreSQL LISTEN/NOTIFY; нагрузка на БД.
   - Целевые значения (p95):
     - ACK отправки — до 0,3 с;
     - доставка — до 0,5 с;
     - открытие беседы из кэша — мгновенно, без кэша — до 0,5 с;
     - прокрутка — без длинных задач > 50 мс.
   - Итог: предельное число пользователей и узкое место.
3. **Аудит mobile-hub** — отдельным этапом (решение 7 раздела 16).

## 20. Фаза 9 — пакеты Q–S (исполнитель, 2026-10-01)

### Пакет Q — окно ленты (R19, R20, R21)

Статус: реализовано.

- **R19. Догрузка вниз.** `useChatThreadController.loadNewerMessages()`: silent-запрос `after_message_id` последнего персистентного сообщения через `buildActiveThreadPollLoadOptions`, dedup `loadingNewerRef`. `useChatThreadViewport`: при приближении к низу окна с `has_newer` вызывает `onApproachBottom`; кнопка ↓ видна всегда, пока `messagesHasNewer` true; `jumpToLatest()` драинит новые страницы до конца перед скроллом. Счётчик ↓ в `ChatThread`: загруженные непрочитанные после замороженного якоря + хвост `unread_count` за пределами окна. Append не двигает прокрутку (content RO идёт через якорь-компенсацию).
- **R20. Своя отправка из середины.** `ensureLatestThreadWindow()` в `useChatThreadInteractionController` драинит новые страницы (до 12 итераций), вызывается до создания оптимистичного пузыря во всех шести путях: текст и повтор (`useChatComposerSending`), файлы и голосовые (`useChatFileSending`), стикеры (`useChatStickerSending`), опрос/контакт/геопозиция (`useChatStructuredSend`). Проброшено через `useChatPageComposerStack` → `useChatUploadsController` → `ChatPageContent` → `pickChatPageLayoutSections`/`buildChatPagePanesBags`/`useChatThreadSection`.
- **R21. Липкий разделитель.** `getUnreadAnchorId()` резолвится один раз на беседу в `ChatThread` (только когда список принадлежит активной беседе), хранится в ref; `ChatMessageList` передаёт замороженный якорь в `buildTimelineItems(items, lastReadId, unreadAnchorIdOverride)` — продвижение границы прочтения позицию разделителя не пересчитывает. Без границы прочтения разделителя нет; при следующем открытии без непрочитанных его нет (якорь пересчитывается на открытии).

Файлы: `useChatThreadController.js`, `useChatThreadInteractionController.js`, `useChatThreadViewport.js`, `useChatPageComposerStack.js`, `useChatUploadsController.js`, `useChatComposerSending.js`, `useChatFileSending.js`, `useChatStickerSending.js`, `useChatStructuredSend.js`, `ChatPageContent.jsx`, `pickChatPageLayoutSections.js`, `buildChatPagePanesBags.js`, `useChatThreadSection.jsx`, `ChatThread.jsx`, `ChatMessageList.jsx`, `chatHelpers.js`.

Тесты: `useChatThreadViewport.test.js` (новый, 5), `useChatThreadController.test.js` (+3), `useChatThreadInteractionController.test.js` (+3), `useChatComposerSending.test.jsx` (+1, тайминги доработаны), `chatHelpers.test.js` (+1), `ChatThread.test.jsx` (+2). Узкий прогон: 6 файлов / 157 тестов — 0 падений.

### Пакет R — поле ввода (R22)

Статус: реализовано.

- Причина на стенде: ResizeObserver дока композера вешался один раз на `composerDockRef.current` — при ремаунте дока (selection dock ⇄ composer bridge ⇄ ChatComposer) наблюдатель оставался на отсоединённом узле, `composerHeight` замирала и прижатие не восстанавливалось.
- Исправление: `composerDockCallbackRef` + состояние `composerDockNode` — callback-ref синхронизирует `.current` и перевешивает эффект наблюдателя на новый узел. Прижатие работает через `schedulePinnedBottomScroll` только когда `threadPinnedToBottomRef` (пользователь у низа); отпущенную ленту рост поля не тянет.
- Тест `ChatThread.test.jsx`: ремаунт дока через смену реализации композера → новый узел снова под наблюдением → рост высоты дожимает до низа; читатель выше низа не сдвигается.

Файлы: `ChatThread.jsx`, `ChatThread.test.jsx`.

### Пакет S — backend (R23, R24, R25)

Статус: реализовано (R23 — по согласованному варианту «скрыть удаление», без миграции).

- **R23.** `remove_pack` отклоняет удаление стандартного набора: `ValueError` → HTTP 400 «Стандартный набор стикеров нельзя удалить», строка членства не удаляется. Кнопки «Удалить» для наборов в UI нет — скрывать нечего; отказ на backend закрывает переустановку `_ensure_default_packs` и для API-вызовов. Миграция не потребовалась.
- **R24.** `get_thread_bootstrap` вызывает `_find_first_unread_message` только при `unread_count > 0` и известной границе (`last_read_seq > 0` или непустой `last_read_message_id`), иначе `bottom`. Сам `_find_first_unread_message` без `seq` теперь требует, чтобы граница разрешалась в сообщение этой беседы — висячий `last_read_message_id` больше не открывает первое чужое сообщение за всю историю.
- **R25.** Кейсы перенесены из `WEB-itinvent/backend/tests/test_chat_thread_read_store.py` (gitignored) в `tests/test_chat_thread_bootstrap_anchor.py` (12 кейсов: перенос + R24 — ноль непрочитанных с границей, непрочитанные без границы, отсутствие viewer_state, граница только по `last_read_message_id`, приоритет focus). Старая копия удалена.

Файлы: `chat/telegram_sticker_service.py`, `chat/chat_thread_read_store.py`, `chat/service.py`, `tests/test_chat_thread_bootstrap_anchor.py`, `tests/test_chat_telegram_stickers.py`.

Тесты: `pytest -q tests/test_chat_thread_bootstrap_anchor.py tests/test_chat_telegram_stickers.py` → **38 passed** (sqlite, `CHAT_REALTIME_TRANSPORT=local`).

### Итоговые проверки фазы 9

- Frontend полный набор: `npx vitest run src/lib/chatSocket.test.js src/lib/chat src/lib/chatMessageSound.test.js src/lib/chatSocketNotificationPlan.test.js src/lib/layoutPushDecisions.test.js src/lib/notificationPreferences.test.js src/pages/chat src/components/chat src/components/layout src/pages/Chat.test.jsx src/pages/Chat.performance.test.jsx` → **154 файла / 1120 тестов — 0 падений**.
- Backend: **38/38** (см. выше).
- ESLint изменённых frontend-файлов: **0 errors** (warnings — прежние unused-vars в тестовых файлах).
- `git diff --check`: единственное замечание — trailing whitespace в `POSTGRES_APP_SCHEMA_DDL.md:3`, это Markdown-перевод строки в автообновляемом DDL-снапшоте, к чату не относится, не трогал.

### Отклонения и открытые вопросы

- R23 реализован вариантом «стандартные наборы нельзя удалить» (выбор пользователя): tombstone-миграции нет. Если позже понадобится снятие стандартного набора — вернуться к варианту с Alembic (`chat_user_dismissed_sticker_packs`).
- Runtime-приёмка на стенде (120 сообщений/40 прочитано, ответ из середины, 8 строк в поле ввода, повторное открытие панели) — за проверяющим, по списку раздела 18.

## 21. Проверка фазы 9 (проверяющий, 2026-10-01)

**Итог:** фаза 9 не принята — блокирующие R26 и R27.

### Что проверено

- `npx vitest run` (полный набор раздела 18) → **154 файла, 1120/1120**.
- `pytest -q tests/test_chat_thread_bootstrap_anchor.py tests/test_chat_telegram_stickers.py tests/test_chat_folder_unread.py tests/test_chat_presence_and_receipts_service.py tests/test_chat_files_and_notifications_service.py tests/test_chat_websocket_error_codes.py` → **108 passed**. Новый тест лежит в корневом `tests/` и отслеживается git.
- Production-сборка — успешно.
- Стенд, работает:
  - открытие на первом непрочитанном с разделителем «Непрочитанные сообщения»;
  - прокрутка вниз догружает m65..m120 без пропусков;
  - 8 строк в поле ввода — расстояние до низа 0;
  - стикер, геопозиция, R12, R18 — как в разделе 18.

### Блокирующее

**R26. Ответ из середины истории не виден.**
- Стенд: окно m31..m64, своё сообщение → история догружена без дыры (m31..m120 + своё). Но лента остаётся на первом непрочитанном: расстояние до низа 3500 px в течение 6 с. Кнопка ↓ исчезает через ~0,6 с.
- Сделать: после `ensureLatestThreadWindow` прокрутить в самый низ (как `jumpToLatest`). Видимость кнопки ↓ пересчитывать по фактической позиции.

**R27. Потеря сообщений, если живое сообщение пришло в частичное окно.**
- Стенд: окно m31..m64 (`has_newer`), по сокету приходит m121 и вставляется в конец окна. Догрузка вниз: `after c1-m64` (m65..m114), затем `after c1-m121`. Сообщения m115..m120 не загружаются никогда (85 вместо 91, одна дыра).
- Причина: `buildActiveThreadPollLoadOptions` берёт курсор от последнего сообщения в списке, включая вставленное из сокета.
- Сделать:
  - пока `has_newer = true`, сообщения из сокета для активной беседы в ленту не вставлять, а увеличивать счётчик на ↓ и обновлять превью беседы;
  - курсор догрузки — последнее сообщение непрерывного окна;
  - тест: живое сообщение при частичном окне → после догрузки без пропусков.

### Некритичное

- **R28.** При своей отправке из середины уходит 5 одинаковых запросов `after c1-m114` подряд: цикл `drainNewerThreadPages` не ждёт обновления `messagesRef`/`messagesHasNewerRef`. Брать курсор и `has_newer` из ответа запроса, а не из ref.
- **Предложение (как в Telegram):** при отправке из середины и по ↓ загружать последнее окно одним запросом `thread-bootstrap` без якоря и заменять им частичное окно, а не листать страницами (сейчас до 12 запросов до показа пузыря).

## 22. ИИ-чат: «не активен и бесконечно крутит» (проверяющий, 2026-10-01, только чтение)

Со слов пользователя: после выхода из ИИ-чата и возврата чат не активен и бесконечно показывает загрузку.

### Что проверено

- **Стенд** (моки API/WS): вопрос → переход в обычный чат → ответ ИИ по сокету → возврат. Ответ на месте, одна загрузка `thread-bootstrap`. Без сервера поломка не воспроизводится — причина в данных или на сервере.
- **Логи production** (`~/.pm2/logs`, только чтение) и **БД** (сессия с `default_transaction_read_only=on`, только SELECT):
  - `app.ai_bot_runs`: 340 запусков с апреля, последний — **22.09**. 332 completed (5–20 с), 7 failed, **1 в статусе `running` с 13.05** — зависший запуск;
  - failed 15.09: `RouterAI 402 — Недостаточно средств на балансе`;
  - `app.ai_bots.updated_at` у `opencode` и `general-ai` — текущая минута: записи переписываются постоянно.

### Находки

| ID | Приоритет | Проблема |
|---|---|---|
| AI1 | P1 | `AiChatService.initialize_runtime()` вызывается в `list_bots`, `open_bot_conversation`, `create_bot_conversation`, `list_recent_runs`, **`_process_single_run`** (каждый тик воркера) и `_get_runtime_by_conversation`. Каждый вызов — 5 bootstrap-функций с UPDATE `ai_bots` (`ensure_opencode_bot` ставит `updated_at = now`) и INFO-логом |
| AI2 | P1 | Следствия AI1: лог `itinvent-ai-chat-worker-error.log` — **308 МБ** (~156 тыс. строк `ensure_opencode_bot` на 20 МБ); медленные UPDATE `ai_bots` до 2 с; `QueuePool limit of size 1 overflow 0 reached, timeout 30` — воркер ждёт соединение до 30 с |
| AI3 | P1 | Зависший запуск в статусе `running` с 13.05. Нет watchdog: запуск, оборванный рестартом воркера, остаётся `running` навсегда, а беседа показывает «думает» бесконечно |
| AI4 | P2 | Ошибки провайдера (402 «недостаточно средств», таймауты): пользователь должен видеть понятное сообщение и «Повторить», а не вечную загрузку |
| AI5 | P2 | Во фронтенде нет предела ожидания. Если статус `queued/running` не меняется N минут (по `updated_at`), показывать «ИИ не отвечает» с «Повторить» / «Остановить» |
| AI6 | P3 | Воркер пишет `Using unified local store database at …\data\local_store.unified.db` — SQLite-хранилище при `APP_ENV=development` (см. А4). Проверить, что ИИ-воркер не держит состояние в локальном SQLite |
| AI7 | P2 | `GET /chat/conversations` на production регулярно отвечает 1,0–2,5 с (в пиках 30.09 — 8,8 с и 31,7 с с кодом 500). Это главный источник «медленного» открытия чата |

### Сделать (фаза 10, пакет T)

- AI1: bootstrap ботов — один раз при старте процесса и по явному изменению настроек, не в каждом запросе и тике воркера. UPDATE — только при фактическом изменении полей, INFO-лог — только при изменении.
- AI3: watchdog — запуски `queued/running` без обновления дольше порога переводить в `failed` («прерван») с событием `chat.ai.run.updated`. Feature flag, dry-run, батчи. На production — только после согласия пользователя (это DML).
- AI4/AI5: понятные ошибки и предел ожидания в интерфейсе.
- AI7: профилировать `GET /chat/conversations` (число запросов, план) на тестовой БД; цель p95 < 300 мс.
- Нужно от пользователя: скриншот «крутящегося» ИИ-чата и примерное время, чтобы сверить с логами.

## 23. Дизайн «как Telegram» (проверяющий, 2026-10-01)

### Решения пользователя

1. **Компьютер — как Telegram Web A, на весь экран.** На странице чата меню портала сворачивается в узкую полосу иконок, баннер «Открыть в HUB Desktop» убирается. Две колонки без внешних отступов и карточек.
2. **Телефон — как Telegram для Android.** Светлая и тёмная темы — как в Telegram.
3. **ИИ — отдельное пространство в стиле ChatGPT** (вкладка «ИИ», как сейчас): «Новый чат», история диалогов. Общение с людьми и ИИ разделены.

**Граница копирования:** повторяем раскладку, размеры, поведение и анимации. Не используем логотип и название Telegram, их иконки-ассеты и фирменный узор фона — свои иконки (MUI) и свой узор или градиент.

### Как сейчас (стенд, desktop 1440×900)

- Чат — карточка внутри портала: слева меню портала (~215 px), сверху баннер «Открыть в HUB Desktop». Полезная ширина переписки ~880 px из 1440.
- Список бесед: мелкие аватары, сплошная синяя заливка выбранной строки, «Сообщений пока нет» в превью, вкладки папок в виде «таблеток».
- Шапка беседы: статус мелким шрифтом 11 px («Не в сети»), нет «был(а) недавно».
- Лента растянута на всю ширину колонки (в Telegram — центрированная колонка). Под полем ввода служебная подсказка «Enter — отправить · Shift+Enter — новая строка».
- Панель эмодзи открывается справа и сжимает переписку (в Telegram — всплывающее окно над полем ввода).
- ИИ: кнопка «Новый чат», группы «Мои чаты / Сегодня», но ответы — обычные пузыри. Нет вида ChatGPT: центрированного текста ответа, крупного поля ввода, кнопок под ответом.

### Эталон (ориентир; точные значения сверить по эталонным скриншотам)

**Desktop, левая колонка (список):**
- Ширина 420 px (перетаскиваемая, 300–520), фон белый, без рамок.
- Сверху: кнопка меню ☰ и поиск-«пилюля» высотой 42 px (фон `#f4f4f5`, радиус 22 px).
- Папки: горизонтальные вкладки, текст 15 px/500; активная — синяя с полосой 3 px снизу; счётчики внутри вкладок.
- Строка беседы:
  - высота 72 px, аватар 54 px (круг, цвет по id, инициалы);
  - имя 16 px/500, время 12 px справа;
  - превью 15 px серым (`#707579`) в одну строку, «Вы:» или имя автора в группах, галочки у своих.
- Счётчик: круг 22 px, синий `#3390ec` (у заглушённых — серый `#c4c9cc`), «@» для упоминаний.
- Выбранная строка — синяя `#3390ec` с белым текстом; при наведении — `#f4f4f5`.
- Плавающая кнопка «карандаш» (новое сообщение) внизу справа колонки.

**Desktop, переписка:**
- Шапка 56 px: аватар 40 px, имя 16 px/500, статус 14 px («в сети» синим, «был(а) недавно», «печатает…»), справа поиск и меню.
- Лента — центрированная колонка шириной до 728 px.
- Пузыри:
  - шрифт 16 px, межстрочный 1,31;
  - радиус 15 px (6 px на «склеенной» стороне в серии), хвост у последнего пузыря серии;
  - входящие белые, свои `#eeffde`;
  - время 12 px внутри пузыря справа снизу, галочки зелёные `#4fae4e`;
  - в группах имя автора цветом по пользователю (7 цветов), аватар 34 px у последнего пузыря серии.
- Чип даты по центру, «липкий» при прокрутке. Разделитель непрочитанных — полоса на всю ширину.
- Альбомы — сетка с зазором 2 px внутри одного пузыря. Просмотр медиа — тёмный, на весь экран, с листанием и масштабом.
- Действия с сообщением — контекстное меню по правому клику (на телефоне — по долгому нажатию) со строкой реакций сверху. Постоянной панели кнопок при наведении нет.
- Поле ввода:
  - белая плашка той же ширины, что лента (до 728 px), радиус 12 px, с хвостиком;
  - слева эмодзи, справа скрепка;
  - снаружи справа круглая синяя кнопка 54 px «микрофон/отправить»;
  - без текстовой подсказки под полем.
- Эмодзи и стикеры — всплывающая панель над полем ввода (не боковая), открывается по наведению или клику.
- Кнопка ↓ — белый круг 54 px со счётчиком непрочитанных.
- Фон — свой мягкий градиент с собственным узором.

**Тёмная тема (как в Telegram Web A):** фон колонок `#212121`, лента — тёмный градиент, входящие пузыри `#212121`, свои — фиолетовые `#8774e1`, текст `#fff`, вторичный текст `#aaaaaa`.

**Телефон (как Telegram Android):**
- Список: верхняя панель с ☰, заголовком и поиском; папки — вкладки под панелью; строки 72 px; плавающая кнопка «карандаш».
- Беседа: на весь экран (нижнее меню портала скрыто — уже решено); шапка с «назад», аватаром, именем и статусом.
- Жесты: свайп вправо по сообщению — ответ; долгое нажатие — меню с реакциями; свайп от левого края — назад.
- Поле ввода внизу во всю ширину, кнопка микрофона/отправки.

**ИИ (стиль ChatGPT):**
- Левая колонка (в той же раскладке):
  - сверху «Новый чат», ниже поиск;
  - история диалогов по группам «Сегодня / Вчера / 7 дней / Ранее»;
  - переименование и удаление диалога.
- Выбор ассистента — выпадающий список в шапке диалога («ИИ-помощник ▾»), а не отдельная беседа на каждого бота.
- Диалог — центрированная колонка до 768 px:
  - сообщения пользователя — светло-серые пузыри справа;
  - ответы ИИ — без пузыря, текст на всю ширину колонки с Markdown (заголовки, списки, таблицы, код с подсветкой и кнопкой «Копировать»);
  - под ответом: «Копировать», «Повторить ответ», 👍/👎.
- Во время ответа: индикатор «Думает…» или текущий этап, кнопка «Остановить» вместо «Отправить». Ошибки — понятным текстом с «Повторить» (AI4/AI5).
- Пустой диалог: приветствие ассистента и 3–4 подсказки-кнопки.
- Поле ввода — крупное, по центру, многострочное, с вложениями.

### Что нужно от пользователя

- 6–8 эталонных скриншотов: Telegram Web A (список, группа, личный чат; светлая и тёмная тема) и Telegram Android (список, беседа, меню сообщения). По ним исполнитель сверяет размеры и цвета.

### Пакеты фазы Д (после фазы 10)

| Пакет | Что |
|---|---|
| Д1. Каркас | Полноэкранная раскладка страницы чата (свёрнутое меню портала, без баннера), перетаскиваемая ширина колонки, токены темы Telegram (светлая/тёмная) |
| Д2. Список | Строки 72 px, аватары 54 px, вкладки папок, поиск, счётчики, «карандаш», контекстное меню беседы |
| Д3. Переписка | Шапка, центрированная лента, пузыри с хвостами и сериями, чипы дат, разделитель, альбомы, кнопка ↓ |
| Д4. Ввод | Поле ввода с хвостом, круглая кнопка отправки/микрофона, всплывающая панель эмодзи и стикеров, без подсказки |
| Д5. Меню сообщений | Правый клик / долгое нажатие с реакциями, свайп-ответ на телефоне, просмотрщик медиа |
| Д6. Телефон | Раскладка Android: панели, жесты, плавающая кнопка |
| Д7. ИИ | Пространство в стиле ChatGPT: история, выбор ассистента, ответы без пузырей с Markdown, «Остановить», подсказки |

Приёмка каждого пакета — скриншоты стенда рядом с эталоном (светлая и тёмная тема, desktop и телефон). Без регрессий в тестах и плавности: длинных задач > 50 мс при прокрутке — 0, сдвигов ленты — 0.

## 24. ИИ-чат: причина «не активен и крутит» и аудит отображения (проверяющий, 2026-10-01)

### AI8 (P0). Строка ИИ-диалога навсегда выключена и крутит — причина найдена

- Скриншот пользователя: строка «какую документацию ты вид…», 22.09, подпись «HUB Ассистент», блёклая, с индикатором загрузки, не открывается.
- Причина: `ChatSidebarRows.jsx#AiConversationRow` (и строка бота, ~строка 609):
  `const opening = String(openingAiBotId || '').trim() === String(bot?.id || '').trim();`
  Когда ИИ-беседа не сопоставлена с ботом (`buildAiSidebarRows` в `chatAiModel.js` не нашёл беседу в `conversation_ids` бота — бот выключен, удалён или беседа не попала в список), у строки нет `id`. В покое `openingAiBotId = ''`, поэтому `'' === ''` → `opening = true` → `disabled` (прозрачность 0,6) + `CircularProgress`. Подпись «HUB Ассистент» — значение по умолчанию при `bot = null`, как на скриншоте.
- Стенд: боты без связи с беседой → строка `disabled: true`, индикатор есть — воспроизведено.
- Сделать:
  - `opening` — только при непустом `openingAiBotId` и совпадении с непустым id;
  - для строк ИИ-бесед признак «открывается» вести по id беседы, а не бота;
  - сопоставление беседы с ботом — по полю беседы от сервера (`ai_bot_id`/`bot_id` в элементе `GET /chat/conversations`; если поля нет — добавить), а не по списку `conversation_ids` бота;
  - тесты: беседа без бота открывается, строка не `disabled`, индикатора нет.
- Решение пользователя: **старые ИИ-диалоги открываются и продолжаются.** Если их бот выключен или удалён, новые сообщения обрабатывает основной ассистент с историей диалога; в шапке показан текущий ассистент.

### Аудит отображения ИИ-чата (стенд: desktop 1440×900 и телефон 390×844, светлая тема)

Стенд: беседа с ответом в Markdown (заголовок, таблица, нумерованный список, блок кода), источниками, карточкой перемещения ITinvent, выбором формата отчёта, сгенерированным XLSX и статусом `running` с этапами и `partial_text`.

| ID | Приоритет | Что не так |
|---|---|---|
| AI9 | P1 | Статус выполнения — плашка над лентой (`AiRunStatusBanner`): закрывает сообщения и кнопки карточки, на телефоне занимает ~100 px. Служебный текст «Внутренние рассуждения модели не показываются» виден пользователю. Частичный ответ (`partial_text`) печатается в плашке, а не на месте ответа. «Остановить» продублирован (в плашке и в кнопке отправки), этап продублирован в подзаголовке шапки |
| AI10 | P1 | Markdown: `##` отображается обычным текстом без стиля заголовка; у нумерованного списка пропали номера; у блока кода нет языка, подсветки и кнопки «Копировать» |
| AI11 | P1 | Ответы ИИ — пузыри с оранжевой подписью «ИИ-помощник» над каждым, как в группе. По решению пользователя нужен вид ChatGPT (раздел 23) |
| AI12 | P2 | Источники — серая строка «Источники: … · …», не кликабельны |
| AI13 | P2 | Карточки действий вложены в пузырь (рамка в рамке). У перемещения 4 равноправные кнопки («Подтвердить / Изменить / Открыть / Отменить»). Выбор формата — 4 крупные синие кнопки, на телефоне переносятся в 2 ряда. У строки оборудования видно только «100234» без модели |
| AI14 | P2 | Сгенерированный файл: карточка файла, затем «Сохранить в Мои файлы», затем текст ответа под файлом — порядок обратный ожидаемому |
| AI15 | P3 | На телефоне сверху постоянно виден баннер «Открыть в HUB Desktop» (~70 px) — и в ИИ, и в обычном чате |
| AI16 | — | Тёмная тема ИИ-чата на стенде не проверена (переключатель темы в моках не сработал) — проверить при приёмке |

### Решения пользователя по ИИ (2026-10-01)

1. **Шаги ИИ — как в ChatGPT, в ленте.** На месте будущего ответа — строка текущего шага («Ищу в ITinvent…») с анимацией, затем текст ответа печатается постепенно (из `partial_text`). После ответа — свёрнутая строка «Выполнено 3 шага · 12 с ▸», которая раскрывается списком использованных инструментов (понятные названия из `AI_STAGE_LABELS`, без внутренних рассуждений). Верхняя плашка убирается. «Остановить» — только на месте кнопки отправки.
2. **Действия с подтверждением — карточка под ответом:**
   - отдельная карточка в ленте (не внутри пузыря): заголовок, что изменится (объект, получатель), предупреждения;
   - две кнопки «Подтвердить» / «Отменить», остальное («Изменить», «Открыть») — в меню «…»;
   - после выполнения — статус и ссылка на результат.
   Выбор формата отчёта — компактные кнопки-«чипы» в одну строку с переносом.
3. **Подсказки на пустом экране** — документы и база знаний, отчёты, почта и задачи. Например: «Найди в регламентах…», «Сделай отчёт по оборудованию в Excel», «Подготовь письмо…», «Создай задачу…».
4. **Старые диалоги — открываются и продолжаются** (см. AI8).

### Пакет Д7 (ИИ) — дополнение к разделу 23

- AI8 — **сразу**, вне очереди дизайна (в фазе 10 вместе с пакетом T).
- AI9–AI14 — по решениям выше и эталону раздела 23 «ИИ (стиль ChatGPT)»:
  - Markdown-рендер ответов: заголовки, нумерованные/маркированные списки, таблицы с прокруткой, код с языком, подсветкой и «Копировать»;
  - источники — кликабельные «чипы» под ответом (открыть документ/карточку), не больше 6, остальное «ещё N»;
  - файл ответа — текст ответа сверху, затем карточка файла с кнопками «Открыть» / «Скачать» / «В Мои файлы»;
  - под ответом: «Копировать», «Повторить ответ», 👍/👎.
- Приёмка: скриншоты стенда (desktop/телефон, светлая/тёмная) по сценарию выше рядом с эталоном ChatGPT; статус не перекрывает ленту; Markdown-тест на заголовки, списки, таблицы, код.

## 25. ИИ-агенты: права и единый ассистент (проверяющий, 2026-10-01)

### Как сейчас (код + production, только чтение)

**Боты в `app.ai_bots`:**

| slug | Название | Состояние | Инструменты | Диалоги |
|---|---|---|---|---|
| `general-ai` | AI | вкл., скрыт, для всех | 3 (файлы) | 6 польз. / 12 |
| `corp-assistant` | HUB Ассистент | вкл., модель `google/gemini-3.1-flash-lite` | **66**: ITinvent (поиск и действия, в т. ч. перемещения), почта, задачи, AD, сеть, МФУ, компьютеры | **28 польз.** / 29 |
| `document-converter` | Документы | вкл. | 3 (файлы) | 9 / 9 |
| `opencode` | OpenCode | вкл., `chat.ai.sandbox` | — (песочница) | 3 / 3 |
| `it-helper` | IT-помощник | выкл. | 0 | 1 / 1 |
| `new-ai-bot` | Новый AI бот | выкл. | 22 | 1 / 1 |

**Доступ** (`ai_chat/access.py#can_use_bot`):
- админ — ко всем ботам; `general-ai` — всем; остальные — по строке `app.ai_bot_access`;
- в `ai_bot_access` сейчас **только 2 строки, обе для `opencode`** (1 допуск). Значит, `corp-assistant` доступен только 2 администраторам, хотя с ним переписывались 28 человек. Остальные видят «Доступ к агенту не предоставлен» либо выключенную строку с индикатором (AI8).

**Проблемы:**

| ID | Приоритет | Проблема |
|---|---|---|
| AG1 | P1 | `required_permission` бота хранится, но в `can_use_bot` не проверяется (кроме OpenCode в `ai_sandbox/app_service.py`) |
| AG2 | P1 | Инструменты чтения ITinvent (`itinvent.*`), AD (`ad.user.password_status`, `ad.user.groups`, `ad.user.logon_history`, `ad.*expiring_soon`), сети (`network.*`) и компьютеров (`itinvent.user.computer`, `itinvent.computers.*`) **не проверяют права сотрудника**. `AiToolRegistry.execute` проверяет только «включён у бота» и `admin_only`. Кому выдан бот, тот через него читает данные, к которым в портале доступа нет |
| AG3 | OK | Почта, задачи, МФУ (`office.*`, `mfu.*`) и подтверждение действий (`action_cards.py`: перемещение — `database.write`, письмо — `mail.access`, задачи — `tasks.*`) права сотрудника проверяют — так и оставить |
| AG4 | P2 | 66 инструментов в каждом запросе к модели — дорого и снижает точность выбора инструмента, особенно у лёгкой модели |
| AG5 | P2 | Несколько ботов с пересекающимися возможностями (`AI`, `Документы`, `HUB Ассистент`, выключенные `IT-помощник`, `Новый AI бот`) — пользователю непонятно, кого спрашивать |

### Решения пользователя (2026-10-01)

1. **Один ассистент «HUB Ассистент» для всех + OpenCode отдельно.** Каждому сотруднику доступны только инструменты, на которые у него есть права в портале.
2. **Правило: не больше прав сотрудника.** Бот видит и делает только то, что сотрудник может сам в портале.
3. **AD и сеть — только ИТ.** Только при наличии соответствующих прав портала.
4. **OpenCode — по личному допуску** (как сейчас) плюс право `chat.ai.sandbox`.
5. **Модель — сравнить на тестах:** 20–30 типовых вопросов, 2–3 модели, таблица «качество / скорость / цена». Выбор за пользователем.
6. **Старых ботов влить в одного:** возможности `AI` и `Документы` (файлы, отчёты, конвертация) входят в «HUB Ассистент». Боты `general-ai`, `document-converter`, `it-helper`, `new-ai-bot` выключаются. Их диалоги открываются и продолжаются с «HUB Ассистентом» (решение раздела 24).

### Права инструментов (используем существующие права портала, новые не нужны)

| Группа инструментов | Нужное право сотрудника |
|---|---|
| `ai.files.*` (создание файлов, отчёты, конвертация) | `chat.ai.use` |
| `kb.*` (база знаний) | `kb.read` |
| `itinvent.*` чтение (поиск, карточки, справочники, история, акты, аналитика) | `database.read` |
| `itinvent.action.*` (черновики перемещения, статуса, места, расходников, работ) | `database.write` (и при черновике, и при подтверждении) |
| `itinvent.equipment.search_multi_db` | админ (как сейчас) |
| `itinvent.user.computer`, `itinvent.computers.*`, `itinvent.equipment.online_status` | `computers.read` |
| `office.mail.*`, `office.action.mail_*` | `mail.access` (как сейчас) |
| `office.tasks.*`, `office.action.task_*` | `tasks.read` / `tasks.create` / `tasks.write` (как сейчас) |
| `office.announcements.*`, `office.workday.summary` | `announcements.read` / `tasks.read` |
| `mfu.*` | `mfu.read` (как сейчас) |
| `ad.*` чтение (пароль, блокировка, группы, история входов, истекающие) | `ad_users.read` — только ИТ |
| `ad.action.unlock_draft` | `ad_users.manage` |
| `network.*` чтение (ping, DNS, SSL, порты, розетки, обзор филиала) | `networks.read` — только ИТ |
| `network.action.wol_draft` | `networks.write` |
| `chat.*` (поиск людей и бесед, черновик сообщения) | `chat.read` / `chat.write` |

Итоговые права ИТ-сотрудников задаются ролями портала: у кого есть `ad_users.read` и `networks.read`, тот получает AD и сеть в ассистенте.

### Сделать (фаза AG)

- **AG-1. Доступ к ассистенту.**
  - `can_use_bot`: пользователь активен и имеет `required_permission` бота (и право портала, и для не-general ботов — допуск в `ai_bot_access`, кроме единого ассистента).
  - «HUB Ассистент» — доступен всем с `chat.ai.use`, без ручных допусков.
  - OpenCode — `chat.ai.sandbox` + личный допуск.
- **AG-2. Права инструментов.**
  - Каждому инструменту — поле `required_permissions` (из таблицы выше) в описании инструмента.
  - Набор инструментов запуска = включённые у бота ∩ разрешённые сотруднику — вычислять при сборке контекста и передавать модели **только** доступные инструменты.
  - `AiToolRegistry.execute` повторно проверяет право (защита от подмены вызова) — `PermissionError` с понятным текстом.
  - Действия: проверка права и при создании черновика, и при подтверждении (как сейчас в `action_cards.py`).
  - Тесты: сотрудник без `database.read` не получает `itinvent.*` ни в спецификации, ни при прямом вызове; ИТ с `ad_users.read` получает `ad.*`; без `networks.write` нет `network.action.wol_draft`.
- **AG-3. Слияние ботов.**
  - Возможности `general-ai` и `document-converter` (файлы, отчёты, конвертация) — в «HUB Ассистент».
  - Боты `general-ai`, `document-converter`, `it-helper`, `new-ai-bot` выключить штатным способом. Их беседы перепривязать к «HUB Ассистенту» (`ai_bot_conversations.bot_id`) — миграцией данных: dry-run, батчи, rollback, на production только с согласия пользователя.
  - Бутстрап ботов — только при старте (AI1 раздела 22).
- **AG-4. Меньше инструментов в запросе (AG4) — через существующий JEV, новый маршрутизатор не писать.**
  - В коде уже есть маршрутизатор JEV (`ai_chat/service.py`: `_route_tool_groups_jev` — по группам, `_route_tools_jev` — по инструментам; `shared/llm/jev_client.py`, OpenRouter System One) и правила по ключевым словам `_keyword_routed_groups`.
  - На production он **выключен**: в `.env` нет `AI_JEV_ROUTING` (по умолчанию `0`), нет `AI_JEV_ROUTING_MODE`, `JEV_API_KEY`/`JEV_MODEL`/`JEV_BASE_URL` не заданы (ключ берётся из `OPENROUTER_API_KEY`). Поэтому в каждый запрос уходят все 66 инструментов (комментарий в коде: «Variant A: pass ALL enabled tools»).
  - Старый LLM-маршрутизатор `_route_tool_groups` нигде не вызывается — мёртвый код, удалить вместе с тестами при слиянии.
  - Сделать:
    - JEV работает **после** фильтра прав (AG-2): маршрутизируются только разрешённые сотруднику группы и инструменты;
    - сравнить режимы `group` и `tool` и порог `AI_JEV_ROUTING_THRESHOLD` на наборе вопросов AG-5 (точность выбора, задержка маршрутизации, стоимость);
    - при сбое или таймауте JEV — понятный запасной путь (ключевые слова + основные группы по правам), не «все инструменты»;
    - выбранные режим и порог — в отчёт AG-5. Включение `AI_JEV_ROUTING=1` в production `.env` — отдельной операцией с согласия пользователя (вместе с релизом).
  - Цель — не больше ~20 инструментов в запросе.

### AG-4 подробно: как настроить JEV, чтобы он правильно выбирал инструменты

**Как работает сейчас (код):**
- Режим `group` (по умолчанию): `_route_tool_groups_jev` задаёт JEV по одному вопросу «да/нет» на группу (`_JEV_GROUP_QUESTIONS`) и берёт группы с вероятностью ≥ `AI_JEV_ROUTING_THRESHOLD` (0,5). Затем добавляются группы по ключевым словам (`_keyword_routed_groups`) и группа `other`.
- Режим `tool`: `_route_tools_jev` — вопрос на **каждый** инструмент (66 вопросов, описание обрезано до 200 символов) плюс всегда `itinvent.entity.resolve` и `itinvent.database.current`.
- При сбое JEV — `None`, т. е. **все** инструменты.

**Найденные слабые места:**

| ID | Проблема | Чем грозит |
|---|---|---|
| J1 | В JEV уходит только текущее сообщение (`trigger_text`), без истории диалога | Уточнения «а теперь перемести его на Петрова», «сделай то же в Excel», «а у Иванова?» маршрутизируются без контекста → не та группа или ничего |
| J2 | Набор инструментов фиксируется на весь запуск | Если по ходу ответа нужна ещё группа (нашёл технику → нужен файл/письмо), модель не может её получить, кроме случаев, покрытых ключевыми словами |
| J3 | Вопросы групп без примеров и критериев (`jev_noul` поддерживает `true_label`/`false_label`, но они не заданы) | Пограничные запросы («проверь компьютер Иванова» — ITinvent или сеть?) решаются нестабильно |
| J4 | Порог 0,5 не откалиброван | Либо лишние группы, либо пропуски — без данных не понять |
| J5 | Сбой или таймаут JEV → все инструменты | Возвращается исходная проблема (66 инструментов) в самый неудачный момент |
| J6 | `JEV_DEFAULT_TIMEOUT_SEC = 15`, `JEV_MAX_RETRIES = 2`; в маршрутизации — `AI_JEV_ROUTING_TIMEOUT_SEC = 8` | Зависший JEV добавляет до десятков секунд перед ответом |
| J7 | Режим `tool` — 66 вопросов на каждое сообщение | Дорого и медленно; описания обрезаны |
| J8 | Нет метрик «выбрано vs. реально использовано» | Нельзя понять, ошибается ли JEV |
| J9 | Маршрутизация вызывается и на «привет», «спасибо» | Лишняя задержка и стоимость |

**Как сделать правильно:**

1. **Порядок:** права сотрудника (AG-2) → JEV выбирает только из разрешённых групп → модель получает инструменты выбранных групп.
2. **Режим `group`**, а не `tool`. Группы маленькие (≤ 20 инструментов), внутри группы выбор делает основная модель. Режим `tool` оставить только для эксперимента в AG-5.
3. **Контекст (J1):** в `state` для JEV передавать, кроме текущего сообщения:
   - последние 2–4 реплики диалога (обрезанные, без вложений);
   - группы, использованные в предыдущем запуске этого диалога («липкие» группы: если пользователь продолжает тему, группа сохраняется, пока JEV не даст для неё уверенное «нет»);
   - признак вложенного файла (→ группа файлов).
4. **Вопросы с критериями (J3):** для каждой группы задать `true_label`/`false_label` с 2–3 примерами «да» и «нет» на русском. Например, ITinvent:
   - «да» — найди ноутбук 100234; что числится за Ивановым; перемести принтер; история перемещений;
   - «нет» — сбрось пароль; пингани сервер; напиши письмо.
   Отдельно развести пограничные: «компьютер Иванова» — ITinvent (что числится/профиль) или сеть (доступен ли/ping).
5. **Расширение по ходу (J2):** служебный инструмент `request_tool_group(group, reason)`, доступный модели всегда. Модель может один-два раза за запуск запросить ещё группу; она добавляется, только если разрешена сотруднику по правам. Каждое расширение логируется — это сигнал, что маршрутизация промахнулась.
6. **Запасной путь (J5):** при сбое/таймауте JEV — группы по ключевым словам + «липкие» группы прошлого запуска; если пусто — базовый набор (`files`, `kb`) и `request_tool_group`. Никогда не «все инструменты».
7. **Время (J6):** для маршрутизации — таймаут 2–3 с, без повторов. Кэш решения на 5–10 минут по хэшу (нормализованное сообщение + липкие группы + набор доступных групп).
8. **Короткие сообщения (J9):** приветствия, благодарности и пустые реплики — без маршрутизации и без инструментов.
9. **Калибровка порога (J4):** на наборе AG-5 подобрать порог по метрикам ниже; ориентир 0,35–0,5. Лучше взять лишнюю группу, чем пропустить нужную.
10. **Метрики (J8):** в логе каждого запуска — `routed_groups`, вероятности, `used_tools`, `expanded_groups` (из п. 5), задержка JEV.
    - **Пропуск:** нужная группа не выбрана (было расширение или эталон показывает промах).
    - **Лишнее:** выбрана группа, из которой ничего не вызвано.
    - Еженедельная сводка в логах/админке ИИ.

**Набор проверки (часть AG-5), 40–60 вопросов, без персональных данных:**
- одиночные запросы по каждой группе;
- пограничные (ITinvent ↔ сеть, почта ↔ задачи, отчёт ↔ ITinvent);
- уточнения в диалоге («а у Петрова?», «то же самое в PDF»);
- составные («найди всю технику Иванова и пришли отчётом на почту»);
- запросы вне прав сотрудника (должен ответить «нет доступа», а не искать обходной инструмент);
- приветствия и болтовня (без инструментов).

Эталон — ожидаемые группы для каждого вопроса. Цели:
- полнота выбора групп (recall) ≥ 95 %;
- среднее число групп ≤ 2;
- задержка JEV p95 ≤ 1,5 с;
- 0 запусков со «всеми инструментами».

Тесты (pytest, JEV замокан):
- контекст и липкие группы;
- запасной путь при исключении/таймауте;
- фильтр прав до JEV;
- `request_tool_group` не выдаёт запрещённую группу;
- короткие сообщения без маршрутизации.

**Включение на production** — после фазы AG и проверки на наборе, отдельной операцией с согласия пользователя:
- `AI_JEV_ROUTING=1`;
- `AI_JEV_ROUTING_MODE=group`;
- `AI_JEV_ROUTING_THRESHOLD=<по калибровке>`;
- `AI_JEV_ROUTING_TIMEOUT_SEC=3`.

Затем перезапуск ИИ-воркера штатным скриптом, post-check по логам (`ai_jev_routing probs=… routed=…`) и откат — убрать флаг.
- **AG-5. Сравнение моделей.**
  - Набор из 20–30 типовых вопросов: документы и база знаний, отчёты, почта и задачи, поиск и перемещение техники, ИТ-вопросы (AD, сеть) — без персональных данных.
  - 2–3 модели через существующий `shared/llm/` (текущая `gemini-3.1-flash-lite` и 1–2 более сильные).
  - Метрики: правильный выбор инструмента, корректность ответа, время до первого токена и полного ответа, стоимость на 100 запросов.
  - Итог — таблица в плане; выбор модели — за пользователем.
- **AG-6. Управление доступом.** Экран настроек ИИ: «HUB Ассистент» — «доступен всем с правом ИИ», список возможностей по правам; OpenCode — список допусков. Пояснение «что умеет ассистент для этого сотрудника» по его правам.

**Порядок фаз:** фаза 10 (AI8, R26–R28, пакет T) → фаза AG → фаза Д (дизайн, по эталонным скриншотам).

Приёмка AG:
- три тестовых пользователя (обычный сотрудник; сотрудник с `database.read/write`; ИТ с `ad_users.read` и `networks.read`) — набор инструментов в запросе к модели и ответы на запросы вне прав («Нет доступа к данным ITinvent»);
- старые диалоги ботов открываются и продолжаются с «HUB Ассистентом»;
- таблица сравнения моделей.

## 26. Дополнительные решения пользователя (2026-10-01)

### ИИ

1. **Передача данных внешнему провайдеру ИИ** (OpenRouter/RouterAI: ФИО, логины, данные ITinvent/AD, тексты писем) — **согласована в компании**. Маскирование не вводим. Правило логов AGENTS.md сохраняется: не логировать содержимое запросов и ответов без предусмотренной редактуры.
2. **Бюджет — только предупреждение о балансе.** Лимитов на сотрудника нет.
   - Проверка баланса провайдера по расписанию (существующим механизмом воркера или отдельной лёгкой задачей без новых сервисов).
   - При балансе ниже порога (настраивается) — уведомление управляющим ИИ (`settings.ai.manage`) и строка в настройках ИИ.
   - Ошибка 402 в ответе — понятный текст пользователю («ИИ временно недоступен, администраторы уведомлены») + уведомление управляющим (AI4).
3. **Выкатка нового ассистента — сразу всем**, вместе с релизом. Поэтому приёмка AG на стенде обязательна полностью: три профиля прав, набор вопросов AG-5, старые диалоги.
4. **Личная память — оставить, с управлением, как в ChatGPT.** В настройках ИИ: список запомненных фактов, удаление по одному, «Очистить всё», переключатель «Использовать память». В ответе — пометка, если использован факт из памяти (по возможности).
5. **Ответ ИИ готов, а сотрудник ушёл — как обычное входящее.** Счётчик на вкладке «ИИ», звук (правила раздела А2) и уведомление «ИИ ответил: <начало ответа>» вне чата. Использовать существующие события `chat.message.created`/`chat.ai.run.updated` и логику уведомлений чата.
6. **ИИ только в своём разделе.** В обычные и групповые чаты ассистент не добавляется (@-упоминания бота нет). Можно вернуться к вопросу позже.

### Чат

7. **Тема по умолчанию — как в системе** (светлая/тёмная по ОС), переключатель в настройках.
8. **Функции Telegram:**
   - папки и закрепление уже есть — переносятся в новый дизайн (фаза Д);
   - **отложенные сообщения** — новая функция, отдельный пакет после дизайна: «Отправить позже» (выбор даты и времени), список запланированных в беседе, изменение и отмена, отправка сервером в срок (существующий воркер/outbox, без новых сервисов), сообщение появляется у всех как обычное. Схема — штатным Alembic;
   - звонки и каналы — не нужны.

### Итоговый порядок работ

1. **Фаза 10** — AI8 (выключенная строка ИИ), R26–R28 (прокрутка), пакет T (нагрузка ИИ-воркера, зависшие запуски, ошибки и предел ожидания).
2. **Фаза AG** — права и единый ассистент, JEV (AG-4 подробно), сравнение моделей, память с управлением, уведомление «ИИ ответил», предупреждение о балансе.
3. **Фаза Д** — дизайн как Telegram Web A / Android и ИИ как ChatGPT (по эталонным скриншотам пользователя).
4. **Пакет «Отложенные сообщения».**
5. **Релиз** одним выпуском — план выкатки готовит проверяющий; включает `APP_ENV=production` (А4), `AI_JEV_ROUTING`, импорт стикеров, миграции; выполнение только после «да» пользователя.
6. После релиза — нагрузочный тест и аудит mobile-hub.

## 27. Фаза 10 (исполнитель, 2026-10-01)

> Номер: запрошенный заголовок «25» уже занят разделом проверяющего
> («ИИ-агенты»), добавленным после выдачи задачи — журнал записан как 27.

### AI8 — беседа выключенного/удалённого бота

**Статус: сделано.**

Backend:
- `backend/chat/chat_conversation_read_store.py`: маппинг `app.ai_bot_conversations` → `ai_bot_id` в `GET /chat/conversations` (best-effort, ошибка маппинга не роняет список).
- `backend/chat/chat_serialization.py`: поле `ai_bot_id` в summary беседы.
- `backend/ai_chat/access.py`: владелец беседы сохраняет чтение/отправку при выключенном или отсутствующем боте; чужие отклоняются.
- `backend/ai_chat/service.py::_get_runtime_by_conversation`: беседа с недоступным ботом перепривязывается к `general-ai` (`surface=general`, `is_enabled`), mapping и `rolling_summary` сохраняются — история продолжается.

Frontend:
- `pages/chat/chatAiModel.js`: бот строки сайдбара из `conversation.ai_bot_id`/`bot_id`; строка без бота не disabled и не «retired».
- `components/chat/ChatSidebarRows.jsx`, `pages/chat/useChatNavigationController.js`: открытие существующей ИИ-беседы по `conversation_id`; «открывается» только при непустом ключе (`'' === ''` не помечает все строки).

Тесты: `tests/test_ai_bot_access.py` (+2: владелец при disabled и при missing bot, чужой отклонён — всего 12/12); `tests/test_chat_search_reply_and_settings_service.py::test_ai_conversation_summary_exposes_ai_bot_id` (1/1); `chatAiModel.test.js` (+2), `ChatSidebar.test.jsx` (+1, orphan-строка).

### Q2 — прокрутка и непрерывное окно (R26–R28)

**Статус: сделано.**

- `pages/chat/useChatThreadInteractionController.js`: `drainNewerThreadPages` заменён на `loadLatestThreadWindow` — одна bootstrap-загрузка последнего окна (`loadMessages` без курсоров, `silent`+`force`). `ensureLatestThreadWindow` (перед своей отправкой, R20) и `jumpToLatest` после загрузки прокручивают в самый низ (`scrollThreadBottomIntoView` + `queueAutoScroll`); видимость ↓ далее пересчитывается по фактической позиции через `scheduleThreadViewportStateSync`/RO. R26 ✓. Курсор и `has_newer` приходят из ответа bootstrap — повторные одинаковые запросы исключены конструктивно. R28 ✓.
- `components/chat/useChatSocketEvents.js`: при `messagesHasNewerRef.current` сокет-сообщение активной беседы не вставляется в ленту — только `syncConversationPreview` (превью + `unread_count + 1` для чужих) и `promoteConversationToTop`; курсор догрузки остаётся последним сообщением непрерывного окна. R27 ✓.
- `components/chat/ChatThread.jsx`: бейдж ↓ = `pendingNewCount + max(0, unread_count − pendingNewCount)` при `has_newer` — хвост по серверному счётчику, включая подавленные сокет-сообщения; попутно исправлено занижение при частичном прочтении окна (ранее вычиталась замороженная `loadedUnreadAfterAnchor`).

Тесты: `useChatThreadInteractionController.test.js` (3: один bootstrap-запрос + прокрутка в низ, no-op без has_newer, jumpToLatest), `useChatSocketEvents.test.jsx` (R27-кейс, всего 14), `useChatThreadViewport.test.js` (5).

### T — ИИ backend и ожидание (AI1, AI3, AI4, AI5)

**AI1 — сделано.** `initialize_runtime` вызывается только при старте процесса (`chat_main.py`, `main.py`, `start_ai_chat_worker.py`) и при изменении настроек бота (`update_bot`, `force=True` — легально по смыслу пакета); из request/worker-путей (`list_bots`, `list_admin_bots`, `create_bot`, `list_recent_runs`, `open_bot_conversation`, `create_bot_conversation`, `_process_single_run`, `_get_runtime_by_conversation`) вызовы убраны. `_apply_bot_seed_fields` пишет поля и `updated_at` только при фактическом расхождении; INFO-лог только при создании/изменении (service.py и `ai_sandbox/app_service.py` для OpenCode).

**AI3 — подготовлено, на production не запускалось.** `AiChatService.reap_stale_runs(dry_run, stale_after_sec, batch_size)`: `queued`/`running` со `updated_at` старше порога (default 900 c, env `AI_RUN_WATCHDOG_STALE_SEC`) → `failed` («Выполнение прервано: ответ ИИ не получен вовремя.») + `chat.ai.run.updated`; батчи ограничены (1–500). Воркер `start_ai_chat_worker.py`: `AI_RUN_WATCHDOG_ENABLED=0` по умолчанию, `AI_RUN_WATCHDOG_DRY_RUN`, `AI_RUN_WATCHDOG_INTERVAL_SEC` (300 c). Тесты нашли и я исправил DetachedInstanceError: публикация событий идёт по снимку полей, снятому внутри сессии, а не по истёкшим ORM-объектам.
Тесты `tests/test_ai_run_watchdog.py`: 5/5 (queued+running→failed+publish, dry-run ничего не меняет, batch_size=1 режет, существующий `error_text` сохраняется, флаг по умолчанию выключен).

**AI4 — сделано.** `_friendly_run_error_text` мапит 402/timeout/429/5xx/connection-ошибки в понятный текст с подсказкой «Повторить»; сырая ошибка остаётся в логе. Повтор: `AiChatService.retry_conversation_run` (последний `failed`/`cancelled` → новый run по тому же `trigger_message_id`, `force_new_run` в `queue_run_for_message`, owner-only) + `POST /chat/ai/conversations/{id}/retry`; frontend `chatAPI.retryAiConversationRun` → `retryActiveAiRun` → кнопка «Повторить» в баннере. Тесты `tests/test_ai_run_retry.py`: 4/4 (re-queue последнего failed, отказ не-владельцу, «нечего повторять», маппинг текстов).

**AI5 — сделано.** `AiRunStatusBanner` (`AI_RUN_STALE_AFTER_MS = 5 мин`, тик 15 c): `queued`/`running` без роста `updated_at` дольше порога → «ИИ не отвечает» + «Повторить»/«Остановить» вместо бесконечного спиннера; на `failed` — «Повторить». Тесты `ChatThreadHeader.test.jsx`: +3 (5/5 в файле).

### AI7 — профилирование `GET /chat/conversations`

**Статус: сделано (профиль на тестовой БД; production p95 — на стенде).**

- Тест `tests/test_chat_conversations_list_profile.py`: sqlite-БД, 60 бесед у пользователя (members, last messages, reads, attachments, user state), страница `limit=50`. Инструментация `before/after_cursor_execute` на read-движке + `EXPLAIN QUERY PLAN` каждого SELECT.
- Путь уже пакетный — N+1 нет: **6 запросов** на страницу (page-запрос с join member/state + batch members, last messages, attachments, reads, user states). Все — `SEARCH ... USING INDEX`; temp b-tree только на `ORDER BY` (ожидаемо). Wall time 13.9 ms, поиск `q="x"` — 17.2 ms; целевые 300 ms p95 на sqlite с запасом, но это не production-замер.
- Попутно найдено и учтено в тесте: bucket `conversations` — soft-invalidate (TTL укорачивается до 2.5 c, значение продолжает отдаваться), поэтому профилируемый вызов сбрасывает `_runtime_cache` напрямую.
- Код `list_conversations` не менялся — оптимизация не потребовалась.

### Проверки (фактические прогоны)

- Полный vitest по набору раздела 18: **154 файла / 1127 тестов — 0 падений** (10:50, 71.9 c).
- pytest (sqlite + `CHAT_REALTIME_TRANSPORT=local`): `test_ai_run_watchdog.py` 5/5, `test_ai_run_retry.py` 4/4, `test_ai_bot_access.py` 12/12, `test_chat_search_reply_and_settings_service.py::test_ai_conversation_summary_exposes_ai_bot_id` 1/1, `test_chat_conversations_list_profile.py` 1/1.
- ESLint `npm run lint` (pages/chat + components/chat): **0 errors** (warnings прежние).
- `git diff --check`: чист по затронутым файлам; единственное замечание — trailing whitespace в автогенерируемом `POSTGRES_APP_SCHEMA_DDL.md` (к чату не относится, зафиксировано ещё в фазе 9).

### Отклонения и открытые вопросы

- Раздел журнала записан под номером 27 — «25» уже занято проверяющим.
- `update_bot` сохраняет `initialize_runtime(force=True)` — это и есть «изменение настроек» по смыслу AI1.
- Watchdog AI3 на production не включался (`AI_RUN_WATCHDOG_ENABLED=0`); включение — отдельная операция после «да» (выполняет DML).
- AI7 выполнен на тестовой sqlite-БД: число запросов и `EXPLAIN QUERY PLAN` зафиксированы, N+1 не выявлен. Замер на PostgreSQL/production-объёме (реальный p95 < 300 ms, включая app-БД запросы `ai_bot_conversations`/presence-сессий, которые на read-движке не видны) — отдельная проверка на стенде.
- AI6 в список «Сделать (фаза 10, пакет T)» раздела 22 не входит — не делался.
- Фаза Д (AI9–AI14) по заданию не делалась.
- Runtime-приёмка на стенде — за проверяющим.

## 28. Фазы AG и Д + аудит mobile-hub (исполнитель, 2026-10-01)

> Работа распараллелена на агентов по непересекающимся областям; ниже — сводка
> по фактическим изменениям и прогонам после слияния всех веток работы.

### AG-1 — права на ботов

**Статус: сделано.** `ai_chat/access.py`: `can_use_bot` проверяет `required_permission`
через `authorization_service.has_permission` с учётом `use_custom_permissions`/
`custom_permissions`; `corp-assistant` автоматически доступен активным с `chat.ai.use`
(`automatic=True`, ручной грант отклоняется `ValueError`); `opencode` — только
`chat.ai.sandbox` + явная запись в `ai_bot_access`. `list_user_access`/`list_bot_access`/
`conversation_access` считают `allowed` через `can_use_bot`.
Тесты `tests/test_ai_bot_access.py` — 12/12.

### AG-2 — права на инструменты

**Статус: сделано.** Новый `ai_chat/tool_permissions.py`: точный маппинг +
longest-prefix (`itinvent.*`→`database.read`, `itinvent.action.*`→`database.write`,
`ad.*`→`ad_users.read`, `network.*`→`networks.read`, WOL-драфт→`networks.write`,
`office.mail.*`/`office.action.mail_*`→`mail.access`, задачи→`tasks.*`,
`chat.action.*`→`chat.write`, `kb.*`→`kb.read`, `mfu.*`→`mfu.read`,
`voice.*`→`voice.read`, fallback `chat.ai.use`); `itinvent.equipment.search_multi_db`
остаётся admin-only. Фильтр в `_build_tool_execution_context` до спеков/JEV/keyword
routing; повторная проверка `user_can_use_tool` в `tools/registry.py::execute`
(`PermissionError`, до валидации аргументов и аудита). `ad.action.unlock_draft`,
`network.action.wol_draft`, `network.host.info` сняты с `admin_only` на права по
таблице. Draft+confirm авторизация в `action_cards.py` проверена — без изменений.
Тесты `tests/test_ai_tool_permissions.py` — 8/8.

### AG-3 — слияние ботов в HUB Ассистент

**Статус: код готов, миграция на prod не запускалась.** Сид `v5`: дефолтные
инструменты `corp-assistant` += `ai.files.create`/`ai.files.report`/
`ai.files.convert_document` (домёрж к существующему списку, кастомные сохраняются);
`ensure_doc_convert_bot`/`ensure_general_ai_bot` сидят только при `not seeded_once`
и не реанимируют выключенного бота; `create_general_conversation` → `corp-assistant`;
`_get_runtime_by_conversation` fallback `corp-assistant → general-ai → None` с
перепривязкой `bot_id` в той же строке mapping (история сохраняется).
Скрипт `backend/scripts/merge_ai_bots_into_corp_assistant.py`: dry-run по умолчанию,
`--apply --batch-size N`, идемпотентен, `conversation_id`-конфликты логируются и
пропускаются, rollback описан в docstring. Тесты `tests/test_ai_bot_merge.py` — 3/3.
Отклонение: fresh-install продолжает сидить `general-ai`/`document-converter`
(admin-каталог); выключение — через скрипт.

### AG-4 — JEV-маршрутизация после фильтра прав

**Статус: сделано (флаги выключены).** `_route_tool_groups_jev`/`_route_tools_jev`/
`_build_jev_state`/`_jev_fallback_groups`/`_keyword_routed_groups` в `service.py`;
мета-инструмент `ai.request_tool_group` (`tools/tool_group_request.py`,
лимит `AI_TOOL_GROUP_EXPANSION_LIMIT=2`); `JevClient.decide(..., max_retries)`.
J1 state (сообщение + 4 реплики + sticky из `routed_groups` прошлого run +
has_attachment), J2 расширение группы, J3 вопросы jev_noul с true/false-критериями,
J4 `AI_JEV_ROUTING_THRESHOLD=0.5`, J5 fallback keyword+sticky+{files,kb}+other
(никогда «все»), J6 timeout 3 с/`max_retries=0`/TTL-кэш 300 с (ключ включает
permission-filtered groups), J7 `AI_JEV_ROUTING_MODE=group`, J8 логи probs/routed/
latency + `used_tools`/`expanded_groups` в `result_json`, J9 smalltalk → без
инструментов, J10 тесты.
Тесты `tests/test_ai_jev_routing.py` — 32/32.

Доработка после ревью (2026-10-02):
- J9: «да/ок/хорошо/давай» — болтовня только в начале диалога; при предыдущих
  репликах или sticky-группах это подтверждение и идёт в маршрутизацию; сообщение
  с вложением болтовнёй не считается;
- J2: `ai.request_tool_group` предлагается всегда, когда разрешённые инструменты не
  попали в шаг, в том числе при пустом выборе JEV; «уже подключена» определяется по
  фактически выданным инструментам (tool-mode: resolver-инструменты не блокируют
  поиск); результат расширения несёт правила группы (`usage_rules`);
- промпт: разрешённая, но не выбранная группа описывается как «не подключена — запроси
  через `ai.request_tool_group`», а не «disabled for this bot»;
- J6: ключ кэша включает recent_messages, has_attachment и (tool-mode) набор
  инструментов; запасной ответ при сбое JEV не кэшируется;
- J1: sticky берётся из последнего из трёх запусков с непустыми группами — «спасибо»
  между вопросами не обрывает цепочку.
Тесты: `tests/test_ai_jev_routing.py` — 51/51, сквозной
`test_ai_jev_routing_unattached_group_is_requested_not_reported_disabled`.

Попутное исправление при сводной проверке: устаревший `tests/test_ai_tool_routing.py`
(тестировал удалённый `_route_tool_groups`) переписан на новый контур — 34/34;
`_keyword_routed_groups` теперь возвращает `{files}` при файловом интенте без
domain-ключей (старая гарантия «file intent всегда добавляет files» восстановлена;
`keyword_groups` юнионятся в routed на call-site).

### AG-5 — сравнение моделей

**Статус: харнесс готов, прогон — за пользователем (нужен API-ключ).**
`ai_chat/eval_questions.json` — 30 обезличенных вопросов с `expected_groups`/
`requires_permission`; `backend/scripts/compare_ai_models.py` — только через
`shared/llm`, `--models/--mode answer|route/--dry-run/--pricing/--limit`, отчёт
markdown (скорость/токены/стоимость/качество). `--dry-run` проверен.

### AG-6 — экран доступа к ИИ

**Статус: сделано.** `GET /chat/ai/assistant/capabilities` (право `chat.ai.use`,
реальный источник `tool_permissions`); frontend `api/aiAssistantCapabilities.js`
+ `pages/account/admin/AssistantAccessInfo.jsx` (группировка возможностей по
группам инструментов, чипы «есть/нет у вас/только админ/только ИТ»);
`BotSettingsWorkspace.jsx`: `corp-assistant` → тип «HUB Ассистент · всем с правом
ИИ» + вкладка «Доступ и возможности»; OpenCode — прежняя панель грантов.
Тесты `AssistantAccessInfo.test.jsx` — 6/6 (в сумме с затронутыми — 48/48).

### Фаза Д (Д1–Д7, AI9–AI14)

**Статус: сделано.** Д1: `theme/chatTelegramTheme.js` (сайдбар 300/420/520, rail 72,
строка 72px, аватар 54px, цвета Telegram-подобные без бренд-ассетов), узкий rail на
`/chat`, `headerMode=hidden`, подавление desktop-handoff баннера на `/chat*`.
Д2: `ChatSidebarDesktopHeader` (☰+поиск+уведомления), underline-вкладки папок 3px,
72px строки, детерминированные цвета аватаров, бейджи unread/«@» (forward-compatible),
FAB «Новый чат». Д3–Д5: лента/пузыри/композер в новых токенах, dblclick-ответ только
по тексту, эмодзи-панель поповером. Д6: phone-режим без внешних отступов, нижняя
навигация. Д7/AI9–AI14: `AiRunFeedStatus` внутри ленты (шаги «Выполнено N», partial_text,
stale «ИИ не отвечает» + Повторить/Остановить), контролы ответа (копировать/👍/👎/
повторить — оценки локальные, поля feedback в payload нет), чипы источников ≤6+«Ещё N»,
markdown-ответы, выбор ассистента, удалён мёртвый `AiRunStatusBanner` из шапки.
Тесты агентов: components/chat 55 файлов/521, pages/chat 81 файл/417 — зелёные.

### Аудит mobile-hub (раздел 19 п.3)

**Статус: read-only аудит выполнен, код не менялся.** Собственный контур
(Expo/RN): durable outbox + `client_message_id`, backoff+jitter, AppState suspend/
resume, курсорная пагинация с детектом разрыва — большинство P0–P2 веб-плана не
воспроизводится. Пробелы (по важности): `chat.message.read`/`chat.unread.summary`/
`chat.ai.run.updated` не подписаны; после mark-read серверные счётчики папок
сбрасываются в `{}` (fallback на сумму загруженных); `sendSticker`/`shareTask` без
`client_message_id`; markRead без AppState-гейта (до 45 с в фоне); `watchPresence`
не переотправляется после reconnect; `chat.error`/4429 `retry_after_ms`
игнорируются; мёртвый `ChatConnectionBanner`; нет якоря «первая непрочитанная».
Предложены пакеты M1–M8 (P2/P3) — реализация отдельным этапом.

### Проверки (фактические прогоны)

- Полный vitest по набору раздела 18: **154 файла, 1135/1136 тестов** — единственное
  падение `useChatComposerSending.chain.test.jsx` (тайминг-флейк: 3 повторных прогона
  отдельно и с соседним файлом — стабильно зелёный).
- pytest (sqlite + `CHAT_REALTIME_TRANSPORT=local`): `test_ai_jev_routing.py` 32,
  `test_ai_tool_routing.py` 34, `test_ai_bot_merge.py` 3, `test_ai_bot_access.py` 12,
  `test_ai_tool_permissions.py` 8, `test_ai_run_watchdog.py` 5, `test_ai_run_retry.py` 4,
  `test_ai_new_tools.py` 20, `test_ai_chat_runtime.py` 68 (вкл. обновлённые под AI1
  bootstrap и v5-инструменты), `test_ai_bot_user_session_reuse.py` 1,
  `test_ai_conversation_sessions_migration.py` 1, `test_chat_conversations_list_profile.py` 1,
  `test_chat_thread_bootstrap_anchor.py` 12 — всего **201 passed, 0 failed**.
- ESLint (chat-область + изменённые файлы): **0 errors** по затронутым файлам;
  11 ошибок `no-undef`/`no-control-regex` в `src/lib/desktopProtocolHandoff.js` —
  файл вне browser-scope eslint-конфига и в этой фазе не менялся (pre-existing).
- `vite build` — успешно (агент Д3–Д7, ~1м22с).
- `git diff --check` — чист; прежнее замечание только в автогенерируемом
  `POSTGRES_APP_SCHEMA_DDL.md`.

### Отклонения и открытые вопросы

- Production-флаги НЕ включались: `AI_JEV_ROUTING*` (JEV — opt-in),
  `AI_RUN_WATCHDOG_ENABLED` (AI3), merge-скрипт AG-3 (DML) — отдельные операции
  после явного «да».
- Реальный прогон моделей AG-5 и калибровка `AI_JEV_ROUTING_THRESHOLD` по
  датасету — требуют API-ключа, оставлены пользователю.
- JEV-приёмочные метрики (recall ≥95%, ≤2 группы, p95 ≤1.5 с) — проверять на
  стенде после включения флага.
- Бейдж «@» — forward-compatible: полей `unread_mention_count` на backend нет.
- Оценки 👍/👎 в ответах ИИ — локальный визуальный стейт (поля feedback в payload
  сообщения нет); backend-поле — отдельная задача, если потребуется.
- Visual-осмотр на ширинах 300/420/520 и приёмка mobile — за проверяющим.
- ESLint-конфиг покрывает не все директории (`pages/account/admin`,
  `components/layout` — «File ignored», pre-existing).

## 29. Фаза Д на production и замечания пользователя (проверяющий, 2026-10-01)

### Инцидент: непроверенный дизайн попал на рабочий сайт

- IIS-приложение `hubit` отдаёт фронтенд **прямо из `WEB-itinvent/frontend/dist`** (`appcmd list vdir`: `hubit/ → C:\Project\Image_scan\WEB-itinvent\frontend\dist`). Любой `vite build` без `--outDir` во временный каталог = немедленная выкладка на production.
- `dist/index.html` собран **2026-10-01 12:02** (журнал раздела 28: «`vite build` — успешно (агент Д3–Д7)»). На сайте — фаза Д без приёмки проверяющего.
- Процессы: `itinvent-backend` 09:58, `itinvent-chat-a/b` 09:59, `itinvent-ai-chat-worker` 2026-09-30 16:42. Изменения backend фаз 10/AG (`tool_permissions.py` 11:33, `access.py` 11:34, `api/v1/chat/ai.py` 11:43, `service.py` 13:10, `chat_serialization.py` 13:46) в работающие процессы **не загружены** — фронтенд на сайте новее backend (например, `GET /chat/ai/assistant/capabilities`, `POST …/retry`, поле `ai_bot_id` в списке бесед отсутствуют).
- Решение пользователя: **оставить как есть**, исправлять поверх.
- **Правило (усиление раздела 5):** сборка только `vite build --outDir <временный каталог>`. Сборка в `WEB-itinvent/frontend/dist` — это выкладка на production: только по явному «да» пользователя, вместе с согласованным перезапуском backend. Рекомендация — добавить это правило в `AGENTS.md` (раздел «Deployment и перезапуски»): «frontend IIS-приложение `hubit` указывает на `frontend/dist`».

### Замечания пользователя по скриншотам (тёмная тема, HUB Desktop) и проверка стендом

Стенд — копия текущего `dist` (production) и сборка фазы 9 (до редизайна) для сравнения; моки API/WS.

| ID | Замечание | Подтверждение / причина |
|---|---|---|
| Д-1 | Фиолетовые свои сообщения — «ужасные цвета» | `chatUiTokens.js:317–320`, `theme/chatTelegramTheme.js:36`: `#8774e1` — взято из эталона раздела 23 (ошибка эталона проверяющего, тёмная тема Telegram Web A) |
| Д-2 | Сообщения идут «друг за другом», а не по разные стороны | На 1440 px лента — центрированная колонка 728 px: свои и чужие почти не расходятся по сторонам. До редизайна — на всю ширину ленты, свои у правого края, чужие у левого |
| Д-3 | Сильно пострадала плавность прокрутки | Прокрутка колесом вверх с догрузкой истории (160 сообщений), 40 шагов: **после** — длинные задачи до 296–340 мс, худший кадр 317–350 мс (desktop 600/1024/1440); **до** (фаза 9) — 152–164 мс, худший кадр 133–167 мс. Регрессия ~2× |
| Д-4 | Поле ввода слишком большое | Док 54–70 px, капсула 44–48 px с отдельной круглой кнопкой |
| Д-5 | Переключатель «Чаты / ИИ» не выглядит переключателем | Выбранная вкладка без фона (`bg rgba(0,0,0,0)`), отличается только цветом текста — в тёмной теме не видно, что выбрано |
| Д-6 | На разных разрешениях пропадают элементы | 560–1200 px — горизонтального переполнения нет. Но при ширине < 920 px список бесед и переключатель «Чаты / ИИ» исчезают (только переписка); 600–880 px — полное меню портала 215 px вместо узкой полосы. (Обрезанные элементы справа на скриншоте HUB Desktop — фоновое окно за пределами приложения) |
| Д-7 | Меню сообщения — не как в Telegram | Крупные пункты, «Копировать ссылку», «Пожаловаться» и т. п. |
| Д-8 | Панель вложений — не как в Telegram | Вкладки в 2 ряда, подвкладки «Фото / Видео», крупные зазоры и пустые плитки, кнопка «Показать ещё вложения» |
| Д-9 | Панель «Информация» — оставить, но доработать компоновку и добавить, где сидит сотрудник | Сейчас: должность, подразделение, город, почта, телефон, уведомления |

### Решения пользователя (2026-10-01)

1. **Цвета тёмной темы — как Telegram Desktop/Android ночью:** фон ленты тёмно-синий, свои сообщения синие `#2b5278`, входящие `#182533`, колонки `#17212b`/`#0e1621`, акцент голубой (`#5288c1`/`#64b5ef`). Светлая тема: свои `#effdde`, входящие `#ffffff`. Фиолетовый убрать полностью.
2. **Лента на всю ширину, по разные стороны:**
   - свои — у правого края, чужие — у левого, максимальная ширина пузыря ~65 % ленты (на телефоне ~85 %);
   - серии одного автора идут плотно (2 px), хвостик только у последнего пузыря серии, аватар собеседника в группах — у последнего.
3. **Поле ввода — компактное, как Telegram Desktop:**
   - плоская полоса во всю ширину ленты, высота ~46 px;
   - скрепка слева, эмодзи и микрофон/отправить справа внутри полосы, без отдельной круглой кнопки;
   - растёт при длинном тексте до ~40 % высоты;
   - подсказка «Enter — отправить…» не показывается.
4. **Меню сообщения — как в Telegram:**
   - сверху отдельная полоска реакций (7–8 эмодзи + раскрытие);
   - ниже компактный список (высота пункта ~36 px, шрифт 14, иконки 20 px, радиус 10–12, полупрозрачный фон): Ответить, Изменить (свои), Закрепить, Копировать текст, Переслать, Выделить, Удалить;
   - **из HUB остаётся только «Прочитали: N»** внизу меню в группах (со списком при наведении/нажатии);
   - «Копировать ссылку», «Пожаловаться» и прочее — убрать из меню.
5. **Узкое окно:**
   - **две колонки до 700 px**, как Telegram Desktop: список сужается (минимум ~260 px), справа переписка;
   - **уже 700 px** — режим телефона: список или чат со стрелкой «назад»;
   - переключатель «Чаты / ИИ» всегда в шапке списка;
   - меню портала на странице чата — узкая полоса иконок на любой ширине desktop.
6. **Панель вложений — как в Telegram:**
   - вкладки в одну строку с горизонтальной прокруткой: Медиа, Файлы, Ссылки, Голосовые, Задачи;
   - фото и видео вместе (у видео — длительность), сетка 3 колонки с зазором 1–2 px, квадратные превью;
   - догрузка при прокрутке вместо «Показать ещё».
7. **Панель «Информация» — оставить и доработать:**
   - шапка как в Telegram: крупный аватар, имя, статус;
   - блоки с иконками: должность, подразделение, город, **адрес офиса**, **кабинет** (адресная книга: `office_address`, `office_room`), корпоративная почта, телефон (нажатие копирует), «Уведомления»;
   - ниже — вкладки вложений (п. 6);
   - пустые поля не показывать.
8. **Переключатель «Чаты / ИИ»** — сегментный, с явным фоном выбранной вкладки в обеих темах (в тёмной — `#2b5278`/акцент), счётчики внутри.

### Пакеты фазы Д2 (исправление фазы Д)

| Пакет | Что |
|---|---|
| Д2-1 Цвета | Токены `chatUiTokens.js`/`chatTelegramTheme.js` по п. 1 для светлой и тёмной темы; убрать `#8774e1` везде; контраст текста/времени/галочек на синем |
| Д2-2 Лента | Полная ширина, стороны, серии, хвостики, аватары в группах (п. 2) |
| Д2-3 Прокрутка | Найти причину регрессии Д-3 (React Profiler в dev-сборке + Performance-трасса; кандидаты: перерисовка всех пузырей при догрузке, новые обёртки/стили, наблюдатели на каждом пузыре, sticky-чипы дат). Цель — не хуже фазы 9: при том же сценарии длинные задачи ≤ 160 мс, лучше ≤ 100 мс |
| Д2-4 Поле ввода | Компактная полоса (п. 3). Убрать «хвостик» поля ввода: `ChatComposer.jsx:~940`, `'&::after'` с `clipPath` — на скриншоте пользователя это отдельный треугольник у левого нижнего угла. Он без рамки и не совпадает с обводкой и кольцом фокуса (эталон раздела 23 «поле ввода с хвостиком» отменён) |
| Д2-5 Раскладка | Две колонки до 700 px, режим телефона уже, переключатель «Чаты / ИИ» в шапке списка, узкая полоса меню (п. 5, 8) |
| Д2-6 Меню сообщения | По п. 4, включая «Прочитали: N» в группах |
| Д2-7 Профиль и вложения | Панель «Информация» и вложения по п. 6–7 |
| Д2-8 Фото без серого фона | Скриншот пользователя: вертикальное фото (скрин телефона) в сообщении — серые полосы по бокам и рамка. Причина: `ChatBubble.jsx:1326–1328` (макс. высота 360 / 176, мин. ширина 200 / 148) + `ChatCommon.jsx:~867–932` (`objectFit: 'contain'`, фон `mediaPlaceholderBg`, рамка 1px, тень). Для узкого фото мин. ширина больше, чем макс. высота × пропорция → контейнер шире картинки → `contain` даёт полосы; на телефоне 390 полосы почти по ширине картинки. Без `width/height` у вложения берётся 4:3 → полосы у любого вертикального фото. Как в Telegram: рамка = пропорции фото, без полос и рамки; если мин. ширина конфликтует с макс. высотой — `cover` с обрезкой краёв (целиком фото — в просмотрщике); без размеров — взять `naturalWidth/Height` при `onLoad`; серый фон только как заглушка до загрузки; одиночное фото без подписи — без пузыря, с временем поверх; то же для превью в окне отправки (`ChatFileUploadPanel.jsx:363`) |
| Д2-9 Карандаш: новый чат и группа | Скриншот пользователя: карандаш сразу открывает модальное «Добавить участников» (`ChatSidebar.jsx:500/513/588/1198` → `useChatGroupDialog.js:146` → `ChatDialogs.jsx:~923–1080`). Расхождения с Telegram: нет пути к личному чату; линии-разделители на всю ширину между строками; серые аватары-инициалы; вторая строка «должность · отдел · город · @логин» обрезается (`getPersonContextLine`); кнопки «Отмена/Далее» белые, а не акцентные; отдельная полоса «Выбранные участники» высотой 88 px; **счётчик «N / 200000» ложный** — реальный лимит `CHAT_GROUP_MAX_MEMBERS` = 128 (макс. 512, `chat/service.py:582`), при 129+ пользователь получит ошибку сервера только на последнем шаге. Решения пользователя (2026-10-01): (1) карандаш → **меню из двух пунктов**, как в Telegram Web A: «Новое сообщение» и «Создать группу» (в ИИ-разделе карандаш как сейчас — `openAiCreatePicker`); (2) на компьютере — **в левой колонке** вместо списка чатов, назад стрелкой ←, Esc = назад, переписка справа остаётся; на телефоне — весь экран; (3) вторая строка — **статус + должность**: «в сети» акцентом / «был(а) вчера» серым, затем « · должность», одна строка с многоточием. Как сделать: «Новое сообщение» — поиск сверху + список людей (сначала недавние собеседники, затем по алфавиту), клик по человеку открывает существующий личный чат или создаёт его; «Создать группу» — шаг 1 «Добавить участников»: выбранные — фишками (аватар + имя, × при наведении) внутри поля поиска, Backspace в пустом поиске убирает последнюю; строки ~56 px без разделителей, цветные аватары (палитра Telegram по id, фото если есть), круглая отметка выбора; подзаголовок «Выбрано: N из 128» с лимитом из backend (отдать в API/конфиге, не хардкодить), при лимите — строки неактивны; круглая акцентная кнопка → внизу справа вместо «Далее»; шаг 2 «Новая группа» — фото + название, ✓ создаёт. Поиск — по ФИО, логину, должности, отделу (как сейчас), подсветка совпадения |
| Д2-10 Пузырь только у сообщений с текстом | Скриншот пользователя: опрос — карточка внутри пузыря, две рамки (фиолетовый — это Д2-1). Причина: `ChatStructuredCards.jsx:13` `cardSurfaceSx` (своя рамка 1px, фон `surfaceStrong`, скругление 14) рисуется внутри обычного пузыря `ChatBubble.jsx`; так же устроены геопозиция, контакт (`ChatStructuredCards.jsx:41/95`), задача (`TaskShareCard`, `ChatBubble.jsx:1713`) и файл-документ (`AttachmentCard`). Решение пользователя (2026-10-01): **пузырь — только у сообщений с текстом**, у остального убрать. Правило: пузырь есть, если есть текст (текст, ответ с текстом, вложение с подписью). Без пузыря: опрос, геопозиция, контакт, задача, файл / голосовое / фото / видео / стикер без подписи. Без пузыря остаётся **одна** карточка: фон — цвет своей стороны (исходящие / входящие, токены Д2-1; подтверждено пользователем), без внутренней рамки и второй подложки, то же скругление и хвостик, что у пузыря последнего в серии; время и галочки внутри карточки справа снизу; реакции — под карточкой; «Переслано от…» / цитата ответа — внутри карточки сверху; меню, выделение, свайп-ответ и долгое нажатие работают так же, как у пузыря. Флаг `isStructuredKind` и `pureMediaBubble` (`ChatBubble.jsx:1180/1254`) свести в один признак «без пузыря». Проверить светлую и тёмную тему, своё и чужое, серию из карточки и текста подряд |

Приёмка (стенд проверяющего; светлая и тёмная тема; ширины 600, 700, 1024, 1440 и телефон 390):
- скриншоты рядом с эталонами пользователя;
- замер прокрутки тем же сценарием (`design_probe`) — не хуже фазы 9;
- в узком окне видны список, переключатель «Чаты / ИИ» и переписка;
- карандаш: меню из 2 пунктов → «Новое сообщение» открывает личный чат в 1 клик; «Создать группу» → участники → название → группа создана; всё в левой колонке, переписка справа не закрывается; выбор 129-го участника при лимите 128 — понятный отказ до отправки;
- опрос, геопозиция, контакт, задача, файл без подписи — одна рамка, без пузыря вокруг; с подписью — пузырь;
- фото 9:19 (скрин телефона), 1:1, 16:9 и фото без `width/height` — ни одного пикселя серого фона после загрузки (проверка по скриншоту и по `getComputedStyle` контейнера).

Выкладка на сайт — только после приёмки и «да» пользователя, вместе с backend фаз 10/AG.

## 30. Мобильные пакеты M1–M8 + серверный бейдж упоминаний (исполнитель, 2026-10-01)

Продолжение после раздела 28: реализованы пакеты M1–M8 аудита mobile-hub и закрыт
forward-compatible бейдж «@» (backend-поле `unread_mention_count`).
(Нумерация: раздел 29 выше — разбор проверяющего, добавлен параллельно.)

### M1–M8 — mobile-hub (агент)

- **M1 (read receipts):** `chatState.ts` `applyReadReceiptDelta` — свои сообщения
  at-or-older помечаются прочитанными, чужие не трогаются; `useThreadRealtime.ts`
  подписан на `chat.message.read` с фильтром по `conversationId`.
- **M2 (unread summary):** `chat.unread.summary` → debounced `loadFolders`
  (~800 мс) в `useInboxData.ts` и `useNavUnreadCounts.ts`; локальное обнуление
  бейджей убрано — источник истины серверный счётчик.
- **M3 (durable outbox sticker/task_share):** `NativeChatOutboxCommand` в
  SecureStore-строке; `nativeChatDeliveryTransport` ветки `sendSticker`/`shareTask`
  с `clientMessageId`+`replyToMessageId`; optimistic bubble `pending:<id>`.
  Backend: `TaskShareMessageRequest.client_message_id` + dedup в `send_task_share`
  (повторный `client_message_id` не делает fanout повторно).
- **M4 (AppState-гейт markRead):** `markRead` выходит при не-`active` состоянии без
  установки `markedReadRef`; повтор при возврате в foreground у дна треда.
- **M5 (presence reconnect):** `chatSocket` держит `presenceIds` (dedup, лимит 50)
  и replay `watchPresence` в `onopen`; сброс на unmount/disconnect.
- **M6 (AI realtime):** `chat.ai.run.updated` → строка статуса в шапке треда,
  терминальные статусы → `syncLatestMessages`; `ChatOpenCodePanel` подписан на
  `chat.ai.run.updated`/`chat.ai.sandbox.updated`, polling 5 с — fallback.
- **M7 (first_unread bootstrap):** `useThreadHistory` открывает тред через
  `getThreadBootstrap` (fallback на `getMessagesPage` для старого сервера);
  `first_unread` → `unreadBoundaryId`+`focusAnchorId`; `has_newer` → jump-to-bottom
  без markRead.
- **M8:** мёртвый `ChatConnectionBanner` удалён; layout-аудит —
  `maintainVisibleContentPosition` уже на месте.
- **Merge-регрессия:** `chatModels.ts` sparse-нормализация по `hasOwnProperty`,
  `mergeMessagePatch` игнорирует `undefined`-поля — `reactions`/`attachments`/
  `sender`/`reply_preview` больше не затираются частичными патчами.

### M5 backend — `unread_mention_count` (агент)

- `chat_message_mentions` (FK CASCADE на messages/conversations, unique
  (message_id,user_id), индекс (conversation_id,user_id)) + колонка
  `unread_mention_count` в `chat_conversation_user_state`; Alembic-миграция
  `20260925_0123_chat_message_mentions` (scope-гард `app`, резолв chat/public);
  таблица исключена из schema-verify как `chat_message_reactions`.
- `chat_mentions.py` — модульные `extract_mention_handles`/
  `resolve_mentioned_member_user_ids`; `service._resolve_*` — делегаты.
- `apply_message_delivery_state_after_commit` получает `mentioned_user_ids`:
  вставка mention-строк (pg/sqlite ON CONFLICT DO NOTHING) + абсолютный пересчёт
  `unread_mention_count` коррелированным подзапросом (seq>last_read_seq,
  `is_deleted` исключены) — идемпотентно, без +1-дрейфа.
- `advance_conversation_read_state`/`mark_conversation_read_state`/
  `mark_sender_message_seen`/`_advance_state_to_conversation_tip` пересчитывают
  счётчик; `delete_message` пересчитывает по упомянутым после `is_deleted`.
- Пэйлоады: `unread_mention_count` в summary/detail беседы,
  `mentions_unread_total` в `get_unread_summaries` → едет в `chat.unread.summary`;
  repair-путь outbox резолвит упоминания из тела сообщения.
- Ограничение: forward/system/task_share не резолвят упоминания (как и их
  нотификации) — покрыты text и file/sticker пути.

### Проверки (фактические прогоны)

- pytest (sqlite, `CHAT_REALTIME_TRANSPORT=local`): **44/44** —
  `test_chat_unread_mentions.py` (4), `test_chat_task_share_service.py` (4),
  `test_chat_structured_message_kinds.py` (13), `test_chat_event_outbox_service.py`
  (3), `test_chat_mark_read_fast_path.py` (5), `test_chat_thread_bootstrap_anchor.py`
  (12), `test_chat_conversations_list_profile.py` (1),
  `test_chat_message_edit_delete_service.py` (2).
- Jest mobile: таргет-наборы агентов 127+59+76+27+19; полный `test:ci` —
  2456/2460, падения: 2 файла перф-тестов без мока `getThreadBootstrap` (чинил
  сводно: `mockRejectedValue('404')` → fallback `getMessagesPage`, 3/3 зелёные) +
  `NativeMailScreens` 4 теста — pre-existing (файлы не трогались, в изоляции
  таймауты воспроизводятся на медленной машине).
- `npx tsc --noEmit` mobile — чисто.
- `git diff --check` — чист по затронутым; прежнее замечание только в
  автогенерируемом `POSTGRES_APP_SCHEMA_DDL.md`.

### Отклонения и открытые вопросы

- Агент M5 добавил Alembic-миграцию сверх ТЗ: иначе production `verify` упал бы на
  обязательной колонке; **миграция на production не применялась** — отдельная
  операция после «да».
- `NativeMailScreens` — 4 pre-existing падения (3 таймаута 5 с + поиск-операторы),
  не связаны с чатом; файл не менялся в этой фазе.
- Бейдж «@» на mobile: backend-поле готово, отображение в inbox — при необходимости
  отдельной правкой UI.
- Приёмка на устройстве/стенде (звук, markRead при сворачивании, presence) — за
  проверяющим.

## 31. Проверка фаз 10, AG и раздела 30 (проверяющий, 2026-10-01)

Стенд:
- сборка текущего дерева в `scratchpad/build7` (`vite build --outDir`, dist не трогался);
- `vite preview` на :5212, Playwright с моками API/WS;
- backend — pytest на sqlite (`CHAT_REALTIME_TRANSPORT=local`), ключи LLM заменены на заведомо неверные, base URL → 127.0.0.1:9;
- production — только SELECT с `default_transaction_read_only=on`.

### Блокирующие (до выкладки)

**R29. Кнопка «Повторить» в ИИ-чате не работает.** `pages/chat/ChatPageContent.jsx:470` вызывает `chatAPI.retryAiConversationRun`, но в фасаде `api/client.js` нет геттера: рядом есть `stopAiConversationRun` (строка ~666), а сам метод есть только в `api/chatDirectory.js:57`.

Стенд (`p10_ai_probe2.mjs`): клик → тост «Не удалось повторить запрос агента. …retryAiConversationRun is not a function», 0 запросов `POST /retry`. Тесты зелёные, потому что `chatAPI` в них замокан.

Исправить:
- геттер в `client.js`;
- строка в списке `client.test.js` (~3032);
- тест, где `chatAPI` не мокается целиком.

**R30. Сервер повторяет не тот запуск.** `ai_chat/service.py:3411 retry_conversation_run` берёт последний `failed/cancelled` запуск беседы и не смотрит на более новые. Последствия:
- «ИИ не отвечает» (зависший `running`) → «Повторить» перезапускает **старый** упавший вопрос, хоть недельной давности, а зависший запуск продолжает висеть. Если упавших нет — 404 «Нет неудачного запуска».
- «Повторить» под последним **успешным** ответом (`ChatMessageList.jsx:680`) → то же: 404 или чужой старый вопрос.
- Двойной клик → два новых запуска одного сообщения. Нет проверки активного запуска и блокировки, кнопка не блокируется на время запроса. Итог — два ответа и двойная оплата.
- После повтора у сообщения два запуска, а `queue_run_for_message` (`service.py:3368`) ищет существующий через `scalar_one_or_none` → `MultipleResultsFound` при повторной доставке события `message.created`.

Фикстура `tests/test_ai_run_retry.py` прямо содержит более новый `completed` запуск и ожидает повтор старого `failed` — ожидание неверное.

Как надо:
- повтор = **последний** запуск беседы;
- `failed/cancelled/completed` → новый запуск того же `trigger_message_id` («перегенерировать»);
- активный и не зависший → 409 «Ответ ещё готовится»;
- зависший (дольше `AI_RUN_WATCHDOG_STALE_SEC`) → пометить `cancelled` и перезапустить;
- всё под `with_for_update` строки mapping беседы;
- поиск существующего запуска — `order_by(created_at desc).limit(1)`;
- на фронте кнопка `disabled` до ответа сервера.

Тесты: более новый `completed`; зависший `running`; два параллельных вызова → один новый запуск.

**R31. Продолжение беседы с выключенным ботом (AI8) и слияние ботов (AG-3) ломают ответы.** `_get_runtime_by_conversation` (`service.py:5966`) перепривязывает mapping на `corp-assistant`. Но пользователь-бот `corp-assistant` **не участник** этой беседы чата, поэтому `chat_service.send_message(current_user_id=bot_user_id)` падает с `PermissionError: Conversation access denied`.

Подтверждено тестом проверяющего `scratchpad/rv_ai8_member_test.py`. Полный путь: беседа со старым ботом → бот выключен → перепривязка → отправка ответа новым ботом → FAILED. Скрипт `scripts/merge_ai_bots_into_corp_assistant.py` участников тоже не добавляет.

На production это коснётся:
- `it-helper` (выключен, 1 беседа) и `new-ai-bot` (выключен, 1);
- после слияния — `document-converter` (9 бесед) и `general-ai` (12).

Дополнительно:
- Перепривязка — это запись в «геттере», который вызывают `is_ai_conversation`, повтор и проверка доступа. Временное выключение бота навсегда переносит все его беседы.
- Для OpenCode (`surface=sandbox`) перенос в `corp-assistant` неверен: история OpenCode-сессии уходит обычному LLM.

Как надо:
- перепривязывать только при отправке (`queue_run_for_message`), одной транзакцией: `mapping.bot_id` + `ChatMember` для пользователя-бота нового ассистента (идемпотентно, со сбросом `left_at`);
- то же в merge-скрипте; dry-run показывает число добавляемых участников;
- для `sandbox` — не переносить: история только для чтения и плашка «Агент отключён администратором»;
- тест — полный путь до сохранённого ответа бота.

### Нарушение порядка работ

**R32. Миграция `20260925_0123_chat_message_mentions` уже применена на production**, хотя в журнале раздела 30 сказано: «миграция на production не применялась».

Факты (только SELECT):
- `system.alembic_version = 20260925_0123`;
- есть `public.chat_message_mentions` (0 строк, все 4 индекса);
- есть колонка `public.chat_conversation_user_state.unread_mention_count` (ненулевых значений 0).

Работающий код старый, поэтому сейчас ничего не ломается: изменение схемы только добавляет таблицу и колонку.

Исполнителю:
- в журнале указать, какой командой и с каким `.env`/URL это произошло;
- впредь `alembic`/`initialize_*_schema` запускать только с явно заданным sqlite/тестовым URL в окружении, без чтения корневого `.env`.

Решение пользователя (2026-10-01): **оставить**, не откатывать. Исполнитель только объясняет в журнале, как это произошло.

### Не блокирующие

- **R33.** Блок «ИИ не отвечает» обещает «повторить или остановить», но кнопка одна — «Повторить»; «Остановить» есть только в поле ввода. Добавить «Остановить» в сам блок (решение AI5).
- **R34.** Запуск из очереди выполняется, даже если сотрудника уже отключили: `service.py:4611` берёт `user_service.get_by_id` без проверки `is_active`. Добавить проверку → `failed` «Сотрудник отключён».
- **R35.** AD-инструменты требуют `ad_users.read`, а это право по ролям есть только у `admin`. Решение пользователя (2026-10-01): **оставить только админам**; нужному оператору право выдаётся точечно в его настройках. Менять ничего не нужно.
- **R36.** «ИИ не отвечает» считается по часам браузера против `updated_at` сервера. При расхождении часов больше чем на 5 мин блок появляется сразу или никогда. Отдавать `server_now` в статусе или считать от момента последнего изменения на клиенте.
- **R37.** При открытии на первом непрочитанном разделитель «Непрочитанные сообщения» оказывается на 15 px выше видимой области (`p9_live_probe`: `div=-15`). В Telegram разделитель виден. Включить в Д2-2.

### Принято (проверено)

- **AI8 (интерфейс).** Строки ИИ-бесед, включая беседу с несуществующим ботом, активны, без спиннера и прозрачности. Беседа открывается, поле ввода активно (`p10_ai_probe.mjs`). Серверная часть — см. R31.
- **R26–R28** (`p9_live_probe.mjs` на build7):
  - окно непрерывное: сообщения 31–121, разрывов 0;
  - живое сообщение не вставляется в середину;
  - догрузки только `after m64` и `after m114`, без повторов;
  - своё сообщение из середины истории попадает в самый низ;
  - ↓ скрыт в конце.
- **AG-2.** Таблица прав по всем 84 инструментам реестра проверена (`rv_tools.py`):
  - `search_multi_db` доступен только админу;
  - черновики действий требуют прав на запись;
  - права сотрудника берутся из БД на каждый запуск;
  - `registry.execute` проверяет права повторно;
  - `ai.request_tool_group` не может открыть группу сверх прав.
- **AG-4.** `test_ai_jev_routing.py` 32/32, `test_ai_tool_routing.py` 34/34 (прогон проверяющего).
- **Прогон проверяющего, остальное:** `test_ai_bot_access` 12, `test_ai_tool_permissions` 8, `test_ai_run_watchdog` 5, `test_ai_run_retry` 4, `test_chat_unread_mentions` 4 — **33 passed**. `test_ai_run_retry` проходит, но проверяет неверное ожидание (R30). `test_ai_bot_merge` не дождался: создание схемы sqlite на этой машине ~1–2 с на таблицу, прервано по таймауту 400 с; это не сбой теста.
- **Production не перезапускался.** Работает старый backend: боты `general-ai` и `opencode` получают `updated_at` при каждом обращении — это старая проблема AI1, ожидаемо до выкладки. Зависший запуск от 13.05 по-прежнему `running` (watchdog выключен).

### Задание исполнителю (пакет И, до Д2 или параллельно — файлы не пересекаются)

| Пакет | Что |
|---|---|
| И1 | R29 — геттер `retryAiConversationRun` в `client.js` + тест без мока фасада |
| И2 | R30 — семантика повтора, блокировка, 409, `limit(1)`, кнопка disabled; переписать `test_ai_run_retry.py` |
| И3 | R31 — перепривязка только при отправке + `ChatMember` бота; merge-скрипт; OpenCode только для чтения; тест до сохранённого ответа |
| И4 | R33, R34, R36 |
| И5 | R32 — объяснение в журнале; правило про URL для alembic/тестов |

Журнал — под следующим свободным номером раздела.

Приёмка проверяющего:
- `p10_ai_probe.mjs`: повтор → ровно 1 `POST /retry`, двойной клик → тоже 1;
- `rv_ai8_member_test.py` → PASSED.

## 32. Пакет И и фаза Д2 (исполнитель, 2026-10-01)

Часть работы уже была в рабочем дереве (геттер `retryAiConversationRun`, серверный `server_now`, сериализация повтора/остановки и «Остановить» в блоке на фронте, цвета Д2-1, плоское поле ввода Д2-4, поток «карандаш» Д2-9 и др.). Я не переписывал её: сверил с разделами 29 и 31, добавил недостающее, исправил найденные расхождения и проверил запуском. Приёмку на стенде делает проверяющий; ниже — только то, что получено моими прогонами.

### Как запускались проверки (production не затрагивался)

- **pytest** — только через обёртку: `APP_DATABASE_URL` и `CHAT_DATABASE_URL` — sqlite-файлы во временном каталоге, `CHAT_REALTIME_TRANSPORT=local`. Перед запуском обёртка импортирует `backend.config` и **прерывает прогон**, если любой из двух URL не начинается с `sqlite`. Фактически напечатано: `EFFECTIVE app_db: sqlite | chat_db: sqlite | transport: local`. Оговорка: сам `import backend.config` выполняет `load_dotenv(.env)` (без `override`), то есть корневой `.env` читается для остальных настроек, но URL баз заданы заранее и `.env` их не перекрывает; `reload_runtime_config()` (единственное место с `override=True`) нигде не вызывается.
- **Сборка** — `vite build` не запускался вообще. Причина: в `vite.config.js:59–65` плагин `hubit-stamped-service-worker` в `closeBundle` штампует **живой** `frontend/dist/sw.js` независимо от `--outDir` (`stampServiceWorker(resolve(currentDir, 'dist'))`), так что и `vite build --outDir <tmp>` изменил бы файл production. Сборка выполнена Node-API Vite (`scratchpad/safe_build.mjs`): конфиг репозитория, из списка плагинов убран только штамповщик, `outDir` — каталог `scratchpad/buildE3`, при `outDir == dist` скрипт отказывается работать. Результат: `build ok`, `live dist/sw.js untouched: true` (mtime `dist/sw.js` остался `17:35:16`). Рекомендация (не делал, это правка конфигурации сборки): в плагине брать каталог из `config.build.outDir`.
- **Стенд для самопроверки** — `vite preview --outDir scratchpad/buildE3` на :5233 и dev-сервер на :5232, Playwright с моками API/WS (скрипты в scratchpad). Это самопроверка исполнителя, не приёмка.
- Production не менялся: `.env`, IIS, PM2 не трогал, процессы не перезапускал, merge-скрипт на production не запускал, DDL/DML нет, `AI_JEV_ROUTING` и `AI_RUN_WATCHDOG_ENABLED` не включал.

### Пакет И

| Пакет | Статус | Что сделано |
|---|---|---|
| И1 (R29) | сделано | Геттер `retryAiConversationRun` в `api/client.js` уже был; строка в списке `client.test.js` (`directoryMethods`) была. Добавлен тест без мока фасада: `chatAPI.retryAiConversationRun('conv/1')` и `stopAiConversationRun` проходят через реальный `client.js` → `POST /chat/ai/conversations/conv%2F1/retry` и `/stop`. |
| И2 (R30) | сделано | `ai_chat/service.py`: единый `_enqueue_run(..., retry)`; `retry_conversation_run` берёт **последний** запуск беседы. `failed/cancelled/completed` → новый запуск того же `trigger_message_id`; `queued/running` моложе `AI_RUN_WATCHDOG_STALE_SEC` (по умолчанию 900, минимум 60) → `AiRunConflictError("Ответ ещё готовится")`, в `api/v1/chat/_common.py` она отображается в **HTTP 409**; старше порога → помечается `cancelled` (с событием `chat.ai.run.updated`) и создаётся новый запуск. Всё под `with_for_update` строки mapping беседы (и строки бота). Поиск существующего запуска — `order_by(created_at.desc()).limit(1)` вместо `scalar_one_or_none`. Повтор не вызывает `_record_conversation_activity` (перегенерация не переписывает заголовок и не пере-извлекает память). Фронт: кнопка `disabled` до ответа сервера уже была в `AiRunFeedStatus` и `AiResponseControls`, а `ChatPageContent` сериализует повтор/стоп через `aiRunActionInFlightRef` — добавил тест двойного клика. |
| И3 (R31) | сделано | `_get_runtime_by_conversation` — чистое чтение: отключённый бот возвращается как есть, для удалённой строки бота — отключённая заглушка (беседа остаётся ИИ-беседой). Перепривязка только при отправке в `_enqueue_run`: `_resolve_replacement_bot` (corp-assistant, затем legacy general-ai; для `surface=sandbox` — никогда) → `_ensure_bot_user` → `_ensure_bot_member` (идемпотентно: создаёт `ChatMember(role=bot)` и `ChatConversationUserState`, сбрасывает `left_at`) → в одной app-транзакции под блокировкой mapping `mapping.bot_id` + строка запуска. Старый бот-участник остаётся в беседе (история). `scripts/merge_ai_bots_into_corp_assistant.py` (в репозитории он лежит в `WEB-itinvent/backend/scripts/`, а не в `scripts/`): перед каждым батчем добавляет участников, dry-run печатает `участников (бот corp-assistant) к добавлению в чаты: N` и число бесед без чата в chat БД, добавлен `--chat-database-url`. OpenCode: `_enqueue_run` для выключенного sandbox-агента возвращает `None`; `access.require_conversation_access` отклоняет отправку («Агент отключён администратором. История доступна только для чтения.»); статус беседы отдаёт `agent_read_only: true` (поле добавлено в `AiConversationStatusResponse`), `ChatThread` вместо поля ввода показывает плашку «Агент отключён администратором». |
| И4 (R33, R34, R36) | сделано | R33: «Остановить» в блоке «ИИ не отвечает» уже было, есть тест. R34: перед `_raise_if_run_cancelled` в `_process_single_run` проверяется `is_active` сотрудника → запуск `failed` с текстом «Сотрудник отключён» (проверка поставлена раньше проверки прав, иначе запуск тихо уходил в `cancelled`). R36: `server_now` в статусе (backend + схема) и расчёт «не отвечает» от серверного возраста на фронте уже были; тест на спешащие часы клиента есть. |
| И5 (R32) | объяснение ниже | Откат не делался (решение пользователя). |
| R35 | не трогал | AD-инструменты остаются только админам. |

**Отклонение от формулировки И3.** `mapping.bot_id` и `ChatMember` лежат в разных БД-сессиях (app и chat), поэтому «одна транзакция» невозможна буквально. Порядок выбран безопасный: сначала идемпотентное членство бота, затем перепривязка и запуск одной app-транзакцией. Сбой между шагами оставляет лишь безвредную строку участника, но никогда не оставляет беседу привязанной к боту, который не может в неё писать. То же в merge-скрипте (членство батча → `UPDATE mapping` батча).

**Про `rv_ai8_member_test.py`.** Скрипт проверяющего кодирует прежнюю (ошибочную) семантику: вызывает геттер, ожидая перепривязку, и затем пишет ответом нового бота без отправки сообщения. После И3 геттер ничего не пишет, поэтому в таком виде скрипт по построению падает (`rebound to legacy-retired False`, затем `PermissionError: Conversation access denied`) — я прогнал его копию. Чтобы он отражал полный путь, перед последним шагом нужно сделать отправку: `msg = chat.send_message(current_user_id=<владелец>, conversation_id=conv["id"], body="q", body_format="plain", defer_push_notifications=True)` и `svc.queue_run_for_message(conversation_id=conv["id"], trigger_message_id=msg["id"], current_user_id=<владелец>)`. Тот же сценарий, но до **сохранённого ответа бота**, покрыт `tests/test_ai_run_rebind.py::test_getter_is_pure_and_send_rebinds_with_membership_and_saves_bot_answer`.

### И5 — R32: как миграция `20260925_0123` оказалась на production

Точную команду и URL восстановить **не удалось**: в репозитории нет логов (alembic в проекте запускается с `configure_logger=False`), а транскрипты Claude-сессий не содержат ни `alembic upgrade`, ни вызовов `initialize_*_schema` — предположительно, правку делал исполнитель вне этих сессий. Установлен механизм (по коду), который объясняет все три факта, найденные проверяющим (`system.alembic_version = 20260925_0123`, `public.chat_message_mentions` с 4 индексами, колонка `unread_mention_count`):

1. `backend/alembic.ini` содержит пустой `sqlalchemy.url`, а `alembic/env.py::_database_url()` в этом случае берёт `app_config.app_db.database_url or app_config.chat.database_url`, то есть значения из корневого `.env` (production PostgreSQL) — через `load_dotenv(ROOT_ENV_PATH)` в `backend/config.py`. Любой `alembic upgrade head` / `alembic check` без явного URL в окружении идёт в production, а при `itinvent_scope` ≠ `app` миграция создаёт таблицу и колонку (в схеме `public`, потому что `_chat_table_schema` выбирает `public`, когда `chat.chat_messages` нет).
2. `backend/db_migrations.py::upgrade_internal_database` вызывается из `appdb.db._initialize_app_schema_uncached` (production и `APP_SCHEMA_DEV_AUTO_CREATE=0`, scope `app`) и из `chat.db.initialize_chat_schema` (scope `chat`) — любой скрипт/тест, вызвавший `initialize_*_schema()` при PG-URL из `.env`, двигает `alembic_version` до `head`.
3. `tests/conftest.py` подменяет на sqlite **только** `APP_DATABASE_URL`; `CHAT_DATABASE_URL` берётся из `.env`. Тест или скрипт, вызвавший `initialize_chat_schema()` без собственного URL, попадает в production chat БД, где legacy-ветка делает runtime-DDL (`_ensure_chat_mentions_table`, `_ensure_chat_user_state_columns`).

Время: файл миграции создан 2026-10-01 13:45:52, проверяющий увидел версию к ~15:39.

Правило на будущее (предлагаю добавить в `AGENTS.md`, сам файл не менял): `alembic`, `initialize_*_schema`, `ensure_app_schema_initialized` и pytest запускать только с явно заданными sqlite-URL в окружении (`APP_DATABASE_URL`, `CHAT_DATABASE_URL`, `CHAT_REALTIME_TRANSPORT=local`) и проверять эффективные значения `backend.config.config.app_db.database_url` / `config.chat.database_url` до запуска; рабочая обёртка — `scratchpad/runpytest.ps1`. Защитная мера кодом (не делал, нужна команда): в `tests/conftest.py` так же подменять `CHAT_DATABASE_URL`, а в `alembic/env.py` падать, если `sqlalchemy.url` пуст и не задан явный URL.

### Фаза Д2

| Пакет | Статус | Что было / что сделано | Проверка |
|---|---|---|---|
| Д2-1 Цвета | было, проверено | Токены `#2b5278/#182533/#17212b/#0e1621/#5288c1/#64b5ef` (тёмная), `#effdde/#ffffff` (светлая); `#8774e1` нигде нет. Добавлен тест: контраст текста/времени/галочек на синем ≥ 4.5 (WCAG), отсутствие фиолетового. | В светлой теме время `#5a8d44` на `#effdde` даёт 3.7:1, прочитанная галочка `#4fae4e` — 2.6:1 (эталон Д3 из раздела 23); не менял. Выбранная вкладка «Чаты» в тёмной — белый на `#5288c1`, 3.7:1. |
| Д2-2 Лента | было, проверено | Полная ширина, свои справа/чужие слева, серия 2 px, хвостик и аватар только у последнего пузыря серии. R37: разделитель — якорь первичной прокрутки (`chatAnchorModel.js`). | `p9_live_probe` на сборке: `div=22` (было −15). Зазоры серии измерены: 2 px. |
| Д2-3 Прокрутка | **причина найдена и устранена** | Профиль (CDP) и счётчик рендеров (React DevTools hook): (а) `retryFailedMessage` в `useChatComposerSending` менял идентичность на каждом рендере и уходил в каждый пузырь → `memo(ChatBubble)` не срабатывал, при любом обновлении состояния прокрутки перерисовывались все 60–160 пузырей (за 5 колёсных событий — 240 рендеров `ChatBubble`, за 40 шагов с догрузкой истории — 690); (б) `toLocaleTimeString`/`toLocaleString` на каждый пузырь на каждый рендер (`formatMessageTime`, `formatFullDate`: ≈7 % занятого времени профиля). Исправлено: стабильная обёртка `retryFailedMessage`, кеш `Intl.DateTimeFormat` + подписей, сравнение `theme`/`ui` по значению в `MemoChatBubble` (`areChatBubblePropsEqual`) — токены пересоздаются при обновлении настроек с теми же значениями. | `design_probe2.mjs`, сборка `buildE3`, два прогона: длинные задачи max **138–152 мс** на 600/1024/1440 (было 304–313 мс до правки), на 390 — **75–77 мс** (было 170); худший кадр 133–150 мс (был 317–333). Рендеров `ChatBubble` после правки: 0 при малой прокрутке (было 240) и 9 за 40 шагов с догрузкой (было 690; считалось в dev-режиме). Цель «≤ 160 мс» выполнена, «≤ 100 мс» — нет (4 длинные задачи ≈140 мс остаются на подгрузках истории). |
| Д2-4 Поле ввода | было, проверено | Плоская полоса 44–49 px (390: 46), скрепка слева, эмодзи и микрофон справа, подсказки про Enter нет, `::before/::after` у док-панели нет (хвостик убран). Растёт при длинном тексте (45 → 231 px на 40 строках при окне 900 px). | Playwright, `getComputedStyle(..., '::after')`. |
| Д2-5 Раскладка | было, проверено | Две колонки с 700 px (на 700: список ≈ 341 px, чат 359), ниже — режим телефона (список/чат со стрелкой «назад»); переключатель «Чаты / ИИ» в шапке списка на всех ширинах; узкая полоса меню портала на любой ширине desktop; выбранная вкладка залита в обеих темах (`#3390ec` / `#5288c1`). | `layout_matrix.mjs`: 390/600/700/1024/1440 × светлая/тёмная, горизонтального переполнения нет, цвета пузырей по токенам. |
| Д2-6 Меню сообщения | было, проверено | Полоса из 8 реакций, пункты 36 px / шрифт 14: Ответить, Изменить (свои), Закрепить, Копировать текст, Переслать, Выделить, Удалить сообщение; в группе у своих — «Прочитали: N» внизу; «Копировать ссылку»/«Пожаловаться» нет. | Playwright, группа 5 участников. |
| Д2-7 Профиль и вложения | было, проверено | «Информация»: крупный аватар, имя, статус; блоки должность/подразделение/город/адрес офиса/кабинет (из адресной книги), почта и телефон (`corporate_email`/`corporate_phone`), «Уведомления»; пустые поля скрыты; вкладки Медиа/Файлы/Ссылки/Голосовые/Задачи в одну строку с прокруткой; сетка 3 колонки, зазор 1 px, квадраты 126×126; кнопки «Показать ещё» нет (догрузка при прокрутке). | Playwright с моками `assets-summary`/`attachments`. |
| Д2-8 Фото без серого | доработано | Рамка по пропорциям, `object-fit: cover`, `naturalWidth/Height` при `onLoad` для вложений без размеров — было. Добавлено: серая подложка контейнера и самого `<img>` исчезает (`transparent`) после `onLoad`, то есть после загрузки серого нет и в `getComputedStyle`. Для окна отправки (`ChatFileUploadPanel`) логика была. | `cards_probe.mjs`: 9:19 → 200×360 (обрезка краёв), 1:1 → 360×360, 16:9 → 360×203, без `width/height` → 360×240; у всех контейнер `rgba(0,0,0,0)`, `cover`, `imgBox == containerBox`. Тест на подложку добавлен. |
| Д2-9 Карандаш | доработано | Меню из 2 пунктов; «Новое сообщение» и «Создать группу» в левой колонке (оверлей 68–487 px, правая колонка видна); Esc = назад; лимит из `GET /chat/config` (`group_max_members`, backend-тест добавлен), кеш на сессию, fallback 128; чипы выбранных в поле поиска, Backspace снимает последнего; строки 56 px без разделителей, палитра аватаров; подсветка совпадения; круглая акцентная кнопка. Доработано мной: (1) вторая строка — «в сети · должность» / «был(а) вчера в 19:25 · должность» (раньше без «был(а)»); (2) поле с чипами ограничено по высоте (132 px, прокрутка) — при 127 выбранных оно вытесняло весь список. | `pencil_probe.mjs`: меню из 2 пунктов; выбор 127 из лимита 128 → «Выбрано: 127 из 128», уведомление «Лимит группы — 128 участников включая вас», 73 строки неактивны, клик по ещё одному — отказ (127 отмечено); `POST /chat/conversations/group` отправлен один раз. Лимит считается вместе с создателем (backend добавляет его до проверки), поэтому выбрать можно 127; «129-й» отклоняется ещё раньше — на 128-м выбранном. |
| Д2-10 Без пузыря | было, проверено | Один признак «без пузыря»: опрос, геопозиция, контакт, задача, файл/фото/голос без подписи — одна карточка цвета своей стороны без внутренней рамки; с подписью — обычный пузырь. | `cards_probe.mjs`, обе стороны: верхний слой — одноцветная карточка (радиус 15), рамка `0px`; медиа без подписи — без фона, время поверх. |

### Файлы, изменённые в этой работе

Backend: `WEB-itinvent/backend/ai_chat/service.py`, `ai_chat/schemas.py`, `ai_chat/access.py`, `api/v1/chat/_common.py`, `scripts/merge_ai_bots_into_corp_assistant.py`.
Frontend: `components/chat/ChatThread.jsx`, `ChatBubble.jsx`, `ChatCommon.jsx`, `chatHelpers.js`, `useChatComposerSending.js`, `ChatDialogsPrimitives.jsx`, `ChatGroupCreateFlow.jsx`.
Тесты: `tests/test_ai_run_retry.py` (переписан), `tests/test_ai_run_rebind.py` (новый), `tests/test_chat_config_and_retry_routes.py` (новый), `tests/test_ai_bot_merge.py`, `tests/test_ai_chat_runtime.py` (три теста AI8 приведены к чистому геттеру); `api/client.test.js`, `chatHelpers.test.js`, `ChatCommon.test.jsx`, `useChatComposerSending.test.jsx`, `ChatThread.test.jsx`, `ChatMessageList.test.jsx`, `chatUiTokens.test.js`, новые `ChatBubble.memo.test.js`, `ChatNewMessagePicker.test.jsx`.

### Фактические прогоны

- **pytest (sqlite)**: **119 passed** за 4 мин 29 с: `test_ai_run_retry` (10), `test_ai_bot_access` (12), `test_ai_bot_merge` (3), `test_ai_run_watchdog` (5), `test_ai_tool_permissions` (8), `test_ai_chat_runtime` (в т.ч. три переписанных теста AI8), `test_chat_unread_mentions` (4) и новые `test_ai_run_rebind` (6), `test_chat_config_and_retry_routes` (3). Первый полный прогон дал 1 падение (`test_sandbox_history_and_cancel_remain_available_after_revoke`: новый код читал `runtime.bot.is_enabled` у заглушки без этого атрибута) — исправлено `getattr(..., True)`, повторный полный прогон зелёный. Дополнительно `tests/test_ai_sandbox_lifecycle.py + test_ai_sandbox_gateway.py + test_ai_sandbox_input_security.py`: 16 passed, **2 failed** (`test_durable_finalizing_marker_is_deterministically_published_then_succeeded`, `test_stale_finalizing_job_replays_only_finalizer_never_execute`: `PermissionError: Доступ к агенту не предоставлен` из `require_bot_access` в `reserve_job`). Я временно убрал свою правку `access.py` и повторил эти два теста — падают так же, значит это не следствие моих изменений (вероятно, фикстуры не выдают тестовому пользователю доступ после перехода на права по ролям, фаза AG); причину не чинил.
- **vitest** `src/components/chat src/pages/chat src/api/client.test.js`: **142 файла, 1299 тестов — все прошли** (до моих правок тот же набор: 140/1282).
- **vitest, весь `src`**: 628 из 633 файлов, 4260 из 4268 тестов; упали 6 тестов в 5 файлах, **не связанных с чатом**: `requestOrdering.regression.test.jsx`, `pages/Database.test.jsx`, `pages/Help.test.jsx`, `pages/MobileMenu.test.jsx`, `pages/myFiles/useMyFilesShares.test.jsx`. Они падают и при изолированном запуске; ни эти файлы, ни тестируемые ими модули в рабочем дереве мной не менялись и чат-код не импортируют. Причина не исследована (вне объёма); на HEAD не сравнивал.
- **Сборка** `buildE3` во временный каталог — успешна, `dist/sw.js` не изменился.
- **`p10_ai_probe.mjs`** (копия с добавленным `server_now` в моке статуса — без него блок «ИИ не отвечает» по R36 появляется только через `AI_RUN_STALE_AFTER_MS` после первого наблюдения): `retryPosts = 1` при двойном клике; блок показывает «Повторить» и «Остановить».

### Открытые вопросы

1. `rv_ai8_member_test.py` в текущем виде падает по построению (см. выше) — нужно либо обновить скрипт, либо принять `tests/test_ai_run_rebind.py` как проверку И3.
2. Поведение моков: если мок статуса в `p10_ai_probe.mjs` остаётся без `server_now`, на фронте это «старый сервер» (production сейчас без `server_now`), и «ИИ не отвечает» появится не через 17 с, а через `AI_RUN_STALE_AFTER_MS` после первого получения статуса.
3. Ограничение размера группы: UI считает 127 выбираемых при `group_max_members=128` (создатель входит в 128). Если нужно «128 выбранных» — менять надо backend (`chat_group_service.py:195`), не фронт.
4. `ThemeProvider` отдаёт потребителям новый объект `theme` без изменения значений через ~3.5 с после открытия чата (отложенный `refreshFromServer`), причина не установлена; последствия закрыты сравнением по значению в `MemoChatBubble`, остальные потребители (список бесед и др.) один раз перерисовываются.
5. Плагин `hubit-stamped-service-worker` штампует живой `dist/sw.js` при любой сборке — см. раздел «Как запускались проверки».
6. Контраст времени и прочитанных галочек в светлой теме ниже 4.5:1 (3.7 и 2.6) — это значения эталона; менять только по решению пользователя.
7. Не проверено: приёмка проверяющего (светлая/тёмная, 600/700/1024/1440/390 на его стенде), фото из реального backend (мои моки отдают SVG), выкладка на production и PostgreSQL-блокировки `FOR UPDATE` (на sqlite эмулируются `BEGIN IMMEDIATE`; на PostgreSQL тест не запускался).

## 33. Проверка пакета И и фазы Д2 (проверяющий, 2026-10-01)

Стенд:
- сборка текущего дерева в `scratchpad/build8` — Node-API Vite без плагина штамповки, живой `dist/sw.js` не изменился;
- `vite preview` на :5213, Playwright с моками API/WS;
- фото в моках — настоящие JPEG (540×1140, 800×800, 1280×720, 900×600 без размеров во вложении);
- backend — pytest через обёртку, которая отказывается работать, если `APP_DATABASE_URL`/`CHAT_DATABASE_URL` не sqlite; ключи LLM заведомо неверные.

### Инцидент: на сайте снова непринятая сборка (R38)

- `frontend/dist/index.html` и все `assets` пересобраны **2026-10-01 17:08:35**. Это выкладка на production: IIS `hubit` смотрит в `dist`.
- В бандле — код чата из рабочего дерева на 17:08 (`group_max_members`, `retryAiConversationRun`), то есть Д2 в промежуточном состоянии, до доработок исполнителя (журнал раздела 32 закончен ~20:50), при старом backend.
- Кто собирал — по транскриптам Claude не установлено: ни одна сессия не запускала `vite build` без `--outDir` в 17:00–17:10. В это время сессия ревью страницы «Протоколы встреч» сверяла `dist/assets/VoiceVideo-*.js` (17:08) — вероятно, сборку сделал исполнитель той задачи вне этих транскриптов.
- `dist/sw.js` дополнительно перештампован в 17:35:16 сборкой `--outDir` (ревью «Протоколов встреч», 17:32). Сборки проверяющего `build7` (раздел 31) тоже шли через `vite build --outDir` и, значит, перештамповывали `dist/sw.js`. Штамп считается по содержимому `dist`, поэтому версия SW совпадала с бандлом, но файл production менялся — ошибка проверяющего, впредь только Node-API без плагина.
- Решение — за пользователем: оставить до релиза или вернуть сборку. Скриншот пользователя (режим выделения, тёмная тема) — уже с сайта.

### Принято (проверено)

| Что | Результат |
|---|---|
| И1 (R29) | `p10_ai_probe3.mjs` (мок статуса с `server_now`): двойной клик «Повторить» → **ровно 1** `POST /retry`; в блоке «ИИ не отвечает» — «Повторить» и «Остановить» (R33) |
| И2 (R30) | Код `_enqueue_run(retry=True)`: последний запуск беседы, 409 для свежего активного, отмена зависшего, `with_for_update` mapping и бота, `limit(1)` при поиске существующего. `test_ai_run_retry` 10/10 |
| И3 (R31) | Геттер чистый. Тест проверяющего переписан под новую семантику (`test_rv_ai8_member2.py`): геттер не меняет бота → сообщение владельца → `queue_run_for_message` перепривязывает к `corp-assistant` → повторная доставка не создаёт второй запуск → **ответ новым ботом сохраняется — PASSED**. `test_ai_run_rebind` 6/6, `test_chat_config_and_retry_routes` 3/3 |
| И4 | R34, R36 — по коду и тестам; R33 — на стенде |
| И5 (R32) | Объяснение принято; главный вывод — R46 ниже |
| Д2-1 Цвета | Тёмная: свои `#2b5278`, входящие `#182533`, фиолетового нет; светлая `#effdde`/`#ffffff` |
| Д2-2 Лента + R37 | Стороны, серии, хвостики. Разделитель «Непрочитанные» при открытии на 22 px ниже верха (было −15). R26–R28 без регрессий: окно 31–121 без разрывов, догрузки только `after m64/m114` |
| Д2-3 Прокрутка | `design_probe2`, тот же сценарий: длинные задачи max **141–145 мс** (600/1024/1440), **73 мс** (390); худший кадр 133–150 мс. Фаза 9 — 152–164 мс, фаза Д — 296–340 мс. Цель ≤ 160 мс выполнена |
| Д2-4 Поле ввода | 44 px (1024/1440), 46 (390), 48 (600); хвостика нет |
| Д2-5 Раскладка | 600 — режим телефона со стрелкой «назад» и узкой полосой меню; 1024/1440 — две колонки, «Чаты / ИИ» в шапке списка с заливкой выбранной вкладки; горизонтального переполнения нет ни на одной ширине |
| Д2-6 Меню | Полоса 8 реакций + 7 пунктов 36 px / 14 px |
| Д2-7 Информация | Аватар, имя, статус; должность, подразделение, город, адрес офиса, кабинет; вкладки Медиа…Задачи; сетка 3×, 126 px, зазор 1 px |
| Д2-8 Фото | Настоящие JPEG, обе стороны, светлая и тёмная, 1440 и 390: контейнер = картинка, фон контейнера и `<img>` прозрачный, `cover`. 9:19 → 200×360, 1:1 → 360×360, 16:9 → 360×203, без размеров → 360×240 |
| Д2-9 Карандаш | Меню из 2 пунктов; оверлей в левой колонке (68–487 px), переписка справа видна; «Выбрано: 127 из 128», 73 строки неактивны, лишний клик не выбирает; один `POST /group`; вторая строка «в сети · должность» / «был(а) … · должность» |
| Д2-10 Без пузыря | Опрос, геопозиция, контакт, задача, файл без подписи — одна карточка цвета стороны; файл с подписью — пузырь |
| Тесты | pytest проверяющего: 20 passed (retry 10, rebind 6, config/routes 3, полный путь 1). vitest `components/chat`, `pages/chat`, `api/client.test.js`, `api/chatConfig.test.js`: **143 файла, 1302 теста — все прошли** |

Два падения `test_ai_sandbox_lifecycle.py` (`PermissionError` в `reserve_job`) были и раньше: фикстура не создаёт `AppUser 171` с правом `chat.ai.sandbox` и допуском, а проверка доступа требует пользователя и в `HEAD`. Это долг тестов, не поломка (R44).

### Замечания

**R45 (замечание пользователя, скриншот с сайта). Режим выделения — всё огромное.** `ChatSelectionActionDock.jsx` не менялся с мая 2026 и в Д2 не входил:
- компьютер: плавающая плашка `minHeight 72` + отступы ≈ 90 px, `maxWidth 760`, рамка и тень, «1 сообщение» 19 px / 850, «Переслать / Удалить» 18 px / 850, иконки 28–30 px;
- телефон: две пилюли по 48 px, текст 17 px / 780;
- у поля ввода — 44–48 px и 14–15 px.

Как в Telegram Web A — панель выделения встаёт **на место поля ввода, той же ширины и высоты**:
- полоса 44–48 px, фон как у поля ввода, без рамки, тени и отдельной плашки;
- слева крестик (иконка 22–24 px) и «N сообщений» 15 px / 500–600;
- справа «Переслать» (акцент) и «Удалить» (красный): иконка 20 px + текст 14–15 px / 500; при одном выбранном — «Ответить»;
- телефон — та же полоса над safe-area: иконки с подписью 13–14 px, без пилюль;
- кружки выбора 20 px и подсветка выбранной строки — оставить.

Проверить в светлой и тёмной теме на 390 / 600 / 1024 / 1440.

**R39. Тема по умолчанию не «как в системе»** (решение 7 раздела 26). Значение по умолчанию — `light`: `PreferencesContext.jsx:26/45`, `api/v1/settings.py:31`, `settings_service.py:312`. При тёмной ОС без сохранённой настройки чат светлый (проверено стендом). Сделать по умолчанию `system`, сохранённый выбор пользователя не трогать.

**R40. Время на фото на компьютере видно только при наведении** (`opacity: 0`; на телефоне видно). В Telegram время и галочки на медиа видны всегда — показывать всегда.

**R41. Полоса реакций в меню в тёмной теме — белая пилюля** на тёмном фоне (подтверждено скриншотом пользователя с сайта). Причина — `ChatMessageContextMenu.jsx:140/267`:
- фон полосы — `alpha(popupSurfaceSoft, 0.94)`;
- `popupSurfaceSoft = ui.surfaceMuted`, а в тёмной теме это `alpha('#ffffff', 0.045)` (`chatUiTokens.js:436`);
- MUI `alpha()` заменяет прозрачность, а не умножает её, и получается `rgba(255,255,255,0.94)` — почти белый.

Сделать: брать непрозрачный цвет поверхности меню (`#17212b` / `ui.drawerBg`) и проверить остальные места, где `alpha()` применяется к полупрозрачному токену.

**R47 (замечание пользователя). Поле ввода «высокое, а текст маленький».** Высота полосы 44 px, как в Telegram. Но на компьютере текст прижат к нижнему краю. Замер на сборке с сайта и на текущем дереве, 1440:
- капсула 856–900;
- `chat-composer-textarea-slot` 874–900 (`minHeight 26`, `padding 0`);
- текст 877–898: сверху ~21 px пусто, снизу 2 px;
- скрепка, эмодзи и «отправить» — по центру полосы, поэтому текст выглядит «провалившимся», а полоса — пустой.

На телефоне так не происходит: у слота `padding 11/11`, текст по центру.

Сделать на компьютере:
- однострочный текст по вертикальному центру полосы, на одной линии с иконками;
- отступы слота симметричные (~11–12 px);
- при росте текста полоса растёт вверх, нижний отступ тот же;
- шрифт поля 15 px оставить.

Проверка: центр строки текста = центру иконок ±1 px на 1024 / 1440 и на 390.

**R48 (решение пользователя 2026-10-01). Эмодзи — картинками Apple, как в Telegram.** Сейчас везде системный шрифт: на Windows — Segoe UI Emoji, отсюда «не как в Telegram».

Сделать:
- единый компонент/функция отрисовки эмодзи картинками набора Apple в сообщениях (текст, превью в списке бесед, ответ/цитата), в панели эмодзи (`ChatEmojiPanel.jsx:164`, сейчас `emojiStyle="native"`), в реакциях под сообщением и в полосе реакций меню;
- картинки **хранить у себя** (статикой фронтенда, спрайт или отдельные PNG 64 px), без внешнего CDN;
- выбор набора — через существующий `emoji-picker-react` (поддерживает `emojiStyle="apple"` + свой `getEmojiUrl`) и пакет данных `emoji-datasource-apple` с той же версией, что ожидает пикер; новую зависимость добавить по этому решению пользователя;
- копирование текста отдаёт настоящие символы, а не картинки; поиск по сообщениям не ломается;
- размер: в тексте = высота строки, в реакциях 18–20 px, в полосе меню 26–28 px;
- проверить вес сборки: спрайт/картинки грузятся лениво, а не в основном бандле.

**R49 (решение пользователя 2026-10-01). Быстрые реакции — как в Telegram:** 👍 ❤️ 🔥 🥰 👏 😁 🤔 🤯 (`TELEGRAM_MESSAGE_MENU_REACTIONS`, `ChatMessageContextMenu.jsx:24`). Остальные — по кнопке раскрытия. 🗿 и 👎 убрать из первого ряда. Старый `QUICK_REACTIONS` (`ChatBubble.jsx:1049`) свести к тому же списку.

**R50 (замечание пользователя, скриншот с сайта). Опрос — «странный формат».** `ChatStructuredCards.jsx:138 ChatPollCard`. Что не так:
- результат нарисован заливкой фона всей строки на долю голосов: при 100 % вариант превращается в светлую «кнопку», при 0 % — без фона, поэтому строки разного вида;
- «100% · 1» прижато к тексту справа;
- кружки выбора остаются и после голосования — непонятно, голосование это или результаты;
- карточка узкая (по содержимому, ~130 px);
- «Голосов: 1»;
- кнопка «Завершить опрос» внутри карточки серой плашкой;
- нет строки о типе опроса.

Как в Telegram:
- **Ширина** — минимум ~280 px (на телефоне до 85 % ленты), как у пузыря.
- **Шапка:** вопрос 15 px / 600. Под ним 13 px приглушённо: «Анонимный опрос» / «Публичный опрос» (поле `anonymous` уже есть), для закрытого — «Итоги».
- **До голоса** (и не закрыт): строки ~40 px. Кружок 20 px (обводка 2 px), текст варианта 15 px, под текстом тонкий разделитель 1 px, 10–15 % прозрачности. Нажатие на строку сразу голосует. Фона у строк нет, при наведении — лёгкая подсветка.
- **После голоса или закрытый — режим результатов**, кружков нет, строки не нажимаются:
  - слева колонка фиксированной ширины ~40 px с процентом «100%» 14 px / 600 справа;
  - справа текст варианта 15 px;
  - под текстом полоса 4 px со скруглением, цвет акцента своей стороны, ширина = доля (при 0 % — точка);
  - у выбранного варианта маленькая галочка в круге 14–16 px в начале полосы;
  - полосы анимируются от 0 при переходе в результаты.
- **Низ карточки:** по центру «1 голос / 2 голоса / 5 голосов / Нет голосов» 13 px приглушённо. Время и галочки — справа снизу, как у карточек Д2-10.
- **«Завершить опрос» и «Отменить голос» — убрать из карточки в меню сообщения.** «Остановить опрос» — у своего незакрытого, с подтверждением. «Отменить голос» — если голосовал и опрос не закрыт; backend уже поддерживает: повторный `vote` с тем же индексом снимает голос (`chat/service.py:1952`). Меняется только UI, backend и API без изменений.
- **Обе темы**, своя и чужая сторона: цвета из токенов Д2-1 (на синем `#2b5278` полоса и проценты светлые, на `#182533` и `#ffffff` — акцент).

Проверка (стенд проверяющего):
- опрос 2 и 6 вариантов, длинный вопрос и вариант в 2 строки;
- до голоса, после голоса, закрытый, 0 голосов;
- анонимный и публичный;
- свой и чужой, светлая и тёмная тема, 390 и 1440;
- «Остановить опрос» и «Отменить голос» из меню вызывают существующие `POST …/poll/close` и `…/poll/vote`.

**R42 (некритично). Гонка при первом сообщении после перепривязки.** Два почти одновременных сообщения → оба делают `INSERT ChatMember` бота → второе падает на уникальности, и запуск для него не создаётся (нет ответа). Обрабатывать `IntegrityError` в `_ensure_bot_member` как «уже добавлен» (savepoint / `ON CONFLICT DO NOTHING`).

**R43 (некритично).** Заглушка для удалённой строки бота в `_get_runtime_by_conversation` имеет `surface="corporate"`. Беседа удалённого OpenCode-бота будет перенесена в ассистента. Определять sandbox по наличию `AppAiSandboxSession` беседы, иначе оставлять историю только для чтения.

**R44.** Починить фикстуру `test_ai_sandbox_lifecycle.py` (пользователь с `chat.ai.sandbox` + допуск), чтобы набор был зелёным.

**R46 (защита production, по объяснению И5).**
- `tests/conftest.py` подменяет на sqlite только `APP_DATABASE_URL`, а `CHAT_DATABASE_URL` берётся из `.env` — любой тест с `initialize_chat_schema()` пишет в production chat БД.
- `alembic/env.py` при пустом `sqlalchemy.url` берёт URL из `.env`.
- Плагин `hubit-stamped-service-worker` штампует живой `dist/sw.js` при любой сборке.

Сделать:
- conftest подменяет и `CHAT_DATABASE_URL`;
- `env.py` падает без явно заданного URL (переменная окружения или `-x url=`);
- плагин берёт каталог из `config.build.outDir`.

Только код, на production ничего не выполнять.

**Оставить как есть:** контраст времени (3.7:1) и галочек (2.6:1) в светлой теме — значения Telegram. Лимит группы «127 + создатель = 128» — верно.

### Задание исполнителю (пакет Д3)

| Пакет | Что |
|---|---|
| Д3-1 | R45 — панель выделения как в Telegram (компьютер и телефон) |
| Д3-2 | R39 — тема по умолчанию «как в системе» |
| Д3-3 | R40, R41, R47 — время на фото всегда; тёмная полоса реакций; текст поля ввода по центру |
| Д3-6 | R48, R49 — эмодзи картинками Apple (у себя, без CDN) везде; быстрые реакции как в Telegram |
| Д3-7 | R50 — опрос как в Telegram: режимы «голосование» / «результаты», полосы с процентами, «Остановить опрос» и «Отменить голос» в меню |
| Д3-4 | R42, R43, R44 — backend-мелочи и фикстура |
| Д3-5 | R46 — защита тестов, alembic и сборки от production |

Журнал — следующим свободным разделом. Сборка — только Node-API без плагина или после Д3-5. На production ничего не выполнять.

Приёмка проверяющего:
- скриншоты режима выделения 390 / 600 / 1440 в обеих темах, высота панели = высоте поля ввода ±4 px;
- тёмная ОС без сохранённой настройки → тёмная тема;
- время на фото видно без наведения;
- поле ввода: центр текста = центру иконок ±1 px (390 / 1024 / 1440);
- полоса реакций в тёмной теме тёмная; эмодзи Apple в тексте, панели, реакциях и меню; первый ряд 👍 ❤️ 🔥 🥰 👏 😁 🤔 🤯; копирование текста с эмодзи даёт символы;
- опрос по проверке R50 (до/после голоса, закрытый, обе темы, 390 / 1440);
- тест двух параллельных первых сообщений → два запуска;
- `test_ai_sandbox_lifecycle.py` зелёный;
- `vite build --outDir` больше не меняет `dist/sw.js`.

### Что остаётся после Д3

- Остатки фазы AG (раздел 26): память с управлением, уведомление «ИИ ответил», предупреждение о балансе; прогон AG-5 с ключом пользователя.
- «Отложенные сообщения».
- Приёмка mobile M1–M8 на устройстве.
- Единый план релиза — после приёмки и «да» пользователя.

## 34. Пакет Д3 (исполнитель, 2026-10-01)

Задание — раздел 33 (R39–R49). Приёмку на стенде делает проверяющий; ниже — только результаты моих прогонов. Production не затрагивался: `.env`, IIS, PM2 не менялись, процессы не перезапускались, DDL/DML/миграций на production нет, `AI_JEV_ROUTING` и `AI_RUN_WATCHDOG_ENABLED` не включались, живой `frontend/dist` не пересобирался (проверено по хешу и времени `dist/sw.js` и `dist/index.html` до и после сборки).

### Как запускались проверки

- **pytest** — через ту же обёртку: оба URL (`APP_DATABASE_URL`, `CHAT_DATABASE_URL`) — sqlite во временном каталоге, `CHAT_REALTIME_TRANSPORT=local`; обёртка прерывает прогон, если любой URL не sqlite (напечатано `EFFECTIVE app_db: sqlite | chat_db: sqlite | transport: local`).
- **Сборка** — штатная команда `vite build --outDir <каталог в scratchpad> --emptyOutDir` (после Д3-5 безопасна): `built in 1m 11s`, `dist/sw.js` — прежние mtime `17:35:16` и хеш, `dist/index.html` — прежние `17:08:35` и хеш; в `buildD3/sw.js` штамп `build-287331880e581cb7`.
- **Самопроверка в браузере** — dev-сервер Vite на :5234 и Playwright с моками API/WS (скрипты в scratchpad: `d3_probe.mjs`, `copy_probe.mjs`, `picker_probe.mjs`, `theme_default_probe.mjs`, `emoji_only_probe.mjs`). Это самопроверка исполнителя, не приёмка; сервер остановлен.

### Статус пакетов

| Пакет | Статус | Что сделано |
|---|---|---|
| Д3-1 (R45) | сделано | `ChatSelectionActionDock.jsx` переписан: панель встаёт на место поля ввода — тот же док (фон `composerDockBg`, граница/тень как у дока поля), полоса высотой `density.composerCapsuleMinHeight` (компьютер 44/48, телефон 46), без плашки, рамки, тени, радиуса и `maxWidth`. Компьютер: слева крестик 22 px и «N сообщений» 15 px / 600; справа «Ответить» (только при одном выбранном и `canReplySelectedMessage`), «Переслать» (акцент) и «Удалить» (красный): иконка 20 px + текст 14,5 px / 500. Телефон: та же полоса над safe-area, «Ответить» и «Переслать» — иконка 20 px + подпись 14 px / 500 без пилюль (счётчик, копирование и удаление остаются в верхнем тулбаре, как было). Кружки выбора и подсветка строки не менялись. `data-testid` прежние + новый `chat-selection-strip`. |
| Д3-2 (R39) | сделано | Тема по умолчанию — `system`: `PreferencesContext.jsx` (`DEFAULT_PREFERENCES`, `normalizeThemeMode`), `useAccountSectionData.js`, `api/v1/settings.py` (`UserSettingsResponse`), `settings_service.py` (`DEFAULTS`, три `or "light"`, фолбэк на неизвестное значение), `AppUserSetting.theme_mode` (Python-`default`, схема БД не менялась). Сохранённый выбор не трогается: сервер отдаёт хранимое значение, кеш браузера читается как есть. |
| Д3-3 (R40) | сделано | Время и галочки на фото без подписи видны всегда: из `ChatBubble.jsx` убрано `opacity: { md: 0 }` и правило показа по `:hover`. `data-testid` `chat-media-meta-hover` переименован в `chat-media-meta` (тест обновлён; если проба проверяющего ищет старый id — заменить). |
| Д3-3 (R41) | сделано | Полоса реакций в меню: в тёмной теме фон — непрозрачная поверхность меню (`ui.drawerBg`, `rgb(23, 33, 43)`), в светлой прежний. Причина — `alpha()` MUI подменяет, а не умножает прозрачность: `alpha(rgba(255,255,255,.045), .94)` давала почти белый. Остальные `alpha(...)` в `components/chat` и `pages/chat` проверил по списку (`accentText`, `textSecondary`, `surfaceStrong`, `composerDockBg`, `borderSoft`, `threadBg`, `panelBg`, `drawerBg` и т. д.) — все применяются к непрозрачным токенам или намеренно переопределяют альфу; единственным «белым с альфой» токеном был `surfaceMuted`. |
| Д3-3 (R47) | сделано | Поле ввода: слот текста высотой в полосу и симметричными отступами `calc((H − строка) / 2)`, `textarea` без верхнего `padding: 2px`, ячейки иконок высотой в полосу с центровкой (клик-цель, а не сама кнопка, задаёт высоту: глобальный CSS на узких экранах растягивает кнопки до 44 px). Текст растёт вверх с теми же отступами, иконки остаются на нижней строке. Шрифт поля прежний. |
| Д3-6 (R48) | сделано | Эмодзи — картинки Apple, из своей статики. Зависимость `emoji-datasource-apple@16.0.0` (devDependency, точная версия — поколение данных `emoji-picker-react@4.18`; `--ignore-scripts`; в `package-lock.json` +8 строк). Плагин Vite `scripts/emoji-apple-assets-plugin.mjs` раздаёт `img/apple/64/*.png` по `/emoji/apple/64/<unified>.png`: в dev из `node_modules`, в сборке копирует в `<outDir>/emoji/apple/64` (так же, как pdf.js; 3793 файла, 20,4 МБ). Логика — `lib/chat/emojiImages.js` (поиск эмодзи по графемам `Intl.Segmenter`: ZWJ-последовательности, флаги, кейкапы, тона кожи целиком; символы с текстовым начертанием вроде © и ™ остаются текстом; подбор имени файла с/без U+FE0F, имена из 4 hex-цифр), компонент `ChatEmoji.jsx` (`<img alt="<символ>">`, при ошибке пробует вторую форму, затем показывает обычный символ), плагин rehype `lib/chat/rehypeChatEmoji.js` для markdown (после `rehype-sanitize`, код не затрагивается). Подключено: текст сообщений (plain и markdown), превью в списке бесед (обычное, ИИ, задачи, черновик), ответ/цитата, реакции под сообщением (19 px, на узкой полосе телефона 16 px), быстрая палитра на пузыре, полоса реакций в меню (26 px), панель эмодзи (`emojiStyle="apple"` + `getEmojiUrl` на нашу статику). Текст в БД и в поле ввода не меняется (поле — обычный `textarea`, там остаются символы). PNG не входят в JS-бандлы: это отдельные файлы, браузер берёт каждую при показе (`<img>`). |
| Д3-6 (R49) | сделано | `chatReactions.js`: первый ряд — 👍 ❤️ 🔥 🥰 👏 😁 🤔 🤯; 🗿 и 👎 перенесены в раскрытый список (остальные: 😂 😮 😢 🎉 💯 👀; ⚡ убрал, чтобы раскрытый список остался из 16, как был). Старый `QUICK_REACTIONS` на пузыре сведён к тому же списку. Полоса на компьютере стала шире меню (300 px, чтобы вместить 8 картинок по 26 px), на телефоне по-прежнему 6 + кнопка раскрытия. |
| Д3-4 (R42) | сделано | `_ensure_bot_member`: вставка членства и `ChatConversationUserState` — в SAVEPOINT (`begin_nested`), `IntegrityError` по уникальному ключу считается «уже добавлен» (при `left_at` — сбрасывается). Тесты: детерминированный (первая проверка видит «нет участника», строка уже есть) и с двумя потоками на барьере. |
| Д3-4 (R43) | сделано | Заглушка удалённого бота в `_get_runtime_by_conversation`: `surface="sandbox"`, если у беседы есть `AppAiSandboxSession`, иначе `corporate`; признак `deleted=True`. Беседа удалённого OpenCode-бота не переносится в ассистента и остаётся «только чтение» (`agent_read_only`). Статус и «остановить» для такой беседы не обращаются к sandbox-сервису (он требует строку бота), а `retire_conversation` не падает без строки бота, если есть строка sandbox-сессии, — удаление чата освобождает рабочее место. |
| Д3-4 (R44) | сделано | Фикстура `test_ai_sandbox_lifecycle.py`: пользователь 171 (viewer, `chat.ai.sandbox`) и допуск `AppAiBotAccess`. |
| Д3-5 (R46) | сделано | (1) `tests/conftest.py` подменяет и `CHAT_DATABASE_URL` на sqlite (и ставит `CHAT_REALTIME_TRANSPORT=local`, если не задан). (2) `alembic/env.py::_database_url()` больше не берёт URL из `.env`: допустимы `sqlalchemy.url`, `-x url=...`, `ALEMBIC_DATABASE_URL`, иначе `RuntimeError`; программные вызовы (`db_migrations.build_alembic_config`) URL задают и не затронуты. `scripts/mobile/apply-mobile-migrations.ps1` (production-скрипт с бэкапом) теперь передаёт `ALEMBIC_DATABASE_URL = APP_DATABASE_URL` на время вызова; пример в `scripts/pm2/README.md` обновлён; правило добавлено в `AGENTS.md`. (3) Плагин штамповки вынесен в `scripts/stamped-service-worker-plugin.mjs` и берёт каталог из `config.build.outDir`; тест `scripts/vite-stamp-plugin.test.js`; сборка `--outDir` проверена на живом `dist` (см. выше). |

### Файлы, изменённые в этой работе

Backend и окружение: `WEB-itinvent/backend/ai_chat/service.py`, `ai_sandbox/app_service.py`, `alembic/env.py`, `services/settings_service.py`, `api/v1/settings.py`, `appdb/models.py`; `tests/conftest.py`, `scripts/mobile/apply-mobile-migrations.ps1`, `scripts/pm2/README.md`, `AGENTS.md`.
Frontend: `components/chat/ChatSelectionActionDock.jsx`, `ChatBubble.jsx`, `ChatComposer.jsx`, `ChatMessageContextMenu.jsx`, `ChatSidebarRows.jsx`, `ChatEmojiPanel.jsx`, `chatPlainText.jsx`, новые `ChatEmoji.jsx`, `chatReactions.js`; `components/hub/MarkdownRenderer.jsx`; новые `lib/chat/emojiImages.js`, `lib/chat/rehypeChatEmoji.js`; `contexts/PreferencesContext.jsx`, `pages/account/hooks/useAccountSectionData.js`; `vite.config.js`, новые `scripts/emoji-apple-assets-plugin.mjs`, `scripts/stamped-service-worker-plugin.mjs`; `package.json`, `package-lock.json`.
Тесты: `tests/test_alembic_env_explicit_url.py` (новый, 3), `tests/test_ai_run_rebind.py` (+3), `tests/test_ai_sandbox_lifecycle.py` (фикстура), `tests/test_user_settings_theme.py` (+2); новые `ChatSelectionActionDock.test.jsx` (6), `ChatEmoji.test.jsx` (7), `lib/chat/emojiImages.test.js` (5), `scripts/vite-stamp-plugin.test.js` (2); изменены `contexts/PreferencesContext.test.jsx` (+2), `ChatThread.test.jsx` (реакция — картинка, слот поля), `chatStructuredContent.test.jsx` (время на фото).

### Замеры самопроверки (браузер, моки; 390 / 600 / 1024 / 1440, светлая и тёмная)

- **R45.** Высота дока выбора = высоте дока поля ввода: 44 / 44 (1024, 1440), 48 / 48 (600), 46 / 46 (390) — разница 0 px, в тёмной теме 45 / 45 из-за верхней границы дока; у полосы радиус 0, рамки 0, тени нет, `max-width` нет. Счётчик 15 px / 600; «Переслать», «Удалить», «Ответить» 14,5 px / 500 (телефон 14 px / 500).
- **R47.** Центр строки текста и центр иконок: 878,0 / 878 (1440), 877,9 / 878 (1024), 875,8 / 876 (600), 877 / 877 (390). Три строки текста: нижний отступ текста 13 px (390: 12 px), иконки на нижней строке.
- **R39.** Тёмная ОС без сохранённой настройки → фон `rgb(15, 17, 21)`, док поля `rgb(23, 33, 43)`; светлая ОС → светлая; тёмная ОС с сохранённым `light` → светлая.
- **R40.** `chat-media-meta`: `opacity: 1`, время «20:50» видно без наведения (1440 и 390).
- **R41, R49.** Меню на 1440 (светлая и тёмная): фон полосы `rgb(23, 33, 43)` в тёмной, 8 картинок по 26 px, порядок 👍 ❤️ 🔥 🥰 👏 😁 🤔 🤯, переполнения нет.
- **R48.** На странице чата: 11 картинок в тексте/цитате/превью/реакциях/полосе, 0 битых, у всех `naturalWidth` 64, `src` — `/emoji/apple/64/…png`; запросов к внешним origin — 0 (и на странице, и при открытой панели эмодзи: 110 картинок, 175 запросов к нашей статике, 0 внешних). Размер в тексте 18 px (= 1,22 em), крупное одиночное эмодзи 55 px, в реакциях 19 px. Копирование выделенного текста (выделение + Ctrl+C и `execCommand('copy')`) кладёт в буфер настоящие символы: `Привет 😀 как дела? 👍🏽 ❤️ 🇷🇺 👨‍💻 конец`.
- Время сообщения на крупном одиночном эмодзи пересекается с картинкой (28×8 px); с обычным символом пересечение было таким же или больше (28×12 px) — поведение прежнее, не менял.

### Фактические прогоны

- **pytest (sqlite)**: **133 passed** за 4 мин 53 с: `test_ai_run_retry`, `test_ai_bot_access`, `test_ai_bot_merge`, `test_ai_run_watchdog`, `test_ai_tool_permissions`, `test_ai_chat_runtime`, `test_chat_unread_mentions`, `test_ai_run_rebind` (9), `test_chat_config_and_retry_routes`, `test_alembic_env_explicit_url` (3), `test_ai_sandbox_lifecycle` (6 — зелёный, R44), `test_ai_sandbox_migration`. Отдельно `tests/test_chat_*.py` + `test_user_settings_theme.py` + `test_app_db_identity_services.py` (из-за правки conftest): 470 passed, **9 failed**: `test_chat_attachment_save_to_my_files::test_save_chat_attachment_requires_my_files_write_permission` (201 вместо 403), `test_chat_runtime_split::test_start_chat_server_cleanup_only_targets_requested_port` (нет `_listener_pids_on_port`), `test_chat_search_reply_and_settings_service` ×2 (`sender_name` «Task Author» вместо «Task»), `test_chat_ws_session_lifecycle` ×5 (`WsSessionLease is not defined`, `_ws_session_watchdog() missing connection_id`). Те же 9 падают и при временно убранной правке `conftest.py` (прогон на них же), значит от моих изменений не зависят; причины не чинил (вне объёма). Для `test_chat_ws_session_lifecycle` причина видна по трассировке: тесты исполняют фрагмент `ws.py` в собственном namespace и не знают о `WsSessionLease` и параметре `connection_id` текущей версии — тесты устарели относительно `ws.py` (в самом `ws.py` импорт `WsSessionLease` есть, на запуск сервера это не влияет).
- **vitest** `components/chat`, `pages/chat`, `api/client.test.js`, `contexts`, `lib/chat`, `components/hub`: **195 файлов, 1559 тестов — все прошли** (`components/chat`, `pages/chat`, `api/client.test.js`, `api/chatConfig.test.js`, `contexts`, `lib/chat`, `components/hub`).
- **vitest, весь `src` и `scripts`**: весь `src`: 636 файлов, 631 прошёл; из 4288 тестов 4280 прошли, 2 пропущены, **6 упали в 5 файлах вне чата** — те же, что в разделе 32 (`pages/Database.test.jsx`, `pages/Help.test.jsx`, `pages/MobileMenu.test.jsx`, `pages/myFiles/useMyFilesShares.test.jsx` ×2, `requestOrdering.regression.test.jsx`); `scripts`: 4 файла, 9 тестов, все прошли (в том числе `stamp-service-worker`, `vite-stamp-plugin`).
- **eslint** по новым файлам (`ChatEmoji.jsx`, `chatReactions.js`, `emojiImages.js`, `rehypeChatEmoji.js`, оба плагина Vite): 0 ошибок, 0 предупреждений.
- **Сборка** `vite build --outDir` — успешна (см. выше).

### Открытые вопросы и риски

1. **Вес выкладки.** Эмодзи добавляют в `dist` 3793 файла / 20,4 МБ (28 МБ на диске). Грузятся лениво по одной картинке; в основной бандл не входят. Если вес критичен — можно отдавать подмножество (часто используемые) или 32-пиксельный набор.
2. **Кеш картинок.** Service worker `/emoji/…` не перехватывает (запросы идут браузером, `Cache-Control` зависит от IIS `web.config`). Если нужен офлайн/долгий кеш — добавить правило в `web.config` (`max-age`, `immutable`); сам `sw.js` не менял, чтобы не перештамповывать.
3. **Существующие пользователи с `theme_mode = light` в БД остаются на светлой теме.** Отличить «выбрал сам» от «получил значение по умолчанию» по данным нельзя, а менять данные на production без команды запрещено. Если нужно перевести тех, кто никогда не менял тему, — отдельная миграция с критерием (например, `updated_at == created_at`) и решение пользователя.
4. **Панель выделения на телефоне** содержит только «Ответить» и «Переслать» (как было); по R45 «иконки с подписью 13–14 px» выполнено, удаление и копирование остаются в верхнем тулбаре — менять местами не стал.
5. **`vite build` (без `--outDir`) по-прежнему пересобирает живой `dist`** — это его назначение; защита касается только `--outDir`. Выкладка по-прежнему только по явному «да».
6. **`alembic` без явного URL теперь падает** — это намеренно, но команды из старых заметок/runbook'ов нужно дополнить `ALEMBIC_DATABASE_URL` или `-x url=` (README PM2 и production-скрипт мобильных миграций обновлены).
7. Не проверено: приёмка проверяющего на его стенде, PostgreSQL (SAVEPOINT в R42 проверен на sqlite; на PostgreSQL `IntegrityError` в `begin_nested` ведёт себя так же, но тест не запускался), реальные фото из backend (моки отдают SVG), поведение `Intl.Segmenter` в старых браузерах (без него эмодзи ищутся по code points — составные последовательности могут разбиться, картинка тогда не найдётся и показывается символ), копирование выделения в Safari/Firefox (проверен только Chromium).
8. 9 падений `tests/test_chat_*` и 5 файлов vitest вне чата падают независимо от Д3 (см. выше).

## 35. Остаток плана: фаза AG (память, «ИИ ответил», баланс), «Отложенные сообщения», тестовый долг (исполнитель, 2026-10-02)

Задание — раздел 33 «Что остаётся после Д3» (кроме приёмки mobile M1–M8 на устройстве, прогона AG-5 с ключом пользователя и плана релиза: первое требует устройства, второе — API-ключа, третье по плану готовит проверяющий). Приёмку на стенде делает проверяющий; ниже — результаты моих прогонов. Production не затрагивался: `.env`, IIS, PM2 не менялись, процессов не перезапускал, DDL/DML и миграций на production нет, новые флаги по умолчанию выключены, живой `dist` не пересобирался. Все pytest — через ту же обёртку (оба URL sqlite).

### Статус

| Что | Статус | Как сделано |
|---|---|---|
| Память: управление в настройках ИИ | сделано | Блок управления выделен из панели беседы в `components/chat/AiPersonalMemoryManager.jsx` (переключатель «Использовать личную память», список фактов, изменить/удалить один, «Очистить всю память» с подтверждением); панель беседы использует его же. В «Настройках» новый раздел «ИИ-ассистент» (`AiAssistantSettingsTab`, виден при праве `chat.ai.use`; `PERSONAL_SETTINGS_SECTIONS[…].permission`). |
| Память: пометка в ответе | сделано | `_build_personal_memory_context(…, relevant_out=…)` собирает факты, вошедшие в запрос **и** имеющие общие слова с вопросом; если такие были, к ответу добавляется строка `_Учтена личная память: N факт/факта/фактов_` (один раз). Это эвристика: «модель действительно использовала факт» узнать нельзя — пометка ставится, когда релевантный факт попал в контекст. |
| Уведомление «ИИ ответил» | сделано | Ответ ИИ — обычное входящее. Backend: `notification_planner` для бесед `kind=ai` формирует push/колокольчик с заголовком «ИИ ответил» и телом — началом ответа без markdown и без пометки памяти (≤140 символов); отключённые и архивные беседы пропускаются, как у остальных. Frontend (`chatSocketNotificationPlan`): тост, системное уведомление и звук с тем же заголовком и телом; правила видимости/звука раздела А2 не менялись. Счётчик на вкладке «ИИ» уже считался (`folder_unread` ключ `ai`) — проверен кодом, не менялся. |
| Предупреждение о балансе | сделано | `shared/llm`: `OpenRouterClient.get_credits()` (GET `<base>/credits`, ключ не логируется). `backend/ai_chat/balance.py`: состояние одним JSON в `app.app_settings` (ключ `ai.balance`, новых таблиц нет); `parse_balance` понимает `{"data":{"total_credits","total_usage"}}`, `{"balance"}`, `{"credits"}`…; остаток ниже порога → уведомление всем `settings.ai.manage`/админам (hub), повтор не чаще раза в сутки, сброс при восстановлении; ошибка провайдера не затирает последний остаток. Воркер ИИ проверяет по расписанию при `AI_BALANCE_CHECK_ENABLED=1` (интервал `AI_BALANCE_CHECK_INTERVAL_SEC`, 1800). API (только управляющие): `GET /ai-bots/balance`, `PUT /ai-bots/balance/settings {threshold}`, `POST /ai-bots/balance/check`. UI: карточка «Баланс провайдера ИИ» над списком агентов (остаток, порог, «Проверить сейчас», строка предупреждения). Ошибка 402 в запуске: пользователь видит «ИИ временно недоступен, администраторы уведомлены…», управляющим уходит уведомление (не чаще раза в час). |
| Отложенные сообщения | сделано | См. ниже. |
| Тестовый долг | исправлено | 9 тестов backend и 6 тестов vitest, падавших до моих правок, обновлены под текущий код (список ниже). |

### Отложенные сообщения

- **Схема.** `ChatScheduledMessage` (`chat/models.py`) + Alembic `20261002_0124` (после `20260925_0123`): таблица `chat_scheduled_messages` в схеме, где реально лежат chat-таблицы (логическая `chat` или `public` у legacy), три индекса, FK на беседу с `ON DELETE CASCADE`. Миграция проверена на sqlite вверх/вниз (`test_alembic_migration_creates_and_drops_the_table`); на production **не применялась**.
- **Флаг.** `CHAT_SCHEDULED_MESSAGES_ENABLED` (по умолчанию `0`): пока он выключен, маршруты отвечают 503, диспетчер не стартует, `GET /chat/config` отдаёт `scheduled_messages_enabled=false` и интерфейс кнопку не показывает. Включать только после миграции.
- **Сервис** `chat/scheduled_messages.py`: создание (будущее время ≥ 30 с и ≤ 366 дней, текст ≤ 12000, участник беседы, не ИИ-беседа, не больше 100 активных у пользователя), список своих запланированных беседы, изменение (текст/время) и отмена — только владелец и только пока не отправляется (условный `UPDATE … WHERE status IN (scheduled, failed)`); «упавшее» сообщение после изменения возвращается в очередь.
- **Отправка в срок.** Цикл внутри чат-процесса, рядом с диспетчером event outbox (`ChatService.start`), опрос раз в 5 с (`CHAT_SCHEDULED_MESSAGES_POLL_SEC`), пачка 20. Строка занимается условным `UPDATE … status='sending'` (безопасно при нескольких процессах), сообщение уходит обычным `chat_service.send_message` от имени автора со стабильным `client_message_id = scheduled:<id>` — повторная отправка после сбоя между «сохранено» и «помечено отправленным» не дублирует сообщение; затем те же побочные эффекты, что у HTTP-отправки: уведомления и `message.created` через event outbox. Сбой — до 3 попыток с паузой 60 с, затем `failed`; нет доступа/беседы — сразу `failed`. «Зависшие» в `sending` старше 5 мин возвращаются в очередь. Текст сообщения не логируется.
- **API** (`/chat/conversations/{id}/scheduled` GET/POST, `/chat/scheduled/{id}` PATCH/DELETE; права как у чтения/отправки сообщений).
- **Интерфейс.** Правый клик (компьютер) или долгое нажатие (телефон) на кнопке «Отправить» → «Отправить позже» → окно: текст, быстрые варианты («Через час», «Завтра в 9:00», «В понедельник в 9:00»), дата и время; после планирования поле очищается. Над полем ввода строка «Запланировано: N · ближайшее завтра в 09:00» (красная при неотправленных) → список с изменением и отменой. Только обычные чаты и группы.
- **Ограничения первой версии.** Только текст (файлы, опросы, геопозиция, стикеры не откладываются), без «отправить сейчас» из списка, мобильное приложение `mobile-hub` не менялось. После отправки сообщение приходит в ленту обычным событием; список запланированных обновляется по таймеру (сразу после ближайшего срока).

### Тестовый долг (падали до этих правок, не из-за них)

| Тест | Причина | Что сделано |
|---|---|---|
| `test_chat_ws_session_lifecycle` ×5 | `_ws_session_watchdog` теперь принимает `WsSessionLease` и `connection_id`, а `chat_websocket` создаёт `WsSessionLease`; тесты исполняют фрагмент `ws.py` со старым namespace | тесты переписаны под lease (`revalidate()` → `ok`/`grace`/`dead`/исключение), добавлен тест режима `grace` (клиенту уходит `chat.auth.required`) |
| `test_chat_runtime_split::…cleanup_only_targets_requested_port` | очистка порта вынесена в `shared/port_reclaim.py` и убивает только процесс с командной строкой этого лаунчера | тест проверяет новое поведение: свой лаунчер — `taskkill`, чужой процесс и другой порт — нет |
| `test_chat_search_reply_and_settings_service` ×2 | в цитате отправитель — полное имя («Task Author»), как везде в чате | ожидания обновлены |
| `test_chat_attachment_save_to_my_files::…requires_my_files_write_permission` | `my_files.write` входит в базовый набор любого аккаунта (`get_effective_permissions` добавляет его к custom-правам) | тест фиксирует это (201 при `chat.read`); это не дыра, а действующая политика |
| vitest `useMyFilesShares` ×2 | хук обновляет один элемент через `onFileShareChanged`, а не перечитывает список | тест проверяет точечное обновление |
| vitest `requestOrdering.regression` (files) | загрузчик MyFiles стал использовать функции-обновители и дополнительные setters | контекст теста дополнен |
| vitest `Help` | поле поиска теперь «Поиск по справке и базе знаний» | метка в тесте |
| vitest `MobileMenu` | в сетке всегда есть пункт «Справка» | тест ожидает только его |
| vitest `Database` | кнопка «QR Сканер» теперь есть и на вкладке расходников | тест ожидает её |

### Файлы

Backend: `shared/llm/client.py`, `backend/ai_chat/balance.py` (новый), `ai_chat/service.py`, `api/v1/ai_bots.py`, `start_ai_chat_worker.py`, `chat/notification_planner.py`, `chat/scheduled_messages.py` (новый), `chat/models.py`, `chat/schemas.py`, `chat/service.py`, `api/v1/chat/scheduled.py` (новый), `api/v1/chat/__init__.py`, `api/v1/chat/conversations.py`, `alembic/versions/20261002_0124_chat_scheduled_messages.py` (новый); `.env.example` (плейсхолдеры флагов).
Frontend: `components/chat/AiPersonalMemoryManager.jsx`, `ChatScheduledMessages.jsx`, `useChatScheduledMessages.js`, `chatScheduledTime.js` (новые), `AiConversationContextPanel.jsx`, `ChatComposer.jsx`, `ChatThread.jsx`; `api/chatScheduled.js`, `api/aiBalance.js`, `lib/aiReplyPreview.js` (новые); `lib/chatSocketNotificationPlan.js`; `pages/account/settings/AiAssistantSettingsTab.jsx`, `pages/account/admin/AiBalanceCard.jsx` (новые), `AiBotsAdminSection.jsx`, `AccountWorkspace.jsx`, `hooks/useAccountSectionData.js`, `components/account/accountNavigationConfig.jsx`.
Тесты: новые `tests/test_ai_balance.py`, `tests/test_chat_scheduled_messages.py`, `AiAssistantSettingsTab.test.jsx`, `AiBalanceCard.test.jsx`, `ChatScheduledMessages.test.jsx`, `ChatComposer.scheduled.test.jsx`, `chatScheduledTime.test.js`, `aiReplyPreview.test.js`; дополнены `test_ai_chat_runtime.py` (пометка памяти), `test_chat_notification_planner.py`, `test_ai_bot_access.py` (маршруты баланса), `chatSocketNotificationPlan.test.js`, `accountNavigationConfig.test.jsx`, `ChatThread.test.jsx`; обновлены тесты из таблицы выше и `test_ai_run_retry.py`, `test_chat_config_and_retry_routes.py` под новые тексты/поля.

### Фактические прогоны

- **Браузер (моки, самопроверка):** «Отправить позже» на 1440 светлая и 390 тёмная — меню по правому клику/долгому нажатию, окно, `POST /chat/conversations/c1/scheduled`, поле очищено, строка «Запланировано: 3 · ближайшее …», список (3 элемента), отмена (2 элемента); скриншоты просмотрены.
- **pytest:** **632 passed** за 15 мин 27 с (все ИИ-наборы из раздела 32, `test_ai_balance`, `test_ai_sandbox_lifecycle` и `_migration`, `test_alembic_env_explicit_url`, `test_user_settings_theme`, `test_app_db_identity_services` и **все** `tests/test_chat_*.py` — 65 файлов, включая новый `test_chat_scheduled_messages` (14) и исправленные прежние падения). Прежние 9 падений `test_chat_*` и 2 падения `test_ai_sandbox_lifecycle` больше не воспроизводятся.
- **vitest:** весь `src`: 642 файла, 4313 тестов прошли, 2 пропущены, 1 упал — `Database.test.jsx › opens a database-scoped equipment QR link directly on the requested tab` во время параллельного 15-минутного pytest (известный флейк этого файла под нагрузкой); отдельно файл прогнан дважды — 42/42 зелёные; `scripts`: 9/9. Шесть падений, бывших до этих правок (раздел 34), исправлены.
- **eslint** по новым и изменённым файлам: 0 ошибок.

### Открытые вопросы и риски

1. **Формат ответа `/credits` провайдера (RouterAI) не подтверждён**: документация, доступная без ключа, не описывает схему; парсер терпим к нескольким формам, при нераспознанном ответе в настройках будет «Провайдер не вернул остаток». Нужна одна ручная проверка с рабочим ключом (кнопка «Проверить сейчас»); единицы порога — те же, что у провайдера.
2. **Прогон AG-5 (сравнение моделей) и калибровка JEV** по-прежнему требуют ключа пользователя.
3. **Отложенные сообщения не включены и не применены на production:** нужны миграция `20261002_0124` (на PostgreSQL проверить фактическую схему chat/public перед запуском, как для `0123`) и флаг `CHAT_SCHEDULED_MESSAGES_ENABLED=1` вместе с перезапуском чат-процессов; PostgreSQL в тестах не участвовал (sqlite). `POSTGRES_APP_SCHEMA*.md` (автогенерация после `alembic upgrade`) не пересобирались.
4. **Баланс и пометка памяти.** `AI_BALANCE_CHECK_ENABLED` по умолчанию выключен (сеть к провайдеру по расписанию); уведомление о 402 работает и без него. Пометка памяти попадает в сохранённый текст ответа (как строка «Источник: …»), поэтому видна и в копировании/поиске; в контекст следующих реплик она тоже попадает — на ответы это не влияет, но при желании её можно убирать при сборке контекста.
5. **mobile-hub** не менялся: отложенные сообщения и заголовок «ИИ ответил» там не реализованы (push с сервера придёт с новым заголовком); приёмка M1–M8 на устройстве — по-прежнему за проверяющим.
6. Не проверено: приёмка проверяющего на стенде, реальная доставка push с новым заголовком, поведение диспетчера на нескольких чат-узлах кроме теста двух экземпляров на sqlite.

## 36. Проверка пакета Д3 и раздела 35 (проверяющий, 2026-10-02)

Стенд:
- сборка `vite build --outDir scratchpad/build9` штатной командой — хеши `dist/sw.js` и `dist/index.html` до и после совпали (R46 подтверждён);
- в сборке 3793 PNG эмодзи, вся сборка 60 МБ;
- `vite preview` :5215, Playwright с моками; backend — pytest через обёртку (оба URL sqlite).

### Принято

| Что | Результат |
|---|---|
| R45 Выделение | Полоса на месте поля ввода: 44 px (1440) / 48 px (600) = высоте поля; радиус 0, тени нет. «1 сообщение» 15 px / 600; «Ответить / Переслать / Удалить» 14,5 px. Светлая и тёмная |
| R47 Поле ввода | Центр текста = центру иконок: 877,9 / 878 (1440), 875,8 / 876 (600) |
| R39 Тема | Без сохранённой настройки при тёмной ОС — тёмная (вкладка «Чаты» `#5288c1`), при светлой — светлая |
| R40 Фото | Время на фото без подписи видно без наведения (`opacity 1`, 1440) |
| R41, R49 Реакции | Полоса в тёмной теме `rgb(23,33,43)`; 8 картинок по 26 px: 👍 ❤️ 🔥 🥰 👏 😁 🤔 🤯 |
| R48 Эмодзи | Картинки Apple из `/emoji/apple/64/`, все загружены (`naturalWidth > 0`): тон кожи, флаг, ZWJ (👨‍💻), сердце с FE0F; в тексте 18–20 px, в реакциях 19 px, одиночное 55 px |
| R42–R44, R46 | pytest **55 passed**: scheduled 14, balance, rebind, alembic env, sandbox lifecycle 6/6 (R44), theme, retry, полный путь AI8 |
| Прокрутка | `design_probe2`: длинные задачи max 138–154 мс (600/1024/1440), 71–77 мс (390). Эмодзи-картинки не ухудшили |
| Отложенные сообщения (код) | Захват строки условным `UPDATE` (безопасно для двух узлов), стабильный `client_message_id`, возврат зависших, текст не логируется — принято по коду |

### Не сделано

**R50 — опрос (Д3-7).** Не выполнен: журнал раздела 34 перечисляет только R39–R49, `ChatStructuredCards.jsx` не менялся с 2026-10-01 16:15. Задание прежнее (раздел 33).

### Инциденты production

**R52. Сайт с 2026-10-01 18:09 работает на непринятом коде backend.**
- В 17:36 сервер аварийно перезагрузился: события System 41 и 6008 «Предыдущее завершение работы… было неожиданным»; загрузка в 17:47.
- Автозапуск PM2 в 18:09–18:43 поднял все процессы из рабочей папки, то есть с непринятыми изменениями фаз 10/AG/И/Д2/Д3 на тот момент. Фронтенд при этом — сборка `dist` от 17:08.
- Это не чья-то команда, а следствие того, что рабочая папка = каталог production.
- `health-check.ps1` (без ремонта): 0 сбоев, все процессы `online`. У `mail-notification-worker` 147 и `my-files-worker` 218 перезапусков — накопились после перезагрузки (ожидание блокировки БД), сейчас оба работают.

**R53. `system.alembic_version = 20261002_0124`, а таблицы `chat_scheduled_messages` нет** (только SELECT, `default_transaction_read_only=on`).

Механизм:
- каждый процесс production при первом обращении к app-БД выполняет `upgrade_internal_database(scope="app")` (`appdb/db.py:255`) по файлам миграций **из рабочей папки**;
- миграция `0124` в `scope=app` ничего не создаёт (`if _scope() == "app": return`), но версия записывается;
- app и chat на production — одна БД и одна `alembic_version`. Значит, upgrade в `scope=chat` при релизе посчитает `0124` применённой, **таблица не будет создана**, а отложенные сообщения после включения флага упадут;
- так же в 2026-09-25…10-01 «сама» применилась `0123` (R32).

Сделать (исполнитель, только код):
- новая миграция `0125`: идемпотентно создать `chat_scheduled_messages` с индексами и FK, если её нет и в этой БД есть chat-таблицы, — **в любом scope**. Тест на sqlite: «версия уже 0124, таблицы нет» → после upgrade таблица есть;
- правило для всех будущих chat-миграций: не пропускать DDL по `scope`, если chat-таблицы в той же БД.

Решение пользователя 2026-10-02 — отключить автоматический upgrade на старте production-процессов (Д4-4). До выкладки Д4-4, **любой новый файл в `alembic/versions` применяется на production при следующем старте любого процесса**. Исполнителю — новые миграции не класть в рабочую папку без согласования, проверять их только на sqlite.

### Замечания

- **R51 (некритично).** У одиночного крупного эмодзи время накладывается на картинку («04:14» поверх 😂). Как в Telegram: время в маленькой полупрозрачной плашке справа снизу, под эмодзи или рядом, без наложения.
- **R54 (некритично, отложенные сообщения).** Если `send_message` прошёл, а упало `_enqueue_side_effects` (уведомления/события), строка уходит в повтор. После 3 попыток получает `failed` «Не удалось отправить», хотя сообщение в чате есть. Помечать `sent` сразу после успешного `send_message`, сбой побочных эффектов только логировать (события догонит outbox/повтор).

### Не проверено проверяющим

UI раздела 35 на стенде:
- окно «Отправить позже» и список запланированных;
- раздел «ИИ-ассистент» с памятью;
- карточка баланса;
- уведомление «ИИ ответил».

Проверено только кодом и тестами. Приёмка — отдельным заходом после R50/R53.

### Задание исполнителю (пакет Д4)

| Пакет | Что |
|---|---|
| Д4-1 | R50 — опрос как в Telegram (задание раздела 33, без изменений) |
| Д4-2 | R53 — миграция `0125` «создать, если нет» в любом scope + тест; правило для chat-миграций |
| Д4-3 | R51, R54 |
| Д4-4 | R53 (решение пользователя 2026-10-02: **отключить автоприменение миграций на production**). `appdb/db.py::_initialize_app_schema_uncached` (ветка production) и `chat/db.py::initialize_chat_schema`: вместо `upgrade_internal_database` — только сверка `alembic_version` с head из кода. Отстаёт → структурированное предупреждение в лог (stage, текущая и ожидаемая версия). Версия неизвестна коду (база новее) → тоже предупреждение. Старт процесса не блокировать, кроме отсутствия `alembic_version` (как сейчас). Dev/sqlite и тесты — без изменений. Применение миграций — только явной командой при релизе (`alembic -x url=… upgrade head` / `ALEMBIC_DATABASE_URL`), шаг в runbook. Тесты: production + PostgreSQL-заглушка/sqlite с `APP_ENV=production` → `command.upgrade` не вызывается; отставание → предупреждение |

Журнал — следующим свободным разделом. На production ничего не выполнять.

Приёмка:
- опрос по проверке R50;
- тест `0124 без таблицы → 0125 создаёт`;
- одиночное эмодзи без наложения времени;
- тест «сбой побочных эффектов после отправки → статус `sent`».


## 37. Пакет Д4 (исполнитель, 2026-10-02)

Задание — «Задание исполнителю (пакет Д4)» раздела 36. На production ничего не выполнялось: ни миграций, ни DDL/DML, ни перезапусков, `.env`/IIS/PM2 не менялись, `dist` не пересобирался (хеш `dist/sw.js` `55F1C5379BF2AD2281E2…`, mtime 17:35:16 / `index.html` 17:08:35 — те же). Приёмку на стенде делает проверяющий; ниже — только результаты моих прогонов.

### Статус

| Пакет | Статус | Что сделано |
|---|---|---|
| Д4-4 (R53) | сделано | Автоприменение миграций на production отключено. `db_migrations.check_internal_database_revision(engine, url, *, scope)` — read-only: читает `system.alembic_version` (sqlite — `alembic_version`), сравнивает с head из `ScriptDirectory`, возвращает `current` / `behind` / `unknown_revision` (база новее кода) / `unreadable` и пишет структурированное предупреждение `schema_migration_check stage=… scope=… status=… current=… expected=… action=apply_migrations_manually_at_release` (поля есть и в `extra`). Не бросает исключений и ничего не пишет в БД. Подключено: `appdb/db.py::_initialize_app_schema_uncached` (ветка production вместо `upgrade_internal_database`), `chat/db.py::initialize_chat_schema` (production, обычная и legacy-`public` ветки; `_verify_production_schema` остаётся). Отсутствие `alembic_version` по-прежнему останавливает старт (`AppDatabaseConfigurationError`), остальное старт не блокирует. Dev/sqlite/тесты — без изменений (в dev по-прежнему `upgrade_internal_database`). Runbook: `scripts/pm2/README.md`, раздел «Миграции БД при релизе»; правило в `AGENTS.md` («Данные и миграции»). |
| Д4-2 (R53) | сделано | Новая миграция `20261002_0125_chat_scheduled_messages_ensure.py` (после `0124`): создаёт `chat_scheduled_messages` с тремя индексами и FK на `chat_conversations`, **если таблицы нет** и chat-таблицы лежат в этой БД (логическая `chat` или legacy `public`), в **любом scope**; в БД без chat-таблиц — ничего. Идемпотентна, `downgrade` ничего не удаляет (таблица принадлежит `0124`). Правило для будущих chat-миграций — в docstring миграции и в `AGENTS.md`. `0124` не менялась. |
| Д4-3 R54 | сделано | `scheduled_messages.py::_dispatch_one`: после успешного `send_message` строка сразу помечается `sent` (`_mark_sent`), побочные эффекты (`_enqueue_side_effects`) идут после и только логируются; сбой `_mark_sent` тоже логируется — строка остаётся `sending`, `recover_stuck` вернёт её, повторная отправка с тем же `client_message_id` ничего не дублирует. Сбой самой отправки — по-прежнему повтор/`failed`. |
| Д4-3 R51 | сделано | `ChatBubble.jsx`: у одиночного крупного эмодзи время/галочки — отдельный layout `emoji` (`chat-bubble-meta-emoji`): в потоке под эмодзи, справа, плашка `rgba(2,6,23,.5)` с блюром, светлый текст (прочитано — `#8fd3ff`), не зависит от стороны и темы. Резерв места под наложенное время (`pb`) убран. С реакциями плашка стоит в футере рядом с ними. |
| Д4-1 R50 | сделано | Опрос как в Telegram — см. ниже. |

### R50 — опрос

- `ChatStructuredCards.jsx::ChatPollCard` переписан: ширина не меньше `min(280px, 66vw)`; шапка — вопрос 15/600 и строка 13 px «Публичный опрос» / «Анонимный опрос» / у закрытого «Итоги».
- **Режим голосования** (не голосовал и не закрыт): строки ≥ 40 px, кружок 20 px (обводка 2 px), текст 15 px, разделитель 1 px 12 % между вариантами, фона нет, при наведении лёгкая подсветка; нажатие сразу голосует; проценты и счётчики не показываются.
- **Режим результатов** (проголосовал или закрыт): кружков нет, строки не нажимаются; слева колонка 40 px с процентом 14/600, справа текст 15 px, под ним полоса 4 px со скруглением (при 0 % — точка 4 px), у своего варианта галочка в круге 16 px в начале полосы; полосы анимируются от 0 только при переходе в результаты (при монтировании сразу итог; `prefers-reduced-motion` — без анимации). Цвет: на своей (синей) стороне светлый (`bubbleOwnText`), на чужой — акцент (`accentText`).
- Низ: по центру «Нет голосов / 1 голос / 2 голоса / 5 голосов» 13 px (склонение по правилам, 11–14 → «голосов»); время и галочки — как у остальных карточек.
- **Из карточки убраны** кнопки «Завершить опрос» и «Отменить голос». В меню сообщения (`ChatMessageContextMenu.jsx`): «Остановить опрос» — автору незакрытого опроса, с `window.confirm` (как у «Удалить сообщение»), вызывает прежний `POST …/poll-close`; «Отменить голос» — проголосовавшему при незакрытом опросе, повторный `poll-vote` с тем же вариантом (backend снимает голос). Проводка: `useChatPageDialogsLayerProps` → `buildChatPageDialogsLayerProps` → `ChatDialogs` → меню; backend и API не менялись. Мёртвая цепочка `onPollClose` в ленте (`ChatBubble`, `ChatMessageList`, `ChatThread`, `useChatThreadSection`, `buildChatPagePanesBags`, `pickChatPageLayoutSections`) удалена.
- **Найденный дефект (исправлен).** `chatStructuredContent.js` (`resolveChatMessagePoll`, `parseChatPollBody`): `Number(null) === 0`, поэтому `my_option_index: null` («не голосовал») превращался в «выбран первый вариант». Раньше это только рисовало первый кружок отмеченным; теперь ломало бы режим (опрос сразу «в результатах») и показывало «Отменить голос» всем. Исправлено, добавлены тесты.

### Файлы

- Backend: `db_migrations.py`, `appdb/db.py`, `chat/db.py`, `chat/scheduled_messages.py`, `alembic/versions/20261002_0125_chat_scheduled_messages_ensure.py` (новый).
- Frontend: `components/chat/ChatStructuredCards.jsx`, `ChatBubble.jsx`, `ChatMessageContextMenu.jsx`, `ChatDialogs.jsx`, `ChatMessageList.jsx`, `ChatThread.jsx`, `chatStructuredContent.js`; `pages/chat/useChatPageDialogsLayerProps.js`, `buildChatPageDialogsLayerProps.js`, `buildChatPagePanesBags.js`, `pickChatPageLayoutSections.js`, `useChatThreadSection.jsx`.
- Тесты (новые): `tests/test_internal_db_revision_check.py` (7), `ChatPollCard.test.jsx` (16), `ChatMessageContextMenu.poll.test.jsx` (4); дополнены `tests/test_chat_scheduled_messages.py` (R54 ×2, `0125` ×4), `tests/test_internal_db_migration_runtime.py` (production не применяет миграции + проверка версии; в двух legacy-тестах заглушены `_ensure_*`, которые падали и до моих правок), `chatStructuredContent.test.jsx` (R51 ×3, null-индекс ×2).
- Документация: `AGENTS.md` (2 правила), `scripts/pm2/README.md` («Миграции БД при релизе»), этот раздел.

### Проверки (мои прогоны)

| Проверка | Результат |
|---|---|
| pytest Д4 (`test_chat_scheduled_messages`, `test_internal_db_revision_check`, `test_internal_db_migration_runtime`, `test_appdb_schema_init_policy`, `test_alembic_env_explicit_url`) | **43 passed** (sqlite-URL заданы явно, `CHAT_REALTIME_TRANSPORT=local`; эффективные `config.app_db/chat.database_url` проверены до запуска) |
| pytest, 42 файла (не `test_ai_*`), где встречаются `alembic`/`db_migrations`/`initialize_*_schema` (кроме `test_ai_*`) | 322 passed, **5 failed, 37 errors** — к Д4 не относятся: `test_chat_unread_mentions::…mention_flows_through_outbox` (`0 == 1`), `test_company_structure_service::…personal_contacts`, `test_hub_notifications_cleanup::…task_delete…` (`no such table main.chat_conversations`), `test_hub_feed_migration` (`no such table users` в старой миграции), `test_mobile_biometric_migration` (`0099 parent sandbox tables are required` в `0111`). 37 errors — `test_one_c_catalog_compact_*_pg`: им нужна настоящая PG-база `hubit_chat_*_test_*`, а в окружении заданы sqlite-URL (`psycopg.ProgrammingError` при разборе строки, соединений с PG не было) |
| pytest `test_ai_*` из того же отбора | остановился на `test_ai_sandbox_queue_repository::test_purge_revokes_session_permissions_before_resurrection` (`'approved' == 'pending'`: политика песочницы разрешает `edit`, тест ждёт запрос); это расхождение теста и политики, Д4 не затрагивает; 137 предыдущих passed |
| vitest `src` целиком | 643 файла passed, 4338 passed, 2 skipped, 1 флейк под нагрузкой (`routeChunkRecovery.test.js` — таймаут динамического импорта; отдельно 5/5 дважды); `scripts` — 9/9 |
| eslint по изменённым файлам | 0 ошибок (предупреждения прежние) |
| Браузер (моки API/WS, Playwright) | опрос: режим голосования, результаты (проголосовал, анонимный), свой с одним голосом, закрытый без голосов; 1440 тёмная и 390 светлая; размеры карточки 313/257–280 px, проценты 75/25/0, полосы 341/114/4 px, «Завершить» в карточке нет, голос уходит `POST …/poll-vote`; одиночное эмодзи: плашка времени на 2 px ниже эмодзи, пересечения нет (обе стороны, обе ширины). Скриншоты просмотрены |
| `dist` | `sw.js` SHA-256 `55F1C5379BF2AD2281E2…`, mtime `sw.js` 17:35:16 / `index.html` 17:08:35 — не менялись; dev-сервер :5234 остановлен |

### Не проверено

- Приёмка на стенде: опрос во всех сочетаниях раздела 33 (свой/чужой, обе темы, 390/1440, до/после голоса, закрытый, анонимный), «Остановить опрос»/«Отменить голос» против реального backend, время на эмодзи.
- PostgreSQL: миграции и проверка версии шли на sqlite и на заглушке движка PG; реальный `system.alembic_version` и legacy-схема `public` не читались.
- Меню с новыми пунктами проверено тестами, скриншота меню не делал.

### Риски и действия для релиза

- **Новый файл `0125` лежит в рабочей папке = каталоге production.** Код Д4-4 (проверка вместо `upgrade`) записан раньше, поэтому процессы, стартующие с этим кодом, миграции не применяют. Но процесс, запущенный **до** правки Д4-4 и лениво инициализирующий app-схему (старый код в памяти), теоретически мог бы применить `head` в `scope=app`; `0125` в таком случае создала бы недостающую таблицу `chat_scheduled_messages` (идемпотентно, без потери данных). Основные процессы давно инициализировались при старте, поэтому окно практически закрыто; это нужно знать проверяющему.
- **Применение `0125` на production — отдельный шаг релиза** по новому runbook (проверка фактической схемы, `alembic -x url=… upgrade head`, post-check `system.alembic_version = 20261002_0125` и наличие `chat_scheduled_messages`); только по явному «да». Пока флаг `CHAT_SCHEDULED_MESSAGES_ENABLED=0`, таблица не нужна.
- После выкладки Д4-4 в логах production появится `schema_migration_check status=behind`, пока миграции не применены вручную, — это ожидаемо (версия БД уже `0124`, код знает head `0125`).
- Отложенные сообщения: при сбое побочных эффектов после отправки сообщение остаётся в чате, а событие `message.created` по сокету может не уйти — клиент увидит его при следующей синхронизации/опросе.
- `window.confirm` в «Остановить опрос» — как в «Удалить сообщение»; если нужен единый диалог проекта, это отдельная задача.
