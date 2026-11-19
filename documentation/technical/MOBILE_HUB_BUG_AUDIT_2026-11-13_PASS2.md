# Mobile-hub: новый аудит после исправлений (проход 2)

Дата: 13.11.2026.
Область: только `mobile-hub`. Проверка read-only: код не изменялся, production не затрагивался.
Метод: статический разбор кода и сверка с backend-контрактами. Устройство, эмулятор и APK не запускались, поэтому все пункты ниже — **подтверждено по коду**, а не воспроизведено на устройстве.

Статус исправлений после правок 11:25–11:37: [MOBILE_HUB_PASS2_FIX_REVIEW_2026-11-13.md](MOBILE_HUB_PASS2_FIX_REVIEW_2026-11-13.md). Закрыты 13 из 14; MB2-04 не закрыт, MB2-03 требует миграции.

## 1. Итог

Найдено 14 новых дефектов, не пересекающихся с MB-01…MB-14 из предыдущего отчёта.

| ID | Severity | Область | Кратко |
|---|---|---|---|
| MB2-01 | высокий | админка | гонка при открытии пользователя: помощники чужого пользователя сохраняются текущему |
| MB2-02 | высокий | задачи | форма редактирования ломается у пользователей без `settings.read` |
| MB2-03 | средний | почта | черновик пересылки теряет список удалённых вложений |
| MB2-04 | средний | My Files | повторная загрузка после потерянного ответа `complete` создаёт дубль |
| MB2-05 | средний | чат | подтверждённая, но не удалённая запись outbox блокирует FIFO диалога |
| MB2-06 | средний | чат | очистка черновика после отправки затирает более новый черновик |
| MB2-07 | средний | задачи | аналитика сбрасывается на 30 дней при восстановлении сети |
| MB2-08 | средний | почта | undo архив/удаление возвращает письмо в текущую папку, а не в исходную |
| MB2-09 | средний | безопасность | таймаут блокировки «0 секунд» превращается в 900 при повторном включении |
| MB2-10 | низкий | навигация | сохранённый порядок кнопок нижней панели игнорируется |
| MB2-11 | низкий | навигация | «Справка» выбирается в настройках, но молча выбрасывается при сохранении |
| MB2-12 | низкий | задачи | введённый текст чек-листа теряется при отметке другого пункта |
| MB2-13 | низкий | склад 1С | pull-to-refresh зависает офлайн; сброс фильтров не перезагружает остатки |
| MB2-14 | низкий | задачи | e-mail-напоминание не очищается пустым полем; диапазон шире серверного |

Приоритет исправлений: MB2-01 и MB2-02 — до релиза; MB2-03, MB2-05, MB2-06 — следующими; остальное — планово.

## 2. Детали

### MB2-01. Гонка при открытии пользователя в админке

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/account/NativeAdminUsersScreen.tsx:303-330`, сохранение — `:273-277`.

```tsx
const openUser = useCallback(async (item: userAdminApi.AdminUser) => {
  setDraft(draftFromUser(item));
  setDelegateLinks([]);
  ...
  const links = await userAdminApi.getTaskDelegates(item.id);
  if (!mounted.current) return;
  setDelegateLinks(links);
  ...
  setDelegateCandidates(result.items);
}, []);
```

`mounted` проверяет только то, что экран ещё жив, но не то, что открыт всё ещё пользователь `item`. Если админ открыл A, сразу вернулся и открыл B, ответ `getTaskDelegates(A)` может прийти после ответа B и записать помощников A в форму B. `saveUser` затем отправляет `delegateLinks` вместе с `draft.id` пользователя B (`:273-277`). Итог — чужие помощники/заместители получают делегирование от B (или наоборот), то есть меняются права доступа.

**Что сделать:** ввести `openUserRequestRef`/проверку `draft.id === item.id` перед каждым `setDelegateLinks`/`setDelegateCandidates`; при смене пользователя инвалидировать предыдущий запрос.

### MB2-02. Редактирование задачи недоступно без `settings.read`

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:503-517`; контраст с `NativeTaskCreateScreen.tsx:90,198`; backend — `WEB-itinvent/backend/api/v1/departments.py:17-21`.

```tsx
void Promise.all([
  searchTaskAssignees('', 100),
  searchTaskControllers('', 100),
  getTaskProjects(),
  getTaskObjects(),
  listDepartments(),
]).then(([assignees, controllers, projects, objects, departments]) => {
  ...
}).catch((cause) => {
  setError(formatApiError(cause, 'Не удалось загрузить справочники...'));
});
```

