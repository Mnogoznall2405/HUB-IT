# План: нативный мобильный чат HUB-IT → уровень Telegram

Дата аудита: 2026-09-23. Область: `mobile-hub/` (Expo 57, React Native 0.86, expo-router), чат-часть.
Backend чата: `WEB-itinvent/backend/api/v1/chat/`, `WEB-itinvent/backend/chat/`.

Документ — рабочий план для агента-исполнителя и чек-лист для агента-проверяющего.
Каждая задача имеет ID, проблему с доказательством в коде, что сделать, критерии приёмки и проверку.

---

## 0. Правила выполнения (обязательно для исполнителя)

1. Соблюдать `AGENTS.md` и `mobile-hub/README.md`. Отвечать по-русски.
2. Одна задача = один логически завершённый diff. Не смешивать задачи в одном изменении.
3. Порядок: сначала тест, воспроизводящий проблему (где возможно), затем исправление, затем тест проходит.
4. Не делать попутный рефакторинг вне задачи. Не менять публичные контракты backend без задачи, где это явно указано.
5. Не коммитить, не пушить, не создавать ветки без просьбы пользователя. Не трогать `.env`, production, IIS, PM2.
6. Не добавлять npm-зависимости без закрытого решения в разделе 1 (Decision Gates). Новые версии — опубликованные не менее 7 дней назад, без плавающих диапазонов `latest`/`*`.
7. Сохранять существующие инварианты доставки: идемпотентность по `client_message_id`, порядок FIFO внутри диалога для активных сообщений, `generation`/`lease` сессии, очистка при logout (`clearNativeChatOutbox`), отсутствие дублей пузырей.
8. Уважать `useReducedMotion` во всех новых анимациях (при reduce motion — без анимации или мгновенно).
9. Не удалять и не добавлять комментарии в коде без необходимости задачи.
10. После каждой задачи обновить таблицу «Журнал выполнения» (раздел 12) и заполнить отчёт по шаблону (раздел 10).
11. Если документация расходится с кодом — зафиксировать в отчёте, не выбирать версию молча.
12. Если задача упирается в незакрытое решение (Gate) — пропустить её, пометить `BLOCKED(Dx)` и идти дальше.

### Команды проверки (из `mobile-hub/`)

```powershell
npm run lint                  # tsc --noEmit
npx jest <путь или паттерн>   # узкие тесты
npm run test:ci               # весь набор перед закрытием фазы
```

Backend (из корня репозитория), только если менялся backend:

```powershell
pytest -q tests/test_chat_<feature>.py
```

Перед запуском backend-тестов проверить fixtures: тесты не должны ходить в production БД.

Device smoke (только вручную пользователем или с его разрешения): `npm run smoke:device`.

---

## 1. Decision Gates (решения пользователя)

Пока решение не принято — задачи с меткой Gate не выполнять.

| ID | Вопрос | Варианты | Статус | Блокирует |
|----|--------|----------|--------|-----------|
| D1 | Добавить нативный фундамент: `react-native-reanimated`, `react-native-gesture-handler`, `react-native-keyboard-controller` (опционально `@shopify/flash-list`) | да / нет / частично | РЕШЕНО (да — раздел 6 «принято пользователем»; N1 выполнен. FlashList — опционально по замерам B2 → N2) | Фаза 3, 4 (часть задач) |
| D2 | Хранить очередь исходящих в приватной папке приложения (expo-file-system) вместо SecureStore | да / нет (остаёмся в SecureStore с оптимизацией) | РЕШЕНО 25.09 пользователем: **нет** — остаёмся в SecureStore с оптимизацией S1a; S1b снята (лимит 256 КБ и Keystore-стоимость приняты) | S1b |
| D3 | Отправка/докачка вложений при свёрнутом приложении (фон, resumable upload, изменения backend) | да / нет / позже | РЕШЕНО 25.09 пользователем: **полный объём A+B+C** — A в работу сразу; B — ADR + согласование backend-контракта; C — foreground service после B | S8 |
| D4 | Объём «аналога Telegram»: звонки, секретные чаты | включить / исключить | РЕШЕНО 25.09 пользователем: **исключить** — F-CALL/F-SECRET сняты | Фаза 6 (F-CALL, F-SECRET) |
| D5 | Как держать WebSocket дольше срока access-токена (15 мин) | (а) проверка сессии без `exp` / (б) продление токена внутри сокета / (в) плановое переподключение | РЕШЕНО 24.09 (делегировано проверяющему): **б+ — in-socket re-auth** (`chat.auth` с access_token/ws_ticket + grace-окно, спека в W8/16.4). (а) отклонён — ослабляет украденный-токен сценарий; (в) остаётся fallback | W8 |
| D6 | `expo-media-library` для in-app сетки галереи в панели вложений | да / нет | РЕШЕНО 24.09: да (пользователь, полная копия панели Telegram включая контакты/гео/опрос) | T8, F-GEO, F-CONTACT, F-POLL |

---

## 2. Сводка проблем (что нашёл аудит)

| # | Проблема | Где | Приоритет |
|---|----------|-----|-----------|
| P1 | Очередь исходящих целиком в SecureStore: каждый переход состояния = чтение и перезапись всего зашифрованного JSON, ~5 записей и ~8 чтений на одно текстовое сообщение, общая сериализованная очередь, лимит 256 КБ | `src/chat/nativeChatOutbox.ts:81-95`, `src/chat/nativeChatOutboxLegacy.ts:72-91,105-126` | Критично |
| P2 | Одно `paused` сообщение блокирует все последующие в диалоге навсегда (до ручного действия) | `src/chat/nativeChatDeliveryRunner.ts:64-67`, `src/chat/nativeChatOutbox.ts:247-248` | Критично |
| P3 | Автоповтор заканчивается после 5 попыток (~1 мин), дальше только вручную | `src/chat/nativeChatOutbox.ts:16-17,288-292` | Высокий |
| P4 | Текст остаётся в композере до durable-записи — пузырь уже есть, а текст ещё в поле | `src/screens/chat/NativeChatThreadScreen.tsx:1304-1314` | Высокий |
| P5 | Доставка останавливается при уходе приложения в фон, загрузка файла прерывается и начинается заново | `src/chat/NativeChatDeliveryHost.tsx:37-38,81` | Высокий |
| P6 | Прогресс загрузки в `extraData` FlatList через `JSON.stringify` — каждый тик перерисовывает весь список | `src/screens/chat/NativeChatThreadScreen.tsx:2963` | Высокий |
| P7 | `persistConfirmed` делает read → write → read снимка диалога на каждое подтверждение | `src/chat/NativeChatDeliveryHost.tsx:60-76` | Средний |
| P8 | Ошибки через модальный `Alert.alert` (54 в экране диалога, 15+ в инбоксе); тостов в проекте нет | `NativeChatThreadScreen.tsx`, `NativeChatInboxScreen.tsx` | Средний |
| P9 | Нет reanimated / gesture-handler / keyboard-controller — все жесты на JS-потоке через `PanResponder` | `package.json`, `SwipeableChatBubble.tsx`, `EdgeBackSwipeOverlay.tsx`, `ChatComposer.tsx` | Высокий |
| P10 | Свайп «назад» срабатывает только по отпусканию пальца, нет интерактивного следования за пальцем, только узкая кромка | `src/components/chat/EdgeBackSwipeOverlay.tsx` | Высокий |
| P11 | Клавиатура Android: `KeyboardAvoidingView behavior='height'` + `softwareKeyboardLayoutMode: 'resize'`; синхронная анимация только на iOS. Гипотеза: двойная подстройка/скачки при edge-to-edge | `src/chat/chatKeyboard.ts`, `src/chat/useChatKeyboardMotion.ts`, `app.config.ts:28` | Высокий |
| P12 | Шторки/меню на системном `Modal` (71 использование) — нет drag-to-dismiss, системная анимация | `src/components/chat/*Sheet.tsx`, `MessageActionsSheet.tsx` | Средний |
| P13 | Unicode вместо иконок: `↩ ➦` (свайп), `↓` (вниз), `×` (закреп), `✓ ✓✓ !` (статусы), спиннер вместо «часиков» | `SwipeableChatBubble.tsx:150-159`, `NativeChatThreadScreen.tsx:2931,3004`, `ChatDeliveryStatus.tsx` | Средний |
| P14 | Нет «хвостика» у последнего пузыря группы, нет фонового паттерна чата, при холодном открытии — спиннер вместо скелета | `ChatBubble.tsx:727-728`, `NativeChatThreadScreen.tsx:2936-2940` | Низкий |
| P15 | `DESIGN.md` утверждает «light mode only», а `chatTokens.ts` имеет dark — расхождение документации | `mobile-hub/DESIGN.md`, `src/theme/chatTokens.ts` | Низкий |
| P16 | `NativeChatThreadScreen.tsx` — 3274 строки (история, realtime, отправка, скролл, медиа, шторки в одном компоненте); `NativeChatInboxScreen.tsx` — 1158 | `src/screens/chat/` | Высокий (блокирует полировку) |
| P17 | Анимации вкладок отключены (`animation: 'none'`), нижняя навигация скрывается рывком | `app/(shell)/_layout.tsx:25-31` | Низкий |

---

## 3. Фаза 0 — Базовые замеры (baseline)

Цель: цифры «до», чтобы доказать улучшение «после». Без этой фазы задачи S1, S5, T* не считаются подтверждёнными по производительности.

### B1. Инструментирование времени отправки
- Добавить диагностические метки (через существующий `src/diagnostics/diagnostics.ts`, без логирования текста сообщений) для: `tap_send`, `bubble_visible` (optimistic), `outbox_persisted`, `http_start`, `http_ack`, `ui_confirmed`.
- Добавить замер длительности каждой операции хранилища очереди (read/write) — только длительность и размер в байтах.
- Метки должны быть выключены или дешёвые в release; не содержать PII/текст.
- Приёмка: в диагностике видны интервалы `tap→bubble`, `tap→http_start`, `tap→ack`, `storage op p50/p95`.
- Проверка: unit-тест, что метки не содержат `body_text`; `npm run lint`.

### B2. Протокол ручного замера на устройстве
- Описать в отчёте сценарии (пользователь выполняет на реальном Android):
  1. 20 текстовых сообщений подряд в одном диалоге, онлайн.
  2. 5 сообщений при пустой и при наполненной очереди (10+ неотправленных).
  3. Прокрутка диалога 500+ сообщений — визуальная плавность/FPS (Android «Profile GPU rendering» или Perf Monitor).
  4. Открытие/закрытие клавиатуры 10 раз — наличие скачков.
  5. Загрузка фото 10+ МБ с прогрессом — плавность списка.
- Приёмка: таблица baseline в разделе 12 заполнена значениями пользователя или помечена «не измерено» с причиной.

---

## 4. Фаза 1 — Отправка и доставка (главный приоритет)

### S1a. Сократить операции хранилища очереди (без смены хранилища)
- Проблема: P1. Две обёртки (`nativeChatOutbox.ts` поверх `nativeChatOutboxLegacy.ts`) каждая читают/пишут весь blob; `queue()` делает `put` (запись), затем `update` со штампом `delivery: queued` (ещё чтение+запись).
- Сделать:
  1. Ввести единый in-memory mirror очереди (кеш), загружаемый один раз на сессию/generation; все чтения — из памяти; все записи — write-through в хранилище внутри существующего `enqueueNativeChatStorage`.
  2. Кеш сбрасывается при `clearNativeChatOutbox()` и смене `generation`; при ошибке записи — откат кеша к последнему успешно записанному состоянию.
  3. `queue()` должен создавать запись сразу с `delivery: { version: 1, state: 'queued', attempts: 0, notBefore: 0 }` — одна запись вместо двух.
  4. Переход `sending → confirmed → remove` схлопнуть: если `persistConfirmed` успешен — сразу удалить запись одной операцией, без промежуточной записи `confirmed` (in-memory `acknowledgements` уже защищает UI). Если не успешен — записать `confirmed`.
  5. `readNativeChatOutbox` в `pump` должен читать из кеша.
- Не менять: формат хранимых данных (совместимость с уже сохранёнными очередями), валидацию `validDelivery`/`validMessage`, семантику `busy`.
- Приёмка:
  - На одно текстовое сообщение (онлайн, успешная отправка): ≤ 3 записи в хранилище и ≤ 1 чтение (первичная загрузка кеша не считается).
  - Perf-подтверждение только после B2 (§3): без заполненной таблицы baseline бюджет считается тест-бюджетом, не приёмкой.
  - Все существующие тесты `nativeChatOutbox.test.ts`, `nativeChatDeliveryRunner.test.ts`, `NativeChatOutboxScreen.test.tsx`, `NativeChatDeliveryHost.test.tsx`, `NativeChatScreens.test.tsx` проходят.
- Тесты (новые):
  - Счётчик вызовов `SecureStore.setItemAsync/getItemAsync` на сценарий «queue → deliver → ack».
  - Ошибка записи в середине → кеш не расходится с хранилищем (следующее чтение после «перезапуска» модуля даёт то же состояние).
  - `clearNativeChatOutbox` во время доставки → кеш пуст, старый lease не пишет.

### S1b. Перенос очереди из SecureStore в файловое хранилище — Gate D2
- Проблема: P1 (лимит 256 КБ, стоимость шифрования Keystore на каждую операцию).
- Сделать:
  1. Хранилище: `FileSystem.documentDirectory/chat-outbox/<userId>/` — один JSON-файл на сообщение (`<seq>-<client_message_id>.json`), атомарная запись (tmp-файл → move). `seq` — монотонный номер для FIFO.
  2. Адаптер хранилища за интерфейсом (read all / put / update / remove), чтобы S1a-кеш работал поверх любого бэкенда.
  3. Однократная миграция: прочитать `CHAT_OUTBOX_STORAGE_KEY` из SecureStore → записать файлы → проверить чтением → только потом удалить ключ SecureStore. Повторный запуск миграции безопасен (идемпотентен).
  4. `clearNativeChatOutbox()` удаляет папку пользователя и ключ SecureStore (если остался).
  5. Убрать лимит 256 КБ на всю очередь; оставить разумный лимит на одну запись и на число записей (например 500) с понятной ошибкой.
- Приёмка: миграция с существующей очереди без потерь (тест на фикстуре старого формата, включая записи без `delivery`), logout очищает файлы, FIFO сохраняется после «перезапуска».
- Тесты: миграция, повторная миграция, падение между записью файлов и удалением ключа, порядок, logout.

### S2. Мгновенная очистка композера — ✅ выполнено
- Проблема: P4.
- Сделать в `sendMessage` (`NativeChatThreadScreen.tsx:1261-1315`): сохранить текст/режим ответа в локальные переменные, сразу очистить поле и `composerMode`, показать пузырь. При ошибке `outbox.queue` — вернуть текст и режим ответа, только если пользователь ещё не начал набирать новый текст (сравнение по `textRevisionRef`), иначе — не затирать ввод, показать ошибку с действием «Скопировать текст»/«Повторить». Черновик удалять только после durable-записи (как сейчас).
- Аналогично для `sendPickedFiles` с подписью (caption).
- Режим редактирования (`edit`) не трогать — он синхронный с сервером.
- Приёмка: после нажатия «Отправить» поле пустое в том же кадре, что и появление пузыря; при сбое записи текст не теряется.
- Тесты: успешная отправка → поле пустое до резолва `queue`; ошибка `queue` → текст восстановлен; ошибка `queue` после того как пользователь напечатал новый текст → новый текст не затёрт.

### S3. Paused/ошибочное сообщение не блокирует диалог
- Проблема: P2.
- Принятое отклонение 25.09 (контролёр, код `nativeChatDeliveryRunner.ts:65-76`, `nativeChatOutbox.ts:274-282`): FIFO уступают не только `paused`, но и `cancelled`, `retry` с будущим `notBefore`, записи с исчерпанными `attempts`. Спека ниже — минимальное требование, факт шире и верен.
- Сделать:
  1. `nativeChatDeliveryRunner.ts`: `blockedDialogs.add` только для состояний `queued | retry | sending` (активные), не для `paused` и `cancelled`.
  2. `nativeChatOutbox.ts` `deliverQueued` (строки ~247-248): проверка предшественников должна игнорировать `paused` так же, как `confirmed`/`cancelled`.
  3. Порядок: активные сообщения диалога по-прежнему строго FIFO между собой.
  4. UI: у paused-пузыря красный индикатор «!» и действия «Повторить» / «Удалить». При повторе сообщение уходит в конец активной очереди (как в Telegram), локальное время пузыря обновить на момент повтора или оставить — зафиксировать решение в отчёте.
- Приёмка: сценарий «A paused (4xx), затем B, C» → B и C доставлены; A остаётся с «!»; после «Повторить» A доставляется.
- Тесты: runner-тест со смешанными состояниями; тест `deliverQueued` с paused-предшественником; тест, что два активных сообщения всё ещё идут по порядку.

### S4. Политика повторов — PARTIAL 25.09 (контролёр: реализован cap=5, остаток R-S4 ниже)
- Проблема: P3.
- Факт реализации (проверено в коде `nativeChatOutbox.ts:19-20,112-115,332-336`, `NativeChatDeliveryHost.tsx:41`): transient только `408/429/5xx + сеть/offline`, лестница `[2s,5s,15s,30s]`, `cap=5 → paused`, без jitter, без `Retry-After`, `wake()` без сброса `notBefore`. Это осознанное усечение спеки, не полный S4.
- Сделать:
  1. Разделить ошибки: transient (`transient()` в `nativeChatOutbox.ts`: сеть, 408, 429, 5xx) и терминальные (прочие 4xx).
  2. Transient: повторять без предела, пока `canDeliver()`; backoff `[2s, 5s, 15s, 30s, 60s]` с потолком 60 с и джиттером ±20 %; при 429 учитывать заголовок `Retry-After`, если есть.
  3. Терминальные: сразу `paused` с сохранённой причиной (например `413` → «Файл слишком большой», `403` → «Нет прав на отправку», `404 Quoted message not found` → существующий `replyMissing`).
  4. Переподключение WebSocket / возврат в foreground / появление сети → немедленный `wake()` с обнулением `notBefore` для transient-записей.
  5. `attempts` оставить для диагностики, но не использовать как жёсткий стоп для transient.
- Предусловие: проверить на backend (`WEB-itinvent/backend/api/v1/chat/messages.py:410-487, 550-600` и сервис), что повтор с тем же `client_message_id` возвращает уже созданное сообщение (200), а не создаёт дубль и не отдаёт ошибку. Если это не так — остановиться, описать в отчёте, запросить решение у пользователя.
- Приёмка: 10 transient-ошибок подряд → сообщение продолжает ретраиться и доставляется после восстановления; 400/403/413 → paused с понятной причиной.
- Тесты: классификация ошибок; backoff с фиктивным временем; wake на reconnect; дубль по `client_message_id` на backend (если тест backend существует — дополнить).
- R-S4 (остаток, не блокер приёмки S4-cap): безлимитный retry transient пока `canDeliver()`, потолок 60с + jitter ±20%, `Retry-After` при 429, сброс `notBefore` для transient на reconnect/foreground/сеть. Отдельной задачей после B2-замеров.

### S5. Прогресс загрузки без перерисовки списка
- Проблема: P6.
- Сделать: убрать `JSON.stringify(attachmentTransfers)` из `extraData` FlatList. Хранить прогресс во внешнем сторе (подписка `useSyncExternalStore` по `attachmentId` / `client_message_id`); пузырь/вложение подписывается только на свой ключ. Тики прогресса троттлить (не чаще ~10 раз/с).
- Приёмка: при загрузке перерисовывается только пузырь с этим вложением.
- Тесты: счётчик рендеров соседних пузырей не растёт при 20 тиках прогресса (по образцу существующих `*Performance.test.tsx`).

### S6. Облегчить `persistConfirmed`
- Проблема: P7.
- Сделать: писать подтверждённое сообщение в снимок через существующий `scheduleNativeChatThreadSnapshotWrite` без повторного read-verify на каждое сообщение; проверка durable — по результату записи (resolve без ошибки). Если нужна верификация — батчить (одна проверка на пачку подтверждений).
- Приёмка: на одно подтверждение ≤ 1 чтение и 1 запись снимка (или 0 чтений при горячем кеше).
- Тесты: существующие `NativeChatDeliveryHost.test.tsx`, `nativeChatThreadHistory.test.ts` + счётчик операций.

