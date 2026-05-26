# Android HUB-IT App: refined plan and checklist

Дата: 2026-05-25

Этот файл заменяет черновой Cursor-план как рабочий чек-лист для разработки Android-приложения HUB-IT. Базовое решение остается прежним: не переписывать UI, а упаковать существующий React/Vite/MUI frontend через Capacitor в Android APK.

## Короткое решение

- Оболочка: Capacitor v8, если не появится жесткая причина закрепиться на v7.
- UI: тот же `WEB-itinvent/frontend/dist`.
- Android-проект: новая папка `mobile-android/`.
- API: целевой production APK ходит на фиксированный HTTPS endpoint через `VITE_API_URL`; временный debug APK для проверки auth использует remote WebView `server.url = https://hubit.zsgp.ru`.
- Distribution: внутренний подписанный APK, без Google Play в первой итерации.
- Первый технический риск: auth/session cookies в Capacitor WebView. До FCM, passkey и файлов надо доказать стабильный login/refresh/API на реальном Android.

## Текущий статус реализации

- [x] Создан `mobile-android/package.json` с Capacitor v8 dependencies.
- [x] Создан `mobile-android/capacitor.config.ts`; текущий debug APK временно использует `server.url = https://hubit.zsgp.ru` для совместимости с cookie/2FA.
- [x] Добавлен frontend mode `android`: `WEB-itinvent/frontend/.env.android`.
- [x] Добавлен frontend script `npm run build:android`.
- [x] Добавлен `VITE_PLATFORM=capacitor` guard для PWA install prompt, service worker registration и Web Push.
- [x] Добавлен корневой скрипт `scripts/build-android-apk.ps1`.
- [x] Установить зависимости в `mobile-android`: `npm install`.
- [x] Сгенерировать Android-проект: `npm run add:android`.
- [x] Добавить Android manifest hardening: no cleartext, portrait, no backup, network security config.
- [x] Добавлен скрипт установки Android build tools: `scripts/install-android-devtools.ps1`.
- [x] Установлены JDK 21 и Android SDK на `tmn-srv-app-02`.
- [x] Собран первый Debug APK: `mobile-android/android/app/build/outputs/apk/debug/app-debug.apk`.
- [ ] Поставить первый Debug APK на реальное Android-устройство.
- [x] После проверки на устройстве выбран временный Phase 0 auth mode: remote WebView `https://hubit.zsgp.ru`, потому что packaged origin ломает текущую cookie/2FA схему.
- [ ] Пройти Phase 0 auth baseline на реальном Android.

## Что уже подтверждено в репозитории

- Frontend: React 18, Vite 7, MUI 5, React Router в `WEB-itinvent/frontend`.
- PWA: `WEB-itinvent/frontend/public/manifest.webmanifest`, `sw.js`, standalone display, portrait orientation, PWA icons.
- API client: `WEB-itinvent/frontend/src/api/client.js` поддерживает `VITE_API_URL` и относительный `/api`.
- Mobile UI: `MainLayout.jsx`, `index.css`, chat/mail/task screens уже используют mobile breakpoints, safe-area CSS и touch-friendly размеры.
- Web Push уже есть через VAPID/Web Push subscriptions, но это не FCM и не заменяет Android push.
- WebAuthn/passkey уже есть на web-login, но для Android WebView нужен отдельный Credential Manager/WebView integration.

## Главные правки к исходному плану

1. Auth/cookies становятся фазой 0, а не скрытым допущением.
   Текущий backend ставит HttpOnly cookies, frontend использует `withCredentials`, а SameSite по умолчанию `strict`. В packaged Capacitor origin может отличаться от `https://hubit.zsgp.ru`, поэтому надо отдельно проверить, будут ли login, refresh, WebSocket и file upload стабильно работать из APK.

2. `server.url` не является финальной packaged-release схемой.
   Для первого рабочего debug APK он временно используется как auth-safe remote WebView, потому что текущий backend принимает cookies только для `https://hubit.zsgp.ru`. Финальный packaged APK требует отдельного решения: CORS/SameSite для Capacitor origin или mobile token flow.

3. Passkey/WebAuthn не считать "готовым".
   Android WebView требует WebKit/Credential Manager support, Digital Asset Links и проверку `WEB_AUTHENTICATION`. Без этого passkey может не работать, даже если веб-версия работает в Chrome.

