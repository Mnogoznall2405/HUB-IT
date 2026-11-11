# Мобильный чат (Expo): план стабилизации, скорости, раздела «ИИ» и паритета с Telegram — 2026-10-01

Статус: **план для агента-координатора**. Код не менялся. Production, публикация APK, deployment и рестарты вне объёма без отдельного разрешения пользователя.

Область: `mobile-hub/` (Expo 57, RN 0.86, Android). Backend — только там, где задача это явно указывает (`WEB-itinvent/backend/chat/`, `services/notification_preferences_service.py`).

Базовый документ: [MOBILE_CHAT_TELEGRAM_PARITY_PLAN.md](MOBILE_CHAT_TELEGRAM_PARITY_PLAN.md) (далее — **PARITY**). Его правила §0, решения D1–D6 и журнал §12 действуют. Этот план не дублирует выполненное там, а добавляет новые находки 2026-10-01 и порядок работ.

---

## 0. Итог аудита 2026-10-01

| ID | Приоритет | Проблема | Доказательство | Статус проверки |
|---|---|---|---|---|
| BUG-EMPTY | P0 | В пустом чате «Сообщений пока нет» зеркально по горизонтали | RN 0.86 Android: `verticallyInverted = {transform:[{scale:-1}]}` (`node_modules/@react-native/virtualized-lists/Lists/VirtualizedList.js:2038`); `ChatEmptyState` компенсирует только `scaleY:-1` (`src/screens/chat/NativeChatThreadScreen.tsx:219,1287`) → итог `scaleX:-1`. Тест `NativeChatScreens.test.tsx:705` фиксирует iOS-вариант (jest = iOS) | Подтверждено кодом и скриншотом |
| BUG-GALLERY | P0 | Панель вложений: бесконечный спиннер, пока не нажать «Галерея» | `src/components/chat/ChatAttachmentPanel.tsx:145-187`: `requestPermissionsAsync` без `catch`/таймаута; спиннер при `permissionState==='pending'` (строка 363); нет «Повторить»; нет перепроверки при возврате в приложение | По коду; точная ветка (hang vs reject) — logcat |
| BUG-SHEET | P1 | Панели эмодзи/стикеров/опроса «висят» посередине экрана | Исправлено DEV-SHEET-2..4 (PARITY §20.7), APK 1.1.56–1.1.58. Скриншот (тёмная тема) по вёрстке соответствует старой Modal-версии ≤1.1.55. Остались на `Modal` и с `TextInput`: `ForwardMessageSheet`, `NewChatSheet`, `ChatGroupEditSheets`, `ChatFolderManagerSheet`, `ChatAttachmentDraftSheet`, `ChatImageEditorSheet` | Нужна device-проверка 1.1.58+ |
| BUG-LIST | P0 | Сообщение-список («1. текст», «- текст») рисуется в пузыре шириной в 2–4 буквы, текст ломается по слогам | `src/components/chat/ChatMarkdownBody.tsx:178-179`: `listItem {flexDirection:'row'}` + `listText {flex:1}`. `flex:1` = `flexBasis:0`, а пузырь сжимается по содержимому (`ChatBubble.tsx:930` `maxWidth:'88%'` + `alignSelf`) → собственная ширина строки = только маркер → пузырь схлопывается. Парсер `chatMarkdown.ts:229` считает списком даже одну строку «1. …» | Подтверждено кодом и скриншотом 2026-10-01 |
| PERF-SEND | P1 | Отправка медленная | Пузырь появляется сразу; уход на сервер ждёт 3 записи + 1 чтение всего blob очереди в SecureStore (Keystore-шифрование) — S1a выполнен, бюджет только тестовый. Очередь `enqueueNativeChatStorage` общая с автосохранением черновиков → запись черновика задерживает отправку. Baseline B2 (PARITY §3) **ни разу не снят** | Гипотеза по коду, нужен замер |
| PERF-OPEN | P1 | Медленное открытие чата | `src/screens/chat/useThreadHistory.ts:150-217`: последовательно расшифровка снимка → `outbox.read()` → `outbox.readUploads()` → только потом сетевой `getMessagesPage(limit 80)`. Лента — `FlatList` (`removeClippedSubviews={false}`, `extraData` с `selectedMessageIds.join`) | Гипотеза по коду, нужен замер |
| AI-TAB | P1 | Уведомления ИИ-агентов не попадают в раздел «ИИ» | Раздел есть (`src/chat/chatAiWorkspace.ts`, `NativeChatInboxScreen.tsx:72` — всегда стартует с `'chats'`). Backend: `"ai": "chat_direct"` (`WEB-itinvent/backend/services/notification_preferences_service.py:13`) — ИИ в канале «Личные». Push/центр уведомлений ведут на `/chat?conversation=…` (`src/notifications/notificationNavigation.ts:24`, `notificationCenter.ts:45`) без признака раздела | Подтверждено кодом |
| PARITY | P2 | «Полная копия Telegram» | Must-пробелов нет (PARITY §9 FA). Остаток should/could — см. Фаза 5 | Нужна сверка дельты |
| INFRA | P0 | Нельзя проверять приложение на сервере | Сервер — VM VMware (2 vCPU, 51 ГБ RAM, 109 ГБ свободно), `VMMonitorModeExtensions=False`, `SLAT=False` → Android Emulator не запустится. Есть `adb` (`tools/android-platform-tools-37.0.1`), `tools/android-sdk`, локальная сборка APK, `dist/hubit-mobile-emulator-x86_64.apk` | Подтверждено |

