# HUB-IT Mobile — план рабочего Android-прототипа

Статус документа: локальный кандидат 1.1.2 собран; production frontend содержит APK-only offline bridge и проходит post-check, feed APK 1.1.2 и ручная Android/FCM/EAS-приёмка ожидают отдельного шага  
Дата среза: 2026-08-22  
Клиент: `mobile-hub/` (Expo / React Native, только Android)  
Канал первого прототипа: внутренний standalone APK, без публикации в Google Play

## 0. Фактический статус реализации

- [x] Expo обновлён 52 → 53 → 54 → 55 → 56 → 57; React Native обновлён до 0.86.2.
- [x] Реализованы нативные Auth/2FA/session lifecycle, native push lifecycle и полноэкранный responsive web shell; прежние Главная, Задачи, Chat и Настройки сохранены как резервный контур.
- [x] Добавлены 54 мобильных регрессионных теста в 18 наборах; TypeScript, Expo dependency check и `expo-doctor` 21/21 проходят после финальной сборки.
- [x] Локально собран автономный `mobile-hub/dist/hubit-mobile-preview.apk`, версия `1.1.2`, `versionCode` 4, target SDK 36; опубликованный feed пока указывает на 1.1.1.
- [x] APK проверен через `aapt`, `apksigner` и просмотр содержимого; SHA-256 зафиксирован.
- [ ] EAS build ID и release-подпись — config hook `EXPO_EAS_PROJECT_ID` и fail-fast preflight готовы, но нужны фактический EAS project UUID, credentials и `EXPO_TOKEN`/login.
- [ ] Clean/upgrade install и сценарии на Android 13+/эмуляторе — Platform-Tools 37.0.1 и `adb devices -l` работают, но подключённых устройств нет. Локальный emulator 37.1.11 с API 36 x86_64 проверен: QEMU2 завершается с `0xc0000005`, потому что VMware-гостю не доступны firmware virtualization, SLAT и VM monitor extensions; classic engine отсутствует, а ARM64 image не поддерживается на x86_64 host. Тестовые emulator/image/AVD после диагностики удалены.
- [ ] Реальный background FCM и два устройства — read-only runtime status: PostgreSQL storage и project ID доступны, но backend service account отсутствует (`configured=false`, `enabled=false`); также нужен Firebase client config вне Git.
- [x] Полный профильный backend regression: 109/109 тестов auth, tasks и Chat push прошли после исправления native-only push-outbox.
- [x] Полный `pytest -q tests` выполнен: 3104 passed, 3 skipped, 70 failed, 44 errors; общая suite не зелёная из-за широкого набора сбоев вне профильной проверки, их причины требуют отдельных задач.
- [x] Интерфейс нативного ядра приведён к готовому responsive WEB-интерфейсу: общий visual language, нижняя навигация, Dashboard, Tasks, Chat и Settings; браузерный smoke пройден на 360×800, 390×844 и 412×915, включая стресс-проверку масштаба текста 125%.
- [x] Зафиксирована page-by-page матрица 40 фактических web-маршрутов; встроенная оболочка использует тот же frontend и permission gates без внешнего браузера и повторного входа.
- [x] Android print/download bridge для полноэкранного WebView собран и опубликован в production frontend; live mail chunk содержит `hubit.portal.print`, HTTP canonical redirect и login-mode API прошли post-check.
- [x] Полный frontend regression зелёный: 532/532 файла, 3 099 passed, 2 skipped.
- [x] В кандидате 1.1.2 добавлен добровольный вход по отпечатку после 2FA; холодный запуск требует локальную биометрическую разблокировку, а `401/403` отключает локальный credential.
- [x] WebView использует верхнюю safe-area, скрывает нижнюю Android navigation bar и меняет доступную высоту при открытии клавиатуры для всех web-полей, включая Chat, почту, задачи и настройки.
- [x] Реализован APK-only зашифрованный offline-кэш ранее загруженных GET-данных с режимом только чтения; обычная PWA не получает native marker и сохраняет прежнее поведение.
- [x] Кандидат `1.1.2` / `versionCode 4` собран локально: mobile 18/18 наборов, 54/54 теста; frontend 532/532 файла, 3 099 passed, 2 skipped; Expo Doctor 21/21.
- [ ] На реальном Android проверить отпечаток, status/navigation bars, клавиатуру в Chat/почте/задачах и offline cold start; подключённых ADB-устройств на build host нет.
- [x] Production frontend содержит `__HUBIT_MOBILE_OFFLINE_SESSION__`; live index SHA-256 совпадает с active IIS, HTTP canonical redirect и HTTPS `/`/`login-mode` прошли post-check.
- [x] Добавлена build-защита canonical host: обычный Vite build подставляет `hubit.zsgp.ru`, а IIS publish-скрипт принимает только marker либо ожидаемый redirect. Изолированная production-сборка прошла.

