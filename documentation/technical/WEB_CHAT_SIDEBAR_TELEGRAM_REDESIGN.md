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

## 3. Архитектурное решение

- **Уровни навигации разделены**: модули — в drawer-рейле `MainLayout` (не тронут); диалоги — `ChatSidebar`; два уровня не смешиваются.
- **Три режима** вместо бинарного `collapsed`: `mode: 'collapsed' | 'compact' | 'expanded'`, хранится в `hub.chat.sidebarLayout`; старый формат (`collapsed: bool`) мигрирует чтением в `readSidebarLayout`.
- `useChatSidebarSizing`: `collapsed`/`compact` производные от `mode`; авто-схлоп при узком контейнере (< `MIN + THREAD_MIN`) форсирует rail только визуально, предпочтение пользователя не затирает; `setWidth` ниже `MIN` переводит в compact.
- **Resize-контракт**: `ChatSidebarResizeHandle` передаёт в `setWidth` сырое значение с нижним пределом `DRAG_MIN = COMPACT-40` (136 px), а режим решает хук: <260 → compact, ≥260 → expanded. Клавиатура: `←` в compact → rail, `→` из compact → expanded-MIN, `Home`/`End`/`Enter`/`dblclick` сохранены; `setPointerCapture` под try/catch для движков без pointer capture.
- Контекст расширен: `{collapsed, compact, mode, setCollapsed, setMode}` — обратная совместимость сохранена.

## 4. UX-состояния

- **Collapsed 72 px**: ☰(если шелл прячет шапку) → › развернуть → 🔍 поиск → лента иконок папок (Личные/Беседы/Задачи/кастом/ИИ/Архив, бейджи, скролл ≤38vh) → ⚙ папки → 🔔(редко); ниже — колонка аватарок: активная строка подсвечена фоном, бейдж непрочитанных угловой, черновик — карандаш, `aria-label` с именем и счётчиком; MUI `Tooltip` справа по hover/focus; ✏️ — плавающий FAB поверх списка.
- **Compact 176 px**: двухрядная шапка — строка 1: ☰ + поиск-пилюля + «⋯» (действия); строка 2: 🔔 уведомления, ↗ развернуть, ‹ в rail; ниже табы папок (Личные/Беседы/Задачи — горизонтальный скролл при нехватке). Строки = аватар 40 px + имя в одну строку с ellipsis + бейдж непрочитанных.
- **Expanded 260–520 px**: прежний полный список + новая кнопка «Компактный список чатов» (`ViewCompactAlt`) рядом с «‹».
- Переключения: rail `›`→expanded; expanded `‹`→rail, `▣`→compact; compact `⤢`→expanded, `‹`→rail; resize-хэндл виден в compact и expanded, драг <260 px → compact, обратно ≥260 → expanded; `Enter`/двойной клик на хэндле сохранены.

## 5. Изменённые файлы

- `theme/chatTelegramTheme.js` — `compactWidth: 176`.
- `pages/chat/chatSidebarSizing.js` — константы, `SIDEBAR_MODES`, `normalizeSidebarMode`, хранилище `{width, mode}` + миграция `collapsed`.
- `pages/chat/useChatSidebarSizing.js` — режимы, `setMode`, snap-to-compact в `setWidth`, расширенный контекст.
- `components/chat/ChatSidebarSizingContext.js` — дефолты.
- `components/chat/ChatSidebarDesktopHeader.jsx` — кнопки compact-toggle в expanded/compact ветках; compact-шапка перестроена в два ряда (поиск+⋯ / 🔔↗‹) — все элементы доступны при 176 px.
- `components/chat/ChatSidebarRows.jsx` — compact-блок (имя+бейдж) в `ConversationRow`/`AiConversationRow`, `hidden={collapsed||compact}` на полном тексте, аватары 44/40 px, MUI `Tooltip` справа в collapsed (нативный `title` там убран), размеры строк.
- `pages/chat/ChatSidebarResizeHandle.jsx` — `DRAG_MIN` вместо `MIN`, клавиатурные переходы compact↔rail, try/catch вокруг `setPointerCapture`.
- `e2e/chat-sidebar-modes.spec.js` — спека режимов: сид 15 переписок через API (cookie-auth), выбор→шапка→отправка адресату, быстрое переключение 5 чатов, tooltip мышью и клавиатурой, три режима, 988×838, zoom 125/150 %, светлая тема.
- `pages/chat/ChatSidebarSizing.test.jsx` — новый compact-кейс, обновлённый folders-rail кейс, реальный pointer-drag в обе стороны (expanded→compact→expanded), клавиатурный compact→rail, новый формат `readSidebarLayout`.

## 6. Проверки

- `npm run test:run -- src/pages/chat/ChatSidebarSizing.test.jsx src/components/chat/ChatSidebar.test.jsx` — **51/51 passed**.
- `npm run lint:chat-imports` — **OK**.
- `E2E_LOCAL=1 E2E_FRONTEND_PORT=5199 CHAT_GROUP_CREATE_PER_MINUTE=60 npx playwright test e2e/chat-sidebar-modes.spec.js` — **1 passed (42 с)** на локальном стеке (SQLite, `e2e_admin`/`e2e_user`, cookie-auth):
  - сидировано **15 переписок** (13 групп с длинными именами + 2 личных; непрочитанные от второго пользователя, превью);
  - expanded: ≥10 строк на «Беседы», выбор чата → `aria-current`, **заголовок h6 = выбранному чату**, сообщение отправлено и появилось в треде;
  - быстрое переключение 5 чатов подряд → ровно одна активная строка, шапка = последнему выбранному;
  - collapsed: tooltip по hover **и** по фокусу (MUI `role=tooltip`), клик по аватару выбирает чат;
  - compact: двухрядная шапка без обрезаний, скролл-ширина страницы ≤ viewport на 1440 и **988×838**;
  - zoom 125 % и 150 %: горизонтального переполнения нет (≤40 px допуск — фактически 0).
- Реальные скриншоты: `WEB-itinvent/frontend/e2e-artifacts/sidebar-modes/` — `10-expanded-selected.png`, `11-collapsed-selected.png`, `12-compact-selected.png`, `13-window-988x838.png`, `14-zoom-150.png`, `15-light.png` (ранние кадры `01–04` — первый цикл).
- Цикл исправлений по скриншотам: compact-шапка перегружала один ряд → перестроена в два ряда; drag не достигал compact → `DRAG_MIN`; повторный прогон зелёный.

## 7. Ограничения и следующие шаги

- Сид-пользователей три — личных диалогов только 2; сценарии с большим числом личных чатов покрыты группами.
- Тема приложения переключается внутри приложения, не через `prefers-color-scheme` — снимок «light» соответствует текущей светлой теме стека; тёмная тема отдельно не гонялась.
- Быстрое переключение проверено последовательными кликами; специально замедленные in-flight запросы (throttling) не моделировались — контракт единого `activeConversationId` не нарушен.
- Варнинги `vite ws proxy ECONNRESET/ECONNABORTED` при старте стека — транзиентны, на результат не влияют.
- Скринридер не прогонялся; структурно `aria-label`/`aria-current`/`role=separator` покрыты.
- Публикация на IIS не выполнялась — ветка PR #13.
