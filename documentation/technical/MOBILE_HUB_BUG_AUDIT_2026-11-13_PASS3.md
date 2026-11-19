# Mobile-hub: аудит после исправлений, проход 3

Дата: 13.11.2026.
Область: только `mobile-hub`. Проверка read-only: код не изменялся, production не затрагивался.
Статус исправлений: [MOBILE_HUB_PASS3_FIX_REVIEW_2026-11-13.md](MOBILE_HUB_PASS3_FIX_REVIEW_2026-11-13.md).
Метод: статический разбор mobile-клиента и сверка с backend-контрактами. Устройство/эмулятор/APK не запускались.

Не включены уже известные и исправленные MB-01…MB-14 и MB2-01…MB2-14, а также неподтверждённые кандидаты (гонка папок почты, дубль observer=assignee — backend его отфильтровывает).

## 1. Итог

Найдено **17 новых дефектов**: 5 высоких, 9 средних, 3 низких.

| ID | Severity | Область | Кратко |
|---|---|---|---|
| MB3-01 | высокий | оборудование | передача уходит на старые филиал/размещение и старый комментарий |
| MB3-02 | высокий | расходники | пустое поле «Остаток» записывает 0 |
| MB3-03 | высокий | задачи | повторная загрузка после создания игнорирует правки и файлы, «плохой» файл нельзя убрать |
| MB3-04 | высокий | задачи | редактирование отправляет устаревший полный снимок и затирает параллельные изменения участников |
| MB3-05 | высокий | почта | выбор писем переживает смену фильтра и применяется к скрытым письмам |
| MB3-06 | средний | лента | «Опубликовать» после сбоя загрузки вложения не публикует пост |
| MB3-07 | средний | задачи | после перехода статуса не обновляются история и комментарий действия |
| MB3-08 | средний | задачи | ошибка комментариев/истории затирает офлайн-снимок задачи |
| MB3-09 | средний | задачи | текст, набранный во время отправки комментария, стирается |
| MB3-10 | средний | база данных | кэш фото/актов не учитывает базу, возможен файл из другой базы |
| MB3-11 | средний | лента | deep link на пост/комментарий открывает только список |
| MB3-12 | средний | чат | поиск и пересылка видят только первые 50 диалогов |
| MB3-13 | средний | чат | повтор task-share отправляется как обычный текст и ломает карточку |
| MB3-14 | средний | пароли | после смены пароля на экране остаётся старый раскрытый пароль |
| MB3-15 | низкий | Scan Center | автообновление каждые 30 с сбрасывает загруженные страницы |
| MB3-16 | низкий | почта | дельта непрочитанного применяется к текущей папке, а не к папке письма |
| MB3-17 | низкий | Docflow | автоопрос создания поручения идёт примерно каждые 0,75 с вместо 3 с |

## 2. Детали

### MB3-01. Передача оборудования на старые филиал/размещение

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/components/database/NativeEquipmentActions.tsx:172-182`, `:303-331`, `:457-474`; использование — `NativeEquipmentDetailScreen.tsx:1047`, `NativeDatabaseScreen.tsx:2010`.

```tsx
const [branchNo, setBranchNo] = useState(equipment.branch_no ?? null);
const [locationNo, setLocationNo] = useState(equipment.loc_no ?? null);
...
const [comment, setComment] = useState('');
```

`branchNo`, `locationNo` и `comment` инициализируются один раз и не синхронизируются с обновлённым `equipment`. `close()` сбрасывает сотрудника, отдел и issuer, но не филиал, размещение и комментарий. Компонент не перемонтируется: в карточке он живёт, пока `equipment != null`, в списке — пока выбрано оборудование.

**Сценарий:** открыть карточку, обновить её после переноса другим оператором, затем «Сменить размещение» — форма покажет и отправит старые `branch_no`/`loc_no`. Аналогично после собственной передачи: закрыть шторку, открыть снова — снова старые значения. Комментарий предыдущей операции подставляется в следующую.

**Что сделать:** синхронизировать `branchNo`/`locationNo` при изменении `equipment` (или при `openAction`), очищать `comment` в `close()`, сбрасывать состояние при смене `equipment.inv_no`.

### MB3-02. Пустой «Остаток» записывает 0

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/database/NativeDatabaseScreen.tsx:1661-1671`; диалог — `:2065-2075`.

