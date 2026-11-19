# Mobile-hub: аудит после исправлений, проход 6

Дата: 13.11.2026.
Область: только `mobile-hub` + сверка контрактов с backend. Проверка read-only: код не изменялся, production не затрагивался.
Метод: статический разбор мобильного клиента и backend-контрактов; целевые Jest-наборы, backend-тесты MyFiles, полный `test:ci`. Устройство/эмулятор/APK не запускались.

Не включены известные MB-01…MB-14, MB2-01…MB2-14, MB3-01…MB3-17, MB4-01…MB4-24, MB5-01…MB5-20 и остатки, зафиксированные в `MOBILE_HUB_PASS5_FIX_VERIFY_2026-11-13.md` (кроме регрессии MB5-05, которая вынесена как MB6-01).

## 1. Итог

Найдено **19 новых дефектов**: 5 высоких, 13 средних, 1 средне-низкий. Отдельно подтверждены 4 менее критичных дефекта.

| ID | Severity | Область | Кратко |
|---|---|---|---|
| MB6-01 | высокий | задачи | регрессия MB5-05: бесконечный цикл запросов справочников при частичной ошибке |
| MB6-02 | высокий | auth | повторный вход через «Безопасность» не завершает сессию прежнего пользователя |
| MB6-03 | высокий | MyFiles | одинаковые имя+размер в одной загрузке делят серверную сессию — потеря файла |
| MB6-04 | высокий | инвентарь | повторное «Списать 1» может списать расходник дважды |
| MB6-05 | высокий | share | входящий share пользователя A остаётся и показывается пользователю B |
| MB6-06 | средний | auth | офлайн-биометрия восстанавливает устаревшие роль и права |
| MB6-07 | средний | уведомления | пуш обсуждения задачи открывает список задач, а не карточку |
| MB6-08 | средний | админка | синхронизация отделов оставляет старый состав и позволяет назначить руководителя переведённому |
| MB6-09 | средний | главная | после отзыва `tasks.read`/`dashboard.read` блок «Требует внимания» остаётся |
| MB6-10 | средний | пароли | хранилище молча показывает только первые 100 записей |
| MB6-11 | средний | инвентарь | ошибка смены фильтра оставляет старый список и ломает offset |
| MB6-12 | средний | MyFiles | удаление папки не обновляет квоту и `allFolders` |
| MB6-13 | средний | MyFiles | кэш предпросмотра/файла не учитывает `updated_at` |
| MB6-14 | средний | 2FA | экран настройки 2FA показывает секрет и резервные коды без защиты от скриншотов |
| MB6-15 | средний | уведомления | просроченный быстрый ответ теряется, уведомление с «Повторить» остаётся мёртвым |
| MB6-16 | средний | MyFiles | длинные многобайтовые имена не влезают в 255-байтовый лимит ФС |
| MB6-17 | средний | auth | отключение отпечатка офлайн не отзывает серверный credential |
| MB6-18 | средний | auth | биометрический вход считает 403/500/сбой хранилища «офлайном» и открывает кэш |
| MB6-19 | средне-низкий | auth | блокировка приложения fail-open при ошибке SecureStore |

## 2. Детали

### MB6-01. Регрессия MB5-05: бесконечный цикл справочников

**Severity: высокий. Confidence: высокая.**
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

**Сценарий:** у пользователя нет `settings.read`/`departments.manage`, `/departments` отвечает 403. Открыть фильтры задач → запросы повторяются без остановки.

**Что сделать:** убрать `directoriesLoading` из зависимостей (ref-защита) или вводить `retryToken`, который меняется только при закрытии/открытии фильтров.

