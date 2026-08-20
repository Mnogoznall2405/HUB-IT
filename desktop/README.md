# HUB Desktop

Документы развития:

- [`ROADMAP.md`](./ROADMAP.md) — техническая карта выпусков, updater, MSI/GPO, безопасность и 1.0;
- [`FUNCTIONAL_ROADMAP.md`](./FUNCTIONAL_ROADMAP.md) — новая функциональная карта: Windows shell,
  быстрые действия, deep links, печать, поиск и корпоративный повторный вход.

Windows desktop-shell для корпоративного портала HUB. Клиент не содержит отдельной бизнес-логики и открывает существующий React/FastAPI портал в WPF WebView2.

Полный план развития: [ROADMAP.md](./ROADMAP.md).

## Текущий scope

- WPF на .NET 8;
- постоянный профиль WebView2 в `%LOCALAPPDATA%\HUB-IT\Desktop\WebView2`;
- стандартные autofill и password manager WebView2 включены: после согласия пользователя сохранённый логин подставляется из его локального профиля, а приложение не читает и не хранит AD-пароль самостоятельно;
- production origin `https://hubit.zsgp.ru`;
- внешние HTTPS- и `mailto:`-ссылки открываются системным обработчиком;
- остальные внешние схемы блокируются;
- certificate errors не игнорируются;
- DevTools и browser accelerator keys отключены в Release;
- локальный offline/error overlay и безопасные rolling-логи;
- закрытие окна скрывает приложение в tray, не останавливая WebView/WebSocket, и переводит WebView2 в режим пониженного потребления памяти;
- диагностика раз в 10 секунд собирает private memory и working set оболочки и процессов WebView2, хранит не более 30 минут и экспортирует в support bundle только агрегаты по безопасному имени раздела и состоянию окна (без query-параметров и пользовательского содержимого);
- повторный запуск активирует уже работающий экземпляр через per-user named pipe;
- один процесс поддерживает до двух независимых окон с общей авторизацией и отдельной навигацией;
- второе окно открывается кнопкой в заголовке или `Ctrl+Shift+N`, копируя только безопасный внутренний маршрут без токенов и auth-страниц;
- кнопка в заголовке, пункт tray и `Ctrl+F5` перезагружают портал без HTTP/PWA-кэша, не удаляя профиль, cookies и сохранённый логин;
- компактное фирменное меню tray использует логотип HUB; левый клик по значку сразу открывает окно;
- явный выход доступен из контекстного меню tray;
- per-user autostart включается автоматически при первом запуске и переключается из tray без прав администратора;
- отдельные Desktop-настройки управляют видимостью при входе в Windows, стартовой страницей,
  одноразовым напоминанием при X и opt-in `Ctrl+Shift+H` с обнаружением конфликта;
- `hubit://`, Jump List, permission-aware tray routes и `Ctrl+K` открывают только строгие внутренние маршруты;
- окно загрузок поддерживает Cancel/Clear/Open folder, а taskbar показывает общий прогресс;
- системный режим темы выбирается в настройках портала и следует Windows;
- versioned React/C# handshake определяет desktop runtime до первого React render;
- системные уведомления для новых сообщений чата: Windows App SDK toast с автоматическим fallback на tray balloon;
- клик по уведомлению активирует HUB и открывает переданный внутренний маршрут чата через React Router без перезагрузки страницы.

## Требования

- Windows 10/11;
- .NET 8 SDK для сборки;
- Microsoft Edge WebView2 Evergreen Runtime на компьютере пользователя (рекомендуемый Setup содержит автономный x64 installer);
- Microsoft Windows App SDK 1.8 встроен в клиент (servicing-версия `1.8.260710003`); Setup устанавливает системный Singleton-компонент для app notifications;
- Microsoft Visual C++ Redistributable x64 для unpackaged Windows App SDK runtime.

Запускайте `HUB.Desktop.exe` без повышения прав. При случайном запуске от администратора
Windows App SDK toast недоступен, поэтому клиент автоматически использует уведомление
через значок HUB в tray.

