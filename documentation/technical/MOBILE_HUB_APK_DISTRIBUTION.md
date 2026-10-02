# HUB-IT Mobile — публикация APK рядом с HUB Desktop

Дата: 2026-09-05
Канал текущего прототипа: `preview`

## Публичные адреса

- manifest: `https://hubit.zsgp.ru/desktop-updates/mobile/preview/latest.json`;
- APK: `https://hubit.zsgp.ru/desktop-updates/mobile/preview/<version>/HUB-IT-Mobile-Preview-<version>.apk`.

Preview отделён от Desktop stable feed и будущего Android stable feed. Версия 1.1.26 опубликована 2026-09-05 и подписана тем же debug-сертификатом, что предыдущие версии preview, только для совместимого внутреннего upgrade. Обычная команда сборки требует постоянный release keystore; после одноразовой миграции stable-канал должен всегда использовать один и тот же защищённый ключ.

Единый источник версии сборки — `mobile-hub/package.json`: поле `version` задаёт `versionName`, а `hubit.androidVersionCode` — Android `versionCode`. `app.config.ts` читает оба значения оттуда. Локальная сборка до запуска Gradle проверяет совпадение generated `android/app/build.gradle` и `release-notes/<version>.json`; при `-SkipPrebuild` рассинхронизация останавливает сборку с требованием выполнить обычный Expo prebuild.

Source 1.1.26 по умолчанию отключает HTTPS App Links для preview/debug: production `/.well-known/assetlinks.json` ещё не опубликован и debug-сертификат не может быть ему делегирован. Флаг `HUBIT_ANDROID_ENABLE_APP_LINKS=1` допустим только при постоянной release-подписи и совпадающем production fingerprint.

Текущий опубликованный preview: `1.1.26`, `versionCode=28`, 65 077 536 байт, SHA-256 `adf4a72cea490ef4dd1192dcec6538ede94ac147f24a127003e66fe2c00daef7`. Публичный manifest и APK проверены: `200`, JSON/`application/vnd.android.package-archive`, размер и hash совпадают; Range-запрос проверен: `206`, 1024 байта. Подпись остаётся debug-preview тем же сертификатом, что предыдущие версии канала, только для совместимого внутреннего upgrade; предыдущий manifest 1.1.25 сохранён для rollback.

## Что показывает frontend

Компонент `MobileInstallerDownload` читает manifest без credentials, проверяет точный HTTPS origin, package name, version, `version_code`, путь, размер, SHA-256, min SDK и сертификат. Schema v2 также содержит `min_supported_version_code` и краткий `changelog`; мобильный updater сохраняет совместимость чтения schema v1 на время перехода. Кнопка «Скачать для Android» отображается:

- под формой входа рядом с HUB Desktop;
- в `Настройки → Приложение` перед HUB Desktop и PWA.

Ошибка feed не блокирует вход: вместо ссылки показывается локальное состояние «APK временно недоступен».

## Проверка и публикация

### Постоянная подпись

Перед первой stable-сборкой подготовьте три заранее созданных защищённых каталога вне репозитория: рабочий keystore и два backup на разных томах/сетевых ресурсах. Интерактивный скрипт не принимает пароль в аргументах, не выводит его и запрещает перезапись существующих файлов:

```powershell
powershell -ExecutionPolicy Bypass -File mobile-hub\scripts\prepare-release-signing.ps1 `
  -KeystorePath 'D:\HUB-IT-Secrets\hubit-mobile-release.p12' `
  -BackupPathOne 'E:\HUB-IT-Key-Backup\hubit-mobile-release.p12' `
  -BackupPathTwo '\\backup-server\protected\HUB-IT\hubit-mobile-release.p12'
