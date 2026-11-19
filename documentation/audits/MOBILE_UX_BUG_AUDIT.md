# Аудит mobile-hub: баги, UX и оптимизация (статический)

Дата: 2026-11-19. Режим: только чтение кода, без запуска приложения и без изменений.
Область: `mobile-hub/src` — ~45 экранов и ~70 компонентов; приоритет — чат, почта, задачи, инвентарь/база, дашборд, навигация, уведомления, auth/updater, модалки.
Метод: статический анализ + системные поиски (таймеры/подписки без cleanup, setState-паттерны, гонки, пагинация, `keyExtractor`/виртуализация, `eslint-disable exhaustive-deps`, accessibility-имена, hit-areas, `Date.now()` в рендере, `setState`-side-effects, модалки) + сверка UX с паттернами Telegram/Gmail и гайдлайнами RN/Material (см. «Референсы»).
Severity: HIGH = блокирует задачу/неверные данные/риск потери; MEDIUM = заметный вред пониманию/эффективности/корректности; LOW = полировка/редкие кейсы.

## Подтверждённые находки

| # | Severity | Место | Проблема |
|---|----------|-------|----------|
| F1 | HIGH | `mobile-hub/src/components/mail/NativeMailHtmlBody.tsx:95-101` | `dataDocumentLoadedRef` ставится `true` после первой `data:`-навигации и **никогда не сбрасывается**. `useEffect` на `bodyHtml` (75-83) сбрасывает высоту/флаги, но не ref. Android вызывает `onShouldStartLoadWithRequest` при каждой смене `source={{ html }}`; при смене письма или переключении «Показать внешние изображения» новый документ приходит как `data:text/html` → `handleNavigation` отклоняет его → `openExternalLink('data:...')` → `getSafeNativeMailExternalUrl` пропускает только http/https/mailto/tel → навигация запрещена. Итог: после первого показанного письма следующие документы и переключение картинок визуально не меняют тело письма (остаётся старый HTML/пустой кадр). Нужно сбрасывать ref при смене `bodyHtml`/`allowExternalImages`. |
| F2 | HIGH | `mobile-hub/src/screens/mail/NativeMailComposeScreen.tsx:779-811,813` | `send` объявлен до `performSend` и вызывает его, но `performSend` отсутствует в deps `send` (подавлено `eslint-disable`). `performSend` пересоздаётся при смене `localState`, `payload`, `sendFingerprint`, `fingerprint`, `mailboxId`, `checkCurrentEditor` — а deps `send` покрывают лишь часть полей: **нет** `files` (только `files.length`), `forwardedAttachments` (только `.length`), `forwardAttachmentsPruned`, `draftId`, `mode`, `mailboxId`, `quoteHtml`, `replyToMessageId`, `forwardMessageId`. Stale-сценарии: замена файла с тем же количеством → отправляется старый список вложений; переключение «не пересылать вложения» → флаг в отправке старый → пересланные файлы уходят/не уходят вопреки выбору пользователя; та же проблема у Alert-кнопок, захватывающих `performSend` из замыкания `send`. |
| F3 | MEDIUM | `mobile-hub/src/mail/useMailList.ts:119,277,285` | `load` читает `items` для слияния страниц (`cachedItems = [...items, ...nextItems.filter(...)]`), но в deps включён только `items.length`. Обновление элементов без смены длины (realtime-правка строки) → слияние по устаревшему массиву → дубли или потерянные обновления при догрузке. Дополнительно дедуп `items.some(old => old.key === item.key)` — O(n·m) на каждую страницу; на длинной ленте растёт квадратично (Set по ключу — дешевле). |
| F4 | MEDIUM | `mobile-hub/src/navigation/useNavUnreadCounts.ts:104,120` (и `useInboxData.ts:373-379`) | Побочные эффекты внутри `setState`-апдейтера: `void setNativeBadgeCount(...)` внутри `setCounts(...)`, `trackWork('inbox-apply')`/`done()` внутри `setItems(...)`. Апдейтеры обязаны быть чистыми — React может вызывать их повторно (StrictMode dev double-invoke, concurrent re-render) → двойная запись нативного бейджа / искажённые замеры и побочный эффект в фазе рендера. Правильно: вычислить `next` в апдейтере, эффект — в `useEffect`/`then` после `set`. |
| F5 | MEDIUM | `mobile-hub/src/mail/useMailList.ts:285 + ~295-307` | `useFocusEffect` перезагрузки сознательно не включает `load` (eslint-disable) → использует устаревший `load` с замороженными `summary`, `folderTree`, `mailboxes`, `mailViewPreferences`. При `reset`-загрузке элементы подменяются ответом, но snapshot и отрисовка берут эти старые значения как fallback при частичных сбоях метаданных → сохранённый снимок может содержать устаревшие счётчики/дерево папок. Нужна перепроверка: безопасно ли опираться на устаревшие fallback-поля. |
| F6 | LOW | `mobile-hub/src/screens/monitoring/NativeMonitoringScreen.tsx:193`, `NativeMonitoringDetail.tsx:348` | `Date.now()` в JSX: длительность открытого события пересчитывается только при повторном рендере. Список опрашивается ~раз в 15 с, поэтому цифра «отстаёт» до следующего полла и зависит от случайных рендеров. Чистый рендер нарушен; корректнее тикающий `now` по таймеру только для открытых событий или пересчёт при фокусе. |
| F7 | LOW | `mobile-hub/src/screens/mail/NativeMailInboxScreen.tsx:79-80`, `dashboard/dashboardFormat.ts:91-92`, `addressBook/addressBookFormat.ts:195-196`, `components/chat/PresenceAvatar.tsx:18-19` (+ `companyPersonInitials`) | Инициалы берут `str[0]`/`slice(0,2)` — UTF-16 code units. Имя, начинающееся с символа вне BMP (emoji, редкие CJK), даст «битый» инициал (половина суррогатной пары). Для `words[0][0]` аналогично. Правильно: `Array.from(str)`/`[...str]` для code points. |
| F8 | LOW | `mobile-hub/src/components/warehouse1c/NativeWarehouse1CFilterRow.tsx:110` | `activeChipClear` 22×22 px + `hitSlop 8` → фактическая зона ~38 dp < 44 dp (HIG) / 48 dp (Material). Аналогично проверить `NativeTaskCreateScreen.tsx:966` (`check` 24 px без hitSlop в стиле) и `ChatImageEditorSheet.tsx:907` (`color` 36 px) — у части кнопок зона касания ниже рекомендованной. |

