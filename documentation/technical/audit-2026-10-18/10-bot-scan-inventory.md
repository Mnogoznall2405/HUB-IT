# Аудит 10: bot/, scan_agent/, scan_server/, inventory_server/, agent/, корневые agent.py, agent_installer.py, agent_msi_helper.py, local_store.py, agent_version.py

Режим: только чтение. Файлы репозитория не менялись. Пути относительно `C:\Project\Image_scan`.
Значения секретов в отчёте не приводятся (токен бота в логах заменён на `<REDACTED>`).

Легенда: severity = critical / high / medium / low; confidence = high / medium / low.

---

## Сводка

- Критичных находок нет. Высокий приоритет: утечка токена Telegram-бота в `bot.log` (B1); синхронные вызовы LLM и pyodbc внутри `async`-обработчиков бота, которые блокируют event loop (B2, B3); потеря данных при `alembic downgrade` миграции scan (B13).
- Дублирования: `agent.py` в корне и `agent/src/itinvent_agent/agent.py` побайтно идентичны (3880 строк); около 9 общих хелперов скопированы между `agent.py` и `scan_agent/agent.py`; правила сканирования продублированы в `scan_agent/agent.py` и `scan_server/patterns.py` с разным набором исключений.
- Конфликт в установке: копия `scripts/install_agent_task.ps1` в корне устарела (интервал опроса 600/120 вместо 60/30), а корневой uninstall не удаляет задачи probe-агентов.
- Граница Scan/Inventory нарушена: `agent.py` запускает Scan-sidecar в своём процессе (`agent.py:453-490`); `inventory_server` и `scan_server` импортируют пакет `WEB-itinvent/backend` через `sys.path`.
- Проверено и не подтвердилось: `verify=False` / `CERT_NONE` / `shell=True` / `os.system` / `extractall` в компонентах не найдены; динамический SQL в `scan_server/database.py` строится только из констант; `data/*.json` в боте не пишется напрямую (только через SQLite-store); API-ключи сверяются через `in set(...)`, а не через прямое сравнение (не timing-safe, но риск низкий); XSS в отчёте Telegram-probe не подтвердился (отчёт экранируется на стороне агента через `html.escape`).

---

## Bugs

### B1. Токен Telegram-бота записывается в лог
- **Место:** `bot/main.py:54-78` (root logger на INFO, file/console handlers); `bot.log` в корне.
- **Описание:** корневой логгер работает на уровне INFO, логгер `httpx` (используется python-telegram-bot) тоже пишет INFO-записи с полным URL запроса, в котором находится токен бота. Логгер `httpx` не понижается до WARNING.
- **Доказательство:** `bot.log.1` содержит 59 348 строк вида `HTTP Request: POST https://api.telegram.org/bot<REDACTED>/getUpdates` (на каждом опросе); `bot.log` содержит 2536 таких строк. Ротация хранит 5 файлов по 10 МБ, то есть токен лежит на диске.
- **Сценарий:** любой, кто получит доступ к каталогу проекта или архиву логов, может перехватить управление ботом (чтение переписки, отправка от имени бота).
- **Рекомендация:** `logging.getLogger("httpx").setLevel(logging.WARNING)` и то же для `httpcore`; очистить старые логи; считать токен скомпрометированным и перевыпустить его через BotFather.
- **Severity:** high. **Confidence:** high (факт подтверждён в логах по числу строк и формату).

### B2. Синхронный вызов LLM внутри `async`-функций OCR (блокировка event loop)
- **Место:** `bot/services/ocr_service.py:76-106` (`async def analyze_image`, вызов `openrouter_client.complete_vision` на строке 90); `bot/services/ocr_service.py:257-290` (`analyze_image_detailed`, вызов на строке 272); цепочка `extract_serial_from_image` (291-330) и `analyze_image_with_confidence` (446-460). Синхронная реализация: `shared/llm/client.py:132` (`httpx.Client`), `shared/llm/client.py:687` (`def complete_vision`, не `async`).
- **Описание:** функции объявлены `async`, но внутри синхронно выполняют HTTP-запрос к LLM и синхронное чтение файла (`_read_image_bytes`, строка 71). Во время ожидания ответа (секунды, при таймауте до десятков секунд) весь PTB event loop бота стоит, и остальные пользователи не получают ответов.
- **Сценарий:** два пользователя одновременно присылают фото; второй получает задержку, равную времени первого LLM-запроса, а при медленном ответе роутера бот перестаёт реагировать на команды.
- **Рекомендация:** вызывать `complete_vision` через `await asyncio.to_thread(...)`, либо добавить async-вариант клиента.
- **Severity:** high. **Confidence:** high.

### B3. Синхронные запросы pyodbc внутри `async`-обработчиков
- **Место:** `bot/handlers/search.py:238` (внутри `async def find_by_serial_input`, строка 40), вызов `db.find_by_serial_number`; `bot/handlers/database.py:540` (внутри `async def show_equipment_by_type_and_branch`, строка 511), вызов `db.get_equipment_by_type`. Дополнительно `bot/universal_database.py:157` содержит `time.sleep(1)` в цикле повторного подключения pyodbc.
- **Описание:** SQL Server-запросы выполняются синхронно в обработчиках. Из 94 `async def` в `bot/handlers` только 4 вызовов `to_thread`/`run_in_executor` в bot-коде. Тяжёлый запрос к ITINVENT блокирует весь бот.
- **Сценарий:** поиск по серийному номеру с `TOP 2000` (`get_equipment_by_type` по умолчанию `limit=2000`) занимает несколько секунд, на это время все обработчики PTB встают; при сбое подключения `time.sleep(1)` x3 добавляет ещё 2 секунды блокировки.
- **Рекомендация:** обернуть эти вызовы в `asyncio.to_thread`, как сделано в `act_email.py` (4 вызова).
- **Severity:** high. **Confidence:** high.

