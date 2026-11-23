# WEB_CHAT_SIDEBAR_TELEGRAM_REDESIGN — панель чатов по образцу Telegram Desktop

Веб-версия (React), WPF и React Native не затрагивались. Backend/API-контракты не менялись.

## 1. Аудит: точные пути

| Зона | Файл |
|---|---|
| Рейл модулей HUB-IT (Главная/Лента/Чат/Почта/…) | `WEB-itinvent/frontend/src/components/layout/MainLayout.jsx` (`DRAWER_RAIL_WIDTH`, свёрнутый drawer) |
| Ширины/режим сайдбара чата, localStorage | `WEB-itinvent/frontend/src/pages/chat/chatSidebarSizing.js` (`hub.chat.sidebarLayout`) |
| Хук режима | `WEB-itinvent/frontend/src/pages/chat/useChatSidebarSizing.js` |
| Контекст режима | `WEB-itinvent/frontend/src/components/chat/ChatSidebarSizingContext.js` |
| Хедер/рейл сайдбара | `WEB-itinvent/frontend/src/components/chat/ChatSidebarDesktopHeader.jsx` |
| Строки чатов (collapsed/compact/expanded) | `WEB-itinvent/frontend/src/components/chat/ChatSidebarRows.jsx` (`ConversationRow`, `AiConversationRow`) |
| Провайдер + resize-хэндл | `WEB-itinvent/frontend/src/pages/chat/ChatPageDesktopLayout.jsx` |
| Токены ширин | `WEB-itinvent/frontend/src/theme/chatTelegramTheme.js` (`railWidth: 72`, `compactWidth: 176`, `minWidth: 260`) |
| selectedChatId | `ChatPage` → `activeConversationId` prop → `ConversationRow.active` (`aria-current`, `data-chat-active`); та же переменная ведёт шапку треда, ленту и composer — единый источник, отправка идёт по `conversationId` выбранного чата |

## 2. Найденные проблемы