```ts
const qty = Number(quantityDraft.trim());
if (!Number.isInteger(qty) || qty < 0) {
  setError('Количество должно быть целым неотрицательным числом.');
  return;
}
```

`Number('') === 0`, поэтому пустое поле проходит проверку. Кнопка «Сохранить» блокируется только по `quantityBusy`, не по пустому вводу. Пользователь очищает поле, чтобы набрать новое число, нажимает «Сохранить» — уходит `qty = 0`, показывается «Остаток обновлён».

**Что сделать:** проверять `quantityDraft.trim() !== ''` до `Number(...)`; блокировать сохранение при пустом вводе.

### MB3-03. Восстановление загрузки после создания задачи теряет правки и файлы

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskCreateScreen.tsx:396-432`, `:474`.

```ts
for (const item of [...recovery.pending]) {
  try { await uploadTaskAttachment(item.taskId, item.file); }
  catch { continue; }
  ...
}
if (recovery.pending.length) {
  setError(`Задачи созданы. Не загружено вложений: ${recovery.pending.length}...`);
  return;
}
```

После создания задачи с частично неудавшимися вложениями экран остаётся редактируемым, но кнопка становится «Повторить загрузку» и `submit()` использует только `recovery.pending`, зафиксированный при создании. Новые файлы не загружаются, удалённый файл всё равно загружается, изменения названия/описания не применяются. Если файл постоянно отклоняется (413/400), убрать его из `recovery.pending` через UI нельзя: кнопка «Убрать» меняет только `files`. В ветке частичного создания (`created.failed`) ошибки загрузки в успешные задачи только считаются, после чего `uploadRecovery` обнуляется (`:396-404`) — восстановить эти вложения уже нельзя.

**Что сделать:** при повторе строить `pending` из текущих `files` и обновлять уже созданные задачи; дать удаление/исключение конкретного файла из recovery; не обнулять recovery при частичном создании, пока есть недоставленные файлы.

### MB3-04. Редактирование задачи затирает параллельные изменения участников

**Severity: высокий. Confidence: высокая (клиент), средняя (частота).**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:584-598`, `:475-499`; backend — `WEB-itinvent/backend/services/hub_service.py:7402-7503`.

```ts
const updated = await updateTask(task.id, {
  title,
  description: editDescription.trim(),
  due_at: dueAt,
  priority: editPriority,
  protocol_date: protocolDate || undefined,
  assignee_user_ids: editAssigneeIds,
  controller_user_id: editControllerId,
  observer_user_ids: editObserverIds,
  project_id: editProjectId || undefined,
  ...
});
```

`openEdit` запоминает участников, срок, приоритет и проект в `edit*`-состоянии. Пока форма открыта, realtime обновляет `task`, но `edit*` не пересчитываются. Если другой пользователь добавил исполнителя/наблюдателя или изменил срок, мобильный клиент при сохранении отправляет полный старый набор. Backend обновляет переданные поля без версии/ETag (`hub_service.py:7484-7503`), поэтому изменения коллеги откатываются.

**Что сделать:** перечитывать `edit*` при изменении `task` (кроме полей, которые пользователь уже изменил), либо отправлять только dirty-поля и добавить `expected_updated_at`/версию.

### MB3-05. Выбор писем применяется к скрытым письмам

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/mail/useMailList.ts:156-178`; `mobile-hub/src/mail/useMailSelection.ts:124-152`; `NativeMailInboxScreen.tsx:229`.

```ts
if (snapshot?.data.signature === signature) {
  snapshotHit = true;
  ...
}
if (!snapshotHit) {
  ...
  onScopeResetRef.current?.();
}
```

При смене фильтра/поиска, для которого есть сохранённый snapshot, `onScopeReset` не вызывается. `selected` остаётся прежним, хотя список уже другой. `runBulk` отправляет `ids = [...selected]` без проверки, что письма всё ещё видны в текущем списке. Пользователь может выделить письма, включить «Непрочитанные» (snapshot уже есть) и нажать «Архивировать» — действие уйдёт по невидимым письмам из старого фильтра.

**Что сделать:** очищать `selected` при любом изменении `listScope`, независимо от snapshot; перед bulk-действием фильтровать `ids` по текущим `items` или явно предупреждать о скрытых письмах.

### MB3-06. «Опубликовать» после сбоя вложения оставляет пост черновиком

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/feed/NativeFeedEditorScreen.tsx:687-697`, `:1136-1145`.

