# Технический отчёт: Inventory-Agent и сбор системных данных

## 1. Что это за документ

Этот отчёт описывает, как текущий `inventory-agent`:

- загружает runtime-конфиг;
- собирает данные о системе;
- читает нужные значения из WMI, `psutil`, PowerShell и registry;
- формирует inventory payload;
- сохраняет очередь и повторяет отправку при сетевых ошибках.

Источник истины для этого отчёта:

- `agent.py`
- `agent/src/itinvent_agent/agent.py`

Ниже используются реальные фрагменты кода из текущего репозитория. Секреты и токены в отчёте не раскрываются.

## 2. Runtime-архитектура

### Что делает

`agent.py` поднимает основной runtime, настраивает логирование, загружает `.env`, собирает inventory и отправляет его на сервер по циклу `heartbeat/full_snapshot`.

### Где в коде

- `agent.py:296` `bootstrap_env_from_files()`
- `agent.py:339` `setup_logging()`
- `agent.py:2394` `collect_inventory()`
- `agent.py:2616` `send_data()`

### Runtime paths map

| Что | Текущий путь | Где задаётся |
| --- | --- | --- |
| Runtime root | `C:\ProgramData\IT-Invent\Agent` | `agent.py:84` |
| Логи | `C:\ProgramData\IT-Invent\Agent\Logs\itinvent_agent.log` | `agent.py:85`, `agent.py:339` |
| Inventory queue | `C:\ProgramData\IT-Invent\Agent\Spool\inventory\pending` | `agent.py:86`, `agent.py:371-379` |
| Dead-letter | `C:\ProgramData\IT-Invent\Agent\Spool\inventory\dead_letter` | `agent.py:372-379` |
| Status file | `C:\ProgramData\IT-Invent\Agent\Logs\agent_status.json` | `agent.py:377` |
| Outlook scan state | `C:\ProgramData\IT-Invent\Agent\Logs\outlook_scan_state.json` | `agent.py:378` |
| Runtime `.env` | `C:\ProgramData\IT-Invent\Agent\.env` | `agent_installer.py:126`, `agent/scripts/install_agent_task.ps1:72` |

### Кодовая вставка

```python
PROGRAM_DATA_ROOT = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "IT-Invent"
PROGRAM_DATA_AGENT_ROOT = PROGRAM_DATA_ROOT / "Agent"
PROGRAM_DATA_DIR = PROGRAM_DATA_AGENT_ROOT / "Logs"
PROGRAM_DATA_SPOOL_DIR = PROGRAM_DATA_AGENT_ROOT / "Spool"
PROGRAM_DATA_SCAN_AGENT_ROOT = PROGRAM_DATA_AGENT_ROOT / "ScanAgent"
```

Источник: `agent.py:83-87`

### Что уходит наружу

Наружу уходит уже сформированный JSON payload inventory, а также heartbeat-like payload в укороченных циклах.

### Fallback/ограничения

- если `ProgramData` недоступен, логирование и spool падают в `%TEMP%`;
- основной агент автоматически чистит только `itinvent_agent.log*` и держит не более `3` файлов всего;
- `.env` загружается не только из канонического пути, но и из legacy/fallback путей.

## 3. Карта источников данных payload

### Что делает

`collect_inventory()` собирает базовые поля всегда, а тяжёлые поля только при `full_snapshot`.

### Где в коде

- `agent.py:2394` `collect_inventory()`

### Поле -> источник -> функция -> комментарий