```

Скрипт создаёт RSA-4096/PKCS12, две побайтово идентичные зашифрованные копии и возвращает SHA-256 сертификата без секретов. Повторная проверка выполняется теми же путями с `-VerifyOnly`. Если политика предприятия допускает два каталога на одном зашифрованном томе, это осознанно разрешается `-AllowSameVolumeBackups`; такой вариант хуже защищает от отказа диска.

Fingerprint и alias нужно сохранить в защищённом runbook. Сам keystore, пароль и backup нельзя помещать в Git, артефакты сборки или публичный APK feed. После создания обе password-переменные сборки получают одно и то же защищённое значение PKCS12.

### Preflight миграций mobile backend

Локальная проверка Alembic-графа не подключается к production:

```powershell
python scripts\mobile\mobile_migration_preflight.py --offline
```

Перед отдельно разрешённой production-миграцией передайте `APP_DATABASE_URL` только через защищённое окружение процесса и запустите тот же скрипт без `--offline`. Он выполняет только `SELECT` внутри PostgreSQL `READ ONLY`, проверяет один version table/head, наличие `app.push_outbox` и `app.mobile_biometric_credentials`, длинные транзакции и ожидающие locks. Строка подключения, host, имя БД/пользователя, SQL-тексты и строки таблиц в отчёт не попадают.

Статус `ready` разрешает переход от `20260818_0100`/`20260822_0101`; `already_current` означает, что обе миграции уже применены. `needs_review` запрещает автоматическое продолжение до разбора schema drift, неизвестной revision, длинной транзакции или waiting lock. После migration preflight повторяется и должен вернуть `already_current`; это не заменяет backup и rollback production-БД.

Исполняемый контур сначала проверяется без подключения:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mobile\apply-mobile-migrations.ps1 -OfflinePlan
```

После отдельного разрешения и успешного database preflight фактический запуск требует ожидаемую стартовую revision, новый `.dump` вне репозитория и явный `-Execute`. Скрипт делает `pg_dump` схем `app/system`, проверяет архив через `pg_restore --list`, применяет ровно `20260823_0102` и требует postflight `already_current`. Строка подключения передаётся только через `APP_DATABASE_URL`; автоматический downgrade намеренно отсутствует, потому что после начала работы outbox/biometric он удалил бы данные.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mobile\apply-mobile-migrations.ps1 `
  -ExpectedCurrentRevision '20260818_0100' `
  -BackupPath 'D:\HUB-IT-DB-Backups\before-mobile-0102.dump' `
  -Execute
```

### Android App Links

После сборки постоянным signer сначала проверьте кандидат по SHA-256 из release build audit:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mobile\publish-assetlinks.ps1 `
  -SignerSHA256 '<64 hex из release audit>' `
  -ValidateOnly
```

Фактическая публикация требует тот же fingerprint, `*.audit.json` со значением `signing=release` и точный физический путь активного frontend IIS. Известный debug-preview сертификат блокируется без обходного флага. Скрипт сохраняет делегации других Android package, адресно заменяет HUB-IT entry, создаёт backup существующего файла и атомарно обновляет `/.well-known/assetlinks.json`; production-запуск требует отдельного подтверждения.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mobile\publish-assetlinks.ps1 `
  -SignerSHA256 '<64 hex из release audit>' `
  -ReleaseAuditPath 'C:\secure-build\hubit-mobile-preview.audit.json' `
  -WebRoot 'C:\inetpub\wwwroot\itinvent'
```

Файл делегирует `handle_all_urls` и `get_login_creds` только package `ru.zsgp.hubit.mobile` с постоянным сертификатом. После публикации нужны HTTPS post-check `Content-Type: application/json`, точный fingerprint и `adb shell pm verify-app-links --re-verify ru.zsgp.hubit.mobile` на устройстве.

Из корня репозитория:

```powershell
# Только проверить локальный APK и будущий manifest
powershell -ExecutionPolicy Bypass -File scripts\mobile\publish-apk.ps1 `
  -ValidateOnly

# Разрешить .apk и отключить cache для mobile preview manifest.
# Скрипт сохраняет резервную копию production web.config вне публичного каталога.
powershell -ExecutionPolicy Bypass -File scripts\iis\enable_mobile_apk_feed.ps1

# Атомарно опубликовать version directory, затем latest.json
powershell -ExecutionPolicy Bypass -File scripts\mobile\publish-apk.ps1 `
  -IisUpdateRoot C:\inetpub\wwwroot\hub-desktop-updates `
  -ExpectedSignerSHA256 '<64 hex из build audit>'
```

Публикация требует соседний `*.audit.json`, полностью совпадающий с APK по package/version/code/size/hash/signer. `debug-preview` по умолчанию блокируется. Только для отдельно одобренного совместимого preview-перехода используется `-AllowDebugPreviewSigner`. Смена сертификата канала fail-closed: одноразовая ротация требует одновременно `-AllowSignerRotation` и точный `-ExpectedSignerSHA256` нового ключа; после ротации следующие версии снова публикуются без этого флага.