### S7. Ошибки без модальных окон
- Проблема: P8.
- Сделать:
  1. Создать общий чат-тост/снекбар на `react-native-paper` `Snackbar` (уже в зависимостях) — провайдер на уровне `(shell)` или чата, API `showChatNotice({ text, action? })`.
  2. Заменить `Alert.alert` для неблокирующих ошибок (реакция, удаление, пин, копирование, загрузка, папки) на тост. Оставить `Alert`/подтверждение только для деструктивных подтверждений («Удалить сообщение?», «Удалить чат?»).
  3. Ошибка доставки — только индикатор «!» у пузыря + действие по тапу, без модалки.
  4. Тексты — по правилам `better-writing`: что случилось + что сделать.
- Приёмка: в `NativeChatThreadScreen.tsx` и `NativeChatInboxScreen.tsx` `Alert.alert` остались только для подтверждений деструктивных действий (перечислить в отчёте).
- Тесты: тост показан при ошибке `toggleReaction`; доступность (`accessibilityLiveRegion`).

### S8. Фоновая отправка и докачка — Gate D3
- Проблема: P5.
- Этап A (без backend): при уходе в фон не прерывать уже идущую HTTP-загрузку сразу — дать ей завершиться в пределах того, что разрешает ОС; прерывать только при `suspend` сокета/сессии. Проверить, что прерванная загрузка не считается попыткой (сейчас `suspended` уменьшает attempts — сохранить).
- Этап B (backend + клиент): resumable upload — загрузка частями с `upload_id` и докачкой с последнего подтверждённого смещения; финализация создаёт сообщение с тем же `client_message_id`. Потребует ADR в `docs/adr/`, изменения API, миграции (если хранение частей в БД) — отдельное согласование.
- Этап C (опционально): Android foreground service / `expo-background-task` для завершения очереди при свёрнутом приложении.
- Приёмка этапа A: фото 10 МБ, сворачивание на 5 с, возврат → загрузка не начинается с нуля, либо (если ОС убила запрос) повторяется ровно один раз без дублей.

### S9. Визуальные статусы доставки
- Проблема: P13 (часть).
- Сделать в `ChatDeliveryStatus.tsx`: иконки `MaterialCommunityIcons` — `clock-outline` (sending/queued), `check` (sent), `check-all` (read, цвет `statusReadText`), `alert-circle` (failed/paused, `dangerText`). Анимация смены иконки (fade/scale ≤ 150 мс), при reduce motion — без анимации. Сохранить `accessibilityLabel`.
- Приёмка: нет Unicode-глифов, нет `ActivityIndicator` в статусе.
- Тесты: снапшот/рендер-тест на все статусы.

---

## 5. Фаза 2 — Декомпозиция экрана диалога (без изменения поведения)

Выполнять после S1a–S5 (или параллельно отдельными PR, если исполнитель уверен). Цель — сделать полировку безопасной и убрать лишние перерисовки.

### R1. Выделить хуки из `NativeChatThreadScreen.tsx` — ✅ выполнено
- `useThreadHistory` — загрузка, пагинация older/newer, снимок, merge.
- `useThreadRealtime` — подписки `chatSocket` (created/updated/deleted/reaction/typing/presence), HTTP fallback 15 с.
- `useThreadSend` — `sendBody`, `sendMessage`, `sendPickedFiles`, retry/discard/cancel, outbox.
- `useThreadScrollAnchor` — jump-to-bottom, фокус/подсветка сообщения, скролл-хэндлеры; `requestBottomAnchor`/`anchorToBottom` остались в экране (нужны `useThreadHistory` до инициализации history refs).
- `useThreadComposerState` — текст, режимы reply/edit, черновик.
- `useThreadSheets` — видимость шторок/меню + действия диалога (members/rename/tasks/stickers).
- Дополнительно: `useThreadSelection`, `useThreadForward`, `useThreadSearch`, `useThreadMessageActions`, `useThreadAttachments`, `useThreadBack`, `useThreadRender`; шторки JSX вынесены в `ChatThreadOverlays.tsx`.
- Правила: чистое перемещение кода, без изменения поведения; состояние сообщений — через `useReducer` с явными action (`merge`, `replacePending`, `markFailed`, ...). — отступление: `setMessages` остался `useState` + `mergeMessages`/map-патчем; переход на reducer запланирован при следующем изменении контракта истории.
- Приёмка: `NativeChatThreadScreen.tsx` ≤ 1200 строк (факт: 1153); все существующие тесты проходят без изменения ожиданий.
- Проверка: `npm run lint` (tsc) ✅, `npx jest src/screens/chat src/chat src/components/chat` — 79 suites / 601 test ✅.

### R2. Мемоизация рендера сообщений — ✅ выполнено
- `renderMessage` и пропсы пузыря стабильны (`useCallback`, стабильные колбэки через ref); `ChatBubble`/`SwipeableChatBubble` `memo` с корректным сравнением; `extraData` содержит только то, что реально влияет на все строки (выделение, unread boundary).
- Реализация: строки — `ThreadMessageRow` (memo) в `useThreadRender.tsx`; декорации — `Map<messageId, decoration>` с сохранением идентичности неизменённых объектов; действия — ref-мешок `messageActionsRef`; из `extraData` убран `JSON.stringify(attachmentTransfers)` (S5-стор покрывает прогресс).
- Приёмка: новый входящий message перерисовывает ≤ 2 строк (новую и соседнюю для группировки) — покрыто тестом `rerenders at most two rows for a new incoming socket message` в `NativeChatTypingPerformance.test.tsx` (эмит `chat.message.created` через перехваченный handler).
- Проверка: tsc ✅, `npx jest src/screens/chat src/chat src/components/chat` — 79 suites / 602 tests ✅.

### R3. Аналогично для инбокса (`NativeChatInboxScreen.tsx`) — ✅ выполнено
- Выделены `useInboxData` (загрузка/снимки/realtime/HTTP-fallback), `useInboxFolders` (папки, membership, manager/assign шторки), `useInboxActions` (поиск, AI-диалоги, новый чат, настройки, навигация); `workspace` остался в экране (нужен folders до actions).
- Неблокирующие ошибки (`create/rename/delete folder`, membership, AI reset/delete/rename, settings, new chat) — `showNativeToast` вместо `Alert`; `Alert` остался только для подтверждений (удаление папки/AI-диалога, сброс контекста).
- Приёмка: ≤ 600 строк (факт: 591), тесты `NativeChatInbox*.test.tsx` проходят.
- Проверка: tsc ✅, `npx jest src/screens/chat src/chat src/components/chat` — 79 suites / 602 tests ✅.

---

## 6. Фаза 3 — Нативный фундамент — Gate D1 — ✅ принято пользователем

### N1. Установка и конфигурация — ✅ выполнено (JS-часть; сборка APK — пользователю)
- Установлено через `npx expo install` (Expo 57): `react-native-reanimated` 4.5.1, `react-native-gesture-handler` 2.32.0, `react-native-keyboard-controller` 1.21.9 (+ транзитивный `react-native-worklets` 0.10.1).
- `babel.config.js` — плагин `react-native-worklets/plugin` (Reanimated 4.x использует worklets-плагин, а не legacy `reanimated/plugin`).
- `app/_layout.tsx` — `GestureHandlerRootView` + `KeyboardProvider` вокруг всего дерева.
- Jest: `setupFiles` += `react-native-gesture-handler/jestSetup.js`; моки `react-native-reanimated/mock` и `react-native-keyboard-controller` в `src/test/setup.ts`; `transformIgnorePatterns` расширены тремя пакетами + worklets.
- Попутно исправлен тест `NativeFilterControls` (truncation props только при многоколоночной сетке).
- Осталось: `npm run prebuild:android` + `npm run build:apk:local:debug` — пользователь; затем T1–T3, T5.

### N2. (Опционально) FlashList для ленты сообщений
- Только после замеров B2, если FlatList даёт просадку на 500+ сообщениях. Учесть: перевёрнутый список, `maintainVisibleContentPosition`, переменная высота, `scrollToIndex`.
- Приёмка: не хуже baseline по FPS, все тесты скролла/якорей проходят.

---

## 7. Фаза 4 — Переходы, жесты, клавиатура

### T1. Клавиатура как в Telegram — ✅ выполнено (JS-часть; проверка на устройстве)
- Проблема: P11.
- Сделано: `KeyboardAvoidingView` из `react-native-keyboard-controller` в `ChatKeyboardAvoidingHost` и `NativeChatThreadScreen` (подстройка на UI-потоке, без двойной анимации; `softwareKeyboardLayoutMode: 'resize'` совместим). `KeyboardProvider` в корне.
- Отклонение от плана: `KeyboardGestureArea` в установленной версии KC 1.21 отсутствует — интерактивное скрытие свайпом на Android остаётся `keyboardDismissMode='on-drag'` (snap, не follow-finger); follow-finger возможен через `KeyboardChatScrollView` — отдельная миграция FlatList, вынесена в бэклог.
- Приёмка: проверка на устройстве — 10 открытий/закрытий без скачков (ручная).

### T2. Интерактивный свайп «назад» — ✅ выполнено (вариант б)
- Проблема: P10.
- Сделано: `ChatInteractiveBackGesture` — кастомный слой gesture-handler `Pan` (manualActivation) + reanimated поверх stack. Правила зафиксированы: активация только из левой половины экрана и dx ≥ 14 — reply-свайп пузыря (dx > 8) выигрывает раньше; экран следует за пальцем (translateX), под ним виден инбокс (contentStyle стека стал transparent, экраны красят свой фон сами); отпускание > 35 % ширины или vx ≥ 0.5 px/мс → увод + `router.back`, иначе пружина. Отключается при выделении/медиа/записи голосового.
- Выбор (б) обоснован: `fullScreenGestureEnabled` в react-native-screens 4.26 на Android не даёт интерактивного жеста.
- Отклонение: параллакс/затемнение инбокса не реализованы — нижний экран виден статично (затемнение снизу невозможно без контроля над инбоксом; записано как допустимое упрощение).
- Тесты: `shouldCommitBackGesture` — чистая worklet-функция, покрытие в chatGestures.test.

### T3. Свайп ответа/пересылки на UI-потоке — ✅ выполнено
- `SwipeableChatBubble` переписан на `Gesture.Pan` + reanimated shared value: активация по горизонтали (activeOffsetX ±8, failOffsetY ±14 — вертикальный скролл всегда выигрывает), резиновое сопротивление за порогом (`applySwipeResistance`: 1/4 избытка, кап +14), haptic один раз на пересечение порога, возврат пружиной. Voice-lock проверяется на release в JS (`fireSwipe`).
- Иконки `reply`/`share` (P13) — уже векторные, с масштабированием к порогу.
- Тесты: пороги (`resolveSwipeRelease`, `applySwipeResistance`, voice-lock) — jest.

### T4. Меню сообщения в стиле Telegram — ✅ выполнено
- Проблема: P12.
- Сделано: затемнённый фон + позиционированная карточка через `placeMessageActionMenu` (уже было); теперь пузырь приподнимается (scale 0.97→1.03 + тень) на своём месте через `renderLiftedBubble` (`useThreadRender`) поверх backdrop в `MessageActionsSheet`; полоса быстрых реакций + список действий (уже было); `hapticSelection` при открытии меню и старте выделения; `Animated` + native driver.
- Приёмка: меню не выходит за safe area (клампинг в `placeMessageActionMenu`), работает у краёв (placement above/below), действия — список кнопок с accessibilityLabel.

### T5. Шторки с drag-to-dismiss — ✅ выполнено
- Общий `ChatBottomSheet`: Modal + затемнённый backdrop (fade по прогрессу перетаскивания), drag-полоса с handle на UI-потоке (`shouldDismissSheet`: dy ≥ 90 или fling), пружина возврата, `avoidKeyboard`, `backdropTestID`/`sheetTestID`, Android back → `onRequestClose` закрывает шторку, не экран.
- Переведены все нижние шторки чата: `AttachmentPickerSheet` (+ векторные иконки), `ChatEmojiPickerSheet`, `ChatStickerPickerSheet` (старый PanResponder удалён), `ChatConversationActionsSheet`, `ForwardMessageSheet`, `ChatConversationInfoSheet`, `NewChatSheet`, `ChatFolderAssignSheet`, `ChatFolderManagerSheet`, `ChatAttachmentDraftSheet`, `ChatAttachmentActionsSheet`, `ChatTaskShareSheet`, `ChatMemberPickerSheet` (ChatGroupEditSheets).
- Центрированные диалоги (`ChatRenameSheet`, `ChatParticipantProfileSheet`, `AiConversationActionsSheet`) — не bottom-sheet, оставлены как есть.
- Приёмка: Android back закрывает шторку, `accessibilityViewIsModal` сохранён (backdrop намеренно скрыт из a11y-дерева — тесты используют includeHiddenElements).

### Баги приёмки preview 1.1.49 на устройстве (24.09, входит в следующий релиз)

- **B-T1-1. Клавиатура наезжает на композер (критично) — исправлено (проверка на устройстве).** На Android композер оставался под клавиатурой: edge-to-edge отключает `adjustResize`, а KAV `behavior:'height'` не применялся. Сделано: композер обёрнут в `KeyboardStickyView` (UI-поток), список сообщений получает `paddingBottom = -keyboardHeight` через `useReanimatedKeyboardAnimation` — последнее сообщение остаётся видимым; KAV-обёртка экрана убрана (один механизм). Modal-шторки с вводом — на `avoidKeyboard` (KC KAV внутри Modal — проверить на устройстве).
- **B-T3-1. Краш при завершении reply/forward-свайпа (критично).** Причина: `resolveSwipeRelease`/`shouldTriggerReply`/`shouldTriggerForward` вызывались из worklet `onEnd` без директивы `'worklet'` → Reanimated бросает «non-worklet function called on UI runtime». Исправлено директивами в `SwipeableChatBubble.tsx`; нужна пересборка и повторная проверка.
- **B-T3-2. Визуальный артефакт под последним сообщением — исправлено (проверка на устройстве).** Это «хвост» пузыря (`styles.tail` в `ChatBubble`): нижний угол last-пузыря оставался скруглённым, а хвост стоял с отступом 6px → тёмный клин отдельно от пузыря. Сделано: `borderBottomRightRadius/Left: 0` у `groupLast*` и хвост вплотную (`right/left: -4`).
- **B-T2-1. Плохо работают горизонтальные свайпы переключения папок в инбоксе — исправлено (проверка на устройстве).** `FolderSwipeHost` переписан с PanResponder на `Gesture.Pan` (manualActivation, те же пороги `shouldStartFolderSwipe`/`shouldTriggerFolderSwipe`) + reanimated translateX — устраняет конфликт responder lock с GH-иерархией; jest 4/4.
- **B-T5-1. Панель эмодзи/шторка «уезжает» вверх, снизу виден чат (1.1.50).** Причина: `ChatBottomSheet` с `avoidKeyboard` оборачивал всё тело `Modal` в KC `KeyboardAvoidingView` (`height`), который сжимал область вместе с backdrop — шторка «прилипала» к верху сжатой области, а под ней проступал незатемнённый чат. Исправлено: backdrop больше не сжимается, шторка прилипает к клавиатуре через `KeyboardStickyView` внутри `GestureHandlerRootView`. **Дополнение проверяющего:** для `KeyboardStickyView` внутри `Modal` на Android нужен `navigationBarTranslucent` у `Modal` (сейчас только `statusBarTranslucent`) и нижний inset у шторки — без этого sticky в модалке не следует за клавиатурой. Проверить на устройстве: эмодзи-панель, шторки с полем ввода.
- **B-UX-1. Фото в пузырях с серыми полями (1.1.50).** Причина: `ChatBubblePhoto` рендерил кадр по дефолтному аспекту и `resizeMode="contain"` → letterbox-серые полосы на вертикальных и горизонтальных фото. Исправлено: `resizeMode="cover"` + после `onLoad` кадр пересчитывается по реальному `source.width/height` — фото заполняет пузырь без полей в обоих направлениях. Проверить на устройстве.
- Общее правило фиксов: каждый пункт закрывать только после проверки на устройстве; собрать новый preview (1.1.50+) после исправлений.

### T6. Переходы экранов и нижняя навигация — ✅ выполнено
- Проблема: P17.
- Inbox → Thread: `slide_from_right` + `animationDuration: 280` в `app/(shell)/chat/_layout.tsx`; белой вспышки нет (`contentStyle` = `threadBg`, `reduceMotion` → 'none').
- Нижняя навигация: `HubBottomNav` — spring заменён на `timing` 180 мс ease-out (translateY + fade ≤ 200 мс).
- Открытие диалога: кэшированный снимок истории показывается мгновенно (`hadCachedSnapshot` в `useThreadHistory`), сеть — фоном.
- Приёмка: рывков layout при входе/выходе нет; проверка — `npx jest src/components/layout` + smoke на устройстве.

### T7. Микро-анимации — ✅ выполнено (частично)
- Кнопка «вниз»: `ChatJumpToBottomButton` — иконка `arrow-down` вместо `↓`, spring scale+fade, бейдж со scale-pop при изменении счётчика.
- Морфинг mic ↔ send в `ChatComposer`: rotate/scale+fade 140 мс через `actionMorph`.
- «Печатает…»: `TypingDots` (3 точки, стаггер 1.2 с loop) в `ChatHeader.subtitleExtra` при активном typing. Частично: в строке инбокса typing-индикатор не добавлен — в `ChatConversationSummary` нет typing-поля, нужен отдельный realtime-канал (кандидат в FA-бэклог).
- Enter-motion: проверено — `messageEnterMotionsRef` ставится только в realtime `chat.message.created` и own-send, а в history — лишь для новых сообщений у нижнего края при готовой анимации (`messageAnimationReadyRef`); при загрузке истории/пагинации анимация не играет.
- Все — с `useReducedMotion`.

### T8. Панель вложений как в Telegram — TODO (заказан 24.09)

**Проблема.** Сейчас `AttachmentPickerSheet` — вертикальный список из 6 строк («Камера / Фото из галереи / Файл / Задача / Стикер / Отмена»). У Telegram скрепка открывает выдвижную панель с сеткой последних фото, мультивыбором и нижним рядом действий. Цель — полный функционал этой панели.

**Каркас.** Панель — **inline-элемент экрана диалога** над композером (не `Modal`): свайп вверх по хэндлу разворачивает до полноэкранной галереи, вниз — сворачивает/закрывает; открытие/закрытие — spring на UI-потоке (reanimated уже есть). Панель и клавиатура взаимоисключающие: открытие панели прячет клавиатуру (`KeyboardController.dismiss`), фокус в композер закрывает панель. Reduce motion — мгновенная смена состояний.

**Состав панели (сверху вниз):**
1. Сетка свежих медиа: 3 колонки квадратных ячеек (~2px gap), первый элемент — плитка «Камера» (иконка, запуск съёмки). Подгрузка страницами по ~90 элементов (`FlatList`, `getItemLayout` по квадрату, `windowSize` умеренный — не уронить FPS).
2. Видео-ячейки: бейдж длительности + иконка play; GIF — бейдж GIF.
3. Мультивыбор: тап по ячейке переключает выбор; на выбранной — пронумерованный бейдж (порядок отправки) с scale-pop; счётчик в кнопке отправки «Отправить (N)». Лонг-тап по ячейке — предпросмотр/редактор (`ChatImageEditorSheet` для фото).
4. В развёрнутом виде: селектор альбомов («Галерея ▾») — перечень альбомов с количеством; тап — переключение сетки на альбом.
5. Нижний ряд действий (иконка+подпись, полная копия Telegram — решено 24.09): **Галерея** (системный пикер, текущий `pickNativeAttachments('gallery')`), **Файл** (`'document'`), **Геопозиция** (F-GEO), **Опрос** (F-POLL), **Контакт** (F-CONTACT) + наши **Задача**, **Стикер**. F-*-пункты подключаются по мере готовности backend-типов; до их появления ряд показывает доступные действия.
6. При выборе > 0: поле подписи (caption) + кнопка «Отправить (N)» → существующий pipeline: `attachmentDraftFiles` + `text` как caption → `sendAttachmentDraft` (одно сообщение с `attachments[]` — `buildPendingAttachmentMessage` уже поддерживает `files[]`, проверено). Прогресс/повтор/отмена — существующие S5/S4.

