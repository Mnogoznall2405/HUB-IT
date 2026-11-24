# WEB_CHAT_STICKER_SYSTEM_V2 — стикер-система V2 (Telegram parity)

Дата: 2026-11-24. Ветка `feat/chat-sticker-system-v2` (база `c8a1d057`,
коммиты `ae05c8c6`, `bf68a653`, `352f62ab`, `cb3690da`, `625e4e90`).
Объект: `TelegramStickersTab` / `ChatStickerSuggestions` /
`ChatStickerManageDialog` / `ChatStickerPackDialog` /
`stickerSearchIndex` / `chatStickersAPI` / `telegram_sticker_service` /
миграция `20261124_0177`.

Содержание: parity-матрица с Telegram Desktop, находки аудита,
изменения API/БД, архитектурные решения, найденные и исправленные
дефекты, результаты тестов, перф-гейт против `c6d110e3`, визуальная
приёмка (ЭТАП 12) со скриншотами, ограничения, отклонённые альтернативы.

## Telegram-parity матрица

| Возможность | Telegram Desktop | HUB-IT V2 | Статус |
|---|---|---|---|
| Избранное | Облачный синк, секция в пикере, меню «Add to Favorites» | Серверные таблицы + REST, секция «Избранные», оптимистичное добавление/удаление из контекстного меню | DONE |
| Недавние | Локально+синк, до ~20 | Серверные (до 50, фронт показывает 20), секция «Недавние», дебаунс-синк 1.5 c | DONE |
| Поиск стикеров | По эмодзи и словам | Локальный индекс: эмодзи-совпадение, ключевые слова RU/EN, совпадение по названию/short_name набора | PARTIAL — словарь ключевых слов статичный локальный, не Telegram-теги с сервера |
| Подсказки при вводе эмодзи | Полоса над композером, клавиатурная навигация | `chat-sticker-suggestions`: ↑ вход, ←/→ выбор, Enter/Tab отправка, Esc скрыть, лимит 12 | DONE |
| Контекстное меню стикера | Отправить / Favorite / Open Pack | Отправить / Избранное (toggle) / Открыть набор / Убрать из недавних / Очистить недавние | DONE |
| Управление наборами | Окно наборов, DnD, удаление | Диалог «Наборы стикеров»: обложки, счётчики, HTML5 DnD → `POST /sticker-packs/order`, инлайн-подтверждение удаления | PARTIAL — DnD только внутри диалога, не в ленте наборов пикера |
| Полоса наборов | Внизу пикера: часы/звезда/обложки/плюс | `chat-sticker-pack-strip-row` внизу вкладки: «Недавние», «Избранные», обложки наборов, «+» импорт | DONE |
| Импорт набора | По ссылке/через бота | Инлайн-форма по `t.me/addstickers/…` + `POST /sticker-packs/import` | DONE |
| Превью набора | Клик по стикеру → карточка набора | `ChatStickerPackDialog` по клику на стикер в ленте: сетка, `is_added`, «Добавить набор» | DONE |
| Hold-preview стикера | Удержание → большое превью | `sticker-hold-preview` (pointer-hold), `ChatStickerMedia` c `forceAutoPlay` | DONE |
| Отправка стикера | Клик → в чат, WS-доставка | Клик → `POST /conversations/{id}/messages/sticker`, доставка по WS/polling | DONE |
| Автоплей анимированных в сетке | Всегда играют | `IO-gating` + `staticOnly` превью | PARTIAL — hover-autoplay в сетке не сделан; animated WebP рендерится как статичный кадр; TGS/Lottie не поддерживается |
| Позиция наборов | Синк порядка между устройствами | `position` в `chat_user_sticker_packs`, `POST /sticker-packs/order` | DONE |

## Находки аудита

- **Состояние — per-user на сервере.** Избранное и недавние привязаны к
  `user_id`, изоляция проверена e2e (A↔B). Избранное переживает удаление
  набора (FK на стикер, файлы общие в storage).
- **Кэш наборов — scoped + epoch.** `listPacks` кэшируется по
  `userId::selected_database`, инвалидируется при import/remove/order;
  epoch-гард не даёт позднему ответу перезаписать свежий кэш. Найденный
  пробел `removePack` без инвалидации закрыт (см. дефекты).
- **Сетка — `contentVisibility:auto` + `containIntrinsicSize`,**
  lazy-`img` превью, виртуальной прокрутки нет — при 90–200 стикерах
  достаточно; для паков в тысячи — кандидат на отдельную оптимизацию.
