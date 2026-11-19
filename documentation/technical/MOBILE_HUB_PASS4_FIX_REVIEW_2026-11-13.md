# Mobile-hub: реализация исправлений прохода 4

Дата: 13.11.2026.
Область: `mobile-hub` + одна backend-правка (`/auth/logout`, `native_push_service`).
Независимая проверка: [MOBILE_HUB_PASS4_FIX_VERIFY_2026-11-13.md](MOBILE_HUB_PASS4_FIX_VERIFY_2026-11-13.md) — 20 из 24 закрыты полностью, MB4-02/MB4-07/MB4-10 частично, MB3-11 только в части открытия поста.
Метод: отчёт `MOBILE_HUB_BUG_AUDIT_2026-11-13_PASS4.md` + остатки `MOBILE_HUB_PASS3_FIX_REVIEW_2026-11-13.md`; целевые Jest-наборы, `tsc --noEmit`, backend-тесты. Устройство/эмулятор/APK не запускались, deployment не выполнялся.

## 1. Итог

Закрыты **все 24 дефекта MB4**, все **3 остатка MB3** и **4 подтверждённые мелочи** из раздела 3 аудита.

## 2. Остатки MB3 (дозакрыты)

| ID | Исправление |
|---|---|
| MB3-03 | `NativeTaskCreateScreen`: recovery хранит snapshot `payload`; повтор применяет `updateTask`-diff к созданным задачам, `needsCreate` дожимает недосозданных исполнителей, recovery не обнуляется при частичном создании |
| MB3-11 | `app/(shell)/feed/index.tsx` читает `?post=` и `commentId` и редиректит на `/(shell)/feed/[postId]` |
| MB3-16 | `useMailList`: `applyUnreadDeltaLocal`/`applyUnreadAbsoluteLocal` фильтруют `summary`/`folderTree`/ящики по `mailboxId` события |

## 3. Дефекты MB4

### Высокие

| ID | Исправление |
|---|---|
| MB4-01 | `NativeMailComposeScreen`: `sendPending` сбрасывается в «Вернуться»/«Отправить заново»; при блокировке видно предупреждение и кнопки «Проверить отправленные»/«Сохранить как черновик» — молчаливой блокировки нет |
| MB4-02 | `NativeMyFilesScreen`: purge папки и очистка корзины снимают офлайн-копии; `confirmEmptyTrash` берёт полный список корзины (`listMyFilesTrash`), а не видимую страницу |
| MB4-03 | `await file.copy()` в `nativeFormDrafts` (`durableState` стал async), `nativeMailComposeDrafts.copyFiles` (стал async), `pendingPhotoStore.persistPendingPhoto` |
| MB4-04 | `NativeAdminUsersScreen`: `delegatesLoaded` — при ошибке загрузки делегатов `updateTaskDelegates` не вызывается и сохранение не затирает список пустым массивом |
| MB4-05 | `NativeAdminDepartmentsScreen`: `membersLoaded` блокирует сохранение руководителей до успешной загрузки состава |
| MB4-06 | `NativeAdminAdditionalScreens`: legacy `multi` нормализуется в `admin_multi_db` при открытии, в payload и в селекторе |
| MB4-07 | Двусторонне: backend `/auth/logout` по `X-Client-Device-Id` ревокает refresh+биометрию+`native_push_tokens` устройства (`native_push_service.revoke_device_tokens`); мобильная сторона при сбое серверных вызовов пишет `pendingLogoutCleanup` (SecureStore: refreshToken+deviceId+pushToken) и повторяет `POST /auth/logout` при запуске/выходе в foreground |
| MB4-08 | `offlineCommandQueue`: офлайн-gate (`HUBIT_OFFLINE_READ_ONLY`) и ошибки без `error.response` не увеличивают `attempts` и не дренят запись — команды переживают офлайн-периоды |

### Средние

| ID | Исправление |
|---|---|
| MB4-09 | `nativeSnapshotStorage.hasEncryptedNativeSnapshot` различает «нет снимка» и «ошибка чтения»; `nativeMyFilesOfflineStore` пробрасывает `ManifestReadError` вместо перезаписи манифеста пустым |
| MB4-10 | `NativeAppSettingsScreen`: error-state `update.check` не показывает «Готово.»; `NativeMenuScreen`: «Повторить» при `error` вызывает `checkForUpdate`, а не `installUpdate` |
| MB4-11 | Квота при выборе файлов вычитает байты живых резерваций (`hasPendingMyFileUploadReservation`) — возобновление той же загрузки не упирается в квоту |
| MB4-12 | Переход в offline не прерывает серверную сессию: `uploadGeneration` больше не зависит от `offlineMode` (запрос падает retriable, resume-состояние живо); поздний ответ пикера в офлайне по-прежнему отбрасывается через `offlineModeRef` |
| MB4-13 | restore/purge/empty-trash обновляют офлайн-снимок и снимают локальные копии |
| MB4-14 | `resetLoginChallenge` в контексте: «Войти заново» и `unlockWithBiometrics` сбрасывают `loginChallengeId`/`twoFactorSetupChallengeId` |
| MB4-15 | `NativeFeedPostScreen`: «Ответить» сохраняет набранный текст и вложения через ref; отмена ответа вложения не чистит |
| MB4-16 | Смена фильтра ленты очищает список/offset при reset — ошибка загрузки не смешивает старые и новые результаты |
| MB4-17 | `NativeDocflowDetailScreen`: `lastAppliedCommandAtRef` — silent-refresh пропускает снапшот в окне после подтверждения; оптимистичный результат пишется в entity-snapshot и мерджится при обогащении |
| MB4-18 | `NativeWarehouse1CScreen`: очистка чипа номенклатуры сбрасывает движения/мета/поиск и флаги загрузки — refresh не крутится |
| MB4-19 | `clearNativeKbCache` (со статистикой размера) и `clearNativeWarehouse1cCache` подключены к `offline.clearFileCache` и к logout |
| MB4-20 | `NativeAdminUsersScreen`: выключение «Активен» спрашивает подтверждение (`Alert` «Отключить»/«Отмена») |