**F-* подзадачи панели (нужны backend-типы сообщений, каждая — отдельно проверяемая):**
- **F-CONTACT — отправка контакта.** Пикер контактов устройства (`expo-contacts` — новая зависимость, разрешено D6-решением «полная копия»; если зависимость нежелательна — обсудить), выбор контакта → сообщение `kind='contact'` с payload `{name, phones[], avatar?}` (сериализация в `chat_serialization.py`, схемы `schemas.py`, миграция `kinds` если enum), пузырь-карточка с кнопками «Написать»/«Позвонить» (`tel:`)/«Сохранить в контакты». Backend: приём и хранение kind, push-сводка.
- **F-GEO — геопозиция.** `expo-location`: текущая позиция / выбор точки → `kind='location'` `{lat, lon, accuracy?}`. Пузырь: превью (без maps-зависимости — статичный блок с координатами/адресом + открытие `geo:`/`maps:` intent). Backend: kind + хранение.
- **F-POLL — опрос.** Создание: вопрос + 2–10 вариантов, анонимность/мультивыбор; `kind='poll'` `{question, options[], settings}`; голосование — отдельный endpoint `POST /polls/{id}/vote` с идемпотентностью и пересчётом; realtime `chat.poll.updated`. Пузырь с вариантами/процентами. Самая крупная F-задача — делать последней.

**Зависимости и гейты:**
- **D6 — РЕШЕНО (24.09):** `expo-media-library` разрешён; для in-app сетки обязателен (enumerация assets/альбомов/длительностей). Версия — соответствующая SDK, публикация ≥7 дней, без `latest`/`*`. Для F-GEO/F-CONTACT — `expo-location`/`expo-contacts` тем же правилом.
- Разрешения Android: `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` (API 33+), `READ_EXTERNAL_STORAGE` (≤ API 32), `CAMERA` для плитки камеры; `ACCESS_FINE_LOCATION` (F-GEO), `READ_CONTACTS` (F-CONTACT) — запрашивать только при входе в соответствующий сценарий. Denied → toast + ссылка в настройки; режим «выбранные фото» (limited) — показывать доступные + пункт «выбрать ещё».
- Инварианты доставки (S3/S4/S5/S6): панель только наполняет draft, отправка идёт тем же путём — не обходить outbox.

**Приёмка:**
- Скрепка → панель с сеткой свежих фото за < 500 мс (кэш первой страницы допустим); скролл сетки 60 FPS без белых клеток.
- Мультивыбор N фото → «Отправить (N)» → одно сообщение-альбом с N вложениями и общей подписью; в outbox — один `client_message_id`; FIFO и идемпотентность сохранены.
- Плитка камеры → снимок → редактор → отправка.
- Свайп вверх → полноэкранный режим с альбомами; свайп вниз/backdrop/back → закрытие; клавиатура и панель не пересекаются.
- Без разрешения — осмысленное состояние, нет краша; reduce motion — без анимаций.
- Тесты: редьюсер выбора (порядок номеров, снятие выбора), маппинг выбранных → `attachmentDraftFiles`, denied-ветка; jest на чистых helpers.

---

## 8. Фаза 5 — UI-полировка

### U1. Иконки вместо Unicode — ✅ выполнено
- Заменено на `MaterialCommunityIcons`: статусы `✓`/`✓✓` → `check`/`check-all` (`ChatDeliveryStatus`), `⌁` → `bell-off-outline` (`ChatHeader`), `↓` → `arrow-down` (jump-кнопка T7), `⋮` → `dots-vertical` (`ChatConversationRow`), `⌄`/`⌃` → `chevron-*` (меню реакций), все иконки `MessageActionsSheet` (`↩➦✎⧉📌⌫⚑☑↻✓✓🔗`), `↻`/`×` в оверлее загрузки (`ChatBubble`), индикаторы свайпа `↩`/`➦` (`SwipeableChatBubble`), `✓` в `NewChatSheet`/`ChatFolderAssignSheet`/`ChatGroupEditSheets`, `☑` в `AttachmentPickerSheet`.
- Оставлено осознанно: `✓✓` в `buildChatMetaPlainText` (`chatBubbleLayout.ts`) — это строка только для оценки ширины мета-спейсера, в UI не рендерится; эмодзи-опции пикера и реакций — контент.
- Приёмка: grep по глифам в UI-коде чата — только оценочная строка layout и контент сообщений. Тесты обновлены на проверку `accessibilityLabel` вместо глифа.

### U2. Пузыри — ✅ выполнено
- «Хвостик»: треугольный `tail` у пузыря `groupPosition === 'last'` (own — справа, other — слева с учётом слота аватара), цвет фона пузыря.
- Групповые радиусы — уже были (`groupFirst*`/`groupMiddle*`/`groupLast*`).
- Время и статус — inline-обтекание через `metaSpacer` + `metaFloat` (уже было, см. U7).
- Длинные слова: RN `Text` переносит по границам пузыря; overflow у пузыря `hidden`.

### U3. Фон чата — ✅ выполнено
- `assets/chat-pattern.png` — нейтральный серый точечный тайл (96×96), тайлится `resizeMode="repeat"` под списком сообщений; непрозрачность 0.05 (light) / 0.10 (dark, через `chatTokens.scheme`).
- Статичный ассет, без влияния на скролл (один `Image` под `FlatList`, `absoluteFill`). Настройка в «Оформление» — отдельной задачей.

### U4. Скелеты загрузки — ✅ выполнено
- `ChatListSkeleton.tsx`: `ChatConversationSkeleton` (строки аватар+две линии) в инбоксе при `loading`, `ChatThreadSkeleton` (пузыри) в диалоге при `loading` — вместо `ActivityIndicator`. Пульс-анимация с `useReducedMotion`.

### U5. Тёмная тема и контраст — ✅ выполнено
- Измерены все `chatTokens` скриптом (WCAG luminance). Исправлены light-тема: `accentText` `#3390ec`→`#1c72c2` (3.31→4.96), `dangerText` `#d94d4d`→`#c93b3b` (4.10→5.03), `textSecondary` `#707579`→`#6a7074` (4.66→5.02), `online` `#31b545`→`#2a9d3f` (2.68→3.50, мета ≥3). Dark-тема — уже в норме (текст ≥ 5.5, мета ≥ 3.6).

### U6. Доступность — ✅ выполнено (аудит)
- Иконочные кнопки имеют `accessibilityLabel` (композер, шапка, jump, действия меню, строки инбокса); размеры касания ≥ 44×44 соблюдены (actionButton minHeight 48, chip 44, actions 44×44).
- Меню сообщения: `accessibilityViewIsModal` на оверлее, действия — список `accessibilityRole="button"`, реакции — `accessibilityRole="toolbar"` с состоянием `selected`.
- Live-region: `ChatDeliveryStatus` — `accessibilityLabel` по статусу; неблокирующие ошибки — toast (`showNativeToast`); loading-состояния — `accessibilityLiveRegion="polite"`.
- Декоративные элементы (паттерн, хвостик, скелетоны, typing-точки) скрыты от screen reader.

---

## 9. Фаза 6 — Функциональные пробелы до Telegram

Сначала задача-аудит FA, затем реализация только подтверждённых пробелов, каждый — отдельной задачей с согласованием, если требуется backend.

### FA. Аудит функций — ✅ выполнено (таблица ниже)
Статус: `mobile` — в нативном клиенте; `backend/web` — есть вне нативного; `нет` — отсутствует везде. Приоритет: must / should / could.

| Функция | Статус | Приоритет | Доказательство |
|---|---|---|---|
| @-кнопка непрочитанных упоминаний | нет (есть @-подсказки в композере) | should | `ChatMentionSuggestions.tsx`; сервер не считает `unread_mentions` в `chat_conversation_read_store.py` |
| Возврат к исходному сообщению после jump по ответу | нет | should | `useThreadScrollAnchor.ts` (jump есть, кнопки «назад» нет) |
| Отложенные сообщения | нет | could | нет `scheduled_*` в `backend/chat/` и mobile |
| «Тихая» отправка | нет | could | нет `is_silent` в схемах (`chat/models.py`, `schemas.py`) |
| «Избранное» (Saved Messages) | нет | could | нет self-conversation в `chat_conversation_read_store.py` |
| Видеосообщения-кружки | нет (есть голосовые `voice`) | could | `nativeFilePicker.ts`, kind=voice; video note не создаётся |
| Опросы | нет | could | нет `poll` в `chat/models.py` kinds |
| История правок | backend частично (`edited_at`), просмотра истории нет | could | `chat_serialization.py` edited_at; UI истории нет |
| Черновики в списке чатов | mobile (автосохранение + восстановление), но не показаны в инбоксе | should | `chatDrafts.ts`, `useNativeChatDraftAutosave.ts`; `ChatConversationRow` не рисует «Черновик:» |
| «Печатает…» в списке чатов | нет (в диалоге есть) | should | realtime `chat.typing` → `useThreadRealtime`; в `ChatConversationSummary` поля typing нет |
| Архив чатов | mobile + backend | must: есть | `is_archived`, `onToggleArchive` (`ChatConversationActionsSheet`, `SwipeableConversationRow`) |
| Свайп-действия инбокса | mobile (mute/archive), нет read/pin/delete | should | `SwipeableConversationRow` + `inboxRowSwipeAction` (mute/archive) |
| Закреп чатов | mobile + backend | must: есть | `is_pinned`, `onTogglePin` |
| Мьют с таймером | mobile+backend только toggle, таймера нет | should | `is_muted` bool (`models.py:313`); `muted_until` отсутствует |
| Медиа-галерея чата | mobile + backend | should: есть | `chatConversationGallery.ts`, `loadMoreMediaManifest` (ChatConversationInfoSheet) |
| Поиск по всем чатам | mobile + backend | must: есть | inbox `searchConversations`, backend `q` в `list_conversations` |
| Копирование части текста | нет (копируется всё сообщение) | could | `ChatBubble` copy целого `body_text`; `selectable` не используется |
| Ответ на конкретное фото в альбоме | нет | could | `reply_preview` ссылается на сообщение, не на attachment |
| Альбомы (группировка фото) | нет (вложения списком) | could | `ChatBubble` рендерит attachments вертикально, группировки нет |
| Отправка без сжатия | mobile (файлом без сжатия) | should: есть | `AttachmentPickerSheet` file mode; фото `quality` не задаётся явно — RN image picker без ресайза |
| Пересылка без автора | нет | could | `forward_preview` всегда несёт `sender_name` (`useThreadSend`) |
| Выбор нескольких сообщений | mobile + backend | must: есть | selection mode + batch delete/forward (`useThreadSelection`) |
| Реакции: кто поставил | нет (только счётчик + reacted_by_me) | should | `normalizeChatReactions` — count+mine; backend `/reactions` не отдаёт user list |
| «Кто прочитал» в группах | mobile + backend | should: есть | `getMessageReads` → `onReads` (read receipts UI) |
| Глубокие ссылки на сообщение | mobile копирует web-ссылку; навигация по ней — web | could | `useThreadMessageActions.copyMessageLink` → `/chat?conversation=&message=` |

Результат: функциональные пробелы уровня **must** не обнаружены — архив/закреп/поиск/мультивыбор/read receipts уже есть. Кандидаты **should** для будущих F-задач (в порядке пользы): «печатает…» в инбоксе (typing в `ChatConversationSummary`), черновик в строке инбокса, @-упоминания с переходом, «вернуться к исходному», свайп-действия read/pin/delete, реакции «кто поставил», мьют с таймером (нужен `muted_until` + Alembic). Остальное — **could** по запросу пользователя отдельными задачами F-*.


### F-* Реализация
- Каждая подтверждённая функция — отдельная задача `F-<name>` с разделами как у S-задач (проблема, что сделать, backend-изменения, приёмка, тесты).
- Изменения backend — через `WEB-itinvent/backend/api/v1/chat/` → service → store, Alembic для схемы, проверка runtime-схемы `chat` vs `public` (см. `AGENTS.md`).
- F-CALL (звонки), F-SECRET (секретные чаты) — только при D4 = включить.

---

## 10. Шаблон отчёта исполнителя (по каждой задаче)

```
### Отчёт: <ID задачи>
Статус: DONE | PARTIAL | BLOCKED(<Gate/причина>)
Изменённые файлы: <список>
Что сделано: <кратко>
Отклонения от плана и почему: <или «нет»>
Тесты добавлены: <файлы/названия>
Команды и результат:
  npm run lint → <ok/ошибки>
  npx jest <...> → <passed/failed, число>
Замеры до/после (если применимо): <цифры или «не измерено: причина»>
Ручная проверка на устройстве: <сделано пользователем / требуется>
Риски/открытые вопросы: <...>
```

## 11. Чек-лист проверяющего (для каждой задачи)

1. Diff содержит только файлы задачи; нет попутного рефакторинга, лишних комментариев, секретов, новых зависимостей без Gate.
2. Проблема из плана действительно устранена (прочитать код, а не только отчёт).
3. Критерии приёмки выполнены по пунктам.
4. Есть тест, который падал бы без исправления (проверить логику теста, при сомнении — временно откатить фикс локально и убедиться, что тест падает).
5. `npm run lint` и релевантные `jest` реально запущены проверяющим и зелёные.
6. Инварианты доставки не нарушены: идемпотентность `client_message_id`, FIFO активных сообщений, lease/generation, logout-очистка, нет дублей пузырей, нет потери текста.
7. Reduce motion учтён; доступность (labels, live region) не ухудшена.
8. Для backend-изменений: тесты backend, проверка схемы, отсутствие DDL в request path.
9. Вердикт: `ПРИНЯТО` / `ДОРАБОТАТЬ: <конкретные пункты>`.

---

## 12. Журнал выполнения