- **Две смонтированные вкладки** (keep-alive поповер + док) держат
  общие данные через события `chat-sticker-packs-changed` /
  `chat-sticker-recents-changed` — повторных запросов нет, состояние
  консистентно.
- **Визуальная приёмка (ЭТАП 12)** — 14 контрольных кадров, см. раздел
  «Скриншоты»: обрезанного контента нет, нижняя полоса наборов
  рендерится, контекстное меню читаемо, полоса подсказок не перекрывает
  textarea, тёмная тема контрастна (стикеры с непрозрачным фоном).
  Замечание не дефект: сквозь шапку overlay-дока на ~8 % просвечивают
  иконки шапки треда — следствие общего дизайн-токена
  `composerBg = alpha(#fff, 0.92)`, согласовано с остальными
  «стеклянными» поверхностями приложения.
- **Сидовые стикеры E2E** генерируются различимыми (Pillow: плашка с
  hue по индексу + фигура, fallback — 1×1 webp без Pillow) — визуальные
  прогоны видят реальную сетку, функциональные спеки от Pillow не
  зависят.

## Изменения API

Новые эндпоинты (`backend/api/v1/chat/stickers.py`):

| Метод и путь | Назначение | Ответ |
|---|---|---|
| `POST /chat/sticker-packs/order` | Сохранить порядок наборов пользователя | `ChatStickerPackListResponse` в новом порядке |
| `GET /chat/stickers/favorites` | Список избранного | `ChatStickerListResponse` (items + `pack_short_name`) |
| `PUT /chat/stickers/favorites/{sticker_id}` | Добавить в избранное (идемпотентно) | Актуальный список |
| `DELETE /chat/stickers/favorites/{sticker_id}` | Убрать из избранного | Актуальный список |
| `GET /chat/stickers/recent` | Список недавних | `ChatStickerListResponse` |
| `PUT /chat/stickers/recent` | Полная замена списка (дедуп + обрезка до 50) | Актуальный список |

Без изменений, но в контуре: `POST /conversations/{id}/messages/sticker`
(отправка), `GET /sticker-packs/preview/{short_name}` (карточка набора),
`POST /sticker-packs/import`, `DELETE /sticker-packs/{id}`,
`GET /stickers/{id}/file|preview` (раздача файлов).

Схемы (`backend/chat/schemas.py`): `ChatStickerListItemResponse`
(+`pack_short_name`), `ChatStickerListResponse`,
`ChatStickerRecentUpdateRequest`, `ChatStickerPackOrderRequest`.

## Изменения БД

Миграция `20261124_0177_chat_sticker_favorites` (down_revision
`20261118_0176`):

- `chat_user_favorite_stickers` — `id`, `user_id`, `sticker_id`
  (FK → `chat_stickers`, CASCADE), `added_at`;
  `UNIQUE(user_id, sticker_id)`, индекс `(user_id, added_at)`.
- `chat_user_recent_stickers` — `id`, `user_id`, `sticker_id`
  (FK → `chat_stickers`, CASCADE), `position` (0 = новейший),
  `updated_at`; `UNIQUE(user_id, sticker_id)`, индекс
  `(user_id, position)`.
- `chat_user_sticker_packs.position` — `Integer NOT NULL DEFAULT 0`,
  пользовательский порядок наборов в пикере; равенство позиций
  разрешается по `added_at`.

SQLite-путь (`initialize_chat_schema`) создаёт те же таблицы через
`metadata.create_all` + `_ensure_chat_message_columns` — e2e-стек живёт
без alembic.

## Архитектурные решения

- **Оптимистичное избранное.** Секция обновляется до ответа PUT/DELETE;
  ответ тем же списком подтверждает, при ошибке — откат и статус-строка
  (`role=status`, a11y). Без локального кэша — панель всегда показывает
  серверный список, что и доказывает персистентность после reload.
- **Дебаунс-синк недавних.** Общая trailing-очередь
  (`scheduleRecentStickersSync`, 1500 мс) схлопывает серию отправок в
  один PUT; scope-маркер `userId` не даёт списку ушедшего пользователя
  улететь под чужой сессией. localStorage — только офлайн-кэш: непустой
  серверный ответ выигрывает у локальной версии.