Противоречие с ранее принятым решением: **D2 = «нет»** (PARITY §1, 25.09 — остаёмся в SecureStore). Перенос очереди из SecureStore в этом плане **не делается**, пока пользователь не переоткроет D2 по данным замера (gate D2-R).

---

## 1. Decision Gates (решения пользователя)

| ID | Вопрос | Варианты | Рекомендация | Статус | Блокирует |
|---|---|---|---|---|---|
| D7 | Как проверять на устройстве | (а) тестовый Android-телефон по Wi-Fi ADB; (б) вложенная виртуализация VMware + эмулятор; (в) оба | (в): (а) сразу, (б) — заявка админу VMware | РЕШЕНО 01.10 пользователем: **(б) только эмулятор** — INF-1 снят; до включения вложенной виртуализации device-задачи DEFERRED(device) | Фаза 0, все device-приёмки |
| D8 | `expo-dev-client` для hot reload на телефоне | да / нет | да (новая dev-зависимость, без влияния на release) | РЕШЕНО 01.10: **да** | INF-3 |
| D9 | Отдельный push-канал `chat_ai` (backend-контракт настроек + Android-канал) | да / нет (остаётся `chat_direct`) | да | РЕШЕНО 01.10: **да** | AI-2 |
| D2-R | Переоткрыть D2 (очередь из SecureStore в файлы) | переоткрыть / оставить | решать **после** PERF-0: если p95 записи SecureStore > 50 мс или `tap_send→server_ack` p95 > 800 мс в онлайне из-за хранилища | ОТКРЫТ, ждёт данных | PERF-SEND-3 |
| D10 | FlashList для ленты (PARITY N2) | да / нет | решать после PERF-0 | ОТКРЫТ, ждёт данных | PERF-OPEN-3 |
| D11 | Скачать scrcpy (портативный ZIP, GitHub Genymobile/scrcpy) в `tools/` | да / нет | да | РЕШЕНО 01.10: **да** (работает и с эмулятором) | INF-2 |

Задачу с незакрытым gate не выполнять: пометить `BLOCKED(Dx)` и идти дальше (PARITY §0 п.12).

---

## 2. Организация работы: координатор + субагенты (обязательно)

### 2.1 Роли

- **Пользователь** — принимает gate-решения, даёт разрешения на загрузки, публикацию APK, backend-рестарты.
- **Проверяющий (Claude в основной сессии)** — ставит задачу координатору, принимает результат, сам код не правит.
- **Координатор** — один агент-исполнитель, которому передаётся промпт из §11. Сам код **не пишет**: декомпозирует, запускает субагентов через `Agent`, сводит результаты, гоняет проверки, ведёт журнал §8.
- **Субагенты** — исполнители одной задачи из этого плана. Типы:
  - `Explore` — read-only поиск и сверка (аудит дельты, поиск потребителей, сверка контрактов);
  - `general-purpose` — реализация одной задачи + её тесты;
  - `Plan` — только для задач с backend-контрактом (AI-2) — дизайн до кода.

### 2.2 Правила запуска субагентов

1. Одна задача плана = один субагент. Промпт по шаблону §2.4, самодостаточный (субагент не видит этот разговор).
2. **Непересекающиеся файлы.** Параллельно запускаются только задачи из одной волны §3 — они не имеют общих файлов. Если задаче нужен чужой файл — она переносится в следующую волну.
3. **Без `isolation: "worktree"`.** Дерево грязное (на 2026-10-01 в `mobile-hub/` 62 незакоммиченных файла), а worktree создаётся от HEAD — субагент работал бы на устаревшем коде. Субагенты работают в основном дереве; параллельность безопасна только за счёт непересекающихся файлов §3. Перед запуском волны координатор фиксирует `git diff --stat` по файлам волны, после — сверяет, что каждый субагент менял только свои файлы. Откат неудачной правки — точечно по своим файлам, без `git reset --hard`/`checkout --`, не трогая чужие изменения.
4. Субагенту запрещено: коммитить, пушить, создавать ветки, менять `.env`, публиковать APK, перезапускать PM2/IIS, добавлять npm-зависимости без закрытого gate, трогать файлы вне своего списка.
5. Каждый субагент возвращает отчёт по шаблону PARITY §10: что сделано, изменённые файлы, команды проверки и фактический вывод, что не проверено.
6. **Координатор проверяет каждый результат сам**: читает diff, перезапускает указанные тесты, сверяет с критериями приёмки. При замечаниях — `SendMessage` тому же субагенту с конкретными пунктами (не новый агент). Максимум 3 итерации, дальше — эскалация проверяющему.
7. После волны: `npm run lint` и `npm run test:ci` из `mobile-hub/` в основном дереве. Красный набор — волна не закрыта.
8. Device-приёмку (Фаза 0 готова) координатор выполняет сам через `adb`; субагентам доступ к устройству не давать (одно устройство — один владелец).

