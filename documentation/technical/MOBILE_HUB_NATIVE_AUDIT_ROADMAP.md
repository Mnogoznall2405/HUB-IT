# HUB-IT Mobile — аудит нативности (source 1.1.7 / APK 1.1.6)

- Статус: APK 1.1.6 опубликован в preview-feed; source 1.1.7 исправляет Android URL resolver после 2FA и зависание mobile-web-session, но ещё не собран и не опубликован.
- Дата снимка: 2026-08-23.
- Клиент: `mobile-hub/` (Expo React Native, Android).
- Доставка: локальная сборка APK и внутренний feed HUB-IT, без EAS и Expo Push Service.

## 1. Главный вывод

Нет, все полезные нативные функции ещё не завершены.

Нативное ядро уже серьёзное: самостоятельный APK, password/2FA, отзывная биометрическая device-сессия после 2FA, SecureStore, app lock, защищённый WebView, FCM-клиент, Android notification actions, badge, фоновая синхронизация, offline read-only cache, печать, системные загрузки/отправка файлов, локальная диагностика и внутренний updater реализованы в коде. Нативные настройки доступны из общей web-страницы через типизированный bridge.

Но кандидат нельзя считать стабильным готовым Android-продуктом, пока не закрыты следующие обязательные разрывы:

1. APK подписан совместимым debug-preview сертификатом, а не постоянным release key.
2. Физический Android не подключён; login/2FA/biometric, клавиатура, system bars, offline, FCM, быстрый ответ и updater не приняты на устройстве.
3. Опубликованный debug-preview APK 1.1.6 ошибочно объявляет неподтверждённые HTTPS App Links: production `assetlinks.json` отсутствует, поэтому Android показывает выбор HUB/браузера после 2FA. В source 1.1.7 HTTPS filter выключен по умолчанию; custom `hubit://` остаётся.
4. Offline работает только после успешного online-входа и предварительной загрузки shell/GET-данных. Для Главной, Задач и Почты добавлена явная подготовка из APK-настроек, но чистая установка без сети и восстановление после удаления кэша WebView не гарантированы.
5. FCM и background actions покрыты unit-тестами, но доставка в `foreground/background/killed/Doze` и работа у разных производителей Android не доказаны.
6. Verified HTTPS App Links нельзя считать завершёнными без постоянного release fingerprint и production `/.well-known/assetlinks.json`.
7. Входящий Android Share Target пока принимает только текст/ссылку и создаёт черновик письма или задачи; файлы и изображения требуют отдельного безопасного upload-контракта. Kotlin-модуль прошёл release Gradle-компиляцию в APK 1.1.5.
8. Миграции `20260822_0101` и `20260823_0102` применены в production 2026-08-23 после read-only preflight и проверяемого backup; postflight подтвердил `already_current`.
9. Android notification group, стабильные task tags, mail launcher count и фоновое `Прочитано` опубликованы в preview 1.1.6, но ещё не приняты на физическом устройстве.
10. Локальный release-health и подтверждаемая очистка offline-кэша после нативного logout опубликованы в preview 1.1.6, но ещё не приняты на физическом устройстве.
11. Android 11+ process-exit history (ANR/Java/native crash/low-memory) реализована без trace/description/PID; Kotlin-модуль прошёл Gradle-компиляцию, но устройство ещё не проверялось.

Итоговый статус: **основное нативное ядро и native Chat опубликованы в preview, исправление auth/App Links готово только в source 1.1.7, production-ready — нет**. Следующий приоритет — собрать новый preview без HTTPS intent-filter и пройти device-приёмку.

## 2. Архитектурная граница

Правильная целевая архитектура остаётся такой:

- Chat имеет нативные React Native inbox/thread, а почта, задачи и остальные бизнес-разделы живут в общем responsive web frontend;
- APK не дублирует серверную бизнес-логику Chat и не переносит остальные бизнес-страницы без отдельного решения;
- APK отвечает за системную авторизацию, биометрию, безопасное хранение, FCM, lifecycle, offline bootstrap, файлы, печать, Android intents, обновление и аппаратные интеграции;
- PWA и браузер продолжают работать без APK-only поведения;
- взаимодействие portal с Android выполняется через строго типизированный и ограниченный mobile bridge.

Это даёт интерфейс «точно как в мобильной web-версии» без расхождения функций между web и APK.

## 3. Проверенный артефакт

| Параметр | Факт |
|---|---|
| APK | `mobile-hub/dist/hubit-mobile-preview.apk` |
| Package | `ru.zsgp.hubit.mobile` |
| Версия | `1.1.6`, `versionCode=8` |
| Размер | 50 364 083 байта, 48,03 МиБ |
| SHA-256 | `2d0bb666da908ff9ea4c715f3d0c7d60847339ff11e1a57372a2a8d8599fb476` |
| Android SDK | min 24, target 36, compile 36 |
| ABI | `armeabi-v7a`, `arm64-v8a` |
| JS runtime | Hermes, production bundle встроен, Metro не нужен |
| Оптимизация | R8/minify и resource shrinking включены |
| Подпись | валидна, но сертификат `debug-preview` |
| Firebase client config | встроен через Google Services plugin; исходный JSON игнорируется Git |
| Текущий публичный preview feed | 1.1.6, schema v2; внешний post-check `verified=true` |
| Физическое устройство | не подключено, device acceptance не выполнен |