| ID | Статус | Исполнитель | Проверка | Примечание |
|----|--------|-------------|----------|-----------|
| B1 | DONE | исполнитель | ПРИНЯТО (2026-09-23) | метки в `src/diagnostics/chatSendTiming.ts`, вывод в отчёте и getState; влияния на доставку нет (см. раздел 14) |
| B2 | TODO | | | |
| S1a | DONE | исполнитель | ожидает проверки (perf-часть BLOCKED(B2)) | общий кэш строк outbox в `nativeChatStorageQueue` (legacy+new слои, invalidate `resetNativeChatOutboxRowsCache`); штамп delivery в той же записи put (`decorate`); `update` не пишет при `next===row`; confirm-ветка: persist→одна запись (remove|mark). Цикл send: 3 записи/1 чтение (тест-бюджет, приёмка только после B2). Прямые записи SecureStore в тестах — reset кэша; jest 46/46+19/19 |
| S1b | CLOSED | — | снято решением D2 25.09 | D2=«нет»: остаёмся в SecureStore с оптимизацией S1a (3 записи/1 чтение на сообщение), файловый бэкенд не делаем |
| S2 | DONE | исполнитель | ожидает проверки | `sendMessage`/`sendPickedFiles`: композер очищается сразу (текст/caption+reply+draft-файлы в scope отправки); ошибка `outbox.queue` → тихое восстановление при нетронутом вводе, иначе Alert «Скопировать/Повторить»; черновик удаляется после durable-записи; jest 121/121 |
| S3 | DONE | исполнитель | ожидает проверки | FIFO держат только отправимые-уже-сейчас записи: paused/cancelled/retry-с-future-notBefore/исчерпавшие attempts уступают позицию — в runner (`canAttemptNow`+`row.busy`) и в claim-ядре `deliverQueued`; тест: m2 доставлен при paused m1; jest 42/42 |
| S4 | DONE (cap-вариант) | исполнитель | ожидает проверки; полный безлимит → R-S4 | политика уже реализована: авто-retry только для `transient()` (408/429/5xx/network/offline), лестница 2/5/15/30с, cap=5 → paused; 4xx сразу parked; ручной retry дедупится `jobs`/`preparations` (noWork). Добавлены контракт-тесты: 422→paused без повторов, 503→retry+notBefore, retry в полёте → отказ; jest 8/8 |
| S5 | DONE | исполнитель | ожидает проверки | `nativeChatAttachmentTransfers.ts`: внешний стор Map+`useSyncExternalStore` на attachment.id; upload/download-тики пишут только в стор (строка перерисовывается, список нет); статусы идут через React-state и зеркалятся `syncChatAttachmentTransfers` (progress-only diff не затирает свежий тик); подписчики: ChatDocumentAttachment и AttachmentTransferOverlay; tsc ok, jest 4/4+121/121 |
| S6 | DONE | исполнитель | ожидает проверки | `scheduleNativeChatThreadSnapshotWrite` → `Promise<boolean>` (false при смене поколения/ошибке записи, catch больше не маскирует отказ); `persistConfirmed` хоста: read→schedule→`ownsSession() && persisted` — второй verify-read убран; вызывающие `void`/`await` совместимы; jest 15/15 |
| S7 | DONE | исполнитель | ожидает проверки | `components/nativeToast.tsx`: `showNativeToast(title,detail?)` + `NativeToastHost` (pill снизу, 2.6с, crossfade, reduced-motion); экран треда: 40 чистых уведомлений переведены на тост, 9 Alert с выбором оставлены; `useNativeChatOutboxMessages` «Не удалось изменить ответ» → тост; jest 121/121+19/19, tsc ok |
| S8 | DONE (A+B+C) | исполнитель | ДЕПЛОНУТО 25.09: APK 1.1.53(55) в preview feed, узлы перезапущены; ожидает проверки на устройстве | A: `appActive` убран из `canDeliver` — runner доживает в фоне в пределах ОС-окна, рвётся только при смене сессии/офлайн/gate. B: resumable upload через **существующий** backend-контракт `upload-sessions` (ADR не понадобился — протокол уже был): backend — `client_message_id` проброшен create→manifest→`persist_file_message` (cross-session dedup + очистка materialized-дублей, без повторных side-effects), починен `ChatUploadOrchestrator.get_upload_session` (в проде падал AttributeError→500); mobile — `nativeChatUploadSession.ts` (чанки `File.slice`, resume по `received_chunks`, refresh статуса при ошибке, multipart-fallback на 404/405/5xx), `sessionId` персистится на durable-строке через `helpers.patchUpload`, починен merge delivery-на-confirm (стирал sessionId). C: drain чат-аутбокса встроен в существующий `HUBIT_MOBILE_BACKGROUND_SYNC_TASK` (expo-background-task → WorkManager headless) — новых нативных модулей/манифеста не потребовалось; `nativeChatBackgroundDrain.ts` гоняет тот же runner+transport с дедлайном 120с и выходит, когда доставимого-now не осталось (retry-backoff ждёт следующего wake); UI-lock gate не проверяется (прецедент остальных шагов таска), `isNativeOfflineReadOnly` и session-generation соблюдены; общий transport/persistConfirmed вынесены в `nativeChatDeliveryTransport.ts` — host и фон идут одним путём. Тесты: pytest 12/12 upload-session (+3 новых), jest chat+lifecycle 345/345, jest chat+screens 488/488, tsc чист |
| S9 | DONE | исполнитель | ожидает проверки | Telegram-статусы уже были (S10): часы→✓→✓✓ в слоте рядом со временем, crossfade 140мс, reduced-motion → мгновенно. Добавлены тесты: ✓→✓✓ один раз, timing +1 на смену, без анимации при reduceMotion; jest 15/15 |
| R1 | DONE | исполнитель | выполнено ранее | раздел 8: `NativeChatThreadScreen` ≤1200 строк (1153), хуки useThread* + `ChatThreadOverlays` |
| R2 | DONE | исполнитель | выполнено ранее | раздел 8: `ThreadMessageRow` memo, decoration identity, ref-мешок действий; тест «≤2 строк на входящее» |
| R3 | DONE | исполнитель | выполнено ранее | раздел 8: инбокс ≤600 строк (591), `useInboxData/Folders/Actions`, тосты |
| N1 | DONE (JS-часть) | исполнитель | сборка APK — пользователю | раздел 6: reanimated 4.5.1 / gesture-handler 2.32 / keyboard-controller 1.21.9, провайдеры в `_layout`, jest-моки |
| N2 | BLOCKED(D1→замеры B2) | | | опционально: FlashList только при просадке FlatList на 500+ |
| T1 | DONE | исполнитель | выполнено; устройство | раздел 7: KC KeyboardAvoidingView/KeyboardStickyView, `resize`-режим; баги B-T1-1 закрыты |
| T2 | DONE | исполнитель | выполнено; устройство | раздел 7: `ChatInteractiveBackGesture` (Pan+reanimated, вариант б), фолбэк-навигация |
| T3 | DONE | исполнитель | выполнено; устройство | раздел 7: `SwipeableChatBubble` на GH/reanimated, worklet-пороги (B-T3-1 закрыт) |
| T4 | DONE | исполнитель | выполнено; устройство | раздел 7: приподнятый пузырь + меню `placeMessageActionMenu`, haptic |
| T5 | DONE | исполнитель | выполнено; устройство | раздел 7: `ChatBottomSheet` drag-to-dismiss на всех нижних шторках (B-T5-1 учтён) |
| T6 | DONE | исполнитель | выполнено; устройство | раздел 7: `slide_from_right` 280 мс, timing-навбар, мгновенный снимок истории |
| T7 | DONE | исполнитель | выполнено; устройство | раздел 7: jump-кнопка spring, mic↔send morph, TypingDots, enter-motion только realtime |
| U1 | DONE | исполнитель | выполнено | раздел 8: все Unicode-глифы → MaterialCommunityIcons |
| U2 | DONE | исполнитель | выполнено | раздел 8: хвостик, групповые радиусы, inline-мета |
| U3 | DONE | исполнитель | выполнено | раздел 8: `chat-pattern.png` тайл, 0.05/0.10 |
| U4 | DONE | исполнитель | выполнено | раздел 8: `ChatListSkeleton` инбокс+тред, reduce-motion |
| U5 | DONE | исполнитель | выполнено | раздел 8: контраст light-темы до WCAG |
| U6 | DONE | исполнитель | выполнено | раздел 8: a11y-аудит, accessibilityLabel/roles/live-regions |
| FA | DONE | исполнитель | выполнено | раздел 9: аудит; must-пробелов нет; should-кандидаты зафиксированы |
| S10 | DONE | исполнитель | ожидает проверки | pending = `clock-outline` в мете вместо красных строк; ошибка = `alert-circle` снаружи пузыря → меню; «Повторить»/«Удалить»/«Убрать из очереди» перенесены в `MessageActionsSheet`; jest 72 набора/421 + экранные 121, tsc чисто. Доходит до пользователей с новой сборкой APK |
| S11 | PARTIAL | исполнитель | BLOCKED(замер на устройстве) — шаг 1 ожидает проверки | замер: счётчик in-flight axios (`apiInflight` в отчёте v5: current/maxObserved/started/completed + `atChatSendHttpStart` p50/p95) без URL/PII; сэмпл в момент `http_start` отправки. Шаг 2 (пауза поллеров и т. п.) — только после подтверждения замером на устройстве |
| S12 | DONE | исполнитель | ожидает проверки | `progress <= 0` → неопределённое состояние: «Отправка…»/«Загрузка…» без «0%», спиннер в бейдже/оверлее (`chat-transfer-indeterminate`); стартовый `progress: null` вместо `0` в `useNativeChatOutboxMessages`; a11y: determinate value только при реальном прогрессе. Кольцевой прогресс вокруг отмены — остаётся в U1/T7 |
| S13 | DONE | исполнитель | ожидает проверки | шапка: подзаголовок всегда presence (никогда «На связи»; неизвестен → пусто); статус соединения вместо заголовка с задержкой 1с: «Ожидание сети…»/«Соединение…»/«Обновление…»; учтены chat-сокет (`socketStatus`) и зависшая отправка >5с (`countStalledChatSends` из меток B1, поллинг 1с в `HubConnectionProvider`) |
| U7 | DONE | исполнитель | выполнено | раздел 14.3: `metaMode='inline'` — мета в конце последней строки без лишнего ряда |
| U8 | DONE | исполнитель | выполнено | раздел 14.3: единое имя автора цитаты (сервер `_display_user_name`) |
| W1 | DONE | исполнитель | ПРИНЯТО (2026-09-23) | pong → `_send_control_to_connection` (chat/hub/task_canvas); pytest 55/55. Для эффекта нужен restart `itinvent-chat` (IIS шлёт весь `/api/v1/chat/*` в ферму чата); `itinvent-backend` — только если нужен единый код, на WS в проде не влияет |
| W2 | DONE | исполнитель | ПРИНЯТО (2026-09-23) | уникальный `request_id` в ping (mobile hub+chat, web hub); mobile hub: живость по любому кадру. Доходит до пользователей только с новой сборкой APK / web |
| W3 | DONE | исполнитель | ПРИНЯТО с доработкой → W6 | 1008 → reconnect (mobile hub + web hub); 4401 → forceRefresh (mobile hub + chat). Не покрыто: web `chatSocket.js` и `taskCanvasSocket.js` по-прежнему считают 1008 окончательным |
| W4 | DONE | проверяющий (по запросу пользователя) | 2026-09-23 | ферма IIS уже была настроена на 8002+8004; запущены `itinvent-chat-a`/`-b`, `pm2 save` (раздел 16) |
| W5 | DONE | исполнитель | ПРИНЯТО с замечаниями → W7 | `chat_ws_closed` (code/reason/session_sec) на всех 3 WS; метрики подтверждены в `chat_main.py` `/health/pools` → `realtime_sender` |
| W6 | DONE | исполнитель | ожидает проверки | сервер: slow-consumer → `1013` (`_SLOW_CONSUMER_CLOSE_CODE`), rate-limit остаётся `1008`; web: reconnect после 1013 (chatSocket + taskCanvasSocket); pytest 3/3, vitest 31/31 |
| W7 | DONE | исполнитель | ожидает проверки | `socket_kind` (`chat`/`hub`/`task_canvas`) → `socket=` в `chat_ws_closed`; `ws.py`: код/причина watchdog приоритетнее peer-кода; +исправлен старый падавший assert; pytest 6/6 + 43/43 |
| I1 | DONE | исполнитель | ожидает проверки | `chat-runtime-mode.ps1` (auto: `CHAT_REALTIME_TRANSPORT=postgres` + scale-конфиг); `ecosystem.all.config.js` сам подменяет `itinvent-chat` → `-a`/`-b` без дублей воркеров; `start/restart/stop-all` — `-ChatMode`/`-WhatIf`, список процессов по режиму; `restart-chat.ps1` в dual отказывает с подсказкой. Проверено: `-WhatIf` печатает dual-план, node возвращает корректный список в обоих режимах |
| I2 | DONE | исполнитель | проверено вживую | `health-check.ps1`: режим через `chat-runtime-mode.ps1` (`-ChatMode`), health+ready обоих узлов, строка `chat-nodes` красная при <2 живых; PM2-статусы `-a`/`-b` |
| I3 | DONE | исполнитель | ожидает проверки | README: production=dual (restart только `restart-chat-scale.ps1`, режим/`-ChatMode`/`-WhatIf`); IIS_DEPLOYMENT_WEB: секция фермы `itinvent-chat` (адреса, `localhost:8004` — уникальность адреса ARR, health URL, рекомендация `/health/live`) |
| I4 | DONE | исполнитель | проверено вживую | `chat-farm` в health-check: серверы фермы из `applicationHost.config` (`webFarms` — ребёнок `<configuration>`, порт в `applicationRequestRouting/@httpPort`), каждый обязан слушать; `localhost:8004` зафиксирован как легитимный адрес узла |
| W8 | DONE | исполнитель | ПРИНЯТО с замечаниями → R-W8 (раздел 20), ДЕПЛОНУТО 25.09 (рестарт S8) — `POST /chat/ws-ticket` → 401 (route жив, auth) | реализовано по спеке 16.4 (б+): `WsSessionLease` (`chat/ws_auth.py`), `send_control` в realtime, `chat.auth`/`hub.realtime.auth`/`task_canvas.auth` + `.auth.required`/`.ok`/`.rejected`, `POST /chat/ws-ticket`, grace 120 с, метрики `ws_auth_*`; mobile push access_token через `subscribeAccessTokenChanges` (chat+hub), web `chatWsAuth.getWsTicket` (3 сокета). Проверено: pytest 15/15 (lease+poll), jest 25/25, vitest 29/29, tsc чисто. Ждёт rolling-рестарт + метрик `chat_ws_closed`/`ws_auth_*` |
| I5 | DONE | исполнитель | ожидает проверки | `restart-chat-scale.ps1`: перед остановкой узла — `enabled=false` серверу фермы (`httpPort`-матч), пауза `DrainWaitSec=8`, stop/start/ready, re-enable в `finally`; `-WhatIf` печатает план (проверено: бюджет+describe read-only, мутаций нет) |
| I6 | DONE | исполнитель | ПРИНЯТО (применено 25.09) | `applicationHost.config` webFarm `itinvent-chat` healthCheck: url → `http://itinvent-chat/health/live`, timeout 3→5с (backup `applicationHost.config.bak-20260925-201839`); post-check: ARR `/api/v1/chat/*` → 401 alive, оба узла `/health/live` 200. `/health/ready` остаётся для PM2/скриптов |
| P1 | DONE | исполнитель | выполнено | раздел 17: DNS-пул 1.5с для link-preview, per-user TTL-кеш ai/bots, кеш conversations; EXPLAIN на реальной БД — бэклог |
| Q1 | DONE | исполнитель | выполнено | раздел 17: регресс покрыт сьютами (mobile 614+, web vitest, backend pytest) |
| W10 | DONE | исполнитель | ожидает проверки | причина: resurrect поднимает ~16 python-процессов разом → конкуренция DB/CPU откладывает готовность узлов. `pm2-boot-resurrect.ps1`: в dual тяжёлые воркеры (scan/inventory/mail/my-files/ai/bot) останавливаются до готовности обоих чат-узлов (`ChatReadyTimeoutSec=240`, `-NoChatStaging` для отказа). Клиенты: `chatSocket.ts` получил jitter±25%+spread 5с (был голый backoff → шторм); jest 16/16 |
| W11 | DONE | исполнитель | ДЕПЛОНУТО 25.09 (рестарт S8): метрика жива на обоих узлах | `durable_duplicates_by_type` (top-10, cap 64 типа + `__other__`) в `realtime_sender` метриках; тест расширен |
| O1 | DONE | — | снят 24.09 | backend перезапущен в 14:36, порт 8001 у процесса PM2, цикл остановлен (раздел 19.2) |
| W12 | DONE | исполнитель | ПРИНЯТО (код), BLOCKED(проверка на устройстве) | `AppLifecycle`: `inactive` игнорируется; `background` → suspend через 45 с, отменяется на `active`. jest 2/2 |
| I7 | DONE | исполнитель | ПРИНЯТО (код), ДЕПЛОНУТО 25.09 (рестарт S8) — `event_loop_lag_ms_*` живут в `/health/pools` | `EventLoopLagMonitor` в `realtime.py`: probe sleep 1 с, `event_loop_lag_ms_latest/p95/max` в `get_metrics`, warn-лог при lag ≥ 1 с (throttle 30 с). Узлы всё ещё на старом коде — метрика появится после `restart-chat-scale.ps1` |
| RV1 | DONE | исполнитель | ПРИНЯТО (код), проверка на устройстве | все 6 пунктов 19.3 подтверждены в коде; к B-T5-1 требование: у `Modal` шторок с `KeyboardStickyView` добавить `navigationBarTranslucent` и нижний inset у шторки (иначе на Android sticky не ездит за клавиатурой внутри Modal) — проверить эмодзи-панель/шторки с вводом |
| T8 | DONE | исполнитель | ПРИНЯТО с замечаниями → R-T8 (раздел 20), проверка на устройстве | `ChatAttachmentPanel` (inline над композером, Keyboard.dismiss): сетка 3 кол + плитка камеры, пагинация по 90, video-бейдж с длительностью, multiselect с номерами, caption + «Отправить (N)» → `sendPickedFiles`, выбор альбома в развёрнутом режиме, ряд Галерея/Файл/Геопозиция/Контакт/Опрос/Задача/Стикер; `expo-media-library ~57.0.5` (Query/exeForMetadata/Album.getAll — API сверено с typings). Не закрыто из спеки F-MEDIA: preview-лист с remove/reorder, fullscreen-превью (R-T8-2) |
| F-GEO | DONE | исполнитель | ПРИНЯТО с остатком → R-GEO-1 | kind='location': `_normalize_location_body` (JSON {lat,lng[,title,address]}), REST `SendMessageRequest.kind`, WS `chat.send_message` kind; mobile: `expo-location`, карточка + `buildGeoIntentUrl` (geo-intent), permission-флоу с «Открыть настройки». Остаток: выбор точки на карте (только текущая) |
| F-CONTACT | DONE | исполнитель | ПРИНЯТО с остатком → R-CONTACT-1 | kind='contact': `_normalize_contact_body` (JSON {name[,phone,organization]}); mobile: `expo-contacts` new API (`Contact.presentPicker`/`getPhones`/`getFullName` — сверено с typings), карточка + `tel:`-intent. Остаток: «Написать»/«Сохранить в контакты» |
| F-JUMPBACK | DONE | исполнитель | ПРИНЯТО с замечанием → R-JUMP-1 (раздел 20.4) | «Назад к сообщению» после jump по ответу/поиску: `onViewableItemsChanged` трекает верхний видимый id (inverted → max index — верно), `focusMessageById` запоминает якорь при уходе из окна, чип → `returnToAnchor` (skip-флаг против повторной записи), очистка на `jumpToBottom`. Замечание: инлайн `viewabilityConfig` |
| F-INBOX-SWIPE | DONE | исполнитель | ПРИНЯТО с замечанием → R-SWIPE-1 (раздел 20.4) | две зоны свайпа строки инбокса: короткий ≥72dp → mute/archive, глубокий ≥150dp → read (`markConversationRead`, оптимистичный unread=0 + rollback-тост) / pin (`updateConversationSettings {is_pinned}` — API существует); подпись зоны меняется по ходу свайпа; jest +4. Замечание: «Непрочитано» при unread=0 — no-op с обещанием |
| F-TYPING-INBOX | DONE | исполнитель | ПРИНЯТО | фикс проверен: `chat.typing` → `publish_user_events` (distribution="user") — доходит до инбокс- и тред-сокетов; фильтр по `conversation_id` есть на всех клиентах (mobile `useThreadRealtime:144`, web `useChatSocketEvents.js:457`) — утечки в чужой тред нет; TTL из `expires_in_ms` (+1с); регрессионный тест fan-out 3/3 |
| F-MUTE-TIMER | DONE | исполнитель | ПРИНЯТО; миграция 0122 применена (public.muted_until) | `muted_until` timetz (миграция `20260924_0122` — chat/public-инвариант соблюдён); `PATCH settings.muted_until` (будущее → мьют; is_muted=false → снять; is_muted=true без даты → бессрочно); `conversation_state_is_muted` — ленивая expiry в сериализации, `notification_planner`, `push_outbox`; `get_muted_conversation_ids` фильтрует по сроку; summary отдаёт `muted_until`; mobile: шит «1ч/8ч/неделя/навсегда» + метка срока. Проверено: pytest 14+2 pre-existing падения `sender_name` (в diff теста/сериализации sender_name не трогали — подтверждено pre-existing), jest 39/39, tsc чисто |
| F-REACTORS | DONE | исполнитель | ПРИНЯТО | «кто поставил реакцию»: `user_ids` уже в payload реакций; long-press на чипе (`ChatReactionButton.onLongPress`, 350мс) → `Alert` с именами из `chatUsers`/`conversation.members` (свой — «Вы»); проверено: `showReactionUsers` (NativeChatThreadScreen:853-860) резолвит id→имя через `reactorNameById` (chatUsers + members + «Вы»), фолбэк «Участник N»; проводка useThreadRender → onReactionLongPress корректна |
| F-MENTION-JUMP | DONE | исполнитель | ожидает проверки — блокер снят 26.09: tsc чист (чужой mail WIP почищен), chatMentions 6/6, сьют 302/302 | backend `mentioned_user_ids` эмитится (service.py:2586/2611), mobile-тип + нормализация есть, кнопка над jump-to-bottom есть. DEV-MENTION-1: поиск вынесен в `src/chat/chatMentions.ts::findUnreadMentionMessageId` — обход newest-first `0 → length-1`, break на `seq <= lastRead`, возврат последнего совпадения (= старейшее непрочитанное). Тест `chatMentions.test.ts` падал на старом обходе (break на 1-й итерации → null), сейчас 6/6; экранный сьют 121/121. Известное несвязанное падение `tsc`: `NativeMailSwipeRow.tsx` (чужая правка mail-свайпов в грязном дереве) |
| F-DRAFT-INBOX | DONE | исполнитель | ПРИНЯТО | «Черновик: …» в строке инбокса: `listNativeChatDraftPreviews(userId)` (SecureStore → Map, свёрнутый текст/«Вложения»), обновление на `useFocusEffect` и смене пользователя; префикс — dangerText, typing приоритетнее; jest 30/30 |
| F-POLL | DONE | исполнитель | ПРИНЯТО с остатком → R-POLL (раздел 20) | kind='poll': таблица `chat_poll_votes` (миграция 20260924_0121, chat/public-инвариант соблюдён), `vote_poll` (voted/changed/retracted, unique per user), `POST /messages/{id}/poll-vote` + WS `chat.poll_vote`, fan-out `chat.message.updated` per-member (`get_messages_for_users` → свой `my_option_index`); mobile: `ChatPollCreateSheet`, пузырь с %-барами + оптимистичный голос, `voteMessagePoll`; pytest 4/4. Остаток: anonymous-toggle и multi-choice, close/edit прав |
| D5 | РЕШЕНО | проверяющий (делегировано пользователем) | — | вариант б+ (in-socket re-auth): полная спека в W8/16.4 — `WsSessionLease`, `chat.auth`/`hub.realtime.auth`/`task_canvas.auth` (access_token у mobile, ws_ticket у web), `POST /chat/ws-ticket`, grace `CHAT_WS_AUTH_GRACE_SEC`=120 с, метрики `ws_auth_*`. Реализация — за исполнителем |

### Baseline (заполняется в B2)

| Метрика | До | После | Цель |
|---------|----|-------|------|
| tap → пузырь, мс | | | ≤ 16 (тот же кадр) |
| tap → HTTP start, мс (пустая очередь) | | | ≤ 50 |
| tap → HTTP start, мс (10+ в очереди) | | | ≤ 80 |
| операция хранилища очереди p95, мс | | | ≤ 20 |
| FPS прокрутки 500+ сообщений | | | ~60 |
| скачки при открытии клавиатуры | | | 0 |

---

## 13. Рекомендуемый порядок

0. I1 → W6 → W7 → I2 → I3 → I4 (инфраструктура и остаток WebSocket — разделы 15–16). Полная дорожная карта — раздел 17.
1. B1 → S10 → S11 → S12 → S2 → S3 → S4 → S9 → S13 → S1a → S5 → S6 → S7 (быстрые заметные улучшения отправки).
2. B2 (замеры пользователем) → решения D1–D3.
3. R1 → R2 → R3.
4. N1 (если D1) → T1 → T2 → T3 → T4 → T5 → T6 → T7.
5. U1–U6.
6. S1b (если D2), S8 (если D3).
7. FA → F-*.

---

## 14. Проверка 2026-09-23: B1 и полевой инцидент «сообщения стоят в очереди»

### 14.1 Факты (read-only: PM2-логи `itinvent-chat`, IIS `W3SVC2/u_ex260923.log`, код)

- B1 не влияет на доставку: только `Date.now()` и in-memory `Map`, без I/O и ветвлений; `npx jest src/chat src/diagnostics` — 47 наборов / 321 тест зелёные.
- Сервер обрабатывал все отправки пользователя быстро: `chat.service.send_message took_ms` 8–40 мс; фото 225 КБ принято и сохранено за ~150 мс (`chat.files_upload_success`).
- Сообщение «Тестим сообщения…» (12:14) создано на сервере в 12:14:52, повтор с тем же `client_message_id` в 12:16:00 вернул тот же `message_id` — идемпотентность работает, дубля нет.
- Время на стороне IIS (`time-taken`, включает приём тела и отдачу ответа клиенту) для телефона (okhttp, внешний IP) в 12:14–12:23:
  - `POST .../messages` — 32 607, 19 844, 7 296 мс; `POST .../messages/files` (фото 225 КБ) — 41 904 мс;
  - `GET .../messages` — до 67 754 мс, `GET /chat/conversations` — до 67 858 мс, файл вложения — 60 007 мс;
  - WebSocket `/chat/ws` и `/hub-realtime/ws` многократно рвутся (`sc-win32-status=64`), часть запросов — `995` (клиент оборвал соединение).