### B4. SMTP-подключение без таймаута и без закрытия при ошибке
- **Место:** `bot/email_sender.py:248` (`smtplib.SMTP(self.smtp_server, self.smtp_port)` без `timeout=`), строки 248-261 (`server.quit()` только на успешном пути, нет `finally`). Для сравнения `bot/email_sender.py:128` и `:224` используют `timeout=30`.
- **Описание:** метод `test_connection` может зависнуть на недоступном SMTP-сервере, так как сокет без таймаута блокируется бесконечно; при исключении после `connect` соединение не закрывается.
- **Сценарий:** при недоступности почтового сервера проверка соединения из обработчика блокирует (см. B2/B3 по последствиям для event loop).
- **Рекомендация:** добавить `timeout=30` и `try/finally` с `server.quit()` (или `with`).
- **Severity:** medium. **Confidence:** high.

### B5. Гонка при добавлении записи в не-list JSON-документ (lost update)
- **Место:** `local_store.py:465-472` (`append_to_json`, ветка `kind != "list"`: `load_json` → `append` → `save_json`).
- **Описание:** чтение, изменение и запись выполняются тремя отдельными операциями, каждая берёт `self._lock` только внутри себя. Блокировка `RLock` общая только для одного процесса; web-backend и bot работают с одним `local_store.db` как отдельные процессы, а транзакция вокруг всей операции не открыта.
- **Сценарий:** два процесса одновременно добавляют запись в dict-документ; одна из записей теряется.
- **Рекомендация:** выполнять load+modify+save в одной транзакции с `BEGIN IMMEDIATE`, либо использовать `update_json_array`/`_insert_record` вместо RMW.
- **Severity:** medium. **Confidence:** medium (зависит от того, какие файлы идут через не-list ветку; `FILE_KIND_MAP` local_store.py:50-70 содержит dict-файлы).

### B6. Тихий откат на «непроверенную» SQLite-базу и отсутствие защиты для production
- **Место:** `local_store.py:38-51` (`_resolve_default_db_path` возвращает `primary` даже когда он не прошёл `PRAGMA quick_check`); `bot/main.py:441-446` (исключение инициализации store только логируется через `logger.warning` и запуск продолжается); в `local_store.py` и `bot/` нет проверки `APP_ENV`.
- **Описание:** AGENTS.md требует, чтобы при `APP_ENV=production` JSON-runtime не переходил молча на SQLite. В коде этой проверки нет (grep по `APP_ENV`/`production` в `bot/` и `local_store.py` пуст), а повреждённая база выбирается без ошибки.
- **Сценарий:** повреждённый `local_store.db` на проде: store создаётся пустой, бот работает с пустыми данными, а записи пишутся в новую пустую базу.
- **Рекомендация:** при `APP_ENV=production` падать с ошибкой при нездоровой базе; логировать `error`, а не `warning`.
- **Severity:** medium. **Confidence:** medium (правило из AGENTS, отсутствие проверки подтверждено grep).

### B7. Повреждённый JSON-файл трактуется как пустой без сигнала
- **Место:** `local_store.py:305-318` (`_fallback_read_json` при ошибке парсинга возвращает `default_content`, только `logger.warning`); `local_store.py:411-422` (возврат default без ошибки).
- **Описание:** при `enable_json_fallback=True` повреждённый файл даёт пустую структуру; вызывающий код не получает признака ошибки.
- **Severity:** low. **Confidence:** medium.

### B8. Серверный `X-API-Key` уходит на произвольный URL при загрузке обновления
- **Место:** `scan_agent/agent.py:1040` (`self.session.headers.update({"X-API-Key": ...})` для всей сессии); `scan_agent/agent.py:2360` (`self.session.get(text, stream=True, ...)` для абсолютного `http(s)` URL из `msi_url`); `scan_agent/agent.py:2333-2368` (`_download_agent_package`).
- **Описание:** заголовок задан на уровне сессии, поэтому он отправляется на любой URL, который передаётся в `_download_agent_package`. Библиотека `requests` при редиректе на другой хост удаляет только `Authorization`, но не пользовательские заголовки (по поведению библиотеки, не проверено запуском).
- **Сценарий:** `SCAN_AGENT_PACKAGE_URL` указывает на внешний хост или на URL, который редиректит на сторонний домен; агентский ключ уходит туда.
- **Рекомендация:** для абсолютных URL использовать отдельную сессию без `X-API-Key`, либо `allow_redirects=False`.
- **Severity:** high. **Confidence:** medium.