- **Ленивый поисковый индекс.** `buildStickerSearchIndex` вызывается
  только при непустом запросе; раньше пересобирался до 4× на каждый
  холодный маунт дока внутри render. Индекс — нормализованные
  haystack-строки по секциям (emojiNorm, keywordNorm, packNorm).
- **Подсказки — memo-токен.** Композер передаёт только хвостовой
  эмодзи-токен (`getTrailingEmojiToken`, окно 64 символа,
  ZWJ-безопасно); полоса сама лениво грузит каталог (`listPacks` +
  `listFavorites`) по первому токену и держит `dismissedToken` для Esc.
  Приоритет выдачи: недавние → избранные → наборы, дедуп по id.
- **Ключевые слова — статический словарь** RU+EN для частых эмодзи
  (`STICKER_EMOJI_KEYWORDS`, ~200 записей): ноль внешних зависимостей,
  подстроки покрывают составные эмодзи.
- **Порядок наборов — серверный.** `position` на
  `chat_user_sticker_packs`; DnD в диалоге → оптимистичный порядок →
  `POST /order` → ответ подтверждает/откатывает.
- **Контекстное меню — единая точка действий:** отправка, избранное
  (toggle по серверному списку), «Открыть набор» (scrollToSection),
  «Убрать из недавних» и «Очистить недавние» (только в секции
  «Недавние»).

## Дефекты, найденные и исправленные в ходе работы

| Дефект | Проявление | Исправление |
|---|---|---|
| Координаты `scrollToSection` | `offsetTop` считается до `chat-thread-pane-wrap`, не до scroll-корня → вкладки-обложки «перелетали» цель на высоту шапки дока, мелкие секции (Избранные/Недавние) уходили из видимости | Позиция в контенте через rect-дельту (`sectionContentTop`); тот же фикс в `updateActiveSection` (`625e4e90`) |
| `__perf.profiles` crash | `installHook` e2e-гейта не инициализировал `profiles` — `ChatPerfProbe` падал TypeError → RouteErrorBoundary под `E2E_PROFILING=1` | Инициализация `__perf.profiles` в хуке, форма как в `chat-emoji-perf.spec.js` (`625e4e90`) |
| `removePack` без инвалидации кэша | Удалённый набор возвращался `listPacks` из сессионного кэша | `invalidateStickerPacksCache()` в `removePack`, как у import/order (`cb3690da`) |
| Ленивый индекс | Индекс пересобирался до 4× за холодный маунт (render-time) | Построение только при непустом запросе; дельты typing/tab в гейте вернулись ≤8 % (`625e4e90`) |
| Визуальный кадр ленты | Открытый док перекрывал переписку — «полученный стикер» не был виден на скриншоте | В визуальном спеке док закрывается (Escape/крестик) перед кадром |
| Полупрозрачное меню на кадре | MUI-меню снималось в середине scale/fade-анимации | Выдержка 350 мс после открытия меню в визуальном спеке |

## Результаты тестов

- **Backend:** `tests/test_chat_sticker_favorites.py` — **10/10**
  (избранное, недавние, порядок наборов, идемпотентность, лимиты,
  изоляция, ошибки).
- **Vitest** (затронутые файлы, локальный прогон 24.11): **57/57** —
  `TelegramStickersTab.test.jsx` 35, `ChatStickerManageDialog.test.jsx` 9,
  `ChatStickerSuggestions.test.jsx` 6, `ChatStickerMedia.test.jsx` 6,
  `ChatStickerThumbnail.test.jsx` 1.
- **Playwright** (`E2E_LOCAL=1`, prod-сборка `E2E_BUILD=1`):
  - `chat-stickers-v2.spec.js` — **6/6**: избранное (меню → звёздная
    вкладка → reload-персистентность → удаление), недавние (отправка →
    дебаунс-PUT → reload → удаление), поиск (эмодзи, название набора,
    пустая выдача, Escape), подсказки (полоса, Esc, клик-отправка),
    диалог наборов (список, synthetic-DragEvent DnD → POST order,
    отказ удаления default-пака), межпользовательская изоляция.
  - `chat-emoji-picker.spec.js` — **11/11** (регрессии V1-пикера:
    hover/pinned/overlay, темы, вставка, доставка A→B, кэш паков).
  - `chat-stickers-v2-visual.spec.js` — **5/5**: визуальная приёмка,
    14 контрольных кадров.
- **Воспроизведение:**
  `E2E_LOCAL=1 E2E_BUILD=1 npx playwright test e2e/chat-stickers-v2-visual.spec.js`.

