# CHAT_OFFLINE_FIX_REPORT

## Исходное состояние

- Репозиторий: `Mnogoznall2405/HUB-IT` (локально `C:\Project\Image_scan`)
- Исходный HEAD: `642462f92ec232b61daf88f61d15b301ce72b7b4`
- Область: `mobile-hub` (нативный чат, Android)
- Commit/push/APK: **не выполнялись** (по ограничениям задачи)
- Файл аудита `HUB_CHAT_OFFLINE_AUDIT.md` в репозитории не найден; выводы перепроверены по текущему коду

## Уже исправлено до этой задачи (не дублировалось)

Цепочка `persistNativeChatDraftFiles` → outbox/drafts/send: `File.copy()` уже ожидается (`await`), контракт `expo-file-system@57.0.6` соблюдён. Подробности: `documentation/technical/CHAT_ATTACHMENT_QUEUE_FIX_REPORT.md`.

## Подтверждение OFF-01…OFF-10 на текущем коде

| ID | Статус до правок | Статус после |
|----|------------------|--------------|
| OFF-01 | Подтверждён: дубли ключа заполняли лимит 1000 и вытесняли другие сущности | Исправлен |
| OFF-02 | Подтверждён: `leaveThread` ждал `markConversationRead` в `finally` | Исправлен |
| OFF-03 | Подтверждён: offline-событие в grace 30с терялось без повторной проверки | Исправлен |
| OFF-04 | Подтверждён: таймер 250 мс отменялся на unmount | Исправлен |
| OFF-05 | Условный риск: только `mountedRef` | Усилено: generation + `key={conversationId}` + scope |
| OFF-06 | Подтверждён: поиск inbox только через API | Исправлен (локальный + remote merge) |
| OFF-07 | Подтверждён: focus/jump заменяли messages и писали урезанный снимок | Исправлен (накопленная история отдельно) |
| OFF-08 | Частично: каталог ≠ история; empty vs miss | Расширено: подготовка тредов, честный empty, merge неполного каталога |
| OFF-09 | Подтверждён: composer скрывался через `canWrite = !offline` | Исправлен (compose offline + queue) |
| OFF-10 | Подтверждён: media viewer тянул серверный manifest; refresh мог стереть локальное | Частично исправлен |

Расширения поведения (не чистые регрессии): локальный поиск, ограниченная подготовка истории (12 диалогов × 80 сообщений), офлайн-очередь без сетевого send, merge свежего неполного inbox в полный кэш.

## Схема владения

```
История диалога
  экран: messages (окно просмотра)
  durable: accumulatedMessagesRef + scheduleNativeChatThreadSnapshotWrite
           → writeNativeEntitySnapshot('chat-thread-details')
  cap: 1500 сообщений, historyMayHaveGaps при разрывах

Черновики
  SecureStore / nativeChatDrafts по userId+conversationId (без изменений контракта)

Очередь
  createNativeChatOutbox (lease/generation)
  send(..., { deliver: false }) — только локальная фиксация
  доставка владельцем outbox вне случайного lifecycle экрана
  logout → clear/generation bump + bumpNativeChatThreadHistoryGeneration

Медиа
  локальный strip из accumulated/messages
  offline: без getConversationAttachments
  refresh оригинала через staging, без удаления рабочей копии до успеха
```

## Изменённые файлы (причина)

### Ядро офлайн-чата
- `mobile-hub/src/cache/nativeSnapshotCache.ts` — дедуп индекса, write-index-then-evict, монотонный `savedAt`
- `mobile-hub/src/chat/nativeChatThreadHistory.ts` — durable merge/write вне React timer
- `mobile-hub/src/chat/nativeChatLeaveThread.ts` — навигация без ожидания mark-read
- `mobile-hub/src/network/nativeConnectivityGrace.ts` — deferred offline + guaranteed recheck
- `mobile-hub/src/chat/nativeChatLocalSearch.ts` — локальный поиск диалогов/сообщений
- `mobile-hub/src/screens/chat/NativeChatThreadScreen.tsx` — OFF-02/04/05/07/08/09/10 wiring
- `mobile-hub/src/screens/chat/NativeChatInboxScreen.tsx` — OFF-06
- `mobile-hub/src/auth/AuthContext.tsx` — grace controller + history generation on logout
- `mobile-hub/src/chat/nativeChatOutbox.ts` — `deliver: false`
- `mobile-hub/src/chat/nativeChatInboxSnapshot.ts` — merge partial into complete catalog
- `mobile-hub/src/offline/nativeOfflinePreparation.ts` — ограниченная выгрузка историй
- `mobile-hub/src/files/nativeAttachmentDownloads.ts` — безопасный refresh медиа
- `mobile-hub/src/components/chat/ChatBubble.tsx` — «Ожидает подключения»
- `mobile-hub/app/(shell)/chat/[conversationId].tsx` — `key={id}`

