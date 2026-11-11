# HUB-IT Mobile — приёмка рабочего Android-прототипа

Дата: 2026-08-23  
Статус: preview APK 1.1.6 собран, прошёл автоматический аудит и опубликован. Приёмка на реальном Android и адресная FCM-проверка ещё не выполнены. EAS исключён из выбранного контура: сборка выполняется локально.

## Артефакт

| Параметр | Значение |
|---|---|
| Файл | `mobile-hub/dist/hubit-mobile-preview.apk` |
| Тип | локальный standalone release/preview APK, внутреннее тестирование |
| Размер | 50 364 083 байта |
| SHA-256 | `2D0BB666DA908FF9EA4C715F3D0C7D60847339FF11E1A57372A2A8D8599FB476` |
| Package | `ru.zsgp.hubit.mobile` |
| Версия | `1.1.6` |
| `versionCode` | `8` |
| min/target/compile SDK | 24 / 36 / 36 |
| ABI | arm64-v8a, armeabi-v7a |
| Подпись | APK Signature Scheme v2, совместимый Android Debug certificate (`debug-preview`) |
| JS runtime | `assets/index.android.bundle` присутствует; Metro не требуется |
| EAS build ID | отсутствует: локальная сборка, EAS credentials не предоставлены |

Локальная debug-подпись подходит только для совместимого внутреннего обновления поверх 1.1.3. Для стабильного внутреннего канала нужен один постоянный release keystore вне Git; EAS для этого не требуется.

Дополнительно собран development/debug APK `mobile-hub/dist/hubit-mobile-debug.apk`: 224 102 849 байт, SHA-256 `C6FF507C2991101464A1094DD354B67CB8E3C1E1CDD9544D2A3F02CD82F3C82C`. Package/version/SDK и подпись v2 подтверждены; встроенного `assets/index.android.bundle` нет, поэтому для запуска debug-варианту нужен Metro.

## Автоматические проверки

