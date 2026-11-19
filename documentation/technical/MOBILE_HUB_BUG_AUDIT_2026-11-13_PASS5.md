# Mobile-hub: аудит после исправлений, проход 5

Дата: 13.11.2026.
Область: только `mobile-hub`. Проверка read-only: код не изменялся, production не затрагивался.
Метод: статический разбор mobile-клиента и сверка с backend-контрактами. Устройство/эмулятор/APK не запускались.
Проверка исправлений: [MOBILE_HUB_PASS5_FIX_VERIFY_2026-11-13.md](MOBILE_HUB_PASS5_FIX_VERIFY_2026-11-13.md) — 15 из 20 закрыты полностью, MB5-05 (регрессия), MB5-07 (edge), MB5-09, MB5-15, MB5-19 имеют остатки. Следующий проход: [MOBILE_HUB_BUG_AUDIT_2026-11-13_PASS6.md](MOBILE_HUB_BUG_AUDIT_2026-11-13_PASS6.md).

Не включены известные MB-01…MB-14, MB2-01…MB2-14, MB3-01…MB3-17, MB4-01…MB4-24, а также остатки, зафиксированные в `MOBILE_HUB_PASS4_FIX_VERIFY_2026-11-13.md` (вложенные папки корзины, deferred logout после входа другого пользователя, закэшированный feed, якорь комментария).

## 1. Итог

Найдено **20 новых дефектов**: 6 высоких, 14 средних. Дополнительно подтверждены 4 менее критичных дефекта.

| ID | Severity | Область | Кратко |
|---|---|---|---|
| MB5-01 | высокий | почта | в режиме «Все папки» письмо из «Удалённых» удаляется навсегда без предупреждения |
| MB5-02 | высокий | структура компании | пакетный выбор кодов затирает привязки другой группы и коды вне поиска |
| MB5-03 | высокий | статистика | после отзыва `statistics.read` данные и действия остаются на экране |
| MB5-04 | высокий | задачи | `is_active` 0/1 читается как «активен», отключённые проекты/объекты оживают |
| MB5-05 | высокий | задачи | 403 на `/departments` валит `Promise.all`, фильтры исполнителя/контролёра не загружаются |
| MB5-06 | высокий | задачи | после успешного действия `loadTask('refresh')` применяет старый snapshot и откатывает статус |
| MB5-07 | средний | почта | одна повреждённая запись локальных черновиков блокирует любой редактор письма |
| MB5-08 | средний | чат | нормализация диалога выбрасывает group-restriction и mention-поля |
| MB5-09 | средний | почта | смена отправителя не переносит локальный черновик и вложения в выбранный ящик |
| MB5-10 | средний | компьютеры | ошибка смены фильтра оставляет старый список и ломает offset следующей страницы |
| MB5-11 | средний | адресная книга | после неудачного обновления показываются старые данные с новой датой |
| MB5-12 | средний | адресная книга | ошибка серверного поиска показывается как «сотрудники не найдены» |
| MB5-13 | средний | справка | фильтр категории скрывает собственные чипы, снять фильтр нельзя |
| MB5-14 | средний | чат | текст из композера теряется при отправке фото из панели вложений |
| MB5-15 | средний | чат | выход из треда помечает прочитанными сообщения, которые пользователь не видел |
| MB5-16 | средний | задачи | PATCH без `capabilities` делает карточку «только для чтения» после чек-листа/правки |
| MB5-17 | средний | задачи | отмена системного picker стирает уже выбранный файл отчёта |
| MB5-18 | средний | почта | в цепочке встроенные cid-изображения не гидрируются |
| MB5-19 | средний | почта | дерево папок и настройки вида до 60 с остаются старыми после управления папками |
| MB5-20 | средний | почта | одиночный архив/удаление не обновляют счётчики непрочитанного |

## 2. Детали

