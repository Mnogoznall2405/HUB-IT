# PASS5 — реализация исправлений и остатки PASS4

Дата: 2026-11-13. Scope: `mobile-hub` + `WEB-itinvent/backend` (только `my_files_service.list_trash`). Устройство/эмулятор/APK не запускались — выводы по коду и Jest/pytest.
Независимая проверка: [MOBILE_HUB_PASS5_FIX_VERIFY_2026-11-13.md](MOBILE_HUB_PASS5_FIX_VERIFY_2026-11-13.md) — 15 из 20 закрыты полностью; MB5-05 дал регрессию, MB5-07/09/15/19 имеют остатки, MB4-02 не закрыт для purge папки.

## 1. Остатки PASS4

| # | Статус | Что сделано |
|---|--------|-------------|
| MB4-02 | Закрыт | `list_trash` (backend) теперь возвращает `all_file_ids` и `all_folders` (полный scope корзины с parent_id). Клиент нормализует их в `listMyFilesTrash`; `removeOfflineCopiesInFolder` строит поддерево по `allFolders` + видимым папкам и снимает офлайн-копии вложенных файлов; `confirmEmptyTrash` собирает все id из полного scope до `emptyMyFilesTrash`. |
| MB4-07 | Закрыт (ранее) | `runPendingLogoutCleanup` вызывается при `!user`, при переходе offline→online и при возврате приложения в foreground — replay не зависит от того, вошёл ли другой аккаунт. |
| MB4-10 | Закрыт | `useMobileUpdater.checkForUpdate` при ошибке всегда ставит `status: 'error'` (закэшированный feed больше не маскирует ошибку как «Готово.»); сообщение сохраняет контекст найденной ранее версии. «Повторить» в меню идёт через `checkForUpdate()`, а не `installUpdate()` по старому feed. |
| MB3-11 | Закрыт | `routePathFromHref` для `/(shell)/feed/[postId]` передаёт `commentId` query-параметром (`?post=<id>&commentId=<cid>`) вместо `#fragment`, который expo-router отбрасывал; `feed/index` уже читает `commentId` и редиректит на экран поста. |
| twoFactor mocks | Закрыт | `resetLoginChallenge` добавлен в `useAuth`-мок `twoFactorScreen.test.tsx` через spread-обёртку — 2 падения устранены. |

## 2. PASS5 — высокие

| # | Исправление |
|---|-------------|
| MB5-01 | `useMailSelection.runBulk` разбивает bulk-delete по папкам: элементы с `folder === 'trash'` уходят отдельным вызовом с `permanent: true`, остальные — `permanent: false`; результаты сливаются. `confirmDelete` считает состав выбора: вся корзина → «навсегда», смешанная → текст про необратимое удаление trash-элементов, undo исключает необратимо удалённые. В trash-папке весь список — корзина (fallback `item.folder \|\| folder`). Свайп-удаление в «Все папки» для trash-письма требует подтверждения `deleteMessageForever` (guard по `item.folder \|\| folder`). |
| MB5-02 | `replaceCodesByGroup` делает merge (`Set` union с `draft.department_codes`) вместо замены всего набора результатами текущего поиска — привязки других групп и вне поиска сохраняются. |
| MB5-03 | `NativeStatisticsScreen`: эффект при `!canView` обнуляет `payloads`, ошибки, лоадеры, снапшот-метку и закрывает picker/sheets; весь блок данных/контролов обёрнут в `canView` — после отзыва `statistics.read` на экране только «Нет доступа к статистике.» |
| MB5-04 | `is_active` INTEGER 0/1: `taskApi.normalizeActiveFlag` приводит к boolean на границе для списков и ответов create/update проектов/объектов; `draftFrom` в `NativeTaskTaxonomyScreen` читает `Boolean()` — отключённое не «включается» при сохранении. |
| MB5-05 | `NativeTasksInboxScreen` — `Promise.allSettled` для справочников фильтров: применяются успешные части (отделы/контролёры/исполнители), `directoriesLoaded` ставится только при полном успехе → повтор открытия фильтров перезапрашивает. |
| MB5-06 | `NativeTaskDetailScreen`: `lastMutationAtRef` — `loadTask('refresh'|'silent')` не применяет закэшированный snapshot младше минуты после локальной мутации → статус не откатывается «старой копией». |

## 3. PASS5 — средние

