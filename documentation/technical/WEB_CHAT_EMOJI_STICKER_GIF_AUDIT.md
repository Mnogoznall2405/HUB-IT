# WEB_CHAT_EMOJI_STICKER_GIF_AUDIT — аудит и переработка Emoji / Sticker / GIF Picker

Дата: 2026-11-23. Ветка: `feat/chat-emoji-picker-telegram` (от `main` @ `b0225ad2`).

## 1. Архитектура существующей реализации

- **Панель** `ChatEmojiPanel` (ленивый чанк): вкладки «Эмодзи | Стикеры». Эмодзи —
  `emoji-picker-react` + локальные Apple-изображения `/emoji/apple/64/<unified>.png`
  (`lib/chat/emojiImages.js`, `Intl.Segmenter`, keycaps/flags/ZWJ/VS16).
- **Стикеры** — полный backend-контур (`api/v1/chat/stickers.py`,
  `chat/telegram_sticker_service.py`): наборы, импорт из t.me, файлы `webp`/`webm`/`tgs`
  (Lottie через fflate + lottie-web lazy), отправка
  `POST /conversations/{id}/messages/sticker` с `client_message_id`, оптимист +
  `stickerResend` в failed-реестре, deferred WS-паблиш.
- **Состояние открытия**: булев `emojiAnchorEl` в `useChatPageOverlayDialogs` →
  поповер над композером (`position:absolute`, `bottom: composerHeight+10`) на
  десктопе; инлайн-панель под композером на мобильном.
- **GIF отсутствует полностью**: ни одного эндпоинта на backend, ни UI.
  Зафиксировано как ограничение, фейковой вкладки не добавлено.

## 2. Дефекты и приоритеты

| # | Приоритет | Дефект | Причина |
|---|-----------|--------|---------|
| D1 | P1 | Нет закреплённой панели справа и hover-превью — только клик→поповер | `emojiAnchorEl` булев, нет машины режимов |
| D2 | P1 | Вставка эмодзи закрывает панель на десктопе — последовательный выбор невозможен | `setEmojiAnchorEl(null)` в `insertEmojiAtSelection` |
| D3 | P1 | Второй стикер во время отправки первого молча проглатывается | глобальный `stickerSendInFlightRef` + `sendingStickerId` блокировали все кнопки |
| D4 | P1 | `listPacks` при каждом открытии + сброс вкладки и прокрутки | панель размонтируется при закрытии, кэша нет |
| D5 | P2 | GIF-функциональности нет | нет backend-контракта; отдельное решение |
| D6 | P2 | Пустая вспышка превью при холодном открытии | `Suspense fallback={null}` + непрогретый lazy-чанк |

P0 нет: backend-контур стикеров и дедупликация по `client_message_id` уже корректны.

## 3. Что изменено

- `pages/chat/useChatPageOverlayDialogs.js` — новый `emojiPanelMode: 'popover' | 'pinned'`.
- `pages/chat/useChatComposerUiController.js` — машина состояний
  `closed → hover(preview) → pinned`: открытие превью через 260 мс, закрытие
  через 320 мс, единая hover-зона «кнопка + панель», префетч чанка панели.
  Клик: closed→pinned, preview→pinned, pinned→closed (мобильный — toggle инлайна).
- `useChatThreadSection.jsx` — `ChatEmojiDock` рядом с `ChatThread` при pinned.
- `components/chat/ChatEmojiDock.jsx` (новый) — колонка `clamp(320px,30vw,380px)`
  при viewport ≥1200px, иначе overlay `min(360px,92%)` внутри колонки треда;
  заголовок, кнопка закрытия, Esc.
- `ChatThread.jsx` — поповер только в popover-режиме, hover-зона на панели,
  спиннер-фолбэк вместо `null`.
- `ChatComposer.jsx` — hover-события на кнопке; клик всегда в контроллер
  (aria-label различает «Закрыть»/«Закрепить»).
