# Технический отчёт: Scan-Agent, MSI, автозапуск и uninstall

## 1. Что это за документ

Этот отчёт описывает:

- как `scan-agent` ищет документы и анализирует их;
- как он общается с сервером по `heartbeat`, `tasks/poll`, `ingest`;
- как работает outbox/state;
- как unified agent ставится через MSI;
- как создаётся автозапуск;
- что именно пишется в registry;
- как идёт uninstall и cleanup.

Источник истины для отчёта:

- `scan_agent/agent.py`
- `agent_installer.py`
- `agent/setup.py`
- `agent/scripts/install_agent_task.ps1`
- `agent/scripts/uninstall_agent_task.ps1`

## 2. Scan-agent runtime и пути

### Что делает

`scan_agent/agent.py` держит отдельный runtime для document scan, outbox и status/state файлов.

### Где в коде

- `scan_agent/agent.py:61` `PROGRAM_DATA`
- `scan_agent/agent.py:118` `bootstrap_env_from_files()`
- `scan_agent/agent.py:162` `setup_logging()`
- `scan_agent/agent.py:197` `_read_env()`

### Runtime paths map

| Что | Текущий путь | Где задаётся |
| --- | --- | --- |
| Scan runtime root | `C:\ProgramData\IT-Invent\ScanAgent` | `scan_agent/agent.py:61` |
| Лог scan-agent | `C:\ProgramData\IT-Invent\ScanAgent\scan_agent.log` | `scan_agent/agent.py:64`, `scan_agent/agent.py:82` |
| State | `C:\ProgramData\IT-Invent\ScanAgent\scan_agent_state.json` | `scan_agent/agent.py:65`, `scan_agent/agent.py:82` |
| Outbox pending | `C:\ProgramData\IT-Invent\ScanAgent\outbox\pending` | `scan_agent/agent.py:67`, `scan_agent/agent.py:79-82` |
| Outbox dead-letter | `C:\ProgramData\IT-Invent\ScanAgent\outbox\dead_letter` | `scan_agent/agent.py:68`, `scan_agent/agent.py:79-82` |
| Status | `C:\ProgramData\IT-Invent\ScanAgent\scan_agent_status.json` | `scan_agent/agent.py:69`, `scan_agent/agent.py:82` |

### Важный нюанс по `.env`

MSI и unified agent считают каноническим runtime `.env` путь:

`C:\ProgramData\IT-Invent\Agent\.env`

Но standalone `scan_agent/agent.py` ищет `.env` так:

- explicit `SCAN_AGENT_ENV_FILE`
- рядом со скриптом / в родителях
- в `cwd`
- legacy fallback `C:\ProgramData\IT-Invent\.env`

То есть embedded scan-sidecar обычно получает env от уже запущенного unified agent, а standalone scan-agent пока живёт с более старым поиском `.env`.

### Кодовая вставка

```python
PROGRAM_DATA = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "IT-Invent" / "ScanAgent"

def _setup_paths() -> Tuple[Path, Path, Path, Path, Path]:
    root = PROGRAM_DATA
    ...
    outbox_root = root / OUTBOX_DIR
    pending_dir = outbox_root / OUTBOX_PENDING_DIR
    dead_dir = outbox_root / OUTBOX_DEAD_DIR
```

Источник: `scan_agent/agent.py:61-82`

## 3. Как scan-agent ищет документы

### Что делает

Агент сканирует пользовательские директории:

- `Desktop`
- `Documents`
- `Downloads`

для всех пользователей под `C:\Users`, кроме служебных каталогов.

### Где в коде

- `scan_agent/agent.py:48` `USER_SUBDIRS`
- `scan_agent/agent.py:468` `_iter_target_roots()`
- `scan_agent/agent.py:486` `_iter_files()`

### Кодовая вставка

```python
USER_SUBDIRS = ("Desktop", "Documents", "Downloads")

def _iter_target_roots() -> Iterable[Path]:
    users_root = Path(r"C:\Users")
    ...
    for user_dir in users_root.iterdir():
        ...
        for sub in USER_SUBDIRS:
            target = user_dir / sub
            if target.exists() and target.is_dir():
                roots.append(target)
```

