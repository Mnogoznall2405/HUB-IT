# Mobile-hub: аудит после исправлений, проход 4

Дата: 13.11.2026.
Область: только `mobile-hub`. Проверка read-only: код не изменялся, production не затрагивался.
Проверка исправлений: [MOBILE_HUB_PASS4_FIX_VERIFY_2026-11-13.md](MOBILE_HUB_PASS4_FIX_VERIFY_2026-11-13.md). Следующий проход: [MOBILE_HUB_BUG_AUDIT_2026-11-13_PASS5.md](MOBILE_HUB_BUG_AUDIT_2026-11-13_PASS5.md).
Метод: статический разбор mobile-клиента и сверка с backend-контрактами. Устройство/эмулятор/APK не запускались.

Не включены известные MB-01…MB-14, MB2-01…MB2-14, MB3-01…MB3-17, а также уже проверенные и отброшенные кандидаты (гонка папок почты, observer=assignee, лимит 50 заданий Docflow, лимит очистки корзины 1000, серверные фильтры managed-ленты).

## 1. Итог

Найдено **24 новых дефекта**: 8 высоких, 12 средних, 4 низких. Дополнительно подтверждены 4 мелких остатка без отдельных ID.

| ID | Severity | Область | Кратко |
|---|---|---|---|
| MB4-01 | высокий | почта | после ошибки отправки редактор навсегда блокирует сохранение черновика |
| MB4-02 | высокий | MyFiles | офлайн-копии файлов переживают удаление папки и очистку корзины |
| MB4-03 | высокий | черновики | копия вложения не ожидается, черновик с новым файлом не сохраняется |
| MB4-04 | высокий | админка | сохранение профиля стирает помощников/заместителей, если их список не загрузился |
| MB4-05 | высокий | админка | сохранение руководителей отдела стирает их при ошибке загрузки состава |
| MB4-06 | высокий | админка | мобильный UI молча понижает multi-DB режим AI-бота до `single` |
| MB4-07 | высокий | auth | офлайн-выход оставляет push-регистрацию прежнего пользователя активной |
| MB4-08 | высокий | offline | очередь команд теряет записи после 10 выходов в foreground без сети |
| MB4-09 | средний | MyFiles | транзиентная ошибка чтения манифеста стирает индекс офлайн-копий |
| MB4-10 | средний | обновления | ошибка проверки обновления показывается как «Готово.», меню ставит устаревший feed |
| MB4-11 | средний | MyFiles | проверка квоты не даёт возобновить уже зарезервированную загрузку |
| MB4-12 | средний | MyFiles | переход в offline отменяет серверную сессию загрузки, прогресс теряется |
| MB4-13 | средний | MyFiles | restore/purge/empty trash не обновляют офлайн-снимок |
| MB4-14 | средний | auth | вход по отпечатку не сбрасывает старый 2FA-challenge |
| MB4-15 | средний | лента | «Ответить» затирает уже введённый текст, отмена ответа удаляет вложения |
| MB4-16 | средний | лента | ошибка смены фильтра оставляет старый список и ломает offset следующей страницы |
| MB4-17 | средний | Docflow | silent-обновление подставляет старый snapshot и откатывает подтверждённое действие |
| MB4-18 | средний | склад 1С | очистка чипа номенклатуры не обновляет движения, pull-to-refresh зависает |
| MB4-19 | средний | кэш | кэши файлов БЗ и 1С не очищаются при выходе и по команде очистки |
| MB4-20 | средний | админка | выключение «Активен» сохраняется без подтверждения и разлогинивает пользователя |
| MB4-21 | низкий | лента | markdown-рендер удаляет `_` и `~` из обычного текста (hostname, имена файлов) |
| MB4-22 | низкий | черновики | ошибка чтения локального черновика навсегда блокирует публикацию/создание |
| MB4-23 | низкий | чат | модератору показываются owner-only действия над участниками |
| MB4-24 | низкий | auth | выход не убирает уже доставленные уведомления прежнего пользователя из шторки |

## 2. Детали