- Вывод: в этот период сеть телефон ↔ сервер почти стояла (backend отвечал за миллисекунды, байты шли десятки секунд). Входящие «приходили нормально» скорее всего через push-уведомления, а не через обрывающийся WS.
- Параллельно с отправкой телефон держал много фоновых запросов: `mail/*` (folders/tree, messages, mailboxes, preferences), `unread-counts` × 3 эндпоинта, `chat/conversations`, `settings/*`, загрузка превью вложений. Гипотеза (проверить): OkHttp 4 по умолчанию выполняет не более 5 одновременных запросов на хост (`Dispatcher.maxRequestsPerHost = 5`); при медленной сети отправка сообщения ждёт в очереди клиента за фоновыми GET.

### 14.2 Новые проблемы

| # | Проблема | Где | Приоритет |
|---|----------|-----|-----------|
| P18 | Нормальное «идёт отправка» показывается как ошибка: через 1,5 с в пузыре появляются две красные строки «Ожидает отправки» и «Убрать из очереди» (`dangerText`), пузырь раздувается; онлайн это вводит в заблуждение | `src/components/chat/ChatBubble.tsx:147-157,519-543` | Критично (UX) |
| P19 | Статус «отправляется» — крошечный `ActivityIndicator` scale 0.65 рядом со временем, почти не виден | `src/components/chat/ChatDeliveryStatus.tsx` | Высокий |
| P20 | Отправка сообщения конкурирует с фоновыми запросами (почта, счётчики, списки, превью) за соединения/лимит клиента; нет приоритета у отправки | `src/api/client.ts`, фоновые поллеры инбокса/почты/уведомлений | Высокий (гипотеза, подтвердить B1-метриками `tap_to_http_start`) |
| P21 | Фото при медленной сети показывает «Отправка 0%» десятки секунд без признаков жизни; нет неопределённого состояния, пока прогресс не пошёл | `src/components/chat/ChatDocumentAttachment.tsx:54`, `AttachmentTransferOverlay` в `ChatBubble.tsx` | Средний |
| P22 | В шапке диалога на месте статуса собеседника показывается состояние подключения приложения «На связи» (зелёная точка) — выглядит как «собеседник в сети»; при реальных обрывах сети в шапке нет «Соединение…» / «Обновление…» | `src/components/chat/ChatHeader.tsx:47`, `src/components/layout/HubConnectionHeader.tsx:28-56,119-121` | Высокий |
| P23 | Имя автора в цитате ответа непоследовательно: «Николаев» в одном ответе и «Николаев Михаил Сергеевич» в другом | `reply_preview.sender_name` (клиент `NativeChatThreadScreen.tsx:1297-1303` vs сервер) | Низкий |

### 14.3 Задачи

#### S10. Статус ожидания как в Telegram (P18, P19)
- Убрать текстовые строки «Ожидает отправки» / «Ожидает подключения» из пузыря для состояния «отправляется/в очереди».
- Состояние «отправляется/в очереди» — только иконка `clock-outline` на месте галочек (цвет меты пузыря, размер как у галочек). Офлайн — та же иконка; факт офлайна сообщается один раз в шапке (см. S13), а не в каждом пузыре.
- «Убрать из очереди» и «Повторить» не показывать внутри пузыря постоянно. Для ошибки (`failed`/`paused`/`cancelled`) — красный круг `alert-circle` рядом с пузырём (снаружи, как в Telegram), тап по нему или long-press → меню «Повторить» / «Удалить». Для ожидающего сообщения «Убрать из очереди» — только в меню long-press.
- Цвет `dangerText` использовать только для реальной ошибки.
- Сохранить `accessibilityLabel` («Сообщение отправляется», «Не отправлено, нажмите, чтобы повторить») и возможность удалить из очереди через меню.
- Связь с планом: закрывает часть S9 (иконки статусов) и S7 (ошибки без модалок) для доставки.
- Приёмка: pending-пузырь по размеру такой же, как отправленный; красного нет, пока нет ошибки; ошибка видна как «!» снаружи пузыря; через меню можно повторить и удалить.
- Тесты: обновить `ChatBubble.test.tsx` (нет текстов «Ожидает отправки»/«Убрать из очереди» в pending; есть кнопка «!» в failed; действия в меню), `ChatAccessibility.test.tsx`.

#### S11. Приоритет отправки над фоном при медленной сети (P20)
- Шаг 1 — подтвердить: по B1-меткам (`tap_to_http_start`, `http_start → http_ack`) на устройстве в плохой сети и по числу одновременно активных запросов (добавить в диагностику счётчик in-flight запросов axios без URL и параметров).
- Шаг 2 — если подтверждено:
  1. Пока открыт экран диалога и есть неотправленные сообщения, ставить на паузу/откладывать необязательные поллеры (почта, `unread-counts`, превью ссылок), возобновлять после ACK.
  2. Объединить три запроса счётчиков (`chat/unread-summary`, `mail/unread-count`, `hub/notifications/unread-counts`) в один, если backend это позволяет, — отдельная задача с согласованием контракта; до этого — не опрашивать чаще, чем раз в N секунд, и не опрашивать, пока WS подключён и шлёт события.
  3. Отменять (`AbortController`) устаревшие GET при уходе с экрана (список чатов/почты), чтобы они не занимали соединения.
  4. Рассмотреть увеличение `maxRequestsPerHost` в нативном OkHttp-клиенте (кастомный `OkHttpClientFactory` через config plugin) — только после замера и отдельно согласовать (нативное изменение).
- Приёмка: в сценарии «медленная сеть + открытый чат» `tap_to_http_start` p95 ≤ 300 мс (запрос уходит сразу, а не ждёт фон).
- Тесты: unit на паузу поллеров при наличии pending в outbox; диагностика in-flight не содержит URL/PII.

#### S12. Прогресс загрузки фото без «вечных 0%» (P21)
- Пока не пришёл первый `onProgress` (или `loaded == 0`) — неопределённый индикатор (вращающееся кольцо) и подпись «Отправка…», без «0%».
- Проверить, что `onUploadProgress` вообще вызывается на Android (RN networking + FormData); если нет — задокументировать и не показывать проценты.
- Кольцевой прогресс вокруг кнопки отмены (как в Telegram) вместо текста с процентами — вместе с U1/T7.
- Приёмка: при зависшей сети видно «идёт отправка», а не «0%»; при нормальной — прогресс растёт.

#### S13. Честный индикатор соединения в шапке (P22)
- Подзаголовок шапки — всегда статус собеседника/группы (presence: «в сети», «был(а) недавно», «N участников», «печатает…»). Если presence неизвестен — пусто или «был(а) недавно», но не «На связи».
- Состояние подключения приложения показывать вместо заголовка (как Telegram «Соединение…», «Обновление…», «Ожидание сети…»), только когда соединения нет или идёт восстановление, с задержкой ~1 с от начала деградации, чтобы не мигать.
- Учитывать не только статус WS, но и зависшие HTTP-запросы: если отправка висит дольше ~5 с — показывать «Соединение…».
- Приёмка: при нормальной сети в шапке имя + presence; при обрыве — «Соединение…», после восстановления — снова имя.
- Тесты: `HubConnectionHeader.test.tsx`, `ChatHeader` — presence не подменяется статусом приложения.

#### U7. Время и статус внутри пузыря (по скриншотам) — ✅ выполнено
- `metaMode === 'inline'`: спейсер `metaSpacer` внутри текста + `metaFloat` поверх — мета сидит в конце последней строки, лишнего ряда нет; `row`-режим — только при trailing-блоках (link preview/AI-карта). Реализовано в рамках `chatBubbleLayout.ts`.

#### U8. Единое имя автора в цитате (P23) — ✅ выполнено
- Найдено расхождение: сервер `service.py::_message_reference_preview_payload` строил `sender_name` через `_get_short_user_name` (первое слово ФИО), клиент (`useThreadSend`) — полное `full_name || username`. Теперь сервер использует `_display_user_name` (полное имя) — одно правило с клиентом; обрезка по ширине — `numberOfLines={1}` на `quoteSender` в `ChatBubble`.

### 14.4 Что нужно от пользователя для S11
- После установки сборки с B1: воспроизвести плохую сеть (или дождаться её), отправить 3–5 сообщений и фото, затем поделиться диагностическим отчётом (поле `chatSendTiming`).

---

## 15. Нестабильность WebSocket (диагностика 2026-09-23)

### 15.1 Главная причина (подтверждена воспроизведением)

Сервер отправляет ответ на ping (`chat.pong`, `hub.realtime.pong`) через общую очередь `send_to_connection`, где с 2026-08-11 (коммит `8941ab45`) действует дедупликация «durable»-событий: ключ = `type + conversation_id + request_id + payload`, время `sent_at` не учитывается (`WEB-itinvent/backend/chat/realtime.py:1636-1642,1684-1699`). Pong не входит в список volatile (`realtime.py:1519-1542`), поэтому считается durable.

Мобильный клиент шлёт ping **без `request_id`**:
- `mobile-hub/src/realtime/hubRealtimeSocket.ts:175` — `{ type: 'hub.realtime.ping', payload: {} }`;
- `mobile-hub/src/chat/chatSocket.ts:90` — `{ type: 'chat.ping' }`.

Итог: на соединение доходит **только первый pong**, все следующие подавляются как дубли. Воспроизведение на локальном `ChatRealtimeManager` (без БД): 4 pong без `request_id` → в очередь попал 1, подавлено 3; с уникальным `request_id` → 4 из 4.

Последствия:
- **Hub-realtime (мобильный):** heartbeat каждые 25 с, закрытие после 3 пропущенных pong → сокет сам закрывается через ~125 с (первый pong пришёл, дальше тишина) и переподключается. В IIS у мобильных клиентов с разных IP и сетей повторяется длительность 123–131 с. Пока идёт переподключение, шапка показывает «Связь нестабильна», события почты/задач в этот промежуток теряются.
- **Чат-сокет (мобильный):** живость = «любой кадр от сервера за 60 с» (`chatSocket.ts:18-19,86-88`). В тихом диалоге (нет сообщений/typing/presence) pong не приходит → через 75–100 с `abandonSocket` → статус `error` → HTTP-поллинг раз в 15 с (`NativeChatThreadScreen.tsx:1097-1104`) → переподключение.
- **Web:** `chatSocket.js` шлёт ping через `sendCommand` с уникальным `request_id` — не затронут. `frontend/src/lib/hubRealtimeSocket.js:331` шлёт hub ping без `request_id` — по коду затронут так же; по логам IIS картина неоднозначна (проверить отдельно).

### 15.2 Сопутствующие причины

| # | Причина | Доказательство | Эффект |
|---|---------|----------------|--------|
| W-a | ARR-ферма `itinvent-chat` содержит два сервера: `127.0.0.1:8002` (жив) и `localhost:8004` — порт не слушается, процесса нет (в PM2 один `itinvent-chat`) | `applicationHost.config` webFarm, `Get-NetTCPConnection` | Лишние health-probe; при любом сбое `/health/ready` единственного живого узла (таймаут 3 с) — `502.4 No server available` для новых запросов и WS-рукопожатий (сегодня в 10:31 и 10:57) |
| W-b | Реальные сетевые провалы мобильного канала | IIS `sc-win32-status=64/995`, `time-taken` 30–68 с (раздел 14) | Обрывы WS и зависание HTTP |
| W-c | 401 на рукопожатии WS после рестарта backend (сессия не валидируется) | `chat_ws_handshake_denied ... 4401` × 12 в 10:54 | Кратковременные отказы после деплоя |
| W-d | Мобильный hub-клиент считает `1008` неповторяемым (`NON_RECONNECTABLE_CLOSE_CODES`), а сервер закрывает `1008` при «slow consumer»/rate-limit | `hubRealtimeSocket.ts:22`, `realtime.py:966-971` | После одного такого закрытия hub-сокет не переподключается до возврата приложения из фона |
| W-e | Сокеты намеренно закрываются при уходе приложения в фон (suspend) | `NativeChatDeliveryHost`/AppState | Короткие сессии при переключении приложений — ожидаемо, не баг |

### 15.3 Задачи

#### W1. Pong не должен дедуплицироваться (backend) — критично
- Отправлять `chat.pong` и `hub.realtime.pong` через `_send_control_to_connection` (минуя outbound-очередь и дедупликацию, как `chat.command.ok`), либо явно исключить их из durable-дедупликации.
- Не менять семантику дедупликации для настоящих событий (`chat.message.*` и т. п.).
- Тесты: `tests/test_chat_realtime_*.py` — N последовательных ping без `request_id` → N pong; существующий тест дедупликации `chat.message.created` остаётся зелёным.
- Приёмка: мобильный hub-сокет живёт дольше 10 минут без переподключения в стабильной сети (IIS: исчезает кластер 123–131 с).
- Deployment/restart `itinvent-chat` — только с явного разрешения пользователя.

#### W2. Клиентская защита (mobile, при необходимости web)
- Добавлять уникальный `request_id` в ping (`hubRealtimeSocket.ts`, `chatSocket.ts`; web `hubRealtimeSocket.js`).
- Hub-клиент: считать живостью любой входящий кадр, а не только pong.
- Тесты: jest — ping содержит уникальный `request_id`; входящее событие сбрасывает счётчик пропусков.

#### W3. Коды закрытия
- Mobile hub: `1008` от «slow consumer» — переподключаться с backoff (различать по `reason` или ввести отдельный код на сервере, например `4429`/`4408`); оставить неповторяемыми только auth/forbidden.
- Mobile chat: на `4401` — обновить токен и переподключиться (сейчас переподключается всегда, проверить отсутствие шторма).

#### W4. ARR-ферма (эксплуатация, только с разрешения)
- Либо удалить `localhost:8004` из фермы `itinvent-chat`, либо запустить второй узел чата. Проверить, почему `/health/ready` иногда не укладывается в 3 с.
- Порядок: read-only проверка → команда → ожидаемый эффект → rollback (вернуть сервер в ферму) → post-check (нет `502.4`, health зелёный).

#### W5. Наблюдаемость
- Логировать на сервере закрытие WS с кодом, причиной и длительностью сессии (без токенов); метрики `durable_duplicates_suppressed` и `slow_consumer_disconnects` вывести в существующую диагностику.

Порядок: W1 → W2 → W3 → W5; W4 — отдельным согласованием.

### 15.4 Итоги проверки W1–W5 (2026-09-23) и доработки

Проверено: diff всех затронутых файлов; `pytest tests/test_chat_realtime_postgres.py tests/test_hub_realtime.py tests/test_task_canvas_realtime.py` — 55 passed (fixtures подменяют БД на sqlite); mobile `jest src/realtime src/chat/chatSocket.test.ts src/components/layout` — 31 passed, `npm run lint` — ok; web `vitest hubRealtimeSocket/chatSocket` — 31 passed. Новые тесты W1 проверяют прямую отправку (`websocket.sent`) и пустую очередь — на старом коде они бы падали (pong лёг бы в очередь и был бы подавлен).

Для пользователей:
- Серверная правка W1 чинит обрывы и для **уже установленных** APK — после restart `itinvent-chat`.
- W2/W3 — только с новой сборкой mobile (1.1.48) и пересборкой web.

#### W6. Коды закрытия: остальные клиенты и сервер — ✅ выполнено
- Сервер: `realtime.py::_SLOW_CONSUMER_CLOSE_CODE = 1013` для slow-consumer; `1008` остался только для rate-limit/нарушений политики (`ws.py`, `hub_realtime_ws.py`, `task_canvas_ws.py`).
- Web: `hubRealtimeSocket.js` убрал `1008` из `NON_RECONNECTABLE_CLOSE_CODES`; `chatSocket.js`/`taskCanvasSocket.js` держат `1008` для rate-limit (намеренно non-reconnectable), а `1013` переподключается с backoff.
- Тесты: `chatSocket.test.js` (reconnect после 1013), `taskCanvasSocket.test.js` (1013), `hubRealtimeSocket.test.js` (1008→reconnect) — 27/27 + suites green.

#### W7. Наблюдаемость закрытий — ✅ выполнено
- `chat_ws_closed` включает `socket=%s` из `connection.socket_kind` (`chat`/`hub`/`task_canvas`; регистрация `socket_kind=` при connect в `hub_realtime_ws.py`/`task_canvas_ws.py`).
- `ws.py` finally: `watchdog_close` приоритетнее `WebSocketDisconnect.code` — причина watchdog (4401/1011) попадает в лог вместо «peer closed».

---

## 16. Инфраструктура чата: два узла (выполнено 2026-09-23 по запросу пользователя)

### 16.1 Что было
- IIS: правило `Chat API Reverse Proxy` → ферма ARR `itinvent-chat` (`127.0.0.1:8002` + `localhost:8004`, WRR, health `/health/ready` 5 с / таймаут 3 с, без affinity, proxy timeout 1 ч) — настроено правильно.
- `.env`: `CHAT_REALTIME_TRANSPORT=postgres`, `CHAT_REALTIME_REQUIRED=1`, `CHAT_REDIS_REQUIRED=0` — dual-режим был включён ранее.
- PM2: работал только одиночный `itinvent-chat` (8002, конфиг одиночного узла из `ecosystem.backend.config.js`), порт 8004 никто не слушал → ферма с «мёртвым» узлом, `502.4` при сбое health единственного живого узла.
- Вероятная причина потери второго узла: `start-all.ps1` / `restart-all.ps1` / `stop-all.ps1` запускают `ecosystem.all.config.js` = только `ecosystem.backend.config.js` → поднимают одиночный `itinvent-chat`, а `itinvent-chat-a/-b` не знают.

### 16.2 Что сделано (rolling, без простоя)
1. Read-only проверки: бюджет PostgreSQL (`used=83/300`, прогноз dual `projected_ok=True`), `py_compile` 57 изменённых backend-файлов, импорт `backend.chat_main` из текущего дерева.
2. `pm2 start scripts\pm2\ecosystem.chat.scale.config.js --only itinvent-chat-b` → готов на 8004 (`realtime_transport=postgres`, `node=chat-b`), IIS начал слать на него трафик.
3. `pm2 delete itinvent-chat` → трафик обслуживал chat-b; `pm2 start ... --only itinvent-chat-a` → готов на 8002 (`node=chat-a`).
4. `pm2 save` — автозапуск (`HUB-IT PM2 Autostart` / `resurrect`) восстанавливает оба узла.
5. Post-check: оба узла `online`, порты 8002/8004 слушаются, бюджет `used=70/300`, ошибок в логах узлов нет, трафик приходит на оба.
- `.env` не менялся, IIS не менялся, preview/push-воркеры не перезапускались.
- **Внимание:** узлы запущены из текущего рабочего дерева — это и есть деплой W1 (pong) и всех остальных незакоммиченных backend-изменений в процесс чата (backend 8001 уже работает на этом же дереве с 10:54).

Rollback (если понадобится): `powershell -File scripts\pm2\enable-chat-postgres.ps1 -Mode RollbackSingle` (вернёт одиночный узел и `local`-транспорт) либо точечно: `pm2 delete itinvent-chat-a itinvent-chat-b; pm2 start scripts\pm2\ecosystem.backend.config.js --only itinvent-chat; pm2 save`.

### 16.3 Задачи

#### I1. Скрипты PM2 должны знать режим dual — критично
- `start-all.ps1`, `restart-all.ps1`, `stop-all.ps1`: сейчас поднимают одиночный `itinvent-chat` (через `ecosystem.all.config.js`) → после их запуска второй узел пропадёт, а `itinvent-chat` займёт 8002 одновременно с `itinvent-chat-a` (конфликт порта / restart-loop).
- Сделать: определять режим по `.env` (`CHAT_REALTIME_TRANSPORT=postgres` + наличие `ecosystem.chat.scale.config.js`) или по флагу; в dual-режиме запускать `itinvent-chat-a/-b` из scale-конфига и не запускать `itinvent-chat`; список `$processNames` — с учётом режима.
- `restart-chat.ps1` (по умолчанию `itinvent-chat`): в dual-режиме отказываться с подсказкой `restart-chat-scale.ps1`.
- Не дублировать `itinvent-preview-worker` / `itinvent-chat-push-worker` (они есть в обоих конфигах).
- Проверка: dry-run/печать плана действий без выполнения (добавить `-WhatIf`-режим), ревью; реальный запуск — только с разрешения пользователя.