| Проверка | Фактический результат |
|---|---|
| `npm run lint` | успешно, TypeScript без ошибок |
| `npm run test:ci` | 63 suites, 206/206 тестов прошли на итоговом source 1.1.6, включая native Chat, typing render-count, Android shortcuts и accessibility regression |
| frontend APK feed regression | 2 файла, 19/19 тестов: schema v1/v2, fail-closed поля manifest и состояния download/unavailable; production build прошёл, live `/login` показывает ссылку APK 1.1.6 |
| профильные backend push/notification тесты | 63/63 успешно: app/chat outbox, native FCM, Chat push, Hub announcements, mail notification, status API и Web Push delivery |
| `npx expo install --check` | dependencies up to date |
| `npx expo-doctor` | 21/21 checks passed |
| изолированный Vite build в `build/hubit-frontend-verify-1-1-2` | 15 696 модулей, `vite build` успешно за 48,69 с; `web.config` содержит `hubit.zsgp.ru`, marker отсутствует; остаются только предупреждения о чанках больше 500 kB |
| полный frontend regression | 532/532 test files прошли; 3 099 тестов прошли, 2 штатно пропущены |
| canonical build guard | 5/5 тестов прошли; Vite подставляет безопасный default/override, отклоняет невалидный или конфликтующий redirect, IIS publish проверяет ожидаемый host |
| production frontend post-check | live index SHA-256 `BC51EBF8AC3064547070FF0D14F9AAB1C0B7BF97D89E83B88723E71305571394` совпал с active IIS; bundle содержит `__HUBIT_MOBILE_OFFLINE_SESSION__`; HTTP redirect ведёт на `https://hubit.zsgp.ru/`, HTTPS `/` и `/api/v1/auth/login-mode` вернули 200 |
| focused web tests страниц 1–10 | 8 файлов: 178 тестов прошли, 2 пропущены; подтверждены Login/2FA, SharedFile, Dashboard, Tasks mobile, Tickets list, Chat deep link/mobile navigation и Mail mobile fullscreen |
| focused web tests страниц 11–20 | 10 файлов: 129/129 тестов прошли; подтверждены Docflow, Address Book, Company Structure, Passwords, Groups Access, My Files и Database mobile. Networks и VCS не имеют прямых page-тестов и остаются на ручную приёмку |
| focused web tests страниц 21–30 | 13 файлов: 80/80 тестов прошли; подтверждены Computers, Scan Center, Knowledge Base, Warehouse 1C, Mobile Menu, Profile и Account/Settings. Для МФУ, DLP/File Egress и верхнего уровня Statistics пока выполнена только статическая проверка responsive-кода и тесты вложенных компонентов |
| focused web tests страниц 31–40 | 8 файлов: 47/47 тестов прошли; подтверждены Notifications, App/About, AD Users и AI Bots. Security, Users, Departments, Sessions и System используют общий адаптивный AccountWorkspace, но не имеют отдельных полностраничных тестов |
| итого по каталогу страниц 1–40 | 39 файлов: 434 теста прошли, 2 пропущены; ручные Android/WebView-сценарии этим результатом не заменяются |
| профильные web-тесты Chat/Mail/Tasks | 9 файлов: 284 теста прошли, 2 пропущены; проверены mobile chat, mail fullscreen/compose и полный mobile task workflow |
| объединённый backend-набор auth/chat/mail/tasks | 218/218 тестов прошли; chat read/write fixtures синхронизированы с deferred delivery-state |
| production bootstrap post-check | `GET https://hubit.zsgp.ru/api/v1/auth/mobile-web-session/bootstrap` вернул 200 HTML с `Cache-Control: no-store`, nonce CSP и consume route; неавторизованный create возвращает 401, пустой consume — 422 |
| `npm run build:apk:local:compat` | финальный clean prebuild и release-вариант `BUILD SUCCESSFUL` за 14 мин 44 с; 607 Gradle-задач; APK 1.1.6 содержит production JS bundle и нативный Chat |
| `scripts/mobile/publish-apk.ps1 -ValidateOnly` | schema v2 manifest-кандидат сформирован без записи в IIS: package/version/code, размер, APK hash и signer hash совпали с audit JSON |
| публикация и внешний post-check | preview feed атомарно обновлён до 1.1.6; manifest и APK вернули 200, MIME/размер/SHA-256 совпали, `verified=true` |
| `npm run build:apk:local:debug` | `BUILD SUCCESSFUL` за 11 мин 53 с; 458 Gradle-задач: 218 выполнены, 240 up-to-date; debug APK создан |
| `aapt dump badging/permissions/xmltree` | package/version/SDK/launchable activity подтверждены; FCM service, TaskManager boot receiver, WorkManager job service и `RECEIVE_BOOT_COMPLETED` присутствуют; cleartext отключён, `RECORD_AUDIO` и `SYSTEM_ALERT_WINDOW` отсутствуют |
| `apksigner verify` | подпись v2 валидна, один signer |
| проверка содержимого APK | встроенный `assets/index.android.bundle` найден; bundle содержит `__HUBIT_MOBILE_OFFLINE_SESSION__`, `biometric-opt-in`, `LOAD_CACHE_ELSE_NETWORK`, `/portal` и session bootstrap; `RNCWebViewPackage` присутствует в APK |
| secret/artifact screening | tracked secret/config/key files не найдены; `.env.example` содержит только публичный API URL; `android/`, `dist/`, Gradle caches и credentials игнорируются |
| `npm audit --omit=dev` | 0 critical, 0 high, 44 moderate в текущем Expo dependency graph; цепочка ведёт к `xcode → uuid`, для advisory исправление пока недоступно |
| Playwright Expo Web | Dashboard, Tasks, Chat и Settings прошли 16 сценариев на 360×800, 390×844 и 412×915, включая масштаб текста 125% на ширине 360 px; корневого переполнения, обрезанных вкладок, неподписанных icon-only controls и целей касания меньше 40 px нет |
| Android Platform-Tools / emulator | `adb devices -l` работает, устройств нет. Ранее emulator 37.1.11 + API 36 x86_64 падал с `0xc0000005` без nested virtualization; после диагностики emulator binary, system image и AVD удалены |
| device acceptance harness | `scripts/device-smoke.ps1` проверяет install/version/API 33+, launch/deep-link/resume и в interactive-режиме фиксирует biometric, подготовку offline-списков, cache miss/recovery, Android validated network, app-specific battery settings, 20 lifecycle-циклов, keyboard, system bars, Chat/tasks/mail/push; schema v2 использует явные `passed/failed/not_run` и не собирает serial, credentials, token, message content, logcat, SSID, IP или оператора |

