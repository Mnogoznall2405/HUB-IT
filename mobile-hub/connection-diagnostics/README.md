# HUB-IT — диагностика подключения Android без USB

Отдельный APK `ru.zsgp.hubit.connectiondiagnostics`, Android 8+ (API 26), target SDK 36.
Устанавливается рядом с основным HUB-IT. Не требует входа, USB или нового сервиса.
Нажать **«Проверить подключение»**, затем **«Поделиться отчётом»** или
**«Скопировать отчёт»**. JSON можно вставить прямо в чат.

По нажатию проверяется только `https://hubit.zsgp.ru/api/v1/auth/me`:

1. Системный DNS Android, до 5 секунд. В отчёте — количество адресов,
   семейства IPv4/IPv6 и категории ожидаемых адресов публикации; самих адресов нет.
2. TCP 443: адреса из DNS проверяются в пределах общего бюджета 5 секунд.
3. TLS: системная фабрика Android, SNI имени HUB-IT и HTTPS hostname validation.
   Проверка доверия и срока сертификата включена. В отчёте — версия TLS,
   даты и SHA-256 сертификатов, наличие GlobalSign R46 в доступных доверенных CA.
4. HTTP/1.1 GET без токенов, cookie, device ID и переходов по redirect.
   Читается только ограниченная строка статуса; тела и заголовки не собираются.
   `401` ожидается без входа и подтверждает доступность API; `404`/`502` позволяют
   отличить ответ IIS/reverse proxy от ошибки HTTPS. Код `200` подтверждает получение
   успешного HTTP-ответа, но содержимое API этим тестом не проверяется.

Сообщения и stack trace исключений не выводятся: только фиксированные коды,
включая вложенные ошибки недоверенного, просроченного и ещё не действующего
сертификата. Отчёт не содержит IP телефона, SSID, данные аккаунта или переписку.

## Сборка

Из корня проекта:

```powershell
./scripts/mobile/build-connection-diagnostics.ps1
./scripts/mobile/build-connection-diagnostics.ps1 -TestOnly
```

`-TestOnly` проверяет классификацию вложенных TLS/DNS/timeout-ошибок, безопасный разбор
HTTP-статуса и исключение исходного текста без сетевых вызовов. Это не заменяет
приёмку на телефоне.

Microsoft JDK 17 и Android SDK platform/build-tools 36 размещаются в игнорируемом
`tools/android-diagnostics/`. Можно задать `-ToolchainRoot` с такой структурой:

```text
jdk17/<jdk distribution>/bin/
platform-36/android-36/android.jar
build-tools-36/android-16/{aapt2.exe,zipalign.exe,lib/d8.jar,lib/apksigner.jar}
```

`android-16` — имя внутри официального архива build-tools 36.0.0.
Каталог SDK-архивов: `https://dl.google.com/android/repository/repository2-3.xml`;
JDK: `https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip`.

Результат: `artifacts/mobile/connection-diagnostics/HUB-IT-Connection-Diagnostics-1.0.0.apk`
и `.audit.json` с размером/SHA-256. Проверяются APK-подпись, выравнивание, manifest,
min/target SDK. Каждый прогон использует новый каталог в `tmp/`.

Отдельный ключ подписи — в `tools/android-diagnostics/signing/`; пароль зашифрован
DPAPI и передаётся инструментам через временную переменную окружения. Эта подпись
только для диагностического пакета; основной APK ею не обновлять. Нужен доступ
к профилю Windows для DPAPI.

## Границы проверки

Утилита использует системный `SSLSocket` и HTTP/1.1, основной клиент — React Native/
OkHttp. Успех утилиты не исключает проблему HTTP/2, ограничений конкретного приложения,
сохранённых соединений, прокси/VPN с правилами для отдельных приложений или
авторизованных запросов. Дата/время отчёта берутся с телефона. До приёмки на устройстве
в build-аудите остаётся `deviceAcceptance: not_run`.

Скрипт не публикует APK и не меняет IIS, сертификаты, основной update feed или
серверные процессы. Публикация — отдельно по явному запросу.