Если Windows App SDK Runtime недоступен или регистрация toast не поддерживается системой, desktop-клиент продолжает работать и использует тот же tray fallback. React capability `notifications: true` сохраняется, пока доступен tray.

## Сборка и тесты

```powershell
dotnet restore desktop\Hub.Desktop.sln
dotnet test desktop\Hub.Desktop.sln -c Release
dotnet build desktop\Hub.Desktop.sln -c Release --no-restore
dotnet publish desktop\Hub.Desktop\Hub.Desktop.csproj -p:PublishProfile=win-x64 --no-restore
powershell -ExecutionPolicy Bypass -File scripts\desktop\publish.ps1 -NoRestore
powershell -ExecutionPolicy Bypass -File scripts\desktop\build-installer.ps1 -NoRestore
powershell -ExecutionPolicy Bypass -File scripts\desktop\validate-policy-templates.ps1
```

Запуск Debug-сборки:

```powershell
dotnet run --project desktop\Hub.Desktop\Hub.Desktop.csproj
```

Только в Debug можно переопределить адрес локального портала:

```powershell
$env:HUB_DESKTOP_BASE_URL='http://localhost:5173/'
dotnet run --project desktop\Hub.Desktop\Hub.Desktop.csproj
```

Release-сборка принимает из `appsettings.json` только закреплённый origin `https://hubit.zsgp.ru/`; environment override в Release не поддерживается.

## Publish win-x64

Профиль `Properties/PublishProfiles/win-x64.pubxml` создаёт folder-based unpackaged публикацию:

- .NET 8 — self-contained, отдельная установка .NET Runtime пользователю не требуется;
- Windows App SDK — self-contained; HUB не запускает DDLM/bootstrapper, а Setup добавляет только необходимый системный runtime-компонент для app notifications;
- WebView2 — Evergreen Runtime устанавливается отдельно;
- trimming, single-file и ReadyToRun отключены для предсказуемой совместимости WPF/WebView2;
- отдельный self-contained `HUB.Desktop.UpdateRunner.exe` вкладывается в publish для установки обновлений после закрытия основного процесса;
- MSI, GPO и Authenticode code signing в этот профиль не входят.

Результат:

```text
desktop\Hub.Desktop\bin\Release\net8.0-windows10.0.17763.0\win-x64\publish\
```

Для запуска нужна вся папка, а не только `HUB.Desktop.exe`.

Скрипт `scripts/desktop/publish.ps1` дополнительно создаёт версионированный ZIP и файл SHA-256 в соседнем каталоге `package`. Без `-NoRestore` скрипт сначала выполняет штатный restore через `dotnet publish`.

## Установщик

`scripts/desktop/build-installer.ps1` собирает два артефакта:

- `HUB-Desktop-Setup-<version>-win-x64.exe` — рекомендуемый полностью offline-установщик с WebView2 Evergreen Standalone x64, Windows App SDK Runtime 1.8 x64 и Microsoft Visual C++ Redistributable x64;
- `HUB-Desktop-<version>-win-x64.msi` — только приложение, для компьютеров, где системные зависимости уже развёрнуты отдельно.

Оба файла и их `.sha256` создаются в:

```text
desktop\Hub.Desktop\bin\Release\net8.0-windows10.0.17763.0\win-x64\package\
```

Release gate также создаёт детерминированный CycloneDX 1.5
`HUB-Desktop-<version>-win-x64.cdx.json` и SHA-256 sidecar. SBOM включает production NuGet packages
и встроенные Microsoft prerequisites; `scripts/desktop/test-dependencies.ps1` отдельно проверяет
известные уязвимости через официальный NuGet audit source.

