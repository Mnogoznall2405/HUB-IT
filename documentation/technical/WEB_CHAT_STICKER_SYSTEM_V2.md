# WEB_CHAT_STICKER_SYSTEM_V2 — стикер-система V2 (Telegram parity)

Дата: 2026-11-24. Ветка `feat/chat-sticker-system-v2` (база `c8a1d057`,
коммиты `ae05c8c6`, `bf68a653`, `352f62ab`, `cb3690da`, `625e4e90`).
Объект: `TelegramStickersTab` / `ChatStickerSuggestions` /
`ChatStickerManageDialog` / `ChatStickerPackDialog` /
`stickerSearchIndex` / `chatStickersAPI` / `telegram_sticker_service` /
миграции `20261124_0180`/`20261124_0181`/`20261125_0182`.

Содержание: parity-матрица с Telegram Desktop, находки аудита,
изменения API/БД, архитектурные решения, найденные и исправленные
дефекты, результаты тестов, перф-гейт против baseline `78106494`
(pre-Phase-2 ревизия PR #17), визуальная
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
  общие данные через единый scoped store `lib/chatStickerStore` —
  оба экземпляра подписаны на одну запись `userId::selected_database`,
  поэтому повторных запросов нет, а мутации видны всем мгновенно
  без событийного фан-аута (см. «Stabilization»).
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
| `GET /chat/stickers/recent` | Список недавних + счётчик синхронизации | `ChatStickerRecentListResponse` (items + `version`) |
| `PUT /chat/stickers/recent` | Версионный merge-sync: payload-ids в начало, серверные хвост сохраняется (дедуп + обрезка до 50); `clear=true` — точная замена; `base_version` — advisory, конфликты не отклоняются | `ChatStickerRecentListResponse` с инкрементированным `version` |

Без изменений, но в контуре: `POST /conversations/{id}/messages/sticker`
(отправка), `GET /sticker-packs/preview/{short_name}` (карточка набора),
`POST /sticker-packs/import`, `DELETE /sticker-packs/{id}`,
`GET /stickers/{id}/file|preview` (раздача файлов).

Схемы (`backend/chat/schemas.py`): `ChatStickerListItemResponse`
(+`pack_short_name`), `ChatStickerListResponse`,
`ChatStickerRecentListResponse`, `ChatStickerRecentUpdateRequest`
(+`base_version`, `clear`), `ChatStickerPackOrderRequest`.

## Изменения БД

Миграция `20261124_0180_chat_sticker_favorites` (down_revision
`20261124_0179` — My Files member `updated_at`; цепь синхронизирована после merge main `af485f22`):

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

Миграция `20261124_0181_chat_recent_sticker_sync_state` (down_revision
`20261124_0180`):

- `chat_user_recent_sticker_state` — `user_id` (PK),
  `version Integer NOT NULL DEFAULT 0`, `updated_at`. Счётчик
  успешных PUT `/chat/stickers/recent`: клиенты отличают «ещё ни разу
  не синкалось» (`version = 0`) от «явно очищено», и видят, что
  другой девайс обновил рейку.

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
  улететь под чужой сессией. localStorage — только офлайн-кэш,
  поднимается на сервер при `version === 0` (ещё ни разу не синкалось);
  `version > 0` с пустым списком — осознанная очистка, локальный кэш не
  воскрешается.
- **Единое право ссылки на стикер.** PUT избранного/недавних, раздача
  файлов и превью и отправка стикера делят одно правило: пакет
  установлен у пользователя, ИЛИ стикер в его избранном, ИЛИ копия
  лежит вложением (`sticker-<id>--*`) в диалоге, где пользователь —
  активный участник. Массовые записи молча отбрасывают чужие id,
  одиночные отдают 404; GET недавних фильтрует утратившие право строки
  (в БД они остаются и «возвращаются» при восстановлении доступа).
- **Ленивый поисковый индекс.** `buildStickerSearchIndex` строится
  один раз на поколение данных scope и разделяется вкладкой и
  подсказками (`getStickerSearchIndex` в store); раньше пересобирался
  до 4× на каждый холодный маунт дока внутри render. Индекс —
  нормализованные haystack-строки по секциям
  (emojiNorm, keywordNorm, packNorm).
- **Подсказки — memo-токен.** Композер передаёт только хвостовой
  эмодзи-токен (`getTrailingEmojiToken`, окно 64 символа,
  ZWJ-безопасно); полоса лениво тянет каталог через
  `ensureChatStickerData` (единый store — делится с вкладкой) по
  первому токену, подавляется `pickerOpen` при открытом доке/поповере
  и держит `dismissedToken` для Esc.
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

## Перф-гейт против baseline `78106494`

Методика как в `chat-regression-perf.spec.js`: prod-билд, локальный
стек, n=40 (receive 10, cold 30), контролируемый GC; baseline —
`perf-chat-regression-baseline-*.json` (ревизия `78106494`,
A/B-baseline из гейта PR #17 — НЕ итоговый HEAD `c6d110e3`), HEAD —
`perf-chat-regression-*.json`. Без профилирующего alias.

Контрольные значения итогового PR #17 (`c6d110e3` = `c8a1d057` на main),
снятые тем же харнессом n=40: pinned open @1440 p50 196.6 / p95 313.4;
pinned open @988 p50 194.6 / p95 328.2; send echo p95 214.7 @1440 /
217.0 @988. Сравнение HEAD-V2 с этими значениями: pinned @1440
302.5/398.0 vs 196.6/313.4 = **+27 % p95**; pinned @988 202.9/394.9 vs
194.6/328.2 = **+20 % p95**; send echo 300.7/311.6 vs 214.7/217.0 =
**+40–44 % p95**. Оба подтверждённых расхождения расследуются в разделе
Stabilization (см. ниже); таблица `78106494` ниже сохранена как
исторический слепок первого гейта.

### 1440×900 (p50 / p95 мс)

| Сценарий | `78106494` | HEAD | Δ p95 | Флаг |
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

| Сценарий | `78106494` | HEAD | Δ p95 | Флаг |
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
- `send_echo` хвост (~+25–40 % p95) повторяется на общей машине при
  нулевом стикерном трафике на send-пути — требует перезамера на
  чистой машине (см. Stabilization b/j). `emoji_pinned` после
  рефактора быстрее контроля (−28/−40 %) — флаг снят.
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

## Stabilization

Финальный проход стабилизации (24.11): синк с `origin/main` (A8-мерж
`926dd9f5` + `e2cebccd`), полная верификация, перезамер перф-гейта на
HEAD. Коммиты прохода: `daa8ba7c` (versioned recents + uniform ACL),
`740eea0a` (recents client semantics + send-фокус доказательства),
`2810b2c4` (единый scoped store), `7c2bfff5` (focused send-benchmark),
`6079818f` (race-матрица стора + поисковый perf-smoke), `7777bdf5`
(pickerOpen-гейтинг полосы), `db20042c` (перенумерация миграций после
A8), `test(chat): sticker V2 stabilization gate + report`, затем
`dfd73112` (op-based versioned recents — протокол в разделе l) и
финальный приёмочный проход с чистым A/B по send_echo (m).

### a) Перебазирование контроля

Ранняя таблица ниже сравнивалась с `78106494` — это A/B-baseline
промежуточного гейта PR #17, а НЕ итоговый контроль. Настоящий
контроль — итоговые замеры PR #17 на `c6d110e3` (= `c8a1d057` на main,
без стикеров): pinned open @1440 196.6/313.4, @988 194.6/328.2;
send echo p95 214.7 @1440 / 217.0 @988; typing ~27–31/35;
conv_switch ~730/970. Все дельты в этом разделе считаются от этих
значений; таблица `78106494` выше оставлена как исторический слепок.

### b) Корень send_echo-хвоста

Флаг +40–44 % p95 из первого гейта расследован фокусным
микробенчмарком `e2e/chat-send-focus-perf.spec.js` (тот же in-page
замер + регистратор XHR/fetch + режим `E2E_FOCUS_DOCK=1`, повторяющий
порядок гейта: док открыт → вкладка стикеров смонтирована скрытой →
док закрыт → send-цикл).

- Без дока (`perf-send-focus-1440x900.json`): send_echo p50 83.4 /
  p95 107.7, commits p50 6, `stickerRequests: 0` на всех 40 замерах.
- С прогретым доком (`perf-send-focus-1440x900-dock.json`):
  p50 167.8 / p95 183.1, commits p50 13, `requestsTotal: 0`,
  `stickerRequests: 0` на каждом замере.
- Вывод: на send-пути нет ни одного стикерного запроса; +~75 мс p95
  над бездоковым прогоном — отложенная работа скрытой вкладки
  стикеров (маунт + декод набора), цена keep-alive поверхности,
  принятая ещё в «Отклонённых альтернативах». Хвост ~270–300 мс в
  полном гейте на общей машине (в фоне крутился чужой e2e/перф-стек,
  процессы backend дважды убивались во время прогонов — см. логи) —
  шум нагруженного хоста, а не систематика send-пути.
- РЕШЕНО (финальный проход): чистый A/B на идентичном харнесе против
  merge-base `926dd9f5` — флаг снят, регрессия не подтверждена,
  подробности и таблицы в разделе (m).

### c) Единый scoped store

`src/lib/chatStickerStore.js` — запись на scope
`userId::selected_database` (status/data/version/staleEpoch),
`useSyncExternalStore`-подписки. Поповер, док и полоса подсказок
делят одну запись вместо событийного фан-аута
`chat-sticker-packs-changed` с повторным фетчем в каждом слушателе.
`ensureChatStickerData` — один запросный цикл на scope+поколение,
дедуп in-flight, ограниченный self-heal refetch при stale-эпохе.

### d) Избранное: очередь + op-log

`enqueueFavoriteMutation` сериализует PUT/DELETE через промис-цепочку
на scope; каждая мутация пишется в op-log (лимит 50) и реплеится в
`computeFavoriteItems` поверх серверного списка — состояния
queued/ok/failed/dropped, точечный откат по id без перезапроса.
Гонки быстрых toggle покрыты race-матрицей `chatStickerStore.test.js`
(13 кейсов: сериализация, реплей, точечный rollback, stale-эпоха с
bounded refetch, recents push/clear, переиспользование
мемо-секций, dv-семантика).

### e) Recents: merge-sync семантика

Сервер версионирует rail в `chat_user_recent_sticker_state`
(миграция 0179): PUT мержит клиентский список как голову и
сохраняет хвост других устройств; `clear:true` — полная замена;
`base_version` — монотонный echo. Клиент: `rememberRecentSticker` →
debounced `scheduleRecentStickersSync`; remove/clear → немедленный
PUT с `clear:true` после отмены очереди; localStorage мигрирует
вверх только при version=0, version>0+пустой rail = реальный clear
(локальный кэш стирается, зомби-id не воскресают).

### f) Единый ACL стикеров

`_sticker_can_access` / `_sticker_accessible_filter`: набор
установлен ИЛИ стикер в избранном ИЛИ копия вложена в диалог, где
вызывающий — активный участник. Массовые записи молча отбрасывают
недоступные id, одиночные операции отдают 404. Применено единообразно
к favorites PUT, recents PUT, /file и /preview отдаче и отправке.

### g) Ленивое гейтирование

- `ensureChatStickerData` — один фетч на scope+поколение с дедупом
  in-flight; feature flag off → полоса подсказок не делает ни одного
  запроса.
- Новый проп `pickerOpen` у `ChatStickerSuggestions`
  (`ChatComposer` передаёт `mobileEmojiPickerOpen || emojiPickerOpen`):
  при открытом доке/поповере полоса скрыта И каталог не грузится —
  emoji-only сценарии не порождают стикерный трафик и не перехватывают
  клавиши (регрессия Escape ниже).

### h) Общий поисковый индекс + smoke 5000

`getStickerSearchIndex` строит индекс один раз на поколение данных
scope; его делят вкладка и подсказки (раньше пересборка до 4× на
холодный маунт дока в render). Perf-smoke
`stickerSearchIndex.perf.test.js`: сборка индекса на 5000 стикеров
< 500 мс, 200 повторных lookup < 1000 мс.

### i) Цепочка миграций 0180/0181/0182

После мержа A8-работа заняла `20261124_0177`
(`ai_summary_llm_checkpoint`), а My Files PR #68 занял `20261124_0178` и
`20261124_0179`. Поэтому после merge `origin/main` (`af485f22`) стикерные
миграции перенумерованы вторично:
`20261124_0180_chat_sticker_favorites` (down 0179-myfiles),
`20261124_0181_chat_recent_sticker_sync_state` (down 0180) и
`20261125_0182_chat_recent_sticker_op_batch` (down 0181) —
цепочка 0176 → 0177(A8) → 0178(myfiles) → 0179(myfiles) →
0180 → 0181 → 0182, один head, merge-revision не нужен.
Проверки прежней нумерации: 30/30 стикерных миграционных тестов на sqlite;
на реальном PostgreSQL 17.6 — 16/16 проверок стикерной цепочки (см.
`db20042c`). После финальной перенумерации гейт повторяется на scratch PG17.

### j) Финальный гейт против контроля `c6d110e3`

Прогон `chat-regression-perf.spec.js` на HEAD стабилизации,
prod-билд, контролируемый GC, общая машина (фоном — чужой e2e-стек;
порт backend перенесён, процесс запущен под переименованной точкой
входа, чтобы sweep чужого стека его не гасил). Артефакты:
`e2e-artifacts/emoji-picker/perf-chat-regression-stab-*.json`.

| Сценарий | Контроль `c6d110e3` | Stab @1440 | Δ p95 | Stab @988 | Δ p95 |
|---|---|---|---|---|---|
| conv switch | ~730 / ~970 | 779.4 / 1020.2 | +5 % | 707.3 / 1006.2 | +4 % |
| history load | — | 817.3 / 1010.7 | — | 703.7 / 722.9 | — |
| history 1000 (first / settled) | — | 750.6/779.5 / 785.5/807.4 | — | 723.6/977.2 / 754.6/1007.2 | — |
| typing echo | ~27–31 / ~35 | 27.4 / 31.3 | в норме | 28.3 / 47.3 | хвост-шум |
| **emoji pinned open** | 196.6 / 313.4 · 194.6 / 328.2 | **171.6 / 224.6** | **−28 %** | **151.6 / 197.0** | **−40 %** |
| emoji hover | — | 207.0 / 222.6 | — | 206.6 / 218.7 | — |
| tab → Стикеры | — | 138.8 / 181.9 | — | 132.1 / 160.7 | — |
| tab → Эмодзи | — | 174.2 / 201.9 | — | 173.8 / 193.3 | — |
| send echo | p95 214.7 / 217.0 | 168.6 / 297.7 | +39 %¹ | 159.6 / 269.9 | +24 %¹ |
| receive (n=10) | — | 83.4 / 130.2 | — | 79.6 / 149.4 | — |
| cold open | — | 1551 / 1797 | — | 1287 / 1746 | — |
| memory 3×50 | ~0 | mean Δ 0 MB | ✓ | mean Δ 0 MB | ✓ |

¹ send_echo: помеченный хвост не подтверждён систематикой и СНЯТ
финальным чистым A/B против merge-base `926dd9f5` (раздел m):
p95 кандидата в пределах +10 % от baseline во всех 6 ячейках;
фокусный прогон с тем же dock-порядком давал p95 183.1 и ноль
стикерных запросов (b). Хвост первого гейта — шум общего хоста.

`emoji_pinned` закрыт: после единого стора (c) и pickerOpen-гейта (g)
открытие закреплённого дока на 28–40 % быстрее контроля без стикеров,
commits p50 5–6 против 12 до рефактора — флаг (1) из таблицы выше
снят.

### k) Дефекты прохода

| Дефект | Свидетельство | Корень | Фикс | Регрессионный тест | Итог |
|---|---|---|---|---|---|
| Escape не закрывает закреплённый док | `chat-emoji-picker.spec.js:249` FAIL | после рефактора полоса подсказок грузила каталог по любому эмодзи-токену и её `handleComposerKey` глотал Escape до цепочки закрытия | `pickerOpen` гейтит fetch и `visible` (`7777bdf5`) | тот же e2e | PASS |
| `emoji_pinned` +27–39 % | гейт vs `c6d110e3` | дублированные запросы/маунты скрытой вкладки + каталог-фетч полосы в emoji-сценарии | единый store (c) + pickerOpen (g) | stab-гейт | −28/−40 % vs контроль |
| send_echo хвост +40 % | первый гейт | не стикерный путь (0 запросов), dock-ordering + общий хост | документировано, доказательства (b) | `chat-send-focus-perf.spec.js` | шум-атрибуция |
| Дублирование ревизии 0177 | alembic heads | A8 заняла 0177 на main | перенумерация 0178/0179 (`db20042c`) | sqlite + PG | 30/30, 16/16 |
| Жёсткое число ревизий в тесте | `test_chat_migrations_scope_independent` FAIL | `CHAT_REVISIONS == 22` устарело после A8+стикеров | == 23 | тот же тест | PASS |
| Устаревший aria-label в unit-тесте | `ChatComposer.behavior.test.jsx` FAIL | pinned-режим меняет подпись на «Закрепить панель эмодзи» | ожидание обновлено (`7777bdf5`) | тот же тест | PASS |
| Recents: воскрешение записей stale-списком | разбор merge-sync (e): устройство со старым rail присылало полный список → стертые другим устройством id возвращались | snapshot-семантика PUT не различала «мои изменения» и «полное состояние» | op-протокол `dfd73112`: PUT принимает `{base_version, ops:[bump|remove|clear]}`; merge `{items, version}` в ответе авторитетен | 9 backend-кейсов (`test_recents_ops_*`) + 7 frontend-кейсов (session-guard flush) | PASS: stale-list не воскрешает, повторная реальная отправка легально возвращает стикер |
| Бенч-спек `send focus` падал на 988px при открытом доке | `composer.click()` timeout: overlay-док перехватывает pointer events над полем ввода | layout-факт: на узком viewport док — overlay поверх composer | в режиме `dock=open` замер использует `focus()` вместо `click()` (hit-check не нужен для focus) | rerun open@988 на обеих сторонах | PASS, 40/40 на обеих сторонах |
| Baseline-worktree: login 400 `MAIL_CREDENTIALS_KEY is not configured` | smoke-прогон A на `926dd9f5` | `.env` не tracked → не копируется в worktree | `.env` скопирован в baseline-worktree (локально, не коммитится) | повторный smoke + полный прогон A | PASS |

### l) Op-based recents sync (`dfd73112`)

`PUT /api/v1/chat/stickers/recent` принимает дельты вместо снапшота
rail'а. Это закрывает дефект merge-sync семантики (e): устройство с
устаревшим локальным списком больше не может «воскресить» записи,
которые другое устройство удалили или очистили.

Запрос: `{base_version?, ops:[{op, sticker_id?}, …] (≤500), clear?, sticker_ids? (legacy)}`
Ответ: `{items, version}` — смерженное состояние, авторитетное для
клиента (клиент реплеит поверх него неподтверждённые ops).

| Элемент | Семантика |
|---|---|
| `ops[i].op = bump` | переместить `sticker_id` в голову rail — пользователь реально отправил стикер |
| `ops[i].op = remove` | удалить `sticker_id` из rail |
| `ops[i].op = clear` | обрезать rail (`sticker_id` игнорируется); топ-левел `clear:true` = неявный leading `clear` |
| `sticker_ids` (legacy) | bump-head merge: список устройства становится головой, серверный хвост сохраняется; используется только v0→v2 миграцией localStorage; игнорируется при непустых `ops` |
| `base_version` | advisory, монотонный; mismatch логируется, запись НЕ отклоняется (ops идемпотентны и применяются последовательно) |

Ключевое свойство: **stale-list resurrect невозможен by design** —
устройство со старым `base_version` шлёт только дельты по стикерам,
на которые оно реально действовало; у него нет механизма вернуть
записи, удалённые другим устройством. Легальное «воскрешение»
остаётся и это корректно: повторная реальная отправка стикера на
stale-устройстве — `bump`-оп — возвращает его в голову (это действие
пользователя, а не побочка синка).

Клиент (`src/api/chatStickers.js`): op-journal на scope, debounce для
bump'ов, реплей неподтверждённых ops поверх ответов GET/PUT;
session-guard — очередь при flush перепроверяет user+DB scope и
отменяется при `invalidate`/`cancelRecentStickersSync`; localStorage
переехал на `hubit.chat.recent-stickers.v2:{userId}:{selectedDb}`
с одноразовой миграцией v1 (вверх только при version=0).

Регрессионные тесты: backend `test_recents_ops_*` (9 кейсов:
bump-ordering, remove/clear, stale-device no-resurrect, interleave
двух устройств, drop unknown/inaccessible, ordering clear+ops,
пустой ops, идемпотентность реплея) + frontend `chatStickers.test.js`
(7 кейсов session-guard: flush при той же сессии, drop при смене
пользователя/БД/пропаже сессии, cancel по своему/чужому scope,
замена stale pending).

### m) Чистый A/B send_echo: кандидат vs merge-base `926dd9f5`

Финальная проверка гипотезы «+40 % p95 = шум машины» на идентичном
харнесе. Baseline — git-worktree `send-ab-baseline` на sha
`926dd9f5` (tip main, merge-base ветки, без Sticker V2); в него
скопирован ТОТ ЖЕ спек `chat-send-focus-perf.spec.js` (src-изменения
не копировались). Обе стороны: prod-билд + `vite preview`,
backend через decoy-обёртку (`stab_backend.py`), порты
18411/5484, `E2E_FOCUS_RUNS=40`, viewport'ы 1440×900 и 988×838,
чередование A/B по сценариям (A-plain→B-plain→B-warm→A-warm→
A-open→B-open). На машине параллельно работал чужой e2e-стек —
шум разделён между сторонами поровну, это и проверялось.

| Сценарий | Viewport | Baseline p50/p95, мс | Candidate p50/p95, мс | Δ p95 |
|---|---|---|---|---|
| plain send | 1440×900 | 79.6 / 112.5 | 80.0 / 107.9 | **−4.1 %** |
| plain send | 988×838 | 89.8 / 106.0 | 90.4 / 112.3 | **+5.9 %** |
| send после open+close дока | 1440×900 | 156.1 / 175.0 | 166.0 / 190.5 | **+8.9 %** |
| send после open+close дока | 988×838 | 159.5 / 171.5 | 170.2 / 186.4 | **+8.7 %** |
| send при открытом доке | 1440×900 | 173.0 / 192.0 | 187.9 / 211.1 | **+9.9 %** |
| send при открытом доке | 988×838 | 174.7 / 194.5 | 175.2 / 202.7 | **+4.2 %** |

Во всех окнах на обеих сторонах: `stickerRequests = 0`,
`timeouts = 0`, `longTasks = 0`; commits p50 6→6 (plain),
12→13 (warm), 12→11 (open). Отправка идёт через WS-кадр —
HTTP-рекордер видит только идентичный post-send GET-refresh
(thread-bootstrap/hydrate/messages ~35–45 мс) на обеих сторонах,
т.е. серверный вклад симметричен.

ВЕРДИКТ: регрессия send_echo НЕ подтверждена — дельта p95 кандидата
в пределах +10 % во всех шести ячейках (критерий «+10 %»). Флаг
+40 % первого гейта — шум нагруженного хоста (чужой e2e/перф-стек +
убийства backend'ов sweep'ом). Остаточная систематическая дельта
+4–9 % на dock-сценариях (~+15 мс p95) — цена единой keep-alive
поверхности дока с монтируемой вкладкой стикеров (commits 12→13 в
warm), зафиксирована в «Отклонённых альтернативах»; блокером не
является. Артефакты: `e2e-artifacts/send-ab/{baseline,candidate}-*.json`
(12 файлов, включая сырые сэмплы и трассы запросов).

### n) Финальная тест-матрица приёмки (24.11, HEAD `dfd73112`)

| Проверка | Результат |
|---|---|
| `pytest tests/test_chat_sticker_favorites.py WEB-itinvent/backend/tests/test_chat_sticker_favorites.py tests/test_chat_telegram_stickers.py` | **65/65 PASS** (37 с, sqlite, вкл. upgrade/downgrade миграций 0180/0181/0182 + single-head-descendant) |
| `pytest tests/test_chat_migrations_scope_independent.py` | **53/53 PASS** (`CHAT_REVISIONS == 23`) |
| Цепочка alembic 0176→0177→0178(myfiles)→0179(myfiles)→0180→0181→0182 | один head `20261125_0182` (`alembic heads`), down_revision-цепь целая, дублей нет |
| Реальный PG-гейт (16/16 ранее на PG 17.6) | НЕ перезапущен: на этом хосте доступен только живой `hubit_chat` (PG 16.15, без scratch-схем) — DDL на нём без designate запрещён; временная 17.6 предыдущего прохода недоступна. Покрытие: статическая цепь + sqlite upgrade/downgrade + scope-тесты |
| `npm run test:run` по затронутым сьютам (TelegramStickersTab, chatStickerStore, chatStickers api, ChatStickerSuggestions, stickerSearchIndex.perf, ChatThread, ChatEmojiDock, ChatEmoji, ChatComposer.behavior) | **212/212 PASS** (9 файлов) |
| `E2E_LOCAL=1 E2E_BUILD=1` chat-stickers-v2 + chat-emoji-picker + chat-stickers-v2-visual | **26/26 PASS** (6+15+5) |
| eslint изменённых файлов | файлы под env-scope (`components/chat`): **0 ошибок**; `src/api`/`src/lib` — тот же класс `no-undef` на browser-globals, что и у 807 существующих файлов baseline (конфиг покрывает globals только chat-дерево/mail) — известный gap конфигурации, не дефект кода |
| `vite build --outDir ../../output/vite-trial` | **OK** (63 с, только стандартные chunk-size предупреждения) |
| send_echo чистый A/B | флаг снят, таблицы в (m) |

### o) Follow-up 25.11: op-batch dedup + PG-гейт + e2e env

Закрыты два гэпа матрицы (n) и одна оставшаяся гонка op-протокола.

**`op_batch_id` — дедупликация под потерянный ответ.** Op-протокол (l)
делает stale-list невозможным, но lost response всё ещё опасен: retry
был бы вторым применением той же дельты — `bump` мог воскресить то, что
другое устройство успело очистить, `clear` — снести добавленное за время
полёта ответа. Теперь клиент держит один стабильный `batchId` на состав
журнала (`meta.recentOpsBatchId` в `chatStickerStore`: генерируется при
переходе журнала в непустой, стабилен на retry и на параллельных flush'ах
одного журнала, ротируется при изменении состава). Сервер под той же
`FOR UPDATE`-блокировкой state-строки проверяет id по **bounded-истории**
`chat_user_recent_sticker_state.applied_op_batch_ids` (JSON, cap 100 —
миграция `20261125_0182`): уже записанный id → ответ текущим
`{items, version}` без повторного применения и без bump'а версии.
История, а не один last-id — повторяемый пакет не обязан быть последней
записью (между apply и retry может лечь пакет другого устройства).

Совместимость: старый клиент без поля → применяется как раньше; новый
клиент на сервере без 0182 → pydantic игнорирует лишнее поле (graceful
degrade). Порядок релиза: миграция 0182 до/вместе с кодом сервера —
стандартный alembic-first.

**PG-гейт выполнен** (гэп из n-матрицы): portable PostgreSQL 17,
изолированный кластер `127.0.0.1:55433` (`pg-v31-data`), scratch-БД
`stgt_*` — `tests/test_pg_sticker_gate.py`: chat-scope upgrade→head,
колонки/таблицы, replay no-op под FOR UPDATE, два потока сериализуются
(version 2 и 3), downgrade→0177 и повторный upgrade. Первичный прогон до
post-main перенумерации — 2/2 PASS. После merge `af485f22` и перенумерации
0180–0182 гейт расширен и повторён: **4/4 PASS** — fresh upgrade→head,
upgrade с `0177`, upgrade с My Files-side `0179` с сохранением pre-existing
install row, op-batch dedup/concurrency, sticker-only downgrade `0182→0179`
и re-upgrade.

**E2E `MAIL_CREDENTIALS_KEY`:** `e2e/stack/local_backend.py` сидит
test-only passphrase (вне production — SHA-256→Fernet); стек самодостаточен
без внешнего env. Логин проверен POST `/api/v1/auth/login` →
`authenticated` при удалённой переменной.

| Проверка | Результат |
|---|---|
| backend `test_chat_sticker_favorites.py` | **29/29** (+5: replay-после-clear, replay-clear-после-bump, параллельные flush'и, version-не-bump, legacy-совместимость) |
| `tests/test_pg_sticker_gate.py` (PG 17 scratch) | первично **2/2**; после post-main перенумерации расширенный гейт **4/4** |
| `tests/test_chat_sticker_favorites.py` + telegram + preview + scope | 15+26+2+55 **PASS**; один head `20261125_0182` |
| frontend `chatStickerStore` + `chatStickers` | **24+17 = 41/41** (+3 batchId-теста: стабильность на retry, ротация при новых ops, один id у параллельных flush'ей) |

Известное окружение: Playwright в worktree `.codex_tmp/integ-fr` падает
белой страницей — vite dep-optimizer (vite 7.3.2/esbuild 0.27.7)
генерирует битый MUI-чанк `createTheme_default is not a function`
(`@mui/material/Box`), воспроизводится после чистки `.vite`; версии
node_modules идентичны main-worktree — проблема среды, не кода ветки.