```tsx
if (postId || createdPostId) {
  const targetId = postId || createdPostId;
  saved = await updateFeedPost(targetId, payload);
  await syncAttachments(targetId, prepared);
} else if (mode === 'draft') {
  saved = await createFeedDraft({ ...payload, status: 'draft', ... });
  setCreatedPostId(saved.id);
  await syncAttachments(saved.id, ...);
} else {
  saved = await createFeedPost({ ...payload, status: 'published', ... });
}
```

Сценарий: новый пост → «Сохранить черновик» прошёл, `createdPostId` выставлен, но `syncAttachments` упал. UI по-прежнему выбирает ветку по `postId` (`:1136`) и показывает «Сохранить черновик / Опубликовать». Нажатие «Опубликовать» вызывает `save('published')`, но ветка `postId || createdPostId` делает только `PATCH /hub/announcements/{id}` без статуса; публикация выполняется отдельным `POST /announcements/{id}/publish` (`hub.py:737`). Пост остаётся черновиком, а `openSaved` уводит на карточку как будто всё хорошо.

**Что сделать:** учитывать `createdPostId` в UI и при `mode === 'published'` вызывать `publishFeedPost(targetId)` после `updateFeedPost`; либо не считать сохранение успешным до синхронизации вложений.

### MB3-07. После перехода статуса не обновляются история и комментарий

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:461-465`, `:310-328`.

```ts
setTask(updated);
setPendingAction(null);
setActionComment('');
setActionFile(null);
setMessage(actionSuccessMessage(pendingAction.key));
```

После `start/submit/approve/reject/complete/reopen` клиент обновляет только `task`. `statusLog` и `comments` не перезапрашиваются. При подключённом WebSocket событие `task.changed` вызовет `loadTask('silent')` и обновит их; при HTTP-only/потере сокета история и комментарий действия остаются старыми до переоткрытия экрана. Дополнительно старый `loadTask`, запущенный до действия, может прийти после `setTask(updated)` и вернуть прежний статус: успешная ветка не увеличивает `loadGeneration`.

**Что сделать:** после успешного действия инвалидировать `loadGeneration` и перезагружать задачу/историю/комментарии по HTTP, не полагаясь только на WS.

### MB3-08. Ошибка комментариев затирает офлайн-снимок задачи

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:265-271`, `:279-288`, `:387-394`.

```ts
} catch (cause) {
  if (!isCurrent()) return;
  setComments([]);
  setError(formatApiError(cause, 'Не удалось загрузить комментарии.'));
}
```

```ts
useEffect(() => {
  if (!allowed || !task || ... || loading || refreshing || !user?.id) return;
  void writeNativeEntitySnapshot('task-details', user.id, taskId, {
    task, comments, statusLog,
  });
}, [allowed, comments, loading, ...]);
```

`getTaskComments`/`getTaskStatusLog` при временной ошибке очищают соответствующий массив. Эффект снимка не проверяет `error` и записывает пустые `comments`/`statusLog` поверх ранее полной офлайн-копии. Следующее открытие без сети показывает задачу без комментариев и истории.

**Что сделать:** при ошибке не заменять непустые `comments`/`statusLog` пустым массивом; не писать snapshot, если загрузка завершилась ошибкой.

