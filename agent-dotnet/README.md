# HUB-IT Agent (C#) — переписывание Windows-агента

Новое решение на .NET 8, которое заменяет `agent.py` (Python) без изменения
контракта с сервером. Формат payload, имена полей, каталоги спула, файл статуса
и переменные окружения/Msi-свойства совместимы с текущим агентом.

Статус: **фаза 8** — инвентарь, Outlook, профили, `fs_egress`, история браузеров,
интерактивный browser probe, scan (PDF-срезы, self_update/install_package/disable probes),
reboot reminder, MSI.
Не перенесены: Telegram/MAX probes (выключены с 1.4.17).

## Структура

```text
agent-dotnet/
├── Hub.Agent.sln
├── src/
│   ├── Hub.Agent.Core/          # конфиг, коллекторы, транспорт, спул, логи
│   └── Hub.Agent/               # ITInventAgent.exe (entrypoint, CLI)
├── installer/                   # WiX v5 MSI (отдельный продукт, не трогает Python-агент)
├── tests/Hub.Agent.Tests/       # xunit: конфиг, очередь, ACK, EDID, текст
└── scripts/parity-check.ps1     # сравнение payload Python vs C# на одной машине
```

## Что уже перенесено

| Блок | Python | C# | Комментарий |
|---|---|---|---|
| Конфиг `.env`, defaults, клампы | `load_config` | `AgentConfig` | 1:1, включая имена переменных |
| Лог `itinvent_agent.log` + 2 ротации | `setup_logging` | `AgentLog` | 10 МБ, 3 файла |
| Очередь `Spool/inventory/pending|dead_letter` | `send_data` | `InventorySpool` | формат item и имя файла совместимы |
| HTTP + `X-API-Key` + ACK `success:true` | `_post_payload` | `InventoryClient` | ретраи 0/2/5/15 с |
| Host/OS/CPU/RAM/серийник | `agent.py` | `HostCollector`, `SystemCollector` | WMI вместо PowerShell |
| Диски логические и физические | `get_logical_disks`, `get_storage_info` | `DiskCollector` | `MSFT_PhysicalDisk` + `Win32_DiskDrive` + reliability counters (Wear/Temperature) |
| Мониторы + EDID | `get_monitors` | `MonitorCollector` | WMI + реестр |
| Сеть | `get_network_info` | `NetworkCollector` | `Win32_NetworkAdapter` + `NetworkInterface` |
| ПО (HKLM/HKCU/HKU + Store) | `collect_software_inventory` | `SoftwareCollector` | Store пока через один PowerShell-вызов |
| Security posture | `get_security_info` | `SecurityCollector` | firewall/Defender/BitLocker/TPM/RDP/admins/SecureBoot |
| USB-история | `collect_usb_devices` | `UsbCollector` | реестр USBSTOR + PnP |
| fs_egress (вынос файлов) | `fs_egress/` sidecar | `FsEgressService` | FileSystemWatcher, тот же спул и POST `/fs-egress` |
| История браузеров | `browser_probe/history_agent.py` | `BrowserHistoryService` | Chromium History, те же курсоры и POST `/browser-probe` |
| Scan (DLP) | `scan_agent/agent.py` | `ScanAgentService` | 19 regex, text/document upload, outbox, poll задач |
| Интерактивный browser probe | `browser_probe/` (exe) | `ITInventBrowserProbe.exe` | foreground, UIA-адрес, скриншоты, история, media-sync |
| Reboot reminder | `maybe_notify_reboot_required` | `RebootReminder` | msg.exe, окно 9–18, состояние |
| Outlook PST/OST | `collect_outlook_info` | `OutlookCollector` | те же пути, state-файл и выбор active store |
| Размеры профилей | `collect_user_profile_sizes` | `ProfileSizesCollector` | те же бюджеты, кеш 24 ч, partial reasons |
| Health/ops_health | `get_health_info`, `build_ops_health` | `HealthCollector` | psutil заменён на Win32 API |
| Статус `agent_status.json` | `_write_agent_status` | `AgentRunner` | тот же набор полей |

### Ещё не перенесено (фаза 2+)

- Telegram/MAX probes — сознательно не переносятся (выключены с 1.4.17).

## Проверка паритета

На этой машине (Windows Server 2022, VM) C# и Python дали одинаковые значения:

```text
hostname, mac_address, system_serial, cpu_model          OK
os_info.caption/build_number/install_date                OK
logical_disks (1), storage (0), monitors (0)             OK
network devices (2), summary, gateway, dns               OK
security keys (antivirus, bitlocker, firewall, tpm, ...) OK
software count (23), usb count (0)                       OK
updates.last_hotfix_date                                 OK
outlook (source/confidence/status/archives)              OK
user_profile_sizes (1 профиль, drift 0.00%)              OK
```

Профили проверяются отдельно, потому что скан занимает время:

```powershell
powershell -File agent-dotnet\scripts\parity-check.ps1 -IncludeProfiles
```

Запуск сравнения:

```powershell
powershell -File agent-dotnet/scripts/parity-check.ps1
```