Setup и MSI устанавливают клиент для всего компьютера в `C:\Program Files\HUB-IT\HUB Desktop\`, создают общий ярлык меню «Пуск», поддерживают обновление поверх предыдущей версии и закрывают запущенный клиент перед заменой файлов. WebView2-профиль и пользовательские настройки при обновлении и удалении не стираются.

Тихая установка и удаление:

```powershell
HUB-Desktop-Setup-<version>-win-x64.exe /quiet /norestart
HUB-Desktop-Setup-<version>-win-x64.exe /uninstall /quiet /norestart
```

Собранные HUB Desktop MSI/Setup пока не подписаны корпоративным сертификатом; скачанные пререквизиты проверяются скриптом по действительной подписи Microsoft до упаковки.

## Автообновление

Версия `0.1.6` — последняя ручная bootstrap-установка. Начиная с `0.1.7`, клиент проверяет
`https://hubit.zsgp.ru/desktop-updates/stable/latest.json` через 30–120 секунд после запуска
и затем каждые 12 часов. Проверка и загрузка идут в фоне, включая работу скрытого в tray клиента.

Пакет сначала записывается как `.partial` в `%LOCALAPPDATA%\HUB-IT\Desktop\Updates`, после чего
проверяются размер, SHA-256 и подпись manifest RSA-PSS-SHA256. Клиент принимает только строго более
новую `major.minor.patch` версию из stable-канала и только с закреплённого HTTPS origin.

Готовое обновление отображается постоянной плашкой под заголовком и пунктом
`Обновление готово` в tray. `Позже` скрывает только плашку на 24 часа. При установке отдельный
Update Runner закрывает HUB, запрашивает UAC, тихо запускает Setup и затем открывает HUB уже без
повышения прав. Отмена UAC или ошибка Setup возвращает прежнюю версию; WebView2-профиль, сессия и
autostart находятся вне каталога установки и сохраняются.

Release-публикация выполняется так:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\desktop\publish-update.ps1 `
  -IisUpdateRoot '\\hubit-server\hub-desktop-updates$' `
  -ReleaseNotes 'Что изменилось в версии' -NoRestore
```

Скрипт собирает Setup/MSI, считает SHA-256, подписывает строгий manifest private key активного
production TLS-сертификата из `Cert:\LocalMachine\My` и атомарно заменяет `stable/latest.json`.
Приватный ключ не экспортируется и не попадает в репозиторий, артефакты или IIS content root.
Закреплённый public certificate: `0A9CFEF49EB1E11819D81A351978BAFA05EF7CBE`, `key_id`
`hubit-zsgp-ru-tls-2026-04`. Это принятое исключение объединяет риск HTTPS и updater; правила
выпуска и ротации описаны в
[`HUB_DESKTOP_RELEASE_RUNBOOK.md`](../documentation/technical/HUB_DESKTOP_RELEASE_RUNBOOK.md) и
[`HUB_DESKTOP_UPDATE_KEY_ROTATION.md`](../documentation/technical/HUB_DESKTOP_UPDATE_KEY_ROTATION.md).

IIS-каталог создаётся отдельно от публикации frontend:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\iis\setup_desktop_update_feed.ps1
```

Аварийное отключение выполняется удалением или переименованием `stable/latest.json`: это не мешает
работе самого HUB. Setup/MSI пока без Authenticode, поэтому Windows может показать
`Неизвестный издатель` даже при успешно проверенной внутренней подписи manifest.

## Поведение окна

- кнопка закрытия и `Alt+F4` скрывают окно в область уведомлений;
- один левый клик по значку или пункт `Открыть HUB` возвращает окно;
- повторный запуск `HUB.Desktop.exe` возвращает уже открытое окно;
- кнопка второго окна и `Ctrl+Shift+N` создают окно `HUB Desktop — окно 2`, а при достигнутом лимите активируют его;
- кнопка обновления в заголовке, пункт `Обновить портал без кэша` и `Ctrl+F5` заново загружают текущую страницу HUB, минуя кэш;
- оба окна изменяются мышью за любой край или угол; минимальный размер — `640×480`, размер основного окна сохраняется;
- крестик основного окна скрывает его в tray, крестик второго полностью закрывает только второе окно;
- после перезапуска автоматически восстанавливается только основное окно;
- пункт `Запускать вместе с Windows` включает или выключает autostart для текущего пользователя;
- пункт `Выйти` завершает WebView и процесс приложения.
- пункт `Настройки Desktop` выбирает открытый/скрытый запуск при входе, Главную/последнюю безопасную
  страницу и глобальный `Ctrl+Shift+H`; занятое другой программой сочетание не регистрируется.