4. FCM требует отдельного backend-контура.
   Сейчас есть Web Push/VAPID endpoint storage. Для Android нужны FCM device tokens, Firebase service account/HTTP v1 отправка, permission request на Android 13+, notification channel и deep-link payload.

5. Deep links делить на custom scheme и verified App Links.
   `hubit://...` удобно для внутренних ссылок и FCM payload, но надежные HTTPS App Links требуют `assetlinks.json`, release/debug SHA-256 fingerprints и intent filters.

## Phase 0 - architecture spike and debug APK

Цель: доказать, что существующее web-приложение может жить в Capacitor без поломки авторизации и базовых рабочих сценариев.

- [ ] Принять production domain и API base URL.
  - [x] Зафиксировать frontend origin: `https://hubit.zsgp.ru`.
  - [x] Зафиксировать API URL: `https://hubit.zsgp.ru/api`.
  - [ ] Убедиться, что HTTPS сертификат валиден на корпоративных Android-устройствах.
  - [ ] Если используется корпоративный CA, описать установку/доверие сертификата.

- [ ] Принять Android identifiers.
  - [x] `appId`: `ru.zsgp.hubit`.
  - [x] `appName`: `HUB-IT`.
  - [ ] Debug applicationId suffix, если нужен отдельный debug App Links entry.

- [x] Создать `mobile-android/`.
  - [x] `package.json` с Capacitor v8.
  - [x] `capacitor.config.ts`.
  - [x] `webDir: '../WEB-itinvent/frontend/dist'`.
  - [x] Debug APK временно использует `server.url = https://hubit.zsgp.ru`.
  - [ ] `server.url` отсутствует в финальной packaged release config.
  - [x] `server.cleartext` отсутствует/false в release config.
  - [x] `android.path: 'android'`.

- [x] Добавить frontend build mode для APK.
  - [x] Добавить `.env.android` или npm script, задающий `VITE_API_URL`.
  - [x] Добавить `VITE_PLATFORM=capacitor`.
  - [x] В UI скрыть PWA install CTA при `VITE_PLATFORM=capacitor`.
  - [x] Не менять общий visual theme.

- [x] Собрать первый debug APK.
  - [x] `cd WEB-itinvent/frontend && npm run build -- --mode android` или согласованный script.
  - [x] `cd mobile-android && npx cap sync android`.
  - [x] `cd mobile-android/android && ./gradlew assembleDebug`.
  - [ ] Установить APK на реальное Android-устройство.

- [ ] Проверить auth baseline на устройстве.
  - [ ] Password login.
  - [ ] 2FA flow.
  - [ ] Refresh после истечения access token.
  - [ ] Logout.
  - [ ] Повторный запуск APK сохраняет/не сохраняет сессию согласно текущей политике.
  - [ ] API requests идут с cookies или выбранной mobile-token схемой.
  - [ ] WebSocket chat auth работает, если chat включен.

- [x] Принять решение по auth model.
  - [ ] Вариант A: оставить cookie auth, настроив HTTPS/CORS/SameSite/domain так, чтобы WebView работал безопасно.
  - [ ] Вариант B: добавить mobile token flow с `Authorization: Bearer` и secure native storage.
  - [x] Вариант C: remote WebView на `https://hubit.zsgp.ru` вместо packaged `dist` только если важнее origin/passkey, чем автономная упаковка assets.
  - [x] Решение: для первого рабочегo APK используем Вариант C; packaged mode возвращаем только после Варианта A или B.

Acceptance criteria:

- [ ] Debug APK открывает HUB-IT без белого экрана.
- [ ] Login/logout/refresh работают на реальном устройстве.
- [ ] `/dashboard`, `/tasks`, `/chat`, `/mail`, `/database` открываются с реальными API.
- [ ] Нет cleartext HTTP в release-like build.
- [ ] Известно, какая auth model используется дальше.

## Phase 1 - Android shell hardening

Цель: получить стабильную нативную оболочку без push/passkey усложнений.

- [x] Настроить Android package metadata.
  - [x] App label.
  - [x] Version name/code.
  - [x] Min/target SDK по текущему Android Gradle Plugin.
  - [x] Orientation portrait, если это остается требованием.

- [ ] Настроить icon/splash.
  - [ ] Переиспользовать `WEB-itinvent/frontend/public/pwa-512.png`.
  - [ ] Сгенерировать Android adaptive icon.
  - [ ] Настроить splash background по manifest colors: `#0f1722` / `#121a25`.