### 2.3 Команды проверки

```powershell
# из mobile-hub/
npm run lint
npx jest <путь>
npm run test:ci
# backend (из корня), только для AI-2; перед запуском проверить fixtures — не ходить в production БД
pytest -q tests/test_<area>_<feature>.py
```

### 2.4 Шаблон промпта субагента

```
Ты — исполнитель задачи <ID> из documentation/technical/MOBILE_CHAT_PLAN_2026-10-01.md (раздел <N>).
Прочитай: AGENTS.md, mobile-hub/README.md, раздел задачи <ID> целиком, PARITY §0.
Разрешено менять ТОЛЬКО: <список файлов>. Нужен другой файл — остановись и сообщи.
Порядок: тест, воспроизводящий проблему → исправление → тест зелёный → <команды проверки>.
Запрещено: коммиты/ветки, новые зависимости, .env, production, APK-публикация, рестарты, попутный рефакторинг.
Сохрани инварианты: <из задачи>.
Верни отчёт: что сделано; diff-файлы; команды и их фактический вывод; что не проверено и почему.
```

---

## 3. Волны и владение файлами

| Волна | Задачи (параллельно) | Владение файлами | Зависит от |
|---|---|---|---|
| W0 | INF-1, INF-2, INF-3 — координатор сам, не субагенты | `tools/`, `mobile-hub/package.json` (только INF-3) | D7, D8, D11 |
| W1 | BUG-EMPTY · BUG-LIST · BUG-GALLERY · AUDIT-PARITY (`Explore`) · AUDIT-AI-NOTIF (`Explore`) | BUG-EMPTY: `NativeChatThreadScreen.tsx` (только `ChatEmptyState`/стиль), `NativeChatScreens.test.tsx`. BUG-LIST: `ChatMarkdownBody.tsx` + его тест. BUG-GALLERY: `ChatAttachmentPanel.tsx`, `chatAttachmentPanel.ts`, `*.test.ts` рядом. Аудиты — read-only | — |
| W2 | PERF-0 (координатор на устройстве) | — | W0, W1 |
| W3 | PERF-OPEN-1 · PERF-SEND-1 · BUG-SHEET-2 (до 2 шитов на субагента) | PERF-OPEN-1: `useThreadHistory.ts` + тест. PERF-SEND-1: `nativeChatStorageQueue.ts`, `useNativeChatDraftAutosave.ts`, `chatDrafts.ts` + тесты. BUG-SHEET-2: `ForwardMessageSheet.tsx`, `NewChatSheet.tsx`, затем `ChatGroupEditSheets.tsx`, `ChatFolderManagerSheet.tsx` + `ChatThreadOverlays.tsx`/`useThreadSheets.ts`/`useThreadBack.ts` — **последний набор только одному субагенту** | PERF-0 |
| W4 | AI-1 · AI-3 · AI-4 · PERF-OPEN-2 | AI-1: `notificationNavigation.ts`, `notificationCenter.ts`, `app/(shell)/chat/index.tsx`. AI-3/AI-4: `NativeChatInboxScreen.tsx`, `chatAiWorkspace.ts`, `src/chat/chatActiveFolder.ts` — **AI-3 и AI-4 одному субагенту**. PERF-OPEN-2: `useThreadRender.tsx`, `NativeChatThreadScreen.tsx` (только `FlatList`-пропсы) — запускать **после** влития BUG-EMPTY | W1 |
| W5 | AI-2 (`Plan` → `general-purpose`) | backend `notification_preferences_service.py`, push-сервис, тесты; mobile `nativePush.ts`, `NativeNotificationsSettingsScreen.tsx`; web-настройки уведомлений — только если там перечислены каналы | D9 |
| W6 | PERF-SEND-3 / PERF-OPEN-3 | по результату gate | D2-R, D10 |
| W7 | F-задачи паритета, по одной на субагента | по задаче | AUDIT-PARITY + выбор пользователя |

---

## 4. Фаза 0 — Инфраструктура проверки на устройстве

### INF-1. Тестовое устройство по Wi-Fi ADB (D7-а)
- Пользователь: на телефоне «Для разработчиков» → «Отладка по Wi-Fi» → «Подключить по коду»; телефон должен видеть сервер `10.103.0.217` (офисный Wi-Fi или VPN).
- Координатор: `adb pair <ip>:<port>` → `adb connect <ip>:<port>` (portable `tools/android-platform-tools-37.0.1`, ≥37.0.1 обязательно на Windows Server — см. `mobile-hub/README.md`).
- Приёмка: `adb devices` показывает устройство; `adb exec-out screencap -p` даёт PNG; `adb logcat -d` читается.
- Не делать: сохранять serial/IP/SSID в репозитории и отчётах (как в `device-smoke.ps1`).

