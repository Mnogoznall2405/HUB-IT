# HUB-IT Mobile (Expo, Android)

Android-клиент HUB-IT: native авторизация/2FA, SecureStore, push и зафиксированный набор нативных рабочих модулей. Клиент использует существующие frontend и `/api/v1`; отдельного backend у мобильного приложения нет.

После входа Android показывает только native-enabled модули. Переходов в портал и WebView-fallback больше нет: старые `/web` и `/portal` ссылки перенаправляются на подходящий нативный экран, а недоступные в APK разделы — в нативное меню. Актуальный состав и проценты покрытия: [MOBILE_HUB_NATIVE_SCREEN_MIGRATION_MAP.md](../documentation/technical/MOBILE_HUB_NATIVE_SCREEN_MIGRATION_MAP.md).

Текущий source-кандидат: Expo SDK 57, React Native 0.86, Android package `ru.zsgp.hubit.mobile`, версия `1.1.27`, `versionCode` 29, target/compile SDK 36.

## Установка и запуск

Требуются Node.js с npm и доступный HUB-IT backend. Для локального Android build дополнительно нужны JDK 17, Android SDK 36 и CMake 3.22.1.

```powershell
cd C:\Project\Image_scan\mobile-hub
npm install
npx expo-doctor
npx expo start
```

API по умолчанию: `https://hubit.zsgp.ru/api/v1`. Для локального backend создайте некоммитируемый `.env`:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:8001/api/v1
EXPO_PUBLIC_NATIVE_CHAT_ENABLED=true
EXPO_PUBLIC_NATIVE_TASKS_ENABLED=true
EXPO_PUBLIC_NATIVE_NOTIFICATIONS_ENABLED=true
```

`10.0.2.2` — loopback хоста из стандартного Android Emulator. Для физического телефона укажите доступный ему HTTPS/LAN-адрес.

Expo Go подходит для быстрой проверки UI. Remote push нужно проверять в development/preview APK, а не в Expo Go.

Preview APK регистрирует notification task в module scope: `Ответить` и `Прочитано` могут выполняться в фоне без открытия интерфейса приложения. Быстрый ответ обновляет исходный Android notification identifier, чтобы RemoteInput штатно сменился со статуса отправки на итоговый; при временной ошибке точный текст хранится в ограниченной SecureStore-очереди, а Android WorkManager повторяет безопасную синхронизацию с минимальным интервалом 15 минут. Реальная частота зависит от Doze, производителя и Force stop; поэтому background/killed сценарии обязательно проверяются на физическом устройстве.

## Приёмка на физическом Android

Подключите телефон с включённым USB debugging и сначала выполните безопасную read-only проверку уже установленной версии:

```powershell
npm run smoke:device
```

Установка поверх предыдущей версии и полный clean install запускаются явно:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/device-smoke.ps1 -InstallMode Upgrade -Interactive
powershell -ExecutionPolicy Bypass -File scripts/device-smoke.ps1 -InstallMode Clean -AllowDataReset -Interactive
```

Если подключено несколько устройств, передайте `-Serial <adb-serial>`. Скрипт проверяет package/version, запуск, возврат из фона и нативные deep links, после чего проводит по ручной матрице 2FA, задач, Chat, push и почты. Отдельно фиксируются подготовка offline-списков, cache miss, восстановление плашки, Android validated network, переход в настройки батареи и серия из 20 cold-start/offline-online циклов. Обезличенный JSON со статусами `passed`, `failed` и `not_run` сохраняется в `artifacts/mobile/`: serial, credentials, токены, cookie, тексты сообщений, screenshots, logcat, SSID, IP и оператор не собираются.

## Локальная сборка APK

Автономный внутренний preview APK со встроенным JS-бандлом и постоянной release-подписью:

```powershell
$env:HUBIT_ANDROID_KEYSTORE_FILE = 'C:\secure\hubit-mobile-release.jks'
$env:HUBIT_ANDROID_KEYSTORE_PASSWORD = '<из защищённого хранилища>'
$env:HUBIT_ANDROID_KEY_ALIAS = '<alias>'
$env:HUBIT_ANDROID_KEY_PASSWORD = '<из защищённого хранилища>'
npm run build:apk:local
```