Frontend публикуется штатным `scripts\iis\publish_frontend_iis.ps1`. Backend mobile WebView session bridge опубликован 2026-08-22 и после штатного restart прошёл production post-check; повторный backend deployment нужен только при изменении этого контракта.

## Post-check

1. `latest.json` возвращает `200` и `Content-Type: application/json`.
2. Manifest schema v2 содержит `package_name=ru.zsgp.hubit.mobile`, `min_sdk=24`, `version`, `version_code`, `min_supported_version_code`, changelog, размер, SHA-256 и SHA-256 сертификата.
3. APK возвращает `200`, корректный MIME и тот же размер; скачанный SHA-256 совпадает с manifest.
4. На `/login` и `/settings/app` видна кнопка Android, Desktop feed продолжает работать.
5. На Android подтверждены download, install/update, login, logout и повторный вход.

Полная внешняя проверка manifest и APK без сохранения второй локальной копии:

```powershell
node scripts/mobile/verify-published-apk.mjs
```

## Rollback

- для аварийного отключения/восстановления manifest использовать `scripts/mobile/manage-apk-feed.ps1`: скрипт проверяет точный IIS root, делает backup и заменяет manifest атомарно;
- предыдущие manifest сохраняются в закрытом `.manifest-history`, а опубликованные version directory не перезаписываются;
- при server incompatibility можно отдельно изменить `min_supported_version_code`; это действие не заменяет публикацию совместимого APK;
- восстановить `web.config` из резервной копии, созданной `enable_mobile_apk_feed.ps1`;
- вернуть предыдущую сборку frontend;
- версионный APK-каталог удалять только отдельной операцией после проверки точного пути и отсутствия потребителей.


### 06.09 — публикация preview 1.1.27 (29)

После 265/1600 успешных тестов, TypeScript и Android export штатная ARM64/ARMv7 сборка завершилась успешно за 7m21s. APK 65295484 байта, SHA-256 926d40bb1dc3247e335c7ad8c55a24cd885d90ca3cbd0b4185cb45258b43d438; прежний signer fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c, режим debug-preview. Файлы: mobile-hub/dist/hubit-mobile-preview.apk и соседний audit.json.

Перед разрешённой публикацией выполнен ValidateOnly, appcmd подтвердил hubit/desktop-updates → C:\inetpub\wwwroot\hub-desktop-updates, текущий feed 1.1.26 и отсутствие каталога 1.1.27. Штатный publish-apk.ps1 сохранил прежний latest в .manifest-history; версия 1.1.26 оставлена. Откат — manage-apk-feed.ps1 -Action RestoreManifest с сохранённым манифестом 1.1.26.

Внешний verify-published-apk.mjs: manifest/APK HTTP200, schema2, 1.1.27/29, size/hash/signer совпали, verified=true. URL: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.27/HUB-IT-Mobile-Preview-1.1.27.apk . Серверные процессы и конфигурация не менялись. Не подтверждены установленное обновление, аппаратная биометрия, Android offline/restart и визуальная приёмка. x86_64 сборка ещё выполняется и не заменяет телефонный feed.


Эмуляторный APK 1.1.27 (29) также собран и выложен отдельным файлом: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.27/HUB-IT-Mobile-Emulator-x86_64-1.1.27.apk . Только ABI x86_64, 49175320 байт, SHA-256 01ffe1c1ca54ac2bf7ac706f13734d257bec9294d3ad7b6125046f74e60f068d, прежняя подпись. Внешнее скачивание HTTP200, размер и SHA-256 совпали. Телефонный latest не изменён этим дополнительным файлом. Встроенные assets/index.android.bundle обеих сборок идентичны: SHA-256 36d0645315526120dd39c5b1b349411b273d19bfd1e90437f256cb7d2f60abe3. Локально mobile-hub/dist/hubit-mobile-emulator-x86_64.apk и audit.json. Эмулятор не устанавливался и APK на Android не запускался.

### 08.09 — офлайн-чат, preview 1.1.28 (30)

Из отдельной ветки `fix/chat-offline-history-safety-2026-09-07` перенесены история, очередь и навигация нативного чата. Дополнительно восстановлены повтор/отмена файлов в карточке и отправка ответа без недоступной цитаты; ручной повтор защищён от устаревшего экрана после смены прав. Экранные тесты учитывают асинхронную очередь и FIFO.

Проверки: TypeScript PASS; 26/26 Node regression; 110/110 экранных тестов; полный Jest 271/271 наборов, 1681/1681 тестов PASS с блокировкой удалённых соединений. Expo Doctor 20/21: девять Expo-пакетов отстают на patch-версию; зависимости не обновлялись. ADB: устройств нет.