Ранее отдельно собран arm64-only canary 1.1.4: 36 031 847 байт (34,36 МиБ), SHA-256 `1ca17413dfd2c9267f2ac969613f0271d38b469b6942b505382114ebe1db28db`. Он предшествует native Chat и последним Android-изменениям. Публикация APK, установка на телефон и пользовательская приёмка — три разных состояния.

## 4. Матрица нативных функций

Обозначения:

- **готово** — реализация и автоматическая проверка присутствуют;
- **частично** — код есть, но функция недостижима из основного пути либо не принята на устройстве;
- **нет** — реализации нет;
- **не нужно** — намеренно остаётся в общем web frontend.

| Область | Статус | Фактическое состояние | Что осталось |
|---|---|---|---|
| Standalone APK | готово | Встроены Hermes bundle и native libraries, Metro не нужен | Release key и device install |
| Password + 2FA | частично | Нативный login и TOTP/backup-code flow реализованы | Реальный password → 2FA → portal smoke |
| Fingerprint opt-in | частично | После 2FA выдаётся непросроченный, отзывной и привязанный к устройству opaque credential; секрет защищён биометрическим SecureStore | Применить миграцию `0102`; проверить enrollment change, revoke, cold start и fallback |
| Автономный вход | частично | Биометрия открывает только локальный read-only snapshot при сетевой ошибке | Device cold start и cache-miss UX |
| App lock / privacy shield | частично | Биометрическая блокировка и таймауты управляются из общей страницы; любая авторизованная сессия скрывается через `FLAG_SECURE` при уходе Android в background | Проверить recents/screenshot и все таймауты на устройстве |
| Android backup policy | готово в config | Config-plugin принудительно ставит `allowBackup=false` и `usesCleartextTraffic=false`, чтобы device credential/cookies/cache не переносились на другой телефон | Подтвердить итоговый manifest после следующего prebuild/APK |
| Защищённая web-сессия | готово | Одноразовый mobile→web bootstrap, HttpOnly cookies, same-origin policy | Device acceptance и измерение TTFD |
| Общий portal + нативный Chat | готово в коде | После входа Android открывает responsive portal; `/chat` при release-флаге использует общий REST/WebSocket backend через React Native UI | Физическая двусторонняя Chat-приёмка остаётся обязательной |
| Safe area и клавиатура | частично | `adjustResize` и KeyboardAvoidingView применены к WebView и нативному Chat | Проверить Chat, Mail, Tasks, Settings на 2–3 клавиатурах |
| Скрытая navigation bar | частично | Expo NavigationBar запрашивает hidden; после resume и закрытия клавиатуры приложение повторно включает immersive-режим | Проверить gesture/3-button modes на физических устройствах |
| Android Back | готово в коде | Сначала история WebView, затем системное поведение | Проверить deep link, modal, keyboard и root exit |
| FCM token lifecycle | частично | Native FCM token, rotation/revoke, device ID, backend API и достижимый permission flow из web-настроек реализованы | Два физических устройства и production credentials/runtime |
| Notification channels | готово в коде | Chat, задачи, почта, system и fallback channels объединены в Android settings group `HUB-IT`; из общей APK-карточки можно открыть app-specific настройки батареи/фона с безопасным fallback в карточку приложения, без автоматического запроса исключения | Проверить channel/background settings, звук, vibration и privacy на устройстве |
| Chat «Ответить»/«Прочитано» | частично | Module-scope background task, idempotency и retry queue реализованы | Killed/Doze/OEM acceptance и 50-event run |
| Push задач/почты/system | частично | Клиент и app outbox реализованы; Android получает launcher count для почты, а обновления одной задачи заменяют только её drawer-tag | Production migration/restart, summary-group и адресная device-доставка |
| Badge | частично | Reconciliation реализован | Проверить лаунчеры Pixel/Samsung/Xiaomi и reset после прочтения |
| Quiet hours/mute | частично | Серверные preferences и Android notification settings доступны из общего интерфейса | Проверить timezone/overnight и channel overrides |
| Offline shell | частично | Service Worker кэширует shell, WebView включает cache fallback | Нет гарантии после clean install/eviction; device cycles |
| Offline API data | частично | GET cache: AES-GCM, TTL 7 дней, 250 записей, 2 МиБ на ответ; portal и нативный logout очищают пользовательский ciphertext, отложенная очистка подтверждается WebView ACK. Кнопка подготовки запрашивает только разрешённые read-модели Главной/Задач/Почты, ждёт завершения шифрования и отдельно показывает частичный результат | Device preload, cache eviction и storage lifecycle; Chat синхронизирует другой агент |
| Offline mutations | намеренно ограничено | Блокируются; очередь только для chat mark-read и notification reply | Позже — только явные drafts/idempotent contracts |
| Network status banner | готово в source | Android `ConnectivityManager` сообщает только validated connectivity; offline сразу включает read-only, а зелёный статус появляется только после успешного server bootstrap с backoff 2/5/15/30 с. В APK-настройках видны подтверждённый статус, тип транспорта и metered-режим без SSID/IP, доступна ручная перепроверка. WebView events сохранены как fallback | Kotlin compile и 20 device offline↔online cycles; PWA не использует native event |
| Portal file download | частично | Обычные HTTP(S)-загрузки передаются Android Download Manager с cookies; blob до 20 МБ — SAF save/share и очистка temp | Реальные MIME, большой blob и device apps |
| Native camera/gallery/document picker | частично | Системный chooser WebView поддерживается библиотекой; отдельного typed file bridge нет | Пройти реальные формы portal; добавлять bridge только для подтверждённых разрывов |
| Печать | частично | Mail HTML передаётся в native Print dialog | Проверить preview/PDF/printer picker на устройстве |
| Share из HUB-IT | частично | Системный share для скачанного файла, публикации Feed и ссылки на задачу реализован; typed bridge принимает ограниченный текст и только HTTPS-ссылку HUB-IT | Подключать другие разделы по реальным кнопкам; большие blob требуют streaming |
| Share в HUB-IT | частично | Android `ACTION_SEND` text/link принимается локальным Expo-модулем и создаёт черновик письма или задачи, без автоотправки | Gradle compile/device smoke; файлы и изображения; Chat ведёт другой агент |
| In-app updater | частично | HTTPS feed, строгая schema, SHA-256, progress, system installer, required gate и optional update из общей страницы настроек | Permanent signer и device upgrade matrix |
| Deep links | частично | `hubit://` и сохранение маршрута через login/2FA реализованы; preview/debug HTTPS intent-filter выключен, чтобы Android не перехватывал внутренний WebView переход | Permanent signer, production `assetlinks.json`, explicit release opt-in и device verify |
| Диагностика | частично | Локальные обезличенные коды ошибок, агрегат release-health, Android 11+ process-exit history, JSON share и WebView renderer recovery доступны из общей страницы настроек | Gradle/device smoke process-exit; внешняя telemetry только отдельным решением |
| Haptics | реализовано в source | App lock и portal bridge используют только системные `selection`/`success`/`error` после явного действия пользователя; текстовый статус сохранён | Device smoke; не расширять на загрузку, навигацию и фоновые события |
| TalkBack/font scale | частично | Есть headings/labels/live regions/touch targets; Login фокусирует первое пустое поле; app-lock и mandatory updater прокручиваются при крупном шрифте; WebView не скрывает DOM accessibility tree; native modals уважают reduced motion | Полный TalkBack/200%/switch-access smoke не выполнен |
| Landscape/foldables | нет | Приложение принудительно portrait | Решить после phone pilot; не блокирует первый внутренний релиз |
| QR/barcode equipment lookup | нет | Камера есть, доменный scanner отсутствует | Полезная P3-функция после стабилизации ядра |
| Home-screen shortcuts | частично | Статические Android shortcuts для Chat, Tasks и Scan Center генерируются config-plugin | Prebuild/Gradle/device smoke; динамическое ранжирование не требуется до метрик использования |
| Widgets | нет | Не реализованы | Не планировать до запроса пользователей |