### MB3-09. Текст, набранный во время отправки комментария, стирается

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:728-730`, `:1177`.

```ts
const created = await addTaskComment(task.id, body);
setComments((current) => [...current, created]);
setCommentText('');
```

Поле ввода остаётся редактируемым (`editable={!offlineMode}`), блокируется только кнопка отправки. Пока первый комментарий летит, пользователь может начать второй; после успеха безусловный `setCommentText('')` стирает уже другой текст.

**Что сделать:** очищать поле только если с момента отправки оно не изменилось (revision/ref), как это сделано в чате.

### MB3-10. Кэш фото/актов не учитывает базу данных

**Severity: средний. Confidence: средняя (зависит от пересечения ID между базами).**
`mobile-hub/src/database/nativeDatabaseFiles.ts:14-17`, `:42-45`, `:93-94`.

```ts
async function databaseCacheFile(fileName: string): Promise<File> {
  const userId = Number(await getSessionUserId());
  ...
  return new File(databaseCacheDirectory(), `${userId}-${fileName}`);
}
...
const destination = await databaseCacheFile(`${docNo}-${fileName}`);
...
const destination = await databaseCacheFile(`photo-${itemId}-${fileNo}...`);
```

Запрос scoped заголовком `X-Database-ID`, но имя кэш-файла содержит только `userId` + `docNo`/`itemId`. В приложении несколько ITINVENT-баз с собственными последовательностями `DOC_NO`/`ITEMS.ID`. Если номера совпадают, после переключения базы ранний `return` отдаст файл другой базы без запроса. Для фото риск выше, чем для актов.

**Что сделать:** включать `databaseId` в имя кэш-файла (и в invalidation), либо хранить кэш в подкаталоге базы.

### MB3-11. Deep link на пост/комментарий ленты открывает список

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/feed/nativeFeedRoutes.ts:35-41`; `mobile-hub/src/navigation/moduleRegistry.ts:271-276`; `app/(shell)/feed/index.tsx`; `NativeFeedPostScreen.tsx:92-99`.

`nativeFeedDestinationFromPortalPath` корректно возвращает `/(shell)/feed/[postId]`, но `routePathFromHref` превращает его в строку `/feed?post=<id>`. Expo Router ведёт такой URL на `(shell)/feed/index` (список), который не читает `post`/`commentId`. `NativeFeedPostScreen` читает только `postId` и игнорирует `commentId`, поэтому якорь комментария тоже не раскрывается.

**Сценарий:** push/ссылка `hubit://portal?path=%2Ffeed%3Fpost%3D<id>` или `/feed?post=<id>` открывает ленту, а не публикацию; deep link на комментарий не скроллит к нему.

**Что сделать:** возвращать `/feed/<postId>` для `/(shell)/feed/[postId]` (и отдельный параметр комментария), либо научить `feed/index` перенаправлять `post` на экран поста.

### MB3-12. Поиск и пересылка в чате ограничены первыми 50 диалогами

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/chat/useThreadForward.ts:53`; `mobile-hub/src/api/chatApi.ts:61-90`; `mobile-hub/src/screens/chat/useInboxActions.ts:93-101`, `:282-284`.

```ts
const conversations = await chatApi.getConversations();
```

`getConversations()` — это `getConversationPage()` с `limit: 50` и без курсора. Окно пересылки фильтрует только этот массив. Глобальный поиск также запрашивает `getConversationPage({ query, limit: 50 })`; `has_more`/`next_cursor` не сохраняются, а `handleEndReached` при активном `searchItems` не догружает. Пользователь с >50 диалогами не найдёт старый чат и не перешлёт в него сообщение.

**Что сделать:** добавить постраничную загрузку поиска и пересылки по `next_cursor`; для пересылки использовать серверный поиск, а не фильтр первых 50.

### MB3-13. Повтор task-share отправляется как обычный текст

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/chat/useThreadSend.ts:503-513`, `:95-103`.

```ts
const retryPendingMessage = useCallback((message: ChatMessage) => {
  if (message.attachments?.length) { retryPendingAttachmentUpload(message); return; }
  void sendBody(
    message.body_text || '',
    message.client_message_id || undefined,
    message.reply_preview || undefined,
    false,
  );
}, [retryPendingAttachmentUpload, sendBody]);
```

`sendBody` принимает только `messageKind: 'location' | 'contact' | 'poll' | 'text'` и не передаёт `command` task-share. При повторе paused/cancelled task-share:

- если строка outbox уже есть, `nativeChatOutboxLegacy.put` видит другой `command` и бросает «Содержимое повторной отправки изменилось»;
- если строки нет, уходит обычный текст с названием задачи, карточка task-share теряется.

**Что сделать:** хранить/восстанавливать `kind` и `command` из сообщения и повторять через тот же путь, что и первичную отправку task-share.

### MB3-14. После смены пароля остаётся старый раскрытый пароль

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/passwords/NativePasswordsScreen.tsx:343-368`, `:427-441`, `:714-725`.

`revealPassword('show')` кладёт пароль в `revealedPassword` на 30 секунд. `beginEditing` и `saveEntry` не вызывают `clearEntrySecret()` и не сбрасывают `revealedPassword`/`secretVisibleUntil`. Если раскрыть пароль, быстро открыть редактирование и сохранить новый, после закрытия формы снова отрисуется старый `revealedPassword` с прежним таймером.

**Что сделать:** очищать раскрытый секрет при входе в редактирование и после успешного сохранения; сбрасывать таймер.

### MB3-15. Автообновление Scan Center сбрасывает постраничную загрузку

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/screens/scanCenter/NativeScanCenterScreen.tsx:231-235`, `:167-198`.