### B9. Блокировка `_ocr_pool_lock` на время `shutdown(wait=True)`
- **Место:** `scan_server/worker.py:408-417` (`_shutdown_ocr_pool` держит `self._ocr_pool_lock` и вызывает `shutdown(wait=True, cancel_futures=True)`); вызывается из обработчика `BrokenProcessPool` в job-потоке (`worker.py:520-525`); `_get_ocr_pool` (`worker.py:387-391`) берёт тот же лок.
- **Описание:** `shutdown(wait=True)` ждёт завершения уже запущенных OCR-задач (до `ocr_timeout_sec * 20 + 30` секунд, см. строку 497). Пока он выполняется, все другие job-потоки, которым нужен пул, блокируются на `_get_ocr_pool`.
- **Сценарий:** одна задача получила `BrokenProcessPool`; остальные job-потоки встают на минуты в ожидании, пока завершатся OCR-задачи из пула, который уже ломается.
- **Рекомендация:** заменить пул под коротким локом и вызывать `shutdown(wait=False)` вне лока.
- **Severity:** medium. **Confidence:** high.

### B10. Таймаут OCR не отменяет выполняющуюся задачу
- **Место:** `scan_server/worker.py:497-505` (`future.result(timeout=...)` → `except FuturesTimeoutError` только логирует и возвращает `ocr_error`); `future.cancel()` нигде не вызывается.
- **Описание:** если задача уже запущена, `cancel()` её не остановит, но без вызова задача продолжит занимать слот пула и CPU.
- **Сценарий:** несколько зависших OCR-страниц подряд (например, большой PDF) занимают все слоты `ocr_max_processes`; новые задачи ждут в очереди.
- **Рекомендация:** при таймауте вызывать `future.cancel()` и учитывать, что для потоков (Windows) остановка невозможна; для процессов перезапускать пул.
- **Severity:** medium. **Confidence:** high.

### B11. Повтор OCR с фиксированным текстом ошибки для любого `ocr_error`
- **Место:** `scan_server/worker.py:1030-1036` (`error_text="Превышено время OCR"` для всех исходов `ocr_error`, включая `BrokenProcessPool` и исключения из `_ocr_pdf_job`).
- **Описание:** сообщение вводит в заблуждение: причиной могла быть не задержка, а ошибка пула или файла.
- **Severity:** low. **Confidence:** high.

### B12. Запуск процесса `scan_server` сбрасывает задачи, которые выдал другой процесс
- **Место:** `scan_server/database.py:921-930` (`_ensure_schema` для PostgreSQL при каждом старте: `ensure_scan_schema` + `UPDATE scan_tasks SET status='queued', delivered_at=NULL WHERE status='delivered'`).
- **Описание:** при старте любого процесса (API в `scan_server/__main__.py`, воркер в `worker_main.py`) все задачи в статусе `delivered` переводятся обратно в `queued`, независимо от того, что их выдал другой работающий процесс.
- **Сценарий:** перезапуск API при работающем воркере (или наоборот) возвращает в очередь уже выданные агентам задачи, и агент получает их повторно.
- **Рекомендация:** сбрасывать только задачи, у которых `delivered_at` старше TTL, либо делать сброс один раз в выделенном процессе.
- **Severity:** medium. **Confidence:** medium (нужна проверка, как агенты подтверждают доставку).

### B13. Миграция `20260717_0001` при откате удаляет все таблицы scan
- **Место:** `scan_server/alembic/versions/20260717_0001_scan_schema_init.py:24-31` (`upgrade`: `Base.metadata.create_all(bind=bind)`; `downgrade`: `Base.metadata.drop_all(bind=bind)`).
- **Описание:** миграция не фиксирует схему на момент ревизии: она создаёт таблицы по текущим ORM-моделям, а откат удаляет по тем же моделям. Откат `alembic downgrade` до пустой ревизии уничтожит все данные таблиц scan (`scan_jobs`, `scan_incidents`, `scan_artifacts` и др.). Поздние изменения моделей делают повторный `upgrade` невоспроизводимым.
- **Сценарий:** `alembic downgrade base` на production (или при разборе инцидента) стирает историю сканов.
- **Рекомендация:** заменить на явный DDL, зафиксированный на момент ревизии; `downgrade` должен быть безопасным (не `drop_all`).
- **Severity:** high. **Confidence:** high. (Нарушает правило AGENTS: «удаление таблиц на проде без явного запроса».)

### B14. Сохранение состояния сканера по `int(now) % 15 == 0` может не срабатывать
- **Место:** `scan_agent/agent.py:2672` (`if self._state_dirty and int(now) % 15 == 0: self._persist_state()`), цикл в `run_forever` (2604-2677) с `time.sleep(1)` в конце.
- **Описание:** состояние записывается только когда секунда по часам кратна 15. Цикл имеет период `1 с + время работы итерации`; при периоде, кратном 15 секундам (например, итерация 3 с или 5 с), проверка может ни разу не попасть на нужную секунду. Тогда состояние сбрасывается только в `finally` при остановке.
- **Сценарий:** агент падает аварийно (без `finally`); список уже обработанных файлов и хешей потерян, файлы сканируются повторно и дублируются в ingest.
- **Рекомендация:** сохранять по таймеру (`next_persist_ts`), а не по совпадению секунд.
- **Severity:** medium. **Confidence:** medium.