`GET /departments` требует `settings.read` или `departments.manage`. У автора задачи с `tasks.write`, но без этих прав, запрос возвращает 403. Из-за `Promise.all` отклоняется весь набор: остаются пустыми не только отделы, но и исполнители, контролёры, проекты и объекты. Экран создания уже учитывает это через `canReadDepartments`, экран редактирования — нет.

**Сценарий:** сотрудник открывает свою задачу, нажимает «Редактировать», видит ошибку и не может сменить исполнителя/проект/объект.

**Что сделать:** повторить проверку `settings.read || departments.manage` и подставлять `Promise.resolve([])`; либо перейти на `Promise.allSettled`, чтобы отказ одного справочника не обнулял остальные.

### MB2-03. Черновик пересылки теряет список удалённых вложений

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/api/mailApi.ts:541-554` и `:574-577`; `mobile-hub/src/screens/mail/NativeMailComposeScreen.tsx:531`; backend — `WEB-itinvent/backend/services/mail_send_pipeline.py:165-168,221-240`.

`saveMailDraft` отправляет `appendComposeFields`, `compose_mode` и файлы, но не `forward_attachment_refs_json`; этот параметр есть только у `sendMailMessage`. Backend `POST /mail/drafts/upsert-multipart` (`mail.py:2119-2173`) такой параметр не принимает. При открытии сохранённого черновика `forward_message_id` восстанавливается из `draft_context`, а `forwardedAttachments` остаётся пустым, поэтому `forwardAttachmentsPruned=false` и в send не уходит список refs. Backend в этом случае пересылает **все** вложения исходного письма.

**Сценарий:** пользователь пересылает письмо, снимает вложение с конфиденциальным файлом, сохраняет черновик, открывает его позже и отправляет. Удалённое вложение возвращается в письмо.

**Что сделать:** добавить `forward_attachment_refs_json` в upsert-контракт и в `saveMailDraft`, сохранять/восстанавливать `forwardAttachmentsPruned` и точный список; до этого — не разрешать prune при сохранении в серверный черновик.

### MB2-04. Повторная загрузка в My Files после потерянного `complete`

**Severity: средний. Confidence: средняя.**
`mobile-hub/src/myFiles/nativeMyFilesTransfers.ts:179-193,328-333,401-404`.

```ts
const session = await getMyFileUploadSession(fileId, signal);
if (session.file_size_bytes !== expectedSize || session.complete) return null;
...
const completed = await completeMyFileUploadSession(fileId, signal);
await clearUploadResume(resumeKey);
```

Если сервер завершил сессию, а ответ `complete` потерялся (таймаут/обрыв), клиент считает ошибку сетевой и сохраняет resume-ключ. При повторе `findResumableUploadSession` видит `session.complete === true` и возвращает `null`, после чего создаётся новая upload-сессия. Файл с тем же именем загружается второй раз; дедупликации по имени в этом пути нет.

**Что сделать:** если старая сессия уже `complete`, получать её файл и возвращать его как результат; удалять resume-ключ только после подтверждённого `complete` или успешной сверки с сервером.

### MB2-05. «Подтверждённая» запись outbox блокирует очередь диалога

**Severity: средний (узкий триггер). Confidence: средняя.**
`mobile-hub/src/chat/nativeChatOutbox.ts:315-323,360-380`; `mobile-hub/src/chat/nativeChatDeliveryRunner.ts:136-145`.

```ts
const ack = d.confirmed || acknowledgements.get(operationKey);
if (ack) return { ...row, delivery: { ...d, state: 'confirmed', confirmed: ack } };
...
if (rows.slice(0,index).some((before) => {
  ...
  if (beforeState === 'cancelled' || beforeState === 'paused') return false;
  return beforeState !== 'retry' || (before.notBefore || 0) <= fifoNow;
})) throw noWork();
```

Если сообщение получило ACK, но `persistConfirmed`/`removeConfirmed` не смогли удалить строку, она остаётся в состоянии `confirmed`. FIFO-проверка считает такую строку блокирующей (она не `cancelled`/`paused` и не `retry`), поэтому все следующие сообщения этого диалога получают `noWork`. Runner повторяет коммит подтверждённой строки ограниченное число раз, после чего оставляет её «до внешнего пробуждения».

**Сценарий:** серия сбоев записи истории после успешной отправки — следующие сообщения в этом чате не уходят, хотя сеть есть. После перезапуска очередь может восстановиться, но при повторных сбоях истории — снова застрянет.

**Что сделать:** не считать `confirmed`-строку блокирующей FIFO (она уже доставлена); вынести её в отдельную cleanup-очередь и не смешивать с неподтверждёнными.

### MB2-06. Очистка черновика после отправки затирает новый текст

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/chat/useThreadSend.ts:280-286`; `mobile-hub/src/chat/chatDrafts.ts:225-227`.