Подробный протокол, SHA-256 и точные ограничения: [MOBILE_HUB_PROTOTYPE_ACCEPTANCE.md](./MOBILE_HUB_PROTOTYPE_ACCEPTANCE.md).

## 1. Цель

Довести существующий мобильный клиент до прототипа, которым сотрудник может ежедневно пользоваться в основных сценариях HUB-IT:

1. Установить APK на Android.
2. Войти по логину и паролю, включая 2FA.
3. Увидеть корректную главную и свои задачи.
4. Открыть задачу, прочитать детали и выполнить разрешённое сервером действие.
5. Работать в Chat в реальном времени, отправлять текст и вложения.
6. Получать push о новых сообщениях.
7. Изменить профильные настройки и безопасно выйти из приложения.

Прототип должен работать после холодного запуска, истечения access-токена, потери сети, перехода приложения в фон и возврата на экран.

Расширение цели от 2026-08-22: приложение должно показывать не ограниченный набор нативных экранов, а полный responsive web-интерфейс HUB-IT страницу за страницей. Фактический каталог из 40 маршрутов и критерии приёмки вынесены в [MOBILE_HUB_WEB_PARITY_MATRIX.md](./MOBILE_HUB_WEB_PARITY_MATRIX.md).

Чтобы дизайн и поведение оставались точной копией web, основным Android-интерфейсом становится полноэкранный WebView существующего frontend. Native Auth/SecureStore передаёт сессию через одноразовый 60-секундный server-side bridge в HttpOnly cookies; access/refresh не инжектируются в DOM, localStorage или URL.

## 2. Что входит в прототип

### Нативное ядро

- Auth: login, обязательная настройка 2FA через web, TOTP/backup code, refresh, logout.
- Главная: корректные счётчики задач, просрочки и быстрые переходы.
- Задачи: список, карточка, комментарии и действия по `task.capabilities`.
- Chat: список диалогов, thread, realtime, unread, файлы/фото, реакции, пересылка и удаление.
- Push: регистрация отдельного Android-устройства, доставка в фоне, переход в нужный диалог.
- Настройки: профиль, аватар, смена пароля, состояние уведомлений, logout.

### Исторические ограничения первого прототипа

- iOS.
- Публикация и модерация в Google Play.
- Полный нативный перенос почты, билетов, базы оборудования, сетей, AD, ВКС, МФУ, Scan Center, статистики и базы знаний.
- Passkey/WebAuthn в нативном UI.
- Тёмная тема.
- Администрирование групп Chat и chunked upload больших файлов.

Для web-разделов оставить один явно подписанный переход «Открыть полную web-версию». Не показывать 12 заглушек как равноправные нативные экраны.

Эти ограничения больше не являются целевым состоянием: web fallback заменяется встроенной полноэкранной оболочкой, которая использует те же responsive страницы и permission gates. Нативные Dashboard/Tasks/Chat остаются как резервный код до завершения device-приёмки, но основной Android-маршрут после входа — web shell.

## 3. Критерий готовности

Рабочий прототип считается готовым только когда одновременно выполнено всё ниже:

- [ ] Собран `EAS preview` APK с зафиксированными build ID, версией и `versionCode`.
- [ ] APK установлен с нуля минимум на один реальный Android 13+ и на эмулятор с актуальным API.
- [ ] Пройдена матрица auth: login, 2FA, refresh, cold start, logout, повторный login.
- [ ] Главная показывает значения из актуального backend-контракта, без ложных `—`.
- [ ] Задачи открываются из списка; capability-действия и комментарии проверены минимум для исполнителя и контролёра.
- [ ] Два аккаунта обмениваются сообщениями A→B и B→A без pull-to-refresh.
- [ ] Reconnect Chat работает после 30–60 секунд без сети и после возврата из фона.
- [ ] Push приходит в фоне и открывает нужный диалог.
- [ ] После logout WebSocket закрыт, reconnect остановлен, push-токен устройства отозван, SecureStore не содержит access/refresh токены.
- [x] Мобильные unit/integration-тесты, TypeScript-проверка и затронутые backend-тесты зелёные.
- [x] В отслеживаемых мобильных файлах и APK-артефакте не обнаружены токены, Firebase credentials и другие секреты.
- [x] Документация запуска и фактический статус чек-листа обновлены.
- [x] Основные экраны визуально и навигационно проверены на 360×800, 390×844 и 412×915 без корневого горизонтального переполнения; отдельно проверен масштаб текста 125% на 360×800.

## 4. Порядок реализации

### Этап 0 — зафиксировать baseline и не смешать изменения

Цель: получить воспроизводимую точку сравнения до исправлений.

- [x] Сохранить вывод `git status --short --branch`; не включать посторонние изменения монорепозитория.
- [x] Зафиксировать текущие версии Node, Expo, React Native и Android SDK.
- [x] Выполнить `npm run lint` и `npx expo install --check`.
- [x] Попытаться собрать текущий development/preview APK без изменения production.
- [x] Записать фактические ошибки сборки и короткий smoke текущего клиента, если он запускается.
- [ ] Для каждого следующего этапа использовать отдельный небольшой commit; push выполняется только по отдельной просьбе.

Выход: есть baseline типов, зависимостей, сборки и запуска на Android.

### Этап 1 — обновить платформу и сделать сборку воспроизводимой

Цель: убрать зависимость от устаревшего Expo SDK 52 и получить поддерживаемый Android build.

- [x] Обновлять Expo последовательно: 52 → 53 → 54 → 55 → 56 → 57, проверяя release notes каждого шага.
- [x] После каждого шага запускать `npx expo install --fix`, `npx expo-doctor` и `npm run lint`.
- [x] Синхронизировать `react-native`, `@expo/vector-icons`, React Navigation и остальные Expo-пакеты с целевым SDK.
- [x] Убрать ручные Kotlin/Gradle patches, которые больше не нужны на целевом SDK; оставлять только подтверждённо необходимые.
- [x] Установить `compileSdkVersion`/`targetSdkVersion` 36 для возможности последующей публикации.
- [x] Добавить `expo-notifications` config plugin.
- [x] Настроить package/version/`versionCode`; хранение credentials предусмотрено вне Git.
- [x] Подготовить `extra.eas.projectId` через `EXPO_EAS_PROJECT_ID` и останавливать non-interactive EAS build до генерации assets, если UUID отсутствует.
- [ ] Связать приложение с фактическим EAS project UUID и настроить EAS credentials.
- [x] Собрать development/debug APK повторяемым локальным скриптом.
- [ ] Проверить холодный запуск development/debug APK на Android.

Файлы: `mobile-hub/package.json`, `package-lock.json`, `app.config.ts`, `eas.json`, `babel.config.js`, `metro.config.js`, `scripts/build-apk.ps1` — только при подтверждённой необходимости.

Выход: development APK собирается повторяемо и запускается на Android.

### Этап 2 — тестовый контур мобильного клиента

Цель: следующие исправления должны иметь автоматическую защиту от регрессий.

- [x] Подключить версии `jest-expo` и React Native Testing Library, совместимые с целевым Expo SDK.
- [x] Добавить scripts `test`, `test:watch` и `test:ci`.
- [x] Создать общий mock SecureStore, API client, Expo Router, Notifications и WebSocket.
- [x] Не использовать production API в автоматических тестах.

Минимальный набор тестов:

- [x] mapping ответа `/hub/dashboard`;
- [x] одиночный refresh при нескольких параллельных 401;
- [x] окончательный refresh failure → очистка сессии и login;
- [x] WebSocket connect/reconnect/explicit disconnect;
- [x] logout закрывает socket и отзывает push-токен;
- [x] фильтрация навигации по permissions;
- [x] capability-действия задачи;
- [x] deduplication входящих Chat-сообщений.

Выход: P0-сценарии можно проверять без реального устройства.

### Этап 3 — исправить auth и lifecycle приложения

Цель: приложение не остаётся в ложной авторизованной сессии и не продолжает фоновые подключения после выхода.

- [x] В `api/client.ts` обрабатывать исключение refresh: очищать токены и публиковать единое событие `sessionExpired`.
- [x] В `AuthContext` реагировать на `sessionExpired`: сбрасывать `user`, challenge и возвращать login guard.
- [x] Исключить refresh-loop для `/auth/refresh`, `/auth/logout` и повторённого запроса.
- [x] Сохранить single-flight refresh для параллельных 401.
- [x] Добавить явный lifecycle WebSocket: `connect`, `suspend`, `resume`, `disconnect({ reconnect: false })`.
- [x] Не планировать reconnect после явного logout.
- [x] Учитывать React Native `AppState`: в фоне не создавать бесконечные reconnect-циклы, после resume восстанавливать актуальные подписки.
- [x] На logout сначала закрыть Chat, затем отозвать push-токен, вызвать backend logout и очистить SecureStore даже при сетевой ошибке.
- [x] Сохранять стабильный `client_device_id`; access/refresh токены удалять, installation ID не удалять.

Файлы: `src/api/client.ts`, `src/auth/AuthContext.tsx`, `src/auth/tokenStore.ts`, `src/chat/chatSocket.ts`, `app/_layout.tsx`.

Выход: token expiry, cold start, background/resume и logout проходят автоматические и ручные проверки.

### Этап 4 — рабочая главная и задачи

Цель: получить законченный ежедневный task-сценарий вместо read-only списка.

#### Главная

- [x] Типизировать фактический ответ `/hub/dashboard` (`summary`, `my_tasks`, `unread_counts`).
- [x] Читать `summary.tasks_open_total` и `summary.tasks_overdue`, не старые поля корня.
- [x] Не показывать KPI билетов, пока backend не предоставляет подтверждённое значение.
- [x] Добавить loading, empty, error и retry состояния.

#### Задачи

- [x] Расширить `hubApi.ts` или выделить `taskApi.ts`: list, get, comments, mark-seen, start, submit, review, complete, reopen.
- [x] Добавить route `app/(main)/tasks/[taskId].tsx`.
- [x] В списке показать статус, приоритет, срок, роль пользователя и unread comments.
- [x] В карточке показать описание, участников, сроки, вложения, комментарии и status log в объёме прототипа.
- [x] Строить доступные действия только по `task.capabilities` от backend (`can_start`, `can_submit`, `can_review`, `can_close`, `can_reopen`).
- [x] После mutation точечно обновлять карточку и соответствующую строку списка.
- [x] Для 409/412 показывать понятный конфликт и перечитывать актуальную задачу.
- [x] Не реализовывать создание/редактирование задачи до закрытия просмотра и workflow.

Backend уже предоставляет нужные маршруты `/hub/tasks/{id}`, `/start`, `/submit`, `/review`, `/complete`, `/reopen`, `/comments`; новый endpoint не добавлять без доказанного пробела.

Файлы: `src/api/hubApi.ts` или новый `src/api/taskApi.ts`, `app/(main)/dashboard.tsx`, `app/(main)/tasks.tsx`, новый task-detail screen и профильные компоненты/тесты.

Выход: исполнитель и контролёр проходят основной жизненный цикл задачи с телефона.

### Этап 5 — стабилизировать Chat и push

Цель: realtime и уведомления работают как единый сценарий, включая фон и несколько устройств.

#### Chat

- [x] Показывать состояние соединения: подключение, offline, reconnect, ошибка с retry.
- [x] Обновлять список диалогов без полного refetch на каждое событие, где хватает локального update.
- [x] Проверить ordering и deduplication `chat.message.created` после reconnect.
- [x] Проверить unread и `markConversationRead` после входящего сообщения на открытом thread.
- [x] Добавить ошибку загрузки и retry в список диалогов и thread.
- [ ] Проверить отправку текста, фото, файла, реакцию, пересылку и удаление.
- [x] Оставить chunked upload и управление участниками вне прототипа.