## 5. Критические расхождения текущего интерфейса

### 5.1. Portal ↔ Android bridge и нативные настройки

Разрыв основного пути закрыт в коде. Общая web-страница настроек определяет APK только по `window.__HUBIT_MOBILE_APP__ === true` и показывает Android-карточки push, updater, app lock/biometrics, диагностики и offline/cache. Двусторонний bridge использует `schemaVersion`, ограниченный `requestId`, allowlist команд, лимит 16 КиБ и типизированный success/error-ответ.

Оставшийся gate — не реализация интерфейса, а device-приёмка каждой команды и проверка, что обычные браузер/PWA/Desktop не получают APK-карточки.

### 5.2. Push permission и каналы

На Android 13+ системный prompt теперь достижим по явной кнопке пользователя в общей странице настроек. Отказ не блокирует вход; доступны системные настройки приложения и отдельные настройки каналов Chat/Tasks/Mail/System.

Остаётся доказать на устройствах `denied/blocked/granted`, повторный запрос, регистрацию/rotation FCM token и доставку при закрытом приложении.

### 5.3. Updater

Необязательное обновление теперь можно проверить и установить из общей страницы настроек; full-screen gate сохранён для обязательного обновления. До релиза всё ещё нужны постоянный signer и сценарии valid/corrupted/canceled/no-space/offline/unknown-sources с проверкой сохранения SecureStore, cookies, biometric credential и FCM registration.

### 5.4. Offline

Текущий offline — это безопасный read-only cache, а не самостоятельная локальная копия всей системы. Это правильное ограничение для первого релиза.

Нужно честно гарантировать только следующее:

- пользователь ранее успешно вошёл online и включил биометрию;
- service worker сообщил `offline_ready=true`;
- нужный маршрут и его GET-данные были предварительно открыты;
- без сети доступны только эти данные;
- любые изменения заблокированы или явно помещены в разрешённую видимую очередь;
- после возврата сети сессия пересоздаётся на том же маршруте.

В общей странице настроек уже показаны `готов / не готов`, last sync, размер и список доступных модулей; доступны очистка и повтор очередей. При выходе через portal APK удаляет текущий пользовательский ciphertext до сброса web-сессии. При выходе через нативное меню user ID ставится в защищённую очередь очистки до удаления ключей; следующий WebView удаляет только его IndexedDB/метаданные и подтверждает завершение ACK. TTL, лимит записей и удаление кэша другого пользователя при следующей записи также сохранены. Service Worker при production build получает build id автоматически. Для более надёжного cold start всё ещё требуется device-проверка cache eviction и обоих logout-путей; при подтверждённой проблеме нужен минимальный нативный fallback screen. Полный frontend в APK дублировать не следует.