```ts
setText('');
setComposerMode(null);
const postClearRevision = textRevisionRef.current;
const sending = sendBody(body, undefined, replyPreview, true, () => {
  ...
  if (user?.id) void clearNativeChatDraft(user.id, conversationId).catch(() => undefined);
}, ...);
```

`setText('')` освобождает поле сразу, и пользователь может начать следующее сообщение, пока HTTP-запрос ещё летит. Колбэк успеха вызывается после ACK и безусловно удаляет черновик диалога, включая уже сохранённый новый текст. `textRevisionRef` защищает только ветку ошибки, не успеха.

**Сценарий:** отправить сообщение, быстро начать печатать следующее, дождаться галочки, перезапустить приложение — второй черновик исчез.

**Что сделать:** удалять только тот draft revision, который был отправлен; перед очисткой сравнить текущий текст/ревизию с отправленным снимком.

### MB2-07. Аналитика задач сбрасывается при восстановлении сети

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskAnalyticsScreen.tsx:211-212,243-257`.

```tsx
const [filters, setFilters] = useState<AnalyticsFilters>(initialFilters);
const [applied, setApplied] = useState<AnalyticsFilters>(initialFilters);
...
useEffect(() => {
  if (!allowed || offlineMode) { setLoading(false); return; }
  let active = true;
  const current = initialFilters();
  void load(current);
  ...
}, [allowed, load, offlineMode]);
```

При каждом изменении `offlineMode` (потеря/восстановление сети) эффект заново вызывает `load(initialFilters())` и через `load` выставляет `applied` в последние 30 дней. Пользовательские `filters` при этом не сбрасываются, поэтому чипы могут показывать выбранный период/проект, а данные — уже другие.

**Что сделать:** не переинициализировать фильтры по `offlineMode`; при возврате сети повторять последний `applied`, а `initialFilters()` использовать только при первом монтировании.

### MB2-08. Undo в почте возвращает письмо не в исходную папку

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/mail/NativeMailInboxScreen.tsx:437,452,499-503`; поле папки есть в `mailApi.ts:29`.

```tsx
setUndo({
  kind: 'archive',
  scope: listScope,
  messageId: item.id,
  mailboxId: scopedMailboxId,
  targetFolder: folder,
  ...
});
...
await moveMailMessage(pending.messageId, pending.mailboxId, pending.targetFolder);
```

`targetFolder` берётся из текущей папки списка. При фильтре «во всех папках» (`folderScope=all`) письмо может быть из архива или «Отправленных», а undo вернёт его в текущую папку (обычно inbox). Для `delete` аналогично используется `targetFolder: folder` при restore.

**Что сделать:** сохранять в undo `item.value.folder` (или `restore_hint_folder`) и использовать его; для delete — `restore_hint_folder` из ответа сервера.

### MB2-09. Таймаут блокировки «0» превращается в 900 секунд

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/account/NativeSecuritySettingsScreen.tsx:266-268`; варианты — `mobile-hub/src/auth/biometricAuth.ts:13`.

```tsx
const nextTimeout = value
  ? (timeoutSeconds > 0 ? timeoutSeconds : 900)
  : timeoutSeconds;
```

`APP_LOCK_TIMEOUT_OPTIONS` содержит `0` — блокировать сразу. Если пользователь выбрал 0, выключил и снова включил блокировку, `timeoutSeconds > 0` ложно и подставляется 900. Вместо мгновенной блокировки получается 15 минут — ослабление защиты без явного выбора пользователя.

**Что сделать:** различать «0 — валидное значение» и «значение не задано»; при повторном включении сохранять последний выбранный таймаут, включая 0.

### MB2-10. Порядок кнопок нижней панели не применяется

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/navigation/mobileNavItems.ts:143-146`; настройки — `NativeAppearanceSettingsScreen.tsx:81,149-159`.

```ts
return [
  ...visibleItems.filter((item) => selectedPathSet.has(item.path)).slice(0, 4),
  mobileMenuNavigationItem,
];
```