`npm audit` возвращает ненулевой код из-за moderate advisory в транзитивной Expo/tooling-цепочке `xcode → uuid`. Автоматический force-upgrade не применялся: upstream fix недоступен, зависимости согласованы с Expo SDK 57, а `expo-doctor` и `expo install --check` проходят.

## Проверка backend-контрактов

Запущены 109 профильных тестов auth, tasks и Chat push — все 109 прошли.

Изолированный native FCM-набор расширен до 5/5: два `device_id` одного пользователя остаются активными, rotation отзывает только прежний токен устройства, а Chat/Tasks payload фиксирует channel, TTL, collapse key, package и владельца. Реальная доставка на два телефона остаётся отдельным device smoke.

После добавления защищённого mobile→WebView session bridge отдельно запущен полный auth-набор: 93/93 теста прошли; новый файл `test_auth_mobile_web_session.py` содержит 6 проверок одноразовости, совпадения access/refresh proof, безопасного target path, CSP/no-store bootstrap и HttpOnly cookies.

Полный `pytest -q tests` также доведён до конца: 3104 тестов прошли, 3 пропущены, 70 завершились ошибкой проверки и 44 — ошибкой окружения/fixture. Общий набор репозитория не зелёный; сбои распределены по agent, appdb, Chat, docflow, network maps, PostgreSQL 1C, Scan и tickets. Их принадлежность текущим изменениям не установлена, поэтому вне профильного набора они не исправлялись попутно.

Устранена реальная регрессия durable push-outbox: orchestrator больше не отбрасывает пользователя только из-за отсутствия browser push subscription. Для каждого получателя с разрешёнными уведомлениями создаётся outbox job, а worker уже выбирает доступные Web Push и/или native FCM subscriptions. Это сохраняет пользовательские notification preferences и возвращает доставку native-only устройствам.

Для остальных источников добавлена отдельная `app.push_outbox`: Hub-задачи/объявления, почта и системные уведомления теперь сначала фиксируются в app-БД, дедуплицируются и только затем доставляются worker-ом. Временные ошибки повторяются с exponential backoff, зависшие jobs восстанавливаются, просроченные по TTL не отправляются, а backlog доступен в native-push status и runtime metrics. Миграция `20260822_0101` локально проверена; в production она не применялась.

## Что реализовано в мобильном клиенте

- Expo последовательно обновлён с SDK 52 до SDK 57; React Native — до 0.86.2, target/compile SDK — 36.
- Auth/session: single-flight refresh, защита от refresh loop, единое истечение сессии, стабильный device ID, безопасный logout и очистка SecureStore.
- После успешного 2FA приложение предлагает добровольно включить вход по отпечатку. Online-вход подтверждает серверную сессию, 401/403 удаляет local credential; offline допускает только биометрически разблокированный read-only режим.
- Ранее загруженные GET-ответы шифруются AES-GCM ключом из защищённого SecureStore; access/refresh tokens не передаются в WebView, мутации без сети блокируются, обычная PWA остаётся без native cache marker.
- Safe-area и keyboard avoidance применяются к portal WebView и нативному экрану Chat; Android navigation bar запрашивается скрытой.
- После пароля, 2FA и холодного старта Android открывает защищённый responsive web-портал. При включённом `EXPO_PUBLIC_NATIVE_CHAT_ENABLED` маршруты `/chat` перехватываются нативным React Native интерфейсом с теми же REST/WebSocket контрактами; Mail, Mail Compose, Tasks и остальные бизнес-разделы остаются web-маршрутами.
- AppState/Chat: suspend/resume, явный disconnect без reconnect после logout, статус соединения, retry, ordering/deduplication.
- Главная читает фактический `/hub/dashboard.summary` и честно показывает нулевые значения.
- Задачи имеют список, карточку, комментарии, mark-seen и действия только по `task.capabilities`; конфликт 409/412 перечитывает актуальное состояние.
- Chat использует реальные REST/WebSocket endpoints, поддерживает текст, файлы/фото, реакции, пересылку, удаление с серверным tombstone и поиск; update/delete-события применяются точечно без полного refetch.
- Native push создаёт Android channels до запроса токена, учитывает backend runtime state и token rotation/revoke. Ответ/`Прочитано` обрабатываются module-scope task без открытия приложения; временная сеть сохраняет текст в SecureStore и повторяет его через WorkManager или кнопку уведомления.
- Blob-download bridge сохраняет сформированные web-клиентом отчёты и вложения до 20 МБ через системный выбор папки Android; это закрывает скачивание для Tasks, Database, Networks, Statistics, Scan Center, Warehouse 1C, почты и других страниц, использующих `blob:` URL. Большие файлы пока требуют браузер и ручную Android-проверку.
- Основная навигация приведена к responsive web: нижний bar высотой 64 px при обычном масштабе, с адаптивной высотой и безопасным масштабом подписей при крупном шрифте; доступны четыре разрешённых раздела и вкладка «Ещё» для полной web-версии.
- Preview feed `/desktop-updates/mobile/preview/`, schema v1/v2 parser, атомарный publish/rollback и кнопки скачивания работают. Live manifest указывает на APK 1.1.8 (`versionCode=10`).
- Dashboard повторяет web-композицию «Сегодня → быстрые действия → Сейчас важно»; Tasks оформлены как компактная лента, Chat использует те же light-токены, Settings — единые карточки и секции. Email и роль профиля вынесены на полную ширину, чтобы не ломаться при увеличении текста.
- Добавлены фирменные icon/splash, доступные labels/states, увеличенные touch targets, keyboard avoidance и понятные error/empty состояния.