- [ ] Настроить status/system bars.
  - [x] Подключить Capacitor status/system bars.
  - [x] Задать темные status/navigation bars через Android resources и Capacitor bridge.
  - [ ] Проверить safe-area на Android с gesture navigation.
  - [ ] Проверить, что fixed chat/mail layouts не перекрываются keyboard/status/nav bars.

- [ ] Настроить hardware back.
  - [x] Добавлен Capacitor `backButton` listener.
  - [x] Закрывает drawer/dialog/menu, если они открыты.
  - [x] Идет `history.back()`, если есть history.
  - [x] На корневых экранах сворачивает приложение.
  - [ ] Проверить поведение на реальном Android.

- [x] Настроить network policy.
  - [x] `android:usesCleartextTraffic="false"` для release.
  - [x] `network_security_config` допускает только нужные HTTPS hosts.
  - [x] Debug cleartext/LAN не включены в базовую конфигурацию.

Acceptance criteria:

- [ ] APK выглядит как мобильная версия PWA.
- [ ] Keyboard не ломает login/chat/mail compose.
- [ ] Hardware back не закрывает приложение неожиданно из важных экранов.
- [ ] Release-like build не содержит dev server URL.

## Phase 2 - deep links

Цель: ссылки из уведомлений, почты и корпоративных каналов открывают нужный экран в APK и имеют web fallback.

- [ ] Описать route mapping.
  - [ ] `hubit://dashboard` -> `/dashboard`.
  - [ ] `hubit://tasks/{taskId}` -> `/tasks?task={taskId}`.
  - [ ] `hubit://chat/{conversationId}?message={messageId}` -> `/chat?conversation=...&message=...`.
  - [ ] `hubit://mail?message_id=...&mailbox_id=...` -> `/mail?...`.
  - [ ] `https://hubit.zsgp.ru/tasks?task=...` остается web-compatible.

- [ ] Добавить Capacitor App listener.
  - [ ] Новый frontend модуль вроде `src/lib/capacitorLinks.js`.
  - [ ] Listener `App.addListener('appUrlOpen', ...)`.
  - [ ] Использовать React Router v6 `navigate`, не старый `useHistory`.
  - [ ] Нормализовать и валидировать URL перед navigation.

- [ ] Добавить Android intent filters.
  - [ ] Custom scheme `hubit://`.
  - [ ] HTTPS App Links на production domain.
  - [ ] `android:autoVerify="true"` для HTTPS links.

- [ ] Разместить Digital Asset Links.
  - [ ] Сгенерировать SHA-256 fingerprint debug key.
  - [ ] Сгенерировать SHA-256 fingerprint release key.
  - [ ] Создать `assetlinks.json`.
  - [ ] Relation включает `delegate_permission/common.handle_all_urls`.
  - [ ] Разместить по `https://hubit.zsgp.ru/.well-known/assetlinks.json`.
  - [ ] Проверить, что URL отдает HTTP 200 и `Content-Type: application/json`, без redirect.

Acceptance criteria:

- [ ] `adb shell am start -a android.intent.action.VIEW -d "hubit://tasks/TASK_ID"` открывает нужную задачу.
- [ ] HTTPS App Link открывает APK, если он установлен.
- [ ] Тот же HTTPS URL открывает web, если APK не установлен.
- [ ] Невалидная ссылка не ломает приложение.

## Phase 3 - FCM push

Цель: Android background push работает через FCM, не дублируя существующий Web Push.

- [ ] Firebase setup.
  - [ ] Создать/выбрать Firebase project.
  - [ ] Добавить Android app с production `appId`.
  - [ ] Скачать `google-services.json`.
  - [ ] Положить `google-services.json` в app-level Android module, не коммитить секретные варианты без решения по безопасности.

- [ ] Android push client.
  - [ ] Установить `@capacitor/push-notifications`.
  - [ ] Запрашивать permission через `checkPermissions()` / `requestPermissions()`.
  - [ ] Учитывать Android 13+ runtime permission.
  - [ ] Регистрировать FCM token.
  - [ ] Отправлять token на backend.
  - [ ] При logout удалять/деактивировать token.
  - [ ] Обрабатывать notification tap и отправлять в deep-link mapper.