1. Свёрнутая колонка смешивала кнопки приложения и аватарки (2-колоночная сетка ☰📁🔍✏️🔔› + дубль-экспандер).
2. Режимов было два: rail 72 px / expanded 260–520 px; промежуточного компакта не было.
3. В collapsed имена видел только нативный `title` (без tooltip на фокусе).
4. Тест `ChatSidebarSizing` держал устаревший контракт хранилища `{width, collapsed}`.
5. (ревью PR #13) `ChatSidebarResizeHandle` клампил ширину минимумом 260 px — перетаскиванием нельзя было достичь compact; jsdom без `setPointerCapture` ронял драг.
6. (ревью PR #13) Compact-шапка 176 px была перегружена: поиск, 🔔, ↗ и ‹ выстроены в один ряд и обрезали вкладку «Задачи».
7. (ревью PR #13, поиск) Поле поиска сжималось на узкой панели: в compact 176 px полноценный input физически не влезал рядом с кнопками; открытие поиска из rail вызывало `setCollapsed(false)` — постоянный режим перезаписывался в `hub.chat.sidebarLayout`, rail/compact не восстанавливались.
8. (ревью PR #13, поиск) Глобальный `:focus-visible { outline: 2px solid #1976d2 }` в `index.css` живёт вне слоёв Tailwind и побеждает `outline-none` — внутри скруглённой пилюли рисовался прямоугольный синий контур инпута.
9. (ревью PR #13, поиск) `searchActive` зависел только от фокуса/текста: после blur с пустым полем временная панель оставалась открытой без явного способа закрыться и восстановить режим.

## 3. Архитектурное решение

- **Уровни навигации разделены**: модули — в drawer-рейле `MainLayout` (не тронут); диалоги — `ChatSidebar`; два уровня не смешиваются.
- **Три режима** вместо бинарного `collapsed`: `mode: 'collapsed' | 'compact' | 'expanded'`, хранится в `hub.chat.sidebarLayout`; старый формат (`collapsed: bool`) мигрирует чтением в `readSidebarLayout`.
- `useChatSidebarSizing`: `collapsed`/`compact` производные от `mode`; авто-схлоп при узком контейнере (< `MIN + THREAD_MIN`) форсирует rail только визуально, предпочтение пользователя не затирает; `setWidth` ниже `MIN` переводит в compact.
- **Resize-контракт**: `ChatSidebarResizeHandle` передаёт в `setWidth` сырое значение с нижним пределом `DRAG_MIN = COMPACT-40` (136 px), а режим решает хук: <260 → compact, ≥260 → expanded. Клавиатура: `←` в compact → rail, `→` из compact → expanded-MIN, `Home`/`End`/`Enter`/`dblclick` сохранены; `setPointerCapture` под try/catch для движков без pointer capture.
- **Временное раскрытие поиска** (`searchExpanded` в `useChatSidebarSizing`): отдельный неперсистентный флаг — при нём `mode` отдаёт `'expanded'`, а ширина = `min(340, containerWidth − reserved − THREAD_MIN)` (пол `RAIL`); `layout` и `hub.chat.sidebarLayout` не трогаются. `setMode`/`setWidth` снимают флаг: явный свёртываль или drag во время поиска — осознанный выбор пользователя и сохраняется.
- Контекст расширен: `{collapsed, compact, mode, setCollapsed, setMode, searchExpanded, setSearchExpanded}` — обратная совместимость сохранена.

## 4. UX-состояния

- **Collapsed 72 px**: ☰(если шелл прячет шапку) → › развернуть → 🔍 поиск → лента иконок папок (Личные/Беседы/Задачи/кастом/ИИ/Архив, бейджи, скролл ≤38vh) → ⚙ папки → 🔔(редко); ниже — колонка аватарок: активная строка подсвечена фоном, бейдж непрочитанных угловой, черновик — карандаш, `aria-label` с именем и счётчиком; MUI `Tooltip` справа по hover/focus; ✏️ — плавающий FAB поверх списка.
- **Compact 176 px**: двухрядная шапка — строка 1: ☰ + поиск-пилюля + «⋯» (действия); строка 2: 🔔 уведомления, ↗ развернуть, ‹ в rail; ниже табы папок (Личные/Беседы/Задачи — горизонтальный скролл при нехватке). Строки = аватар 40 px + имя в одну строку с ellipsis + бейдж непрочитанных.
- **Expanded 260–520 px**: прежний полный список + новая кнопка «Компактный список чатов» (`ViewCompactAlt`) рядом с «‹».
- Переключения: rail `›`→expanded; expanded `‹`→rail, `▣`→compact; compact `⤢`→expanded, `‹`→rail; resize-хэндл виден в compact и expanded, драг <260 px → compact, обратно ≥260 → expanded; `Enter`/двойной клик на хэндле сохранены.
- **Поиск по режимам** (как в Telegram):
  - **Collapsed**: только лупа в рейле → временное раскрытие до ~340 px + автофокус на поле.
  - **Compact**: настоящего поля нет — кнопка-заглушка «Поиск» (`data-testid=chat-search-open`) на всю ширину → то же временное раскрытие.
  - **Expanded**: полноценное поле; сеанс поиска (фокус или текст) показывает ← «Закрыть поиск» вместо ☰ и прячет 🔔/▣/‹/«⋯» — поле получает всю ширину; `×` «Очистить поиск» при введённом тексте; одинарная лёгкая пилюля без двойной рамки/кольца.
  - `Esc`: с текстом — чистит запрос, на пустом — закрывает поиск и восстанавливает прежний режим; ← и выбор результата (`closeSearch` в `handleOpenConversation`/`handleOpenPeer`) — тоже полное закрытие. Результаты — прежний серверный поиск (`getUsers`+`getConversations`, секции «Люди»/«Чаты», подсветка).
  - Сеанс считается активным при фокусе, тексте **или** `searchExpanded` — после клика вне поля кнопка ← «Закрыть поиск» остаётся и восстанавливает прежний режим.
  - Focus-состояние: инпуту `outline: none` инлайном (перебивает глобальное unlayered-правило точечно), единое скруглённое кольцо — `outline: 2px solid var(--chat-focus-ring)` на пилюле (outline следует border-radius и виден в forced-colors).
- **Идемпотентный E2E-сид**: перед созданием читается список бесед; группы/директы с существующими заголовками/`direct_peer.id` пропускаются — повторные прогоны не плодят данные, чужое не удаляется.

## 5. Изменённые файлы

- `theme/chatTelegramTheme.js` — `compactWidth: 176`.
- `pages/chat/chatSidebarSizing.js` — константы, `SIDEBAR_MODES`, `normalizeSidebarMode`, хранилище `{width, mode}` + миграция `collapsed`.
- `pages/chat/useChatSidebarSizing.js` — режимы, `setMode`, snap-to-compact в `setWidth`, расширенный контекст.
- `components/chat/ChatSidebarSizingContext.js` — дефолты.
- `components/chat/ChatSidebarDesktopHeader.jsx` — кнопки compact-toggle в expanded/compact ветках; compact-шапка перестроена в два ряда (поиск+⋯ / 🔔↗‹) — все элементы доступны при 176 px.
- `components/chat/ChatSidebarRows.jsx` — compact-блок (имя+бейдж) в `ConversationRow`/`AiConversationRow`, `hidden={collapsed||compact}` на полном тексте, аватары 44/40 px, MUI `Tooltip` справа в collapsed (нативный `title` там убран), размеры строк.
- `pages/chat/ChatSidebarResizeHandle.jsx` — `DRAG_MIN` вместо `MIN`, клавиатурные переходы compact↔rail, try/catch вокруг `setPointerCapture`.
- `components/chat/ChatSidebarDesktopHeader.jsx` — сеанс поиска в expanded (←/×/скрытые действия, лёгкая пилюля), кнопка «Поиск» на всю ширину в compact.
- `components/chat/ChatSidebar.jsx` — `handleExpandSearch` → `setSearchExpanded(true)`+фокус; `closeSearch` (запрос '' + снятие временного режима + blur); `closeSearch` на выборе чата/собеседника из результатов.
- `pages/chat/useChatSidebarSizing.js`, `chatSidebarSizing.js`, `ChatSidebarSizingContext.js` — `searchExpanded`, константа `CHAT_SIDEBAR_SEARCH_EXPAND = 340`, ширина временного поиска, снятие флага в `setMode`/`setWidth`.
- `e2e/chat-sidebar-modes.spec.js` — спека режимов: сид 15 переписок через API (cookie-auth), выбор→шапка→отправка адресату, быстрое переключение 5 чатов, tooltip мышью и клавиатурой, три режима, 988×838, zoom 125/150 %, тёмная тема; второй тест — поиск: временное раскрытие из rail/compact, фокус, результаты, выбор → восстановление, ×/Esc/«Назад», неперсистентность временной ширины, 988×838.
- `pages/chat/ChatSidebarSizing.test.jsx` — новый compact-кейс, обновлённый folders-rail кейс, реальный pointer-drag в обе стороны (expanded→compact→expanded), клавиатурный compact→rail, новый формат `readSidebarLayout`; поиск: временное раскрытие 340 + восстановление rail, compact→поиск→«назад»→compact, явный resize во время поиска побеждает восстановление, Esc двухстадийный, ←/×/скрытые действия.

## 6. Проверки

- `npm run test:run -- src/pages/chat/ChatSidebarSizing.test.jsx src/components/chat/ChatSidebar.test.jsx` — **57/57 passed** (16 + 41).
- `npm run lint:chat-imports` — **OK**.
- `E2E_LOCAL=1 E2E_FRONTEND_PORT=5199 CHAT_GROUP_CREATE_PER_MINUTE=60 npx playwright test e2e/chat-sidebar-modes.spec.js` — **2 passed** на локальном стеке (SQLite, `e2e_admin`/`e2e_user`, cookie-auth):
  - тест режимов (~1,1 мин): сидировано **15 переписок** (13 групп с длинными именами + 2 личных; непрочитанные от второго пользователя, превью); expanded: ≥10 строк на «Беседы», выбор чата → `aria-current`, **заголовок h6 = выбранному чату**, сообщение отправлено и подтверждено read-back API по `conversationId`; быстрое переключение 5 чатов → ровно одна активная строка; collapsed: tooltip по hover **и** по фокусу; FAB в dock-слоте — не перекрывает строки; compact: селектор раздела («Задачи» видна без прокрутки); реальный drag мышью expanded→compact→expanded; тёмная тема приложения через `emulateMedia({colorScheme:'dark'})` + `theme_mode=system`; 1440 и 988×838 без горизонтального скролла; zoom 125/150 % без переполнения;
  - тест поиска (~10–18 с): rail 🔍 → временная панель `aria-valuenow=340` + автофокус + ←/скрытые действия; computed styles: `outlineStyle` инпута = `none`, у пилюли = `solid` (единое скруглённое кольцо); ввод → серверные результаты; выбор → чат открыт и **rail восстановлен**, `localStorage.mode` остался `collapsed`; **клик вне поля → blur → ← доступна → закрытие → rail**; compact → кнопка «Поиск» (`chat-search-open`), поля нет; `×` чистит текст не закрывая поиск; `Esc` чистит → закрывает → compact восстановлен; **compact-поиск → клик вне → ← → compact**; поиск собеседника → `conversation=` в URL; «Назад» в expanded не меняет постоянный режим; 988×838 — фокус и отсутствие переполнения.
- `npx vite build --outDir ../.codex_tmp_vite_build` — **built in 1m9s** (предупреждения только о размере чанков, каталог удалён).
- Реальные скриншоты: `WEB-itinvent/frontend/e2e-artifacts/sidebar-modes/` — `10–15` (режимы), `20–22` (тёмная тема), `30-search-temp-expanded.png`, `31-search-results.png`, `32-compact-search-button.png`, `33-search-988.png`.
- Цикл исправлений по скриншотам: compact-шапка перегружала один ряд → перестроена в два ряда; drag не достигал compact → `DRAG_MIN`; поиск сжимался и не восстанавливал режим → временное неперсистентное раскрытие + кнопка «Поиск» в compact; повторные прогоны зелёные.

## 7. Ограничения и следующие шаги

- Сид-пользователей три — личных диалогов только 2; сценарии с большим числом личных чатов покрыты группами.
- Локальный стек на SQLite: `func.lower(title)` не опускает кириллицу — E2E-поиск по группам проверен ASCII-запросом `it`; **поиск по-русски на PostgreSQL — непроверенное условие приёмки** (локального PG-стека нет, прод read-only; механизм `func.lower(...).contains` на PostgreSQL с кириллицей работает штатно, но живьём не прогонялся). Поиск по людям (`getUsers`) и выбор результата проверены живьём.
- Zoom проверен через CSS `zoom` на `documentElement` — приближение к нативному масштабу браузера, но не тождественно ему (нативный `page zoom` Playwright не эмулирует).
- Быстрое переключение проверено последовательными кликами; специально замедленные in-flight запросы (throttling) не моделировались — контракт единого `activeConversationId` не нарушен.
- Варнинги `vite ws proxy ECONNRESET/ECONNABORTED` при старте стека — транзиентны, на результат не влияют.
- Скринридер не прогонялся; структурно `aria-label`/`aria-current`/`role=separator` покрыты.
- Публикация на IIS не выполнялась — ветка PR #13.
