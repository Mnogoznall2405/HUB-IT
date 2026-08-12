# HUB Desktop: GPO и границы управляемых политик

HUB Desktop работает без GPO. Политики предназначены только для централизованного управления
корпоративными ПК и читаются при запуске процесса из:

```text
HKLM\Software\Policies\HUB-IT\Desktop
```

Шаблоны находятся в `desktop/policy/HUBDesktop.admx` и
`desktop/policy/ru-RU/HUBDesktop.adml`. После изменения политики следует выполнить `gpupdate` и
перезапустить HUB Desktop через пункт «Выйти» в tray.

## Разрешённые DWORD

| Значение | Допустимые данные | Поведение |
|---|---:|---|
| `AutostartMode` | `0`, `1`, `2` | выбор пользователя, принудительно включён, принудительно выключен |
| `UpdatesEnabled` | `0`, `1` | аварийно отключает или включает updater |
| `UpdateDeferralHours` | `0..168` | срок «Позже»; `0` скрывает кнопку |
| `DiagnosticsExportEnabled` | `0`, `1` | запрещает или разрешает создание support bundle |
| `NotificationFallbackEnabled` | `0`, `1` | управляет только тематическим fallback, не Windows toast |

Значения другого типа или вне диапазона игнорируются. Если политика отсутствует или удалена,
применяется сохранённый выбор пользователя, затем безопасное значение по умолчанию. Принудительный
режим autostart не перезаписывает пользовательский `HKCU`-выбор, поэтому после удаления GPO прежнее
поведение восстанавливается.

## Что намеренно невозможно через GPO

- изменить production origin `https://hubit.zsgp.ru/`;
- изменить update feed или stable-канал;
- отключить TLS validation;
- передать shell-команду или программу для открытия файла;
- передать AD password, token, cookie или другое удостоверение пользователя.

Политики не считаются authentication proof и не меняют серверные session, 2FA и trusted-device
правила.

## Установка административного шаблона

Для локального теста скопировать ADMX в `%WINDIR%\PolicyDefinitions`, а ADML — в
`%WINDIR%\PolicyDefinitions\ru-RU`. Для домена разместить те же файлы в Central Store. Политики
появятся в разделе Computer Configuration → Administrative Templates → HUB Desktop.
