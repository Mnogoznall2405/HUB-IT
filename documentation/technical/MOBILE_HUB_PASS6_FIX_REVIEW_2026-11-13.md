# PASS6 — реализация исправлений и остатки PASS5

Дата: 2026-11-13. Scope: `mobile-hub` + точечно `WEB-itinvent/backend` (`my_files_service.abort_upload`, `equipment.consume`). Устройство/эмулятор/APK не запускались — выводы по коду и Jest/pytest.
Аудит: [MOBILE_HUB_BUG_AUDIT_2026-11-13_PASS6.md](MOBILE_HUB_BUG_AUDIT_2026-11-13_PASS6.md). Предыдущий цикл: [MOBILE_HUB_PASS5_FIX_REVIEW_2026-11-13.md](MOBILE_HUB_PASS5_FIX_REVIEW_2026-11-13.md).

## 1. Остатки PASS5-verify и регрессия MB6-01

| # | Что сделано |
|---|-------------|
| MB4-02 (purge) | `confirmPurgeFolder` захватывает `listMyFilesTrash()` **до** `purgeMyFileFolder` — после серверного каскада parent-связи удалённых папок уже недоступны; subtree строится по захваченному scope, офлайн-копии вложенных файлов снимаются. |
| MB5-07 | `nativeMailComposeDrafts`: чтение черновиков переведено на `SecureStore.getItemAsync` с изоляцией битых записей — одна повреждённая запись не блокирует остальные редакторы. |
| MB5-09 | `selectMailbox`: при ошибке записи новой сессии черновика выполняется откат (старая запись восстановлена, `draftId` сброшен на прежний) — смена ящика не может оставить полуперенесённый черновик. |
| MB5-15 | `useThreadBack` помечает прочитанным через `markReadRef` и только при `nearBottomRef.current` — выход при прокрутке вверх не читает невидимые сообщения. |
| MB5-19 | Обновление дерева папок почты также идёт при возврате в список и после удаления папки — не только по TTL 15 с. |
| MB6-01 | Регрессия MB5-05 закрыта: `directoriesLoaded` ставится только при полном успехе `allSettled`, failed-части догружаются при повторном открытии — бесконечного цикла запросов нет (guard `directoriesLoadingRef`). |

## 2. PASS6 — высокие

| # | Исправление |
|---|-------------|
| MB6-02 | `AuthContext.login`: при наличии активного user или refresh-токена сначала выполняется `endMobileSession()` (revoke refresh/push/biometric + полная локальная очистка), затем `authApi.login` — повторный вход через «Безопасность» завершает сессию прежнего пользователя. |
| MB6-03 | Два слоя: клиент сериализует загрузки с одинаковым `имя+размер` внутри батча (`sameKeyChain`), а backend `abort_upload` не трогает строки со статусом committed/published — `complete` второго файла не может снести уже опубликованный. |
| MB6-04 | `consumeConsumableStock`/`recordEquipmentWork` получают детерминированный `operation_id` (пара «карточка+остаток») — повтор после потерянного ответа идемпотентен, расходник не списывается дважды. |
| MB6-05 | `endMobileSession` вызывает `clearIncomingShare()` (JS-очередь) и `clearPendingShareAsync()` нативного модуля — входящий share пользователя A не всплывает в композере B. `IncomingShareGate` сбрасывается при смене пользователя. |

## 3. PASS6 — средние