## Рассмотрено и отклонено (не баги)

- **Модалки без `onRequestClose`** — все ~30 использований `NativeModal`/`Modal` в `src` передают `onRequestClose`; Android back закрывает шторки. `NativeModal` (`components/ui/NativeModal.tsx`) дополнительно отключает анимацию при reduced-motion — плюс.
- **Слушатели в injected JS `NativeMailHtmlBody`/`ChatVideoPlayer`** — `load`/`click`/`ResizeObserver` живут внутри документа WebView и умирают вместе с ним; object URL в плеере ревокаются при замене и `pagehide`. Утечки нет (runtime-проверка не проводилась — см. ограничения).
- **`renderedSession !== session` → setState в рендере (`useMailQuickReplyDraft.ts:25`)** — это документированный React-паттерн «adjust state during render», а не баг.
- **`FlatList` без `keyExtractor`** — все реальные списки (`NativeChatInboxScreen`, `NativeChatThreadScreen`, mail, tasks, database, notifications) имеют явные стабильные ключи и настроенную виртуализацию; 3 файла-исключения (`chatState.ts`, `useThreadRender`, `useThreadScrollAnchor`) — не списки.
- **Подписки `chatSocket.on`/`inboxEvents` в `useInboxData`** — все сохранены в `off*` и сняты в cleanup; `typing`-таймеры очищаются.
- **`useNavUnreadCounts` polling** — полный cleanup интервала, debounce и подписок; пропускает опрос при offline/background/connected realtime.
- **`PasswordVisibilityCountdown` (`NativePasswordsScreen.tsx:112-115`)** — интервал 1 с с корректным cleanup; изолирован в мелком компоненте.
- **`ChatAnimatedSticker`** — ограничение ≤4 живых плееров + error boundary + освобождение слота — осознанная защита.
- **`DashboardScreen key={Number(user?.id)}`** — `user.id` числовой по типу; remount при смене пользователя — намеренный.
- **`exhaustive-deps` в `NativeMailRichEditor.tsx:55,84`, `NativeTasksInboxScreen.tsx:358`, `NativeMonitoringDetail.tsx:157`, `NativeMailComposeScreen.tsx:452`** — эффекты «только при инициализации/фокусе» с осознанно ограниченными deps; явного stale-бага (как в F2) там не подтверждено, но они разделяют риск — см. рекомендации.
- **`initials` single-word `slice(0,2)`** — намеренный выбор 2 букв, а не 1 — совпадает с Gmail-паттерном; оставлено как есть (кроме суррогатного кейса F7).
- **`send`/`performSend` взаимная TDZ-ошибка** — `const performSend` объявлен после `send`, но вызов происходит по клику после инициализации — runtime-ошибки нет; проблема только в stale deps (F2).

