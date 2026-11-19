# Mobile-hub: независимая проверка исправлений прохода 4

Дата: 13.11.2026.
Область: только `mobile-hub` + backend-ревокация push/logout. Проверка read-only: код не изменялся, production не затрагивался.
Метод: сверка текущего кода с `MOBILE_HUB_PASS4_FIX_REVIEW_2026-11-13.md`, целевые Jest-наборы, backend-тесты auth/push. Устройство/эмулятор/APK не запускались.

## 1. Итог

Из 24 дефектов MB4 **20 закрыты полностью**, 3 закрыты частично, 1 закрыт частично по краю. Все 3 остатка MB3 дозакрыты, но MB3-11 — только в части открытия поста. 4 мелких остатка закрыты.

| ID | Статус | Комментарий |
|---|---|---|
| MB4-01 | закрыт | «Вернуться» сбрасывает pending; есть «Сохранить как черновик» |
| MB4-02 | **частично** | purge папки/очистка корзины не снимают копии файлов внутри вложенных папок корзины |
| MB4-03 | закрыт | `await copy()` во всех трёх местах |
| MB4-04 | закрыт | `delegatesLoaded` блокирует `updateTaskDelegates` |
| MB4-05 | закрыт | `membersLoaded` блокирует сохранение руководителей |
| MB4-06 | закрыт | `multi` нормализуется в `admin_multi_db` |
| MB4-07 | **частично** | deferred cleanup выполняется только при `!user`; если первым войдёт другой пользователь, сессия A не отзывается |
| MB4-08 | закрыт | offline-gate не тратит attempts |
| MB4-09 | закрыт | `ManifestReadError` вместо перезаписи манифеста |
| MB4-10 | **частично** | при закэшированном feed ошибка проверки по-прежнему маскируется «Готово.» |
| MB4-11 | закрыт | квота учитывает живые резервации |
| MB4-12 | закрыт | offline больше не абортит загрузку |
| MB4-13 | закрыт | restore/purge/empty trash обновляют снимок |
| MB4-14 | закрыт | `resetLoginChallenge` в biometric-unlock и «Войти заново» |
| MB4-15 | закрыт | черновик ответа сохраняется/восстанавливается |
| MB4-16 | закрыт | reset очищает список/offset при ошибке |
| MB4-17 | закрыт | окно `lastAppliedCommandAtRef` + запись snapshot |
| MB4-18 | закрыт | очистка чипа сбрасывает движения/флаги |
| MB4-19 | закрыт | кэши БЗ/1С подключены к logout и `offline.clearFileCache` |
| MB4-20 | закрыт | подтверждение отключения пользователя |
| MB4-21 | закрыт | одиночные `_`/`~` сохраняются |
| MB4-22 | закрыт | ошибка чтения черновика не блокирует форму |
| MB4-23 | закрыт | меню участника строится по роли |
| MB4-24 | закрыт | `dismissAllNotificationsAsync` при logout |
| MB3-03 | закрыт | recovery применяет diff и не обнуляет pending при частичном создании |
| MB3-11 | **частично** | пост открывается, якорь комментария теряется (`commentId` уходит в hash) |
| MB3-16 | закрыт | summary/folderTree фильтруются по mailbox |
| мелкие | закрыты | suspend по `user?.id`, `sessionRestoreState`, badge pending-delta, обновление имени офлайн-копии |

## 2. Остатки

### MB4-02. Вложенные папки корзины

`mobile-hub/src/screens/myFiles/NativeMyFilesScreen.tsx:755-776`, `:810-829`, `:831-858`.

`removeOfflineCopiesInFolder` строит поддерево по `allFolders`/`folders`. Но `listMyFileFolders` возвращает только активные папки (`deleted_at is null`), а `listMyFilesTrash` — только верхнеуровневые удалённые папки и файлы вне удалённых папок (`visible_files`/`visible_folders`). Поэтому:

- при purge удалённой папки её вложенные папки отсутствуют в `allFolders`/`folders`, и офлайн-копии файлов внутри них не удаляются;
- при очистке корзины `purgedIds` не содержит файлы, лежащие внутри удалённых папок.