| Поле payload | Источник | Функция | Комментарий |
| --- | --- | --- | --- |
| `hostname` | Windows hostname | `socket.gethostname()` | Базовый идентификатор хоста |
| `current_user` | WMI / `query user` / registry / process env | `get_active_console_user()` | Идёт каскадом fallback |
| `user_full_name` | локальное разрешение имени пользователя | `resolve_user_full_name()` | Не registry-источник |
| `ip_primary`, `ip_list` | `psutil` + network snapshot | `get_network_info()` / `get_active_ipv4_addresses()` | Только активные интерфейсы |
| `system_serial` | `Win32_BIOS().SerialNumber` | `get_system_serial()` | В `full_snapshot` |
| `cpu_model` | `Win32_Processor().Name` | `get_cpu_model()` | В `full_snapshot` |
| `ram_gb` | `psutil.virtual_memory().total` | `collect_inventory()` | В `full_snapshot` |
| `monitors` | `WmiMonitorID` + EDID registry | `get_monitors()` | В `full_snapshot` |
| `logical_disks` | `psutil.disk_partitions()/disk_usage()` | `get_logical_disks()` | В `full_snapshot` |
| `storage` | PowerShell `Get-PhysicalDisk` + WMI `Win32_DiskDrive` | `get_storage_info()` | В `full_snapshot` |
| `os_info` | `Win32_OperatingSystem` | `get_os_info()` | В `full_snapshot` |
| `network` | `psutil` + PowerShell | `get_network_info()` | В `full_snapshot` |
| `security` | `root\\SecurityCenter2` + `Get-BitLockerVolume` | `get_security_info()` | В `full_snapshot` |
| `updates` | `Win32_QuickFixEngineering` | `get_updates_info()` | В `full_snapshot` |
| `outlook` | filesystem + registry | `collect_outlook_info()` | Всегда включается |

### Кодовая вставка

```python
payload: Dict[str, Any] = {
    "hostname": socket.gethostname(),
    "mac_address": get_mac_address(),
    "current_user": user_login,
    "user_login": user_login,
    "user_full_name": resolve_user_full_name(user_login),
    "ip_primary": ip_primary,
    "ip_list": ip_list,
    "timestamp": now_ts,
    "report_type": report_type,
    "last_seen_at": now_ts,
    "health": health_info,
    "outlook": outlook_info,
}

if include_full_snapshot:
    payload.update(
        {
            "system_serial": get_system_serial(),
            "cpu_model": get_cpu_model(),
            "ram_gb": round(psutil.virtual_memory().total / (1024.0 ** 3), 2),
            "monitors": get_monitors(),
            "logical_disks": get_logical_disks(),
            "storage": get_storage_info(),
            "os_info": get_os_info(),
            "network": network_info or get_network_info(),
            "security": get_security_info(),
            "updates": get_updates_info(),
        }
    )
```

Источник: `agent.py:2406-2439`

## 4. Пользователь, hostname, IP и MAC

### Что делает

Агент сначала пытается определить реального активного пользователя консоли, а не просто имя процесса. Для этого он каскадом проверяет:

1. `Win32_ComputerSystem.UserName`
2. `query user` / `quser`
3. registry `LastLoggedOnUser`
4. process env (`USERNAME` / `getpass.getuser()`)

### Где в коде

- `agent.py:1619` `get_process_user_name()`
- `agent.py:1626` `get_user_from_win32_computersystem()`
- `agent.py:1670` `get_user_from_query_user()`
- `agent.py:1681` `get_last_logged_on_user()`
- `agent.py:1696` `get_active_console_user()`

### Кодовая вставка

```python
def get_active_console_user() -> str:
    candidates = [
        get_user_from_win32_computersystem(),
        get_user_from_query_user(),
        get_last_logged_on_user(),
    ]
    for item in candidates:
        if item and not is_service_account(item):
            return item
    return normalize_user_name(get_process_user_name())
```

Источник: `agent.py:1696-1704`

### Откуда берёт данные

- hostname: `socket.gethostname()`
- MAC: активные интерфейсы через `psutil.net_if_addrs()`
- IP: `psutil` + фильтрация по активным интерфейсам

### Что уходит наружу

- `hostname`
- `current_user`
- `user_login`
- `user_full_name`
- `ip_primary`
- `ip_list`
- `mac_address`

### Fallback/ограничения

- если WMI недоступен, используется command-line/registry fallback;
- если сетевые интерфейсы недоступны, IP список может быть пустым.

## 5. Системный серийный номер, CPU, RAM, OS

### Что делает

Эти поля попадают в `full_snapshot` и собираются напрямую из WMI и `psutil`.

### Где в коде

- `agent.py:2162` `get_system_serial()`
- `agent.py:2177` `get_cpu_model()`
- `agent.py:2201` `get_os_info()`
- `agent.py:2394` `collect_inventory()`

### Кодовая вставка