Для первоначального создания постоянного ключа и двух backup используйте `scripts/prepare-release-signing.ps1`; скрипт требует пути вне Git, не перезаписывает существующие файлы и не принимает пароль через CLI. Подробная процедура и переход с debug-preview описаны в `documentation/technical/MOBILE_HUB_APK_DISTRIBUTION.md`.

Готовый внутренний preview APK: `dist/hubit-mobile-preview.apk`. Для публикации рядом с HUB Desktop используется `scripts/mobile/publish-apk.ps1`; manifest и версионный APK размещаются под `/desktop-updates/mobile/preview/`. Preview 1.1.27 (29) опубликован 2026-09-06; внешний manifest/APK и SHA-256 проверены. Проверка установки на Android остаётся отдельной. Подробности и rollback: `documentation/technical/MOBILE_HUB_APK_DISTRIBUTION.md`.

Результат: `dist/hubit-mobile-preview.apk`; рядом создаётся `dist/hubit-mobile-preview.audit.json` с package/version, размером, SHA-256 APK, SHA-256 сертификата и режимом подписи. Сборка без четырёх `HUBIT_ANDROID_*` переменных завершается fail-fast.

Только для обновления уже установленного внутреннего debug-signed APK 1.1.3 допускается явно совместимый кандидат с тем же сертификатом:

```powershell
npm run build:apk:local:compat
```

Этот режим помечается `debug-preview`, подходит лишь для внутреннего перехода и не считается стабильным signing-каналом.

Debug APK для разработки с Metro:

```powershell
npm run build:apk:local:debug
```

Результат: `dist/hubit-mobile-debug.apk`.

Build script выполняет чистый `expo prebuild`, фиксирует совместимый Gradle 8.13 и учитывает Windows-пути с кириллицей. На Windows с не-ASCII профилем Gradle-кэш автоматически размещается в коротком игнорируемом пути `../.gradle-hub`, чтобы CMake/Ninja не упирались в лимит 260 символов. При нестандартном окружении доступны переменные:

```powershell
$env:HUBIT_JAVA_HOME = 'C:\path\to\jdk-17'
$env:HUBIT_ANDROID_SDK_ROOT = 'C:\path\to\Android\Sdk'
$env:HUBIT_GRADLE_USER_HOME = 'C:\path\to\gradle-cache'
npm run build:apk:local
```

На Windows Server используйте Android Platform-Tools 37.0.1 или новее. В 37.0.0 `adb.exe` мог завершаться с кодом `-1073741515` из-за жёсткой зависимости от отсутствующего `wlanapi.dll`; начиная с 37.0.1 библиотека загружается только при необходимости.

## EAS preview

Профиль `preview` в `eas.json` создаёт внутренний APK с production API URL. Credentials хранятся в EAS/CI, а не в Git.

```powershell
npx eas-cli login
npx eas-cli init
$env:EXPO_EAS_PROJECT_ID = '<UUID из eas init>'
npm run build:apk
npx eas-cli build:list
```

`EXPO_EAS_PROJECT_ID` передаётся в `extra.eas.projectId` при разрешении `app.config.ts`. Для CI используйте защищённый `EXPO_TOKEN`. Production-профиль собирает AAB и требует отдельной release-подписи.

## Firebase Cloud Messaging

`google-services.json` не хранится в репозитории. Перед prebuild/build передайте путь к защищённому файлу:

```powershell
$env:EXPO_GOOGLE_SERVICES_FILE = 'C:\secure\google-services.json'
npm run build:apk:local
```

Package в Firebase должен совпадать с `ru.zsgp.hubit.mobile`. Для реальной доставки также должны быть настроены backend FCM credentials и включён native push runtime. Backend этого релиза использует Alembic-миграцию `20260822_0101` и durable `app.push_outbox` для почты, задач и системных уведомлений; Chat остаётся на собственной outbox.

## Проверки

```powershell
npm run lint
npm run test:ci
npx expo install --check
npx expo-doctor
npm audit
```

Auth использует `X-Auth-Client: mobile`, Bearer JWT и `expo-secure-store`. Logout останавливает Chat reconnect, отзывает зарегистрированный push token, вызывает backend logout и очищает access/refresh token даже при сетевой ошибке.

После native login Android открывает native shell и маршрутизирует только включённые нативные модули. Клиент больше не создаёт web-session и не передаёт auth-состояние в портал. Итоговый состав APK: [MOBILE_HUB_NATIVE_SCREEN_MIGRATION_MAP.md](../documentation/technical/MOBILE_HUB_NATIVE_SCREEN_MIGRATION_MAP.md).