### B15. Backoff перезапуска sidecar фактически не работает
- **Место:** `agent.py:3673-3697` (`ensure_scan_sidecar_alive`): после `scan_thread.start()` проверяется `is_alive()`; при успехе `scan_restart_attempt = 0` и `next_scan_restart_ts = now_ts` (3691-3692). Ветка с задержками `[10, 30, 60, 300]` (3694-3697) достигается только если поток завершился раньше проверки.
- **Описание:** `_run_scan_sidecar` может завершиться сразу (нет `SCAN_AGENT_API_KEY`, строки 478-482; или `ITINV_SCAN_ENABLED=0`, строки 454-456), но проверка `is_alive()` сразу после старта почти всегда возвращает True, поэтому backoff не включается. Перезапуск происходит на каждом тике главного цикла (heartbeat, около 600 с). Кроме того, `ensure_scan_sidecar_alive` не проверяет `ITINV_SCAN_ENABLED`, поэтому при выключенном Scan поток создаётся на каждом heartbeat.
- **Severity:** low. **Confidence:** medium.

### B16. Неограниченный размер тела запроса `fs-egress`
- **Место:** `inventory_server/app.py:208-216` (`receive_fs_egress`: `body = await request.json()` без ограничения размера; при этом у `list_fs_egress` лимит 500 есть в `egress_store.py:227`).
- **Описание:** тело запроса читается целиком в память без лимита размера и количества событий.
- **Сценарий:** клиент с агентским ключом (или скомпрометированный агент) отправляет многогигабайтный JSON и исчерпывает память процесса.
- **Рекомендация:** ограничить `Content-Length` и количество `events` (например, 1000 за запрос).
- **Severity:** medium. **Confidence:** medium.

### B17. Двойная запись при сбое web-store в browser-probe
- **Место:** `inventory_server/app.py:327-337` (`_process_browser_probe_payload`: при любом исключении web-store записывается предупреждение и данные пишутся в локальный `egress_store`).
- **Описание:** при частичном сбое web-store часть данных может быть записана в обоих хранилищах, а при повторной отправке получить дубликаты.
- **Severity:** low. **Confidence:** medium.

### B18. Telegram DNS-fallback по умолчанию обходит DNS
- **Место:** `bot/telegram_dns.py:66-69` (`prefer_fallback` по умолчанию `"1"`, то есть `TELEGRAM_BOT_API_PREFER_FALLBACK_IP` не задан → fallback IP используется всегда); `bot/telegram_dns.py:56-75` (патч `socket.getaddrinfo` на уровне процесса); `bot/main.py:450-452` (установка при наличии `TELEGRAM_BOT_API_FALLBACK_IP`).
- **Описание:** при заданном IP для fallback DNS для `api.telegram.org` никогда не спрашивается, даже если работает. Патч глобальный для процесса (всех библиотек), хотя ограничен одним хостом.
- **Сценарий:** IP Telegram меняется, а конфиг бота не обновлён; бот продолжает ходить на старый IP без перехода на DNS, и отказ виден только по таймаутам.
- **Рекомендация:** по умолчанию сначала пробовать DNS, а fallback включать при `gaierror`.
- **Severity:** medium. **Confidence:** medium.

### B19. Два `_to_bool` с одним именем и разной семантикой
- **Место:** `agent.py:256-264` (`if value is None: return default`, затем `str(value).strip()`); `scan_agent/agent.py:258-264` (`str(value or "")`).
- **Описание:** для значения `0` (int) root-версия даёт `"0"` → False, scan-версия даёт `"" ` → `default`. При `default=True` результат различается.
- **Severity:** low. **Confidence:** high.

### B20. Неограниченный и неупорядоченный набор путей для watchdog
- **Место:** `scan_agent/agent.py:1860-1867` (`enqueue_path` добавляет в `set`); `scan_agent/agent.py:2234-2240` (`process_watchdog_queue` берёт `set.pop()`, то есть произвольный элемент).
- **Описание:** набор без лимита, порядок обработки случайный; при интенсивной записи на диск память растёт, а самые старые пути могут не обрабатываться долго.
- **Severity:** low. **Confidence:** medium.

### B21. Строки PowerShell собираются интерполяцией значений
- **Место:** `agent_installer.py:832-855` (`schedule_self_uninstall`: проверяется только длина 38 и фигурные скобки, затем `$productCode='{normalized}'` вставляется в `-Command`, выполняется как SYSTEM); `scan_agent/agent.py:2371-2390` (`_schedule_msi_install`: экранирование через `''`, пути берутся из локального marker-файла).
- **Описание:** одинарная кавычка внутри 38-символьной строки проходит проверку и выходит из строкового литерала PowerShell. Значение приходит из аргумента `msiexec`, то есть от локального администратора; риск низкий, но проверка неполная.
- **Severity:** low. **Confidence:** medium.

### B22. Запуск PowerShell через имя без пути
- **Место:** `agent_installer.py:518-524` (`_resolve_powershell` возвращает `"powershell.exe"` без полного пути, если кандидаты не найдены).
- **Описание:** при запуске под SYSTEM имя без пути разрешается через `PATH`, что допускает подмену в каталогах `PATH`.
- **Severity:** low. **Confidence:** low.

### B23. Незащищённый SQL-шаблон с `TOP {limit}`
- **Место:** `bot/universal_database.py:453`, `:499`, `:545` (`SELECT TOP {limit}` через f-строку в `search_equipment`, `limit: int = 10` на строке 429); `:1202` для `get_equipment_by_type` значение приводится к `int`.
- **Описание:** поиск по строке параметризован (`?`), но лимит интерполируется. Сейчас все вызовы используют значение по умолчанию (`bot/services/suggestions.py:164,170,179`), поэтому уязвимости нет, но сигнатура допускает передачу произвольного значения.
- **Severity:** low. **Confidence:** high.

