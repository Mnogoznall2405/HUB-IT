# Mobile-hub: независимая проверка исправлений прохода 5

Дата: 13.11.2026.
Область: `mobile-hub` + backend-часть `my_files_service.list_trash`. Проверка read-only: код не изменялся, production не затрагивался.
Метод: сверка текущего кода с `MOBILE_HUB_PASS5_FIX_REVIEW_2026-11-13.md`, целевые Jest-наборы, backend-тесты MyFiles. Устройство/эмулятор/APK не запускались.

## 1. Итог

Из 20 дефектов MB5 **15 закрыты полностью**, 5 имеют остатки. Остаток MB4-02 закрыт только для очистки корзины; удаление папки навсегда по-прежнему оставляет вложенные офлайн-копии. MB4-07, MB4-10 и MB3-11 закрыты.

| ID | Статус | Комментарий |
|---|---|---|
| MB5-01 | закрыт | bulk-delete делит выбор по папкам, trash-письма удаляются с `permanent: true`, диалог предупреждает о необратимости |
| MB5-02 | закрыт | `replaceCodesByGroup` объединяет коды, а не заменяет весь набор |
| MB5-03 | закрыт | при `!canView` очищаются payloads, ошибки, picker и листы |
| MB5-04 | закрыт | `normalizeActiveFlag` + `Boolean()` в `draftFrom` |
| MB5-05 | **регрессия** | 403 больше не валит остальные справочники, но при частичной ошибке эффект уходит в бесконечный цикл запросов, пока открыты фильтры |
| MB5-06 | закрыт | `lastMutationAtRef` не даёт применить старый snapshot после мутации |
| MB5-07 | **закрыт, edge** | битые записи пропускаются; исключение самого `SecureStore.getItemAsync` всё ещё блокирует compose |
| MB5-08 | закрыт | group-restriction и mention-поля сохраняются |
| MB5-09 | **частично** | смена ящика пересоздаёт локальную сессию, но ошибка `next.write` игнорируется, а `draftId` старого ящика не сбрасывается |
| MB5-10 | закрыт | reset-ошибка очищает список и pagination |
| MB5-11 | закрыт | дата снапшота откатывается, ошибка видна |
| MB5-12 | закрыт | ошибка remote-поиска показывается с retry |
| MB5-13 | закрыт | чипы строятся из полного списка + «Все» |
| MB5-14 | закрыт | пустая подпись не затирает текст композера |
| MB5-15 | **частично** | серверный mark-read закрыт `nearBottomRef`, но локальный бейдж инбокса очищается безусловно |
| MB5-16 | закрыт | `capabilities` мерджатся из текущей карточки |
| MB5-17 | закрыт | отмена picker не стирает выбранный файл |
| MB5-18 | закрыт | cid-изображения гидрируются в цепочке |
| MB5-19 | **частично** | TTL дерева снижен до 15 с, но немедленный возврат с управления папками и настройки вида до 60 с остаются старыми |
| MB5-20 | закрыт | одиночные archive/delete обновляют unread-дельты |
| MB4-02 | **частично** | очистка корзины снимает вложенные копии; purge папки — нет |
| MB4-07 | закрыт | replay выполняется при `!user`, offline→online и foreground |
| MB4-10 | закрыт | ошибка проверки всегда `status: 'error'` |
| MB3-11 | закрыт | `commentId` передаётся query-параметром |

## 2. Остатки

### MB5-05. Регрессия: цикл повторных запросов справочников

`mobile-hub/src/screens/tasks/NativeTasksInboxScreen.tsx:347-370`.

```tsx
347:  useEffect(() => {
348:    if (offlineMode || !filtersVisible || directoriesLoading || directoriesLoaded) return;
349:    setDirectoriesLoading(true);
350:    void Promise.allSettled([...]).then((results) => {
...
360:      if (failed.length) {
361:        // Keep directoriesLoaded=false so reopening filters retries the
362:        // failed requests; data that did load is still usable.
363:        setError('Не удалось загрузить часть справочников...');
364:      } else {
365:        setDirectoriesLoaded(true);
366:      }
367:    }).finally(() => {
368:      setDirectoriesLoading(false);
369:    });
370:  }, [canManageAll, directoriesLoaded, directoriesLoading, filtersVisible]);
```

