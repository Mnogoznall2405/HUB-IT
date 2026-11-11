# Развёртывание HUB Desktop для администраторов

## Выбор пакета

- `HUB-Desktop-Setup-<version>-win-x64.exe` — автономный Burn Setup. Он содержит HUB Desktop,
  WebView2 Evergreen Standalone x64, Windows App SDK Runtime 1.8 x64 и VC++ Runtime x64.
- MSI — только HUB Desktop. Для GPO Software Installation, Intune или SCCM сначала развернуть
  перечисленные Microsoft prerequisites.

Точные имена, версии и SHA-256 вложенных prerequisites фиксируются рядом с release в
`HUB-Desktop-prerequisites.json`. Каждый загруженный prerequisite перед сборкой проверяется как
файл с действующей подписью Microsoft.

Setup и MSI устанавливают приложение для компьютера в
`C:\Program Files\HUB-IT\HUB Desktop`. Профиль каждого пользователя находится в `%LOCALAPPDATA%`
и не удаляется при repair, upgrade или обычном uninstall.

## Тихие команды

```powershell
# автономная установка
HUB-Desktop-Setup-<version>-win-x64.exe /quiet /norestart /log C:\Windows\Temp\hub-desktop-setup.log

# MSI: установка, repair, удаление
msiexec.exe /i HUB-Desktop-<version>-win-x64.msi /qn /norestart /L*v C:\Windows\Temp\hub-desktop-msi.log
msiexec.exe /fa HUB-Desktop-<version>-win-x64.msi /qn /norestart /L*v C:\Windows\Temp\hub-desktop-repair.log
msiexec.exe /x HUB-Desktop-<version>-win-x64.msi /qn /norestart /L*v C:\Windows\Temp\hub-desktop-uninstall.log
```

Успех: код `0`; `3010` означает успешную установку с требованием перезагрузки. Downgrade через MSI
запрещён. Update feed также принимает только строго более новую версию.

## Detection rules

Для x64 registry view:

```text
Key:   HKLM\Software\HUB-IT\Desktop
Value: InstallerVersion
Type:  REG_SZ
Rule:  version >= требуемой major.minor.patch
```

Дополнительно можно проверить `InstalledPath` и наличие `HUB.Desktop.exe`. Не использовать наличие
пользовательского WebView2-профиля как detection rule.

## Upgrade, repair и удаление

- major upgrade закрывает работающий HUB и заменяет установочные файлы;
- repair восстанавливает Program Files и ярлык, но не трогает `%LOCALAPPDATA%`;
- uninstall удаляет приложение и ярлык, но сохраняет web-сессию/настройки пользователя;
- полное удаление профиля выполняется отдельно, только для конкретной учётной записи после выхода
  из HUB. Удаление `%LOCALAPPDATA%\HUB-IT\Desktop` сбрасывает session, cache, настройки и логи и
  не должно включаться в обычный uninstall.

## GPO

GPO необязателен. Без него пользователь управляет autostart как раньше. Полный список и установка
ADMX описаны в `documentation/technical/HUB_DESKTOP_GPO.md`. Приоритет:

```text
machine policy → user preference → safe default
```

Не создавайте собственные registry-параметры для BaseUrl, feed URL или TLS: клиент их не читает.
Шаблоны каждого выпуска находятся в `HUB-Desktop-Policy-Templates.zip` рядом с Setup/MSI.