```python
def get_system_serial() -> str:
    if wmi is None:
        return "Unknown"
    try:
        c = wmi.WMI()
        bios_items = c.Win32_BIOS()
        if not bios_items:
            return "Unknown"
        serial = sanitize_text(getattr(bios_items[0], "SerialNumber", ""))
        return serial or "Unknown"
```

Источник: `agent.py:2162-2171`

```python
def get_cpu_model() -> str:
    if wmi is None:
        return "Unknown"
    try:
        c = wmi.WMI()
        cpus = c.Win32_Processor()
        if not cpus:
            return "Unknown"
        return sanitize_text(getattr(cpus[0], "Name", "")) or "Unknown"
```

Источник: `agent.py:2177-2186`

### Откуда берёт данные

- `system_serial`: `Win32_BIOS.SerialNumber`
- `cpu_model`: `Win32_Processor.Name`
- `ram_gb`: `psutil.virtual_memory().total`
- `os_info`: `Win32_OperatingSystem`

### Что уходит наружу

- `system_serial`
- `cpu_model`
- `ram_gb`
- `os_info.platform/release/version/caption/build_number/install_date`

### Fallback/ограничения

- если WMI недоступен, серийный номер и CPU идут как `Unknown`;
- install date парсится из WMI datetime и может остаться в raw-виде, если строка нестандартная.

## 6. Сеть, безопасность и обновления

### Что делает

Агент собирает сетевую картину и security/update метаданные из нескольких разных источников.

### Где в коде

- `agent.py:2237` `get_network_info()`
- `agent.py:2352` `get_security_info()`
- `agent.py:2379` `get_updates_info()`

### Кодовая вставка

```python
gateway_data = _powershell_json(
    "Get-NetRoute -DestinationPrefix '0.0.0.0/0' | "
    "Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty NextHop | ConvertTo-Json -Compress"
)

dns_data = _powershell_json(
    "Get-DnsClientServerAddress -AddressFamily IPv4 | "
    "Where-Object {$_.ServerAddresses -and $_.InterfaceAlias} | "
    "Select-Object -First 1 -ExpandProperty ServerAddresses | ConvertTo-Json -Compress"
)
```

Источник: `agent.py:2272-2282`

```python
sc = wmi.WMI(namespace=r"root\SecurityCenter2")
for item in sc.AntiVirusProduct():
    antivirus_items.append(
        {
            "display_name": sanitize_text(getattr(item, "displayName", "")),
            "product_state": sanitize_text(getattr(item, "productState", "")),
        }
    )
```

Источник: `agent.py:2356-2364`

### Откуда берёт данные

- adapters/IP: `psutil.net_if_stats()` + `psutil.net_if_addrs()`
- gateway/DNS: PowerShell `Get-NetRoute`, `Get-DnsClientServerAddress`
- antivirus: WMI namespace `root\SecurityCenter2`
- BitLocker: PowerShell `Get-BitLockerVolume`
- hotfix history: `Win32_QuickFixEngineering`

### Что уходит наружу

- `network`
- `security`
- `updates`

### Fallback/ограничения

- PowerShell JSON helpers зависят от корректной работы PowerShell на машине;
- antivirus список может быть пустым на нестандартных системах;
- hotfix дата берётся как последняя строка из WMI списка, без дополнительной нормализации vendor-specific форматов.

## 7. Диски и накопители

### Что делает

Агент не ограничивается одним источником. Он сопоставляет:

- WMI `Win32_DiskDrive`
- PowerShell `Get-PhysicalDisk`
- при наличии serial — `Get-StorageReliabilityCounter`

Это нужно, чтобы получить читаемое имя, serial, health, wear и температуру и при этом отфильтровать виртуальные накопители.

### Где в коде

- `agent.py:1536` `get_diskdrive_metadata()`
- `agent.py:1987` `get_storage_info()`
- `agent.py:1973` `get_physical_disk_skip_reasons()`

### Кодовая вставка

```python
ps_cmd = (
    "Get-PhysicalDisk | Select-Object * -ExcludeProperty Cim* | "
    "ConvertTo-Json -Depth 1 -Compress"
)
result = run_cmd(["powershell", "-NoProfile", "-Command", ps_cmd])
```

Источник: `agent.py:1992-1996`