## Ограничения верификации

- Без эмулятора/устройства: визуальные утверждения (контраст, переполнение текста, анимации) не проверялись на экране — статические выводы по стилям.
- Покрытие: системные поиски — по всему `mobile-hub/src`; глубокий ручной разбор — чат (inbox/thread/data), почта (inbox/compose/message/html-body/quick-reply), задачи, мониторинг, пароли, дашборд, навигация, realtime-сокет, модалки. Экраны вне этого списка покрыты автоматическими паттернами, но не построчным чтением.
- Runtime-утверждения по подпискам/утечкам WebView помечены как статические выводы — подтверждать на устройстве через профайлер/Flipper при необходимости.

## Рекомендации по дизайну (сверка с референсами)

- **Почта**: Gmail-паттерны (свайп-действия, мультивыбор, «отправлено в папку Sent») уже частично есть; по F1/F2 до исправления возможны «застывшее тело письма» и отправка устаревшего состояния — исправление приоритетнее новых UX-фич.
- **Чат**: список и тред соответствуют Telegram-паттернам (inverted list, reply-preview, typing-индикаторы, anchors). Следить за чистотой `setState`-апдейтеров (F4) — единственный системный антипаттерн.
- **Hit-areas**: выборочно <44 dp у мелких icon-only элементов (F8) — Telegram/Gmail держат ≥44 pt; рекомендуется пройтись по `height/width < 30` у интерактивных элементов без `hitSlop`.
- **Общее**: realtime-обработчики и таймеры в основном с правильным cleanup — архитектура сокетов/polling зрелая; главные риски — stale closures за `eslint-disable exhaustive-deps` и impure `setState`-апдейтеры.

## Референсы (использованные паттерны)

- React Native: `Optimizing FlatList`, `FlatList` docs (stable keys, `removeClippedSubviews` осторожность).
- Почта: Gmail iOS critique (ixd.prattsi.org), Google Mail swipe/multi-select/refresh-preserving-content.
- Чат: Telegram iOS design kit + PageFlows chat flow (swipe-to-reply, стабильные строки, reply-preview).
- Мобильный UX: UXCam mobile UX guide, Android «UI for billions», HIG/Material 44-48 dp touch target.

## Итоговая оценка

**Needs changes** — два HIGH-бага (F1 «застывающее» тело письма, F2 отправка устаревшего состояния письма) блокируют корректную работу ключевого потока почты. После их исправления и закрытия MEDIUM (F3-F5) остаток — полировка (F6-F8).