## Сборка и тесты

```powershell
tools\dotnet-sdk-8\dotnet.exe build agent-dotnet\Hub.Agent.sln -c Release
tools\dotnet-sdk-8\dotnet.exe test  agent-dotnet\Hub.Agent.sln -c Release
```

Self-contained single-file (не требует .NET на машине):

```powershell
tools\dotnet-sdk-8\dotnet.exe publish agent-dotnet\src\Hub.Agent\Hub.Agent.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true -o agent-dotnet\dist\agent-win-x64
```

Результат: `ITInventAgent.exe` ~33,7 МБ одним файлом (Python-агент:
119,4 МБ / 723 файла, MSI 51 МБ).

## fs_egress

Встроен в основной процесс (в Python это sidecar-поток):

- USB-диски (включая внешние HDD/SSD на USB-шине), сетевые диски, профильные папки
  `Desktop/Documents/Downloads/Pictures/Videos/Music` и `OneDrive*` (только удаления);
- debounce 0.75 с, лимит 30 событий/с, обновление корней раз в 30 с;
- спул `Spool\fs_egress\{pending,sent,dead_letter,inbox}`, POST
  `{server}/api/v1/inventory/fs-egress` c `X-API-Key`, батчами;
- `agent_runtime.sidecars.fs_egress` = `enabled/alive/pending/dead_letter/last_sent_at`.

Переменные: `ITINV_FS_EGRESS_ENABLED`, `_SPOOL`, `_SERVER_URL`, `_MAX_PENDING`,
`_DEBOUNCE_SEC`, `_RATE_LIMIT`, `_ROOTS_REFRESH_SEC`, `_PROFILE_DELETES`, `_DRAIN_SEC`, `_BATCH`.

## История браузеров (history-only)

Встроена в основной процесс, по умолчанию **выключена**
(`ITINV_BROWSER_HISTORY_ENABLED=0`), как и Python-sidecar:

- Chromium-профили всех пользователей (`Chrome`, `Edge`, `Yandex`), таблицы `visits/urls`;
- курсоры в `state.json`, первый цикл только запоминает `MAX(id)` — без выгрузки всей истории;
- классификация `work/entertainment/other` и фильтр `chrome://`/new-tab;
- очередь `pending_upload.json` → `inflight_upload.json` → POST `{server}/api/v1/inventory/browser-probe`;
- переменные: `ITINV_BROWSER_HISTORY_SEC` (180), `ITINV_BROWSER_HISTORY_OUTPUT`,
  `ITINV_BROWSER_PROBE_SYNC_SEC` (120), `ITINV_BROWSER_WORK_DOMAINS`.

Foreground-трекинг, UIA-адресная строка и скриншоты вынесены в отдельный
`ITInventBrowserProbe.exe` (интерактивная сессия, автозапуск через Startup):

- окно браузера (Chrome/Edge/Yandex), адрес из UIA `Edit/ComboBox`;
- dwell-события при смене вкладки, классификация и noise-фильтр;
- PNG-скриншот окна при смене заголовка (throttle 30 с), media-sync с ACK;
- история Chromium по текущему пользователю;
- `ITINV_BROWSER_PROBE_ENABLED=1` включает ярлык в общем Startup при установке MSI.

## Scan (DLP)

Встроен в основной процесс, включается `ITINV_SCAN_ENABLED` (по умолчанию `1`),
но работает только при заданном `SCAN_AGENT_API_KEY`:

- `patterns_strict.yaml` (19 regex) кладётся MSI рядом с exe и читается через YamlDotNet;
- текстовые файлы сканируются локально потоково (чанки 1 МБ + overlap, UTF-8/CP1251,
  нормализация, OCR-латиница, ложные «ДСП-мебель», до 100 хитов);
- PDF: отдельный воркер-процесс (job limit 256 МБ, таймаут 20 с) читает текстовый слой
  первых 10 страниц и отдаёт срез первых 3 страниц на `/ingest/pdf-slice`;
- Office/изображения уходят документом на сервер (`/ingest/document`);
- дедуп по размеру+mtime в `scan_agent_state.json`, outbox `pending/dead_letter` с retry;
- задачи: `GET /tasks/poll`, `ping`, `scan_now` (`force_rescan`, `agent_pattern_ids`, `scan_extensions`),
  `self_update` (скачивание MSI + SHA256 + `msiexec`), `install_package` (msi/exe + SHA256),
  `disable_message_probes`;
- статус `scan_agent_status.json` (его читает `agent_runtime.sidecars.scan`).

Переменные: `ITINV_SCAN_ENABLED`, `SCAN_AGENT_SERVER_BASE`, `SCAN_AGENT_API_KEY`,
`SCAN_AGENT_POLL_INTERVAL_SEC`, `SCAN_AGENT_MAX_FILE_MB`, `SCAN_AGENT_EXTRA_ROOTS`,
`SCAN_AGENT_PATTERNS_FILE`, `SCAN_AGENT_BRANCH`, `SCAN_AGENT_ROOTS` (явный список корней).