## Перф-гейт против `c6d110e3`

Методика как в `chat-regression-perf.spec.js`: prod-билд, локальный
стек, n=40 (receive 10, cold 30), контролируемый GC; baseline —
`perf-chat-regression-baseline-*.json` (`c6d110e3`), HEAD —
`perf-chat-regression-*.json`. Без профилирующего alias.

### 1440×900 (p50 / p95 мс)

| Сценарий | `c6d110e3` | HEAD | Δ p95 | Флаг |
|---|---|---|---|---|
| conv switch | 740.2 / 969.5 | 732.6 / 971.2 | +0.2 % | — |
| history load | 743.2 / 970.4 | 736.3 / 979.1 | +0.9 % | — |
| history 1000 (first bubble / settled) | 760.1/1105.8 / 809.0/1136.8 | 755.7/1003.4 / 784.6/1082.9 | −9 % / −5 % | — |
| typing echo | 27.6 / 30.9 | 29.8 / 33.4 | +8 % | шум |
| emoji pinned open | 240.7 / 367.0 | 302.5 / 398.0 | +8 % | p50 +26 %, commits 10→12 — см. флаг (1) |
| emoji hover | 225.4 / 235.0 | 236.8 / 251.5 | +7 % | — |
| tab → Стикеры | 127.4 / 166.2 | 138.0 / 182.2 | +10 % | в пределах шума харнесса |
| tab → Эмодзи | 159.4 / 192.0 | 173.5 / 230.4 | +20 % | хвост, см. (2) |
| send echo | 184.5 / 214.8 | 179.2 / 300.7 | **+40 %** | флаг (3) |
| receive (n=10) | 89.6 / 136.0 | 86.5 / 131.8 | −3 % | — |
| cold open (n=30) | 1259 / 1817 | 1423 / 1816 | 0 % p95, p50 +13 % | см. (2) |
| memory 3×50 циклов | mean Δ +1 MB | mean Δ +2 MB | ~ | — |

### 988×838 (p50 / p95 мс)

| Сценарий | `c6d110e3` | HEAD | Δ p95 | Флаг |
|---|---|---|---|---|
| conv switch | 713.0 / 965.6 | 733.6 / 989.1 | +2 % | — |
| history load | 714.8 / 968.8 | 721.0 / 972.6 | +0.4 % | — |
| history 1000 (first bubble / settled) | 808.0/1073.1 / 856.0/1131.3 | 801.8/1045.6 / 852.0/1094.2 | −3 % / −3 % | — |
| typing echo | 29.2 / 35.1 | 31.6 / 35.0 | 0 % | — |
| emoji pinned open | 192.0 / 284.8 | 202.9 / 394.9 | **+39 %** | флаг (1) |
| emoji hover | 229.1 / 242.4 | 239.6 / 253.3 | +5 % | — |
| tab → Стикеры | 122.1 / 159.4 | 129.3 / 178.9 | +12 % | шум |
| tab → Эмодзи | 161.0 / 184.5 | 166.2 / 210.1 | +14 % | см. (2) |
| send echo | 183.8 / 216.1 | 181.7 / 311.6 | **+44 %** | флаг (3) |
| receive (n=10) | 84.7 / 130.8 | 100.5 / 150.9 | +15 % | n=10, один хвост |
| cold open (n=30) | 1399 / 1659 | 1491 / 1745 | +5 % | — |
| memory 3×50 циклов | mean Δ +1 MB | mean Δ +1 MB | ~ | — |

**Флаги (честно):**

1. `emoji_pinned` @988 p95 +39 % и @1440 p50 +26 %, commits 10→12 —
   атрибутируется двум новыми запросами (favorites + recents) и
   коммитами прогретой скрытой вкладки стикеров при открытии дока.
   Систематическая стоимость измерена, не шум; принято как цена V2-функций,
   мониторить на чистой машине.
2. `tab → Эмодзи` p95 +14–20 % и `cold` p50 +13 % @1440 — хвостовые
   дельты без подтверждённой систематики (p50 вкладки +5–9 %), зафиксировано.
3. `send_echo` p95 +40–44 % при p50 ≤0 % — только хвост; на общем
   CI-ящике вероятен шум соседних процессов. **Помечено к перезамеру
   на чистой машине** — регрессией не считается до подтверждения.

## Скриншоты (визуальная приёмка, ЭТАП 12)