```python
reasons = []
if not model and not serial:
    reasons.append("empty")
if any(marker in bus_type for marker in VIRTUAL_BUS_MARKERS):
    reasons.append("virtual_bus")
if any(marker in model for marker in VIRTUAL_MODEL_MARKERS):
    reasons.append("virtual_model")
```

Источник: `agent.py:1973-1983`

### Откуда берёт данные

- `Win32_DiskDrive`: caption, model, serial, PNP device id, size
- `Get-PhysicalDisk`: media type, bus type, friendly name, health
- `Get-StorageReliabilityCounter`: wear/temperature

### Что уходит наружу

Массив `storage` c полями:

- `model`
- `serial_number`
- `media_type`
- `bus_type`
- `size_bytes`
- `display_name`
- `health_status`
- `wear_out_percentage`
- `temperature`

### Fallback/ограничения

- часть reliability counters доступна не на всех контроллерах/драйверах;
- фильтрация виртуальных дисков эвристическая, не по единственному флагу.

## 8. Мониторы и чтение EDID из registry

### Что делает

Агент сначала пытается вытащить серийный номер монитора из EDID в registry, и только потом падает в WMI fallback.

### Где в коде

- `agent.py:1871` `validate_monitor_serial()`
- `agent.py:1881` `parse_edid_serial()`
- `agent.py:1904` `get_registry_edid_for_instance()`
- `agent.py:1932` `get_monitor_serial()`
- `agent.py:1946` `get_monitors()`

### Кодовая вставка

```python
reg_path = rf"SYSTEM\CurrentControlSet\Enum\{candidate}\Device Parameters"
key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, reg_path)
data, _ = winreg.QueryValueEx(key, "EDID")
```

Источник: `agent.py:1921-1924`

```python
serial_wmi = validate_monitor_serial(decode_wmi_char_array(getattr(monitor_obj, "SerialNumberID", [])))
if serial_wmi:
    return serial_wmi, "wmi_fallback"
```

Источник: `agent.py:1940-1942`

### Откуда берёт данные

- WMI namespace `root\wmi`, класс `WmiMonitorID`
- registry `HKLM\SYSTEM\CurrentControlSet\Enum\...\Device Parameters\EDID`

### Что уходит наружу

Массив `monitors` с полями:

- `manufacturer`
- `product_code`
- `serial_number`
- `serial_source`

### Fallback/ограничения

- EDID путь вычисляется эвристически по `InstanceName`;
- если EDID не найден или нераспознаваем, используется WMI serial.

## 9. Outlook: файловый fallback и чтение registry

### Что делает

Outlook-блок собирается в два слоя:

1. файловый поиск `PST/OST` по профилям и extra roots;
2. чтение Outlook profile emails из registry по SID пользователя.

Затем агент пытается связать store-файлы и профильные email-адреса, чтобы выдать полезный Outlook payload.

### Где в коде

- `agent.py:675` `_collect_outlook_via_fallback_scan()`
- `agent.py:889` `_collect_outlook_profile_emails()`
- `agent.py:1137` `collect_outlook_info()`

### Кодовая вставка

```python
profile_paths = (
    r"Software\Microsoft\Office\16.0\Outlook\Profiles",
    r"Software\Microsoft\Windows NT\CurrentVersion\Windows Messaging Subsystem\Profiles",
)
for sid in sid_candidates:
    sid_emails: List[str] = []
    for rel_path in profile_paths:
        sid_emails.extend(_collect_emails_from_registry_tree(winreg.HKEY_USERS, f"{sid}\\{rel_path}"))
```

Источник: `agent.py:896-904`

```python
stores = _collect_outlook_via_fallback_scan()
profile_emails = _collect_outlook_profile_emails(user_login)
```

Источник: `agent.py:1151-1153`

### Registry read map

| Назначение | Registry path |
| --- | --- |
| Поиск SID -> профиль пользователя | `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\<SID>` |
| Последний логон | `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI\LastLoggedOnUser` |
| Outlook profiles | `HKU\<SID>\Software\Microsoft\Office\16.0\Outlook\Profiles` |
| Windows Messaging profiles | `HKU\<SID>\Software\Microsoft\Windows NT\CurrentVersion\Windows Messaging Subsystem\Profiles` |