| # | Исправление |
|---|-------------|
| MB5-07 | `nativeMailComposeDrafts.readAll` фильтрует битые записи по отдельности и переписывает очищенный список — повреждённая запись не блокирует редакторы; целые черновики сохраняются. Тест обновлён под новую семантику. |
| MB5-08 | `normalizeChatConversation` сохраняет `viewer_restricted`, `viewer_restricted_until`, `members_send_files`, `slow_mode_seconds`, `unread_mention_count`; последнее добавлено в тип `ChatConversationSummary`. |
| MB5-09 | `NativeMailComposeScreen.selectMailbox`: при смене отправителя создаётся сессия черновика под новый `mailboxId`, текущее состояние редактора перезаписывается в неё, старая запись очищается — черновик не теряется при смене ящика. |
| MB5-10 | `NativeComputersScreen`: при падении `reset`-загрузки (смена фильтра) список, `total` и `hasMore` сбрасываются — старые данные и offset не переиспользуются. |
| MB5-11 | `NativeAddressBookScreen.loadItems`: при наличии снапшота ошибка перезагрузки теперь видна («Показаны данные из кэша») и `status.updated_at` откатывается к дате снапшота — старые данные не маскируются свежей датой. |
| MB5-12 | Remote-поиск адресной книги: ошибка → `remoteError` с текстом и кнопкой «повторить» (`remoteRetryTick`), а не молчаливый пустой результат. |
| MB5-13 | `NativeHelpScreen`: чипы строятся из `groupsAll` (без фильтра категории) + чип «Все»; выбор категории не прячет остальные чипы, фильтр сбрасывается. |
| MB5-14 | `ChatThreadOverlays.onSendFiles`: пустая подпись → `body: undefined` → подписью становится текст композера, а не `''` (текст не теряется). |
| MB5-15 | `useThreadBack.leaveThread`: markRead только при `nearBottomRef.current` и через `markReadRef` — выход при прокрутке вверх не помечает невиданные сообщения. |
| MB5-16 | `applyUpdatedTask` мерджит `capabilities` из текущей карточки, если PATCH-ответ их не вернул — карточка не становится read-only. |
| MB5-17 | `chooseActionFile`: `setActionFile` вызывается только при не-null результате — отмена picker'а сохраняет файл отчёта. |
| MB5-18 | `NativeMailConversationScreen`: раскрытое письмо гидратируется `hydrateNativeMailImages` (bounded data-URL для CID) — как на экране одиночного письма. |
| MB5-19 | `MAIL_FOLDER_TREE_TTL_MS = 15s` отдельно от `MAIL_METADATA_TTL_MS = 60s` — дерево папок обновляется раньше. |
| MB5-20 | Одиночные archive/delete/delete-forever применяют `applyUnreadDelta(-1, mailboxId, item.folder)` — счётчики непрочитанного обновляются как при bulk. |

## 4. Дополнительно подтверждённые

- Гонка формы с submit: `NativeTaskCreateScreen` — `addFile`/удаление файлов и пунктов чек-листа заблокированы при `saving`; payload submit уже был снимком замыкания.
- Realtime-refresh инбокса задач: silent-reset покрывает загруженное окно (`limit = max(PAGE_SIZE, items.length)` + догрузка по offset) — страницы не сбрасываются к первой.
- Конфликт кодов нового узла: `editableNodeId = mode === 'edit' ? selectedNode.id : null` — в create-режиме любой занятый код конфликтует с новым узлом, а не сравнивается с родителем (`toggleCode`, `selectableCodesByGroup`, индикатор конфликта).
- Bulk mail unconfirmed result: catch в `runBulk` по `hasUnconfirmedMailResult` перезагружает список и показывает «результат не подтверждён» вместо слепого повтора.

## 5. Проверки

- `tsc --noEmit` — 0 ошибок.
- Jest (целевые сьюты): mail (screens/compose/selection/unread/emptyTrash/folders/files/messageCard), chat (screens/back/send/scroll/history/models/inbox), tasks (screens/create/detail-parallel/taxonomy/performance), statistics, computers, addressBook, companyStructure, myFiles, updater, menu, lifecycle, navigation, drafts, help — **100% passed** (60+ сьютов, ~950 тестов в сумме по прогонам).
- Backend `pytest tests/test_my_files_service.py tests/test_my_files_storage_v2.py tests/test_chat_attachment_save_to_my_files.py` — **77 passed**.
- `git diff --check` — чисто (единственное предупреждение — давний trailing space в `POSTGRES_APP_SCHEMA_DDL.md:3`).

## 6. Известные ограничения

- `scripts/mobile-version.test.js` — известное падение: `android/app/build.gradle` отсутствует в рабочем дереве.
- Backend-тестов именно на новый формат `list_trash` (`all_file_ids`/`all_folders`) нет — поведение проверено ревью + существующими сервис-тестами; поле добавочное, старый контракт (`folders`, `items`) не изменён.
- Старый клиент + новый backend: совместимо (новые поля игнорируются). Новый клиент + старый backend: `allFileIds`/`allFolders` пустые → поведение как до фикса (nested-копии не снимаются) — нужен выкат backend вместе с APK.
- Реальный Android/APK не проверялся.

## 7. Для выката

- Backend: рестарт `restart-backend.ps1` (изменён ответ `GET /my-files/trash`; миграций нет).
- Mobile: новая сборка APK.
