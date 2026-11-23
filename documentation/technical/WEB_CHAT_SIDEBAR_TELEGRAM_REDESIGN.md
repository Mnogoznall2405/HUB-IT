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

## 3. Архитектурное решение

- **Уровни навигации разделены**: модули — в drawer-рейле `MainLayout` (не тронут); диалоги — `ChatSidebar`; два уровня не смешиваются.
- **Три режима** вместо бинарного `collapsed`: `mode: 'collapsed' | 'compact' | 'expanded'`, хранится в `hub.chat.sidebarLayout`; старый формат (`collapsed: bool`) мигрирует чтением в `readSidebarLayout`.
- `useChatSidebarSizing`: `collapsed`/`compact` производные от `mode`; авто-схлоп при узком контейнере (< `MIN + THREAD_MIN`) форсирует rail только визуально, предпочтение пользователя не затирает; `setWidth` ниже `MIN` переводит в compact (dраг-разделитель работает в обе стороны).
- Контекст расширен: `{collapsed, compact, mode, setCollapsed, setMode}` — обратная совместимость сохранена.

## 4. UX-состояния

- **Collapsed 72 px**: ☰(если шелл прячет шапку) → › развернуть → 🔍 поиск → лента иконок папок (Личные/Беседы/Задачи/кастом/ИИ/Архив, бейджи, скролл ≤38vh) → ⚙ папки → 🔔(редко); ниже — колонка аватарок: активная строка подсвечена фоном, бейдж непрочитанных угловой, черновик — карандаш, `aria-label` с именем и счётчиком; MUI `Tooltip` справа по hover/focus; ✏️ — плавающий FAB поверх списка.
- **Compact 176 px**: обычный хедер (поиск+⋯, вкладки папок), строки = аватар 40 px + имя в одну строку с ellipsis + бейдж; в шапке кнопка «Развернуть» (`OpenInFull`) и «‹» в rail; уведомления шелла в compact скрыты, чтобы не давить поиск.
- **Expanded 260–520 px**: прежний полный список + новая кнопка «Компактный список чатов» (`ViewCompactAlt`) рядом с «‹».
- Переключения: rail `›`→expanded; expanded `‹`→rail, `▣`→compact; compact `⤢`→expanded, `‹`→rail; resize-хэндл виден в compact и expanded, драг <260 px → compact, обратно ≥260 → expanded; `Enter`/двойной клик на хэндле сохранены.

## 5. Изменённые файлы

- `theme/chatTelegramTheme.js` — `compactWidth: 176`.
- `pages/chat/chatSidebarSizing.js` — константы, `SIDEBAR_MODES`, `normalizeSidebarMode`, хранилище `{width, mode}` + миграция `collapsed`.
- `pages/chat/useChatSidebarSizing.js` — режимы, `setMode`, snap-to-compact в `setWidth`, расширенный контекст.
- `components/chat/ChatSidebarSizingContext.js` — дефолты.
- `components/chat/ChatSidebarDesktopHeader.jsx` — кнопки compact-toggle в expanded/compact ветках; 🔔 шелла скрыт в compact.
- `components/chat/ChatSidebarRows.jsx` — compact-блок (имя+бейдж) в `ConversationRow`/`AiConversationRow`, `hidden={collapsed||compact}` на полном тексте, аватары 44/40 px, MUI `Tooltip` справа в collapsed (нативный `title` там убран), размеры строк.
- `e2e/chat-sidebar-modes.spec.js` — новая спека режимов + скриншоты.
- `pages/chat/ChatSidebarSizing.test.jsx` — новый compact-кейс, обновлённый folders-rail кейс, новый формат `readSidebarLayout`.

## 6. Проверки

- `npx vitest run src/pages/chat/ChatSidebarSizing.test.jsx src/components/chat/ChatSidebar.test.jsx src/components/chat/useChatSidebarSearch.test.jsx` — **52/52 passed**.
- `E2E_LOCAL=1 npx playwright test e2e/chat-sidebar-modes.spec.js` — **1 passed** (локальный стек SQLite, `e2e_admin`): логин → expanded→collapsed→compact переключения, горизонтального скролла нет ни на 1440, ни на 988×838.
- Реальные скриншоты: `WEB-itinvent/frontend/e2e-artifacts/sidebar-modes/01-expanded-1440.png`, `02-collapsed-1440.png`, `03-compact-1440.png`, `04-window-988x838.png`. Цикл фиксов по скриншотам: в compact шапка была перегружена (поиск + 🔔 + ↗ + ‹) — 🔔 скрыт в compact; повторный прогон зелёный.

## 7. Ограничения и следующие шаги

- Сиды e2e-стека содержат 1 диалог — многострочные списки/виртуализация не проверялись живьём (список уже скроллится независимо от треда).
- Не тестировалось: быстрое переключение 5+ диалогов с in-flight запросами (контракт `activeConversationId` единый, гонка не введена), zoom 125/150%, скринридер; структурно tooltip/aria-label покрыты.
- Синхронизация «выбранный чат → шапка → получатель» проверена кодово (единый prop) и e2e-выбором; специальных гонок не моделировалось.
- Публикация на IIS не выполнялась — только рабочее дерево.