- [ ] Backend FCM model.
  - [ ] Добавить таблицу device tokens: user_id, token_hash/token, platform, app_version, device_label, last_seen_at, revoked_at.
  - [ ] Добавить endpoints: register, unregister, list/debug status.
  - [ ] Не смешивать FCM tokens с текущими Web Push endpoint subscriptions.
  - [ ] Добавить Firebase Admin/HTTP v1 sender с service account из env/secret storage.

- [ ] Routing and dedupe.
  - [ ] Payload содержит canonical route или deep link.
  - [ ] Chat push ведет в chat route.
  - [ ] Task/hub notification ведет в tasks/notification route.
  - [ ] Web Push отключается или не регистрируется при `VITE_PLATFORM=capacitor`.
  - [ ] Нет двойных уведомлений web+FCM на одном устройстве.

Acceptance criteria:

- [ ] Fresh install получает permission prompt.
- [ ] Token регистрируется на backend.
- [ ] Test push приходит при закрытом приложении.
- [ ] Tap по push открывает нужный экран.
- [ ] Logout деактивирует Android token.

## Phase 4 - files, camera and QR

Цель: сохранить текущие web flows, добавив native fallback только там, где WebView реально ломается.

- [ ] Files baseline.
  - [ ] Проверить текущие `<input type="file">`/FormData uploads в chat, mail, tasks, announcements.
  - [ ] Проверить upload больших файлов и chunk upload в chat.
  - [ ] Проверить download attachments из mail/chat/tasks.

- [ ] Native files fallback, если нужен.
  - [ ] Подключить file picker plugin.
  - [ ] Преобразовать выбранные файлы в объекты, совместимые с текущим upload API.
  - [ ] Сохранить web path без изменений для браузера/PWA.

- [ ] QR/camera baseline.
  - [ ] Проверить `html5-qrcode` в WebView.
  - [ ] Проверить camera permission.
  - [ ] Проверить фокус/torch на корпоративных моделях.

- [ ] Native QR fallback, если нужен.
  - [ ] Выбрать barcode scanner plugin.
  - [ ] Завернуть в thin adapter, чтобы страница Database не знала про plugin directly.
  - [ ] Сохранить web fallback.

Acceptance criteria:

- [ ] Chat file upload работает.
- [ ] Mail compose attachments работают.
- [ ] Task attachments работают.
- [ ] QR scan работает минимум на двух корпоративных Android-моделях.

## Phase 5 - passkey / trusted device

Цель: вернуть passkey convenience в APK без ослабления основного auth.

- [ ] Проверить текущий web passkey в APK после Phase 0.
  - [ ] `window.PublicKeyCredential` доступен.
  - [ ] `navigator.credentials.get()` работает или ожидаемо падает.
  - [ ] Ошибки отображаются понятным fallback на пароль/2FA.

- [ ] Если passkey не работает напрямую, добавить Android WebView Credential Manager integration.
  - [ ] Добавить `androidx.credentials`.
  - [ ] Добавить `androidx.credentials:credentials-play-services-auth`.
  - [ ] Добавить `androidx.webkit`.
  - [ ] Включить WebView web authentication support через WebKit API.
  - [ ] Проверять поддержку `WEB_AUTHENTICATION`.

- [ ] Расширить Digital Asset Links для credentials.
  - [ ] Добавить `delegate_permission/common.get_login_creds`.
  - [ ] Разместить на sign-in domain.
  - [ ] Убедиться, что backend `WEBAUTHN_RP_ID` и `WEBAUTHN_ORIGIN` соответствуют domain.

Acceptance criteria:

- [ ] Existing password/2FA login работает независимо от passkey.
- [ ] Passkey login работает на поддерживаемом Android/WebView.
- [ ] На неподдерживаемом устройстве пользователь видит fallback, а не тупик.

## Phase 6 - release build and internal distribution

Цель: воспроизводимая сборка подписанного APK и понятный процесс обновления.

- [ ] Release signing.
  - [ ] Создать release keystore.
  - [ ] Не коммитить keystore/passwords.
  - [ ] Описать хранение secrets.
  - [ ] Зафиксировать SHA-256 release fingerprint для App Links/passkey.

- [ ] Build script.
  - [ ] Добавить `scripts/build-android-apk.ps1`.
  - [ ] Скрипт собирает frontend, sync Capacitor, Gradle release APK.
  - [ ] Скрипт проверяет отсутствие `server.url` и cleartext в release config.
  - [ ] Скрипт выводит path к APK и version code/name.