### INF-2. scrcpy (D11)
- Скачать портативный релиз с официального GitHub `Genymobile/scrcpy` в `tools/scrcpy-<версия>/`, проверить SHA-256 с релизной страницы. Сообщить пользователю имя файла, источник и размер **до** скачивания.
- Приёмка: окно с экраном телефона на сервере.

### INF-3. Dev client (D8)
- Добавить `expo-dev-client` версии под SDK 57 (опубликована ≥7 дней, без `latest`/`*`), собрать `npm run build:apk:local:debug` один раз, Metro — `npx expo start --dev-client --lan`.
- Не влияет на preview/release-сборку (проверить, что `build-apk.ps1 -Variant preview` не включает dev-launcher).
- Приёмка: правка JS на сервере видна на телефоне без пересборки.

### INF-4. Эмулятор (D7-б) — заявка, не исполнение
- Подготовить для пользователя текст заявки админу VMware: при выключенной VM включить «Expose hardware assisted virtualization to the guest OS», vCPU ≥ 6.
- После этого (отдельное разрешение, нужна перезагрузка): компонент `HypervisorPlatform`, `sdkmanager "emulator" "system-images;android-35;google_apis;x86_64"`, AVD, запуск `-no-window`. Уже есть `dist/hubit-mobile-emulator-x86_64.apk`.

---

## 5. Фаза 1 — Баги

### BUG-EMPTY. Зеркальный текст в пустом чате
- Сделать: компенсирующий transform по платформе — Android `{ scale: -1 }`, iOS `{ scaleY: -1 }` (как в `VirtualizedList`). Не опираться на `cloneElement`-стиль `VirtualizedList`: `ChatEmptyState` не принимает `style`.
- Тест: в `NativeChatScreens.test.tsx:705` проверить обе платформы (`Platform.OS` мок `android` и `ios`); итоговая композиция с инверсией списка = тождество.
- Приёмка на устройстве: «Сообщений пока нет» и «Переписка не сохранена на устройстве» читаются нормально, внизу над композером.

### BUG-LIST. Узкий пузырь у сообщений-списков
- Сделать в `ChatMarkdownBody.tsx`: у текста пункта `flex: 1` → `flexShrink: 1` (основа `auto`: текст сам задаёт ширину пузыря и переносится только по `maxWidth` пузыря); у маркера — `flexShrink: 0`. Проверить таблицы и код-блоки (`maxWidth:'100%'` внутри сжимаемого пузыря) на тот же класс ошибки.
- Проверить мету (время/статус) у markdown-тела: не налезает на последний пункт.
- Не менять правила парсера `chatMarkdown.ts`: одиночное «1. …» остаётся списком; смена парсинга — только по отдельному решению пользователя.
- Тесты: рендер-тест `ChatMarkdownBody` — у текста пункта нет `flex:1`/`flexBasis:0`, у маркера `flexShrink:0`; упорядоченный и маркированный список; короткий и длинный пункт.
- Device-приёмка: «1. Я устал обновляться…» — пузырь по ширине текста (до 88%), перенос по словам; то же для «- пункт», списка из 3 пунктов, своего и чужого сообщения.

### BUG-GALLERY. Бесконечный спиннер в панели вложений
- Сделать в `ChatAttachmentPanel.tsx`:
  1. При открытии сначала `getPermissionsAsync` (без диалога). Есть доступ (`granted` или `limited`) — грузить сетку.
  2. Нет доступа и `canAskAgain` — показать плашку «Разрешить доступ к фото» с кнопкой; запрос — только по нажатию.
  3. `requestPermissionsAsync`/`loadAssets`/`Album.getAll` в `try/catch`; таймаут ожидания 8 с → состояние `error` с кнопкой «Повторить».
  4. `AppState` → `active` при открытой панели: перепроверить разрешение и перезагрузить первую страницу.
  5. `loadingRef`-гард не должен оставлять пустую сетку при повторном открытии во время прошлой загрузки (дождаться или перезапустить).
  6. Нижний ряд действий (Галерея, Файл, Гео, Контакт, Опрос, Задача) доступен в любом состоянии сетки.
- Не менять: формат `PanelMediaAsset`, pipeline отправки, D6-разрешения в манифесте.
- Тесты: hang (промис не резолвится) → через таймаут «Повторить»; reject → ошибка, не спиннер; denied/canAskAgain=false → «Открыть настройки»; возврат из фона после выдачи разрешения → сетка.
- Device-приёмка: свежая установка, отказ, «только выбранные фото», выдача в настройках и возврат.
- Логи: на устройстве с проблемой снять `adb logcat` в момент спиннера (ExpoMediaLibrary, PermissionsService) и приложить к отчёту.