### B24. Защита от перехода по `..` в спуле PDF опирается на тип job_id
- **Место:** `scan_server/pdf_spool.py:26-28` (`path_for_job`: `job_id.strip().lower()` без проверки символов).
- **Описание:** `job_id` в текущем коде генерируется сервером (`scan_server/database.py:3088`, `uuid.uuid4().hex`), поэтому эксплуатации нет. Но функция не защищает от `../`, если появится другой источник id.
- **Severity:** low. **Confidence:** high.

### B25. Сверка API-ключа через `in set(...)` при каждом запросе
- **Место:** `scan_server/app.py:232-239` и `inventory_server/app.py:119-124` (`token not in set(config.api_keys)`).
- **Описание:** набор пересоздаётся на каждый запрос, сравнение не константное по времени. Риск низкий (хеш-поиск), но проверка в двух местах разная по форме.
- **Severity:** low. **Confidence:** medium.

### B26. Самообновление агента без подписи, только SHA-256 от того же сервера
- **Место:** `scan_agent/agent.py:2406-2432` (`msi_sha256` берётся из ответа сервера, затем сверяется с загруженным файлом); `scan_agent/agent.py:2371-2390` (запуск `msiexec` как SYSTEM).
- **Описание:** проверка целостности защищает только от повреждения при передаче. Если сервер или источник `SCAN_AGENT_PACKAGE_URL` скомпрометирован, злоумышленник выдаёт и хеш, и MSI. Подписи Authenticode не проверяются.
- **Сценарий:** подмена пакета на сервере приводит к установке произвольного MSI на всех агентах с правами SYSTEM.
- **Severity:** medium. **Confidence:** high.

### B27. Жёстко заданный production-URL в установщике
- **Место:** `agent_installer.py:69` (`"ITINV_AGENT_SERVER_URL": "https://hubit.zsgp.ru/api/v1/inventory"`), `agent_installer.py:` около строки 75 (`SCAN_AGENT_SERVER_BASE`).
- **Описание:** адрес сервера зашит в код MSI-дефолтов; смена хоста требует новой сборки.
- **Severity:** low. **Confidence:** high.

---

## Conflicts

### C1. Два полных экземпляра runtime агента
- **Место:** `agent.py` (корень) и `agent/src/itinvent_agent/agent.py` (3880 строк, `md5` совпадает `d73be41a…`); `agent/setup.py:14` (`AGENT_ENTRY = REPO_ROOT / "agent.py"`); `agent/setup.py:178` (пакет `itinvent_agent`); `tests/test_agent.py:329-342` (тест `test_runtime_and_packaged_agent_files_have_no_drift` сравнивает тексты).
- **Описание:** сборка берёт корневой файл, а пакет `itinvent_agent` поставляется отдельной копией. Синхронность обеспечивается только тестом. `TECH_DEBT_AUDIT.md` (F033) уже фиксирует это.
- **Severity:** medium. **Confidence:** high.

### C2. Устаревший установочный скрипт в корне расходится с агентской копией
- **Место:** `scripts/install_agent_task.ps1:65-66` (`SCAN_AGENT_POLL_INTERVAL_SEC=600`, `SCAN_AGENT_POLL_JITTER_SEC=120`); `agent/scripts/install_agent_task.ps1:65-69` (60/30, плюс `OUTBOX_DRAIN_BATCH`, `OUTBOX_DRAIN_INTERVAL_SEC`, `SERVER_QUEUE_SLOW_THRESHOLD`); `agent_installer.py:57-67` (`FORCED_SCAN_ENV_VALUES`: 60/30). `scripts/uninstall_agent_task.ps1` не содержит блоков для `ITInventTelegramProbe`/`MaxProbe`/`BrowserProbe` (которые есть в `agent/scripts/uninstall_agent_task.ps1:3-6, 57-59, 87-110`).
- **Сценарий:** администратор запускает скрипт из корня: интервал опроса 10 минут вместо 1, а probe-задачи после удаления остаются в планировщике.
- **Документация:** `agent/docs/AGENT_*.md` ссылаются на `agent/scripts`, то есть корневой скрипт не должен использоваться.
- **Severity:** medium. **Confidence:** high.

### C3. Правила сканирования реализованы дважды, с разным набором исключений
- **Место:** `scan_agent/agent.py:736-782` (`scan_text`), `scan_agent/agent.py:618-645` (регулярные выражения и `_normalize_scan_text`); `scan_server/patterns.py:177-305` (`scan_text`, `normalize_scan_text`), `scan_server/patterns.py:272-274` (исключение `secret_strict`/`classified_document_header` по контексту «допуск/соглашение о неразглашении»).
- **Описание:** агентская версия не применяет исключение по секретному контексту. Дедупликация агента использует сырой фрагмент (`agent.py:758`), сервер — нормализованный (`patterns.py:278-279`). Лимит количества совпадений 100 у агента (`agent.py:769`) и 200 у сервера (`patterns.py:299-300`).
- **Где влияет:** агент считает совпадения для текстовых файлов и текстового слоя PDF (`agent.py:1566`, `:1590`) и отправляет их; сервер пересканирует только текстовый фрагмент `text_excerpt` и OCR-результат (`worker.py:697`, `:744`, `:839`). Итоговый вердикт зависит от того, на какой стороне выполнено сканирование.
- **Severity:** medium. **Confidence:** medium.