## 6. Аудит размера и производительности

### 6.1. Фактический измеренный результат

| Артефакт | ABI | Размер | Изменение |
|---|---|---:|---:|
| предыдущий universal baseline | armv7 + arm64 + x86 + x86_64 | 98,78 МиБ | baseline |
| текущий preview | armv7 + arm64 | 47,84 МиБ | −50,94 МиБ к старому baseline |
| arm64 canary | arm64 | 34,36 МиБ | −13,48 МиБ / −28,18% к текущему preview |

Измерения и SHA-256 сохранены в `artifacts/mobile/apk-benchmark-20260823-113458.json`. p50/p95 запуска и PSS не измерялись: Android-устройство не подключено. Последние исходники после Share Target/App Links/shortcuts ещё не входят в эти артефакты.

### 6.2. Уже правильные настройки

- Hermes включён;
- New Architecture включена;
- native libraries не извлекаются во вторую копию при установке (`useLegacyPackaging=false`);
- APK содержит baseline profile от зависимостей и ProfileInstaller;
- cleartext HTTP выключен;
- production JS bundle встроен;
- animated WebP выключен.

### 6.3. Найденные точки оптимизации

1. **ABI** — главный выигрыш. Сначала собрать inventory CPU ABI реальных телефонов. Если все pilot-устройства arm64, публиковать arm64 APK и держать universal APK как отдельный fallback. Если нужен arm32, feed v3 должен выбирать артефакт по ABI и иметь отдельные versionCode.
2. **R8/resource shrinking** — включены в текущем preview и отражены в audit JSON. До релиза обязательны auth, WebView, Firebase, background task, file picker и updater regression на устройстве.
3. **Legacy native screens** — Dashboard/Tasks/Chat/Settings и drawer больше не являются основным Android UI, но остаются в JS bundle. После переноса native controls в portal bridge удалить недостижимые routes/components/tests.
4. **Зависимости drawer/animation** — `@react-navigation/drawer`, `react-native-reanimated` и `react-native-worklets` не используются в основном пути. Удалять только после `npm why`, clean prebuild и полного device smoke; `react-native-paper` пока нужен auth/updater.
5. **Release inspector** — в `app.config.ts` выключен; после следующего prebuild нужно повторно проверить сгенерированный `gradle.properties`.
6. **Service Worker version** — production build автоматически штампует cache id; сохранить тест и проверку готового `dist/sw.js` в build gate.
7. **Frontend chunks** — общий Vite build предупреждает о крупных чанках. Измерить portal TTFD и lazy-load самых тяжёлых маршрутов; оптимизация улучшит APK, PWA и Desktop одновременно.
8. **Startup path** — сейчас есть native session restore, mobile-web-session exchange, загрузка shell и frontend bootstrap. Нужны отдельные timings по этапам, иначе нельзя понять узкое место.
9. **Baseline Profile** — встроенный профиль зависимостей есть, но нет HUB-IT Critical User Journeys. Добавить profile для launch → biometric → portal → Dashboard/Chat/Mail/Tasks и измерить его Macrobenchmark-ом.
10. **Bundle compression** — не менять вслепую. Сравнить download size, install size, TTID и TTFD на реальном устройстве до решения.

### 6.4. Метрики до оптимизации

До изменения производительности собрать одинаковый baseline на low/mid/high Android:

- APK download size и installed size;
- cold/warm TTID и TTFD, p50/p95;
- время этапов native restore → session exchange → first WebView paint → interactive route;
- `FrameTimingMetric`/jank для Chat, Mail и Tasks;
- peak/steady PSS после 5 минут работы;
- network requests и transferred bytes для первого Dashboard и повторного запуска;
- battery/background-task поведение за 8 часов;
- FCM time-to-display p50/p95 отдельно для normal и battery-saver.

Оптимизация принимается только при одинаковом сценарии и устройстве, без ухудшения auth, offline, push и updater. Первый размерный ориентир — arm64 APK не больше 55 МиБ; остальные цели фиксируются после baseline.

## 7. Единая дорожная карта

### P0 — сделать текущие функции реально выпускаемыми

- [ ] Создать постоянный Android release keystore вне Git, сделать два зашифрованных backup и документировать fingerprint/recovery.
- [x] Автоматизировать безопасную подготовку release keystore: интерактивный RSA-4096/PKCS12, запрет путей внутри Git и перезаписи, два byte-identical backup, раздельные тома по умолчанию, verify-only и fingerprint без секретов.
- [ ] Зафиксировать одноразовый переход с debug-preview подписи: старый debug APK нельзя бесшовно обновить APK с новым signer; pilot-пользователям потребуется uninstall/install с потерей локальной сессии и кэша.
- [x] Сделать публикацию fail-closed по build audit и signer: debug-preview требует явного флага, сертификат канала закреплён, ротация требует точный новый fingerprint и отдельный одноразовый флаг.
- [x] Реализовать двусторонний typed portal↔native bridge с allowlist команд и тестами malformed/oversized/untrusted messages.
- [x] Добавить в общие web-настройки APK-карточки: push, updater, app lock, диагностика, offline/cache.
- [x] Добавить достижимый opt-in flow для Android notification permission.
- [x] Сделать optional update видимым и запускаемым из portal; mandatory gate оставить.
- [x] Автоматизировать Service Worker build/cache version.
- [ ] Подключить минимум один Android 13+ и один Android 14/15+; пройти clean/upgrade smoke.
- [ ] Пройти password → 2FA → biometric opt-in → portal и повторный biometric cold start.
- [ ] Проверить клавиатуру во всех текстовых полях Chat, Mail, Tasks и Settings; поле и primary action должны оставаться видимыми.
- [ ] Проверить safe area, header, status bar и скрытую navigation bar в gesture и 3-button modes.
- [ ] Проверить updater: valid, corrupted, canceled, no-space, permission denied, retry и successful upgrade.