### Тесты
- `nativeSnapshotCache.test.ts`, `nativeChatThreadHistory.test.ts`, `nativeChatLeaveThread.test.ts`
- `nativeConnectivityGrace.test.ts`, `nativeChatLocalSearch.test.ts`
- `nativeChatOutbox.test.ts`, `nativeChatInboxSnapshot.test.ts`
- правки mock в `nativeAttachmentDownloads.cleanup.test.ts`

## Совместимость данных

- Формат `chat-thread-details` расширен опциональным `historyMayHaveGaps` (старые снимки читаются)
- Индекс entity-snapshot нормализуется дедупом при записи (без wipe кэша)
- Inbox: полный каталог не заменяется первой неполной страницей; новые id мержатся
- Очередь/черновики/шифрование/app-lock не отключались

## Политика офлайн-подготовки (зафиксировано)

При отсутствии отдельных пользовательских настроек:
- каталог диалогов: постранично до `has_more=false`
- история: до **12** последних диалогов × **80** сообщений
- без безлимитного скачивания всей истории и всех видео

## Тесты

### До
Регрессии OFF-01/03/04/06/07 в отдельном виде отсутствовали или падали по описанию аудита.

### После (фактически)

Команды:
```text
npm run lint
npm test -- --testPathPattern="NativeChatScreens.test|nativeChatInboxSnapshot|NativeChatTypingPerformance|nativeSnapshotCache|nativeChatThreadHistory|nativeConnectivityGrace|nativeChatLeave|nativeChatLocalSearch|nativeChatOutbox.test" --no-coverage
npm run test:ci   # полный прогон — см. ниже
```

`npm run lint` (`tsc --noEmit`): **PASS**.

`npm run test:ci` (`jest --ci --runInBand --coverage=false`): **PASS** — 269 suites / 1668 tests (фактический полный прогон после финальных правок).

Сфокусированные suites до полного CI также проходили после правок sendScope / inbox merge / empty list.

Матрица покрытия unit-уровнем:
1–2 OFF-01 — да (`nativeSnapshotCache`)
3–4 OFF-07/04 — да (`nativeChatThreadHistory`)
5–6 OFF-02 — да (`nativeChatLeaveThread`)
7 OFF-03 — да (`nativeConnectivityGrace`, fake timers)
8 OFF-05 — generation/key; отдельный A→B Promise-тест экрана не добавлялся (частично)
9 OFF-06 — да (`nativeChatLocalSearch`)
10–11 OFF-08 — подготовка + empty copy + inbox merge
12–15 OFF-09 — outbox `deliver:false` + существующие outbox/screens тесты
16–17 OFF-10 — download staging; preview/original UI частично
18 изоляция user — существующие snapshot/outbox тесты по userId

## Android-проверка

**NOT RUN** — тестовое устройство/эмулятор в этой сессии не использовались. Зелёные Jest-тесты не являются проверкой APK.

## Оставшиеся ограничения

- Автодоставка outbox при reconnect из полностью убитого приложения не гарантируется
- Фоновая доставка вне экрана очереди по-прежнему ручная/экранная (NativeChatOutboxScreen)
- Медиа-галерея офлайн ограничена локально известными вложениями (накопленная история), не полным серверным каталогом
- Подготовка истории ограничена 12×80; старше/глубже — только если уже сохранено ранее
- Поиск сообщений офлайн помечает локальный охват; полный серверный поиск недоступен без сети
- Реакции/удаления/участники не ставятся в офлайн-очередь (намеренно)
- Wi‑Fi без VALIDATED по-прежнему может считаться connected; недоступность HUB отдельно от physical offline

## Diff своих изменений

См. рабочее дерево относительно `642462f9` (без commit). Ключевые новые файлы:
- `mobile-hub/src/chat/nativeChatThreadHistory.ts`
- `mobile-hub/src/chat/nativeChatLeaveThread.ts`
- `mobile-hub/src/chat/nativeChatLocalSearch.ts`
- `mobile-hub/src/network/nativeConnectivityGrace.ts`
- `documentation/technical/CHAT_OFFLINE_FIX_REPORT.md`

Несвязанные dirty-файлы (`POSTGRES_APP_SCHEMA*`, Construction frontend) в эту задачу не входили и не коммитились.