### BUG-SHEET-1. Подтверждение исправления «висящих» панелей (координатор, device)
- Выяснить версию у пользователей со скриншотом: «Меню → О приложении» или `adb shell dumpsys package ru.zsgp.hubit.mobile | findstr versionName`.
- На 1.1.58+ пройти чек-лист PARITY §20.7 (DEV-SHEET-2..4): эмодзи / стикеры / GIF / опрос / задача — у нижнего края, поля внутри над клавиатурой, переключение панелей, Android Back, фокус композера закрывает панель.
- Если на 1.1.58 воспроизводится — новая задача DEV-SHEET-5 с logcat и скриншотом; гипотезы не чинить вслепую.

### BUG-SHEET-2. Остальные шторки с полем ввода на `Modal`
- Кандидаты: `ForwardMessageSheet`, `NewChatSheet` (поиск), `ChatGroupEditSheets`, `ChatFolderManagerSheet`.
- Сначала device-проверка каждой (координатор): открыть, сфокусировать поле, закрыть клавиатуру. Переводить на `ChatInlineSheet` только воспроизведённые; PARITY §20 п.5 запрещает менять keyboard-механику Modal-шитов без проверки на устройстве.
- `ChatImageEditorSheet`/`ChatAttachmentDraftSheet` — полноэкранные, вне объёма, если не воспроизводится.
- Приёмка: шторка у нижнего края при открытой и закрытой клавиатуре; Back закрывает шторку, не экран; drag-to-dismiss работает.

---

## 6. Фаза 2 — Скорость

### PERF-0. Baseline на устройстве (выполняет PARITY B2)
- Координатор на тестовом устройстве, одна и та же сеть, release-like preview APK (не dev client — он медленнее):
  - 20 отправок текста в онлайне: `getChatSendTimingSummary()` (`src/diagnostics/chatSendTiming.ts`) — p50/p95 этапов `tap_send → bubble_visible → outbox_persisted → … → ack`, и p50/p95 `read`/`write` SecureStore с байтами.
  - 10 открытий чата: холодно (нет снимка) и тепло (есть снимок), от нажатия на строку до первого кадра с сообщениями; источник времени — временные `markChatSend`-подобные метки, подключённые через существующий диагностический модуль, или `adb logcat` с `console.log` в dev-only ветке (не оставлять в коде после замера).
  - Объём очереди и снимков: размер blob outbox, размер снимка `chat-thread-details` для 1 диалога.
  - Серверная часть: время ответа `GET messages?limit=80` и `POST messages` из IIS-логов или `adb logcat` (read-only).
- Результат — таблица в §8 «Baseline». Без неё оптимизации PERF-* не принимаются по скорости, только по тестам.
- По итогам пользователь решает D2-R и D10.

### PERF-OPEN-1. Сеть параллельно с локальным чтением
- В `useThreadHistory.loadInitial` стартовать `getMessagesPage`/`getThreadBootstrap` и `getConversation` **до** `await readNativeEntitySnapshot`; `outbox.read()` и `readUploads()` — через `Promise.all`.
- Сохранить: проверки `isCurrentLoad()` после каждого `await`, порядок merge «кеш → очередь → сеть», `offlineMode` не делает сетевых вызовов, отмену при смене диалога.
- Тест: моки с задержками — сетевой запрос вызван до резолва снимка; ответ сети раньше снимка не затирается снимком; offline — 0 сетевых вызовов.
- Приёмка: холодное открытие p50 сокращается на время чтения снимка+очереди (по PERF-0).

### PERF-OPEN-2. Лишние перерисовки ленты
- `extraData`: вместо `selectedMessageIds.join('\0')` — стабильная ревизия выбора; строки получают «выбран ли» через мемо-селектор (R2 PARITY уже мемоизировал рендер — проверить, что `extraData` не обнуляет мемоизацию).
- Проверить `initialNumToRender`/`windowSize` по PERF-0 на 500+ сообщениях.
- Тест: профилирующий тест по образцу `NativeChatTypingPerformance.test.tsx` — смена выбора одного сообщения перерисовывает ≤ 2 строки.

### PERF-OPEN-3. FlashList — только при D10 = да
- Задача PARITY N2 с её приёмкой (инверсия, `maintainVisibleContentPosition`, якоря, `scrollToIndex`).

### PERF-SEND-1. Черновик не задерживает отправку
- Сейчас автосохранение черновика и записи outbox делят `enqueueNativeChatStorage`. Сделать приоритет: операции outbox вставляются перед ещё не начатыми операциями черновика; запись черновика при активной отправке в том же диалоге откладывается (coalesce, последняя версия).
- Сохранить инвариант «Draft/outbox commits and their file-reference checks share one ordering» для файловых ссылок (`deleteUnreferencedChatFiles`): ссылки черновика, не прошедшие запись, не должны удаляться.
- Тест: отправка при «длинной» записи черновика начинает запись outbox, не дожидаясь черновика; удаление файлов не трогает файлы ожидающего черновика.