## Ручная матрица — ещё требуется

| Сценарий | Статус | Причина |
|---|---|---|
| clean install и upgrade install на Android 13+ | не проверено | физическое устройство не подключено; локальный x86_64 emulator не может стартовать без nested virtualization в текущем VMware-госте, ARM64 image несовместим с x86_64 host |
| login, refresh, logout | проверено через Expo Web + production API | временная viewer-учётка прошла UI login, автоматический refresh после подмены access token и logout; после проверки учётка деактивирована, две сессии закрыты, реквизиты удалены |
| 2FA, fingerprint и offline cold start на Android | автоматическая регрессия пройдена, device smoke не выполнен | opt-in появляется после 2FA, local credential invalidation и read-only fallback покрыты тестами; подключённого Android-устройства нет |
| tasks для исполнителя и контролёра | не проверено live | нужны два подходящих аккаунта и актуальные задачи |
| Chat A→B/B→A, reconnect/offline/background | не проверено live | нужны два аккаунта/устройства и production WebSocket smoke |
| background FCM и открытие диалога | не проверено на устройстве | client `google-services.json` встроен, backend FCM ранее настроен; нужны два физических устройства и адресная матрица foreground/background/killed/reply |
| локальная release-подпись | не завершена | build pipeline принимает защищённые `HUBIT_ANDROID_*` credentials и проверяет сертификат, но постоянный keystore/backup ещё не созданы |

## Отдельные действия для завершения приёмки

1. Для двухстороннего Chat, проверки ролей задач и 2FA нужны два подготовленных тестовых аккаунта и TOTP/backup code, если политика потребует challenge.
2. Подключить физический Android 13+ по USB/ADB и пройти clean/upgrade install и ручную матрицу из [плана](./MOBILE_HUB_WORKING_PROTOTYPE_PLAN.md). Для эмулятора нужен другой хост либо включённая nested virtualization в VMware; простая повторная установка emulator/system image проблему не решит.
3. На двух физических устройствах зарегистрировать FCM tokens и пройти адресную матрицу уведомлений/быстрых ответов без вывода token или содержимого сообщений.
4. Создать постоянный release keystore вне Git, зашифрованный backup и план одноразовой миграции с debug-signed 1.1.3.
5. Установить опубликованный preview APK 1.1.6 на реальный Android и вручную подтвердить password → TOTP/backup → fingerprint opt-in/app lock → native Chat, keyboard avoidance, offline cold start, files и logout/re-login.
6. Для следующих APK-релизов использовать новый semver и `versionCode`; опубликованные version directory не перезаписывать.

Для предыдущего live smoke в production была создана одна временная viewer-учётка; после проверки она деактивирована, активные сессии закрыты, временные реквизиты удалены. Backend session bridge и WebView print bridge остаются опубликованными. В текущем этапе изменён только IIS preview APK feed до 1.1.6; frontend/backend не публиковались, процессы не перезапускались, production `.env`, PM2 и PostgreSQL schema/config не изменялись.