- `useChatComposerSelection.js` — вставка эмодзи больше не закрывает панель.
- `api/chatStickers.js` — сессионный кэш `listPacks` + дедуп in-flight
  (`peek/prime/invalidate`); инвалидация по `chat-sticker-packs-changed`.
  **Итерация 2 (ревью):** кэш scoped по `userId` + `selected_database`
  (backend отдаёт наборы с учётом `current_user.id` — чужой кэш недоступен
  по чужому ключу); `stickerPacksEpoch` отбрасывает ответы запросов,
  начатых до инвалидации (гонка «запрос → инвалидация → поздний ответ»);
  `invalidateStickerPacksCache()` вызывается в `AuthContext.invalidateSession`
  (выход/смена аккаунта очищает все scope).
- `TelegramStickersTab.jsx` — инициализация из кэша без спиннера, per-sticker
  `sendingStickerIds` вместо глобального блока, персистентная позиция прокрутки.
- `useChatStickerSending.js` — per-sticker `Set` вместо глобального
  `stickerSendInFlightRef`; параллельная отправка разных стикеров.
  **Итерация 2:** весь конвейер (подготовка истории, оптимист, API) под
  `try/catch/finally` — лок снимается при любой ошибке; ключ лока
  `conversationId:stickerId` — тот же стикер в другой беседе не блокируется.
- `ChatEmojiPanel.jsx` — активная вкладка переживает переоткрытие.
- `ChatEmojiDock.jsx` — **итерация 2:** режим column/overlay по
  `ResizeObserver` на `chat-thread-pane-wrap` (фактическая ширина
  контейнера после sidebar и правой панели), порог
  `360 (док) + 470 (мин. тред) = 830px`; измерение в `useLayoutEffect` —
  без вспышки overlay на широких экранах.
- `e2e/stack/local_backend.py` — сид набора `e2e_test_pack` (3 WebP) и
  `E2E_HUB_DATA_DIR` для запусков из глубоких путей (MAX_PATH 260).

## 4. UX до / после

- До: клик → поповер; эмодзи закрывает панель; стикеры грузятся заново; второй
  стикер теряется; на узком окне поповер тот же.
- После: hover → превью-поповер без мерцания; клик → док справа как в
  Telegram Desktop; последовательная вставка эмодзи; параллельные стикеры;
  повторное открытие мгновенное (кэш); узкий экран → overlay без h-скролла.

## 5. Проверки

- `npm run test:run` — затронутые сьюты: 13 тестов (8 контроллер + 5 стикер-
  сендинг, включая новые: pin/hover/preview-таймеры, pinned не закрывается
  hover-leave, параллельная отправка разных стикеров, same-sticker дедуп).
  Плюс ранее прогнанные смежные сьюты — 14/14.
- **Итерация 2 unit:** +12 тестов — кэш: scope по пользователю, scope по
  `selected_database`, дедуп in-flight per-scope, отброшенный поздний ответ
  после инвалидации, полная очистка на logout; сендинг: ошибка подготовки
  → лок снят → повторная отправка успешна, кросс-беседный лок; док:
  геометрия column/overlay на границе 830px (3 теста).
