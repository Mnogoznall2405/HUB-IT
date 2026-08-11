# HUB Desktop

Windows desktop-shell для корпоративного портала HUB. Клиент не содержит отдельной бизнес-логики и открывает существующий React/FastAPI портал в WPF WebView2.

## Текущий scope

- WPF на .NET 8;
- постоянный профиль WebView2 в `%LOCALAPPDATA%\HUB-IT\Desktop\WebView2`;
- production origin `https://hubit.zsgp.ru`;
- внешние HTTPS- и `mailto:`-ссылки открываются системным обработчиком;
- остальные внешние схемы блокируются;
- certificate errors не игнорируются;
- DevTools и browser accelerator keys отключены в Release;
- локальный offline/error overlay и безопасные rolling-логи.

Tray, autostart, React/C# bridge и Windows notifications намеренно не входят в этот этап.

## Требования

- Windows 10/11;
- .NET 8 SDK для сборки;
- Microsoft Edge WebView2 Evergreen Runtime на компьютере пользователя.

## Сборка и тесты

```powershell
dotnet restore desktop\Hub.Desktop.sln
dotnet test desktop\Hub.Desktop.sln -c Release
dotnet build desktop\Hub.Desktop.sln -c Release --no-restore
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

Release-сборка всегда читает HTTPS origin из `appsettings.json`; environment override в Release не поддерживается.

## Локальные данные

```text
%LOCALAPPDATA%\HUB-IT\Desktop\
├── WebView2\   # cookies, storage, cache, permissions
└── Logs\       # rolling logs без токенов и содержимого сообщений
```

Удаление каталога `WebView2` завершит сохранённую web-сессию пользователя.