### Что уходит наружу

Раздел `outlook` с:

- найденными store-файлами;
- оценкой размеров;
- профильными email;
- сопоставлением store и пользователя;
- метаданными fallback scan.

### Fallback/ограничения

- extra root scan зависит от `ITINV_OUTLOOK_SEARCH_ROOTS`;
- часть mailbox-метаданных не читается напрямую из Outlook API, а только выводится по filesystem/registry эвристикам.

## 10. Очередь inventory, retry и dead-letter

### Что делает

Если отправка inventory не удалась, агент не теряет payload сразу. Он кладёт его в pending queue, ограничивает размер очереди и перемещает повреждённые/просроченные элементы в dead-letter.

### Где в коде

- `agent.py:2528` `_inventory_queue_enqueue()`
- `agent.py:2552` `_inventory_queue_prune_limits()`
- `agent.py:2616` `send_data()`

### Кодовая вставка

```python
if not _post_payload(payload, config):
    enqueued_path = _inventory_queue_enqueue(payload)
    logging.warning("Inventory enqueue because send failed: %s", enqueued_path)
```

```python
item["attempts"] = attempts
item["next_attempt_at"] = now_ts + _inventory_backoff_seconds(attempts)
item["last_error"] = "NET_TIMEOUT_OR_HTTP_ERROR"
```

Источник: `agent.py:2617-2656`

### Что уходит наружу

На сервер уходит только payload, успешно прошедший `_post_payload()`. Всё остальное остаётся локально в queue до успешной отправки или выброса в dead-letter.

### Fallback/ограничения

- queue ограничена по количеству, возрасту и общему размеру;
- при повреждённом JSON запись переносится в dead-letter с причиной.

## 11. Что агент читает и пишет в registry

### Registry read/write map

| Тип | Что | Где |
| --- | --- | --- |
| Read | `LastLoggedOnUser` | `agent.py:1684-1688` |
| Read | `ProfileList` / `ProfileImagePath` | `agent.py:820-835` |
| Read | Outlook profile trees в `HKU\<SID>` | `agent.py:896-904` |
| Read | Monitor `EDID` | `agent.py:1921-1924` |
| Write | Machine env `SCAN_AGENT_SCAN_ON_START` | `agent/scripts/install_agent_task.ps1:54` |
| Write | Machine env `SCAN_AGENT_WATCHDOG_ENABLED` | `agent/scripts/install_agent_task.ps1:55` |
| Delete | Те же machine env при uninstall | `agent/scripts/uninstall_agent_task.ps1:81-82` |

### Важный факт

Inventory-agent **не прописывает автозапуск в registry Run/RunOnce keys**. Автозапуск делается через `Scheduled Task`.

Machine env values пишутся через `.NET` API `SetEnvironmentVariable(..., "Machine")`. Windows хранит такие значения в machine environment hive:

`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`

## 12. Что агент не делает

- не использует Windows Service для автозапуска;
- не использует `Run`/`RunOnce` keys для старта inventory-agent;
- не читает серийный номер компьютера из BIOS vendor-specific CLI, только через WMI;
- не получает Outlook-данные через COM/MAPI, а использует filesystem/registry fallback.

## 13. Известные ограничения

- большая часть inventory опирается на WMI и PowerShell; если они повреждены, часть полей станет пустой;
- часть storage-health метрик зависит от контроллера и драйвера;
- Outlook profile email extraction строится на эвристике SID/profile mapping;
- line refs в документе актуальны для текущего состояния репозитория и могут сдвигаться после рефакторинга.

## 14. Как проверить на живой машине

```powershell
Get-Content "C:\ProgramData\IT-Invent\Agent\Logs\itinvent_agent.log" -Tail 100
Get-Content "C:\ProgramData\IT-Invent\Agent\.env"
Get-ChildItem "C:\ProgramData\IT-Invent\Agent\Spool\inventory\pending"
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI" LastLoggedOnUser
Get-CimInstance Win32_BIOS | Select-Object SerialNumber
Get-CimInstance Win32_Processor | Select-Object Name
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber
```

Проверка мониторов/EDID:

```powershell
Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID
reg query "HKLM\SYSTEM\CurrentControlSet\Enum" /s /f EDID
```