- `npx vite build --outDir dist-test` — production build OK.
- Playwright `e2e/chat-emoji-picker.spec.js` (локальный стек, реальный backend,
  реальный браузер) — **итерация 1: 4/4**, **итерация 2: 14/14**:
  1. hover→preview→уход→закрытие; click→pinned `data-layout="column"`; re-click→close;
  2. два эмодзи подряд — док не закрывается, черновик пополняется;
  3. 988×838 → `data-layout="overlay"`, `x+width ≤ 988` (нет h-скролла);
  4. `GET /chat/sticker-packs` — ≤1 запроса на два открытия;
  5. матрица 1200/1280/1440/1920 — `data-layout` соответствует реальной
     ширине `chat-thread-pane-wrap`; в column-режиме тред ≥ 470px;
  6. Escape: фокус в композере после вставки → dock закрывается; фокус в
     поиске эмодзи → закрывается док, не тред; открытое MUI-меню → док
     не закрывается (приоритет `hasChatBlockingOverlay`);
  7. **реальная доставка A→B** (e2e_admin ↔ e2e_user): WS-получение,
     два разных стикера подряд, двойной клик без дубликата, уникальность
     `client_message_id` (проверено через API), persistence после reload,
     abort → failed-пузырь «Не отправлено» → retry из меню пузыря
     (`chat-message-failed-action` → `chat-message-failed-retry`, тот же
     `client_message_id`) доставлен получателю; задержанный запрос в чате A
     не блокирует тот же стикер в чате B (лок `conversationId:stickerId`);
  8. тёмная тема — pinned column и overlay (скриншоты обеих тем).
- Скриншоты: `frontend/e2e-artifacts/emoji-picker/` — `emoji-hover-preview.png`,
  `emoji-dock-column.png`, `emoji-dock-overlay-narrow.png`,
  `emoji-dock-column-dark.png`, `emoji-dock-overlay-dark.png` +
  `perf-metrics.json`.

## 6. Производительность

Измерения E2E на локальном стеке (vite dev, 1440×900, итерация 2,
`e2e-artifacts/emoji-picker/perf-metrics.json`):

| Метрика | Значение |
|---------|----------|
| Холодное открытие до видимого дока | 171–208 мс |
| Холодное открытие до полезного контента (эмодзи) | 656–809 мс |
| Тёплое открытие до полезного контента | 336–375 мс |
| Вкладка → «Стикеры» | 111–132 мс |
| Вкладка → «Эмодзи» | 388–494 мс |
| API-запросов при холодном открытии | 1–2 |
| `GET /chat/sticker-packs` при тёплом открытии | 0–1 (кэш scope) |

- `GET /chat/sticker-packs`: до — запрос на каждое открытие; после — ≤1 за
  сессию на scope (пользователь+БД). Первый запрос дедуплицируется.
- Холодное открытие превью: чанк панели префетчится на наведении (до конца
  260 мс задержки чаще всего уже загружен); `Suspense` показывает спиннер
  вместо пустого прямоугольника.
- Стикер-файлы: `contentVisibility: 'auto'` и immutable-кэш заголовков —
  без изменений (уже были).

## 7. Ограничения и непроверенное

- **GIF нет**: backend-контракт отсутствует; вкладка не добавлена. Минимальное
  расширение потребует отдельного решения (источник GIF, превью/полное медиа,
  транспорт) — вне этой ветки.
- Внутренний скролл `emoji-picker-react` при переоткрытии сбрасывается
  (библиотека не экспонирует scroll API); вкладка и стикер-скролл сохраняются.
- Overlay при wrap < 830px частично накрывает тред — осознанный компромисс;
  закрытие: ×, Esc, повторный клик по кнопке.
- Реальная доставка A→B проверена E2E на двух сид-аккаунтах
  (`e2e_test_pack`, 3 статичных WebP — Telegram не нужен), включая
  abort → failed-пузырь → retry из его меню с доставкой получателю.
  Не покрыто: `webm`/`tgs`-доставка (сид только webp — рендер-контур
  общий) и реальный импорт набора из Telegram (нет токена, см. ниже).
- Импорт набора из Telegram end-to-end не проверялся — в тестовом стеке
  нет `TELEGRAM_BOT_TOKEN`; контур импорта не менялся.
- MAX_PATH: при расположении репозитория глубоко в дереве путь вложения
  стикера превышает 260 символов — ограничение Windows, не кода; для E2E
  добавлен `E2E_HUB_DATA_DIR`.
- GIF — отдельный будущий этап: нужен согласованный backend-контракт
  (источник медиа, preview/полное, транспорт). В этой ветке не внедрялся.