Критерий завершения P0: APK подписан постоянным ключом, все нативные настройки доступны из portal, а clean/upgrade/auth/keyboard/update проходят на физических устройствах.

### P1 — доказать FCM, offline и lifecycle

- [ ] После отдельного production-разрешения применить миграции `20260822_0101` и `20260823_0102`, включить app push outbox и перезапустить только нужный backend штатным скриптом.
- [x] Добавить fail-closed read-only migration preflight: локальный Alembic graph и production `READ ONLY` проверка version table, обеих app-таблиц, длинных транзакций и waiting locks без раскрытия connection details.
- [x] Автоматизировать разрешённое применение mobile migrations: exact start/target revision, обязательный `pg_dump app/system`, `pg_restore --list`, postflight и отсутствие автоматического destructive downgrade.
- [ ] Проверить native-push runtime, outbox backlog/heartbeat и отсутствие блокировки бизнес-ACK.
- [ ] Зарегистрировать два тестовых устройства разными тестовыми учётками.
- [ ] Отправить по 50 событий Chat/Tasks/Mail/System и зафиксировать доставку, дубли, route, badge и latency.
- [ ] Проверить foreground, background, killed, reboot, Doze, battery saver, airplane mode и восстановление сети.
- [ ] Проверить Chat `Ответить`, `Прочитано`, offline retry, duplicate tap и смену пользователя на устройстве.
- [x] Добавить переход в системные настройки конкретного notification channel.
- [ ] Проверить privacy preview на lock screen и пользовательские mute/quiet hours.
- [x] Добавить экран `Offline готов / не готов`, last sync, cache size и список предварительно доступных модулей.
- [x] Добавить явную подготовку автономных read-моделей Главной, Задач и Почты с permission gates, ожиданием фактической зашифрованной записи и честным partial status.
- [x] Добавить privacy-safe Android validated-connectivity bridge и server-confirmed recovery с ограниченным backoff; не считать наличие Wi-Fi восстановлением HUB backend.
- [x] Добавить явный переход в системные app-specific настройки батареи/фона с OEM fallback; не запрашивать battery-optimization exemption автоматически.
- [x] Расширить обезличенный device-smoke явными `passed/failed/not_run` для подготовки offline-списков, cache miss/recovery, Android validated network, app-specific battery settings и 20 lifecycle-циклов.
- [ ] Выполнить 20 cold starts и 20 offline↔online cycles без blank screen, logout, потери маршрута или ложного успеха записи.
- [ ] Завершить device-приёмку очистки ciphertext/cache: portal logout, нативная deferred purge с WebView ACK, TTL/лимит и prune другого пользователя реализованы; проверить оба logout-пути и смену учётки.

Критерий завершения P1: FCM и quick actions доказаны на двух устройствах, а offline честно и стабильно показывает ранее загруженное содержимое.

### P2 — уменьшить APK и ускорить запуск

- [x] Создать reproducible benchmark harness и сохранить size/SHA сравнение артефактов.
- [ ] Снять device p50/p95 запуска и PSS тем же harness на low/mid/high Android.
- [x] Собрать arm64-only canary и сравнить с dual-ABI artifact: 34,36 против 47,84 МиБ.
- [ ] Решить по inventory устройств: arm64 primary + universal fallback либо multi-ABI feed v3.
- [x] Собрать canary с R8 и resource shrinking; audit JSON подтверждает обе оптимизации.
- [ ] Пройти device regression R8-сборки и добавить keep rules только по фактическим сбоям.
- [x] Выключить release network inspector в Expo config и сгенерированном release property.
- [x] Перенести native controls из legacy settings в общий portal bridge.
- [ ] Удалить оставшиеся недостижимые legacy native business screens после завершения параллельного native Chat и route audit.
- [x] Удалить неиспользуемые drawer/reanimated/worklets зависимости из mobile package после dependency audit.
- [ ] Разбить тяжёлые frontend routes/chunks по результатам WebView trace.
- [ ] Добавить HUB-IT Baseline Profile и Macrobenchmark для критических путей.
- [ ] Сравнить bundle compression только измерением, не предположением.

Критерий завершения P2: arm64 APK ≤55 МиБ, измеримый startup/TTFD выигрыш без функциональных регрессий, universal fallback сохранён при необходимости.

### P3 — максимально полезные Android-интеграции