| # | Исправление |
|---|-------------|
| MB6-06 | `unlockWithBiometrics` при transport-failure использует `tokenStore.getCachedSessionUser()` при совпадении user id — офлайн-вход восстанавливает свежие роль/права, а не устаревший `credential.user`. |
| MB6-07 | Навигация из пуша: `task_id` из payload проверяется **до** route — обсуждение задачи открывает карточку; маппер route терпит `task_detail_view`/`message`. |
| MB6-08 | После синхронизации отделов перезагружаются membership и `draftManagerIds` — переведённый сотрудник не назначается руководителем, старый состав не висит. |
| MB6-09 | `DashboardScreen`: `absences`/`news`/attention-данные фильтруются по правам на уровне memo — после отзыва `tasks.read`/`dashboard.read` блок «Требует внимания» и виджеты исчезают. |
| MB6-10 | `listPasswordVaultEntries` принимает `limit`/`offset`; тип `PasswordVaultList` несёт `total`/`truncated`; экран показывает реальный `total` и подгружает страницы — молчаливого лимита 100 нет. |
| MB6-11 | `NativeDatabaseScreen`: при ошибке смены фильтра инвентаря список/`total`/`hasMore` сбрасываются — старые данные и съехавший offset не переиспользуются. |
| MB6-12 | Удаление папки MyFiles: из `allFolders` срезается всё поддерево, сбрасывается текущая папка при необходимости, обновляются квота и список — перемещение в удалённую папку не даёт 404, квота актуальна. |
| MB6-13 | `myFileVersionTag(updated_at)` входит в имя кэш-файла preview/download и в `entryMatchesItem` офлайн-манифеста (`serverUpdatedAt`) — правка на сервере при том же размере не отдаётся из старого кэша. |
| MB6-14 | Экран настройки 2FA (`setup-required`) защищён `expo-screen-capture` (`hubit-backup-codes`…); `manual_entry_key`/`otpauth_uri`/backup-коды очищаются при background/unmount. |
| MB6-15 | Просроченные quick-reply (`normalizeQueue` >24ч) не вырезаются молча: текст спасается в черновик чата, запись возвращается как expired, мёртвое «Повторить» заменяется финальным уведомлением без retry. |
| MB6-16 | `filePolicy.ts`: `utf8BytesLength`/`truncateToUtf8Bytes`/`fitNativeFileName` — `sanitizeNativeFileName` ограничен 180 байтами UTF-8, все `*CacheFile`-хелперы обрезают `userId-имя` под 255-байтовый лимит ФС; `safeFileName` в Kotlin-модуле share — тоже байтовый. |
| MB6-17 | `pendingBiometricRevocation` — durable SecureStore-очередь: при недоступности сети `skipBiometrics`/`disable` ставит запись на серверный `DELETE /auth/mobile-biometric`; replay в `AppLifecycle` при старте, возврате сети и foreground; `enableBiometrics` снимает запись. |
| MB6-18 | `isTransportFailure` гейтит офлайн-фолбэк биометрии: 403/400/500 и любой JSON-ответ — явная ошибка «повторите/войдите», а не «офлайн-вход». |
| MB6-19 | Fail-closed app lock: `getAppLockSettings` пробрасывает ошибки SecureStore (больше не сворачивается в `enabled:false`); bootstrap при ошибке чтения взводит `appLockPendingUnlock` (`appLock?.enabled ?? true`); `AppLockGate` держит `settingsError` — гейт не снимает pending, показывает «Повторить»/«Войти заново» и не запускает автоматический unlock. |

## 4. Дополнительно подтверждённые

- Очистка корзины в общей блокировке: `confirmEmptyTrash` берёт `fileActionLockRef` + `emptyingTrash` (спиннер на кнопке) — «Восстановить»/purge не вклиниваются между подсчётом `purgedIds` и `emptyMyFilesTrash`.
- «Сохранить офлайн»: `disabled: offlineMode` в меню действий — пункт не предлагает гарантированно падающий POST grant.
- Лимиты AI-бота: label «Вызовов за раунд (1–5)» и клиентские clamp `1–12`/`1–5` в `save` — как в `ai_chat/tools/context.py`.
- `NativeTaskCreateScreen`: `title`/`description` — `editable={!saving}`; правки после «Создать» больше не теряются молча (уже были заблокированы файлы/чек-лист).
- Бейдж: `lastCompleteSnapshots` — при частичном сбое счётчиков поля упавшего источника берутся из последнего полного снапшота, а не зануляются → бейдж не занижается; при полном успехе снапшот обновляется.

## 5. Проверки

- `tsc --noEmit` — **0 ошибок**.
- Jest свип (auth, notifications, myFiles, files, account, tasks, database, passwords, lifecycle, share, dashboard, navigation, app): **80 suites / 731 tests** — все зелёные после обновления двух фикстур (`nativeMyFilesTransfers`: версия-тег в имени кэша; `AuthContext.biometric`: ожидание `authApi.login` через `waitFor` из-за пре-сессионной очистки).
- Backend `pytest tests/test_my_files_service.py tests/test_my_files_storage_v2.py tests/test_chat_attachment_save_to_my_files.py` — **77 passed**.
- `git diff --check` — чисто (единственное предупреждение — давний trailing space в `POSTGRES_APP_SCHEMA_DDL.md:3`).

## 6. Известные ограничения

- Реальный Android/APK не проверялся; байтовые лимиты ФС (MB6-16) и нативный `clearPendingShareAsync` (MB6-05) подтверждены кодом и Jest-моками, не устройством.
- Для MB6-03 требуется одновременный выкат клиента и backend (`abort_upload`-защита); старый backend + новый клиент безопасны, но серверной защиты нет.
- MB6-10: новые поля `total`/`truncated` — клиентская сторона; старый backend без них деградирует к прежнему лимиту 100 (совместимо, но не исчерпывающе).
- `pendingBiometricRevocation` и `pendingLogoutCleanup` хранятся в SecureStore — при сбросе keystore запись теряется; риск признан малым (устройство без хранилища не восстановит и креденшелы).