Источник: `scan_agent/agent.py:48`, `scan_agent/agent.py:468-481`

### Откуда берёт данные

Только из файловой системы:

- корень `C:\Users`
- пользовательские поддиректории
- реальный обход через `os.walk`

### Что уходит наружу

На сервер не уходит весь список файлов. Уходит только событие по файлу, который дал матч по паттернам или PDF fallback slice.

### Fallback/ограничения

- системные профили (`Default`, `Public`, `All Users`) пропускаются;
- файл пропускается, если пустой или больше лимита `SCAN_AGENT_MAX_FILE_MB`.

## 4. Какие форматы он сканирует

### Что делает

Scan-agent сканирует только поддерживаемые форматы:

- PDF
- текстовые расширения

### Где в коде

- `scan_agent/agent.py:57` `TEXT_EXTENSIONS`
- `scan_agent/agent.py:69` `SUPPORTED_SCAN_EXTENSIONS`

### Кодовая вставка

```python
TEXT_EXTENSIONS = {
    ".txt",
    ".csv",
    ".log",
    ".json",
    ".xml",
    ".ini",
    ".conf",
    ".md",
    ".rtf",
}

SUPPORTED_SCAN_EXTENSIONS = frozenset({".pdf", *TEXT_EXTENSIONS})
```

Источник: `scan_agent/agent.py:57-69`

### Fallback/ограничения

- изображения, архивы, Office-документы и бинарные форматы в этой логике не анализируются;
- unsupported extension отсекается до вычисления hash.

## 5. Как анализируется файл

### Что делает

`_scan_path()` проходит по такому pipeline:

1. `stat()`, размер, тип, supported extension
2. dedupe по path/mtime/size/hash
3. SHA256
4. содержательный анализ
5. `event_id`
6. отправка в `ingest` или постановка в outbox

### Где в коде

- `scan_agent/agent.py:766` `_analyze_file()`
- `scan_agent/agent.py:875` `_scan_path()`
- `scan_agent/agent.py:812` `_send_ingest()`
- `scan_agent/agent.py:827` `_drain_outbox()`

### Кодовая вставка

```python
if stat_result.st_size <= 0 or stat_result.st_size > self.config["max_file_bytes"]:
    result["skipped"] += 1
    return result
if not self._is_supported_scan_path(path):
    result["skipped"] += 1
    return result

if self._already_scanned(path, stat_result):
    result["skipped"] += 1
    return result

file_hash = _sha256_file(path)
payload = self._analyze_file(path, file_hash, stat_result)
```

Источник: `scan_agent/agent.py:883-905`

### Dedupe/state

Агент хранит:

- `state["files"]` по path
- `state["hashes"]` по hash

Ключевая семантика сейчас такая:

- тот же path с теми же `mtime/size/hash` считается уже просмотренным;
- одинаковое содержимое в другом пути считается отдельным событием;
- outbox dedupe идёт по `event_id`.

### Что уходит наружу

Payload по найденному событию:

- `file_path`
- `file_name`
- `file_hash`
- `file_size`
- `source_kind`
- `text_excerpt`
- `pdf_slice_b64`
- `local_pattern_hits`
- `metadata.mtime/ext`

## 6. Text и PDF pipeline

### Что делает

Для текстовых файлов агент читает первые данные с fallback по кодировкам:

- `utf-8-sig`
- `utf-8`
- `cp1251`

Для PDF:

- пытается вытащить text layer через `fitz`
- если текст слишком короткий/похож на мусор, формирует `pdf_slice_b64`

### Где в коде

- `scan_agent/agent.py:424` `_extract_pdf_text()`
- `scan_agent/agent.py:438` `_first_pdf_pages_b64()`
- `scan_agent/agent.py:454` `_read_text_file()`
- `scan_agent/agent.py:385` `scan_text()`
- `scan_agent/agent.py:766` `_analyze_file()`

### Кодовая вставка

```python
def _read_text_file(path: Path, max_bytes: int = 2 * 1024 * 1024) -> str:
    with path.open("rb") as f:
        raw = f.read(max_bytes)
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return raw.decode(encoding)
        except Exception:
            continue
```

