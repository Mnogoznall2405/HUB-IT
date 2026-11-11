# Аудит desktop/ и mobile-hub/ (read-only)

Репозиторий: C:\Project\Image_scan. Ничего не изменялось, сборки и тесты не запускались.
Область: desktop/ (WPF + WebView2, C#) и mobile-hub/src, app, app.config.ts, package.json, android/AndroidManifest.xml.
Исключены node_modules, bin, obj, artifacts, dist.

Формат: `путь:строки` - описание - сценарий/доказательство - severity / confidence.

---

## Bugs

### Desktop

**D-01. Снятие Mark-of-the-Web с документов из портала - High / High**
`desktop/Hub.Desktop/Downloads/DesktopFileLauncher.cs:79` (TryOpen), `:110` (TryPrint), `:258-270` (RemoveMarkOfTheWeb).
Перед открытием или печатью любой скачанный файл лишается `:Zone.Identifier` (DeleteFile). Поддерживаются макро-форматы (`.docm`, `.xlsm`, `.pptm`, `.xltm`, `.dotm`, см. `:22-28`). Комментарий (`:76-78`) говорит, что файлы из "аутентифицированного портала", но портал отдает пользовательские вложения, в том числе полученные из внешней почты. Сценарий: вредоносный `.xlsm`, загруженный в портал и скачанный пользователем, открывается Excel без Protected View и без предупреждения о макросах.

**D-02. Во вторичном окне не обрабатывается SSO-редирект (ADFS) - Medium / Medium-high**
`desktop/Hub.Desktop/Views/SecondaryHubWindow.xaml.cs:297-319` (Core_NavigationStarting).
Главное окно (`MainWindow.xaml.cs:1396-1403`) пропускает `NavigationDisposition.SsoRedirect` (`/adfs/` на sso-хосте). Во вторичном окне такая навигация отменяется (`e.Cancel = true`, строка 307-318). Сценарий: истек сеанс в открытом дополнительном окне, портал уводит на `sso.zsgp.ru/adfs/...`, навигация блокируется, окно зависает на экране загрузки без возможности войти.

**D-03. Таймаут ожидания родительского процесса прерывает обновление и перезапускает приложение при живом родителе - Medium / High**
`desktop/Hub.Desktop.UpdateRunner/UpdateRunnerWorkflow.cs:76-89`, `:18-30`.
`WaitForParentExitAsync` использует `CancellationTokenSource(30 s)`. По истечении срока бросается `OperationCanceledException`. Ловится только `ArgumentException` (`:26`), поэтому исключение уходит в общий `catch` в `ExecuteAsync` (`:86-89`). Установка при этом пропускается (`RunElevatedSetup` не вызывается), а `StartApplication` (`:93`) запускает второй экземпляр, пока старый жив. Обновление молча не ставится.

**D-04. Bridge: `async void` обработчик, неограниченное ожидание и отправка после Dispose - Medium / Medium**
`desktop/Hub.Desktop/Interop/DesktopBridgeHost.cs:333-346` (`async void`), `:481` (`status = await eventArgs.Completion;` без таймаута), `:492-499` (PostWebMessageAsJson после await без проверки `_disposed`).
Если подписчик `EquipmentQrPrintRequested` не завершит `Completion`, обработчик висит навсегда, ответ странице не приходит, а `Dispose()` (`:67-80`) не отменяет ожидание. Если окно закрыто во время печати, вызов `_core.PostWebMessageAsJson` идет на уже освобожденный CoreWebView2. Ошибка перехвачена (`:489-498`), но сценарий показывает, что `_disposed` здесь не проверяется.

**D-05. TLS-ключ портала доверен как подписант обновлений; комментарий ссылается на несуществующий pin - Medium / High**
`desktop/Hub.Desktop.UpdateCore/DesktopUpdateTrust.cs:7-8`, `:19-23` (`TrustedKeyIds` содержит `TlsKeyId`), `:28` (комментарий "the TLS pin source").
`DesktopUpdateService.cs:474-481` прямо говорит, что leaf-pin удален. В коде pin не найден (grep по Pin/SPKI/ServerCertificateCustomValidationCallback в desktop пуст). Доверие TLS-ключу означает, что компрометация серверного TLS-ключа позволяет подписывать манифесты обновлений. Это, вероятно, сознательный компромисс для клиентов 0.1.48 (см. память проекта), но в коде он не отмечен как временный. Комментарий в `:28` вводит в заблуждение.

**D-06. Проверка хеша update-runner пропускается, если файла `.sha256` нет - Medium / High**
`desktop/Hub.Desktop/Updates/DesktopUpdateService.cs:161-167`.
`if (File.Exists(runnerHashPath) && !VerifyRunnerHash(...))`. Если `.sha256` отсутствует, проверка молча отключается (fail-open). Сценарий: злоумышленник с правами записи в каталог установки подменяет `HUB.Desktop.UpdateRunner.exe` и удаляет `.sha256`. Риск ограничен правами на запись в каталог установки, но политика должна быть fail-closed.

**D-07. TOCTOU между проверкой setup и его запуском с повышением прав - Medium / Medium**
`desktop/Hub.Desktop.UpdateRunner/Program.cs:37-40` (проверка подписи манифеста и хеша), `UpdateRunnerWorkflow.cs:34-41` (`Process.Start` с `Verb = "runas"`).
Setup лежит в `%LocalAppData%\HUB-IT\Desktop\Updates\Packages\...`, то есть в каталоге, доступном для записи текущему пользователю. Между `VerifyFileAsync` и запуском с UAC файл может быть подменен. Для пользователя, который уже исполняет код, это повышение не дает нового, но сам запуск elevated-процесса из пользовательского каталога нарушает принцип минимальных прав. Рекомендация: копировать setup в защищенный каталог и проверять хеш уже на копии.

**D-08. Токены общих файлов не отзываются, таблица растет без ограничения - Medium / High**
`desktop/Hub.Desktop/Transfers/DesktopSharedFileRegistry.cs:25-27` (словари), `:111-122` (AddFile добавляет токены), `:126-144` (TryGetFilePath).
Токены никогда не удаляются (нет Remove/Clear, MaximumFiles ограничивает только один вызов `Register`, строка 15). Пока процесс жив, любой файл, однажды переданный в `Register`, отдается по токену через `Core_WebResourceRequested` (`DesktopBridgeHost.cs:292-330`) даже после того, как пользователь завершил обмен, а файл удален или заменен. Словари растут при каждом шаринге.

**D-09. Политика разрешений: сохранение Allow в профиль противоречит комментарию; устаревшие Allow подавляют проверку - Medium / Medium**
`desktop/Hub.Desktop/Security/DesktopPermissionPolicy.cs:42-45` (комментарий "Allow/Deny не сохраняются в профиле"), `:111-117` (`profile.SetPermissionStateAsync(..., Allow)`), `:66-68` (сохраненный Deny подавляет PermissionRequested).
`InspectAndRepairAsync` записывает Allow в профиль WebView2. Сохраненная запись для origin, который больше не является доверенным (например, после смены `BaseUrl`), перестает вызывать `PermissionRequested` и продолжает давать доступ к микрофону/камере. Сейчас это работает только потому, что Allow записывается лишь для текущего доверенного origin.

**D-10. Четыре обработчика bridge не проверяют `_bridgeReady`, хотя соседние проверяют - Low / High**
`desktop/Hub.Desktop/Interop/DesktopBridgeHost.cs:608-620` (OpenDownloadedFile), `:624-637` (PrepareDownloadedFile), `:643-655` (ClearNotificationGroup), `:657-672` (ShowNotification).
Соседние обработчики (UpdateShellStatus `:423-436`, UpdateQuickRoutes `:438`, PrintCurrentDocument `:453`, OpenDownloads и др.) отвергают сообщения до рукопожатия. Эти четыре пропускают сообщения до `Ready`. Сообщения принимаются только с доверенного origin, поэтому риск низкий, но поведение непоследовательно.

**D-11. Обработчик WebResourceRequested: утечка FileStream и непойманные исключения - Low / Medium**
`desktop/Hub.Desktop/Interop/DesktopBridgeHost.cs:292-330`.
`new FileStream(...)` (`:310-313`) передается в `CreateWebResourceResponse`. Если тот бросит исключение, поток не освобождается. Блок `catch` (`:320-328`) ловит только IOException, UnauthorizedAccessException и SecurityException. Другие исключения уходят из обработчика события WebView2.

**D-12. Автосохранение паролей и автозаполнение включены для всего портала, включая хранилище паролей - Low / Medium**
`desktop/Hub.Desktop/MainWindow.xaml.cs:1321-1322` (`IsPasswordAutosaveEnabled = true`, `IsGeneralAutofillEnabled = true`).
Профиль WebView2 общий для всех окон. Сохраненные учетные данные и адреса/платежные данные из формы портала попадают в хранилище браузера вне политики приложения. Вкладка `/passwords` защищена только защитой от захвата экрана (`DesktopScreenCaptureProtection.cs`).

**D-13. Публичный `VerifySignature(manifest, publicKeyPem)` не проверяет доверие к key id - Low / High**
`desktop/Hub.Desktop.UpdateCore/DesktopUpdateManifestVerifier.cs:156-176`.
В отличие от `VerifySignature(manifest, certificate)` (`:189-191`), этот перегруз не вызывает `IsTrustedKeyId`. Сейчас в продакшн-коде не используется (только тесты `DesktopUpdateManifestVerifierTests.cs:88, 164, 179`), но это ловушка для будущего использования.

**D-14. `Dispose()` освобождает CancellationTokenSource, пока фоновый цикл может его использовать - Low / Low**
`desktop/Hub.Desktop/Updates/DesktopUpdateCoordinator.cs:162-173` (Dispose: `_shutdown.Cancel(); _shutdown.Dispose();`), `:175-197` (RunLoopAsync ловит только OperationCanceledException, токен берется из `_shutdown.Token` при запуске).
Если цикл находится в `CheckNowAsync` и сервис уже освобожден, исключение от HttpClient уходит в `catch` внутри `CheckNowAsync` (`:86-103`), которое переводит состояние в Error уже после Dispose. `Task` цикла не наблюдается.

### Mobile

**M-01. Манифест обновления APK не подписан; `signer_sha256` разбирается, но нигде не проверяется - High / High**
`mobile-hub/src/updates/mobileUpdate.ts:176-182` (парсинг `signer_sha256`), `:211` (поле `signerSha256` в результате). Поиск по `src` подтверждает, что значение больше не читается. Проверки подписи APK нет (`mobileUpdateInstaller.ts`: только сравнение SHA-256 из того же манифеста, строки 89, 136, 226-345).
Целостность держится только на TLS и на хеше из того же JSON. Компрометация сервера или MITM с доверенным сертификатом позволяет подложить APK с совпадающим хешем. Android отклонит установку поверх существующего приложения с другим ключом, но первая установка и смена ключа не защищены. Desktop при этом проверяет RSA-PSS подпись (см. D-05). Конфликт политик, а управляющее поле мертво.

**M-02. Пара токенов записывается не атомарно; ошибки очистки проглатываются - Medium / High**
`mobile-hub/src/auth/tokenStore.ts:147-151` (access пишется до refresh; если второй `setItem` упадет, в хранилище остается новый access и старый refresh), `:169` (`Promise.allSettled` в `clearTokensInternal` молча игнорирует ошибки удаления токенов).
Сценарий: сбой SecureStore при выходе. Ошибка скрыта, токены остаются, а `notifyAccessTokenChanges(null)` (`:170`) сообщает UI, что сессия закрыта.

**M-03. На web токены хранятся в localStorage - Medium / Medium**
`mobile-hub/src/auth/tokenStore.ts:74-79` (getItem), `:86-88` (setItem без try/catch, в отличие от getItem), `:93-100`.
Ветка `Platform.OS === 'web'` кладет access и refresh токены в localStorage (доступен любому скрипту origin). Зависимость `react-native-web` (package.json:84) указывает, что web-сборка существует. Если она выкладывается, токены уязвимы для XSS. Запись без try/catch может бросить исключение в приватном режиме и сорвать вход.

**M-04. WebView с `originWhitelist={['*']}`, JS и Bearer-токеном без ограничения навигации - Medium / Medium**
`mobile-hub/src/components/chat/ChatVideoPlayer.tsx:281-286` (source с `headers`), `:38` (внутри PLAYER_HTML: `fetch(payload.url, { headers: payload.headers })`), `:284` (`originWhitelist={['*']}`), `:310` (onMessage). `mobile-hub/src/components/chat/ChatImageRecipeExporter.tsx:65-66`, тот же `['*']` и JS.
Нет `onShouldStartLoadWithRequest`, поэтому навигация внутри WebView не ограничена. Адрес ограничен origin через `resolveAttachmentUrl` (`utils/attachmentUrl.ts:9`), что смягчает риск утечки токена на другой хост. Но любая навигация или переход по ссылке в вложенном контенте остается без фильтра, а токен находится в JS-контексте страницы.

**M-05. Очередь отложенных mark-read молча отбрасывает самые старые команды после 25 - Medium / Medium**
`mobile-hub/src/offline/offlineCommandQueue.ts:6` (MAX_QUEUE_SIZE = 25), `:65` (`.sort(...).slice(-MAX_QUEUE_SIZE)`), `:83` (saveQueue вызывает normalizeQueue).
При офлайн-работе с большим числом чатов ранние команды теряются без записи в диагностику и без уведомления. Сценарий: 30 прочитанных сообщений в офлайне, первые 5 не синхронизируются, и на сервере они остаются непрочитанными. Ограничение нигде не документировано.

**M-06. Включение входа по отпечатку молча отключает блокировку приложения - Medium / Medium**
`mobile-hub/src/auth/biometricAuth.ts:157-159` (`APP_LOCK_ENABLED_KEY = '0'`, `notifyAppLockSettings({ enabled: false, ... })`).
Включение биометрического входа сбрасывает app-lock на уровне хранилища и уведомляет UI. Если это не намеренно, пользователь теряет защиту экрана без предупреждения. Требуется подтверждение бизнес-логики.

**M-07. Санитайзер HTML-писем основан на регулярных выражениях - Low / Medium**
`mobile-hub/src/mail/nativeMailHtml.ts:106-130` (stripDangerousMarkup), `:253-260` (remote CSS), `:329` (CSP `script-src 'none'`). `mobile-hub/src/components/mail/NativeMailHtmlBody.tsx:142-143` (originWhitelist с `http://*`, `https://*`).
Скрипты блокирует CSP, что является основной защитой и ее достаточно для XSS. Остальной HTML фильтруется регулярками, которые обходятся (например, нестандартные атрибуты, экранирование в значениях). Риск главным образом UI/трекинг, а не исполнение кода.

**M-08. Идентификатор устройства генерируется через Math.random - Low / High**
`mobile-hub/src/auth/tokenStore.ts:119-123`.
`Math.random().toString(36)` используется как clientDeviceId, который уходит в заголовок `CLIENT_DEVICE_HEADER` (`api/client.ts:263`, `api/authApi.ts:12`, `notifications/nativePush.ts:176`). Идентификатор предсказуем. В проекте есть `expo-crypto`, его нужно использовать для генерации.

**M-09. Заголовки запроса читают device id без создания - Low / High**
`mobile-hub/src/files/authenticatedRequestHeaders.ts:11` использует `getClientDeviceId()` (возвращает null, если id не создан). Остальной код (`api/authApi.ts:12, 25, 73...`) использует `getOrCreateClientDeviceId()` (`tokenStore.ts:125`). Первые запросы до логина могут уйти без заголовка устройства. Поведение должно совпадать с `api/client.ts:263`.

**M-10. `requestLegacyExternalStorage="true"` в манифесте Android - Low / Medium**
`mobile-hub/android/app/src/main/AndroidManifest.xml:28`.
Отключает Scoped Storage на Android 10+ для всего приложения. Нужно только если есть явное обращение к внешним путям; проверить и убрать, если не нужно.

---

## Conflicts

**C-01. Два разных источника истины для проверки обновлений** - Medium / High
Desktop: `desktop/Hub.Desktop.UpdateRunner/Program.cs:29` жестко задает `https://hubit.zsgp.ru/`, тогда как `desktop/Hub.Desktop/appsettings.json:2` (BaseUrl) настраивается. Раннер и приложение могут смотреть на разные хосты при смене окружения. Mobile: `mobile-hub/src/updates/mobileUpdate.ts:3` использует `/desktop-updates/mobile/preview/`, desktop использует `/desktop-updates/stable/` (`DesktopUpdateManifestVerifier.cs:431-434`). Оба канала живут в одном корне без единого контракта подписи (см. M-01 и D-05).

**C-02. Имена экспортов чата-outbox совпадают в двух модулях** - Medium / High
`mobile-hub/src/chat/nativeChatOutbox.ts:79` (`readNativeChatOutbox`), `:144` (`createNativeChatOutbox`), `:444` (`clearNativeChatOutbox`), и те же имена в `mobile-hub/src/chat/nativeChatOutboxLegacy.ts:43`, `:190`, `:356`. `nativeChatOutbox.ts:6` импортирует legacy как `legacy`, а `:12` реэкспортирует типы. Оба модуля работают в рантайме (legacy выполняется через `legacy.*`). Поведение разных версий одного API расходится, и легко вызвать не ту функцию.

**C-03. Маршруты desktop deep link и mobile-навигация расходятся** - Low / Low
`desktop/Hub.Desktop/DeepLinks/DesktopDeepLinkParser.cs:10-35` разрешает `/kb`, `/tickets`, `/vcs`, `/networks`, `/profile`, `/settings`. В `mobile-hub/src/navigation/moduleRegistry.ts` (поиск `'/tickets'`, `'/vcs'`, `'/kb'`, `/networks`) таких путей нет. Ссылки `hubit://open/...` на desktop и mobile будут вести себя по-разному. Проверить, не является ли это сознательным.

---

## Duplication

**U-01. Обработчики WebView дублированы в трех окнах** - Medium / High
`desktop/Hub.Desktop/MainWindow.xaml.cs` (Core_NewWindowRequested `:1492`, Core_ProcessFailed `:1535`, OpenExternalUri `:1561`, Core_DownloadStarting `:1777`, Window_Closed `:3039`), `desktop/Hub.Desktop/Views/SecondaryHubWindow.xaml.cs` (`:388`, `:431`, `:765`, `:532`, `:1131`), `desktop/Hub.Desktop/Views/MailComposeWindow.xaml.cs` (`:353`, `:231`). Тела похожи и уже расходятся (см. D-02). Вынести общий контроллер WebView.

**U-02. Шаблон guard + PostWebMessageAsJson + catch повторен 10 раз** - Low / High
`desktop/Hub.Desktop/Interop/DesktopBridgeHost.cs:87-100, 110-122, 130-142, 149-160, 168-180, 186-198, 204-216, 224-236, 244-260, 269-285`. Одинаковая проверка `_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source)` и одинаковый try/catch. Вынести в один helper; это также исключит расхождения вроде D-10.

**U-03. Открытие URL через оболочку повторено в шести местах** - Low / High
`desktop/Hub.Desktop/Security/ExternalUriLauncher.cs:48`, `desktop/Hub.Desktop/MainWindow.xaml.cs:2574, 2765`, `desktop/Hub.Desktop/Views/SecondaryHubWindow.xaml.cs:807, 1041`, `desktop/Hub.Desktop/Views/DiagnosticsWindow.xaml.cs:93`. Часть обходит `ExternalUriLauncher` и его политику (`MainWindow.xaml.cs:2574` открывает базовый URL напрямую). Нужно единое место через политику.

**U-04. Два WebSocket-клиента с одинаковой логикой переподключения** - Medium / High
`mobile-hub/src/chat/chatSocket.ts` (`ChatSocketClient`: `:27` MAX_BUFFERED_BYTES, `:117-127` backoff, `:99` auth-сообщение) и `mobile-hub/src/realtime/hubRealtimeSocket.ts` (`HubRealtimeSocketClient`: `:20` MAX_BUFFERED_BYTES, `:193-203` backoff, `:163` auth-сообщение). Константы, backoff, jitter, обработка буфера и отправка access_token повторены. Исправления в обработке переподключения и токена придется делать дважды.

**U-05. `asRecord`/`asString` скопированы в восемь API-модулях** - Low / High
`mobile-hub/src/api/databaseApi.ts:277`, `computersApi.ts:91`, `passwordsApi.ts:42`, `warehouse1cApi.ts:32`, `groupsAccessApi.ts:35`, `statisticsApi.ts:150`, `myFilesApi.ts:77`, `scanCenterApi.ts:85`. Тела идентичны (`value && typeof value === 'object' && !Array.isArray(value)`). Вынести в `src/api/normalize.ts`.

**U-06. `formatDateTime` идентичен в трех экранах и есть в двух модулях форматирования** - Low / High
`mobile-hub/src/components/warehouse1c/NativeWarehouse1CCatalogPanel.tsx:27`, `src/screens/groupsAccess/NativeGroupsAccessScreen.tsx:23`, `src/screens/mfu/NativeMfuScreen.tsx:31`. Также `src/account/accountFormat.ts:83` и `src/addressBook/addressBookFormat.ts:122`. Различаются только текст для пустого значения.

**U-07. `isRecord` дублирован в трех модулях** - Low / High
`mobile-hub/src/offline/nativeOfflineCoverage.ts:119`, `src/cache/nativeSnapshotInventory.ts:91`, `src/chat/chatDrafts.ts:44`.

**U-08. Параллельные реализации персистентных очередей и черновиков** - Medium / Medium
`mobile-hub/src/chat/nativeChatOutbox.ts` (outbox с SecureStore и сериализацией через `nativeChatStorageQueue.ts:50`), `src/offline/offlineCommandQueue.ts` (своя очередь с SecureStore, MAX_QUEUE_SIZE), `src/drafts/nativeFormDrafts.ts`, `src/mail/nativeMailComposeDrafts.ts`, `src/mail/mailQuickReplyDrafts.ts`, `src/chat/chatDrafts.ts`. Каждый модуль решает одни и те же задачи (сериализация записи, TTL, квота, очистка при выходе) по-своему. Это источник расхождений в поведении потери данных (см. M-05).

**U-09. Маппинг порталных путей повторен в двух модулях навигации** - Low / High
`mobile-hub/src/navigation/systemIntent.ts:46-70` (`portalPathFromNativeRoute`) и `src/navigation/moduleRegistry.ts:129` (`hrefForPortalPath`) с родственной логикой `/dashboard`, `/menu`, `/chat`, `/tasks`, `/mail`.

**U-10. Два идентичных compat-маршрута** - Low / High
`mobile-hub/app/portal.tsx` (9 строк) и `mobile-hub/app/(shell)/web.tsx` (13 строк) делают один и тот же `Redirect` через `hrefForPortalPath`. Оставить один и переиспользовать в другом.

---

## Dead code

**X-01. `NativeTasksBoardView.tsx` не импортируется ни одним модулем** - Medium / High
`mobile-hub/src/components/tasks/NativeTasksBoardView.tsx` (81 строка, экспорт `NativeTasksBoardView` на `:8`). Поиск по `src`, `app` и `modules` показал только собственный файл. Компонент использует `SectionList` и `buildNativeTaskBoardSections`; удалить или подключить.

**X-02. Неиспользуемые или только транзитивные зависимости в package.json** - Low / High
`mobile-hub/package.json:74` `"qrcode": "1.5.4"` (нет ни одного импорта). `:35` `"decode-uri-component-safe": "npm:decode-uri-component@0.5.0"` (нет импортов). `:32` `"@react-navigation/native"` (нет прямых импортов, приходит через expo-router). `:83` `"react-native-screens"` (нет прямых импортов, нативный модуль подключается транзитивно; проверить перед удалением, т.к. может требоваться autolink).

**X-03. Устаревший outbox-модуль все еще выполняется в рантайме** - Medium / Medium
`mobile-hub/src/chat/nativeChatOutboxLegacy.ts` (366 строк) вызывается из `nativeChatOutbox.ts` как `legacy.*`. Это не мертвый код, но название и дублирующийся API (см. C-02) указывают на незавершенную миграцию. Закрыть план миграции.

**X-04. Остатки Capacitor и mobile-android** - не найдено
Поиск `capacitor|mobile-android` по mobile-hub (кроме node_modules, artifacts, android, dist) и по `mobile-hub/android` не дал совпадений. В desktop/ мертвых классов с нулевыми ссылками не найдено (проверены 17 классов, у каждого >= 1 ссылки).

---

## Optimization

**O-01. SHA-256 APK считается в JS (`@noble/hashes`) на потоке интерфейса - Medium / Medium**
`mobile-hub/src/updates/mobileUpdateInstaller.ts:1` (импорт noble), `:58-80` (`hashUpdateFile`, чанки по `HASH_CHUNK_BYTES`, передача управления каждые 8 чанков через setTimeout). Лимит APK 250 MB (`mobileUpdate.ts:6`). На слабых устройствах хеширование занимает десятки секунд и держит JS-поток. Нативный хеш (например, через модуль файловой системы или expo-crypto с потоковым чтением) быстрее. Требуется замер на целевом устройстве, баз для цифр нет.

**O-02. `removeClippedSubviews={false}` в ленте чата** - Low / Low
`mobile-hub/src/screens/chat/NativeChatThreadScreen.tsx:1160-1166` (`windowSize={7}`, `removeClippedSubviews={false}`). Отключение обрезки на Android удерживает все отрендеренные элементы в памяти в длинных переписках. Нужен замер памяти до изменения.

**O-03. Очень большие экраны без разбиения** - Low / Low
`mobile-hub/src/screens/database/NativeDatabaseScreen.tsx` (2399 строк), `src/screens/tasks/NativeTaskDetailScreen.tsx` (1572), `src/screens/feed/NativeFeedPostScreen.tsx` (1500), `src/screens/chat/NativeChatThreadScreen.tsx` (1441). Любое изменение состояния верхнего уровня перерисовывает широкое дерево. Вынос подкомпонентов с `memo` сузит область перерисовки. Гипотеза, без профилирования.

---

## Итог по проверкам

- Проверено по коду: токены и SecureStore (mobile), WebView-мосты и навигация (desktop и mobile), подпись обновлений (desktop и mobile), очереди (mobile), дубли helper-функций, неиспользуемые модули и зависимости, Android-манифест.
- Не проверено: поведение на устройстве, реальные размеры очередей и памяти, наличие web-сборки mobile (зависит от выкладки), конфигурация IIS и TLS-сертификатов.
- Тесты и сборки не запускались (по правилам задачи).