### PERF-SEND-2. Путь подтверждения
- По данным PERF-0 проверить `persistConfirmed` (PARITY S6) и `acknowledge` при открытии: не блокируют ли они следующую отправку той же очереди.
- Только измерение и отчёт; правка — отдельной задачей, если найдено.

### PERF-SEND-3. Только при D2-R = переоткрыть
- Выполнять задачу PARITY S1b (файловое хранилище, миграция, logout) без изменений её приёмки.

---

## 7. Фаза 3 — Раздел «ИИ» и его уведомления

### AUDIT-AI-NOTIF (`Explore`, read-only)
- Найти все пути, где ИИ-диалог порождает уведомление: push (`backend/chat/push_outbox_service.py`, `push_service.py`, `ai_chat/service.py` deferred notifications), центр уведомлений (`mobile-hub/src/notifications/notificationCenter.ts`), in-app баннеры/звук, бейдж нижней навигации (`useNavUnreadCounts`, `getNavigationBadgeCount`), счётчики папок (`chatFolders.ts`, backend `folder_unread.py` уже считает `ai`).
- Результат: таблица «источник → куда сейчас ведёт → куда должен» для AI-1..AI-4.

### AI-1. Переход из уведомления ИИ в раздел «ИИ»
- Маршрут `/chat?conversation=<id>&workspace=ai` для `kind === 'ai'`: формировать на клиенте по `conversation_kind` из payload (если есть) или по кешу инбокса; backend payload не менять в этой задаче.
- `app/(shell)/chat/index.tsx` / инбокс: принять `workspace=ai` → открыть раздел «ИИ», затем диалог; Back из диалога возвращает в «ИИ», не в «Чаты».
- Тест: навигация из push и из центра уведомлений для ai и direct.

### AI-2. Отдельный канал уведомлений ИИ (D9)
- Backend: `CHAT_NOTIFICATION_CHANNELS["ai"] = "chat_ai"`, дефолт `chat_ai: True` в `NotificationPreferencesService.DEFAULTS`, миграция настроек не нужна (дефолт). Добавить `conversation_kind` в push-payload чата, если его нет.
- Обратная совместимость: старые клиенты без `chat_ai` продолжают получать ИИ-уведомления (канал по умолчанию включён; Android-канал fallback).
- Mobile: Android-канал `HUBIT_NOTIFICATION_CHANNELS.chatAi` в `nativePush.ts`, переключатель «ИИ-агенты» в `NativeNotificationsSettingsScreen.tsx`. Web-настройки — только если там перечислены chat-каналы.
- Тесты: pytest на резолв канала и настройку; jest на список каналов и переключатель.
- Deployment backend — отдельное разрешение пользователя (`restart-chat.ps1`/`restart-backend.ps1` с учётом побочного `restart-scan.ps1`).

### AI-3. Счётчик и бейдж раздела «ИИ»
- Непрочитанные ИИ — только на переключателе «ИИ» (`countAiUnread`); в папках «Личные»/«Все» не учитываются (сверить с backend `folder_unread.py` и web `chatFolderUtils.js`, правило U1).
- Бейдж «Чат» в нижней навигации — РЕШЕНО 01.10: **сумма чатов + ИИ** (как Telegram для ботов), внутри раздельно «Чаты»/«ИИ». Бейдж берётся из серверного `chat_messages_unread_total` (`src/navigation/useNavUnreadCounts.ts`, `mobileNavItems.ts:156`): проверить по AUDIT-AI-NOTIF, входят ли туда ИИ-диалоги; если нет — правка backend-снимка непрочитанных в задаче AI-2 (backend), mobile только отображает.
- Тест: ИИ-непрочитанные не попадают в `personal`, видны на «ИИ».

### AI-4. Запоминать последний раздел
- Хранить выбранный раздел (`chats`/`ai`) per-user рядом с `chatActiveFolder.ts` (тот же паттерн хранения). Push/ссылка с `workspace` имеет приоритет.
- Тест: перезапуск экрана восстанавливает раздел; смена пользователя сбрасывает.

---

## 8. Журнал и Baseline (заполняет координатор)