Источник: `scan_agent/agent.py:454-462`

```python
if ext == ".pdf":
    source_kind = "pdf"
    text = _extract_pdf_text(path, max_pages=10)
    if text and not _looks_gibberish(text):
        matches = scan_text(text, self.pattern_defs)
        text_excerpt = text[:4000]
    else:
        pdf_slice_b64 = _first_pdf_pages_b64(path, pages=3)
        source_kind = "pdf_slice"
```

Источник: `scan_agent/agent.py:772-781`

### Fallback/ограничения

- PDF OCR локально scan-agent не делает;
- fallback на `pdf_slice_b64` нужен, чтобы сервер потом мог разобрать PDF дальше;
- текстовые файлы читаются только до лимита и не анализируются как полноценный full-file dump.

## 7. Pattern matching и формирование `ingest`

### Что делает

Паттерны загружаются из `patterns_strict.yaml`, компилируются в regex и применяются локально к text/PDF-text.

### Где в коде

- `scan_agent/agent.py:322` `_load_pattern_defs()`
- `scan_agent/agent.py:385` `scan_text()`
- `scan_agent/agent.py:766` `_analyze_file()`

### Кодовая вставка

```python
for match in regex.finditer(source):
    out.append(
        {
            "pattern": pattern,
            "pattern_name": name,
            "weight": str(weight),
            "value": match.group(0),
            "snippet": _snippet(source, match.start(), match.end()),
        }
    )
```

Источник: `scan_agent/agent.py:395-405`

### Что уходит наружу

В `ingest` попадают:

- `local_pattern_hits`
- `text_excerpt` или `pdf_slice_b64`
- file metadata
- path/user/host context

Если матчей нет и `pdf_slice_b64` не сформирован, событие не создаётся.

## 8. Как scan-agent общается с сервером

### Что делает

Есть 4 основных server interaction path:

- `heartbeat`
- `tasks/poll`
- `scan_now`
- `ingest`

### Где в коде

- `scan_agent/agent.py:958` `heartbeat()`
- `scan_agent/agent.py:992` `poll_tasks()`
- `scan_agent/agent.py:917` `run_scan_once()`
- `scan_agent/agent.py:812` `_send_ingest()`
- `scan_agent/agent.py:1069` `run_forever()`

### Кодовая вставка

```python
payload = {
    "agent_id": self.agent_id,
    "hostname": _hostname(),
    "branch": self.config["branch"],
    "ip_address": _primary_ip(),
    "version": AGENT_VERSION,
    "status": "online",
    "queue_pending": len(self._pending_paths) + self._outbox_depth(),
}
response = self._send("POST", self._url("heartbeat"), json=payload)
```

Источник: `scan_agent/agent.py:959-976`

```python
elif command == "scan_now":
    stats = self.run_scan_once()
    self._task_result(task_id, "completed", result=stats)
```

Источник: `scan_agent/agent.py:1016-1018`

### Fallback/ограничения

- при ошибке `ingest` файл не теряется, а кладётся в outbox;
- polling не добавляет новых команд, кроме тех, что сервер уже отдал;
- прогресс в процентах не считается: агент отдаёт статусы задач и итоговые counters.

## 9. Outbox, retry и dead-letter

### Что делает

Если `ingest` не прошёл:

- событие кладётся в `outbox\pending`
- потом пытается дозалиться на heartbeat cycle, после `scan_once` и после watchdog batch
- при ошибках используется backoff
- повреждённые записи уходят в `outbox\dead_letter`

### Где в коде

- `scan_agent/agent.py:695` `_outbox_enqueue()`
- `scan_agent/agent.py:719` `_outbox_backoff_seconds()`
- `scan_agent/agent.py:724` `_outbox_prune_limits()`
- `scan_agent/agent.py:827` `_drain_outbox()`

### Кодовая вставка

```python
attempts = _to_int(item.get("attempts"), 0) + 1
item["attempts"] = attempts
item["next_attempt_at"] = now_ts + self._outbox_backoff_seconds(attempts)
item["last_error"] = self._last_error or "INGEST_FAILED"
```

Источник: `scan_agent/agent.py:846-849`