- [x] Сделать Android HTTPS intent-filter release-only; preview/debug по умолчанию использует только `hubit://` и не попадает в системный resolver домена.
- [ ] Опубликовать `assetlinks.json` с постоянным release fingerprint и подтвердить `verified` на устройстве.
- [x] Подготовить fail-closed публикацию `assetlinks.json`: только release audit/package/fingerprint, известный debug signer запрещён, atomic replace/backup и no-cache IIS delivery.
- [x] Реализовать Android Share Target для текста/ссылки → безопасный черновик письма или задачи без автоотправки.
- [ ] Добавить файлы/изображения во входящий Android Share Target после контролируемого upload-контракта; native Chat уже использует существующий Chat upload API.
- [x] Использовать штатный Android file chooser `react-native-webview` для фактических portal `<input type="file">`: MIME/`multiple` сохраняются, камера/галерея предлагаются для изображений, а web получает обычный `File`, не сырой `content://`. Отдельный дублирующий bridge не нужен; device upload smoke остаётся обязательным.
- [x] Использовать встроенный Android Download Manager WebView для обычных HTTP(S)-загрузок с cookies и системным Downloads.
- [ ] Для больших blob добавить streaming/native contract; не передавать произвольный content URI в web JavaScript.
- [x] Добавить allowlisted `share.text` bridge и системное Android-меню отправки для публикаций Feed и ссылок на задачи; внешние URL как целевая ссылка блокируются.
- [ ] Завершить notification summary-group: Android settings group, стабильные task drawer-tags и mail `notification_count` реализованы; summary нескольких событий требует отдельного native presentation слоя и killed/Doze проверки.
- [ ] Безопасные task actions из уведомления только при capability check и идемпотентном серверном контракте.
- [x] Реализовать Mail action `Прочитано`: mailbox-scoped API, background execution и сохранение уведомления при сетевой ошибке.
- [ ] Mail action `Архив` добавлять только после идемпотентного серверного контракта; inline-ответ на письмо не добавлять без draft/recipient safety.
- [ ] Локальные drafts Chat/Mail/Task comment с явным статусом, но без скрытой автоотправки опасных операций.
- [ ] QR/barcode scanner для быстрого поиска оборудования, если формат меток подтверждён владельцем продукта.
- [x] Добавить статические home-screen shortcuts Chat, Tasks и Scan Center через idempotent config-plugin.
- [x] Добавить строгий `haptics.perform` portal bridge и умеренную обратную связь для подтверждённых действий Android-настроек; вибрация не является единственным статусом.
- [ ] Рассматривать dynamic shortcuts только после метрик реального использования.

Критерий завершения P3: интеграция сокращает реальный рабочий сценарий и не создаёт вторую бизнес-логику вне web/backend.

### P4 — доступность, наблюдаемость и долгосрочная стабильность

- [x] Не скрывать DOM accessibility tree общим `accessibilityLabel` на WebView; сохранить labels/role/state ключевых native controls.
- [x] Сделать pre-portal native gates устойчивыми к крупному шрифту: Login/2FA/biometric/app-lock/updater получили семантические headings и alerts, первый invalid focus, прокрутку lock/update и progressbar semantics.
- [ ] Пройти полный TalkBack/Switch Access smoke на устройстве.
- [ ] Font scale 100/130/200%, display size, Switch Access, external keyboard и touch targets не меньше 44×44 в ключевых phone flows.
- [x] Уважать Android reduced-motion в ключевых native modal transitions.
- [x] Адаптировать web animations при reduced-motion через общий `MuiCssBaseline` и профильные overrides критических анимаций.
- [ ] Проверить portrait на телефоне; отдельно решить landscape/foldable/tablet без побочного изменения первого релиза.
- [ ] Добавить privacy-safe crash/performance telemetry в существующий backend только после отдельного решения; не подключать новый внешний сервис автоматически.
- [x] Добавить локальное privacy-safe событие и понятное восстановление после завершения Android WebView renderer.
- [x] Запретить Android Auto Backup/transfer локальной сессии и offline-данных; сохранить запрет cleartext traffic.
- [x] Скрывать содержимое авторизованного HUB-IT в Android Recents независимо от включения app lock, не запрещая обычные screenshots в активном приложении.
- [x] Добавить локальный privacy-safe release health: сессии без UI-сбоя, update handoff/completion, push registration/receipt, offline recovery и текущая queue depth без пользовательского содержимого.
- [x] Добавить privacy-safe Android 11+ process-exit history через `ApplicationExitInfo`: только фиксированная причина/время, без trace, description, PID и пользовательского содержимого.
- [ ] Скомпилировать Kotlin-модуль в следующем разрешённом build, принять на Android 11+/13+/15+ и отдельно решить агрегирование между устройствами; локальный буфер ОС не заменяет production telemetry.
- [ ] Матрица Android 13/14/15/16 и минимум Pixel/Samsung/Xiaomi либо фактические модели предприятия.
- [ ] Ежемесячная проверка Expo/RN/Firebase/target SDK advisories и воспроизводимый dependency update canary.

Критерий завершения P4: интерфейс доступен, наблюдаем и выдерживает релизную матрицу без сбора конфиденциального содержимого.

## 8. Обязательный release gate каждого APK

### Автоматические проверки

- `npm run lint` в `mobile-hub/`;
- `npm run test:ci` в `mobile-hub/`;
- `npx expo install --check` и `npx expo-doctor`;
- профильные frontend tests и `npm run build` для bridge/offline/settings;
- профильные backend tests для auth/native push/outbox/Chat/Mail/Tasks;
- clean local release build с Firebase client config и постоянным signing key;
- `aapt` identity/SDK/permissions, `apksigner` v2/v3 и certificate fingerprint;
- APK size breakdown, SHA-256, secret/artifact screening;
- `publish-apk.ps1 -ValidateOnly` до любой публикации;
- проверка, что version/versionCode не переиспользуются и signer совпадает с каналом.
- соседний build audit совпадает с APK; debug-preview и signer rotation не проходят без отдельных явных флагов.