`directoriesLoading` входит в зависимости. При частичном сбое `directoriesLoaded` остаётся `false`, `finally` ставит `directoriesLoading=false`, эффект запускается снова и немедленно делает новый запрос. Пока открыты фильтры, это бесконечный цикл `/departments` + поиск контролёров/исполнителей.

**Что сделать:** убрать `directoriesLoading` из зависимостей (заменить ref-защитой) или вводить `retryToken`, который меняется только при закрытии/открытии фильтров.

### MB5-07. Исключение SecureStore всё ещё блокирует compose

`mobile-hub/src/mail/nativeMailComposeDrafts.ts:52-60`; `NativeMailComposeScreen.tsx:336-339`, `438-446`.

```ts
52: async function readAll(): Promise<Entry[]> {
53:   const raw = await SecureStore.getItemAsync(KEY);   // ← вне try
54:   let entries: unknown;
55:   try { entries = raw ? JSON.parse(raw) : []; }
56:   catch { return []; }
```

Повреждённый JSON и битые записи теперь обрабатываются, но сбой самого `getItemAsync` (инвалидированный keystore, ошибка хранилища) по-прежнему выбрасывает исключение. `restoreLocal` падает, внешний `catch` повторяет его и снова падает; экран показывает «Не удалось открыть редактор» без очистки. Новое письмо/ответ/пересылка недоступны.

**Что сделать:** обернуть чтение в `try/catch`, считать его пустым черновиком с предупреждением, не блокировать compose.

### MB5-09. Ошибка переноса локального черновика и старый `draftId`

`mobile-hub/src/screens/mail/NativeMailComposeScreen.tsx:684-698`.

```tsx
684:  const selectMailbox = useCallback((nextMailboxId: string) => {
...
689:    const next = createMailComposeDraftSession({ userId: user.id, mailboxId: nextMailboxId, ... });
690:    localSessionRef.current = next;
695:    void next.write(localState)
696:      .then(() => previous?.clear().catch(() => undefined))
697:      .catch(() => undefined);          // ← ошибка проглочена
698:  }, [initialDraftId, localState, mailboxId, mode, sourceMessageId, user?.id]);
```

При сбое записи `localSessionRef` уже указывает на пустую сессию нового ящика, `previous` не очищается, а `localState` не меняется — автосохранение не перезапускается. Если закрыть приложение без правок, черновик нового ящика пуст. Кроме того, `draftId` старого ящика остаётся в состоянии и уходит в `payload` вместе с `fromMailboxId` нового; серверный черновик может обновиться не в том ящике или отклонить сохранение.

**Что сделать:** при ошибке `next.write` откатывать `localSessionRef` на `previous` и показывать ошибку; при смене ящика очищать/переносить `draftId`.

### MB5-15. Локальный бейдж очищается без mark-read

`mobile-hub/src/screens/chat/useThreadBack.ts:115-137`; `chat/chatState.ts:314-327`; `screens/chat/useInboxData.ts:341-346`.

```ts
115:  const leaveThread = useCallback(() => {
...
120:      const latest = findLatestIncomingMessage(messagesRef.current, userId);
121:      notifyNativeChatConversationRead(conversationId);   // ← всегда
...
132:      if (!offlineMode && latest?.id && (nearBottomRef?.current ?? true)) {
133:        if (markReadRef?.current) markReadRef.current(latest);
134:        else void chatApi.markConversationRead(conversationId, latest.id)...
135:      }
```

Серверный mark-read теперь закрыт `nearBottomRef`, но `notifyNativeChatConversationRead` вызывается до проверки. Подписчик `useInboxData` обнуляет `unread_count` в списке и инкрементирует `snapshotRevision`, поэтому очищенное состояние сохраняется в локальный снимок. При выходе из прокрученного вверх треда бейдж инбокса исчезает, хотя сообщения не были прочитаны; после холодного старта офлайн бейдж тоже неверен.