### MB6-02. Повторный вход не завершает сессию прежнего пользователя

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/auth/AuthContext.tsx:585-629`; `src/screens/account/NativeSecuritySettingsScreen.tsx:171-174`; `src/auth/logout.ts:148-162`; backend `session_service.py:686-698`.

```tsx
585:  const login = useCallback(async (username: string, password: string) => {
586:    const assertCurrent = beginAuthentication();
...
594:    await persistLoginResult(result, assertCurrent);
...
622:    if (result.user) {
623:      setUser(result.user);
624:      cacheSessionUserInBackground(result.user);
625:    }
```

`login` перезаписывает токены и пользователя, но не вызывает `endMobileSession`/`logout`. Кнопка «Подтвердить вход и 2FA» в настройках безопасности делает `router.push('/(auth)/login')`; экран логина не перенаправляет уже авторизованного пользователя (эффект срабатывает только при `sessionRestoreState` `unavailable/checking`). Пользователь B может войти на устройстве, где активен A.

`logout` при этом очищает токены с `clearOfflineData: true`, кэши, черновики и уведомления. Повторный вход этого не делает. Backend создаёт сессию по ключу `user_id + client_device_key_hash`; для B это новая строка, сессия A остаётся активной.

**Влияние:** сессия/refresh A живёт до истечения; офлайн-снимки, черновики и доставленные уведомления A остаются на устройстве; push-регистрация A не отзывается. На общем устройстве это обходит очистку, которую даёт обычный logout.

**Что сделать:** перед сменой пользователя вызывать `endMobileSession`/полную очистку, либо запретить вход из настроек без предварительного logout.

### MB6-03. Одинаковые имя+размер делят серверную сессию загрузки

**Severity: высокий. Confidence: высокая (механизм), средняя (частота).**
`mobile-hub/src/screens/myFiles/NativeMyFilesScreen.tsx:462-491`; `src/myFiles/nativeMyFilesTransfers.ts:326`; backend `api/v1/my_files.py:807-819`; `services/my_files_service.py:1442-1468`, `1745-1766`.

```tsx
462:      const runNext = async (): Promise<void> => {
...
471:            await uploadNativeMyFile(file, retentionDays, {
...
491:      await Promise.all(Array.from({ length: Math.min(MY_FILES_UPLOAD_CONCURRENCY, files.length) }, runNext));
```

```py
818:            reuse_existing=True,
...
1442:                if reuse_existing:
...
1467:                    if existing is not None:
1468:                        return self._response(existing, session=session)
```

Клиент запускает 2 загрузки параллельно. Backend при `reuse_existing=True` ищет активную резервацию по `original_file_name + original_size_bytes + folder_id` и возвращает **тот же `file_id`**. Два разных файла с одинаковым именем и размером (например, две копии «Акт.pdf» из разных папок) пишут чанки в одну сессию. Первый `complete` переводит файл в `queued`; второй получает «Upload reservation is not active», клиент вызывает `cancelMyFileUploadSession`, а `abort_upload` без проверки статуса ставит уже опубликованную строку в `failed` и очищает spool.

**Влияние:** потеря обеих загрузок; один файл навсегда помечается ошибкой, второй показывает ошибку. Для одинакового содержимого — тихая потеря второй копии.

**Что сделать:** не переиспользовать резервацию для разных файлов в одной пачке (передавать уникальный `client_file_id`/`upload_batch_id`), либо сериализовать одинаковые имя+размер на клиенте, либо в `abort_upload` не трогать строки в статусах `queued/scanning/processing`.

### MB6-04. Повторное «Списать 1» может списать расходник дважды

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/database/NativeDatabaseScreen.tsx:825-837`; `src/api/databaseApi.ts:561-573`, `1308-1387`; backend `api/v1/equipment.py:2271-2314`; `services/transfer_act_job_service.py:133-136`.

```tsx
825:      if (cartridgeLike && scanCardMfu) {
826:        const result = await recordEquipmentWork({
827:          kind: 'cartridge',
828:          equipment: scanCardMfu,
829:          consumable: scanCard,
830:          databaseId: targetDatabaseId,
831:        });
...
835:        const result = await consumeConsumableStock(scanCard, 1, targetDatabaseId);
```

```ts
561:export async function consumeConsumableStock(item, qty, databaseId) {
567:  const { data } = await apiClient.post('/equipment/consumables/consume', {
568:    item_id: item.id,
569:    inv_no: item.inv_no || undefined,
570:    qty,
571:    reason: 'qr_scan',
572:  }, databaseHeaders(databaseId));
```

Оба вызова идут без `operation_id`. Для картриджа `recordEquipmentWork` передаёт `work`, и backend создаёт durable-job, но при пустом `operation_id` `create_job` генерирует новый `uuid4` на каждый запрос. Для обычного расходника используется legacy-ветка без идемпотентности.

**Сценарий:** сервер списал остаток, ответ потерялся/таймаут. Экран показывает ошибку, `scanCardBusy` сбрасывается; пользователь нажимает «Списать 1» повторно — остаток уменьшается второй раз и появляется вторая запись работы.

**Что сделать:** генерировать `operation_id` на попытку списания и передавать его в обоих вызовах; для обычного расходника использовать durable-путь с `operation_id`.

### MB6-05. Входящий share переживает logout и достаётся следующему пользователю

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/share/incomingShare.ts:29`, `105-129`; `src/share/IncomingShareGate.tsx:58-64`, `128`; `src/auth/logout.ts:148-162`; `src/screens/mail/NativeMailComposeScreen.tsx:291-308`.

```ts
29: let queuedNativeShare: QueuedIncomingShare | null = null;
...
105: export function queueIncomingShare(share, target, extra = {}) {
110:   queuedNativeShare = { ...share, target, ... };
...
120: export function consumeIncomingShare(target, conversationId) {
124:   if (queuedNativeShare?.target !== target) return null;
125:   if (target === 'chat' && queuedNativeShare.conversationId !== conversationId) return null;
126:   const share = queuedNativeShare;
127:   queuedNativeShare = null;
128:   return share;
```

```tsx
128:      visible={Boolean(user && share)}
```

`IncomingShareGate` смонтирован в корневом layout и не размонтируется при logout. `share` в состоянии и `queuedNativeShare` в модуле не очищаются ни `logout`, ни `endMobileSession`. Если A выбрал «Создать письмо/задачу», но экран не успел потребить share, B после входа видит диалог A или получает его текст/файлы в композере.

**Влияние:** контент A (текст, имена и содержимое файлов) попадает в редактор B и может быть отправлен; устаревший share всплывает спустя дни.

**Что сделать:** добавить `clearIncomingShare()` в logout и сбрасывать `share` при смене `user.id`; привязать очередь к `userId`.

### MB6-06. Офлайн-биометрия восстанавливает устаревшие права

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/auth/biometricAuth.ts:139-145`; `src/auth/AuthContext.tsx:188`, `502`, `782-785`.

```ts
139:  const credential: BiometricCredential = {
140:    version: CREDENTIAL_VERSION,
141:    user,
142:    offlineCacheKey: bytesToHex(await Crypto.getRandomBytesAsync(32)),
143:    renewalToken: String(renewalToken || '').trim(),
144:    createdAt: new Date().toISOString(),
145:  };
```

`user` (роль и `permissions`) сохраняется в credential только при включении отпечатка. `refreshUser`/`/auth/me` обновляют контекст и `hubit_session_user_cache_v1`, но не перезаписывают `BIOMETRIC_CREDENTIAL_KEY`. При офлайн-входе `unlockWithBiometrics` берёт `credential.user` (строка 782).

**Сценарий:** пользователь включил отпечаток с `passwords.read`/`database.read`; администратор понизил роль. Онлайн профиль обновился. Без сети вход по отпечатку восстанавливает старые права; `hasPermission` снова разрешает отозванные разделы, а ранее подготовленные офлайн-снимки читаются.

**Что сделать:** обновлять `credential.user` при каждом успешном `refreshUser`/renew, либо при офлайн-входе использовать `hubit_session_user_cache_v1` и применять политику «нет свежих прав — нет доступа к sensitive-разделам».

### MB6-07. Пуш обсуждения задачи открывает список задач

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/notifications/notificationNavigation.ts:28-42`; `src/tasks/nativeTasksFeature.ts:72-82`; backend `chat/push_service.py:722-728`.

```ts
31:   const route = String(data.route || '').trim();
32:   if (route) {
33:     const normalized = normalizeNativeRoutePath(route);
34:     return workspace ? mergeChatWorkspaceParam(normalized, workspace) : normalized;
```

```ts
76:  if (taskId) {
77:    if (keys.some((key) => !['task', 'task_id'].includes(key))) return null;
```

Backend для обсуждения задачи отправляет `route = /tasks?task=<id>&task_detail_view=discussion&message=<id>`. Мобильный клиент берёт route как есть; `nativeTasksDestinationFromPortalPath` отклоняет его из-за `task_detail_view`/`message`, другие мапперы не подходят, и `hrefForPortalPath` уходит в `nativeRootFallback('/tasks')` → `/(shell)/tasks`. В payload уже есть `task_id`, но `notificationNavigation` его игнорирует.

**Влияние:** тап по пушу теряет задачу и якорь сообщения; открывается общий список.

**Что сделать:** в `notificationNavigation` при наличии `data.task_id` строить `/(shell)/tasks/[taskId]` (и передавать `message` как якорь), либо расширить `nativeTasksDestinationFromPortalPath` допустимыми ключами.

### MB6-08. Синхронизация отделов оставляет старый состав

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/account/NativeAdminDepartmentsScreen.tsx:146-185`, `101-109`, `73-99`.

```tsx
159:            void (fromAd
160:              ? departmentsApi.syncDepartmentsFromAd()
161:              : departmentsApi.syncDepartmentsFromUsers())
162:              .then(async () => {
...
169:                await loadDepartments();
170:              })
```

```tsx
106:  useEffect(() => {
107:    if (allowed) void loadMembers(selectedId);
108:    return () => { memberRequestRef.current += 1; };
109:  }, [allowed, loadMembers, selectedId]);
```

После синхронизации вызывается только `loadDepartments()`. `loadMembers` перезапускается лишь при смене `selectedId`; выбранный отдел остаётся тем же. Backend `sync_departments_from_users` деактивирует старые AD-членства и создаёт членство в новом отделе, но мобильный список «Состав» и `draftManagerIds` остаются старыми.

**Сценарий:** открыть отдел «ИТ», запустить синхронизацию. Сотрудника перевели в другой отдел; счётчики обновились, но в «Составе» он ещё отображается. Администратор включает ему руководителя и сохраняет — `set_department_managers` добавляет активное членство `manager` в старый отдел.

**Что сделать:** после синхронизации вызывать `loadMembers(selectedId)` (или инвалидировать `memberRequestRef`) и перечитывать `draftManagerIds`; не разрешать сохранение руководителей, пока состав не перезагружен.

### MB6-09. Блок «Требует внимания» остаётся после отзыва прав

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/dashboard/DashboardScreen.tsx:101-107`, `304-309`, `365-369`.

```tsx
101:  const canReadTasks = hasPermission('tasks.read');
...
105:  const canReadNews = hasPermission('dashboard.read');
...
304:  const taskItems = useMemo(() => listDashboardTasks(payload), [payload]);
305:  const announcementItems = useMemo(() => listDashboardAnnouncements(payload), [payload]);
306:  const attentionItems = useMemo(
307:    () => buildAttentionItems(taskItems, announcementItems, user),
308:    [announcementItems, taskItems, user],
309:  );
...
365:        <AttentionBlock
366:          tokens={tokens}
367:          loading={loading}
368:          items={attentionItems}
369:        />
```

`sections` фильтрует блоки `tasks`/`news` по правам, но `attentionItems` строится из `payload` без проверки `canReadTasks`/`canReadNews`, а `AttentionBlock` рендерится всегда. При монтировании сначала восстанавливается локальный snapshot (`:233-254`).

**Сценарий:** у пользователя открыта главная с задачами. Администратор отзывает `tasks.read`; фоновый `/auth/me` обновляет права, но `DashboardContent` не перемонтируется (ключ — только `user.id`). «Требует внимания» продолжает показывать названия задач/объявлений; переход даёт 403. После повторного открытия snapshot восстанавливает старые данные.

**Что сделать:** фильтровать `attentionItems` по `canReadTasks`/`canReadNews` (или не рендерить блок без прав) и очищать `payload` при отзыве.

### MB6-10. Хранилище паролей молча ограничено 100 записями

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/passwords/NativePasswordsScreen.tsx:208-213`, `522-523`; `src/api/passwordsApi.ts:89-114`; backend `api/v1/passwords.py:144`.

```tsx
208:      const result = await listPasswordVaultEntries({ q: query, group, tag, includeArchived, signal: controller.signal });
...
210:      setEntries(result.items);
...
523:        <Text ...>Записей: {entries.length}</Text>
```

```ts
89:export async function listPasswordVaultEntries(options = {}): Promise<PasswordVaultList> {
96:  const response = await apiClient.get('/passwords', {
97:    params: { q: ..., group: ..., tag: ..., include_archived: ... },
```

Клиент не передаёт `limit`/`offset`; backend по умолчанию отдаёт `limit=100` и возвращает `total`, `limit`, `offset`, но мобильный тип эти поля отбрасывает. Экрана «Показать ещё» нет.

**Влияние:** при 150 записях экран показывает «Записей: 100»; записи 101–150 доступны только точным поиском. Часть паролей нельзя просмотреть/отредактировать/ротировать с телефона.

**Что сделать:** передавать `limit`/`offset`, добавить пагинацию и показывать `total`.

### MB6-11. Ошибка смены фильтра инвентаря оставляет старый список

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/database/NativeDatabaseScreen.tsx:415-421`, `486-499`, `567-571`.

```tsx
415:  const loadContent = useCallback(async (refresh = false, append = false) => {
...
418:    if (refresh) setRefreshing(true);
419:    else if (append) setLoadingMore(true);
420:    else setLoading(true);
421:    setError('');
...
486:      if (mode === 'equipment') {
487:        const targetPage = append ? equipmentPageRef.current + 1 : 1;
488:        const result = debouncedQuery.length >= 2
489:          ? await searchEquipment(debouncedQuery, targetPage, SEARCH_LIMIT, currentDatabase.id)
490:          : await listEquipment(targetPage, SEARCH_LIMIT, currentDatabase.id);
...
567:    } catch (cause) {
568:      if (requestId === requestRef.current) {
569:        if (cached) setNotice('Показаны сохранённые данные...');
570:        else setError(formatApiError(cause, ...));
```

При reset/refresh `equipment`, `total`, `equipmentPageRef` и `hasMoreEquipment` не очищаются до запроса. Если запрос падает, под новым текстом поиска остаётся старый список с `hasMore: true`; `onEndReached` берёт offset из старого `equipmentPageRef` и подмешивает страницу нового запроса к старому списку.

**Что сделать:** при reset очищать список/offset до запроса или в `catch`; не давать `loadNextPage` работать при ошибке смены фильтра.

### MB6-12. Удаление папки не обновляет квоту и `allFolders`

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/myFiles/NativeMyFilesScreen.tsx:892-907`, `1013-1016`, `431-441`.

```tsx
899:          void runFolderAction(folder, 'delete', async () => {
900:            await deleteMyFileFolder(folder.id);
901:            if (mountedRef.current) {
902:              setFolders((current) => current.filter((entry) => entry.id !== folder.id));
903:              setAllFolders((current) => current.filter((entry) => entry.id !== folder.id));
904:              if (currentFolderId === folder.id) setCurrentFolderId(null);
905:              setNotice('Папка перемещена в корзину.');
906:            }
907:          });
...
1013:  const openMoveSheet = useCallback((item: MyFileRecord) => {
1014:    if (!allFolders.length) void loadAllFolders();
```

`delete_folder` каскадно помечает файлы `deleted_at`, и серверная квота сразу освобождается, но `quota` в состоянии не перезагружается. `allFolders` теряет только саму папку, а вложенные остаются; шит «Переместить в папку» перезагружает список только если он пуст.

**Сценарий:** удалить папку с 4 ГБ при квоте 5 ГБ и занятых 4,9 ГБ; сразу загрузить файл 1 ГБ → клиент сравнивает с устаревшим `remaining_bytes` и пишет «Недостаточно места». Перемещение в удалённую подпапку даёт 404.

**Что сделать:** после удаления вызывать `loadData({silent:true})`/`getMyFilesQuota` и `loadAllFolders()`; из `allFolders` убирать всё поддерево.

### MB6-13. Кэш предпросмотра/файла не учитывает `updated_at`

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/myFiles/nativeMyFilesTransfers.ts:530-533`, `593-597`; `src/myFiles/nativeMyFilesOfflineStore.ts:195-201`.

```ts
530:  if (destination.exists && destination.size > 0 && destination.size <= maxBytes) {
531:    cleanupCache(destination.uri);
532:    return { file: destination, mimeType };
533:  }
...
593:  if (destination.exists && (!expectedSize || destination.size === expectedSize)) {
594:    cleanupCache(destination.uri);
595:    options.onProgress?.({ loaded: destination.size, total: destination.size, progress: 1 });
596:    return destination;
597:  }
```

```ts
195:function entryMatchesItem(entry: OfflineFileEntry, item: MyFileRecord): boolean {
196:  const expectedSize = expectedFileSize(item);
197:  const expiresAt = fileExpiryMs(entry.expiresAt);
198:  return entry.fileId === item.id
199:    && (!expectedSize || entry.size === expectedSize)
200:    && (!expiresAt || expiresAt > Date.now());
201:}
```

Кэш считается валидным по размеру; `updated_at` не сверяется. Документ, отредактированный в ONLYOFFICE с тем же размером, навсегда отдаёт старую версию до эвикции (7 дней/512 МБ). То же для закреплённой офлайн-копии: `serverUpdatedAt` сохраняется, но не сравнивается с `item.updated_at`.

**Что сделать:** включать `updated_at` (или `blob_id`) в имя кэша/ключ и в `entryMatchesItem`; при расхождении перекачивать.

### MB6-14. Экран настройки 2FA не защищён от скриншотов и recents

**Severity: средний. Confidence: высокая.**
`mobile-hub/app/(auth)/setup-required.tsx:97-130`; `src/privacy/AppPrivacyShield.tsx:8-18`; для сравнения `src/screens/account/NativeSecuritySettingsScreen.tsx:44-58`.

```tsx
97:  if (backupCodes.length) {
98:    return (
...
103:          <View testID="two-factor-backup-codes" ...>
104:            {backupCodes.map((backupCode) => <Text key={backupCode} selectable ...>{backupCode}</Text>)}
...
125:            <View style={[styles.secretCard, ...]}>
127:              <Text testID="two-factor-manual-key" selectable ...>{setup.manual_entry_key}</Text>
```

Экран не импортирует `expo-screen-capture` и не очищает коды при уходе в фон. `AppPrivacyShield` включает защиту только при `authenticated = Boolean(user)`; во время первичной настройки 2FA `user` ещё `null`. Секрет TOTP и резервные коды попадают в скриншот/recents.

**Влияние:** долговременный обход второго фактора; секрет не истекает, резервные коды дают одноразовые входы.

**Что сделать:** вызвать `preventScreenCaptureAsync` на экране настройки 2FA (как в настройках безопасности) и очищать коды при `AppState !== 'active'`.

### MB6-15. Просроченный быстрый ответ теряется, уведомление остаётся мёртвым

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/notifications/pendingNotificationReplies.ts:56-66`, `150-168`; `src/notifications/notificationBackgroundTask.ts:133-140`.

```ts
56:    if (
...
65:      || now - createdAt > MAX_QUEUE_AGE_MS
66:    ) continue;                                    // запись молча выбрасывается
...
152:    const item = queue.find((entry) => entry.id === id && entry.userId === userId) || null;
153:    if (!item || lease !== generation) return { status: 'discarded', item: null };
```

```ts
133:    const result = await retryPendingChatReply(pendingId, userId);
134:    if (result.status === 'sent' && result.item) await showReplySent(result.item);
135:    else if (result.status === 'pending' && result.item) await showReplyPending(result.item);
136:    else if (result.item) await showReplyFailed(result.item);
```

Ответ из уведомления без сети сохраняется с кнопкой «Повторить отправку». Через 24 ч (или при переполнении очереди) `normalizeQueue` вырезает запись. Позже тап по «Повторить» возвращает `{status:'discarded', item:null}`; `showReplyFailed` не вызывается, уведомление не заменяется и не закрывается — кнопка остаётся навсегда и ничего не делает. Текст пользователя потерян без предупреждения.

**Что сделать:** при `discarded` заменять уведомление на «Ответ не отправлен, текст потерян» или удалять его; при вытеснении показывать предупреждение.

### MB6-16. Длинные многобайтовые имена не влезают в лимит ФС

**Severity: средний. Confidence: средне-высокая.**
`mobile-hub/src/files/filePolicy.ts:34-48`; `src/myFiles/nativeMyFilesTransfers.ts:526-527`, `587-589`.

```ts
34:export function sanitizeNativeFileName(value: string): string {
...
44:  const fallback = normalized || 'hubit-file';
45:  if (fallback.length <= 180) return fallback;
46:  const dot = fallback.lastIndexOf('.');
47:  const extension = dot > 0 ? fallback.slice(dot, dot + 24) : '';
48:  return `${fallback.slice(0, Math.max(1, 180 - extension.length))}${extension}`;
49:}
```

Санитайзер режет по **символам** (180), а Android/ext4/f2fs допускает 255 **байт** на имя. Для кириллицы 1 символ = 2 байта; в `downloadNativeMyFile` имя `${safeId}-${safeName}` (32-символьный id + дефис + до 180 символов). Уже при ~110 кириллических символах имя превышает 255 байт, и `File.downloadFileAsync` падает с `ENAMETOOLONG`. То же в `preview-${safeId}-${sourceName}` и в `.part`-файлах.

**Влияние:** файл с длинным русским названием нельзя открыть, скачать, отправить, сохранить офлайн или показать в предпросмотре; в вебе тот же файл работает.

**Что сделать:** ограничивать имя по UTF-8 байтам (с запасом под id/суффиксы), а не по символам.

### MB6-17. Отключение отпечатка офлайн не отзывает серверный credential

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/auth/AuthContext.tsx:708-718`; `src/api/client.ts:104-106`.

```tsx
708:  const skipBiometrics = useCallback(async () => {
709:    const assertCurrent = currentSessionGuard();
710:    await authApi.revokeMobileBiometricSession().catch(() => undefined);
711:    assertCurrent();
712:    await disableBiometricLogin();
...
717:    setOfflineCacheKey(null);
718:  }, [currentSessionGuard]);
```

`revokeMobileBiometricSession()` идёт через `apiClient.delete`. В офлайне интерцептор вообще не отправляет мутацию (`HUBIT_OFFLINE_READ_ONLY`), при сетевой ошибке запрос падает; оба случая проглатываются. Отложенной очереди, аналогичной `pendingLogoutCleanup`, нет. `applyBiometricOwnership` при входе другого пользователя тоже делает только локальный `disableBiometricLogin()`.

**Влияние:** UI сообщает «отпечаток отключён», но серверная регистрация остаётся активной; в «Мои устройства» устройство по-прежнему биометрическое. Если локальное удаление частично не удалось, отпечаток продолжает работать.

**Что сделать:** ставить отзыв в durable-очередь и повторять при online/foreground; не показывать успех, пока сервер не подтвердил (или явно писать «отключено локально, сервер повторит»).

### MB6-18. Биометрический вход считает 403/500/сбой хранилища «офлайном»

**Severity: средний. Confidence: высокая (классификация), средняя (конкретный 403).**
`mobile-hub/src/auth/AuthContext.tsx:772-786`; `src/api/client.ts:223-235`.

```tsx
772:      } catch (error: unknown) {
773:        assertCurrent();
774:        if (isUserDeactivatedRejection(error)) {
775:          await wipeDeactivatedSession();
...
778:        if (isDefinitiveAuthRejection(error)) {
779:          await skipBiometrics();
...
782:        setUser(credential.user);
783:        cacheSessionUserInBackground(credential.user);
784:        setSessionOfflineMode(true);
785:        return { user: credential.user, offline: true };
786:      }
```

`isDefinitiveAuthRejection` — только JSON 401. Любая другая ошибка внутреннего `try` (`renewMobileBiometricSession`, `persistLoginResult`, `fetchMe`, `markApiOnline`), включая JSON 403, 400, 500 и сбой SecureStore при сохранении токенов, приводит к `offline: true` и входу в шелл с `credential.user`. `isNetworkRestrictedRejection` здесь не вызывается, хотя при старте/восстановлении JSON 403 корректно трактуется как отказ HUB-IT.

**Влияние:** серверный запрет/отзыв или ошибка сервера не показываются; приложение открывает ранее загруженный офлайн-кэш в режиме чтения. Пользователь видит неверное состояние «нет связи».

**Что сделать:** различать transport failure и JSON-ответ; для 403/400/500 и ошибок хранилища показывать отказ/повтор, а не офлайн-вход.

### MB6-19. Блокировка приложения fail-open при ошибке SecureStore

**Severity: средне-низкий. Confidence: средне-высокая.**
`mobile-hub/src/auth/biometricAuth.ts:112-119`, `211-224`; `src/auth/AppLockGate.tsx:79-81`.

```ts
112: async function isBiometricLoginEnabledInternal(): Promise<boolean> {
113:   if (Platform.OS === 'web') return false;
114:   try {
115:     return (await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)) === '1';
116:   } catch {
117:     return false;
118:   }
119: }
...
212:   if (Platform.OS === 'web' || !(await isBiometricLoginEnabledInternal())) {
213:     return { enabled: false, timeoutSeconds: 60 };
214:   }
```

```tsx
79:  useEffect(() => {
80:    if (settingsLoaded && !settings.enabled && appLockPendingUnlock) markAppLockUnlocked();
81:  }, [appLockPendingUnlock, markAppLockUnlocked, settings.enabled, settingsLoaded]);
```

Если чтение `hubit_biometric_login_enabled` из SecureStore временно падает, приложение считает биометрию выключенной и не взводит `appLockPendingUnlock`; если флаг успел прочитаться при старте, но `AppLockGate` получил ошибку, эффект снимает блокировку. Кэшированный шелл открывается без отпечатка.

**Что сделать:** при ошибке чтения настроек блокировки вести себя fail-closed: не снимать `appLockPendingUnlock`, показать повтор/выход.

## 3. Дополнительно подтверждено

- **Очистка корзины MyFiles не участвует в блокировке действий.** `NativeMyFilesScreen.tsx:840-878`: `confirmEmptyTrash` не берёт `fileActionLockRef`; параллельное «Восстановить» может успеть до `emptyMyFilesTrash`, но `purgedIds` посчитан заранее и снимет офлайн-копию уже восстановленного файла.
- **«Сохранить офлайн» доступно в офлайне.** `NativeMyFilesScreen.tsx:1043-1051`: у пункта нет `disabled: offlineMode`, хотя `downloadNativeMyFile` требует POST grant и гарантированно падает.
- **Лимиты инструментов AI-бота не совпадают с сервером.** `NativeAdminAdditionalScreens.tsx:224-229` обещает 1–12 раундов и 1–10 вызовов, backend `ai_chat/tools/context.py:320-325` зажимает вызовы до 5; UI не валидирует значения.
- **Поля создания задачи остаются редактируемыми во время submit.** `NativeTaskCreateScreen.tsx:625-633`, `779-786`: `title`/`description` не блокируются `saving`; `common` — снимок на момент нажатия, поэтому правки после «Создать» не уходят и теряются при успехе.
- **Частичный сбой счётчиков занижает бейдж.** `nativeUnreadSnapshot.ts:65-86`, `notificationBadge.ts:15-17`: если hub-счётчики упали, а chat/mail ответили, `successful_sources > 0`, бейдж пересчитывается без `notifications_unread_total`/`announcements_unread` и уменьшается.

## 4. Проверки

- `npm run lint` (`tsc --noEmit`) — exit 0.
- Целевые Jest-наборы: **26 suites / 419 tests passed**.
- Backend MyFiles: **77 passed**.
- Полный `npm run test:ci`: **386/387 suites, 2902/2903 tests passed**. Единственное падение — `scripts/mobile-version.test.js` из-за отсутствующего `android/app/build.gradle` (ограничение окружения).

## 5. Ограничения

- Устройство/эмулятор/APK не запускались; поведение на реальном Android не подтверждено.
- MB6-03 подтверждён по `reuse_existing=True` и клиентской конкурентности 2; на реальных файлах не воспроизводился.
- MB6-04 подтверждён по отсутствию `operation_id` и генерации нового `uuid4`; потерянный ответ/повтор — сценарий, не воспроизведённый на стенде.
- MB6-05 зависит от того, что share не был потреблён до logout; состояние модуля и gate подтверждены кодом.
- MB6-06 зависит от понижения роли и последующего офлайн-входа по отпечатку.
- MB6-16 зависит от байтового лимита ФС Android (255 байт); на конкретном устройстве не проверялся.
- MB6-18: конкретный 403 от `/auth/mobile-biometric/session` не воспроизводился; классификация остальных ошибок подтверждена кодом.