### MB4-01. После ошибки отправки редактор письма навсегда блокирует сохранение

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/mail/NativeMailComposeScreen.tsx:829-836`, `:563-564`, `:856-862`, `:731`.

```ts
829:      sendPendingRef.current = true; setSendPending(true);
830:      if (prepared.retry && !retryApproved) {
831:        Alert.alert('Повторить отправку?', '...', [
832:          { text: 'Вернуться', style: 'cancel' },
833:          { text: 'Повторить отправку', onPress: () => { void performSend(true); } },
834:        ]);
835:        return;
836:      }
...
856:    } catch (cause) {
857:      if (ownsEditor()) setError(formatApiError(cause, '...'));
858:    } finally {
859:      editor?.release();
860:      sendInFlightRef.current = false;
861:      if (mountedRef.current) { setSending(false); setUploadProgress(null); }
862:    }
```

`sendPending` сбрасывается только при успехе (`:853`), при явном resolvePending (`:818`) и при смене scope. В `catch` и при выборе «Вернуться» он остаётся `true`. Этот флаг входит в guard `saveDraft` (`:564`) и отключает автосохранение (`:621`), кнопку «Сохранить» (`:963`) и «Сохранить и закрыть» (`:731`). `saveDraft` возвращает `false` без сообщения, диалог закрытия при этом уже закрыт.

**Сценарий:** пользователь пишет длинное письмо с вложением, нажимает «Отправить», сервер отклоняет вложение/получателя (413/422) или ответ теряется. Появляется ошибка и баннер «Проверить отправленные», но сохранить текст нельзя; «Сохранить и закрыть» молча ничего не делает. Остаётся «Закрыть без изменений» (потеря текста) или «Повторить» (риск дубля, если письмо уже доставлено).

**Что сделать:** дать явное действие «Снять pending / сохранить как черновик» после проверки «Отправленных»; в ветке «Вернуться» сбрасывать `sendPending`, если пользователь отказался от повтора; не возвращать `false` из `saveDraft` без обратной связи.

### MB4-02. Офлайн-копии переживают удаление папки и очистку корзины

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/myFiles/NativeMyFilesScreen.tsx:765-806`, `:742-744`, `:711-713`.

```tsx
772:          void runFolderAction(folder, 'purge', async () => {
773:            await purgeMyFileFolder(folder.id);
774:            if (mountedRef.current) {
775:              setFolders((current) => current.filter((entry) => entry.id !== folder.id));
776:              setNotice('Папка удалена навсегда.');
777:            }
...
791:          void (async () => {
792:            try {
793:              await emptyMyFilesTrash();
794:              if (mountedRef.current) {
795:                setItems([]);
796:                setFolders([]);
```

Для одиночного файла `confirmPurgeFile` вызывает `removeNativeMyFileOffline` (`:744`), а для папки и очистки корзины — нет. Сервер удаляет файлы каскадом, но локальные копии в `hubit-my-files-offline/user-N` остаются и видны в «На устройстве».

**Сценарий:** сохранить файл из папки A офлайн, удалить A в корзину, затем «Удалить навсегда» или «Очистить корзину». Файл исчезает с сервера, но остаётся на устройстве, открывается и шарится. При retention «Навсегда» — бессрочно.

**Что сделать:** при purge папки и очистке корзины удалять офлайн-записи всех вложенных файлов (по списку из корзины/папки до удаления), а не только UI-строки.

### MB4-03. Копия вложения в черновик не ожидается

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/drafts/nativeFormDrafts.ts:32-35`; `mobile-hub/src/mail/nativeMailComposeDrafts.ts:121-123`; `mobile-hub/src/database/pendingPhotoStore.ts:63-66`.

```ts
32:       directory.create({ intermediates: true, idempotent: true });
33:       const target = new File(directory, randomUUID?.() || `draft-${Date.now()}-...`);
34:       file.copy(target);
35:       if (!target.exists || target.size !== file.size) throw new Error('Не удалось сохранить вложение на устройстве.');
```

`File.copy()` в `expo-file-system` возвращает `Promise<void>`; синхронный `copySync` — отдельный метод. В чате тот же код уже исправлен и содержит комментарий: `await source.copy(destination)` и «never check size before it settles» (`src/chat/nativeChatDraftFiles.ts:146-148`). Здесь `copy` не ожидается, проверка `target.exists/size` выполняется до завершения нативной копии.

**Сценарий:** добавить новое вложение в черновик задачи/ленты/Docflow, письма или в очередь фото сканера. Автосохранение копирует файл, сразу проверяет размер, получает «не готово» и выбрасывает «Не удалось сохранить вложение». Черновик не сохраняется; в `pendingPhotoStore` индекс может ссылаться на ещё не созданную копию.

**Что сделать:** сделать `durableState` асинхронным и `await file.copy(target)` либо использовать `copySync`; то же в `nativeMailComposeDrafts.ts` и `pendingPhotoStore.ts`.

### MB4-04. Сохранение профиля стирает помощников и заместителей при ошибке их загрузки

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/account/NativeAdminUsersScreen.tsx:266-278`, `:304-318`, `:580-585`; backend `WEB-itinvent/backend/services/user_service.py:589-626`.

```tsx
269:      if (draft.id) {
270:        await userAdminApi.updateUser(draft.id, payload);
271:        if (!mounted.current) return;
272:        profileSaved = true;
273:        await userAdminApi.updateTaskDelegates(draft.id, delegateLinks.map((item) => ({
274:          delegate_user_id: item.delegate_user_id,
...
308:    setDelegateLinks([]);
...
312:    setDelegatesLoading(true);
313:    try {
314:      const links = await userAdminApi.getTaskDelegates(item.id);
```