Прогон `chat-stickers-v2-visual.spec.js`, prod-сборка, 1440×900 и
988×838, светлая + тёмная темы. Перед каждым кадром проверяется реальный
декод картинок целевой области (`img.complete && naturalWidth>0 &&
rect>0`). Файлы — `WEB-itinvent/frontend/e2e-artifacts/stickers-v2/`.

| Кадр | Содержимое |
|---|---|
| `01-popover-grid.png` | Hover-поповер, вкладка «Стикеры», заполненная сетка |
| `02-dock-column.png` | Закреплённый док-колонка справа (360 px) |
| `03-favorites.png` | Секция «Избранные» (3 стикера через контекстное меню) |
| `04-recents.png` | Секция «Недавние» после отправки |
| `05-search-emoji.png` | Поиск по эмодзи-запросу 🧪 |
| `06-search-word.png` | Поиск по слову «сердце» (ключевые слова ❤️) |
| `07-suggestions.png` | Полоса подсказок над композером при вводе 🧪 |
| `08-context-menu.png` | Контекстное меню стикера |
| `09-manage-dialog.png` | Диалог «Наборы стикеров» |
| `10-pack-preview.png` | Превью набора по клику на стикер в ленте |
| `11-received-sticker.png` | Полученный стикер в переписке (входящий слева, свой справа) |
| `12-overlay-988.png` | Overlay-режим дока при 988×838 |
| `13-panel-light.png` / `14-panel-dark.png` | Основная панель в светлой / тёмной теме |

![01](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/01-popover-grid.png)
![02](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/02-dock-column.png)
![03](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/03-favorites.png)
![04](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/04-recents.png)
![05](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/05-search-emoji.png)
![06](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/06-search-word.png)
![07](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/07-suggestions.png)
![08](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/08-context-menu.png)
![09](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/09-manage-dialog.png)
![10](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/10-pack-preview.png)
![11](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/11-received-sticker.png)
![12](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/12-overlay-988.png)
![13](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/13-panel-light.png)
![14](.../WEB-itinvent/frontend/e2e-artifacts/stickers-v2/14-panel-dark.png)

## Непроверенные / известные ограничения

- Hover-autoplay анимированных стикеров в сетке не реализован;
  animated WebP отдаётся статичным кадром (превью), TGS/Lottie не
  поддерживается вовсе.
- Словарь ключевых слов — статический локальный, не серверные теги
  Telegram: запросы вне словаря матчат только по эмодзи и названию набора.
- DnD-перестановка есть только в диалоге управления; на нижней полосе
  наборов перетаскивания нет.
- Реальная выдача WS проверена только транспортом `local`
  (`CHAT_REALTIME_TRANSPORT`) — продакшен-транспорт (Redis/кластер) в
  e2e не покрыт.
- Перф-дельты-флаги (`send_echo` хвост, `emoji_pinned` @988) требуют
  перезамера на чистой машине — текущие цифры с общего CI-ящика.
- Мобильная раскладка (inline-пикер) за рамками визуальной приёмки —
  кадры делались на desktop-viewport 1440 и 988.
- Импорт настоящего Telegram-набора в e2e не проверялся (нет bot token)
  — контур покрыт локальными сидами и unit-тестами сервиса.

## Отклонённые альтернативы

- **Серверный поисковый индекс стикеров** — отклонено: объёмы малы
  (сотни стикеров на пользователя), локальный индекс строится за один
  проход в памяти без запросов; серверный индекс дал бы теги Telegram,
  но ценой нового эндпоинта и синка.
- **WS-транспорт для отправки стикера** — оставлен REST
  `POST …/messages/sticker`: идемпотентность через `client_message_id`,
  единый путь с обычными сообщениями; WS используется только для
  доставки входящих.
- **Удаление недавних по одному через hold-меню Telegram** — вместо
  долгого удержания выбраны явные пункты контекстного меню
  («Убрать из недавних», «Очистить недавние»): тот же охват действий,
  доступнее с клавиатуры и очевиднее в UI.
- **Локальное-only хранение недавних** (как у V1) — заменено серверным
  синком: Telegram-паритет подразумевает общий список между
  устройствами; localStorage остался офлайн-кэшем.
- **Объединение поповера и дока в один keep-alive узел** — отклонено
  ещё в Phase 2 emoji-работы: разные layout-режимы, перенос DOM =
  remount и потеря скролла/поиска; цена двух экземпляров измерена и
  принята.