| ID | Статус | Субагент / тип | Итерации | Проверки (факт) | Примечания |
|---|---|---|---|---|---|
| INF-1 | CLOSED | — | | | D7 = только эмулятор |
| INF-2 | DONE | координатор | 1 | `scrcpy --version` → scrcpy 4.1 (SDL 3.4.12, libavcodec 62) | D11 = да. `tools/scrcpy-4.1/scrcpy-win64-v4.1/`; SHA-256 `5b12172b…65db` сверен с GitHub API digest — совпал |
| INF-3 | DONE (install) | координатор | 1 | `npx expo install expo-dev-client` → `~57.0.19` в package.json + lock; dev-launcher activity только в `android/src/debug` source-set | D8 = да; 57.0.19 публ. 2026-09-11 (≥7 дн.); preview/release-сборка dev-launcher не включает; APK не собирался — ждёт INF-4 |
| INF-4 | DEFERRED | пользователь → координатор | | | заявка админу VMware (nested virt, vCPU≥6) |
| BUG-EMPTY | DONE (тесты) | general-purpose | 1 | jest NativeChatScreens 122/122 (it.each ios+android); lint чист | device-приёмка DEFERRED(device) — эмулятора нет |
| BUG-GALLERY | DONE (тесты) | general-purpose | 1 | jest ChatAttachmentPanel.test.tsx (новый) + chatAttachmentPanel.test.ts — 15/15; lint чист | п.1–6 плана; device-приёмка DEFERRED(device) |
| BUG-LIST | DONE (тесты) | general-purpose | 1 | jest ChatMarkdownBody.test.tsx (новый) 3/3; src/components/chat 156/156; lint по файлам задачи чист | `listText flex:1→flexShrink:1`, маркер `flexShrink:0`; таблицы/код-блоки без того же дефекта (ScrollView+maxWidth:100%); мета не налезает (hasTrailingBlock→metaRow). Device-приёмка DEFERRED(device) |
| BUG-SHEET-1 | DEFERRED(device) | координатор | — | — | |
| BUG-SHEET-2 | DEFERRED(device) | — | — | — | PARITY §20 п.5: только после device-воспроизведения |
| PERF-0 | DEFERRED(device) | координатор | — | — | эмулятора нет (INF-4) |
| PERF-OPEN-1 | DONE (тесты) | general-purpose | 1 | jest useThreadHistory.test.tsx (новый) 5/5; src/screens/chat 162/162; lint чист | сеть до снимка; Promise.all outbox; isCurrentLoad/offline/отмена сохранены. Приёмка скорости — после PERF-0 |
| PERF-OPEN-2 | DONE (тесты) | general-purpose | 1 | jest NativeChatSelectionPerformance.test.tsx (новый): смена выбора ≤2 строки; src/screens/chat 175/175; lint чист | extraData без join/highlight; per-row store (useSyncExternalStore); initialNumToRender/windowSize не тронуты |
| PERF-OPEN-3 | BLOCKED(D10) | | | | |
| PERF-SEND-1 | DONE (тесты) | general-purpose | 1 | jest nativeChatStorageQueue.test.ts (новый) + outbox/runner/draftFiles/drafts/autosave — 6 сьютов 88/88 | линии очереди + coalesce черновика + pin файлов ожидающего черновика; приёмка скорости — после PERF-0 |
| PERF-SEND-2 | TODO | | | | измерение, ждёт PERF-0 |
| PERF-SEND-3 | BLOCKED(D2-R) | | | | |
| AUDIT-AI-NOTIF | DONE | Explore | 1 | read-only отчёт: таблица источник→сейчас→должен | `conversation_kind` УЖЕ в push-payload; ИИ УЖЕ в `chat_messages_unread_total`; списки каналов backend/mobile/web — передано в AI-1/2/3 |
| AI-1 | DONE (тесты) | general-purpose | 2 | jest сьютов волны B 13/13 (111/111); доработка cold-start: systemIntent/moduleRegistry/postAuthDestination 71/71; lint чист | `workspace=ai` из `conversation_kind` (push) и кэша инбокса (центр); Back→«ИИ»; cold-start по push и deep-link сохраняет workspace (точечные хунки в systemIntent.ts/moduleRegistry.ts, чужие правки не тронуты). Device-приёмка DEFERRED(device) |
| AI-2 | DONE (тесты) | Plan→general-purpose | 1 | pytest 42/42 (изолированная SQLite); jest 17/17; vitest 21/21; lint чист | `chat_ai` pref (дефолт True, JSON-миграции нет) + FCM `channelId=hubit_chat_ai` для kind=ai; web-push остаётся `channel=chat`; старые APK → fallback-канал expo-notifications (не теряются); тумблер «ИИ-агенты» в mobile и web настройках. Рестарт chat/backend — НЕ выполнялся, команда отдана пользователю |
| AI-3 | DONE (тесты) | general-purpose (с AI-4) | 1 | jest затронутых сьютов 49/49; U1 сверено с backend/web | ИИ уже не в «Личных» (chatFolders.ts:88) и уже в сумме бейджа «Чат» — поведение зафиксировано тестами, код счётчиков не менялся |
| AI-4 | DONE (тесты) | general-purpose (с AI-3) | 1 | jest chatActiveWorkspace.test.ts + NativeChatInboxWorkspace.test.tsx | новый `chatActiveWorkspace.ts` (паттерн chatActiveFolder, per-user); проп `requestedWorkspace` в NativeChatInboxScreen; смена пользователя сбрасывает |
| AUDIT-PARITY | TODO | Explore | | | не начинать в этом запуске |

### Baseline (PERF-0)