### C4. Scan-sidecar запускается внутри процесса Inventory
- **Место:** `agent.py:453-490` (`_run_scan_sidecar` импортирует `scan_agent.agent` и запускает `ScanAgent.run_forever()`); `agent.py:3683-3692` (поток `scan-sidecar`); `scan_agent/agent.py:211-250` (`setup_logging` добавляет handler в root-логгер и поднимает его уровень, что касается и логов Inventory).
- **Описание:** AGENTS.md требует не смешивать Scan и Inventory (`agent.py` / `agent/` / `inventory_server` отдельно от `scan_agent/` / `scan_server/`). Сейчас в одном процессе общий root-логгер, общие переменные окружения (`bootstrap_env_from_files`), общий сборщик состояния.
- **Severity:** medium. **Confidence:** high (факт в коде). Оценка намеренности дизайна — medium.

### C5. Серверные компоненты импортируют пакет WEB-itinvent/backend через sys.path
- **Место:** `inventory_server/app.py:16-27` (`sys.path.insert(0, WEB-itinvent)`, затем `from backend import inventory_runtime`, `from backend.services.fs_egress_store_service import ...`); `inventory_server/worker.py:12-15`; `scan_server/database.py:33-34`.
- **Описание:** Inventory и Scan зависят от пакета веб-бэкенда и от порядка путей в `sys.path`. Изменения в `backend/` ломают отдельные сервисы без явного контракта; для `scan_server` это же устанавливает поведение `from backend...`.
- **Severity:** medium. **Confidence:** high.

### C6. Два источника определения схемы scan
- **Место:** `scan_server/database.py:921-1170+` (рантайм `CREATE TABLE IF NOT EXISTS`, в том числе `scan_ocr_cache` на строке 1156); `scan_server/alembic/versions/20260717_0001_scan_schema_init.py` (`create_all` по моделям); `scan_server/alembic/versions/20260917_0002_ocr_cache.py` (сырой DDL для `scan.scan_ocr_cache` с префиксом схемы).
- **Описание:** таблица `scan_ocr_cache` описана в трёх местах, с разным написанием схемы (`scan.` в миграции, без префикса в рантайме SQLite). Расхождение возможно при изменении одного из них.
- **Severity:** medium. **Confidence:** high.

### C7. Рантайм-DDL на старте production (сопоставление с правилом AGENTS)
- **Место:** `scan_server/database.py:921-925` (`ensure_scan_schema` при каждом старте процесса PostgreSQL).
- **Описание:** AGENTS.md: «Schema changes only via Alembic; no runtime CREATE TABLE/INDEX»; миграции на проде запускаются только явной командой. Scan создаёт таблицы и индексы при старте. Связано с B12.
- **Severity:** medium. **Confidence:** medium (возможно, для scan есть отдельное исключение; в AGENTS оно не упомянуто).

### C8. Логирование бота настраивается в двух местах
- **Место:** `bot/main.py:54-78` (`setup_logging` с root-handlers, вызывается при импорте, строка 82 `logger = setup_logging()`); `bot/equipment_data_manager.py:18` (`logging.basicConfig(level=logging.INFO)` при импорте модуля).
- **Описание:** если модуль импортируется раньше `main`, `basicConfig` создаёт консольный handler без ротации, после чего `setup_logging` добавляет ещё два handler: строки в консоли дублируются, файл `bot.log` ротируется не для всех записей.
- **Severity:** low. **Confidence:** medium.

### C9. Четыре копии `uvicorn_loops.py` с противоречивыми комментариями
- **Место:** `inventory_server/uvicorn_loops.py:5-10` (только `SelectorEventLoop`, комментарий про WinError 64 и причину отказа от Proactor); `scan_server/uvicorn_loops.py:5-11` (Proactor и Selector); `WEB-itinvent/backend/uvicorn_loops.py` (Selector); `voice_server/uvicorn_loops.py`. Использование Proactor в `scan_server/__main__.py:112` и `scan_server/app.py:1580`, в `voice_server/__main__.py:109`.
- **Описание:** один и тот же симптом (закрытие слушающего сокета после ошибки AcceptEx) в комментарии объявлен причиной Selector, а `scan_server` запускается с Proactor. Непонятно, какой вариант проверен на проде.
- **Severity:** medium. **Confidence:** high.

### C10. Пакет `itinvent_agent` импортирует модули вне себя
- **Место:** `agent/src/itinvent_agent/agent.py:28-29` (`from agent_version import AGENT_VERSION`, `import agent_installer`); `agent/setup.py:22-23` (добавление корня в `sys.path`).
- **Описание:** пакет не самодостаточен, сборка опирается на `sys.path`. Низкий риск, но ломает изолированную установку пакета.
- **Severity:** low. **Confidence:** high.

---

## Duplication

### D1. Корневой `agent.py` и `agent/src/itinvent_agent/agent.py` побайтно идентичны
- **Место:** обе копии (3880 строк); `md5sum` одинаковый. См. C1.
- **Что копируется:** всё тело агента, включая `main()` (`agent.py:3809-3880`). Изменение одной копии без другой ломает тест дрейфа.
- **Severity:** medium. **Confidence:** high.