### Device gate

- clean install и upgrade install;
- login, 2FA, biometric enable/disable, app lock, expired session и logout;
- Chat A↔B, Mail, Tasks по двум ролям;
- клавиатура и safe area во всех формах;
- offline preparation/prewarm/cold start/cache miss/recovery, validated network и исчезновение recovery-плашки;
- app-specific battery/background settings без автоматического запроса exemption;
- FCM foreground/background/killed/Doze, quick reply/read, badge/channel settings;
- camera/gallery/document, upload/download/open/share/print;
- optional/required update и отказ от установки;
- TalkBack, 200% font scale, gesture/3-button navigation.

### Production gate

Production migration, `.env`, PM2/IIS, backend restart и публикация APK выполняются только после отдельного подтверждения. После разрешения нужны preflight, backup/rollback и post-check фактического HTTPS manifest/APK/hash/runtime. Публикация не считается установкой на телефон.

## 9. Что намеренно не делаем

- не переписываем все business pages на React Native;
- не возвращаем удалённый Capacitor/mobile-android pipeline;
- не используем Expo token, EAS Build или Expo Push Service в выбранном локальном контуре;
- не делаем silent APK install без MDM/device-owner;
- не включаем полные offline mutations без идемпотентности, conflict UX и серверного контракта;
- не добавляем Redis, новый broker, внешний crash service или аналитику без отдельного решения;
- не объявляем функцию готовой только по наличию кода или зелёной сборке без device acceptance.

## 10. Ближайший исполняемый пакет

Следующий пакет — release-candidate стабилизации:

1. дождаться завершения параллельной реализации native Chat и свести изменения без перезаписи её файлов;
2. выполнить clean prebuild/Gradle compile нового Share Target/App Links/shortcuts-кода;
3. закрепить permanent signing и план перехода с debug-preview;
4. пройти физический device smoke: auth/2FA/biometric, keyboard/safe-area/system-bars, WebView recovery, Share Target, App Links, updater и offline;
5. доказать FCM в foreground/background/killed/Doze минимум на двух устройствах;
6. production-миграции и backend restart выполнены; сохранить postflight/backup и проверить outbox в функциональном push-smoke;
7. только затем собрать и опубликовать новый APK/feed с фактическими hash/signer/post-check.

## 11. Проверки этого аудита