### Что уходит наружу

Во внешний мир уходит только успешно отправленный `ingest`. Outbox и dead-letter остаются локальными runtime-артефактами.

## 10. MSI helper и установка

### Что делает

MSI install/uninstall больше не запускает `ITInventAgent.exe` как helper. Для этого есть отдельный internal helper `ITInventAgentMsiHelper.exe`.

### Где в коде

- `agent_installer.py:19` `MSI_HELPER_EXECUTABLE_NAME`
- `agent_installer.py:382` `run_msi_install()`
- `agent_installer.py:418` `run_msi_uninstall_cleanup()`
- `agent/setup.py`

### Кодовая вставка

```python
MSI_HELPER_EXECUTABLE_NAME = "ITInventAgentMsiHelper.exe"

def run_msi_install(namespace, logger) -> int:
    install_dir = resolve_install_dir(getattr(namespace, "install_dir", ""))
    env_file_path = resolve_env_file_path(install_dir, getattr(namespace, "env_file_path", ""))
    executable_path = resolve_executable_path(install_dir)
    ...
    _run_powershell_script(
        script_path,
        [
            "-TaskName", ...,
            "-ExecutablePath", str(executable_path),
            "-EnvFilePath", str(env_file_path),
            "-StartAfterRegister",
        ],
    )
```

Источник: `agent_installer.py:19`, `agent_installer.py:382-415`

### Что делает install helper по шагам

1. определяет `install_dir`
2. определяет runtime `.env`
3. читает existing/legacy env
4. строит merged env values
5. жёстко форсирует:
   - `SCAN_AGENT_SCAN_ON_START=0`
   - `SCAN_AGENT_WATCHDOG_ENABLED=0`
6. вызывает `install_agent_task.ps1`

## 11. Автозапуск: Scheduled Task, а не Run-key

### Что делает

Автозапуск агента создаётся через `Register-ScheduledTask`. Это главный supported механизм автозапуска.

### Где в коде

- `agent/scripts/install_agent_task.ps1:94`
- `agent/scripts/install_agent_task.ps1:97`

### Кодовая вставка

```powershell
$action = New-ScheduledTaskAction -Execute $ExecutablePath -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
```

Источник: `agent/scripts/install_agent_task.ps1:76-94`

### Важный факт

Агент **не пишет автозапуск в**:

- `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- `HKLM\Software\Microsoft\Windows\CurrentVersion\Run`
- `RunOnce`

Автозапуск идёт только через Task Scheduler.

## 12. Что именно пишет в registry

### Что делает

Install/uninstall script пишет и удаляет только machine-level env переменные scan-дефолтов.

### Где в коде

- `agent/scripts/install_agent_task.ps1:54-55`
- `agent/scripts/uninstall_agent_task.ps1:81-82`

### Кодовая вставка

```powershell
[Environment]::SetEnvironmentVariable("SCAN_AGENT_SCAN_ON_START", "0", "Machine")
[Environment]::SetEnvironmentVariable("SCAN_AGENT_WATCHDOG_ENABLED", "0", "Machine")
```

Источник: `agent/scripts/install_agent_task.ps1:54-55`

```powershell
[Environment]::SetEnvironmentVariable("SCAN_AGENT_SCAN_ON_START", $null, "Machine")
[Environment]::SetEnvironmentVariable("SCAN_AGENT_WATCHDOG_ENABLED", $null, "Machine")
```

Источник: `agent/scripts/uninstall_agent_task.ps1:81-82`

### Registry read/write map

| Тип | Что | Реальное действие |
| --- | --- | --- |
| Write | `SCAN_AGENT_SCAN_ON_START` | Пишется как machine env |
| Write | `SCAN_AGENT_WATCHDOG_ENABLED` | Пишется как machine env |
| Delete | `SCAN_AGENT_SCAN_ON_START` | Удаляется при uninstall |
| Delete | `SCAN_AGENT_WATCHDOG_ENABLED` | Удаляется при uninstall |

Windows хранит machine env значения в:

`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`

### Что агент не пишет в registry

- автозапуск через `Run`
- COM registration
- Windows Service registration

## 13. Uninstall и cleanup

### Что делает

Uninstall helper:

1. удаляет scheduled tasks
2. останавливает процессы
3. удаляет machine env scan defaults
4. удаляет runtime data
5. install directory оставляет на удаление самому MSI

### Где в коде

- `agent_installer.py:418` `run_msi_uninstall_cleanup()`
- `agent/scripts/uninstall_agent_task.ps1`

### Кодовая вставка

```python
stop_agent_processes()

