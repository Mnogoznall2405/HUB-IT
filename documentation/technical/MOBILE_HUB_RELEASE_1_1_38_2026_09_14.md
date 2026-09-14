# Mobile 1.1.38 — публикация 14.09.2026

По запросу пользователя APK собран и опубликован в существующий канал preview.

- Версия: 1.1.38, Android versionCode: 40, пакет `ru.zsgp.hubit.mobile`.
- APK: https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.38/HUB-IT-Mobile-Preview-1.1.38.apk
- Размер: 68 038 095 байт (64,89 МиБ), ARM64 и ARMv7.
- SHA-256: `734f6e0fa35d9b47948d7d1a2215153279b1ca32f778b52206dd565988b518e6`.
- Подпись: прежняя `debug-preview`, SHA-256 сертификата `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`; ротация ключа не выполнялась.

## Проверки

Штатный `build-apk.ps1 -Local -Variant preview -AllowDebugSigning` завершился успешно: 681 задача Gradle, включая R8 и lintVitalRelease. Проверены версия, подпись v2, архитектуры и размер APK. `publish-apk.ps1 -ValidateOnly` прошёл перед публикацией. Ранее на исходниках интерфейсных исправлений прошли 236 наборов / 1434 теста, TypeScript и Android-export; в этом этапе изменены метаданные версии и release notes.

`appcmd` подтвердил каталог IIS `C:\inetpub\wwwroot\hub-desktop-updates`. После публикации `verify-published-apk.mjs` независимо скачал публичные manifest и APK: HTTP 200, корректные MIME, размер и SHA-256, `verified=true`. Range `bytes=0-1023`: HTTP 206, 1024 байта.

Логи находятся в `mobile-hub/artifacts/release-1.1.38/`: `build.log`, `validate.json`, `publish.json`, `public-verification.json`, `range.json`. APK и аудит — в `mobile-hub/dist/`.

## Откат и ограничения

Предыдущий APK 1.1.37 сохранён. Его манифест сохранён локально в `artifacts/release-1.1.38/rollback-latest-1.1.37.json` и штатно в `.manifest-history/latest-20260914-054941-1fff46bda607402d94db985d3a6a57bd.json`. `manage-apk-feed.ps1 -Action RestoreManifest -ValidateOnly` прошёл; откат не выполнялся. Подготовлен `artifacts/release-1.1.38/rollback.ps1`, восстанавливающий точный манифест из истории и проверяющий публичную выдачу. Возврат манифеста не понижает уже установленное приложение.

`adb devices -l` не обнаружил устройств: установка поверх предыдущей версии, жесты, клавиатура и реальные offline-сценарии не проверены. Публикация включает APK из текущего рабочего дерева; коммит не создавался. Backend, его изменения пагинации управляемой ленты и серверные процессы этим этапом не развёртывались и не перезапускались. IIS-конфигурация не менялась.