## Autostart

Переключатель в tray управляет только значением `HUB-IT Desktop` в:

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
```

Команда содержит полный путь к текущему `HUB.Desktop.exe` и аргумент `--background`. При входе в Windows клиент запускается скрытым в tray, инициализирует WebView2 в режиме пониженного потребления памяти и сохраняет realtime-соединение. При открытии активного окна WebView2 возвращается в обычный режим. По умолчанию машинный `HKLM`, Scheduled Task и права администратора для autostart не используются. Необязательная GPO может только принудительно включить/выключить autostart, не перезаписывая сохранённый выбор пользователя; см. [`HUB_DESKTOP_GPO.md`](../documentation/technical/HUB_DESKTOP_GPO.md).

При первом запуске autostart включается автоматически. Явный выбор пользователя хранится в `HKCU\Software\HUB-IT\Desktop\AutostartEnabled`: после отключения клиент не включает autostart повторно. При обновлении пути к EXE включённая команда автоматически исправляется.

## Производительность в VM и RDP

WebView2 требует рабочего WDDM-видеодрайвера для плавного аппаратного рендеринга. Если виртуальная машина видит только `Microsoft Basic Display Adapter`, а WPF сообщает `Render Tier 0`, интерфейс рендерится программно и может заметно подтормаживать. Для VMware установите поддерживаемый `VMware SVGA 3D` из VMware Tools; для RDP-сервера при наличии доступного GPU включите политику `Use hardware graphics adapters for all Remote Desktop Services sessions` и перезагрузите VM. Не передавайте WebView2 принудительные GPU-флаги при отсутствующем драйвере.

## Desktop bridge v1

Протокол выполняет handshake и передаёт только строго типизированные команды уведомления и внутренней навигации.

```text
React -> C#: {"type":"desktop.ready","version":1}
C# -> React: {"type":"desktop.hostReady","version":1,"capabilities":{"notifications":true}}
React -> C#: {"type":"notification.show","version":1,"id":"chat:msg:42","title":"Иван","body":"Новое сообщение","route":"/chat?conversation=7&message=42"}
C# -> React: {"type":"navigation.open","version":1,"route":"/chat?conversation=7&message=42"}
```

Host принимает сообщение только при точном совпадении configured origin, текущего WebView origin, версии, размера и JSON-схемы. Неизвестные типы и дополнительные поля отклоняются. `route` обязан быть относительным внутренним путём; внешние URL, protocol-relative URL, backslash и управляющие символы блокируются. Текст уведомления в лог не записывается.

## Уведомления чата

- существующее событие WebSocket обрабатывается React-кодом и передаётся через desktop bridge — отдельный socket или backend endpoint не добавлялся;
- после успешного native handshake Web Push для desktop-shell не запускается, поэтому одно сообщение не дублируется двумя системными уведомлениями;
- клик по Windows toast или его tray fallback поднимает окно из tray и открывает `/chat` с параметрами диалога и сообщения через React Router;
- если React ещё загружается, сохраняется только последний pending route и выполняется после handshake;
- разрешение браузерных уведомлений внутри WebView для native-пути не запрашивается.

## Локальные данные

```text
%LOCALAPPDATA%\HUB-IT\Desktop\
├── WebView2\   # cookies, storage, cache, permissions
├── Logs\       # rolling logs без токенов и содержимого сообщений
└── Updates\    # проверенные Setup, manifest и временный Update Runner
```

Удаление каталога `WebView2` завершит сохранённую web-сессию пользователя.