Внутренние preview/debug APK не регистрируют `https://hubit.zsgp.ru/*` в Android URL resolver, чтобы после login/2FA не появлялся выбор «Открыть в HUB». Verified HTTPS App Links разрешено включать через `HUBIT_ANDROID_ENABLE_APP_LINKS=1` только для постоянной release-подписи после публикации совпадающего `/.well-known/assetlinks.json`.

После успешного 2FA приложение предлагает добровольно включить вход по отпечатку. Это локальная разблокировка: онлайн серверная сессия всё равно проверяется через `/auth/me`/refresh, а `401/403` удаляет локальный credential. Без сети доступны только ранее загруженные GET-данные в режиме чтения; они шифруются AES-GCM ключом из биометрически защищённого SecureStore. Нативный logout очищает токены, биометрию, очереди, черновики и локальные файловые кэши независимо от доступности сети.

Локальный диагностический отчёт содержит только фиксированные коды и агрегаты. На Android 11+ собственный Expo-модуль читает ограниченную системную историю завершений процесса (`ApplicationExitInfo`) и показывает ANR, Java/native crash и low-memory без description, trace, PID, токенов и пользовательского содержимого.

Подтверждённые пользователем действия в нативных Android-настройках могут вызывать только короткую системную тактильную обратную связь `selection`, `success` или `error`. Произвольные паттерны, автоматическая вибрация при загрузке/навигации и фоновые haptics не поддерживаются; текстовый статус остаётся основным для доступности.

Нативные файловые поля используют системные Android picker, chooser, камеру и галерею. Выбранные `content://` URI обрабатываются только нативными файловыми адаптерами; камера и реальные загрузки проверяются в device smoke.

Состояние сети APK получает от Android `ConnectivityManager`: online означает сеть с `NET_CAPABILITY_VALIDATED`, без SSID/IP и другой сетевой идентификации. При потере связи нативные экраны сразу становятся read-only. После возврата сети приложение восстанавливает серверную сессию с backoff 2/5/15/30 секунд; зелёный статус появляется только после успешного ответа backend. На общей странице Android-настроек можно вручную запросить ограниченный снимок: подтверждён ли интернет, транспорт и metered-режим — без SSID, IP и оператора.

Кнопка «Подготовить автономный режим» заранее обновляет только доступные пользователю read-модели Главной, Задач и Почты. Интерфейс ждёт завершения AES-GCM записи, сверяет свежесть по каждому модулю и показывает частичный результат, если отдельный раздел недоступен; скрытой отправки изменений при восстановлении сети нет.

Там же доступна кнопка системных настроек батареи и фоновой работы HUB-IT. Приложение сначала открывает app-specific battery screen, а на несовместимых OEM-прошивках — системную карточку приложения. HUB-IT не запрашивает исключение из battery optimization автоматически: решение остаётся за пользователем и политиками устройства.

Нативный shell и рабочие экраны используют safe-area и собственный keyboard avoidance. Нижняя Android navigation bar скрывается приложением; окончательное поведение жестовой панели зависит от версии Android и проверяется на физическом устройстве.

`react-native-webview` пока остаётся только как изолированный движок содержимого: безопасное отображение HTML-писем, воспроизведение отдельных видео-вложений Chat и технический экспорт результата редактора изображения. Эти компоненты не открывают HUB-портал, не получают web-session и не участвуют в навигации приложения.

Нативные экраны Login/2FA/биометрии, блокировки и обязательного обновления имеют TalkBack-заголовки и объявляемые ошибки. Login переводит фокус на первое пустое поле, прогресс загрузки APK объявляется как progressbar, а app-lock и updater прокручиваются при увеличенном системном шрифте. Ручная приёмка TalkBack и масштабов 100/130/200% всё равно обязательна на телефоне.

Фактический статус сборки и ручной приёмки: [MOBILE_HUB_PROTOTYPE_ACCEPTANCE.md](../documentation/technical/MOBILE_HUB_PROTOTYPE_ACCEPTANCE.md). Полный чек-лист: [MOBILE_HUB_CHECKLIST.md](../documentation/technical/MOBILE_HUB_CHECKLIST.md).
