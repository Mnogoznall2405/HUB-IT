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