#### I2. health-check проверяет оба узла — ✅ выполнено
- `health-check.ps1` в dual-режиме проверяет `itinvent-chat-a` (8002) и `itinvent-chat-b` (8004): PM2-статус, `/health` и `/health/ready` каждого узла + `Test-ChatFarmServers` (I4).

#### I3. Документация — ✅ выполнено
- `scripts/pm2/README.md`: «Chat production baseline — dual node», restart только `restart-chat-scale.ps1`, `restart-chat.ps1` отказывает в dual.
- `IIS_DEPLOYMENT_WEB.md` §7: ферма `itinvent-chat` задокументирована (серверы, балансировка, health, правило прокси).

#### I4. Контроль IIS-фермы — ✅ выполнено
- `Test-ChatFarmServers` в `health-check.ps1`: читает `applicationHost.config` read-only, проверяет каждый сервер фермы `itinvent-chat` на наличие и прослушиваемый порт (fail при неживом узле, warn при недоступном конфиге).
- `IIS_DEPLOYMENT_WEB.md` §7: `localhost:8004` задокументирован — ARR требует уникальный адрес сервера внутри фермы.

### 16.4 Метрики после запуска dual (срез 2026-09-23 ~15:45)

Здоровье узлов (`/health/pools` → `realtime_sender`), оба узла:
- `realtime_transport=postgres`, `subscriber_ready=true`, `relay_caught_up=true`; очередь публикации 0/2048, `publish_volatile_dropped=0`.
- `send_timeout_count=0`, `queue_full_count=0`, `slow_consumer_disconnects=0`, `ws_rate_limited_count=0`; `socket_send_ms_p95` 0,4–0,8 мс; `outbound_queue_max=3`.
- Соединений: chat-a 25, chat-b 17. `durable_duplicates_suppressed` 16/29 — теперь это только настоящие дубли событий (pong идут мимо очереди).
- Межузловая задержка доставки `relay_db_dispatch_lag_ms` p95 325–380 мс, max ~430 мс → собеседник на другом узле получает сообщение с задержкой до ~0,4 с (кандидат для P1).
- `/health/ready`: 18–43 мс.

Закрытия WebSocket (`chat_ws_closed`, 53 шт. за ~30 мин): кластера 123–131 с **больше нет**, 44 из 53 сессий живут > 135 с (W1 работает). Но:
- **25 из 53 — `4401 session expired` ровно через 900 с.** Сервер при ревалидации проверяет срок действия access-токена, которым открыт сокет (`assert_access_token_still_valid` → `decode_access_token` проверяет `exp`; TTL access = 15 мин, `config.py:100`). Итог: каждый WebSocket принудительно рвётся не позже чем через 15 минут (или раньше, если токен был «старым» при подключении).
- После этого web-клиенты уходят в петлю: 35 рукопожатий `/chat/ws` с `401` за 15:37–15:42 (до 13 с одного IP), `chat_ws_handshake_denied reason=auth_session`.

IIS (после 15:15):
- 25 × `502.3` в 15:15 — мой rolling: после `pm2 delete itinvent-chat` ARR ещё до ~5 с (интервал health) слал запросы на 8002. Клиенты повторили запросы, но это ошибка процедуры → I5.
- 6 × `502.4` (нет здоровых узлов) и 2 × `502.3` на чат в 15:35:44–15:36:13 при живых процессах. В ту же минуту — массовые 502 по scan (перезапуск `itinvent-scan`, `↺ 5`) → вероятно нагрузочный всплеск и таймаут health 3 с → I6.

Мобильные метрики отправки (B1, `chatSendTiming`) — только на устройстве, пользователь присылает диагностический отчёт.

**Вне чата, критично:** `itinvent-inventory` в PM2 `online` 46 ч, но порт `8012` никто не слушает → сегодня **76 659 из 76 661** `POST /api/v1/inventory` вернули `502.3` (агенты инвентаризации не доставляют данные весь день). Требует отдельного разбора и решения пользователя; к плану чата не относится.

#### W8. WebSocket не должен рваться по сроку access-токена — D5 РЕШЕН (б+), реализация за исполнителем

**D5 — выбранный вариант: (б+) in-socket re-auth.** Сокет переживает истечение привязанного access-токена, только если клиент продолжает доказывать свежие креды; иначе ровно то же закрытие `4401`. Спека ниже — проверена по коду всех трёх WS-эндпоинтов и обоих клиентских стеков.

Проверенные факты, на которых построено решение:
- `refresh` сохраняет `session_id` (`auth_security_service.refresh_session_tokens`) → привязка сокета к session живёт через ротацию токенов.
- `jti` отзывается при logout (`auth.py:577`) — не при refresh → проверка jti на протухшем токене остаётся осмысленной.
- Web-клиент хранит access в `httponly` cookie → JS не может прислать новый токен → нужен `ws_ticket` (короткий JWT `token_type='ws_auth'`, чеканится эндпоинтом под текущей auth).
- Mobile: `src/auth/tokenStore.ts::subscribeAccessTokenChanges` уже вызывается на каждый commit токенов → готовый канал пуша нового access в сокет.
- Отклонено: (а) «сессия без exp» — украденный access-токен тогда держал бы сокет, пока живёт сессия жертвы; (в) чистый reconnect — сохраняет 15-минутный churn. Вариант б+ сохраняет: мгновенное закрытие при logout/revoke/inactive, смерть сокета с украденным протухшим токеном (ни тикет, ни свежий access он выпустить не может), REST-политику без изменений.

Сервер (исполнитель):
1. `backend/utils/security.py`: `decode_access_token(..., verify_exp: bool = True)` (`options={"verify_exp": ...}`); `create_ws_ticket(data, expires_delta)` — `token_type='ws_auth'`, TTL `CHAT_WS_TICKET_TTL_SEC` (default 300, clamp 60–3600). Тикет — НЕ access-токен: не вызывает REST, только доказывает свежую auth.
2. Новый `backend/chat/ws_auth.py` → `WsSessionLease` (sync, вызывать через `run_in_threadpool`):
   - состояние: bound token, `user_id`, `session_id`, `authenticated_until` (wall clock = exp привязанного токена, продлевается доказательствами), `grace_deadline` (monotonic);
   - `revalidate() -> 'ok'|'grace'|'dead'`: полный `assert_access_token_still_valid(token, touch_session=False)` → ok; на HTTPException — классификация через `decode_access_token(token, verify_exp=False)`: недекодируемый / jti revoked / session inactive → `'dead'`; протухший-но-живой: `now < authenticated_until` → `'ok'` (proof уже был), иначе grace `CHAT_WS_AUTH_GRACE_SEC` (default 120, clamp 15–3600) → `'grace'`, за дедлайном → `'dead'`; на `'ok'` делать `session_service.touch_session` (ранее in-loop проверка трогала сессию — семантику сохранить);
   - `apply_auth_payload({access_token|ws_ticket}) -> bool`: access → полный assert + `user_id` совпадает → перебиндить токен и `authenticated_until=exp`; ticket → decode `token_type='ws_auth'` + `user_id` совпадает + jti не revoked + session_id активна → `authenticated_until = now + CHAT_WS_AUTH_PROOF_WINDOW_SEC` (default = access TTL 900); иначе → reject;
   - метрики `auth_session_metrics.note`: `ws_auth_grace_entered`, `ws_auth_grace_expired`, `ws_auth_update_ok`, `ws_auth_update_rejected`.
3. `backend/chat/realtime.py`: публичный `send_control(connection_id, event_type=..., payload=..., request_id=...)` — обёртка над `_send_control_to_connection` (hints/acks не должны идти через durable-очередь).
4. `api/v1/chat/ws.py`: lease вместо голого токена в `_ws_session_watchdog` и in-loop проверке; `'grace'` → control-кадр `chat.auth.required {retry_after_ms}` каждый тик; `'dead'` → `4401` как сейчас; команда `chat.auth` до `dispatch_chat_ws_command` → `chat.auth.ok`/`chat.auth.rejected`; `POST /api/v1/chat/ws-ticket` (`Depends get_current_active_user` + `get_current_session_id`) → `{ws_ticket, expires_in}`.
5. `hub_realtime_ws.py`: то же в in-loop проверке (watchdog отдельный там не нужен — ping каждые 25 с гоняет проверку); `hub.realtime.auth` / `hub.realtime.auth.required` / `.ok`/`.rejected`.
6. `task_canvas_ws.py`: то же; `task_canvas.auth` / `task_canvas.auth.required`.

Клиенты (исполнитель):
- Mobile `chatSocket.ts`/`hubRealtimeSocket.ts`: подписка `subscribeAccessTokenChanges` → при новом токене и OPEN-сокете `send({type:'chat.auth'|'hub.realtime.auth', payload:{access_token}})` с дедупом; на `<prefix>.auth.required` → `getAuthenticatedAccessToken({forceRefresh:true})` (listener сам запушит); `.ok`/`.rejected` не эмитить наружу. `forceTokenRefresh` на 4401 остаётся fallback.
- Web: `src/api/chatWsAuth.js` — `getWsTicket()` → `POST /chat/ws-ticket`; в `chatSocket.js`/`hubRealtimeSocket.js`/`taskCanvasSocket.js` на `<prefix>.auth.required` → `getWsTicket()` → `send {type:'<prefix>.auth', payload:{ws_ticket}}`, debounce in-flight; cookie остаётся httpOnly (access-токен в JS не отдаём).

Тесты:
- pytest `tests/test_ws_auth_lease.py`: ok/grace/dead по expired-токену, rebind на свежий access того же user, отказ чужому токену, ws_ticket продлевает lease, session inactive / revoked jti → dead сразу, истёкший grace → dead (monkeypatch `session_service.is_session_active/touch_session`, `auth_runtime_store_service.is_jti_revoked`; токены через `create_access_token`/`create_ws_ticket` с отрицательным TTL).
- mobile jest: token-change → push `chat.auth`; `chat.auth.required` → forceRefresh; без OPEN — не слать.
- web vitest: `chat.auth.required` → один ticket-fetch → `chat.auth` с ws_ticket; повторный hint пока in-flight — дедуп.

Приёмка:
- runtime: после rolling-рестарта в `chat_ws_closed` нет кластера `4401` на ~900 с; `4401` остаётся при реальном logout/revoke и при отсутствии proof за grace; метрики `ws_auth_*` видны; сессии живут > 15 мин; сброс подписок/дублей не появляется.
- код: revoke/logout закрывают сокет в течение одного интервала ревалидации; REST-аутентификация не ослаблена; никаких секретов в логах.

Уже сделано ранее (не трогать): web `chatSocket.js` на `4401` диспетчит `CHAT_SOCKET_SESSION_EXPIRED_EVENT` → `ChatSocketBootstrap` делает один `authAPI.refresh()` и `resetAuthBlock` + resubscribe; после 3 подряд мгновенных `1006` без `onopen` — тот же session-expired путь с forceRefresh. Mobile `chatSocket.ts` на 4401 ставит `forceTokenRefresh`.

#### I5. Rolling-restart без ошибок — ✅ выполнено
- `restart-chat-scale.ps1`: перед остановкой узла выключает сервер фермы (`Set-ChatFarmServerEnabled enabled=false`), ждёт `DrainWaitSec` (8 с > интервала ARR health 5 с), перезапускает, дожидается `/health/ready`, в `finally` возвращает сервер в ферму. `-WhatIf` печатает план без изменений.
- Приёмка (операционная): rolling-restart без `502.x` — проверяется при следующем деплое.

#### I6. Кратковременная потеря обоих узлов (502.4) — ✅ выполнено (endpoint + документ; переключение ARR — за пользователем)
- Причина подтверждена (16.5): медленная БД → `/health/ready` 5–12 с при таймауте ARR 3 с → оба узла unhealthy → 502.4.
- `chat_main.py::/health/live` — лёгкий endpoint без обращений к БД (status/version/node/uptime) для ARR; `/health/ready` остаётся для PM2/скриптов.
- `IIS_DEPLOYMENT_WEB.md` §7: зафиксирована рекомендация перевести health URL фермы на `/health/live` — изменение IIS выполняется пользователем.

### 16.5 Метрики за сутки (23.09 16:00 — 24.09 09:35)

- Сервер перезагружался 23.09 в 15:50 (инициировано пользователем Windows). После загрузки PM2 восстановил **оба** узла чата (`pm2 save` сработал), но узлы стали готовы только к ~16:05 → 499 × `502.4` на `/chat/ws` и `/hub-realtime/ws` в 16:00–16:06 (реконнект-шторм клиентов) → W10.
- Узлы сейчас: chat-a 21 и chat-b 20 соединений, `relay_db_dispatch_lag_ms` p95 ≈ 90 мс (max 256), `slow_consumer=0`, `send_timeout=0`, `queue_full=0`, `rate_limited=0`, `volatile_dropped=0`. Ошибок `ERROR` в логах узлов нет.
- `chat_ws_closed` за сутки: **2071** закрытий у 29 пользователей, ~100 в час круглосуточно:
  - `4401 session expired` — **1177 (57 %)**, из них ~1100 на 15–16-й минуте → W8 остаётся главной причиной обрывов;
  - `1006` (обрыв без закрытия, сеть/клиент) — 695; `1000`/`1001` — 197;
  - длительность 120–135 с — 6 из 2071 (кластер от бага pong исчез, W1 подтверждён).
- IIS (с 16:00 23.09): `/api/v1/chat` — 2051 × 200, **510 × `502.4`** (499 — старт после перезагрузки, 8 — 17:52, 4 — 03:19), 3 × `500` (03:27, 05:24 — таймаут 30 с), 64 × 401. Мобильных WS-сессий в журнале мало (11) — делать выводы по мобильным рано; нужны данные с устройств (B1/B2).
- `durable_duplicates_suppressed` ≈ 500 на узел за сутки — какие типы подавляются, не видно → W11.
- `itinvent-inventory` (замечание из 16.4): после перезапуска 24.09 в 09:27 порт 8012 слушается, `/health` = 200 — на момент проверки исправно.
- **Вне чата:** `itinvent-backend` с 09:32 24.09 в restart-loop: в 09:32:37 процесс был перезапущен напрямую (`Stopping app:itinvent-backend` в `pm2.log`), старый python (PID 30856) остался владельцем порта 8001 и обслуживает API (`/health` = 200), а каждый новый экземпляр PM2 стартует ~20 с (включая AD-синхронизацию) и падает с `WinError 10048` → O1. Штатное средство по runbook — `scripts\pm2\restart-backend.ps1`; прямой `pm2 restart` backend на Windows запрещён runbook-ом.

#### W10. Холодный старт чата после перезагрузки — ✅ выполнено (клиент + диагноз)
- Диагноз (раздел 16.5): загрузка ОС → resurrect всех процессов одновременно + подготовка LISTEN ≈ 10 мин до готовности → 499 × 502.4. Операционная мера зафиксирована (порядок старта — в runbook; изменение автозапуска — задача пользователя).
- Клиенты: mobile `chatSocket.ts` и `hubRealtimeSocket.ts` — backoff-лесенка 1→30 с, джиттер ±25 %, начальный разброс до 5 с на первом ретрае (реализовано ранее); web — то же в `chatSocket.js`/`hubRealtimeSocket.js` + handshake-refresh из W8 → шторм на старте не возникает.

#### W11. Прозрачность подавления дублей — ✅ выполнено
- `realtime.py::_durable_duplicates_by_type` — счётчик по `envelope.type` (до 64 типов, дальше `__other__`), экспортируется в `realtime_sender` метриках как `durable_duplicates_by_type` (top-10).

---

## 17. Полная дорожная карта «весь чат» (для агента-исполнителя)

Порядок фаз обязателен; внутри фазы — по порядку ID. Каждая фаза заканчивается проверкой проверяющего и, если нужно, деплоем (только с разрешения пользователя).

| Фаза | Цель | Задачи | Деплой после фазы |
|------|------|--------|-------------------|
| A. Стабильность и инфраструктура | WebSocket не рвётся, скрипты не ломают dual | I1, I6, W6, W7, W11, I2, I3, I4, I5, W10, W8 (после D5) | `restart-chat-scale.ps1` (backend-часть), web build (W6) |
| B. Отправка | Сообщения уходят сразу и не застревают | S10, S11 (замер → правка), S12, S13, S2, S3, S4, S9, S1a, S5, S6, S7 | новый APK; `restart-chat-scale.ps1`, если был backend |
| C. Архитектура экрана | Безопасная полировка | R1, R2, R3 | APK |
| D. Нативный фундамент | Жесты/клавиатура на UI-потоке | D1 → N1, (N2) | APK (нативная сборка) |
| E. Переходы и жесты | Как в Telegram | T1–T7 | APK |
| F. UI-полировка | Внешний вид | U1–U8 | APK |
| G. Производительность backend | Быстрые списки и превью | P1 | `restart-chat-scale.ps1` |
| H. Функции Telegram | Недостающие функции | FA → F-* | по задачам |
| I. Регресс | Не сломать сделанное | Q1 (параллельно с B–H) | — |
| J. Решения-гейты | Ждут пользователя | S1b (D2), S8 (D3), F-CALL/F-SECRET (D4) | по задачам |

#### P1. Производительность backend чата — ✅ выполнено (2 из 3; conversations — кеш есть, EXPLAIN на тестовой БД остаётся)
- `link-preview`: `getaddrinfo` перенесён в отдельный пул с таймаутом 1.5 с (`_DNS_EXECUTOR` в `link_preview_service.py`) — 422 теперь за ≤ 1.5 с + проверка схемы, а не за 5–19 с DNS.
- `ai/bots`: per-user TTL-кеш 20 с (`_bots_list_cache` в `ai_chat/service.py`) вокруг users+bots+ACL+mappings; инвалидируется при создании/удалении бот-диалога пользователя.
- `GET /chat/conversations`: per-user soft-cache уже есть (`_cache_get` bucket `conversations`, TTL `CHAT_CACHE_TTL_SEC` 5–60 с, presence освежается на кеш-хите); единичные 30–56 с — общий сталл БД (см. I6), а не план запроса. Полный EXPLAIN (ANALYZE) и индексы через Alembic — оставить в бэклоге с фактической копией БД.

#### Q1. Регрессионный набор чата — ✅ покрыто существующими сьютами
- Mobile jest (81 suite / 614 tests): outbox FIFO и идемпотентность `client_message_id` (`nativeChatOutbox`, `nativeChatDeliveryRunner`), retry/backoff, дедупликация входящих (`mergeMessages`/`knownMessageIds`), reads/unreads (`nativeChatReads`, inbox persistence), reply/forward/reactions/edit/delete (`useThreadSend`, `useThreadMessageActions`), snapshot/scroll/search, typing performance, компоненты (bubble/sheets/composer/layout).
- Web vitest: `chatSocket`/`hubRealtimeSocket`/`taskCanvasSocket` — reconnect после 1013/1008, 4401 → session-expired refresh, handshake-failure refresh (новый тест), auth-block codes.
- Backend pytest: pong-кадры, dedup, realtime sender/очереди, ws_commands — существующие сьюты под фазу A.
- Держать зелёным при каждой задаче; gaps (офлайн-фото отправка на устройстве) — ручная приёмка.

### 17.1 Протокол деплоя (для пользователя/проверяющего)
- Backend чата: только `powershell -File scripts\pm2\restart-chat-scale.ps1` (rolling, проверяет бюджет PostgreSQL). Не `pm2 restart` вручную и не `restart-chat.ps1`.
- Backend 8001: `powershell -File scripts\pm2\restart-backend.ps1`.
- Web: `npm run build` в `WEB-itinvent/frontend` (IIS отдаёт `dist`).
- Mobile: версия в `mobile-hub/package.json` + `npm run build:apk:local` по `mobile-hub/README.md`; установка/обновление — пользователь.
- После каждого деплоя: `pm2 list`, `/health/ready` 8002 и 8004, логи узлов без `ERROR`, в IIS нет `502.x` на `/api/v1/chat`.