- [ ] README.
  - [ ] `mobile-android/README.md`.
  - [ ] Prerequisites: Node, JDK, Android SDK, Gradle wrapper.
  - [ ] Debug build.
  - [ ] Release build.
  - [ ] Signing.
  - [ ] Internal install/update instructions.
  - [ ] Rollback instructions.

- [ ] Internal rollout.
  - [ ] Pilot group 3-5 users.
  - [ ] Test devices list.
  - [ ] Known limitations.
  - [ ] Support contact/channel.
  - [ ] Version update policy.

Acceptance criteria:

- [ ] Release APK installs on clean device.
- [ ] Upgrade over previous APK preserves expected app state.
- [ ] Rollback procedure documented.
- [ ] Internal user can install APK from agreed distribution channel.

## Regression checklist for every APK

- [ ] Login with password.
- [ ] Login with 2FA.
- [ ] Passkey/trusted-device fallback does not block login.
- [ ] Dashboard loads.
- [ ] Tasks list loads.
- [ ] Open task by direct URL/deep link.
- [ ] Chat conversation list loads.
- [ ] Send chat text message.
- [ ] Send chat file.
- [ ] Mail inbox loads.
- [ ] Read mail message.
- [ ] Compose/send mail with attachment.
- [ ] Database QR scanner opens and scans.
- [ ] Logout clears app session.
- [ ] App restart after logout stays logged out.
- [ ] App restart after active login keeps expected session behavior.
- [ ] Hardware back handles drawer/dialog/history.
- [ ] Push notification received in background.
- [ ] Push tap opens target route.
- [ ] No duplicate web+FCM notifications.
- [ ] Release APK does not call dev URLs.

## Decisions to fill in before implementation

- [ ] Production domain:
- [ ] API base URL:
- [ ] Android `appId`:
- [ ] Capacitor version:
- [ ] Auth model:
- [ ] Firebase project:
- [ ] Internal APK distribution method:
- [ ] Pilot device models:
- [ ] Minimum Android version:
- [ ] Release signing owner:

## Official references checked

- Capacitor configuration: https://capacitorjs.com/docs/config
- Capacitor Push Notifications: https://capacitorjs.com/docs/apis/push-notifications
- Capacitor Deep Links: https://capacitorjs.com/docs/guides/deep-links
- Android Credential Manager with WebView: https://developer.android.com/identity/sign-in/credential-manager-webview
- Android Credential Manager prerequisites / Digital Asset Links: https://developer.android.com/identity/credential-manager/prerequisites

## Implementation update - 2026-05-25 native features

- [x] Deep-link mapper added: `WEB-itinvent/frontend/src/lib/capacitorLinks.js`.
- [x] Android custom scheme added: `hubit://...`.
- [x] HTTPS App Link remains configured for `https://hubit.zsgp.ru`.
- [x] Push tap routing added through Capacitor `pushNotificationActionPerformed`.
- [x] Android FCM plugin added: `@capacitor/push-notifications`.
- [x] Android `POST_NOTIFICATIONS` permission and `hubit_default` notification channel metadata added.
- [x] Native runtime guard added: APKs without `google-services.json` skip FCM registration instead of crashing on Firebase initialization.
- [x] Debug APKs without `google-services.json` now exclude the native FCM Gradle module after `cap sync`, so Firebase code is not packaged until Firebase config exists.
- [x] Frontend native push client added: `WEB-itinvent/frontend/src/lib/nativePushNotifications.js`.
- [x] Backend native token endpoints added under `/api/v1/settings/notifications/native-push-*`.
- [x] Backend native token storage migration added: `20260525_0034_native_push_tokens`.
- [x] Backend FCM HTTP v1 sender added: `WEB-itinvent/backend/services/native_push_service.py`.
- [x] Camera permission declared for QR/WebView camera access.
- [x] Existing WebView file chooser flow preserved for chat/mail/task attachments.
- [x] Route crash fallback in APK can reload or open the current URL in a system browser.

Still required outside code:

- [ ] Add Firebase `google-services.json` to `mobile-android/android/app/`.
- [ ] Configure `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_FILE` or `FCM_SERVICE_ACCOUNT_JSON`.
- [ ] Run backend Alembic migrations on production app DB.
- [ ] Restart backend and chat push worker after FCM env changes.
- [ ] Verify token registration on a real Android device.
- [ ] Send a real background FCM test push and verify tap navigation.
- [ ] Verify QR camera, chat file upload, mail attachments and task attachments on real devices.