`openUser` сначала очищает `delegateLinks`, затем асинхронно грузит связи. Кнопка «Сохранить» блокируется только по `saving` (`:582`), не по `delegatesLoading`. Backend `replace_task_delegates` заменяет весь набор: строки, не попавшие в `incoming_delegate_ids`, удаляются.

**Сценарий:** администратор открывает пользователя, запрос `getTaskDelegates` падает или ещё выполняется, администратор меняет должность и нажимает «Сохранить». Уходит `updateTaskDelegates(id, [])`, все помощники/заместители удаляются. Ошибка загрузки остаётся только текстом статуса, сохранение её не блокирует.

**Что сделать:** блокировать сохранение до успешной загрузки делегатов либо не отправлять `updateTaskDelegates`, если загрузка не удалась; хранить признак «delegates loaded».

### MB4-05. Сохранение руководителей отдела стирает их при ошибке загрузки состава

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/account/NativeAdminDepartmentsScreen.tsx:70-93`, `:124-139`, `:269-275`; backend `WEB-itinvent/backend/services/department_service.py:359-398`.

```tsx
73:    setMemberships([]);
74:    setDraftManagerIds([]);
...
88:    } catch (error) {
89:      if (!current()) return;
90:      setStatus({ error: formatApiError(error, 'Не удалось загрузить состав отдела.'), message: '' });
91:    } finally {
92:      if (current()) setMembersLoading(false);
93:    }
...
269:        <AccountPrimaryButton
271:          disabled={!selectedId || membersLoading || offlineMode}
273:          label="Сохранить руководителей"
```

После ошибки `membersLoading` становится `false`, кнопка снова активна, `draftManagerIds` пуст. `setDepartmentManagers(id, [])` деактивирует всех руководителей отдела.

**Сценарий:** открыть отдел, запрос состава падает (500/сеть), нажать «Сохранить руководителей» — все руководители отдела теряют роль. В UI при этом «Нет сотрудников в отделе».

**Что сделать:** при ошибке загрузки состава блокировать сохранение руководителей и не отправлять пустой список; различать «пусто» и «не загружено».

### MB4-06. Мобильный UI молча понижает multi-DB режим AI-бота

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/screens/account/NativeAdminAdditionalScreens.tsx:118-131`, `:175-188`; backend `WEB-itinvent/backend/ai_chat/tools/context.py:182-183`, `:303-305`.

```tsx
125:      tool_settings: {
126:        multi_db_mode: toolSettings.multi_db_mode === 'multi' ? 'multi' : 'single',
...
176:            {([['single', 'Одна база'], ['multi', 'Несколько баз']] as const).map(([mode, label]) => (
182:                onPress={() => setDraft({ ...draft, tool_settings: { ...draft.tool_settings, multi_db_mode: mode } })}
```

Backend принимает только `single` и `admin_multi_db`, всё остальное приводит к `single`. Мобильный тип и UI используют `'multi'`.

**Сценарий:** бот настроен в web как `admin_multi_db`; в мобильном UI режим выглядит как «Одна база». Любое сохранение другого поля отправляет `single` и отключает multi-DB поиск. Выбор «Несколько баз» отправляет `multi`, который backend тоже превращает в `single`.

**Что сделать:** использовать `admin_multi_db` в типе, UI и payload; мигрировать существующее значение `multi`.