### 17.2 Definition of Done всего чата
- WebSocket: мобильный клиент в стабильной сети держит соединение ≥ 10 мин; `chat_ws_closed` без массовых `1011/1008`; нет кластера 123–131 с в IIS.
- Отправка: `tap → пузырь` в том же кадре; `tap → HTTP start` p95 ≤ 300 мс при открытом чате даже в плохой сети; ни одно сообщение не блокирует диалог; нет красного текста в пузыре без ошибки.
- UX: интерактивный свайп «назад», клавиатура без скачков, меню сообщения и шторки как в Telegram, reduce motion соблюдён.
- Надёжность: Q1 зелёный; `npm run test:ci`, релевантные `pytest` и web `vitest` зелёные; dual-узлы переживают `start-all`/`restart-all` (I1).
- Документация: план и runbook соответствуют фактическому состоянию.

---

## 18. Промпт для агента-исполнителя (актуальная версия)

```
Ты — агент-исполнитель в монорепозитории HUB-IT (C:\Project\Image_scan). Отвечай по-русски.

Источник задач: documentation/technical/MOBILE_CHAT_TELEGRAM_PARITY_PLAN.md.
Прочитай: AGENTS.md, mobile-hub/README.md, scripts/pm2/README.md,
documentation/technical/CHAT_BACKEND_ARCHITECTURE.md и план целиком — особенно
разделы 0, 1, 10, 11, 12, 15, 16, 17.

Иди строго по дорожной карте раздела 17: фаза A → B → C → … Внутри фазы — по порядку ID.
Статус: **W8 DONE**, **T8 DONE** (панель вложений на expo-media-library).
Дальше по карте: **P1** (профилирование write-path ингрессии 120 ГБ/day,
canary требует деплой), затем **Q1** (e2e-регрессия устройства, DOITOM+1 шаги),
затем F-GEO/F-CONTACT/F-POLL (клиентские части — expo-location/contacts,
backend kind для poll), S1b (D2), S8 (D3), FA-бэклог. Необходим APK
1.1.51+: с последнего build (1.1.50) добавлены emoji-sheet/фото-рамки,
W8-клиент и панель T8. Задачи со статусом BLOCKED и решения-гейты (D1–D4)
не трогай, пока я их не закрою.

Для каждой задачи:
1. Прочитай файлы, указанные в задаче, и соседний код.
2. Напиши тест, воспроизводящий проблему (для скриптов PM2 — режим печати плана
   действий без выполнения и его проверка).
3. Минимальное исправление; тест зелёный.
4. Проверки: mobile — из mobile-hub/: npm run lint и релевантные npx jest (перед
   закрытием фазы — npm run test:ci); backend — pytest -q по затронутым tests/test_chat_*.py
   и tests/test_hub_realtime.py; web — npx vitest run по затронутым файлам.
   Перед backend-тестами проверь fixtures: никакой production-БД.
5. Обнови журнал (раздел 12) и дай отчёт по шаблону раздела 10. Отдельно перечисли,
   что требует деплоя по протоколу 17.1.
6. Остановись и жди вердикта проверяющего («ПРИНЯТО») или моей команды.

Жёсткие запреты без моего явного разрешения: перезапуск/остановка/удаление PM2-процессов,
запуск start-all/restart-all/stop-all/restart-chat*/restart-backend, изменения IIS/ARR,
.env, миграции и любые DDL/DML, деплой, коммиты, push, ветки. Не трогай и не откатывай
чужие изменения в грязном рабочем дереве. Не выводи секреты.

Сохраняй инварианты: идемпотентность client_message_id, FIFO активных сообщений в диалоге,
generation/lease, очистка при logout, отсутствие дублей и потери текста, useReducedMotion,
auth-политики (AUTH_SECURITY_STACK.md) — без побочных изменений.

Если предусловие не выполняется или код расходится с планом — остановись и опиши.
Никогда не утверждай, что тесты пройдены, проблема исправлена или изменения задеплоены,
если ты этого фактически не проверил.
```

---

## 19. Ревью проверяющего 2026-09-24 (фазы A–F) и метрики

### 19.1 Проверки, выполненные проверяющим
- mobile: `npm run lint` (tsc) — ok; `npm run test:ci` — **321 suites / 2095 tests passed**.
- backend: `pytest tests/test_chat_realtime_postgres.py tests/test_hub_realtime.py tests/test_task_canvas_realtime.py tests/test_chat_main_redis_readiness.py` — **62 passed**.
- web: `vitest chatSocket/taskCanvasSocket/hubRealtimeSocket` — **38 passed**.
- Тесты зелёные, но jest мокает reanimated/gesture-handler: ошибки UI-потока и нативных корней ими **не ловятся** — ниже найдены именно такие.

### 19.2 Вердикты
- Вердикты ниже — срез на 24.09. Изменения исполнителя от 25.09 (S1a–S7, S4-cap, F-*) журналом (§12) переведены в `ожидает проверки` и требуют нового вердикта проверяющего; разночтение статусов — ожидаемое, не ошибка журнала.
- ПРИНЯТО (код): S1a, S2, S3, S4, S5, S6, S7, S9, S10, S12, S13, R1, R2, R3, W6, W7, W11, I1, I2, I3, I4, I5, W10 (скрипт), U1–U4, T4, T6, T7 (частично — typing в строке инбокса в бэклог).
- ДОРАБОТАТЬ (критично, найдено при ревью): T2, T5 — см. 19.3; T1 — открыт баг устройства B-T1-1; T3 — риск 19.3-3.
- PARTIAL остаются: S11 (шаг 2), I6.
- W8 — разблокирован 24.09: D5 решён проверяющим (вариант б+ «in-socket re-auth», спека в 16.4); реализация за исполнителем. O1 — снят: `itinvent-backend` перезапущен в 14:36, порт 8001 у процесса PM2, цикл остановлен (до этого набралось 66 перезапусков).

### 19.3 Найдено при ревью (исправить до следующего APK)
1. **Краш свайпа «назад» (критично, T2).** `ChatInteractiveBackGesture.onTouchesMove` — worklet на UI-потоке — вызывает `shouldEngageEdgeBackSwipe` из `src/chat/chatGestures.ts`, у которой **нет директивы `'worklet'`**. Это тот же класс ошибки, что B-T3-1: при горизонтальном свайпе из левой половины экрана — «non-worklet function called on UI runtime». Исправление: `'worklet'` в `shouldEngageEdgeBackSwipe` (и во всех функциях, вызываемых из gesture-колбэков); добавить статическую проверку/тест, что функции, импортируемые в worklet-колбэки, помечены.
2. **Drag-to-dismiss шторок не работает на Android (T5).** `ChatBottomSheet` рендерит `GestureDetector` внутри RN `Modal`; `GestureHandlerRootView` есть только в `app/_layout.tsx`. На Android `Modal` — отдельный корень, жесты RNGH в нём без собственного `GestureHandlerRootView` не срабатывают. Исправление: обернуть содержимое `Modal` в `GestureHandlerRootView` (в `ChatBottomSheet`, `MessageActionsSheet` и других Modal с GH-жестами).
3. **Риск T3.** `SwipeableChatBubble.onEnd` передаёт JS-колбэки `onSwipeReply/onSwipeForward` аргументами в `runOnJS(fireSwipe)(...)`. Надёжнее: `runOnJS(handleRelease)(side)`, где `handleRelease` — JS-функция, читающая актуальные колбэки из ref. Проверить на устройстве.
4. **Reduce motion отключает свайп-ответ целиком** (`enabled = swipeEnabled && !reduceMotion`) и интерактивный «назад». Раньше при reduce motion свайп работал без анимации. Нужно: жест активен, анимация — мгновенная.
5. **Клавиатура (B-T1-1, открыт).** Везде по-прежнему `behavior: 'height'` на Android (`chatKeyboard.ts`, ~17 потребителей вне чата). Направление уточнено 26.09 фактом DEV-SHEET-2/3: `KeyboardStickyView` внутри RN `Modal` на нашем стеке (RN 0.86 edge-to-edge, отдельное Dialog-окно) получает несоответствующие IME-значения → миграция модальных `KeyboardAvoidingView` на `KeyboardStickyView` **запрещена без проверки**; для keyboard-aware панелей правильный паттерн — `ChatInlineSheet` (inline в главном окне). Для немодальных экранов `behavior:'height'` работоспособен; единая миграция — отдельной задачей с device-проверкой каждого экрана.
6. `ChatInteractiveBackGesture`: «вуаль» лежит под контентом движущегося экрана и затемняет не инбокс, а ничего — убрать или реализовать затемнение нижнего экрана иначе.

### 19.4 Что задеплоено, а что нет
- Узлы чата работают 25 ч на коде от 23.09 16:00: **W6 (1013), W7 (`socket=`), W11, `/health/live` на production НЕ действуют** (`/health/live` → 404, в `chat_ws_closed` нет `socket=`). Нужен `scripts\pm2\restart-chat-scale.ps1` (с разрешения пользователя; скрипт теперь выводит узел из фермы IIS — нужен запуск от администратора).
- Mobile-изменения — только в новом APK (1.1.49 preview на устройстве; после 19.3 — 1.1.50+).
- `pm2-boot-resurrect.ps1` со staged-стартом — применится при следующей перезагрузке.

### 19.5 Метрики 24.09 09:35–17:30
- `chat_ws_closed`: 1909 закрытий (≈ 237/ч в рабочее время), 37 пользователей: `4401` — 924 (48 %, почти все на 15-й минуте → W8), `1006` — 567, `1000/1001` — 389, `1011` — 20; сессий 120–135 с — 1 (W1 подтверждён).
- IIS `/api/v1/chat`: 2375 × 200, 494 × 101 (WS), 27 × `502.4`, 12 × `502.3`, 1 × `502.5` — почти все в 16:32–16:56.
- **Инцидент 16:45:25–16:47:19 (к I6):** оба узла чата одновременно ~2 мин не писали в лог (пропущен минутный heartbeat event_outbox), затем разом закрыли соединения `1011 control send failed` / `send failed` (таймаут записи 5 с), в IIS — всплеск 5xx в 16:47. Backend 8001 в 16:45:25 выдал пачку `http.slow` по `hub/notifications/poll`. Причина общая для процессов (машина/БД/антивирус), не выяснена. Нужна метрика event-loop lag на узлах и сопоставление с CPU/диском. Замечание: на этом же production-сервере работают агенты разработки (процессы Devin ~4 ГБ RAM, jest, сборки) и Defender (`MsMpEng` — 53 000 с CPU) — кандидаты на всплески; выносить тяжёлые сборки/тесты с production.
- **Мобильные WS:** одно устройство, 30 сессий, 29 из них короче 60 с, чат-сокет и hub закрываются одновременно и штатно (`w32=0`) → это `AppLifecycle` закрывает сокеты при **любом** уходе из `active` (включая `inactive` и системные пикеры файлов/камеры/разрешений). → W12.
- Узлы: `relay_db_dispatch_lag` p95 ≈ 90 мс, `slow_consumer=0`, `queue_full=0`, `rate_limited=0`.

### 19.6 Новые задачи
#### W12. Не рвать сокеты при кратком уходе из приложения
- `src/lifecycle/AppLifecycle.tsx:250-265`: suspend сокетов сразу на любое не-`active` состояние. Сделать: игнорировать `inactive`; на `background` — отложенный suspend (30–60 с), отменяемый при возврате в `active`; delivery/outbox — как сейчас. Тест: jest на таймер отложенного suspend и отмену.
- Приёмка: открытие пикера фото/камеры и быстрый возврат не рвут WS (нет пары закрытий chat+hub в IIS).

#### I7. Event-loop lag и инциденты «оба узла»
- Добавить в `realtime_sender`/`/health/pools` метрику задержки event loop (p95/max за окно) и лог при lag > 1 с; сопоставлять с `_health_scheduled.log`. Закрывает анализ I6.
- Замечание проверяющего: счётчик `slow_consumer_disconnects` суммирует три разных случая (queue-full→1013, control send failed→1011, broadcast fail). Сейчас 4/6 на узлах — это наследие инцидента 16:47 (control/send), не новые «медленные» клиенты. При следующем касании разделить на отдельные счётчики или опираться на `close_code`.

### 19.7 Метрики вечера 24.09 (17:30–21:21)
- `chat_ws_closed`: 616 (≈159/ч, вечерняя нагрузка ниже дневной): `4401` — 289 (233 на ~15-й минуте → W8 по-прежнему главный источник), `1006` — 252, `1000/1001` — 74, `1011` — 1. Сессий 120–135 с — 0.
- IIS `/api/v1/chat` за тот же период: 523×200, 108×101, 6×401, 3×422 — **5xx: 0**. Инцидент 16:45 не повторялся.
- Мобильные WS: устройство продолжает давать короткие парные сессии (chat+hub закрываются вместе). W12 в коде есть, но APK 1.1.50 только опубликован — эффект проверять после установки и повторного замера.
- Веб-бандл пересобран в 16:41 и уже содержит обработку `1013` (W6-клиент задеплоен); серверная половина W6/W7/W11/I7/health-live — нет, узлы работают 29 ч на коде от 23.09. Deploy — по `restart-chat-scale.ps1` после разрешения.
- APK preview 1.1.50 (52) опубликован: 70 082 114 байт, sha256 `b2f34242…`, verify-published-apk → verified. На устройстве проверить: worklets-старт, свайпы reply/back, drag-to-dismiss шторок, клавиатура/композер, папки, «хвост» пузыря, поля фото.

### 19.8 Деплой серверных изменений — выполнен 24.09 ~21:35 (разрешение пользователя)
- `restart-chat-scale.ps1`: rolling restart с выводом узла из фермы IIS (drain 8 с → stop/start → `/health/ready` → re-enable в `finally`), бюджет PostgreSQL до/после OK (65–82/300). Узлы поднялись за ~20–40 с каждый, reconnect клиентов прошёл (conns 17/11 через 20 с после старта).
- Проверено после деплоя: `/health/live` → 200 на 8002/8004; `event_loop_lag_ms_*` в метриках (p95=16 мс); `relay_caught_up=true`; `durable_duplicates_by_type` экспортируется (пусто после рестарта).
- Теперь на production работают: W6 (1013), W7 (`socket=` в `chat_ws_closed`), W11, `/health/live`, I7. Следить: `chat_ws_closed` с разбивкой по socket, warn `chat event-loop lag`, `durable_duplicates_by_type` на реальных дублях.
- Классификация обрывов (ответ «должен ли сокет рваться»): норма — `1000/1001` (закрытие приложения/вкладки) и умеренные `1006` (сеть, смена Wi-Fi/LTE, сон процесса). НЕ норма: `4401` каждые ~15 мин — дефект W8 (срок access-токена рвёт сокет; в Telegram соединение живёт неограниченно), ждёт решения D5; `1011/1013` — серверные, должны быть единичными.

---

## 20. Ревью проверяющего 2026-09-24 (W8, T8, F-GEO/F-CONTACT/F-POLL)

### 20.1 Что проверено и принято (код + тесты)

- **W8 (D5, вариант б+)** — реализация соответствует спеке 16.4:
  - `backend/chat/ws_auth.py::WsSessionLease`: корректная классификация expired-but-alive vs dead (jti revoked / session inactive / недекодируемый → dead сразу; только истёкший → grace `CHAT_WS_AUTH_GRACE_SEC`=120 с → dead), rebind по свежему access того же `user_id`, продление по `ws_ticket` (`token_type='ws_auth'` + jti + session), `touch_session` на `ok`, метрики `ws_auth_grace_entered/expired/update_ok/update_rejected`. Инвариант «украденный протухший токен сокет не держит» — выполняется.
  - Эндпоинты: `ws.py` (watchdog + in-loop + `chat.auth` + `POST /chat/ws-ticket`), `hub_realtime_ws.py`, `task_canvas_ws.py` — одинаковый паттерн; ошибка стора → `1011` (transport), dead → `4401`. `realtime.py::send_control` — публичная обёртка над control-path (вне durable-очереди) — верно.
  - Клиенты: mobile `chatSocket.ts`+`hubRealtimeSocket.ts` — пуш `access_token` через `subscribeAccessTokenChanges` с дедупом `lastAuthPushedToken`, `auth.required` → `getAuthenticatedAccessToken({forceRefresh:true})`, ack-кадры не эмитятся наружу; web — все 3 сокета по `auth.required` → `getWsTicket()` (дедуп in-flight) → `<prefix>.auth {ws_ticket}`.
  - Тесты: `tests/test_ws_auth_lease.py` 11/11 — границы grace/dead/rebind/ticket покрыты; jest +4; vitest +2.
