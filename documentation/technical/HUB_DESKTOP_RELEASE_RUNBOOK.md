# HUB Desktop — release runbook

## Назначение

Этот runbook описывает воспроизводимый выпуск HUB Desktop через MSI/Setup и стабильный update feed.
Web frontend, backend, авторизация, WebSocket и WebView2 profile этим процессом не публикуются и не
изменяются.

Production update feed:

```text
https://hubit.zsgp.ru/desktop-updates/stable/latest.json
https://hubit.zsgp.ru/desktop-updates/stable/<version>/HUB-Desktop-Setup-<version>-win-x64.exe
```

## Доверенная подпись manifest

- алгоритм: `RSA-PSS-SHA256`;
- `key_id`: `hubit-zsgp-ru-tls-2026-04`;
- сертификат: `CN=*.zsgp.ru`;
- thumbprint: `0A9CFEF49EB1E11819D81A351978BAFA05EF7CBE`;
- store: `Cert:\LocalMachine\My`;
- срок действия: до 7 ноября 2026 года;
- public certificate встроен в `DesktopUpdateTrust.cs`;
- private key не экспортируется и не копируется в Git, package или IIS content root.

Это прикладная подпись update manifest. Она не является Authenticode. До получения Code Signing
сертификата Setup/MSI имеют ожидаемый статус `NotSigned`, а UAC показывает «Неизвестный издатель».

## Предварительные условия

1. Рабочее дерево и release scope просмотрены ответственным за выпуск.
2. Версия в `desktop/Hub.Desktop/Hub.Desktop.csproj` имеет формат `major.minor.patch`.
3. Release notes не содержат секретов, URL с query и пользовательский контент.
4. На release-машине доступны private key production TLS-сертификата и отдельная release-учётная
   запись с минимальными правами на ключ.
5. До окончания сертификата больше 30 дней.
6. IIS-каталог update feed находится вне frontend mirror/MIR-каталога.
7. Путь публикации пуст для новой версии: version folder после публикации неизменяемый.

## Локальный release gate

Из корня репозитория:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\desktop\test-release.ps1
```

Для повторного запуска с уже восстановленными зависимостями:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\desktop\test-release.ps1 -NoRestore
```

Команда последовательно выполняет Desktop tests/build, проверку известных NuGet-уязвимостей,
валидацию ADMX/ADML, выбранную frontend-регрессию, production frontend build, сборку
ZIP/MSI/Setup, генерацию CycloneDX SBOM и `validate-release.ps1`. Проверка уязвимостей требует
доступа к официальному NuGet audit source и fail-closed при сетевой ошибке.

Отдельные проверки:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\desktop\inspect-msi.ps1 `
  -Path desktop\Hub.Desktop\bin\Release\net8.0-windows10.0.17763.0\win-x64\package\HUB-Desktop-<version>-win-x64.msi

powershell -ExecutionPolicy Bypass -File scripts\desktop\validate-release.ps1

powershell -ExecutionPolicy Bypass -File scripts\desktop\test-dependencies.ps1

powershell -ExecutionPolicy Bypass -File scripts\desktop\generate-sbom.ps1

powershell -ExecutionPolicy Bypass -File scripts\desktop\publish-update.ps1 `
  -IisUpdateRoot C:\unused `
  -ValidateSigningCertificateOnly
```

`validate-release.ps1` обязан подтвердить:

- точную версию, ProductCode и постоянный UpgradeCode MSI;
- наличие обязательных runtime-файлов;
- отсутствие `.pdb`, private keys, `.partial` и `.tmp` в publish;
- совпадение SHA-256 sidecar;
- валидный детерминированный CycloneDX 1.5 SBOM и его SHA-256 sidecar без абсолютных путей и
  маркеров секретов;
- ожидаемый Authenticode status `NotSigned` либо `Valid` после отдельного перехода на Code Signing.

## Публикация update

Для защищённой publish-share:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\desktop\publish-update.ps1 `
  -IisUpdateRoot '\\hubit-server\hub-desktop-updates$' `
  -ReleaseNotes 'Краткое изменение 1','Краткое изменение 2' `
  -NoBuild
```

Перед обращением к IIS publish-скрипт заново создаёт SBOM и запускает полный локальный
`validate-release.ps1`, в том числе при `-NoBuild`. Затем скрипт:

1. Проверяет production TLS-сертификат, SAN, EKU, срок, self-signed status и private key.
2. Считает размер и SHA-256 уже проверенного Setup.
3. Формирует canonical payload строгого manifest.
4. Подписывает payload отдельным минимальным signer-процессом через Windows certificate store.
5. Выполняет локальную RSA-PSS self-check.
6. Копирует Setup и version manifest во временный каталог.
7. Перемещает каталог в immutable `stable/<version>`.
8. Последним атомарно заменяет `stable/latest.json`.

Уже существующий version folder скрипт не перезаписывает.

Локальный release archive должен сохранять вместе:

- Setup, MSI и portable ZIP с `.sha256`;
- `HUB-Desktop-prerequisites.json`;
- `HUB-Desktop-Policy-Templates.zip` с `.sha256`;
- `HUB-Desktop-<version>-win-x64.cdx.json` с `.sha256`;
- опубликованный `manifest.json` и release notes.

## Проверка опубликованного пакета тем же UpdateCore

```powershell
powershell -ExecutionPolicy Bypass -File scripts\desktop\verify-update-manifest.ps1 `
  -ManifestPath '<update-root>\stable\latest.json' `
  -SetupPath '<update-root>\stable\<version>\HUB-Desktop-Setup-<version>-win-x64.exe'
```

Затем проверить HTTPS без redirect:

```powershell
curl.exe -I --max-redirs 0 https://hubit.zsgp.ru/desktop-updates/stable/latest.json
curl.exe -I --max-redirs 0 https://hubit.zsgp.ru/desktop-updates/stable/<version>/HUB-Desktop-Setup-<version>-win-x64.exe
```

## Rollout

Результаты фиксируются по обязательному шаблону
[`HUB_DESKTOP_COMPATIBILITY_MATRIX.md`](./HUB_DESKTOP_COMPATIBILITY_MATRIX.md). `Not run` в
обязательной ручной строке не заменяется успешной автоматической сборкой.

1. Проверить update на 2–3 пилотных ПК.
2. Отдельно записать результат Windows 10 и Windows 11.
3. Проверить открытое, свёрнутое и скрытое в tray приложение.
4. Проверить UAC accept/cancel и Setup failure.
5. Убедиться, что сохранены WebView2 profile/session, autostart и текущий маршрут.
6. Только после этого оставить `latest.json` доступным массовой группе.

## Аварийное отключение

Убрать или переименовать только `stable/latest.json`. Не публиковать downgrade под тем же URL и не
перезаписывать version folder. Работа HUB продолжится; уже скачанный проверенный пакет может
оставаться в локальном update cache до штатной очистки.

При компрометации TLS private key одновременно выполнить аварийное отключение feed, замену/отзыв
TLS-сертификата и процедуру из `HUB_DESKTOP_UPDATE_KEY_ROTATION.md`.