### D2. Общие хелперы скопированы между `agent.py` и `scan_agent/agent.py`
- **Совпадают полностью:** `_atomic_write_text` (`agent.py:265-271` ≡ `scan_agent/agent.py:265-271`); `_strip_env_value` (`agent.py:272-278` ≡ `scan_agent/agent.py:148-154`); `_read_text_with_fallback` (`agent.py:279-287` ≡ `scan_agent/agent.py:646-654`, отличие только в имени переменной).
- **Расходятся:** `_to_int` (`agent.py:242-248` ≡ `scan_agent/agent.py:251-257` с разной сигнатурой по умолчанию); `_to_bool` (см. B19); `bootstrap_env_from_files` (`agent.py:363-380` / `scan_agent/agent.py:164-210`); `setup_logging` (`agent.py:492-546` / `scan_agent/agent.py:211-250`, разная реализация); `parse_args` (`agent.py:1363-1370` ≡ `scan_agent/agent.py:2684-2691` по смыслу); `main` (`agent.py:3809-3880` / `scan_agent/agent.py:2692-2729`).
- **Severity:** medium. **Confidence:** high (диапазоны получены awk, тела сравнены `diff`).

### D3. Регулярные выражения и нормализация текста продублированы в scan_agent и scan_server
- **Место:** `scan_agent/agent.py:618-645` (`_SPACED_DSP_PHRASE_RE`, `_SPACED_CYRILLIC_WORD_RE`, `_DSP_FURNITURE_RE`, `_OCR_LATIN_TO_CYRILLIC`, `_normalize_scan_text`) ≡ `scan_server/patterns.py:183-222` (`normalize_scan_text`, те же шаблоны и таблица транслитерации). См. C3.
- **Severity:** medium. **Confidence:** high.

### D4. Дважды определён `_sha256_file`
- **Место:** `scan_agent/agent.py:601-609` (функция) и `scan_agent/agent.py:2316-2320` (метод `self._sha256_file`).
- **Severity:** low. **Confidence:** high.

### D5. Установочные скрипты продублированы между корнем и `agent/scripts`
- **Место:** `scripts/install_agent_task.ps1` и `agent/scripts/install_agent_task.ps1` (разные, см. C2); `scripts/uninstall_agent_task.ps1` и `agent/scripts/uninstall_agent_task.ps1` (разные); `scripts/full_uninstall_agent.ps1` и `agent/scripts/full_uninstall_agent.ps1` (`md5` совпадает `c5ee32a3…`).
- **Severity:** medium. **Confidence:** high.

### D6. Четыре копии `uvicorn_loops.py`
- **Место:** см. C9.
- **Severity:** low. **Confidence:** high.

---

## Optimization

### O1. Два последовательных LLM-запроса на фото и отсутствие кэша
- **Место:** `bot/services/ocr_service.py:291-330` (`extract_serial_from_image`: `analyze_image`, при неудаче `analyze_image_detailed`); `ocr_service.py:71-73` (`_read_image_bytes` читает файл при каждом вызове).
- **Описание:** при неудаче первого запроса выполняется второй, оплачиваемый, запрос; результат не кэшируется по хешу файла, поэтому повторная отправка того же фото платится заново.
- **Рекомендация:** кэш по `sha256(файла)` с TTL и один запрос с объединённым промптом.
- **Severity:** medium. **Confidence:** medium.

### O2. Полная перезапись состояния сканера JSON-ом
- **Место:** `scan_agent/agent.py:566-572` (`_save_state` пишет весь `state` целиком); `scan_agent/agent.py:573-596` (`_prune_state` сортирует весь словарь хешей при превышении `MAX_HASH_ENTRIES`).
- **Описание:** при каждом сохранении (до раза в 15 секунд, см. B14) сериализуется весь словарь `files` + `hashes`. Стоимость растёт линейно с числом отсканированных файлов.
- **Severity:** medium. **Confidence:** medium (размер состояния не измерен).

### O3. OCR на Windows идёт пулом потоков, а не процессов
- **Место:** `scan_server/worker.py:390-398` (`if IS_WINDOWS: ThreadPoolExecutor`), `worker.py:190` (в логах `"thread" if IS_WINDOWS else "process"`).
- **Описание:** на production-хостах (Windows) параметр `ocr_max_processes` задаёт число потоков. Рендер PyMuPDF и Python-часть работают под GIL, параллельность ограничена. Остановить зависший `tesseract` из потока нельзя (см. B10).
- **Severity:** medium. **Confidence:** medium.

### O4. Настройка SQLite на каждое подключение и незакрываемые соединения
- **Место:** `local_store.py:239-244` (`_connect`: на каждом подключении выполняются `PRAGMA journal_mode=WAL` и `synchronous=NORMAL`); `local_store.py:247`, `:370`, `:428`, `:444` и др. (`with self._lock, self._connect() as conn:`: контекстный менеджер `sqlite3` фиксирует транзакцию, но не закрывает соединение).
- **Описание:** каждый вызов открывает новое соединение и повторяет PRAGMA; соединения закрываются только сборщиком мусора.
- **Severity:** low. **Confidence:** high.

### O5. Новое соединение pyodbc на каждый запрос бота
- **Место:** `bot/universal_database.py` (например, `search_equipment` 429+ использует `with self._get_connection() as conn` и `finally: conn.close()`); `bot/universal_database.py:138-160` (`_get_connection` создаёт соединение с `timeout=30`).
- **Описание:** нет пула соединений; каждый обработчик создаёт новое подключение к SQL Server.
- **Severity:** low. **Confidence:** medium.