**Что сделать:** вызывать `notifyNativeChatConversationRead` только внутри условия `nearBottomRef.current`.

### MB5-19. Немедленный возврат и настройки вида остаются старыми

`mobile-hub/src/mail/useMailList.ts:33-35`, `199-204`, `282-294`.

```ts
33: export const MAIL_METADATA_TTL_MS = 60_000;
34: // Folder membership changes often (moves, new mail) - 60 s is too stale.
35: export const MAIL_FOLDER_TREE_TTL_MS = 15_000;
...
201: const reloadMetadata = reset && (refresh || metadataFreshRef.current.scope !== metadataScope
202:   || metadataAge >= MAIL_METADATA_TTL_MS);
203: const reloadFolderTree = reset && (refresh || metadataFreshRef.current.scope !== metadataScope
204:   || metadataAge >= MAIL_FOLDER_TREE_TTL_MS);
...
289: void load({ reset: true }).finally(...)   // useFocusEffect без refresh
```

Снижение TTL не решает исходный сценарий: пользователь создаёт/переименовывает/удаляет папку и возвращается в инбокс быстрее 15 с — дерево не перезапрашивается. Настройки плотности/сниппетов живут до 60 с. Если удалена текущая папка, список продолжает запрашивать её.

**Что сделать:** при возврате с экрана папок/настроек передавать `refresh: true` или инвалидировать `metadataFreshRef`; при удалении текущей папки переключать на inbox.

### MB4-02. Purge папки не снимает вложенные офлайн-копии

`mobile-hub/src/screens/myFiles/NativeMyFilesScreen.tsx:819-838`, `755-785`; backend `my_files_service.py:2169-2224`.

```tsx
826:          void runFolderAction(folder, 'purge', async () => {
827:            await purgeMyFileFolder(folder.id);          // ← сначала удаляет всё поддерево
828:            await removeOfflineCopiesInFolder(folder.id); // ← потом читает корзину
...
771:    const trash = await listMyFilesTrash().catch(() => null);
772:    if (trash) {
773:      for (const entry of trash.allFolders) addFolderLink(entry.id, entry.parentId);
774:    }
```

`purge_folder` каскадно удаляет папку и всех потомков (`_folder_descendant_ids_locked(..., include_deleted=True)`), после чего `listMyFilesTrash` уже не содержит ни удалённой папки, ни вложенных. `allFolders`/`folders` на экране — только активные папки. Поэтому поддерево строится из одного `folderId`; офлайн-копии файлов во вложенных папках остаются в «На устройстве».

Очистка корзины исправлена корректно: `trash.allFileIds` собирается **до** `emptyMyFilesTrash` (`:851-859`).

**Что сделать:** получать полный scope корзины до `purgeMyFileFolder` и передавать его в `removeOfflineCopiesInFolder`, либо удалять офлайн-записи по `allFileIds` до очистки.

## 3. Проверки

- `npm run lint` (`tsc --noEmit`) — exit 0.
- Целевые Jest-наборы: **26 suites / 419 tests passed** (auth, myFiles, tasks, mail, chat, computers, addressBook, companyStructure, statistics, navigation, updates).
- Backend MyFiles: **77 passed** (`test_my_files_service.py`, `test_my_files_storage_v2.py`, `test_chat_attachment_save_to_my_files.py`).
- Полный `npm run test:ci`: **386/387 suites, 2902/2903 tests passed**. Единственное падение — `scripts/mobile-version.test.js` из-за отсутствующего `android/app/build.gradle` (ограничение окружения); `twoFactorScreen.test.tsx` теперь проходит.

## 4. Ограничения

- Устройство/эмулятор/APK не запускались.
- MB5-05 подтверждён по зависимостям эффекта; на устройстве цикл не воспроизводился.
- MB5-09 зависит от сбоя записи SecureStore и от поведения backend при `draftId` другого ящика.
- MB5-15 подтверждён по коду: `notify...` вызывает `clearConversationUnread` и запись снимка.
- MB5-19: 15 с — всё ещё окно staleness; настройки вида — до 60 с.
- MB4-02 purge подтверждён порядком вызовов и каскадным `purge_folder`.