### Низкие

| ID | Исправление |
|---|---|
| MB4-21 | `feedFormat.stripInlineFeedMarkdown` — общий хелпер: снимаются только парные маркеры; одиночные `_`/`~` внутри слов (hostname, имена файлов) сохраняются; `FeedMarkdownText` использует его вместо `[*_~]`-удаления |
| MB4-22 | `useNativeFormDraft`: ошибка чтения → `restored=true` + статус-предупреждение «черновик будет перезаписан»; форма остаётся публикуемой |
| MB4-23 | `useThreadSheets.openMemberActions`: promote/demote/transfer — только owner; remove модератора — только owner, remove участника — owner/moderator; на себе действий нет; пустое меню заменено карточкой участника |
| MB4-24 | `endMobileSession`: `Notifications.dismissAllNotificationsAsync()` в `Promise.allSettled` (защитный `dismissDeliveredNotifications` — API может отсутствовать); AppLifecycle дополнительно обнуляет `pendingNotificationResponseRef` при `!user` — отложенный тап не откроет чужой чат |

## 4. Мелочи из раздела 3 аудита

- **Suspend-таймер сокетов**: эффект AppState в `AppLifecycle` зависит от `user?.id` (не от объекта) и читает `userRef.current` — замена объекта `user` после `/auth/me` не отменяет таймер.
- **«Проверяем сохранённый вход…»**: `logout()` сбрасывает `sessionRestoreState` в `'idle'`.
- **Откат бейджа непрочитанного**: `resolveNativeUnreadCount` применяет `applyPendingNativeMailUnread('', null, …)` — тот же TTL-механизм, что и у бейджа навигации (`useNavUnreadCounts`), отдельное хранилище не понадобилось.
- **Старое имя офлайн-копии**: `pinNativeMyFileOffline` при совпадающем контенте обновляет `fileName`/`mimeType`/`serverUpdatedAt`/`expiresAt`/`record` в манифесте.

## 5. Проверки

- `npx tsc --noEmit` (`mobile-hub`) — **0 ошибок**.
- Jest-наборы по затронутым областям — **зелёные**:
  - sweep 1: mail-compose, myFiles, admin-screens, offlineCommandQueue, pendingLogoutCleanup, lifecycle, transfers, docflow, feed, warehouse1c, useThreadSheets — 23 suites;
  - sweep 2: AuthContext (biometric/offline), menu, mail, notifications, pendingPhotoStore — 36 suites / 265 тестов;
  - sweep 3: NativeTaskScreens, docflow, feed, warehouse1c — 10 suites / 102 теста;
  - notificationBadge, AppLifecycle (auth/suspend), logout, offlineStore, feedFormat, drafts, unreadPending — 9 suites.
- Устаревшее ожидание `NativeTaskScreens.test.tsx` обновлено на diff-пейлоад MB3-04 (точное совпадение — неизменённые поля не уходят).
- В `logout.test.ts` добавлен мок `expo-notifications` и проверка `dismissAllNotificationsAsync`.
- Backend `pytest -q tests` — **21 passed** (покрывающих push/logout тестов в наборе нет — поведение проверено код-ревью).
- `git diff --check` — чисто (только стандартные CRLF-предупреждения).
- Известное окружение: `scripts/mobile-version.test.js` падает из-за отсутствующего `android/app/build.gradle` — не связано с правками.

## 6. Что потребуется для выката

- Backend: рестарт стандартным `restart-backend.ps1` (новый `revoke_device_tokens` в `/auth/logout`); миграций нет — `native_push_tokens` уже существует.
- Mobile: новая сборка APK — все правки клиентские, кроме backend-ревокации.
- Совместимость: старый клиент с новым backend — logout работает как раньше (ревокация по device-id безвредна); новый клиент со старым backend — `/auth/logout` отработает без push-ревокации, отложенная запись дождётся обновления backend.

## 7. Ограничения

- Устройство/эмулятор не запускались; Android-специфика (dismiss уведомлений, SecureStore-ретрай) проверена только модульными тестами.
- `revoke_device_tokens` не покрыт backend-тестом — существующий набор `backend/tests` не содержит push/auth-сьютов.
- Полный `npm run test:ci` не перепрогонялся — прогнаны все сьюты затронутых областей.