Настройки сохраняют `mobile_bottom_nav_items` как упорядоченный массив, показывают предпросмотр и кнопки «вверх/вниз». Но `resolveMobileNavigationItems` собирает `Set` и фильтрует `visibleItems` в каталожном порядке, поэтому сохранённый порядок не влияет на реальную панель. Пользователь меняет порядок, сохраняет, но видит прежний.

**Что сделать:** строить результат в порядке `selectedPaths`, а не `visibleItems`.

### MB2-11. «Справка» молча выбрасывается из нижней панели

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/navigation/mobileNavItems.ts:63`; `mobile-hub/src/preferences/preferenceNormalizers.ts:3-23,53-69`; `NativeAppearanceSettingsScreen.tsx:33-44`.

`/help` есть в `navigationItems` и попадает в `availableItems` настроек, поэтому его можно выбрать. Но `MOBILE_BOTTOM_NAV_ALLOWED_PATHS` не содержит `/help`, и `normalizeMobileBottomNavItems` отфильтровывает путь. Если вместе с «Справкой» выбраны другие пункты, она исчезает молча; если только она — срабатывает fallback на дефолтный набор.

**Что сделать:** либо добавить `/help` в allowlist, либо исключить его из `availableItems` с пояснением.

### MB2-12. Текст нового пункта чек-листа теряется при отметке

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:609-611,630-636`.

```ts
const updated = await updateTask(task.id, { checklist_items: items });
setTask(updated);
setChecklistText('');
...
const toggleChecklistItem = useCallback((item) => {
  ...
  void saveChecklist(current.map(...), ...);
}, [saveChecklist, task]);
```

`saveChecklist` используется и для добавления, и для toggle/remove, и всегда очищает `checklistText`. Если пользователь начал вводить новый пункт и отметил существующий, введённый текст исчезает.

**Что сделать:** очищать поле только в `addChecklistItem` после успешного добавления.

### MB2-13. Остатки 1С: зависший refresh и сброс без перезагрузки

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/screens/warehouse1c/NativeWarehouse1CScreen.tsx:142-146,434`; `NativeWarehouse1CBalancesPanel.tsx:224`.

`onRefresh` сначала делает `setBalRefreshing(true)`, затем вызывает `loadBalances()`. В офлайне или без права чтения `loadBalances` выходит до `finally`, поэтому `balRefreshing` остаётся `true` — индикатор крутится, пока экран не перемонтируется. Отдельно `onReset` очищает фильтры и закрывает шторку, но не запускает поиск: на экране остаются старые отфильтрованные строки и «Найдено N» без активных чипов.

**Что сделать:** сбрасывать `balRefreshing` во всех ранних выходах; после reset либо перезагружать остатки, либо очищать список и `balSearched`.

### MB2-14. E-mail-напоминание: пустое поле не очищает, диапазон шире серверного

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:571-575,592`; backend — `hub_service.py:7515-7526`, `task_email_outbox_service.py:43-56`.

```ts
const reminder = editEmailReminder.trim() === '' ? undefined : Number(editEmailReminder);
...
email_deadline_remind_hours: dueAt ? reminder : undefined,
```

Пустая строка превращается в `undefined`, а `undefined` не попадает в JSON — backend не видит ключ и оставляет прежнее значение. Очистить напоминание можно только вводом `0`, что неочевидно. Кроме того, мобильная проверка разрешает 0–720 часов, а backend — 0–168; значение 200 проходит клиентскую валидацию и отклоняется сервером.

**Что сделать:** отправлять `null`/`0` при пустом поле (и обновлять контракт), привести диапазон к 0–168 и подписать «0 — не напоминать».

## 3. Что проверено и не включено

- **Docflow, лимит 50** (`NativeDocflowInboxScreen.tsx:53,470,496`) — не дефект: интерфейс явно показывает `+` и «Показаны первые 50 заданий».
- **Гонка переключения ящика в папках почты** (`NativeMailFoldersScreen.tsx:87-120`) — не подтверждена: `requestRef`/lease отсекает устаревшие ответы.
- **`mark-all-read` при `ok:false`** — обработка слабее, чем заявлялось, но без подтверждённого сценария потери данных в отчёт не включена.
- **Напоминание с `0`** — технический обходной путь существует, поэтому дефект ограничен пустым полем и диапазоном.

## 4. Ограничения

- Устройство/эмулятор не запускались; все выводы статические, с проверкой по коду и backend-контрактам.
- Для MB2-04 и MB2-05 важен реальный сценарий сбоя сети/записи; на устройстве они не воспроизводились.
- Оценка severity учитывает пользовательский эффект, но не частоту: MB2-05 требует редкого сочетания сбоев.