| Метрика | Условия | p50 | p95 | n | Дата/APK |
|---|---|---|---|---|---|
| tap_send → bubble_visible | онлайн, текст | | | | |
| tap_send → outbox_persisted | | | | | |
| tap_send → server ack | | | | | |
| SecureStore write (байты) | | | | | |
| SecureStore read | | | | | |
| Открытие чата, холодно | без снимка | | | | |
| Открытие чата, тепло | со снимком | | | | |
| GET messages limit=80 (сервер) | | | | | |

---

## 9. Фаза 5 — Паритет с Telegram

### AUDIT-PARITY (`Explore`, read-only)
- Обновить таблицу PARITY §9 FA по текущему коду: что из should/could уже сделано (F-JUMPBACK, F-INBOX-SWIPE, F-TYPING-INBOX, F-DRAFT-INBOX — PARITY §20.4; F-GEO/F-CONTACT/F-POLL — §20.1).
- Остаток-кандидаты: @-упоминания с переходом и счётчиком; реакции «кто поставил»; мьют с таймером (`muted_until` + Alembic); multi-choice опросы; выбор точки на карте; копирование части текста; ответ на фото в альбоме; пересылка без автора; отложенные и «тихие» сообщения; «Избранное»; видеокружки; история правок.
- Плюс UX-паритет, который видно только на устройстве (после Фазы 0): время открытия, анимации входа/выхода, свайп назад, плавность клавиатуры, контекстное меню. Координатор снимает видео/скриншоты через scrcpy/adb и сравнивает с Telegram на том же телефоне.
- Результат: приоритизированный список F-задач на согласование пользователю. **Без выбора пользователя F-задачи не запускать** (D4: звонки и секретные чаты исключены).

### F-* (W7)
- Каждая — отдельный субагент, разделы как у S-задач PARITY; backend через router → service → store, Alembic, проверка runtime-схемы `chat`/`public` (AGENTS.md).

---

## 10. Definition of Done

- Все задачи W1–W4 в статусе DONE с отчётами; `npm run lint` и `npm run test:ci` зелёные в основном дереве.
- Device-приёмка BUG-EMPTY, BUG-GALLERY, BUG-SHEET-1/2, AI-1, AI-4 пройдена на тестовом устройстве, скриншоты (без персональных данных) приложены.
- Baseline PERF-0 заполнен, повторный замер после PERF-OPEN-1/PERF-SEND-1 в тех же условиях; сравнение p50/p95, n ≥ 20, оговорка про один девайс.
- Новый preview APK собран локально; **публикация в feed и backend-рестарт — только по отдельному разрешению пользователя** (`MOBILE_HUB_APK_DISTRIBUTION.md`).

---

## 11. Промпт для агента-координатора

```
Ты — агент-координатор мобильного чата HUB-IT. Рабочий план:
documentation/technical/MOBILE_CHAT_PLAN_2026-10-01.md (далее ПЛАН); базовый — MOBILE_CHAT_TELEGRAM_PARITY_PLAN.md (PARITY).
Отвечай по-русски. Соблюдай AGENTS.md, PARITY §0 и ПЛАН §2.

Твоя роль — координация, не написание кода:
1. Прочитай ПЛАН целиком, PARITY §0, §1, §10, §12, §20.7.
2. Проверь gate-решения ПЛАН §1. Задачи с открытым gate — BLOCKED, не выполнять.
3. Иди по волнам ПЛАН §3. В каждой волне запускай по одному субагенту на задачу (инструмент Agent),
   параллельно — только задачи одной волны, в основном дереве (без worktree — ПЛАН §2.2 п.3), промпт по шаблону ПЛАН §2.4
   с точным списком файлов из §3. Read-only аудиты — subagent_type "Explore"; реализация — "general-purpose";
   AI-2 — сначала "Plan", затем "general-purpose".
4. Задачи Фазы 0, PERF-0, BUG-SHEET-1 и все device-проверки выполняй сам через adb; субагентам устройство не давай.
5. Каждый результат субагента проверяй сам: diff, повтор его тестов, критерии приёмки. Замечания — SendMessage
   тому же субагенту, до 3 итераций, затем эскалация проверяющему.
6. Дерево грязное: до волны зафиксируй git diff --stat по её файлам, после — проверь, что субагенты
   меняли только свои файлы; чужие изменения не трогать, без git reset --hard / checkout --, без коммитов и веток.
7. После волны: npm run lint и npm run test:ci из mobile-hub/. Красное — волна не закрыта.
8. Веди журнал ПЛАН §8 и Baseline. Не утверждай, что что-то проверено, без фактического вывода.
9. Без явного разрешения пользователя: не скачивать файлы (сначала назвать файл, источник, размер), не добавлять
   зависимости, не публиковать APK, не трогать .env/production/IIS/PM2, не перезапускать процессы.
10. Остановись и отчитайся проверяющему после каждой волны: что сделано, файлы, проверки и их результат,
    что не проверено, риски, какие решения нужны от пользователя.
Начни с: проверка gate D7/D8/D11 → W0 в пределах разрешённого → W1.
```