### O6. Глобальный лок и проверка воркера на каждый POST в inventory
- **Место:** `inventory_server/app.py:96-112` (`ensure_worker_alive` берёт `worker_lock`); вызывается из `receive_inventory` (`app.py:188-189`).
- **Описание:** при каждом приёме инвентаря выполняется захват лока и проверка потока. Стоимость мала, но лок сериализует все POST.
- **Severity:** low. **Confidence:** medium.

### O7. Потеря уведомлений для медленных SSE-подписчиков
- **Место:** `scan_server/realtime.py:73-81` (`_publish`: при полной очереди удаляется самое старое событие).
- **Описание:** медленный клиент пропускает обновления разделов без признака потери; клиент не знает, что нужно перезапросить данные.
- **Рекомендация:** при переполнении отправлять событие «resync» или `seq` для сверки.
- **Severity:** low. **Confidence:** medium.

### O8. Отдельный `requests.post` без сессии на каждую отправку
- **Место:** `agent.py:3339-3354` (`_post_payload` вызывает `requests.post` без `Session`).
- **Описание:** при каждом heartbeat новое TCP и TLS-рукопожатие.
- **Severity:** low. **Confidence:** medium.

---

## Dead code

### X1. Мусорные скрипты в корне, на которые нет ссылок
- **Отслеживаемые файлы без ссылок:** `_process_pipeline.py`, `_audit_check.py`, `_blob_check.py`, `_chunk_rhythm.py`, `_active_rows.py`, `_expiry_check.py`, `_file_status.py`, `_fix_retention.py`, `_restore_row.py` (`git ls-files --error-unmatch` подтверждает, что все они в индексе).
- **Неотслеживаемые:** `tmp_chunk_e2e.py` (`git status`: `??`).
- **Проверка:** `git grep` по имени не находит ссылок из кода, тестов и скриптов (кроме сторонних каталогов `deploy_*`).
- **Рекомендация:** удалить после подтверждения владельцем; это не делается в рамках аудита.
- **Severity:** low. **Confidence:** high.

### X2. Устаревшие egg-info каталоги
- **Место:** `HUB_IT_Agent.egg-info/` и `IT_Invent_Agent.egg-info/` в корне, `agent/src/HUB_IT_Agent.egg-info` (игнорируются `.gitignore`, в git не отслеживаются).
- **Описание:** метаданные старых имён пакета; `agent/setup.py` их создаёт. На сборку не влияют, но путают при поиске.
- **Severity:** low. **Confidence:** high.

### X3. Функция `analyze_image_with_confidence` без вызовов
- **Место:** `bot/services/ocr_service.py:446-460`.
- **Описание:** `grep` по `bot/` не находит вызовов функции (экспорт в `bot/services/__init__.py` указывает только `extract_serial_from_image`).
- **Severity:** low. **Confidence:** high.

### X4. Демонстрационный код в модуле кэша
- **Место:** `bot/cache_manager.py:300-315` (`time.sleep(1)  # Имитация долгой операции`, печать результатов).
- **Описание:** тестовая функция в боевом модуле; при импорте не выполняется, но `time.sleep` в модуле кэша вводит в заблуждение.
- **Severity:** low. **Confidence:** medium.

---

## Не подтверждено (проверено, находок нет)

- `verify=False`, `CERT_NONE`, `check_hostname=False`, `_create_unverified_context` в компонентах: не найдено (`git grep`). TLS-проверка агента управляется `ITINV_AGENT_CA_BUNDLE` (`agent.py:1403-1411`), по умолчанию `verify=True`.
- `shell=True`, `os.system`, `os.popen`: не найдено. Все PowerShell-вызовы используют список аргументов.
- `extractall` / `tarfile` / `zipfile` в агентах и сервере: только `agent/scripts/pack_crx3.py` (сборка, не runtime).
- LLM: все вызовы в боте идут через `shared/llm` (`bot/services/ocr_service.py:13`); локальных `OpenAI(`-клиентов в `bot/`, `scan_server/`, `inventory_server/` нет.
- Динамический SQL в `scan_server/database.py`: `where_sql` в retention формируется из констант (`database.py:5715-5745`), имена таблиц захардкожены.
- Потенциальный XSS в отчёте Telegram-probe: отчёт экранируется через `html.escape` (`telegram_uia_probe/telegram_probe/report.py:311-356`), серверный отчёт в `WEB-itinvent/backend/services/dlp_report_service.py:13` тоже экранирует.
- Пути файлов в `scan_server/app.py` (`/api/v1/scan/agent-package`): путь берётся из конфигурации, не из запроса.
- Retention в `scan_server/system_metrics_retention.py:127-128`: по умолчанию выключен (`enabled=false`) и работает в режиме dry-run (`dry_run=true`), что соответствует AGENTS.md.

## Ограничения аудита

- Python в окружении недоступен (вызовы `python`/`py` не работают), поэтому сравнение функций выполнено через awk и `diff`, а не через `ast`.
- Не запускались тесты, сервисы и БД (по условию задания).
- Оценки severity для B12, B26, C4 зависят от продуктовых решений и от реального числа процессов на проде; помечены как medium с подробностями.
- Версия `requests` и её поведение при редиректах (B8) взяты из знания библиотеки, не из запуска.
