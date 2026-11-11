# Отчёт: исправление очереди исходящих вложений (mobile-hub)

| Поле | Значение |
|---|---|
| Дата | 2026-09-07 |
| Исходный HEAD | `642462f92ec232b61daf88f61d15b301ce72b7b4` |
| Сравнение с | `7ebc124ba2743ef7a5b006973d707b6403c57199` |
| Область | `mobile-hub` native Chat outbox / draft files |
| Commit / push / APK | не выполнялись (по ограничению задачи) |

## Версия expo-file-system

- В `package.json`: `expo-file-system ~57.0.5`
- Установлено: **`57.0.6`**
- Контракт `File.copy(destination, options?)`: **`Promise<void>`**  
  (`node_modules/expo-file-system/src/internal/NativeFileSystem.types.ts`, строки около 90 / 240)
- Есть отдельный синхронный `copySync(...)` — **не использовался** в исправлении

## Подтверждённая причина

Файл: `mobile-hub/src/chat/nativeChatDraftFiles.ts`, функция `persistNativeChatDraftFiles`.

До исправления:

```ts
source.copy(destination);
if (!destination.exists || destination.size !== source.size) {
  throw new Error('Не удалось проверить копию вложения');
}
```

`copy()` возвращает Promise, проверка размера выполнялась сразу, до завершения копирования. Ошибка возникала **на этапе локального сохранения**, до записи метаданных очереди и до HTTP `sendFileMessage`.

Цепочка:

выбор/редактор → `sendPickedFiles` → `outbox.prepareUpload` → `put` → `persistNativeChatDraftFiles` → SecureStore outbox → `buildAttachmentsFormData` → `sendFileMessage` → ACK → cleanup

## Регрессионный тест

Файл: `mobile-hub/src/chat/nativeChatDraftFiles.test.ts`  
Сценарий: управляемый deferred `Promise` для `File.prototype.copy` (без таймеров).

Доказательство поведения:

| Состояние | Результат |
|---|---|
| Исходная синхронная проверка без `await` | Promise от `copy` ещё не resolved → destination пуст/размер не совпадает → throw «Не удалось проверить копию» / «Не удалось сохранить вложение…»; запись очереди и HTTP не начинаются |
| После `await source.copy(destination)` | функция не resolved до `releaseCopy()`; после разрешения копия валидна по содержимому и размеру |

Дополнительные регрессии:

- async reject `copy` → понятная ошибка, исходник на месте, неполная destination удаляется
- несколько файлов: последовательный `for...of`; ошибка второго не маскируется под полный успех
- outbox: нет `SecureStore.setItemAsync` / записи очереди до завершения copy
- outbox: logout во время copy → отказ без resurrect сессии
- drafts: прежний черновик сохраняется при ошибке copy / ошибке записи метаданных
- retry `prepareUpload` → тот же `client_message_id`, одна запись очереди

## Изменённые файлы

| Файл | Назначение |
|---|---|
| `src/chat/nativeChatDraftFiles.ts` | `persistNativeChatDraftFiles` → `async`, `await source.copy`, последовательный цикл, безопасная очистка неполной копии |
| `src/chat/nativeChatOutbox.ts` | `await` копий до формирования `durableUpload` и `writeAll`; повторный `assertCurrent` / `assertNotDiscarded` после copy |
| `src/chat/chatDrafts.ts` | `await` копий до `saveDrafts`; прежняя запись на диске не стирается при ошибке |
| `src/screens/chat/NativeChatThreadScreen.tsx` | разделение ошибок: до сохранения в очередь / после; `recordDiagnosticEvent('native_file_error')` без путей и контента |
| `src/chat/nativeChatDraftFiles.test.ts` | async API + deferred-copy / reject / batch |
| `src/chat/nativeChatOutbox.test.ts` | deferred copy, reject, logout mid-copy, retry same id |
| `src/chat/chatDrafts.test.ts` | copy fail / metadata fail сохраняют прежний черновик |
| `src/chat/nativeChatFileLifecycle.test.ts` | `await` persist |
| `src/screens/chat/NativeChatScreens.test.tsx` | mock persist → `async` |
| `src/screens/chat/NativeChatOutboxScreen.test.tsx` | mock persist → `async` |

## Сохранённое поведение

- Очередь outbox / SecureStore формат **не менялись**
- Повторное использование проверенной копии, изоляция по `userId`, восстановление после удаления picker-cache — сохранены
- Composer (текст / вложения / reply) очищается **только после** успешного `prepareUpload`
- Cleanup после ACK по-прежнему `.catch(() => undefined)` — ошибка локальной очистки не превращает ACK в failed
- `client_message_id` при retry тот же; вторая запись не создаётся
- Logout (`generation++`) отменяет незавершённый `put` после copy через `assertCurrent`

## Команды и результаты

```text
npm run lint                 # tsc --noEmit — OK
npx jest src/chat/nativeChatDraftFiles.test.ts \
         src/chat/nativeChatOutbox.test.ts \
         src/chat/chatDrafts.test.ts \
         src/chat/nativeChatFileLifecycle.test.ts \
         src/screens/chat/NativeChatOutboxScreen.test.tsx --runInBand
# 5 suites / 90 tests — passed

npx jest src/screens/chat/NativeChatScreens.test.tsx --runInBand
# 91 tests — passed

npm run test:ci
# 265 suites / 1655 tests — passed (199.85 s)
```

Падений, существовавших до правки, в этих прогонах не выявлено.

## Android-проверка

**Не выполнялась:** эмулятор/устройство с тестовым окружением в этой сессии не использовались.  
Зелёный `test:ci` **не** заменяет проверку на устройстве (галерея / камера / редактор / offline / kill-restart).

## Оставшиеся риски

1. Нужна ручная Android-приёмка сценариев A–И на устройстве.
2. Ошибки **отображения уже полученного** фото не исследовались и не менялись (отдельная область).
3. При ошибке `assertCurrent` после успешного copy возможны кратковременные orphan-файлы в `hubit-chat-draft-files/<userId>/` без записи в SecureStore; существующий inventory/cleanup их не удаляет автоматически, пока нет sweep.
4. `File.copy` в Jest-моке по умолчанию завершается сразу через `copySync`; регрессия ловится только тестами с явным deferred Promise.

## Diff (свои изменения)

```text
 mobile-hub/src/chat/chatDrafts.test.ts             |  43 +++++++
 mobile-hub/src/chat/chatDrafts.ts                  |  12 +-
 mobile-hub/src/chat/nativeChatDraftFiles.test.ts   | 136 ++++++++++++++++++---
 mobile-hub/src/chat/nativeChatDraftFiles.ts        |  45 +++++--
 mobile-hub/src/chat/nativeChatFileLifecycle.test.ts|   4 +-
 mobile-hub/src/chat/nativeChatOutbox.test.ts       | 122 ++++++++++++++++++
 mobile-hub/src/chat/nativeChatOutbox.ts            |   9 +-
 .../screens/chat/NativeChatOutboxScreen.test.tsx   |   2 +-
 .../src/screens/chat/NativeChatScreens.test.tsx    |   2 +-
 .../src/screens/chat/NativeChatThreadScreen.tsx    |  22 ++++
 10 files changed, 362 insertions(+), 35 deletions(-)
```

В рабочем дереве также есть чужие незакоммиченные правки (`documentation/technical/POSTGRES_APP_SCHEMA*.md`) — **не входят** в этот фикс и не смешивались с ним.