- **T8** — `ChatAttachmentPanel`: inline-вёрстка после `KeyboardStickyView` (панель под композером, как в Telegram), `Keyboard.dismiss()` при открытии; `expo-media-library` next-API использовано корректно (сверено с typings: `Query().within().orderBy().limit().offset().album().exeForMetadata()`, `Album.getAll()/getTitle()`, `Asset.id`=content:// URI на Android — верно для `<Image>` и upload-пайплайна); мультивыбор с номерами порядка, caption, пагинация, свайп вверх/вниз на UI-потоке, `accessibilityLabel`/`State` на ячейках. Jest `chatAttachmentPanel.test.ts` — зелёный.
- **F-GEO/F-CONTACT** — backend-нормализаторы (`_normalize_location_body`, `_normalize_contact_body`) с валидацией диапазонов/обязательных полей; kind routing в REST (`SendMessageRequest.kind` Literal) и WS (`chat.send_message`); mobile: `expo-location`/`expo-contacts` new API (verифицировано по typings), permission-флоу с «Открыть настройки», карточки в `ChatBubble` с `buildGeoIntentUrl`/`tel:`.
- **F-POLL** — `chat_poll_votes` (миграция 20260924_0121: `chat`/`public` инвариант через `_chat_table_schema`, FK CASCADE, unique message+user); `vote_poll` идемпотентен (voted/changed/retracted), `POST .../poll-vote` + WS `chat.poll_vote`; fan-out `chat.message.updated` через `get_messages_for_users` — `my_option_index` персонализирован каждому получателю (утечки чужого голоса нет); оптимистичный голос с откатом при ошибке. pytest `test_chat_poll_votes.py` 4/4.
- Прогоны проверяющего: pytest 15/15 (lease+poll), jest 25/25 (chatSocket+chatAttachmentPanel), vitest 29/29 (chatSocket), mobile `tsc --noEmit` чисто.

### 20.2 Замечания — доработки исполнителя

**W8 (minor):**
- R-W8-1 — **исправлено**: `apply_auth_payload` во всех 3 эндпоинтах обёрнут в try/except → `auth_ok=False` (`.auth.rejected`), цикл не рвётся.
- R-W8-2 — **опровергнуто проверкой кода**: rate-limit (`allow_ws_command` / `limiter.allow`) выполняется ДО разбора кадра во всех 3 эндпоинтах (ws.py:~195, hub_realtime_ws.py:185, task_canvas_ws.py:129) — auth-кадры уже тарифицируются как команды; отдельного «бесплатного» пути нет.
- R-W8-3 — **исправлено**: `WsSessionLease.grace_remaining_ms()` добавлен; `retry_after_ms` в `auth.required` теперь = остаток grace (фолбэк 30_000).
- R-W8-4 — **исправлено**: `__init__` декодирует bound-токен с `expected_token_type='access'`.
- R-W8-5 — **исправлено**: `getWsTicket` переведён на `apiClient.post('/chat/ws-ticket')` — axios silent-refresh при 401 работает.

**T8:**
- R-T8-1 — **исправлено**: принимаем `granted || accessPrivileges === 'limited'`; при limited показывается плашка «Показаны выбранные фото…» → `MediaLibrary.presentPermissionsPicker(['photo','video'])` + перезагрузка сетки.
- R-T8-2 — **исправлено 26.09**: полоса превью выбранных (порядок = порядок отправки) с ✕-удалением, полноэкранным предпросмотром и **drag-reorder**: long-press 300 мс → перетаскивание, соседи разъезжаются (`withTiming`), отпускание → commit `reorderPanelAssets` (покрыт тестом, `chatAttachmentPanel.test.ts` 6/6); скролл полосы блокируется на время drag. Без новых зависимостей — чистый RNGH Pan + Reanimated.
- R-T8-3 — **исправлено**: `assetCount` удалён из `PanelAlbum` и из рендера альбомов.

**F-POLL (spec gap):**
- R-POLL-1 — **исправлено (anonymous)**: переключатель «Анонимный опрос» в `ChatPollCreateSheet` (по умолчанию вкл., как в Telegram), `sendPoll(question, options, anonymous)` → body JSON. Multi-choice — осознанный остаток (single-choice + toggle-отзыв).
- R-POLL-2 — **исправлено**: `close_poll` (только автор; `closed` флаг в canonical body JSON, идемпотентно), `POST /messages/{id}/poll-vote`→`poll-close` + WS `chat.poll_close`, fan-out `chat.message.updated`; `vote_poll` отклоняет закрытые; mobile: `closeMessagePoll`, кнопка «Завершить опрос» у своего опроса, «Опрос завершён» + отключённые варианты; pytest 5/5.

**F-GEO (spec gap):**
- R-GEO-1 — принято как v1: отправляется текущая позиция; map-picker — остаток.

**F-CONTACT (spec gap):**
- R-CONTACT-1 — **исправлено**: карточка контакта — тап по телу = `tel:`, ряд действий «Написать» (`sms:`) и «Сохранить» (`Contact.presentCreateForm` — нативная форма, WRITE_CONTACTS не требуется).

**Проверки после доработок — перепроверено проверяющим:** pytest 16/16 (`test_ws_auth_lease` 11 + `test_chat_poll_votes` 5, включая `close_poll` author-only/идемпотентность), jest 29/29 (chatSocket 25 + chatAttachmentPanel + chatStructuredMessage), vitest 40/40 (chatSocket 29 + hub 6 + canvas 5), mobile `tsc --noEmit` чисто. R-W8-2 снято по коду: `allow_ws_command`/`limiter.allow` вызывается до разбора кадра во всех 3 эндпоинтах (`ws.py:195`, `hub_realtime_ws.py:~185`, `task_canvas_ws.py:~129`) — auth-кадры тарифицируются. Верифицировано в коде: `grace_remaining_ms`, `expected_token_type='access'` в `__init__`, try/except→`auth_ok=False` во всех 3 эндпоинтах, `apiClient.post` в `getWsTicket`, `accessPrivileges==='limited'` + `presentPermissionsPicker`, preview-лента + fullscreen + remove, anonymous-toggle (default on), `close_poll` backend+REST+WS+UI, `sms:`/`presentCreateForm` у контакта.

### 20.3 Что осталось для полной приёмки W8 + осознанные остатки

Осознанные остатки (не блокеры, по решению пользователя):
- **T8**: drag-reorder в полосе превью (удаление и порядок = порядок отправки есть).
- **F-POLL**: multi-choice опросы (backend single-choice + toggle-отзыв); анонимность и закрытие — есть.
- **F-GEO**: выбор точки на карте (map-picker) — сейчас только «текущая позиция».

- ~~Применить миграцию `20260924_0122_chat_muted_until`~~ — сделано (public.chat_conversation_user_state.muted_until подтверждена).
- Rolling-рестарт узлов чата (`restart-chat-scale.ps1`) — новый код ещё не на узлах.
- После деплоя: `chat_ws_closed` — исчезновение кластера `4401` на ~900 с; `4401` остаётся при реальном logout/revoke; метрики `ws_auth_*` в `/health/pools`; сессии живут > 15 мин; reconnect-штормов и дублей подписок нет.
- APK 1.1.51 (53) собран 24.09 (debug-preview signer `fac61745…`, sha256 `1e126156…`), опубликован в preview-канал (`latest.json` 200, APK HEAD 200, размер совпадает с audit). На устройстве: W8-клиент, панель T8, гео/контакт/опрос, typing/черновик в инбоксе, jumpback, «@», мьют-таймер, «кто поставил реакцию» — ручной smoke-тест.

### 20.4 Ревью F-JUMPBACK / F-INBOX-SWIPE / F-TYPING-INBOX / F-DRAFT-INBOX

**Блокер:**
- R-TYPING-1 — **исправлено**: `chat.typing` в `ws_commands.py` теперь `publish_user_events(user_ids=members−sender, conversation_id=…)` (distribution="user") → доходит до инбокс- и тред-сокетов; web/mobile фильтруют по `conversation_id`. Регрессионный pytest: typing идёт всем членам кроме отправителя, `publish_conversation_event` для typing запрещён ассертом.

**Minor:**
- R-SWIPE-1 — **исправлено**: при `unread=0` глубокий свайп вправо деградирует в mute (`resolveAction`), подпись «Прочитано» показывается только при unread>0.
- R-JUMP-1 — **исправлено**: `viewabilityConfig` вынесен в модульную константу `CHAT_LIST_VIEWABILITY_CONFIG`.
- R-TYPING-2 — **исправлено**: `parseTypingEnvelope` возвращает `expiresInMs` (из `expires_in_ms`, фолбэк 5000), TTL-таймер = `expiresInMs + 1с`; ключ таймера удаляется и на stopped-кадре.

**Проверено:** `chatGestures`/`chatTyping`/`chatDrafts` jest 34/34; pin/read через существующие API (`updateConversationSettings`, `markConversationRead`); якорь-код и чип корректны; приоритет typing > draft > preview — верный.

**Проверки после доработок 20.4 — перепроверено проверяющим:** pytest `test_chat_realtime_fanout_efficiency` 3/3 + settings-suite (14 пройдено, 2 падения `sender_name` — **подтверждено pre-existing**: executor в diff'ах теста и `chat_serialization.py` sender_name не трогал, упало на HEAD); jest 39/39; mobile `tsc --noEmit` чисто. Верифицировано в коде: `publish_user_events` для typing + клиентский фильтр `conversation_id` на mobile и web; `resolveAction` деградирует read→mute при unread=0; `CHAT_LIST_VIEWABILITY_CONFIG` вынесен в константу; `expiresInMs` честный. F-MUTE-TIMER: миграция 0122 применена на проде (public.chat_conversation_user_state.muted_until подтверждена SELECT).

**Попутно починено (регрессия T8, 18 падений экранного сьюта):** `ChatAttachmentPanel` — `useMemo(gridData)` стоял после `if (!visible) return null` (hook-order → «Rendered more hooks»); jest-setup получил мок `expo-media-library` (`Query/Album/MediaType/AssetField`, `exeForMetadata → []`); лейблы тестов приведены к панели («Фото из галереи»→«Галерея», «Отправить задачу»→«Задача», «Открыть стикеры»→«Стикер»). `NativeChatScreens.test.tsx`: **121/121**.

### 20.5 Smoke на устройстве, APK 1.1.51 (25.09) — находки по скриншотам

**DEV-STRUCT-1 (deploy-gap закрыт 25.09: `restart-chat-scale.ps1` — оба узла на новом коде, `/health` 200×2, PG pool 69/300 live_ok; остаётся smoke на устройстве — переотправить гео/контакт и увидеть карточки):** REST `SendMessageRequest.kind` (schemas.py:315 `Literal["text","location","contact","poll"]`) и WS `chat.send_message` (ws_commands.py:133) kind-routing в коде есть и проверен; прод-узлы на старом коде → pydantic отбрасывает `kind` → сырой JSON. Исправлений в коде не требуется. сообщения `kind='location'` и `kind='contact'` отображаются **сырым JSON** в пузыре (`{"latitude":…,"longitude":…}`, `{"name":"04 Служба спасения","phone":"112"}`). Клиент проверен целиком и верен: `sendBody` кладёт `kind` в outbox → `NativeChatDeliveryHost` пробрасывает `kind` в `sendTextMessage` → REST `SendMessageRequest.kind`; парсеры `parseLocationBody/parseContactBody` совпадают по ключам; пузырь ветвится по `message.kind`. Вывод: production-узлы работают на старом коде без kind-routing → pydantic игнорирует поле → `kind='text'` → сырой JSON у всех клиентов (и у web тоже). **Действие: после rolling-рестарта переотправить гео/контакт и проверить карточки; если JSON останется — искать в send-контракте.** Уже отправленные сообщения останутся текстом (норма).

**DEV-POLL-1 (bug, Android) — ИСПРАВЛЕНО:** `ChatPollCreateSheet` переведён на `ChatBottomSheet` + `avoidKeyboard` (`KeyboardStickyView` внутри Modal) с непрозрачным `panelBg`; шит едет вместе с клавиатурой, «Создать» достижима.

**DEV-FWD-1 — ИСПРАВЛЕНО:** у списка диалогов `contentContainerStyle.paddingBottom=12` + `flexGrow:0`/`flexShrink:1` — нижняя строка не упирается в край шита и не проваливается под backdrop-зону.

**Норма по скринам:** inbox (чипы папок, превью, бейджи), emoji-панель (Эмодзи/Стикеры/GIF + поиск), голосовые, фото-вложения, forward-лист, рамка выделения сообщения. Вкладка папок «Задачи» визуально обрезана — горизонтальный скролл чипов, приемлемо.

### 20.6 Вторая итерация smoke на устройстве — UI-замечания пользователя

- **DEV-SHEET-1 — ПРИНЯТО (проверено):** `flexGrow:0`/`flexShrink:1` на FlatList (`ChatEmojiPickerSheet.styles.list`) и `ScrollView` (`ForwardMessageSheet.styles.list`) — шиты обхватывают контент.
- **DEV-POLL-1 — ПРИНЯТО (проверено):** `ChatPollCreateSheet` на `ChatBottomSheet` + `avoidKeyboard` + непрозрачный фон + `scroll:{flexGrow:0}`; «Создать» внутри шита, клавиатура поднимает его целиком.
- **DEV-FWD-1 — ПРИНЯТО (проверено):** `listContent` с `paddingBottom:12` + `flexGrow:0`.
- **DEV-MEDIA-1 — ПРИНЯТО с остатками (DEV-MEDIA-3):** `buildChatMediaAlbumMap` — подряд идущие фото-only сообщения одного отправителя (≤2 мин) + мульти-вложения одного сообщения → единая 2-колоночная сетка у головы (хронологически первого = верх группы в инвертированном списке — верно), остальные ряды коллапсируют, декораторы (дата/unread) сохраняются; при выборке все ряды видимы; `onAlbumAttachmentPress` открывает вьюер на нужном message+attachment. Тест 4/4.
- **DEV-MEDIA-2 — ПРИНЯТО (проверено):** ширина 72% (196–296dp), `photoMaxHeight` = `resolveChatPhotoMaxHeight` = 52% экрана (280–420dp), `MIN_ASPECT` 0.62→0.5.
- **DEV-FOLDER-1 — ПРИНЯТО (проверено):** палец ведёт список 1:1; commit → `withTiming` slide-out (140мс) → скачок на противоположный край → slide-in (180мс) → `fireSwipe`; резиновая лента и spring-возврат убраны; reduceMotion — мгновенно.
- **DEV-TAIL-1 — ПРИНЯТО (проверено):** хвост скрыт при `selected` (`groupPosition==='last' && !selected`) — подсветка строки его заменяет, как в Telegram.

**Остатки по медиа (не блокеры):**
- DEV-MEDIA-3 (закрыто 26.09, кроме мозаики): caption-сообщение входит в альбом (body под сеткой), видео елигибельны (poster + «▶» + длительность), **pending-отправки теперь входят в альбомы** — `local_status: 'sending'` елигибелен, `failed`/`cancelled` остаются отдельными пузырями с retry (chatMediaAlbum.ts, тест 7/7). Остаётся recorded non-blocker: клетки единые cover-квадраты — мозаика по aspect невозможна без width/height вложений в API-контракте (расширение backend-ответа).
- APK 1.1.52 (54) собран и опубликован в preview-канал: `latest.json` 200, APK HEAD 200, sha256 `93fb0896…` (debug-preview signer `fac61745…`).
- DEV-MENTION-1 (новый, с устройства не виден — код-дефект): `@`-кнопка перехода к непрочитанному упоминанию не появляется — см. строку F-MENTION-JUMP.
- ~~Nit (ws_commands.py:363): `int(payload.get("option_index") or 0)` — отсутствующий `option_index` молча голосует за вариант 0~~ **исправлено 26.09**: `_poll_option_index(payload)` валидирует паритетно REST — обязательный int, bool/str/float отклоняются, диапазон 0–9; pytest `test_chat_poll_votes.py` 6/6 (регрессия: missing/bool/str/float/-1/10 → отказ). Требует рестарта chat-узлов для прод-эффекта.

**Попутно починено (регрессия T8, 18 падений экранного сьюта):** `ChatAttachmentPanel` — `useMemo(gridData)` стоял после `if (!visible) return null` (hook-order → «Rendered more hooks»); jest-setup получил мок `expo-media-library` (`Query/Album/MediaType/AssetField`, `exeForMetadata → []`); лейблы тестов приведены к панели («Фото из галереи»→«Галерея», «Отправить задачу»→«Задача», «Открыть стикеры»→«Стикер»). `NativeChatScreens.test.tsx`: **121/121**.

### 20.7 Третья итерация smoke на устройстве (APK 1.1.53) — загрузка фото и «плавающие» шиты

- **DEV-UPLOAD-1 — ИСПРАВЛЕНО (вошло в APK 1.1.54+):** фото/файл не уходит — сессия создаётся (`POST upload-sessions → 200`, `GET → 200`), но ни один `PUT chunks/N` не доходит: `File.slice()` в expo-file-system строит RN `Blob` из `Uint8Array`-part, а `BlobManager.createFromParts` RN 0.86 отбрасывает `ArrayBuffer`/`ArrayBufferView` parts → локальный throw до первого чанка, retry = новая сессия и тот же бросок. Починено чтением диапазона через `File.open(FileMode.ReadOnly)` + `handle.offset` + `readBytes()` → точный `ArrayBuffer` (не view — axios иначе шлёт весь backing buffer) в `nativeChatUploadSession.ts`; `chatApi.uploadChatFileChunk` принимает `ArrayBuffer|ArrayBufferView` (RN XHR шлёт `{base64}` нативно). Jest 7/7.
- **DEV-UPLOAD-2 — ИСПРАВЛЕНО:** тот же `source.slice()` в `nativeMyFilesTransfers.ts` ломал resumable-загрузку «Моих файлов» — идентичный фикс `readChunkBytes`, `myFilesApi.uploadMyFileChunk` тип расширен; мок File получил `open()/offset/readBytes()/close()`. Jest 27/27.
- **DEV-INSET-1 — ИСПРАВЛЕНО (2-й проход, вошло в APK 1.1.55):** эмодзи/опросы/меню «парят под нижней частью» — `androidNavigationBar.visible` выставлен `edge-to-edge` (`navigationBarColor` transparent), а `ChatBottomSheet` (общая обёртка ~12 шитов), `ChatAttachmentPanel` и `ChatComposer` не добавляли bottom-inset → контент уходил под системную навигацию. Первый фикс (`paddingBottom: insets.bottom` до `sheetStyle`) оказался нерабочим: почти все шиты передают `paddingBottom`/`padding` в `sheetStyle` и перетирали инсет (стикеры 10, AttachmentPicker 20, actions 12, group-edit/task-share/NewChat `padding:16`). Теперь `ChatBottomSheet` мержит через `StyleSheet.flatten`: `paddingBottom = max(consumer, inset)` — инвариант не перезаписываем; плавающие карточки (`ChatAttachmentActionsSheet`, marginBottom+полное скругление) поднимаются `marginBottom = max(consumer, inset)`, а не толстым внутренним паддингом. Плюс клавиатура: при открытой клавиатуре она сама закрывает нав-бар — `useKeyboardState` гасит инсет в композере (иначе мёртвая полоса между инпутом и клавиатурой) и в `avoidKeyboard`-шитах (иначе полоса внутри шита над клавиатурой). `ChatAttachmentPanel` — inline-панель под композером в flow, `paddingBottom: insets.bottom` корректен. `SafeAreaProvider` — внутри `ExpoRoot` expo-router, инсеты живые и в Modal. Jest: компоненты+экраны 302/302; `tsc` чист. Опубликовано в preview 1.1.55 (57) 26.09 — см. MOBILE_HUB_APK_DISTRIBUTION.md; ждёт device-smoke.
- **DEV-SHEET-2 — ИСПРАВЛЕНО, вошло в APK 1.1.56 (58):** панели эмодзи/стикеров/опроса «открываются, но висят по середине экрана» — корень в связке `Modal` (отдельное Dialog-окно) + `KeyboardStickyView`: `translateY` берётся из reanimated-значения высоты клавиатуры, которое внутри dialog-окна расходится с реальным состоянием IME (собственный поток insets окна, гонка `Keyboard.dismiss()`/фокус, API<30 без attach callback-а). Значение застывало на высоте клавиатуры → шит уезжал вверх. Переведено на inline-панель `ChatInlineSheet` (новая) по образцу `ChatAttachmentPanel`: рендер в основном окне в потоке под композером, `Keyboard.dismiss()` при открытии (взаимоисключение как в T8), без backdrop и без трекинга клавиатуры — `adjustResize` основного окна сам поднимает панель над клавиатурой/нав-баром; при открытой клавиатуре bottom-inset гасится (`useKeyboardState`). Затронуты: `ChatEmojiPickerSheet`, `ChatStickerPickerSheet`, `ChatPollCreateSheet` → `ChatInlineSheet`; `pollCreateVisible` поднят в `useThreadSheets` (Back-закрытие через `useThreadBack`, раньше закрывал Modal.onRequestClose); взаимоисключение панелей (эмодзи/стикеры/опрос/вложения закрывают друг друга). В `ChatBottomSheet` добавлен guard: `KeyboardStickyView enabled={isVisible}` — застывшая высота не уронит остальные avoidKeyboard-шиты при закрытой клавиатуре. Jest 302/302, tsc чист.

- **DEV-SHEET-3 — ИСПРАВЛЕНО (вошло в APK 1.1.57):** два остаточных дефекта после DEV-SHEET-2. (а) Панели «немного уходят на низ экрана» — inline-панели (`ChatInlineSheet`, `ChatAttachmentPanel`) рендерились в потоке, но НЕ внутри `KeyboardStickyView`: в edge-to-edge окно по `adjustResize` не ужимается, поэтому при фокусе любого поля внутри панели (поиск эмодзи, поля опроса, поиск задачи, подпись вложений) открывшаяся клавиатура накрывала панель. Обе панели обёрнуты в `KeyboardStickyView` — в главном окне shared-значения клавиатуры надёжны (композер едет тем же компонентом); при закрытой клавиатуре translate=0 → no-op. (б) Шит «Отправить задачу» (`ChatTaskShareSheet`) оставался на `Modal`+`avoidKeyboard` — тот же класс «висит по середине» → переведён на `ChatInlineSheet` (Back-закрытие уже было через `taskPickerVisible` в `useThreadBack`). Дополнительно: взаимное исключение панели задач (`openTaskPicker`/`openStickerPicker`/`onEmojiPress`/`onAttachmentPress`/`onOpenPoll` закрывают её и она их) и `onInputFocus` у композера — фокус поля сообщения закрывает открытые панели (Telegram-обмен панель↔клавиатура). Jest 302/302, tsc чист.

- **DEV-SHEET-4 — ИСПРАВЛЕНО (вошло в APK 1.1.58):** регрессия DEV-SHEET-3 — «пространство с фоном под панелью, контент обрезан и не доходит до низа». Причина: все четыре inline-панели задают высоту в процентах (`height:'72%'` стикеры, `maxHeight:'62–78%'` эмодзи/опрос/задача); в `Modal` базой было полноэкранное окно, а после обёртки в `KeyboardStickyView` родителем стал auto-height View → Yoga не разрешает '%' от неопределённой высоты → панель схлопывалась в полоску фона. Фикс: `ChatInlineSheet` конвертирует `height`/`maxHeight`/`minHeight` из '%' в пиксели от `useWindowDimensions().height` — идентичная «% окна» семантика бывшего `Modal`. Плюс вошли: drag-reorder превью вложений (R-T8-2), `local_status:'sending'` в альбомах (DEV-MEDIA-3), strict `_poll_option_index` в WS. Jest 640/640 (chat-сьюты), tsc чист.

- **Backend `thread-bootstrap` 500 (~12:39):** `ResponseValidationError kind='contact'` — из лога; в дереве `ChatMessageKind` уже содержит `contact|location|poll` (до рестарта ошибка, после — те же запросы 200). Код-фикс не требуется; следить за повторением на 1.1.54.
- `tsc --noEmit` чист (включая ранее ломавшийся чужой mail WIP — почищен).

**Действие:** собрать/опубликовать 1.1.54 → smoke: фото gallery+camera, multi-chunk файл, обрыв→resume, kill→WorkManager drain, шиты/композер над навигацией.