### MB4-07. Офлайн-выход оставляет push-регистрацию прежнего пользователя

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/auth/logout.ts:47-61`, `:102-137`; `mobile-hub/src/lifecycle/AppLifecycle.tsx:195-201`; backend `WEB-itinvent/backend/api/v1/auth.py:1128-1138`.

```ts
47:  if (credentials.pushToken) {
48:    try {
49:      await axios.delete(`${API_V1_BASE}/settings/notifications/native-push-token`, {
...
58:    } catch {
59:      // Push cleanup is best-effort; the stored token can be reconciled after login.
60:    }
61:  }
```

Серверный `/auth/logout` push-токены не удаляет. При офлайн-выходе или 5xx DELETE проглатывается, локальные токены стираются, а строка `app.native_push_tokens` остаётся активной для пользователя A. Повтора нет: `syncNativePushToken` вызывается только при наличии `user`.

**Сценарий:** A выходит из аккаунта без сети. Устройство продолжает получать и показывать push A (шторка/lock screen), пока кто-нибудь не войдёт и не перепривяжет токен. Для общего телефона — утечка переписки/почты следующему пользователю.

**Что сделать:** сохранять «отложенный logout push» и повторять удаление при следующем запуске/появлении сети; либо удалять push-токены пользователя на сервере в `/auth/logout` для mobile-клиента.

### MB4-08. Очередь офлайн-команд теряет записи после 10 выходов в foreground

**Severity: высокий. Confidence: высокая.**
`mobile-hub/src/offline/offlineCommandQueue.ts:95-101`, `:214-245`; `mobile-hub/src/lifecycle/AppLifecycle.tsx:270-277`.

```ts
232:      if (retry && command.attempts + 1 >= MAX_COMMAND_ATTEMPTS) {
...
236:        retry = false;
...
241:        await saveQueue(retry
242:          ? current.map(item => item.id === command.id ? { ...item, attempts: item.attempts + 1 } : item)
243:          : current.filter(item => item.id !== command.id));
```

`isRetryableOfflineError` считает `HUBIT_OFFLINE_READ_ONLY` retryable. `AppLifecycle` вызывает `drainOfflineCommandQueue(user.id)` на каждом `active` без проверки `offlineMode`. Каждый выход в foreground увеличивает `attempts`; на 10-й записи удаляются.

**Сценарий:** пользователь офлайн 10 раз открывает приложение. Накопленные `chat.mark_read`/`mail.mark_read` молча теряются; непрочитанное «возвращается» для уже прочитанных сообщений.

**Что сделать:** не инкрементить `attempts` на локальном offline-gate и не дренить очередь при `offlineMode`; счётчик попыток — только для реальных сетевых ошибок.

### MB4-09. Транзиентная ошибка чтения манифеста стирает индекс офлайн-копий

**Severity: средний. Confidence: средне-высокая.**
`mobile-hub/src/myFiles/nativeMyFilesOfflineStore.ts:125-146`, `:343-357`; `mobile-hub/src/cache/nativeSnapshotStorage.ts:360-361`.

```ts
126:  try {
127:    const raw = await readEncryptedNativeSnapshot(OFFLINE_MANIFEST_SCOPE, userId);
128:    if (!raw) return emptyManifest(userId);
...
143:  } catch {
144:    await deleteEncryptedNativeSnapshot(OFFLINE_MANIFEST_SCOPE, userId).catch(() => undefined);
145:    return emptyManifest(userId);
146:  }
```

`readEncryptedNativeSnapshot` по контракту возвращает `null` при транзиентной ошибке bridge/key/read. `readManifest` трактует `null` как пустой манифест, после чего `removeNativeMyFileOffline` записывает `{entries: []}`, а `writeManifest` при пустом списке удаляет зашифрованный манифест. `pinNativeMyFileOffline` может перезаписать манифест одной новой записью.

**Сценарий:** редкий сбой хранилища при удалении/привязке файла. Все ранее привязанные офлайн-файлы исчезают из «На устройстве», хотя байты остаются на диске; ошибка не показывается.

**Что сделать:** отличать «манифеста нет» от «ошибка чтения»; при ошибке прерывать операцию, не перезаписывая манифест.

### MB4-10. Ошибка проверки обновления маскируется зелёным «Готово.»

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/account/NativeAppSettingsScreen.tsx:209-217`; `mobile-hub/src/updates/useMobileUpdater.ts:182-193`; `mobile-hub/src/screens/menu/NativeMenuScreen.tsx:197-215`.

```tsx
210:      const result = await execute(command, payload, executionOptions) as CommandState;
211:      if (!current()) return null;
212:      applyState(group, result);
213:      setStatus({ error: '', message: 'Готово.' });
```

`checkForUpdate` ловит сетевую ошибку и возвращает состояние (`status: 'error'` или старый `available`), не пробрасывая исключение. `run` считает команду успешной и пишет «Готово.». В меню при `status === 'error'` action = «Повторить», но `onPress` вызывает `updater.installUpdate()`, а не повторную проверку; при старом feed установится устаревший APK.

**Сценарий:** нет сети, пользователь нажимает «Проверить обновление». Экран показывает «Готово.» и кнопку «Обновить до …»; меню предлагает «Повторить», но скачивает старый feed.

**Что сделать:** возвращать/пробрасывать ошибку проверки, не писать «Готово.» при `status === 'error'`; для «Повторить» вызывать `checkForUpdate`, а не `installUpdate`.

### MB4-11. Проверка квоты блокирует возобновление уже зарезервированной загрузки

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/myFiles/NativeMyFilesScreen.tsx:422-425`; `mobile-hub/src/myFiles/nativeMyFilesTransfers.ts:349-364`; backend `WEB-itinvent/backend/services/my_files_service.py:694-702`.

```tsx
422:      const selectedBytes = files.reduce((sum, file) => sum + file.size, 0);
423:      if (quota && selectedBytes > quota.remaining_bytes) {
424:        throw new Error(`Недостаточно места: выбрано ..., свободно ...`);
425:      }
```

Квота учитывает статус `uploading` (`STATUS_UPLOADING` в `_quota_used_locked`), поэтому после обрыва загрузки полный размер файла уже входит в `used_bytes`. При повторной попытке `remaining_bytes` меньше полного размера, проверка срабатывает до `uploadNativeMyFile`, и существующая сессия не возобновляется.

**Сценарий:** большой файл укладывается в квоту, загрузка обрывается на 500/timeout, сервер оставляет резервацию на 2 часа. Пользователь не может завершить загрузку, пока не удалит другие файлы или не истечёт TTL.

**Что сделать:** проверять квоту с учётом уже зарезервированного размера (или пропускать проверку, если найдена resume-сессия на тот же файл).

### MB4-12. Переход в offline отменяет серверную сессию загрузки

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/myFiles/NativeMyFilesScreen.tsx:205-208`; `mobile-hub/src/myFiles/nativeMyFilesTransfers.ts:440-448`.

```tsx
205:  useLayoutEffect(() => {
206:    uploadGeneration.current += 1;
207:    uploadAbortRef.current?.abort();
208:  }, [userId, canWrite, offlineMode]);
```

```ts
440:  } catch (error) {
441:    const aborted = Boolean(signal?.aborted) ...
444:    if (fileId && (aborted || !isRetriableUploadError(error))) {
446:      await clearUploadResume(resumeKey);
448:        await cancelMyFileUploadSession(fileId, describeUploadFailure(error, aborted));
```

При потере сети `offlineMode` становится `true`, эффект абортит загрузку. Abort классифицируется как окончательный провал: resume-запись очищается, серверная сессия отменяется.

**Сценарий:** идёт загрузка большого файла, сеть пропадает. Прогресс уничтожается, после восстановления связи файл нужно загружать с нуля; пользователь не получает объяснения.

**Что сделать:** при переходе в offline не абортить загрузку (дать ей упасть по сетевой ошибке) либо классифицировать offline-abort как retriable и сохранять resume.

### MB4-13. Restore/purge/empty trash не обновляют офлайн-снимок

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/myFiles/NativeMyFilesScreen.tsx:725-733`, `:742-748`, `:784-806`; запись снимка — `:292-304`; TTL — `mobile-hub/src/cache/nativeSnapshotCache.ts:107-110`.

`restoreFile`, `confirmPurgeFile`, `confirmEmptyTrash` обновляют только `items`/`folders`; `loadData` не вызывается, поэтому `my-files-lists` snapshot остаётся старым. Снимки не истекают (`DEFAULT_MAX_AGE_MS = Number.MAX_SAFE_INTEGER`).

**Сценарий:** восстановить файл из корзины или удалить навсегда, затем перезапустить приложение без сети. Экран читает старый снимок и снова показывает восстановленный/удалённый файл; действия дают 404.

**Что сделать:** после restore/purge/empty trash обновлять снимок (или вызывать `loadData({ silent: true })`).

### MB4-14. Вход по отпечатку не сбрасывает старый 2FA-challenge

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/auth/AuthContext.tsx:734-779`; `mobile-hub/src/auth/nativeAuthGuard.ts:27-31`; `mobile-hub/app/(auth)/two-factor.tsx:97`.

```ts
734:  const unlockWithBiometrics = useCallback(async (): Promise<BiometricUnlockResult> => {
...
757:        setUser(currentUser);
...
771:        setUser(credential.user);
```

`unlockWithBiometrics` не вызывает `setLoginChallengeId(null)`. `resolveNativeAuthRedirect` проверяет `loginChallengeId` раньше `user`, поэтому старый challenge уводит на `/(auth)/two-factor` даже после успешного входа.

**Сценарий:** пароль → требуется 2FA → на экране 2FA «Войти заново» (challenge не сбрасывается) → на login «Войти по отпечатку» → успешный unlock → shell редиректит обратно на 2FA.

**Что сделать:** сбрасывать `loginChallengeId`/`twoFactorSetupChallengeId` при успешном biometric-unlock и при «Войти заново».

### MB4-15. «Ответить» затирает введённый текст, отмена ответа удаляет вложения

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/feed/NativeFeedPostScreen.tsx:626-636`.

```tsx
626:  const startReply = useCallback((comment: FeedComment) => {
627:    setReplyingTo(comment);
628:    const username = String(comment.username || comment.author_username || '').trim();
629:    setCommentText(username ? `@${username}, ` : '');
630:  }, []);
631:
632:  const cancelReply = useCallback(() => {
633:    setReplyingTo(null);
634:    setCommentText('');
635:    setCommentFiles([]);
636:  }, []);
```

**Сценарий:** пользователь печатает комментарий, затем нажимает «Ответить» — текст безусловно заменяется на `@username, `. При отмене ответа очищаются и текст, и прикреплённые файлы. В чате `startReply` текст не трогает.

**Что сделать:** сохранять черновик перед подстановкой mention и восстанавливать его при отмене; не очищать файлы, если они были до ответа.

### MB4-16. Ошибка смены фильтра оставляет старый список и ломает offset

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/feed/NativeFeedInboxScreen.tsx:144-161`, `:238-261`.

```ts
144:  const loadPage = useCallback(async ({ reset = false } = {}) => {
145:    const requestId = ++requestRef.current;
146:    const offset = reset ? 0 : serverOffsetRef.current;
...
257:    } catch (cause) {
258:      if (requestId !== requestRef.current) return;
259:      setError(formatApiError(cause, cached ? ... : 'Не удалось загрузить ленту.'));
```

При reset (`filter`/`category`/`tag`/поиск) `items`, `total` и `serverOffsetRef` обновляются только в success-ветке. В offline-ветке список очищается, при обычной сетевой ошибке — нет.

**Сценарий:** на фильтре «Все» загружено 40 из 200 (`serverOffsetRef = 40`). Пользователь выбирает «Важное», запрос падает. Чип показывает «Важное», в списке остаются старые публикации. При скролле `onEndReached` грузит `priority=high&offset=40` и подмешивает их к чужому списку; первые 40 «важных» не показываются до успешного refresh.

**Что сделать:** при reset очищать список/offset до запроса или в `catch`; не давать `onEndReached` грузить страницу при ошибке смены фильтра.

### MB4-17. Silent-обновление Docflow откатывает подтверждённое действие

**Severity: средний. Confidence: средне-высокая.**
`mobile-hub/src/screens/docflow/NativeDocflowDetailScreen.tsx:141-153`, `:216-218`, `:261-274`.

```ts
141:    const snapshot = userId
142:      ? await readNativeEntitySnapshot<DocflowTaskDetail>('docflow-task-details', userId, taskRef, Number.MAX_SAFE_INTEGER)
...
150:    if (snapshot) {
151:      setTask(snapshot.data);
...
261:  const finalizeAppliedCommand = useCallback((result: DocflowCommand) => {
262:    setTask((current) => current ? mergeAppliedDocflowTask(current, result) : current);
...
269:    void getDocflowTask(taskRef, true).then((fresh) => {
270:      setTask(mergeAppliedDocflowTask(fresh, result));
```

`finalizeAppliedCommand` не пишет snapshot. Realtime-событие `hub.docflow.changed`, порождённое самим действием, вызывает `loadTask(false, true)`, который сначала подставляет старый snapshot (состояние «до действия»), и только потом запрашивает 1С. Если запрос не проходит, карточка остаётся в состоянии до действия, `actionAttemptRef` уже сброшен.

**Сценарий:** нажать «Согласовать» → «1С подтвердила выполнение» → через ~0,2 с карточка мигает обратно в «Новое» с кнопками; повторное нажатие уйдёт с новым idempotency-key.

**Что сделать:** писать snapshot после `finalizeAppliedCommand` и не применять snapshot поверх оптимистично применённого результата (например, пропускать snapshot при наличии pending applied state).

### MB4-18. Очистка чипа номенклатуры не обновляет движения, refresh зависает

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/warehouse1c/NativeWarehouse1CScreen.tsx:195-207`, `:466-477`; `mobile-hub/src/components/warehouse1c/NativeWarehouse1CMovementsPanel.tsx:181`, `:210-211`.

```tsx
195:  const loadMovements = useCallback((cursor = '') => {
196:    if (!movNomenclature?.ref) return;
...
466:          onClearNomenclature={() => setMovNomenclature(null)}
...
477:          onRefresh={() => { setMovRefreshing(true); loadMovements(); }}
```

Очистка чипа не перезагружает список, поэтому `items` остаются от старой позиции (панель рендерит `data={items}` без проверки `nomenclature`). Pull-to-refresh выставляет `movRefreshing = true` и вызывает `loadMovements()`, который сразу выходит на строке 196; `movRefreshing` никто не сбрасывает.

**Сценарий:** выбрать номенклатуру, нажать «Показать», очистить чип — видны старые движения. Потянуть вниз — спиннер висит бесконечно.

**Что сделать:** при очистке номенклатуры очищать `movItems`/`movMeta`/`movSearched` и сбрасывать `movRefreshing`; в `loadMovements` сбрасывать флаг перед ранним выходом.

### MB4-19. Кэши файлов БЗ и 1С не очищаются при выходе и по команде очистки

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/auth/logout.ts:114-124`; `mobile-hub/src/help/nativeKbFiles.ts:23-26`; `mobile-hub/src/warehouse1c/nativeWarehouse1cFiles.ts:24-27`; `mobile-hub/src/native/nativeCommandRuntime.ts:244-253`.

```ts
114:  try {
115:    clearAttachmentCache();
116:    clearNativeMailCache();
117:    clearNativeTaskFileCache();
118:    clearNativeMyFilesCache();
119:    clearNativeDocflowCache();
120:    clearNativeFeedFileCache();
121:    clearNativeDatabaseFileCache();
122:  } catch {
```

`clearNativeKbCache` и `clearNativeWarehouse1cCache` экспортированы, но нигде не вызываются (grep по `src` — только определения). Файлы лежат в `Paths.document` (`hubit-kb`, `hubit-warehouse-1c`) в открытом виде.

**Сценарий:** скачать вложения статьи БЗ и документы 1С, выйти из аккаунта. Файлы остаются в постоянном хранилище; кнопка «Очистить кэш файлов» их тоже не удаляет.

**Что сделать:** добавить оба вызова в `endMobileSession` и `offline.clearFileCache`; учесть их в размере кэша.

### MB4-20. Выключение «Активен» сохраняется без подтверждения

**Severity: средний. Confidence: высокая.**
`mobile-hub/src/screens/account/NativeAdminUsersScreen.tsx:470-480`, `:250-264`, `:580-585`; backend `WEB-itinvent/backend/api/v1/auth.py:2371-2374`.

```tsx
470:          <View style={styles.switchRow}>
471:            <Text style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>Активен</Text>
472:            <Switch value={draft.is_active} onValueChange={(value) => setDraft({ ...draft, is_active: value })} />
473:          </View>
```

`is_active` всегда уходит в payload. Backend при `is_active=false` закрывает все сессии пользователя и отзывает biometric-credentials. В списке пользователей операция «Отключить» требует подтверждения, в форме редактирования — нет.

**Сценарий:** администратор случайно выключает «Активен» и нажимает «Сохранить» — пользователя разлогинивает на всех устройствах и отзывает биометрию.

**Что сделать:** подтверждать смену `is_active` на `false` (Alert с последствиями) либо вынести в отдельное действие.

### MB4-21. Markdown-рендер удаляет `_` и `~` из обычного текста

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/feed/FeedMarkdownText.tsx:97`; `mobile-hub/src/feed/feedFormat.ts:273`, `:287`.

```tsx
97:        return <Fragment key={index}>{part.replace(/[*_~]/g, '')}</Fragment>;
```

Любой фрагмент, не распознанный как `code`/`bold`/`link`, очищается от `*`, `_`, `~`. То же в `stripFeedMarkdown` для превью.

**Сценарий:** текст «Сервер app_server_01, файл report_final.pdf, путь ~/.ssh» отображается как «Сервер appserver01, файл reportfinal.pdf, путь /.ssh».

**Что сделать:** удалять только парные маркеры разметки, а одиночные `_`/`~` внутри слова сохранять; как минимум не трогать `_` между буквами/цифрами.

### MB4-22. Ошибка чтения локального черновика навсегда блокирует публикацию/создание

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/drafts/useNativeFormDraft.ts:21-35`; `mobile-hub/src/screens/feed/NativeFeedEditorScreen.tsx:674`; `mobile-hub/src/screens/docflow/NativeDocflowAssignmentScreen.tsx:321`.

```ts
27:    void current.read().then((saved) => {
...
34:      setRestored(true);
35:    }).catch(() => { if (active) setStatus('Не удалось открыть черновик. Не закрывайте форму.'); });
```

В `catch` нет `setRestored(true)`, поэтому `restored` навсегда `false`. Сохранение в редакторе ленты и в форме поручения начинается с `if (... || !draft.restored) return;`.

**Сценарий:** SecureStore вернул ошибку чтения (повреждённая запись/сбой keystore). «Опубликовать»/«Создать в 1С» не реагируют; статус ошибки отрисован ниже карточек. Повторить чтение нельзя, кроме выхода и повторного входа в форму.

**Что сделать:** в `catch` выставлять `restored` в true с пустым состоянием (как в `useThreadComposerState`) либо давать кнопку «Повторить чтение».

### MB4-23. Модератору показываются owner-only действия над участниками

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/screens/chat/useThreadSheets.ts:269-287`; backend `WEB-itinvent/backend/chat/chat_group_service.py:525-554`, `:478-479`.

```ts
276:    if (member.member_role === 'moderator') {
277:      buttons.push({ text: 'Сделать участником', onPress: () => void updateMember(member, 'demote') });
278:    } else {
279:      buttons.push({ text: 'Сделать администратором', onPress: () => void updateMember(member, 'promote') });
280:    }
281:    if (viewerRole === 'owner') {
282:      buttons.push({ text: 'Передать права владельца', ... });
283:    }
284:    buttons.push({ text: 'Удалить из группы', style: 'destructive', ... });
```

Роль проверяется только для передачи владения. Смена роли на сервере требует owner (`_require_group_owner`), удаление модератора другим модератором запрещено.

**Сценарий:** модератор открывает действия над другим модератором, выбирает «Сделать участником»/«Удалить из группы» — 403 и тост об ошибке. UI обещает недоступные операции.

**Что сделать:** строить меню по `viewerRole`: promote/demote — только owner; remove — owner для модераторов, moderator для обычных участников; не показывать действия над собой.

### MB4-24. Выход не убирает доставленные уведомления прежнего пользователя

**Severity: низкий. Confidence: высокая.**
`mobile-hub/src/lifecycle/AppLifecycle.tsx:195-201`; `mobile-hub/src/auth/logout.ts:88-137`.

```tsx
195:  useEffect(() => {
196:    if (!user) {
197:      chatSocket.disconnect({ reconnect: false, clearSubscriptions: true });
198:      hubRealtimeSocket.disconnect();
199:      void clearNativeBadge();
200:      void unregisterMobileBackgroundSync();
201:      return;
202:    }
```

`dismissAllNotificationsAsync()` нигде не вызывается; `clearNativeBadge()` меняет только счётчик. Уведомления A остаются в шторке.

**Сценарий:** A получает push чата/почты, выходит. B берёт телефон, тапает уведомление A → приложение открывается без сессии → pending deep link запоминается → после входа B попадает на чат/задачу A (backend доступ проверит, но текст уведомления и идентификаторы уже видны).

**Что сделать:** при logout вызывать `Notifications.dismissAllNotificationsAsync()` и очищать pending notification response/destination.

## 3. Прочие подтверждённые мелочи

- **Приостановка сокетов в фоне отменяется сменой объекта `user`.** `AppLifecycle.tsx:281-291` зависит от `user`, а `AuthContext.tsx:500` может заменить объект после фоновой пробы `/auth/me`; cleanup отменяет `suspendTimer`, новый эффект таймер не ставит. Сокеты остаются открытыми в фоне. Нужна зависимость от `user?.id`, как в соседнем эффекте.
- **После офлайн-выхода login-экран остаётся в «Проверяем сохранённый вход…».** `logout()` (`AuthContext.tsx:781-800`) не сбрасывает `sessionRestoreState`; кнопка «Повторить проверку входа» disabled при `checking` (`app/(auth)/login.tsx:146-153`).
- **Бейдж непрочитанного откатывается после прочтения письма.** `resolveNativeUnreadCount` (`notificationBadge.ts:14-18`) не применяет pending-дельту, а `reconcileNativeBadge({force:true})` вызывается на realtime-событии (`AppLifecycle.tsx:234-239`); серверный Exchange ещё отдаёт старый счётчик.
- **Офлайн-копия сохраняет старое имя после переименования.** `entryMatchesItem` (`nativeMyFilesOfflineStore.ts:183-189`) проверяет только `fileId`, размер и срок; `pinNativeMyFileOffline` возвращает существующую запись, не обновляя `fileName`/`record`.

## 4. Проверки

- `npm run lint` (`tsc --noEmit`) — exit 0.
- Целевые Jest-наборы по затронутым областям (14 suites): **430 passed, 1 failed**. Падение — устаревшее ожидание `NativeTaskScreens.test.tsx:483` после фикса MB3-04 (тест ждёт полный payload, клиент отправляет только изменённые поля).
- Backend-тесты почты: `51 passed, 1 skipped`.
- Полный `npm run test:ci`: **384 suites passed, 2 failed; 2893 tests passed, 2 failed**.
  - `src/screens/tasks/NativeTaskScreens.test.tsx:483` — устаревшее ожидание полного payload после фикса MB3-04 (не дефект продукта).
  - `scripts/mobile-version.test.js` — отсутствует `android/app/build.gradle` (известное ограничение окружения, не связано с правками).

## 5. Что проверено и отброшено

- **Гонка переключения ящика в папках почты** — `requestRef`/lease отсекает устаревшие ответы.
- **Observer = assignee в форме задачи** — backend `_normalize_observer_user_ids` исключает исполнителей/контролёра/автора.
- **Лимит 50 заданий Docflow** — явно показан в UI, не дефект.
- **Лимит очистки корзины 1000** — зафиксирован тестом как bounded.
- **Серверные фильтры managed-ленты** — backend поддерживает `q/category_id/tag`.
- **Абсолютный сброс unread из центра уведомлений** — вызывается `/mail/messages/mark-all-read` по всем ящикам.
- **Права статистики** — `statistics.read` выдаётся вместе с `database.read`.

## 6. Ограничения

- Устройство/эмулятор/APK не запускались; поведение на реальном Android не подтверждено.
- MB4-03 подтверждён по типу `File.copy(): Promise<void>` и по аналогичному исправленному коду чата; на устройстве не воспроизводился.
- MB4-09 зависит от редкой транзиентной ошибки хранилища; путь кода подтверждён.
- MB4-11 зависит от того, что пользователь повторно выбирает тот же файл с тем же resume-key; проверка квоты при этом срабатывает всегда.