```ts
const timer = setInterval(() => {
  if (!focusedRef.current || !appActiveRef.current || busyRef.current || offlineMode) return;
  if (section === 'overview') void loadOverview({ silent: true });
  else void loadRows({ reset: true });
}, AUTO_REFRESH_MS);
```

На вкладках инцидентов/агентов/хостов каждые 30 секунд вызывается `loadRows({ reset: true })`. Результат применяется как `reset ? result.items : ...`, то есть остаётся только первая страница (50 записей), ранее догруженные страницы и позиция прокрутки теряются. Пока идёт загрузка, `onEndReached` блокируется.

**Что сделать:** для автообновления не сбрасывать список, а обновлять только видимую первую страницу/мержить по id; либо не автообновлять вкладки с пагинацией.

### MB3-16. Дельта непрочитанного применяется к текущей папке, а не к папке письма

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/mail/useMailList.ts:340-348`; `mobile-hub/src/mail/useMailSelection.ts:178-184`.

```ts
const applyUnreadDelta = useCallback((delta: number, scopedMailboxId: string) => {
  applyUnreadDeltaLocal(delta, folder, scopedMailboxId);
  ...
}, [applyUnreadDeltaLocal, folder]);
```

`folder` — текущая папка списка. При фильтре «Все папки» пользователь может прочитать письмо из «Архива», но дельта уйдёт в `inbox`: счётчик «Входящих» уменьшится, «Архива» — нет. Аналогично для делегированного ящика: `summary`/`folderTree` текущего видимого ящика обновляются без проверки `targetMailbox`.

**Что сделать:** передавать в `applyUnreadDelta` папку/ящик конкретного письма (`value.folder`, `value.mailbox_id`) и обновлять summary только при совпадении ящика.

### MB3-17. Автоопрос Docflow идёт чаще заявленного

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/screens/docflow/NativeDocflowAssignmentScreen.tsx:147`, `:247-266`, `:305-313`.

```ts
const localState = { selectedDocument, ..., attempt: attemptRef.current };
...
const handleCommand = useCallback(async (result) => {
  ...
  await draft.write({ ...localState, command: result, attempt: attemptRef.current });
  setCommand(result);
}, [draft, localState]);
...
const first = setTimeout(runCheck, 750);
const interval = setInterval(runCheck, 3_000);
```

`localState` — новый объект на каждом рендере, поэтому `handleCommand` и `checkCommand` пересоздаются каждый рендер, а `useFocusEffect` перезапускается. Каждый `checkCommand` делает `setWorking(true/false)`, вызывая рендер и новый `setTimeout(750)`; интервал 3 с не доживает. Фактический опрос — примерно раз в 0.75–1 с, бюджет `DOCFLOW_COMMAND_AUTO_CHECK_LIMIT = 30` выгорает за ~30 с вместо ~90 с.

**Что сделать:** стабилизировать `localState`/`handleCommand` (refs или мемоизация) и не перезапускать `useFocusEffect` на каждом рендере.

## 3. Что проверено и отброшено

- **Observer = assignee в форме создания задачи** — backend `_normalize_observer_user_ids` сам исключает исполнителей/контролёра/автора (`task_participant_service.py:151-164`), поэтому скрытое состояние не приводит к ошибке или дублю уведомлений.
- **Гонка переключения ящика в папках почты** — `requestRef`/lease отсекает устаревшие ответы (`NativeMailFoldersScreen.tsx:87-120`).
- **Docflow 50 заданий** — лимит явно показан в UI; не дефект.

## 4. Ограничения

- Устройство/эмулятор не запускались; поведение на реальном Android не подтверждено.
- MB3-10 зависит от того, пересекаются ли `ITEMS.ID`/`DOC_NO` между базами; по коду кэш точно не scoped.
- MB3-04 и MB3-07 зависят от серверной семантики PATCH и наличия WebSocket; клиентская часть подтверждена.