Штатная локальная preview-сборка с `-SkipPrebuild -AllowDebugSigning` завершилась за 18m06s: 681 задача, 95 выполнено. Android Gradle версия синхронизирована с package/release notes. APK ARM64/ARMv7, 65365444 байта (62.34 MiB), SHA-256 `f33b04b3daf0dade7bdff2f36adbe22002bc3e2186049d3dd11358087979bb8a`. Подпись v2 проверена, прежний signer `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, режим `debug-preview` для совместимого внутреннего обновления.

`appcmd` подтвердил IIS `hubit/desktop-updates/` → `C:\inetpub\wwwroot\hub-desktop-updates`; выполнен ValidateOnly. После разрешённой публикации `verify-published-apk.mjs` независимо скачал manifest/APK: HTTP200, MIME корректен, версия 1.1.28/30, размер/hash совпали, verified=true. Range 0–1023: HTTP206, 1024 байта. Серверные процессы и IIS-конфигурация не изменялись.

APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.28/HUB-IT-Mobile-Preview-1.1.28.apk
Локально: `mobile-hub/dist/hubit-mobile-preview.apk`, соседний audit JSON. Исходники остались в рабочем дереве без коммита/push. Результаты проверок: `artifacts/mobile/offline-*`.

Не проверены установка и реальное поведение на Android: airplane-mode/reconnect, смена приложения, биометрическая блокировка и доставка вложений. Новый x86_64 APK не выпускался.
Rollback: scripts/mobile/manage-apk-feed.ps1 -IisUpdateRoot 'C:\inetpub\wwwroot\hub-desktop-updates' -Action RestoreManifest -HistoryManifestPath 'C:\inetpub\wwwroot\hub-desktop-updates\mobile\preview\.manifest-history\latest-20260908-041710-60835522dec24fc3bc72cb5dd003ee09.json'. Сохранённый manifest проверен: версия 1.1.27 (29); прежний каталог APK оставлен.

### 08.09 — публикация preview 1.1.31 (33)

По отдельному разрешению опубликован собранный APK 1.1.31 с исправлениями офлайн-переходов, кэша и очередей. Предварительно прошли 275 наборов / 1718 тестов, TypeScript, сборка и validate-only. Подпись прежняя debug-preview; минимальная поддерживаемая версия сохранена: 1.

Публичный post-check: manifest и APK — HTTP 200, корректные MIME, 65 429 712 байт, SHA256 `ae4e43a4b53fb9b819034b5ed3fa56d0a66cb4a763c0ed07b930f723290973db`; Range — 206 / 1024 байта. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.31/HUB-IT-Mobile-Preview-1.1.31.apk .

Предыдущий manifest 1.1.28 сохранён в `.manifest-history/latest-20260908-060457-edc7ae39402645cea1be60f3e51ca072.json` и локально в `artifacts/mobile/publish-1.1.31/latest-before.json`. Результаты публикации и внешних проверок находятся в `artifacts/mobile/publish-1.1.31/`. Настройки IIS и процессы не изменялись. Установка/автообновление на физическом устройстве не проверены.

### 24.09 — публикация preview 1.1.49 (51)

Опубликован preview с нативным фундаментом чата (D1: reanimated 4 + worklets, gesture-handler, keyboard-controller) и Telegram-жестами: reply/forward-свайп на UI-потоке, интерактивный back-жест, drag-to-dismiss шторки, синхронная клавиатура. Предварительно прошли 321 набор / ~2100 тестов, TypeScript; debug-сборка для smoke проверена отдельно.

Первая попытка сборки упала на `AccessDeniedException` в transform-кэше Gradle (`4bcd7740…`); каталог кэша удалён, повторная сборка успешна за 18m38s.

APK 70 074 586 байт (66,8 МиБ), ARM64/ARMv7, SHA-256 `5a3b718f13afd9064f3b0e9fa3bba601d1e5414b1ecc200e3e465dbf20a848a9`, подпись debug-preview `fac61745…`, режим совместимости (`-AllowDebugPreviewSigner`). Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, версия 1.1.49 (51), size/hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.49/HUB-IT-Mobile-Preview-1.1.49.apk .

Предыдущий manifest сохранён в `.manifest-history/latest-20260924-121806-c8cbc26c2ec74c3e90c7135e4da50361.json`. Rollback: `manage-apk-feed.ps1 -Action RestoreManifest -HistoryManifestPath <этот файл>`.

Не проверено на устройстве: старт приложения с worklets, свайпы, интерактивный back, drag-to-dismiss, синхронная клавиатура — требуется smoke на Android.

### 24.09 — публикация preview 1.1.50 (52)

Фикс-релиз по ревью 1.1.49 (раздел 19 плана): worklet-краши свайпов (reply/forward/back), `GestureHandlerRootView` внутри Modal для drag-to-dismiss, клавиатура через `KeyboardStickyView`+`useReanimatedKeyboardAnimation` (композер больше не под клавиатурой), GH-миграция `FolderSwipeHost`, отложенный suspend сокетов (W12), метрика event-loop lag (I7), стыковка «хвоста» пузыря.

APK 70 082 114 байт (66,8 МиБ), ARM64/ARMv7, SHA-256 `b2f34242f93d306449dd9038b591d38571b9f96cf5bec981565ba7cb5cb11872`, подпись debug-preview `fac61745…` (`-AllowDebugPreviewSigner`). Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, версия 1.1.50 (52), hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.50/HUB-IT-Mobile-Preview-1.1.50.apk .

Предыдущий manifest сохранён в `.manifest-history/` (перед публикацией — manifest 1.1.49). Rollback: `manage-apk-feed.ps1 -Action RestoreManifest`.

### 25.09 — публикация preview 1.1.53 (55)

Релиз S8 (фоновая доставка и докачка, полный объём A+B+C): in-flight загрузка больше не рвётся при уходе в фон; вложения грузятся чанками через существующий backend-контракт `upload-sessions` с `sessionId` на durable-строке outbox, resume по `received_chunks` и multipart-fallback; очередь исходящих дожимается headless-задачей `HUBIT_MOBILE_BACKGROUND_SYNC_TASK` (WorkManager, бюджет 120 с) — новых нативных модулей и прав манифеста не потребовалось. Backend: `client_message_id` проброшен create→manifest→`persist_file_message` (cross-session dedup + очистка materialized-дублей), починен `ChatUploadOrchestrator.get_upload_session` (падал AttributeError→500 на GET `/chat/upload-sessions/{id}`). Также в релизе: фикс «разбалтывания» списка при смене папки свайпом, альбомная сетка вложений.

Проверки: backend pytest 12/12 upload-session; jest chat+lifecycle 345/345 и chat+screens 488/488; tsc чист (известные чужие WIP-ошибки mail-файлов вне scope). Локальная сборка `-AllowDebugSigning` завершилась за 42 мин: APK 70 611 437 байт (67,3 МиБ), ARM64/ARMv7, SHA-256 `8b4496d199b9329599db8bf26653b98f48a8e6f043269aab306e7881eb5609ae`, подпись debug-preview `fac61745…` (`-AllowDebugPreviewSigner`).

Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, schema v2, версия 1.1.53 (55), size/hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.53/HUB-IT-Mobile-Preview-1.1.53.apk . Предыдущий manifest 1.1.52 сохранён в `.manifest-history/`; rollback — `manage-apk-feed.ps1 -Action RestoreManifest`.

Backend задеплоен тем же окном: `restart-chat-scale.ps1` — rolling-рестарт `itinvent-chat-a`/`-b` с drain фермы (по разрешению пользователя); оба узла `/health/live` и `/health/ready` → 200, `GET /api/v1/chat/upload-sessions/{id}` отвечает 401 (route смонтирован, auth). Учтите: узлы работают прямо из рабочего дерева `WEB-itinvent` — рестарт поднял весь находившийся там backend-код.

Не проверено на устройстве: докачка после обрыва, фоновой drain после убийства приложения, итоговый smoke 1.1.53.

### 25.09 — публикация preview 1.1.54 (56)

Фикс-релиз по smoke 1.1.53 (раздел 20.7 плана): чанковая загрузка падала на устройстве — `File.slice()` строил RN `Blob` из `Uint8Array`-part, который `BlobManager` отбрасывает → ни один `PUT chunks/N` не доходил (сессии создавались, `received_bytes` оставался 0). Починено range-read через `FileHandle` (`open(ReadOnly)`+`offset`+`readBytes`) → точный `ArrayBuffer` в обоих транспортах: `nativeChatUploadSession.ts` и `nativeMyFilesTransfers.ts`. Плюс safe-area: `ChatBottomSheet` (~12 шитов: эмодзи/опросы/действия), `ChatAttachmentPanel` и `ChatComposer` не добавляли bottom-inset при edge-to-edge навигации → контент уходил под системную панель.

Проверки: jest myFiles 27/27, chat upload-session 7/7, компоненты 16/16, экраны 156/156; `tsc --noEmit` чист. Локальная сборка `-AllowDebugSigning` — 21 мин: APK 70 616 353 байт (67,4 МиБ), ARM64/ARMv7, SHA-256 `90f88943ed8404b888e99593d17366ab9da1c038619110550400a35b1a95d6ba`, подпись debug-preview `fac61745…` (`-AllowDebugPreviewSigner`).

Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, schema v2, версия 1.1.54 (56), size/hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.54/HUB-IT-Mobile-Preview-1.1.54.apk . Предыдущий manifest 1.1.53 сохранён в `.manifest-history/`; rollback — `manage-apk-feed.ps1 -Action RestoreManifest`.

Backend не трогали — `kind='contact'` в `ChatMessageKind` уже задеплоен с рестартом 1.1.53.

Не проверено на устройстве: отправка фото gallery/camera, multi-chunk файл, обрыв→resume, kill→WorkManager drain, шиты/композер над навигацией — smoke 1.1.54.

### 26.09 — публикация preview 1.1.55 (57)

Фикс-релиз по уточнённой диагностике safe-area (раздел 20.7 плана, второй проход DEV-INSET-1): первый вариант инсета в `ChatBottomSheet` ставился до `sheetStyle` и перетирался потребителями (`ChatStickerPickerSheet paddingBottom:10`, `AttachmentPickerSheet 20`, action/group-edit/NewChat шиты) → эмодзи/стикеры снова уходили под навигацию. Теперь `sheetStyle` мержится через `StyleSheet.flatten`: `paddingBottom = max(consumer, inset)`; плавающие карточки (`ChatAttachmentActionsSheet`) поднимаются `marginBottom`; при открытой клавиатуре (`useKeyboardState().isVisible`) инсет гасится и в шитах `avoidKeyboard`, и в `ChatComposer` — убрана мёртвая полоса между контентом и клавиатурой.

Проверки: jest chat-компоненты + экраны 302/302; `tsc --noEmit` чист. Локальная сборка `-AllowDebugSigning` — 22 мин: APK 70 616 713 байт (67,4 МиБ), ARM64/ARMv7, SHA-256 `9cec43590f162ae2be32746b848c5d4c3ff4d71084258e6b1f1fd204187a83d2`, подпись debug-preview `fac61745…` (`-AllowDebugPreviewSigner`).

Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, schema v2, версия 1.1.55 (57), size/hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.55/HUB-IT-Mobile-Preview-1.1.55.apk . Предыдущий manifest 1.1.54 сохранён в `.manifest-history/`; rollback — `manage-apk-feed.ps1 -Action RestoreManifest`. Каталог 1.1.54 остался в feed — скрипт публикации не перезаписывает версии, потому выпущен как 1.1.55.

Не проверено на устройстве: полный smoke 1.1.55 — фото gallery/camera, multi-chunk файл, обрыв→resume, kill→WorkManager drain, все шиты/композер над навигацией с закрытой и открытой клавиатурой.

### 26.09 — публикация preview 1.1.56 (58)

Фикс-релиз по третьему проходу шитов (раздел 20.7 плана, DEV-SHEET-2): панели эмодзи/стикеров/опроса открывались, но «висели по середине» экрана — связка `Modal` (отдельное Dialog-окно) + `KeyboardStickyView` переводила `translateY` из reanimated-значения высоты клавиатуры, которое внутри dialog-окна расходилось с реальным IME (собственный поток insets окна, гонка `Keyboard.dismiss()`/фокус) → значение застывало на высоте клавиатуры и шит уезжал вверх. Три панели переведены на новый inline-хост `ChatInlineSheet`: рендер в основном окне в потоке под композером (по образцу `ChatAttachmentPanel`), `Keyboard.dismiss()` при открытии, без backdrop и без трекинга клавиатуры — `adjustResize` основного окна сам поднимает панель; при открытой клавиатуре bottom-inset гасится. Затронуты `ChatEmojiPickerSheet`, `ChatStickerPickerSheet`, `ChatPollCreateSheet`; `pollCreateVisible` поднят в `useThreadSheets` (Back-закрытие через `useThreadBack`); панели взаимоисключают друг друга и панель вложений. В `ChatBottomSheet` добавлен guard `KeyboardStickyView enabled={isVisible}` для остальных avoidKeyboard-шитов.

Проверки: jest chat-компоненты + экраны 302/302; `tsc --noEmit` чист. Локальная сборка `-AllowDebugSigning` — 13 мин: APK 70 618 793 байт (67,4 МиБ), ARM64/ARMv7, SHA-256 `71d016cdc2d86f806a1b7c233214f22025a352df50690e6cda0c438ae97574cc`, подпись debug-preview `fac61745…` (`-AllowDebugPreviewSigner`).

Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, schema v2, версия 1.1.56 (58), size/hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.56/HUB-IT-Mobile-Preview-1.1.56.apk . Предыдущий manifest 1.1.55 сохранён в `.manifest-history/`; rollback — `manage-apk-feed.ps1 -Action RestoreManifest`. Каталог 1.1.55 остался в feed — скрипт публикации не перезаписывает версии.

Не проверено на устройстве: smoke 1.1.56 — эмодзи/стикеры/опрос привязаны ко дну (не «в центре»), переключение панелей и вложений, Android Back закрывает панель, клавиатура открытие/закрытие без зазоров, фото gallery/camera, multi-chunk файл, обрыв→resume, kill→WorkManager drain.

### 26.09 — публикация preview 1.1.57 (59)

Фикс-релиз по четвёртому проходу шитов (раздел 20.7 плана, DEV-SHEET-3): (а) inline-панели «немного уходили на низ экрана» — `ChatInlineSheet` и `ChatAttachmentPanel` были в потоке, но вне `KeyboardStickyView`; в edge-to-edge окно по adjustResize не ужимается, поэтому фокус любого поля внутри панели (поиск эмодзи, поля опроса, поиск задачи, подпись вложений) открывал клавиатуру поверх панели. Обе обёрнуты в `KeyboardStickyView` — в главном окне shared-значения клавиатуры надёжны. (б) Шит «Отправить задачу» оставался на `Modal`+`avoidKeyboard` — тот же класс «висит по середине» → переведён на `ChatInlineSheet`. Дополнительно: взаимное исключение панели задач с остальными пикерами и `onInputFocus` у композера — фокус поля сообщения закрывает открытые панели (Telegram-обмен).

Проверки: jest chat-компоненты + экраны 302/302; `tsc --noEmit` чист. Локальная сборка `-AllowDebugSigning` — 13 мин: APK 70 619 997 байт (67,4 МиБ), ARM64/ARMv7, SHA-256 `6e694a467a61ab6fe2f0cd21a34bae4f9410512e9adb622b1968cd2c5dc72bef`, подпись debug-preview `fac61745…` (`-AllowDebugPreviewSigner`).

Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, schema v2, версия 1.1.57 (59), size/hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.57/HUB-IT-Mobile-Preview-1.1.57.apk . Предыдущий manifest 1.1.56 сохранён в `.manifest-history/`; rollback — `manage-apk-feed.ps1 -Action RestoreManifest`. Каталог 1.1.56 остался в feed — скрипт публикации не перезаписывает версии.

Не проверено на устройстве: smoke 1.1.57 — эмодзи/стикеры/опрос/задачи привязаны ко дну и едут с клавиатурой (поля внутри панелей доступны), переключение панелей, фокус поля сообщения закрывает панель, Android Back, фото gallery/camera, multi-chunk файл, обрыв→resume, kill→WorkManager drain.

### 27.09 — публикация preview 1.1.58 (60)

Фикс-релиз по пятому проходу шитов (DEV-SHEET-4) + остатки плана: (а) **геометрия панелей** — после обёртки в `KeyboardStickyView` (1.1.57) процентные высоты (`height:'72%'` стикеры, `maxHeight:'62–78%'` эмодзи/опрос/задача) потеряли определённую базу: родитель стал auto-height обёрткой вместо полноэкранного `Modal` → Yoga не разрешал '%' → панель схлопывалась/резалась, оставляя «пространство с фоном». `ChatInlineSheet` теперь конвертирует `height`/`maxHeight`/`minHeight` в пиксели от `useWindowDimensions().height` — та же семантика «% окна», что была у `Modal`. (б) Вошли остатки: `reorderPanelAssets` + long-press drag-reorder в полосе превью вложений (R-T8-2); `local_status:'sending'` участвует в медиа-альбомах (DEV-MEDIA-3); backend `_poll_option_index` — strict-валидация `option_index` в WS (nit из ревью; прод-эффект после рестарта chat-узлов).

Проверки: `tsc --noEmit` чист; jest chat-компоненты/экраны/модуль — 640/640 (85 сьютов). Локальная сборка `-AllowDebugSigning -SkipPrebuild` — 5 мин: APK 70 631 697 байт (67,4 МиБ), ARM64/ARMv7, SHA-256 `52f953cef2d485a6dc66d13cd8863a021e0c47879325ef85ef8e911af0401b39`, подпись debug-preview `fac61745…` (`-AllowDebugPreviewSigner`).

Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, schema v2, версия 1.1.58 (60), size/hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.58/HUB-IT-Mobile-Preview-1.1.58.apk . Предыдущий manifest 1.1.57 сохранён в `.manifest-history/`; rollback — `manage-apk-feed.ps1 -Action RestoreManifest`. Каталог 1.1.57 остался в feed — скрипт публикации не перезаписывает версии.

Не проверено на устройстве: smoke 1.1.58 — эмодзи/стикеры/опрос/задачи занимают заявленную высоту и доходят до нижнего края (без полосы и обрезки), поля внутри панелей над клавиатурой, drag-reorder превью вложений, альбом с sending-фото, переключение панелей, Android Back, фото gallery/camera, multi-chunk файл, обрыв→resume, kill→WorkManager drain.

### 02.10 — публикация preview 1.1.62 (64)

Релиз по аудиту нативного чата (журнал §21 `MOBILE_CHAT_TELEGRAM_PARITY_PLAN.md` + вторая волна): (а) **P0** — SecureStore-блоб очереди с битой записью клинил все отправки до logout (спасение валидных строк + карантин); тап по вложению в режиме выделения открывал вьюер вместо выбора; имена отправителей в группах не появлялись при live-загрузке. (б) Inbox: свайп «Прочитано» реально отправляет `last_message_id` (нужен backend с правкой `chat_serialization.py`), подписка восстанавливается на reconnect, mute-бейджи, конфликт жестов «папка vs строка» решён zone-lock. (в) Тред: входящее при оторванном окне идёт в счётчик; typing-TTL серверный; сброс состояний при смене диалога; ленивый merge истории. (г) Шторки/медиа: защиты от двойных тапов, timeout и error-стейты у видео/GIF, LRU-кэши, inset-отступы. (д) Вторая волна аудита: сироты файлов черновиков при coalesce-записи, залипший pull-to-refresh при смене владельца, откат оптимистичного pin, `allSettled` для мульти-удаления, `.catch` на всех Clipboard/SecureStore-цепочках, таймаут пикера контактов 60с, presence без лишних ре-рендеров, HTTP-fallback только для видимого треда (`useFocusEffect`-активность), backoff пагинации галереи.

Проверки: `npx tsc --noEmit` чист; `npm run test:ci` — 365/366 сьютов, 2547/2548 тестов (единственное падение — `mobile-version.test.js` до prebuild, транзитно); после сборки версии синхронизированы. Локальная сборка `-AllowDebugSigning` — 34 мин: APK 70 780 901 байт (67,5 МиБ), ARM64/ARMv7, SHA-256 `164ec6b6cdb543d37e8806654f7239c118331f12ef84633402a18dcccaeba3f4`, подпись debug-preview `fac61745…` (`-AllowDebugPreviewSigner`).

Post-check `verify-published-apk.mjs`: manifest/APK HTTP 200, schema v2, версия 1.1.62 (64), size/hash/signer совпадают, `verified: true`. APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.62/HUB-IT-Mobile-Preview-1.1.62.apk . Предыдущий manifest 1.1.61 сохранён в `.manifest-history/`; rollback — `manage-apk-feed.ps1 -Action RestoreManifest`. Каталог 1.1.61 остался в feed.

Не проверено на устройстве: полный smoke 1.1.62 — отправка/очередь после kill, focus-поллер на возврате в скрытый тред, жесты папки/строки, видео/GIF error-стейты, черновики с вложениями.

ВАЖНО: свайп «Прочитано» требует backend с `last_message_id` в сериализации диалогов (`WEB-itinvent/backend/chat/chat_serialization.py` изменён в рабочем дереве, но не задеплоен) — без выкладки backend действие корректно бездействует.