**Сценарий:** сохранить файл из `A/B` офлайн, удалить `A` в корзину, очистить корзину. Сервер удаляет `A/B/file`, но копия остаётся в «На устройстве».

**Что сделать:** перед purge/empty trash получать полный список файлов корзины с их folder_id (или рекурсивно по удалённым папкам) и удалять офлайн-записи по fileId/поддереву.

### MB4-07. Ожидающий logout не выполняется после входа другого пользователя

`mobile-hub/src/lifecycle/AppLifecycle.tsx:195-207`; `mobile-hub/src/auth/pendingLogoutCleanup.ts:80-107`.

`runPendingLogoutCleanup()` вызывается только в ветке `if (!user)`. Если A вышел офлайн, а затем на устройстве успешно вошёл B, эффект с `!user` больше не срабатывает; запись с refresh token A остаётся, сессия A на сервере не закрывается. Push-токен A при этом деактивируется регистрацией токена B на том же `device_id`, но refresh-сессия A живёт до истечения.

**Что сделать:** запускать `runPendingLogoutCleanup()` также после успешного логина (до/после `setUser`) или при старте приложения независимо от наличия пользователя.

### MB4-10. Ошибка проверки при закэшированном feed

`mobile-hub/src/updates/useMobileUpdater.ts:182-193`; `mobile-hub/src/screens/account/NativeAppSettingsScreen.tsx:213-219`; `mobile-hub/src/screens/menu/NativeMenuScreen.tsx:212-217`.

В `catch` проверки обновления статус сохраняется, если `current.feed` есть и статус `available/paused/ready`:

```ts
status: current.feed && ['available', 'paused', 'ready'].includes(current.status)
  ? current.status
  : 'error',
```

Поэтому при старом feed и сетевой ошибке статус остаётся `available`; настройки видят не `error` и пишут «Готово.», а меню предлагает «Обновить» и ставит устаревший APK. Исправление покрыло только случай без feed (`status: 'error'`).

**Что сделать:** при ошибке проверки выставлять отдельный `check_failed`/`error` (не теряя `paused/ready` для скачивания) либо возвращать ошибку из `checkForUpdate`, чтобы экран настроек её показал.

### MB3-11. Якорь комментария

`mobile-hub/src/navigation/moduleRegistry.ts:272-276`; `mobile-hub/app/(shell)/feed/index.tsx:5-18`.

`routePathFromHref` по-прежнему формирует `/feed?post=<id>#feed-comment-<commentId>`. `feed/index` читает только `post` и `commentId` из query, hash в параметры Expo Router не попадает. Пост теперь открывается, но к комментарию не скроллит.

**Что сделать:** передавать комментарий как `?commentId=<id>` (или парсить hash в `feed/index`).

## 3. Проверки

- `npm run lint` (`tsc --noEmit`) — exit 0.
- Целевые Jest-наборы (25 suites, 255 tests) — **255 passed**.
- Backend auth/push: `126 passed` (`test_auth_mobile_biometric_api`, `test_auth_mobile_delivery`, `test_auth_user_deactivation`, `test_native_push_service`, `test_auth_refresh_recovery`, `test_auth_security_flow`, `test_backend_auth_hardening`).
- Полный `npm run test:ci`: **385 suites passed, 2 failed; 2900 tests passed, 3 failed**.
  - `src/auth/twoFactorScreen.test.tsx` — 2 падения `TypeError: resetLoginChallenge is not a function`: мок `useAuth` не обновлён под новый метод. Продуктовый код под `AuthProvider` корректен; тест нужно обновить.
  - `scripts/mobile-version.test.js` — отсутствует `android/app/build.gradle` (известное ограничение окружения).

## 4. Ограничения

- Устройство/эмулятор/APK не запускались.
- MB4-02 residual зависит от того, лежат ли файлы во вложенных папках корзины; путь кода подтверждён.
- MB4-07 residual зависит от сценария «A офлайн-выход → B вход до появления сети».
- MB4-10 residual воспроизводится только при уже закэшированном feed.