## MSI (WiX v5)

```powershell
tools\dotnet-sdk-8\dotnet.exe build agent-dotnet\installer\Hub.Agent.Installer.wixproj -c Release
```

Результат: `agent-dotnet\installer\bin\Release\HUB-IT-Agent-CSharp-1.4.18-win64.msi`
(~92,4 МБ: `ITInventAgent.exe` 34,8 МБ + `ITInventBrowserProbe.exe` 69,6 МБ +
`patterns_strict.yaml`).

**Пилотная безопасность:** C#-MSI — отдельный продукт. Свой `UpgradeCode`,
каталог `Program Files\HUB-IT\Agent (C#)`, задача `HUB-IT Agent (C#)`.
Установка не удаляет и не перенастраивает Python-агент `HUB-IT Agent`.

Пилот использует **изолированный ProgramData**: `C:\ProgramData\HUB-IT-CSharp\Agent`
(логи, спул, state), probe — `HUB-IT-CSharp\BrowserProbe`. Python-агент продолжает
работать в `C:\ProgramData\HUB-IT\Agent` без пересечения очередей и состояния.
Для боевого переключения MSI ставится в каталог `Agent` (без «(C#)») — тогда
используется общий `ProgramData\HUB-IT`.

Свойства MSI (пишутся в `HKLM\SOFTWARE\HUB-IT\Agent`; агент читает их только
если переменная окружения и `.env` не заданы):

| Property | Default |
|---|---|
| `ITINV_AGENT_SERVER_URL` | `https://hubit.zsgp.ru/api/v1/inventory` |
| `ITINV_AGENT_API_KEY` | — (обязателен) |
| `ITINV_AGENT_INTERVAL_SEC` | `3600` |
| `ITINV_AGENT_HEARTBEAT_SEC` | `600` |
| `ITINV_AGENT_HEARTBEAT_JITTER_SEC` | `120` |
| `ITINV_USB_INVENTORY_ENABLED` | `1` |
| `ITINV_SECURITY_POSTURE_ENABLED` | `1` |
| `ITINV_SOFTWARE_STORE_APPS_ENABLED` | `1` |
| `ITINV_FS_EGRESS_ENABLED` | `1` |
| `ITINV_TELEGRAM_PROBE_ENABLED` | `0` |
| `ITINV_BROWSER_HISTORY_ENABLED` | `0` |
| `ITINV_BROWSER_HISTORY_SEC` | `180` |
| `ITINV_BROWSER_PROBE_ENABLED` | `0` (включает Startup-ярлык) |
| `ITINV_BROWSER_PROBE_SYNC_SEC` | `120` |
| `ITINV_SCAN_ENABLED` | `1` |
| `SCAN_AGENT_SERVER_BASE` | `https://hubit.zsgp.ru/api/v1/scan` |
| `SCAN_AGENT_API_KEY` | — (нужен для scan) |
| `SCAN_AGENT_POLL_INTERVAL_SEC` | `600` |
| `ITINV_OUTLOOK_SEARCH_ROOTS` | `D:\` |

## Безопасный запуск

Правила изоляции:

- **Установленный агент** (каталог под `Program Files\HUB-IT\Agent`) использует
  `C:\ProgramData\HUB-IT\Agent` — как Python-агент.
- **Dev-сборка** (всё, что запущено не из Program Files) по умолчанию пишет в
  `%LOCALAPPDATA%\HUB-IT\Agent` и физически не может изменить спул, логи и
  state-файлы рабочего Python-агента.
- Переопределение: `--data-dir <path>` или `ITINV_AGENT_DATA_ROOT`.
- Dev-сборка **отказывается** от сетевых операций (`--check`, `--once`, цикл)
  без явного `--allow-send` (код выхода 2).

```powershell
# ничего не отправляет, пишет JSON и не трогает state-файлы
ITInventAgent.exe --dry-run --force-software `
  --data-dir C:\Temp\hub-agent-test --out C:\Temp\payload.json

# проверка URL/DNS/health/API-key, без отправки инвентаря
ITInventAgent.exe --check --allow-send

# один полный снапшот и отправка (только осознанно)
ITInventAgent.exe --once --allow-send
```


## Дальше

1. Собрать и проверить пилотный MSI на тестовой машине (не на сервере с Python-агентом).
2. `fs_egress` на `FileSystemWatcher`; `browser_probe` на `Microsoft.Data.Sqlite` + GDI.
3. `scan_agent`: паритет 19 regex из `patterns_strict.yaml` + self-update.
4. Telegram/MAX probes — не переносить, удалить из MSI (выключены с 1.4.17).

## Известные расхождения

- `snapshot_hash` в `software_inventory`/`usb_devices` считается по другой
  канонической форме, чем в Python: стабилен, но не совпадает побайтово.
- `ip_primary` — первый адрес в порядке `NetworkInterface`, порядок может
  отличаться от psutil.
- Store-приложения пока перечисляются через `Get-AppxPackage` (один вызов
  PowerShell), остальное — нативно.