| Проверка | Результат 2026-08-23 |
|---|---|
| `npm run test:ci` | source 1.1.7 прошёл 65/65 suites, 217/217 тестов; полный вывод текущего запуска без React `act(...)` warning |
| Pre-portal native accessibility | 4 профильных suites покрывают focusable text-field ref, первый invalid Login field, scroll/reflow app-lock и mandatory updater, header/alert/progressbar semantics; реальный TalkBack и font scale 200% остаются device gate |
| Focused WebView recovery/diagnostics Jest | 2/2 suites, 4/4 теста прошли |
| Share bridge/Share Target/shortcut Jest | профильные suites прошли; входят в полный mobile run |
| Frontend incoming-share/Mail compose Vitest | 2/2 files, 11/11 тестов прошли |
| Frontend Android share → task Vitest | профильный сценарий и четыре contract-теста прошли; задача не создаётся автоматически |
| Frontend task link → Android share Vitest | 2/2 files, 10/10 тестов прошли; пункт доступен только при APK bridge |
| Frontend logout/offline cache Vitest | 2/2 files, 20/20 тестов прошли; обычный браузер не получает APK-only очистку |
| Frontend offline preparation | 5/5 files, 313/313 тестов с полным API client: permission-scoped prefetch, точные Tasks/Mail cache-key текущего контекста, ожидание pending AES-GCM writes, partial failure, read-only gate и APK settings UI |
| Полный frontend regression | 537/538 files, 3 127 passed, 1 failed, 2 skipped. Несвязанный Docflow timing-тест `allows a manual retry...` не нашёл кнопку в общем запуске и сразу прошёл изолированно 1/1; полный запуск поэтому не назван зелёным |
| Android system UI lifecycle Jest | повторное скрытие navigation bar после resume/keyboard dismissal проверено unit-тестом |
| Release health / native logout Jest | локальные счётчики, конкурентная запись, push receipt и deferred per-user WebView purge с ACK покрыты; mobile full run зелёный |
| Android process-exit diagnostics | pure normalization tests 2/2; Expo autolinking нашёл `hubit-device-health` без дубликатов; API/константы подтверждены локальным Android SDK 36, Gradle намеренно не запускался |
| Portal haptics | allowlisted bridge и payload validation покрыты 8/8 mobile tests; web bridge/app/push settings — 8/8 Vitest; TypeScript успешно, device vibration намеренно не проверялась без сборки |
| Portal Android file chooser | RN WebView source подтверждает системный chooser, MIME/`multiple` и camera intents; опубликованный APK 1.1.6 содержит `CAMERA`, но не `RECORD_AUDIO`; реальный pick/upload ещё не проверялся на устройстве |
| Native connectivity recovery | красный WebView-stale-network тест воспроизвёл зависшую offline-плашку; recovery/controller и MainLayout PWA-isolation прошли. Дополнительно 2/2 mobile suites (6/6 tests) и 2/2 web files (8/8 tests) подтвердили ограниченную `network.getState`, ручную проверку и доступный текстовый статус; Android SDK 36 подтвердил API 24+ и `NET_CAPABILITY_VALIDATED`, Kotlin/устройство намеренно не запускались |
| Android background settings | app-specific battery intent и OEM fallback в application details покрыты 2/2 тестами; автоматический `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` не используется |
| Device smoke schema v2 | ручная матрица отдельно фиксирует offline preparation/cache miss/recovery, Android validated network, app-specific battery settings и 20 lifecycle-циклов; отчёт содержит явные `passed/failed/not_run` и не собирает сетевые идентификаторы или пользовательское содержимое |
| Native push payload pytest | 6/6 тестов: channel/TTL/category, стабильный task tag, mail notification count и привязка к пользователю |
| Native/Chat push + app outbox pytest | 27/27 тестов прошли; badge передаётся FCM, outbox retry/dedupe не регрессировали |
| Alembic 0101/0102 | один head `20260823_0102`; online SQLite upgrade/downgrade и сервисные проверки 9/9; offline PostgreSQL upgrade/downgrade DDL с обеими `app.*` таблицами сгенерирован без подключения к БД |
| Mobile migration preflight | offline CLI вернул `ready=true`, head `20260823_0102`, production connection отсутствует; preflight + upgrade/downgrade + outbox набор прошёл 14/14 тестов |
| Mobile migration apply harness | PowerShell parser и `-OfflinePlan` прошли, `ProductionConnected=false`, `WritesPerformed=false`; сочетание offline+execute отклонено; pg_dump/Alembic production path не выполнялся |
| Expo native-module autolinking search | `hubit-share-intent` и расширенный `hubit-device-health` найдены, дубликатов нет |
| Auth/App Links regression | IIS подтвердил три полных exchange `200/200/200`, после которых не было `GET /dashboard`; source 1.1.7 использует native ready-message, 15/20-секундные тайм-ауты и не объявляет HTTPS links без explicit release opt-in; 21 профильный mobile/backend тест зелёный |
| Expo config evaluation | source 1.1.7, `versionCode=9`, package `ru.zsgp.hubit.mobile`; default `intentFilters` отсутствует, explicit release opt-in создаёт один `autoVerify` filter |
| `npm run lint` | успешно для текущего source 1.1.7, TypeScript без ошибок |
| Expo dependency checks | `expo install --check`: dependencies up to date; `expo-doctor`: 21/21 проверок прошли |
| Frontend production build | Vite production build прошёл; сохранилось существующее предупреждение о chunks >500 кБ |
| APK size benchmark | актуальный 1.1.6 dual-ABI 48,03 МиБ; предыдущий arm64-only canary 1.1.4 — 34,36 МиБ |
| APK audit | 1.1.6: package/version/code, SHA-256, dual ABI, совместимый debug-preview signer, R8 и resource shrinking подтверждены |
| Publish signer guard | PowerShell parser и release notes 8-item schema прошли; локальный APK 1.1.6 по умолчанию отклонён как `debug-preview`, с явным compatibility-флагом принят; неверный expected fingerprint и rotation без pin отклонены |
| Release signing preparation | PowerShell parser и no-write `-WhatIf` прошли; пути внутри Git, одинаковые пути и два backup на одном томе без явного риска отклонены; реальные keystore/backup ещё не создавались |
| Android assetlinks publication | parser/candidate/debug-audit guards прошли; fixture подтвердил сохранение чужого package entry и адресную замену HUB-IT; web.config 2/2 files, 6/6 tests и frontend production build зелёные; production-файл не публиковался |
| Последний native source → APK | APK 1.1.6 собран успешно за 14 мин 44 с; 607 Gradle-задач, production JS bundle, notification group/mail action/process-exit/connectivity и native Chat скомпилированы |
| Preview публикация | IIS feed обновлён атомарно; внешний manifest/APK post-check вернул `verified=true`; frontend schema v2 parser исправлен и live `/login` показывает прямую ссылку 1.1.6 |
| `adb devices -l` | подключённых устройств нет; device acceptance не выполнялся |

В production 2026-08-23 применены mobile migrations `0101/0102`, затем штатно перезапущен backend; readiness вернул 200. Исправления auth/App Links source 1.1.7 ещё не развёрнуты, новый APK/feed не собирался и не публиковался.

## 12. Нормативные ссылки для реализации

- [Android: runtime permission для уведомлений](https://developer.android.com/develop/ui/compose/notifications/notification-permission)
- [Expo Notifications: background task и notification actions](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo BackgroundTask: WorkManager и минимальный интервал](https://docs.expo.dev/versions/latest/sdk/background-task/)
- [Android: уменьшение размера APK](https://developer.android.com/topic/performance/reduce-apk-size)
- [Android: APK splits по ABI](https://developer.android.com/build/configure-apk-splits)
- [Android: Macrobenchmark](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)
- [Android: создание Baseline Profiles](https://developer.android.com/topic/performance/baselineprofiles/create-baselineprofile)
- [Android: Verified App Links](https://developer.android.com/training/app-links/about)