#### Push

- [x] Добавить `android.googleServicesFile` через защищённую конфигурацию; `google-services.json` не коммитить.
- [x] До запроса токена создать Android notification channel `hubit_default`.
- [x] Использовать реальный стабильный installation/client device ID, а не `android-${userId}`.
- [x] Сохранять зарегистрированный FCM token локально для корректного DELETE при logout/token rotation.
- [x] Обрабатывать `addPushTokenListener` и заменять токен на backend при rotation.
- [x] Проверять ответ backend `configured/push_enabled`; не показывать успех при отказе permission или выключенном FCM.
- [x] Добавить обработчик foreground notification и переход по payload в `/(main)/chat/{conversationId}`.
- [x] Закрепить mobile push lifecycle тестами rotation, disabled runtime, denied permission и logout revoke/cleanup (4/4).
- [x] Закрепить backend-инвариант native push: разные `device_id` одного пользователя остаются активны одновременно, rotation отзывает только прежний токен того же устройства (2/2 изолированных теста).
- [ ] Проверить два телефона одного пользователя: регистрация второго не должна отключать первый.

Backend production-конфигурацию `FCM_*`, PostgreSQL storage и delivery проверять read-only. Любое изменение `.env`, PM2 или production требует отдельного разрешения.

Файлы: `app.config.ts`, `app/_layout.tsx`, `app/(main)/settings.tsx`, `src/api/chatApi.ts`, `src/chat/chatSocket.ts`, новые `src/notifications/*` и тесты.

Выход: realtime и background push подтверждены на реальном Android.

### Этап 6 — привести навигацию и UX к честному прототипу

Цель: пользователь понимает, что нативно, а что открывается в web.

- [x] Повторить responsive WEB-shell: нижний bar «Главная», «Задачи», «Чат», «Настройки» и активная icon capsule.
- [x] Добавить вкладку «Ещё» с одним честным переходом «Полная web-версия» для остальных модулей.
- [x] Явно предупреждать о переходе в системный браузер и возможном отдельном web-login.
- [x] Проверить layout на ширинах 360, 390 и 412 px и при крупном шрифте.
  - Playwright проверил Dashboard, Tasks, Chat и Settings в 16 сценариях: три ширины и отдельный стресс масштаба текста 125% на 360 px. Корневого переполнения, обрезанных вкладок, неподписанных icon-only controls и целей касания меньше 40 px не найдено.
  - По результату исправлены адаптивная высота нижней навигации, безопасный масштаб её подписей и полноширинное размещение email/роли в профиле.
- [ ] Проверить системные inset и реальный Android `fontScale` на устройстве.
- [x] Реализовать keyboard avoidance в native login/2FA и общем WebView-контейнере для всех web-полей.
- [ ] Подтвердить keyboard avoidance, safe-area и скрытие navigation bar на реальном Android в Chat, почте, задачах и настройках.
- [x] Добавить доступные labels к icon-only controls и достаточные touch targets.
- [x] Заменить временную иконку `H` и splash на согласованные HUB-IT assets.
- [x] Обновить русские тексты ошибок через единый `formatApiError`.

Выход: прототип не маскирует web-ссылки под нативные функции и пригоден для демонстрации сотрудникам.

### Этап 7 — APK и приёмочный smoke

Цель: подтвердить не только сборку, но и поведение установленного приложения.

- [x] Собрать локальный standalone preview APK с production API URL и встроенным JS bundle.
- [ ] Собрать `EAS preview` APK с production API URL.
- [ ] Зафиксировать EAS build ID, имя APK, SHA-256, версию приложения и `versionCode`.
- [ ] Установить APK поверх предыдущей версии и отдельно выполнить clean install.
- [ ] Проверить Wi‑Fi, мобильную сеть, offline/reconnect и фон более 15 минут.
- [ ] Выполнить smoke двумя аккаунтами и, для push, двумя устройствами.
- [ ] Снять только обезличенные логи без токенов и содержимого сообщений.
- [x] Заполнить итоговый протокол проверки: артефакт, автоматические сценарии, фактические блокеры и незапущенную device-матрицу.
- [x] Обновить `MOBILE_HUB_CHECKLIST.md`, `mobile-hub/README.md` и этот план по факту.