_run_powershell_script(
    script_path,
    [
        "-TaskName", ...,
        "-InstallPath", str(install_dir),
        "-RuntimeRoot", str(runtime_root),
        "-LegacyProgramDataRoot", str(DEFAULT_PROGRAM_DATA_ROOT),
        "-SkipInstallPathRemoval",
        "-ClearInstallerEnv",
    ],
)
```

Источник: `agent_installer.py:421-436`

```powershell
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Unregister-ScheduledTask -TaskName $OutlookTaskName -Confirm:$false
Stop-Process -Name $name -Force -ErrorAction SilentlyContinue
Remove-PathIfExists -TargetPath $RuntimeRoot -Recurse
```

Источник: `agent/scripts/uninstall_agent_task.ps1:48-98`

### Различие MSI-owned / runtime data

| Тип данных | Где живёт | Кто удаляет |
| --- | --- | --- |
| EXE, scripts, helper | `C:\Program Files\IT-Invent\Agent` | MSI |
| `.env`, logs, spool | `C:\ProgramData\IT-Invent\Agent` | uninstall script/helper |
| scan outbox/state | `C:\ProgramData\IT-Invent\ScanAgent` или legacy roots | uninstall script/helper |

## 14. Полный жизненный цикл

### Install -> first start -> inventory -> scan -> uninstall

1. MSI кладёт binaries в `Program Files`
2. MSI helper формирует runtime `.env`
3. `install_agent_task.ps1`:
   - выставляет scan `0/0`
   - пишет `.env`
   - создаёт `Scheduled Task`
   - пытается стартовать её сразу
4. `ITInventAgent.exe` запускается под `SYSTEM` через task
5. unified agent:
   - грузит env
   - настраивает logging/spool
   - начинает inventory loop
   - поднимает embedded scan-sidecar
6. scan-agent:
   - шлёт `heartbeat`
   - poll'ит `tasks/poll`
   - выполняет `scan_now`
   - шлёт `ingest`
   - складывает ошибки в outbox
7. при uninstall:
   - helper убивает процессы
   - удаляет task'и
   - чистит machine env
   - удаляет runtime state
   - MSI удаляет binaries

## 15. Что scan/install контур не делает

- не использует registry `Run` keys для автозапуска;
- не делает OCR локально в scan-agent;
- не сканирует произвольные диски целиком;
- не хранит runtime `.env` рядом с EXE как новый канонический путь;
- не считает честный процент прогресса scan без отдельного progress contract.

## 16. Известные ограничения

- standalone `scan_agent/agent.py` всё ещё имеет legacy-список мест поиска `.env`;
- scan-agent анализирует ограниченный набор расширений;
- часть uninstall-cleanup разделена между helper/script и самим MSI;
- line refs в документе актуальны для текущей ревизии репозитория.

## 17. Как проверить на живой машине

Проверка task/autostart:

```powershell
Get-ScheduledTask -TaskName "IT-Invent Agent"
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Settings | Format-List ExecutionTimeLimit, MultipleInstances, StartWhenAvailable
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Triggers
```

Проверка runtime:

```powershell
Get-Content "C:\ProgramData\IT-Invent\Agent\.env"
Get-Content "C:\ProgramData\IT-Invent\Agent\Logs\itinvent_agent.log" -Tail 100
Get-ChildItem "C:\ProgramData\IT-Invent\ScanAgent\outbox\pending"
Get-Content "C:\ProgramData\IT-Invent\ScanAgent\scan_agent_status.json"
```

Проверка machine env:

```powershell
Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" `
  SCAN_AGENT_SCAN_ON_START, SCAN_AGENT_WATCHDOG_ENABLED
```

Проверка отсутствия Run-key автозапуска:

```powershell
Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
```