### MB5-01. Письмо из «Удалённых» удаляется навсегда без предупреждения

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/mail/useMailSelection.ts:240-246`; `mobile-hub/src/screens/mail/NativeMailInboxScreen.tsx:386`, `:443-457`; backend `WEB-itinvent/backend/services/mail_service.py:3959-3967`.

```ts
240:  const confirmDelete = useCallback(() => {
241:    const permanent = folder === 'trash';
242:    Alert.alert(permanent ? 'Удалить выбранные письма навсегда?' : 'Удалить выбранные письма?', ...
244:      { text: permanent ? 'Удалить навсегда' : 'Удалить', style: 'destructive', onPress: () => { ... void runBulk('delete', '', permanent); } },
```

```py
3959:        if permanent and folder_key != "trash":
3960:            raise MailServiceError("Permanent delete is allowed only from trash")
3961:        if not permanent and folder_key != "trash":
3962:            return self.move_message(... target_folder="trash")
```

`permanent` вычисляется по текущей папке списка, а не по папке выбранного письма. В режиме «Все папки» `folder` остаётся `inbox`/текущей, поэтому для письма из `trash` уходит `permanent=false`. Backend видит `folder_key == "trash"` и выполняет безвозвратное удаление. Результат `{ok: true, permanent: true}` не содержит `message_id`, поэтому undo не может восстановить письмо.

**Сценарий:** Входящие → «Все папки» → выделить письмо из «Удалённых» → «Удалить». UI обещает перемещение в корзину, сервер удаляет навсегда; свайп «Удалить» делает то же.

**Что сделать:** вычислять `permanent` по `item.folder` каждого письма (в bulk — группировать по папкам), а для писем из trash показывать «Удалить навсегда» и не предлагать undo; либо запретить обычное удаление для trash-писем в mixed-списке.

### MB5-02. Пакетный выбор кодов затирает привязки другой группы и коды вне поиска

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/components/companyStructure/NativeCompanyNodeEditorSheet.tsx:227-236`, `:345-366`.

```tsx
227:  const selectableCodesByGroup = (group: 'office' | 'object') => codes.filter((option) => (
228:    option.binding_group === group
229:      && (!option.linked_node_id || option.linked_node_id === selectedNode?.id)
230:  ));
231:  const replaceCodesByGroup = (group: 'office' | 'object') => {
232:    setDraft((current) => ({
233:      ...current,
234:      department_codes: selectableCodesByGroup(group).map((option) => option.department_code),
235:    }));
236:  };
```

`codes` — это результаты поиска по `codeQuery` (максимум 100), а не полный справочник. Кнопка «Все N» заменяет **весь** `department_codes` только текущей выдачей. Если у отдела были `office: ['001','002']` и `object: ['101']`, поиск «001» и нажатие «Офис · 1» оставят только `['001']`; `002` и `101` исчезнут.

**Сценарий:** открыть узел, найти один код, нажать пакетную кнопку, сохранить. Привязки другого типа и коды вне поисковой выдачи удаляются без предупреждения.

**Что сделать:** добавлять коды группы к существующим (или заменять только выбранную группу, сохраняя другую), предупреждать о количестве и не строить замену по результатам поиска.

### MB5-03. После отзыва `statistics.read` данные и действия остаются

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/statistics/NativeStatisticsScreen.tsx:237-253`, `:689-696`, `:698-709`.

```tsx
237:  useEffect(() => {
238:    if (!canView || !currentDatabase) return;
...
253:  }, [canView, offlineMode, currentDatabase, restoreSnapshot]);
...
689:      {!loading && !error && !currentStats && canView ? ( ... ) : null}
694:      {!canView ? (
695:        <Text ...>Нет доступа к статистике.</Text>
696:      ) : null}
698:      <NativeDatabasePickerSheet visible={dbPickerOpen} ... />
```

При отзыве права `canView` становится `false`, эффект просто выходит, не очищая `payloads`/`currentDatabase`. Блоки статистики, строки филиалов и `NativeDatabasePickerSheet` не обёрнуты в `canView`; на экране остаются ранее загруженные метрики и кнопки. При сохранённом `database.write` из строки филиала можно открыть лист ПК и запустить чистку.

**Что сделать:** при `!canView` очищать `payloads`, `currentDatabase`, закрывать picker/листы и возвращать только заглушку «Нет доступа»; не рендерить блоки без `canView`.

### MB5-04. `is_active` 0/1 читается как «активен»

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskTaxonomyScreen.tsx:29-36`, `:114-118`, `:160-188`; `mobile-hub/src/api/taskApi.ts:399`, `:409`; backend `WEB-itinvent/backend/services/hub_service.py:4582-4588`, `:4674-4677`.

```tsx
29: function draftFrom(item: TaskProject | TaskObject): TaxonomyDraft {
34:    isActive: item.is_active !== false,
...
114:        getTaskProjects({ includeInactive: true }),
115:        getTaskObjects({ includeInactive: true }),
```

Backend хранит `is_active` как INTEGER и отдаёт `0/1` без нормализации в boolean. `0 !== false`, поэтому `draftFrom` показывает отключённый проект/объект как активный; сохранение отправляет `is_active: true` и снова включает его. `getTaskProjects({ includeInactive: true })` возвращает и активные, и отключённые, а мобильный фильтр `!== false` не отсеивает `0`.

**Сценарий:** открыть «Проекты и объекты», у архивного проекта `is_active: 0` чекбокс «Активен» включён. Изменить название и сохранить — проект снова активен и появляется в формах задач.

**Что сделать:** нормализовать `is_active` в API (`Boolean(Number(...))`) или в `draftFrom`/`getTaskProjects`; тест с `0/1` вместо boolean.

### MB5-05. 403 на `/departments` валит загрузку фильтров задач

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTasksInboxScreen.tsx:339-356`; backend `WEB-itinvent/backend/api/v1/departments.py:17-20`.

```tsx
342:    void Promise.all([
343:      listDepartments(),
344:      searchTaskControllers('', 100),
345:      canManageAll ? searchTaskAssignees('', 100) : Promise.resolve([]),
346:    ]).then(...).catch((cause) => {
351:      setError(formatApiError(cause, 'Не удалось загрузить отделы и сотрудников. Закройте фильтры и повторите попытку.'));
352:    }).finally(() => {
353:      setDirectoriesLoaded(true);
```

`/departments` требует `settings.read` или `departments.manage`. Пользователь с `tasks.read` + `tasks.review`/`tasks.manage_all`, но без этих прав получает 403; `Promise.all` отклоняется, хотя контролёры/исполнители уже ответили. `directoriesLoaded` в `finally` становится `true`, поэтому повторное открытие фильтров не перезапрашивает справочники — кнопка «повторите» врёт.

**Что сделать:** грузить отделы отдельным `allSettled`/`catch`, не валить остальные справочники; при ошибке не ставить `directoriesLoaded=true` или давать реальный retry.

### MB5-06. `loadTask('refresh')` откатывает успешный переход статуса

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:244-253`, `:398-405`, `:472-478`.

```tsx
244:    if (cached) {
245:      setTask(cached.data.task);
246:      setComments(cached.data.comments || []);
247:      setStatusLog(cached.data.statusLog || []);
...
472:      setTask(updated);
...
478:      void loadTask('refresh');
```

`loadTask('refresh')` сначала применяет локальный snapshot (состояние до действия), затем идёт в сеть. Эффект записи snapshot пропускает запись, пока `refreshing`/`loadInProgress` true. Если `getTask` падает или отвечает медленно, карточка возвращается к «Новая» с кнопкой «Начать работу», хотя действие уже применено; повтор даёт 409. То же может затирать только что сохранённый чек-лист/правку.

**Что сделать:** не применять cached snapshot при `refresh` после локальной мутации (аналог `lastAppliedCommandAtRef` в Docflow) или мержить его с `updated` и инвалидировать generation перед refresh.

### MB5-07. Повреждённая запись локальных черновиков блокирует любой редактор письма

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/mail/nativeMailComposeDrafts.ts:52-60`; `mobile-hub/src/screens/mail/NativeMailComposeScreen.tsx:338-339`, `:438-446`, `:912-920`.

```ts
52: async function readAll(): Promise<Entry[]> {
53:   const raw = await SecureStore.getItemAsync(KEY);
54:   let entries: unknown;
55:   try { entries = raw ? JSON.parse(raw) : []; }
56:   catch { throw new Error('Не удалось прочитать локальные черновики писем.'); }
57:   if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.key !== 'string' || !validState(entry.state) || ...)) {
58:     throw new Error('Не удалось прочитать локальные черновики писем.');
59:   }
```

`restoreLocal` вызывает `session.read()` для любого compose. Одна битая/устаревшая запись или обрезанный JSON роняет `readAll`; внешний `catch` повторяет `restoreLocal`, снова падает и оставляет `initialized=false`. Экран показывает «Не удалось открыть редактор» без кнопки очистки. Новое письмо, ответ, пересылка и продолжение черновика недоступны до logout (который вызывает `clearMailComposeDrafts`).

**Что сделать:** изолировать битые записи (пропускать/удалять их, а не ронять весь store), дать кнопку «Очистить локальные черновики» и не блокировать новый compose.

### MB5-08. Нормализация диалога выбрасывает group-restriction и mention-поля

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/chat/chatModels.ts:168-196`; `mobile-hub/src/screens/chat/ChatThreadOverlays.tsx:196-204`; `mobile-hub/src/components/chat/ChatConversationRow.tsx:41-43`; backend `WEB-itinvent/backend/chat/chat_serialization.py:171-178`, `:190-192`, `:403`.

```ts
168:  return {
...
190:    viewer_member_role: optionalText(item.viewer_member_role),
191:    description: optionalText(item.description),
192:    posting_policy: optionalText(item.posting_policy),
193:    members,
194:    member_preview: memberPreview,
195:    direct_peer: directPeer,
196:  };
```

В возвращаемом объекте нет `members_send_files`, `viewer_restricted`, `viewer_restricted_until`, `slow_mode_seconds`, `unread_mention_count`, хотя backend их присылает. Поэтому `groupFilesBlockReason` всегда пуст, `groupPostingBlockReason` не видит ограничение отправки, а бейдж упоминаний не появляется. Пользователь запускает пикер/загрузку файла, сервер отклоняет отправку 403 уже после загрузки.

**Что сделать:** добавить поля в `ChatConversationSummary` и `normalizeChatConversation`; покрыть тестом restricted-группу.

### MB5-09. Смена отправителя не переносит локальный черновик

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/mail/NativeMailComposeScreen.tsx:217-219`, `:323-338`, `:977-984`.

```tsx
217:  const localState = useMemo<MailComposeLocalDraft>(() => ({
218:    draftId, to, cc, bcc, subject, body, ...
219:  }), [draftId, to, cc, bcc, subject, body, ...]);
...
977:            {mailboxes.map((mailbox) => <ComposeChip ... onPress={() => setMailboxId(String(mailbox.id))} />)}
```

`localState` не содержит `mailboxId`; `restoreLocal` создаёт сессию один раз с `selectedMailbox` (из `initialMailboxId`/источника), а эффект подготовки не зависит от состояния `mailboxId`. При переключении чипа «Отправитель» текст и вложения продолжают автосохраняться в старую область ящика A, а `payload`/`draftId` уходят с `fromMailboxId=B`.

**Сценарий:** новое письмо из A → переключить на B → написать текст/прикрепить файл → закрыть приложение. Черновик B пуст; из A текст восстановится с отправителем A. Возможна работа с `draftId` чужого ящика.

**Что сделать:** включать `mailboxId` в `localState`/scope и пересоздавать локальную сессию при смене отправителя; очищать/переносить `draftId` при смене ящика.

### MB5-10. Ошибка смены фильтра компьютеров оставляет старый список

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/computers/NativeComputersScreen.tsx:98-144`, `:212-214`.

```tsx
104:    const offset = reset ? 0 : itemCountRef.current;
...
128:    if (pageResult.status === 'fulfilled') {
129:      setItems((current) => (reset ? pageResult.value.items : mergeComputerPage(...)));
130:      setTotal(pageResult.value.total);
131:      setHasMore(pageResult.value.has_more && pageResult.value.items.length > 0);
132:    } else {
133:      messages.push(formatApiError(pageResult.reason, 'Не удалось загрузить список компьютеров.'));
134:    }
```

При reset (`status`/`scope`/поиск) `items`, `total`, `hasMore` не сбрасываются до запроса. Если запрос падает, остаётся старый список с `hasMore: true`; `loadNextPage` берёт offset из старого `itemCountRef`, но новые фильтры — и подмешивает вторую страницу нового фильтра к старому списку.

**Что сделать:** при reset очищать список/offset до запроса или в `catch`; не давать `loadNextPage` работать при ошибке смены фильтра.

### MB5-11. Старые данные адресной книги с новой датой обновления

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/addressBook/NativeAddressBookScreen.tsx:491-520`.

```tsx
491:      if (hadCachedSnapshot) {
492:        try {
493:          const remoteStatus = await getAddressBookStatus();
494:          if (requestId !== searchRequestRef.current) return;
495:          setStatus(remoteStatus);
496:          if (remoteStatus?.updated_at && remoteStatus.updated_at === snapshot?.data.updated_at) {
497:            return;
498:          }
499:        } catch { ... }
...
516:    } catch (cause) {
517:      if (requestId !== searchRequestRef.current) return;
518:      if (!hadCachedSnapshot) {
519:        setError(formatApiError(cause, 'Не удалось загрузить адресную книгу.'));
520:      }
```

`setStatus(remoteStatus)` обновляет `updated_at` до полной выгрузки. Если `getCompleteAddressBook()` падает, ошибка скрыта (`hadCachedSnapshot=true`), на экране старый список, но «Обновлено» показывает новую серверную дату. Пользователь считает справочник свежим; поиск идёт по старому снимку.

**Что сделать:** обновлять `updated_at` только после успешной полной выгрузки (или отдельно показывать «проверено, данные не загружены»); при ошибке с кэшем показывать предупреждение.

### MB5-12. Ошибка серверного поиска показывается как «сотрудники не найдены»

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/addressBook/NativeAddressBookScreen.tsx:679-688`, `:1103-1105`.

```tsx
679:    void searchAddressBook({ q: normalized, limit: SEARCH_LIMIT, signal: controller.signal })
680:      .then((result) => { ... setRemoteItems(result.items); })
683:      .catch(() => {
684:        if (requestId === remoteSearchRef.current && !controller.signal.aborted) setRemoteItems([]);
685:      })
```

При холодном старте, пока полный снимок ещё не загружен, поиск идёт на сервер. Ошибка 500/таймаут очищает `remoteItems`, но не выставляет `error`; `ListEmptyComponent` показывает «По вашему запросу сотрудники не найдены». Пользователь получает ложный отрицательный результат.

**Что сделать:** в `catch` выставлять ошибку поиска и показывать retry вместо empty-state.

### MB5-13. Фильтр категории справки скрывает собственные чипы

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/help/NativeHelpScreen.tsx:142-150`, `:234-246`.

```tsx
142:    articles.forEach((article) => {
143:      const group = byCategory.get(article.category.toLowerCase()) || other;
144:      if (categoryFilter && group.key !== categoryFilter) return;
...
148:    const visible = ordered.filter((group) => group.data.length > 0);
...
234:        {groups.length > 1 ? (
235:          <View style={styles.categoryChips}>
```

`groups` уже отфильтрован по `categoryFilter`, поэтому после выбора категории в нём остаётся одна группа, и блок чипов (`groups.length > 1`) исчезает. Снять фильтр или переключиться на другую категорию нельзя; если в категории нет результатов, экран пуст без чипов.

**Что сделать:** строить чипы по полному списку категорий, а не по отфильтрованным `groups`; добавить chip «Все».

### MB5-14. Текст из композера теряется при отправке фото из панели

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/chat/useThreadSend.ts:363-370`, `:404-409`; `mobile-hub/src/screens/chat/ChatThreadOverlays.tsx:276-279`.

```ts
363:    const upload: PendingAttachmentUpload = previousUpload || {
...
367:      body: extra.body ?? text,
...
404:    if (!previousUpload) {
407:      setText('');
```

`ChatAttachmentPanel.onSendFiles` передаёт `{ body: caption }`, где `caption` — отдельное поле панели, по умолчанию `''`. `extra.body ?? text` не подставляет текст композера для пустой строки, поэтому `upload.body=''`; затем `setText('')` очищает поле и сохранённый черновик.

**Сценарий:** напечатать «смотрите вложение», открыть скрепку → галерею, выбрать фото, не заполняя «Подпись», нажать «Отправить». Фото уходит без подписи, текст исчезает.

**Что сделать:** использовать `extra.body?.trim() ? extra.body : text` (или передавать `caption || text` из панели); не очищать композер, если caption пуст и текст не был отправлен.

### MB5-15. Выход из треда помечает непрочитанные сообщения прочитанными

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/chat/useThreadBack.ts:111-129`; `mobile-hub/src/screens/chat/NativeChatThreadScreen.tsx:526-527`.

```ts
116:      const latest = findLatestIncomingMessage(messagesRef.current, userId);
117:      notifyNativeChatConversationRead(conversationId);
...
126:      if (!offlineMode && latest?.id) {
127:        void chatApi.markConversationRead(conversationId, latest.id).catch(() => undefined);
128:      }
```

`leaveThread` не проверяет `nearBottomRef`. Если пользователь прокручен вверх и получил новые сообщения (в треде они не помечаются прочитанными, т.к. `nearBottomRef=false`), выход всё равно отправляет `markConversationRead` до последнего входящего и локально обнуляет бейдж.

**Что сделать:** при выходе помечать прочитанным только то, что реально было видно (например, `markRead` уже вызывался при near-bottom), либо не вызывать `markConversationRead` из `leaveThread`.

### MB5-16. PATCH без `capabilities` делает карточку задачи «только для чтения»

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:649-652`, `:660-668`; backend `WEB-itinvent/backend/api/v1/hub.py:1867`; `mobile-hub/src/tasks/taskActions.ts:12-13`.

```ts
649:      const updated = await updateTask(task.id, payload);
650:      setTask(updated);
...
665:      const updated = await updateTask(task.id, { checklist_items: items });
666:      setTask(updated);
```

```py
1867:    return await run_in_threadpool(_enrich_task_payload, updated)
```

PATCH `/hub/tasks/{id}` возвращает `_enrich_task_payload` без `capabilities` (их добавляет только `_enrich_task_payload_for_user` в GET). После сохранения правки или чек-листа `setTask(updated)` заменяет состояние, `task.capabilities` становится `undefined`; `getTaskActions(undefined)` возвращает `[]`, чек-лист и загрузка файлов блокируются, кнопка редактирования исчезает. Realtime-refresh обычно восстанавливает, но при выключенном WS/ошибке refresh экран остаётся «только для чтения».

**Что сделать:** сохранять прежние `capabilities` при merge ответа PATCH (или запрашивать GET после PATCH); добавить `capabilities` в ответ PATCH на backend.

### MB5-17. Отмена picker стирает уже выбранный файл отчёта

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/tasks/NativeTaskDetailScreen.tsx:703-714`; `mobile-hub/src/tasks/nativeTaskFiles.ts:61`.

```tsx
703:  const chooseActionFile = useCallback(async () => {
...
708:      setActionFile(await pickNativeTaskFile());
...
712:      setFileBusy(false);
```

`pickNativeTaskFile()` возвращает `null` при отмене. `setActionFile(null)` безусловно очищает ранее выбранный `report.pdf`. Пользователь нажимает «Заменить файл», отменяет picker и отправляет задачу без отчёта. В `uploadAttachment` отмена обрабатывается правильно (`if (!picked) return`).

**Что сделать:** `const picked = await pickNativeTaskFile(); if (picked) setActionFile(picked);`.

### MB5-18. В цепочке cid-изображения не гидрируются

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/mail/NativeMailConversationScreen.tsx:134-143`; `mobile-hub/src/screens/mail/NativeMailMessageScreen.tsx:203-210`; `mobile-hub/src/mail/nativeMailHtml.ts:299-305`.

Экран отдельного письма вызывает `hydrateNativeMailImages(detail.id, mailbox, detail.attachments)`, который подставляет data URL для `cid:`. Экран цепочки получает `getMailConversation` и нигде не гидрирует вложения; backend отдаёт `inline_src` как `/api/v1/...`, а `prepareNativeMailHtml` понимает только data URL. В результате `<img src="cid:...">` превращается в «Изображение недоступно».

**Что сделать:** гидрировать изображения для каждого письма цепочки (или хотя бы для выбранного) перед рендером HTML.

### MB5-19. Дерево папок и настройки вида до 60 с остаются старыми

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/mail/useMailList.ts:33`, `:197-204`, `:277-289`.

```ts
33: export const MAIL_METADATA_TTL_MS = 60_000;
...
198:      const reloadMetadata = reset && (refresh || metadataFreshRef.current.scope !== metadataScope
199:        || Date.now() - metadataFreshRef.current.savedAt >= MAIL_METADATA_TTL_MS);
...
284:    void load({ reset: true }).finally(...)
```

`useFocusEffect` при возврате вызывает `load({ reset: true })` без `refresh`, поэтому `reloadMetadata` остаётся `false` до истечения TTL. После создания/переименования/удаления папки или изменения плотности/сниппетов список до 60 с показывает старое дерево и настройки. Если удалена текущая папка, список продолжает запрашивать несуществующую папку.

**Что сделать:** при возврате с экрана управления папками/настройками передавать `refresh: true` или инвалидировать `metadataFreshRef`; при удалении текущей папки переключать `folder` на inbox.

### MB5-20. Одиночный архив/удаление не обновляют счётчики непрочитанного

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/mail/NativeMailInboxScreen.tsx:427-457`; для сравнения toggle-read — `:416`.

```tsx
427:      } else if (action === 'archive') {
428:        await moveMailMessage(item.id, scopedMailboxId, 'archive');
...
443:      } else {
444:        await deleteMailMessage(item.id, scopedMailboxId, false);
...
```

В ветках archive/delete нет `applyUnreadDelta`, хотя toggle-read его вызывает, а bulk-действия считают дельты по папкам. Непрочитанное письмо исчезает из списка, но бейдж папки/ящика и навигации остаётся прежним до realtime/refresh. Фоновая загрузка, начатая до действия, не инвалидируется (`requestRef` не увеличивается), поэтому поздний ответ может вернуть строку.

**Что сделать:** вызывать `applyUnreadDelta(-1, mailbox, item.folder)` для непрочитанного при archive/delete (и +1 при undo), инвалидировать текущую загрузку.

## 3. Дополнительно подтверждено

- **Форма создания задачи остаётся активной во время submit.** `NativeTaskCreateScreen.tsx:408-421`, `:593-595`: поля, «Добавить файл», «Создать проект/объект» не блокируются `saving`; `common`/`savedDraft` фиксируются в момент нажатия. Правки и новые файлы после нажатия теряются, задача может уйти в старый проект.
- **Realtime-refresh списка задач сбрасывает загруженные страницы.** `NativeTasksInboxScreen.tsx:322-336`, `:284`: любое событие/реконнект вызывает `loadPage({reset:true,silent:true})`, который заменяет 120 задач первой страницей.
- **В режиме создания узла конфликт кодов проверяется по родителю.** `NativeCompanyNodeEditorSheet.tsx:51`, `:217-230`: `selectedNode` — родитель, поэтому его коды считаются «своими» и доступны новому дочернему узлу; сервер может отклонить сохранение или создать дубль привязки.
- **Ошибка bulk-действия почты не сверяется с сервером.** `useMailSelection.ts:232-236`: при потерянном ответе/5xx показывается ошибка, список и выделение остаются старыми; повтор отправляет bulk повторно. В отличие от одиночных действий, `hasUnconfirmedMailResult`/повторный `load` не используются.

## 4. Проверки

- `npm run lint` (`tsc --noEmit`) — exit 0.
- Целевые Jest-наборы после исправлений: **25 suites / 255 tests passed**.
- Backend auth/push: **126 passed**.
- Полный `npm run test:ci`: **385 suites passed, 2 failed; 2900 tests passed, 3 failed**.
  - `src/auth/twoFactorScreen.test.tsx` — 2 падения `TypeError: resetLoginChallenge is not a function` (мок `useAuth` не обновлён под новый метод; продуктовый код корректен).
  - `scripts/mobile-version.test.js` — отсутствует `android/app/build.gradle` (известное ограничение окружения).

## 5. Что проверено и отброшено

- **Гонка папок почты** — lease/requestRef защищает.
- **Observer = assignee** — backend фильтрует.
- **Лимит 50 заданий Docflow** — явно показан в UI.
- **Лимит очистки корзины 1000** — bounded и покрыт тестом.
- **Серверные фильтры managed-ленты** — поддерживаются.
- **Абсолютный сброс unread из центра уведомлений** — вызывается mark-all-read по всем ящикам.
- **Права статистики** — `statistics.read` выдаётся вместе с `database.read`; дефект MB5-03 именно про отзыв права при открытом экране.

## 6. Ограничения

- Устройство/эмулятор/APK не запускались; поведение на реальном Android не подтверждено.
- MB5-01 подтверждён по backend-ветке `folder_key == "trash"`; на устройстве не воспроизводился.
- MB5-02 зависит от того, что `codes` — результаты поиска, а не полный справочник; это подтверждено кодом.
- MB5-04 зависит от INTEGER-колонки `is_active`; на sqlite/PostgreSQL backend отдаёт 0/1.
- MB5-06 и MB5-16 зависят от наличия локального snapshot/отсутствия realtime-refresh; клиентская часть подтверждена.