Выход: все критерии раздела 3 подтверждены фактическим прогоном.

## 5. Проверки по этапам

### Локальные проверки

```powershell
cd C:\Project\Image_scan\mobile-hub
npm run lint
npm run test:ci
npx expo-doctor
```

После изменений backend запускать только узкие тесты затронутого контракта, например:

```powershell
cd C:\Project\Image_scan
pytest -q tests/test_auth_mobile_delivery.py tests/test_hub_tasks.py
```

Точный набор Chat/push backend-тестов определяется по фактически изменённым backend-файлам. Полный `pytest -q tests` нужен перед признанием прототипа готовым, но не заменяет Android smoke.

### Матрица ручной проверки

| Область | Сценарий | Ожидаемый результат |
|---|---|---|
| Auth | Неверный пароль | Понятная ошибка, токены не записаны |
| Auth | Login + TOTP/backup | Пользователь попадает на разрешённый первый экран |
| Auth | Истёк access token | Один refresh, исходный запрос повторён один раз |
| Auth | Истёк/отозван refresh | SecureStore очищен, показан login |
| Lifecycle | Background/resume | UI и Chat восстанавливаются без дублей |
| Logout | Активный Chat + push | Socket закрыт, push token отозван, возврат на login |
| Dashboard | Есть открытые/просроченные задачи | KPI совпадают с `/hub/dashboard.summary` |
| Tasks | Исполнитель | Видит только разрешённые capability-действия |
| Tasks | Контролёр | Approve/reject меняют статус, конфликт перечитывается |
| Chat | A→B и B→A | Сообщения появляются без pull-to-refresh |
| Chat | Offline 30–60 сек | После сети reconnect без дублей и потери thread |
| Push | Приложение в фоне | Уведомление приходит и открывает нужный диалог |
| Push | Два устройства | Оба устройства остаются зарегистрированными |
| Web fallback | Открытие полного HUB-IT | Есть предупреждение, маршрут корректный |

## 6. Риски и ограничения

- Обновление Expo через пять SDK может потребовать адаптации React Navigation, Notifications и native build scripts. Каждый SDK-шаг должен быть отдельным проверяемым изменением.
- Текущий Git worktree содержит изменения других подсистем; мобильные commits нельзя собирать через общий `git add -A`.
- Успешный TypeScript/build не подтверждает auth, WebSocket, push и поведение конкретного Android-устройства.
- Firebase client config и backend service account относятся к секретам и не должны попадать в Git или отчёты.
- Проверка production API/IIS допустима read-only; restart, `.env`, PM2, IIS и deployment выполняются только после отдельного разрешения.
- Если prototype распространяется только внутренним APK, Google Play не является блокером приёмки, но target API 36 всё равно сохраняется как техническая цель.

## 7. Рекомендуемая последовательность commits

1. `mobile: upgrade Expo one SDK step` — повторить отдельными commits для каждого SDK.
2. `mobile: add test harness and baseline tests`.
3. `mobile: fix auth refresh and logout lifecycle`.
4. `mobile: make chat socket lifecycle explicit`.
5. `mobile: align dashboard with backend contract`.
6. `mobile: add task detail and capability actions`.
7. `mobile: complete FCM registration and logout cleanup`.
8. `mobile: simplify native navigation and web fallback`.
9. `mobile: finalize branding and prototype documentation`.

Порядок может дробиться дальше, но нельзя объединять SDK upgrade, auth lifecycle, task workflow и push в один большой commit.

## 8. Отдельные действия перед production

Эти действия не входят в обычную реализацию и требуют явного разрешения:

- настройка Firebase project/package и получение client config;
- изменение production `FCM_*` и других `.env` параметров;
- restart backend/chat процессов;
- изменение IIS/WebSocket proxy;
- deployment backend или frontend;
- публикация APK/AAB сотрудникам или в Google Play.

Перед каждым таким действием нужны точная цель, rollback и post-check.
