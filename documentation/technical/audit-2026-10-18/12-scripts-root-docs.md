# Аудит 12: scripts/, PM2, deploy*, templates, зависимости, корень репозитория, документация

Режим: READ-ONLY (Read/Grep/Glob, git ls-files/status/check-ignore/log/grep). Ни один файл репозитория не менялся, скрипты и PM2 не запускались.
Дата проверки: 2026-10-18. Выборка по git-индексу: 5133 tracked-файла.

Ограничения:
- Все выводы статические. Live-состояние PM2, venv и prod-БД не проверялось.
- `du` по большим каталогам упирался в таймаут; размеры дано по числу записей верхнего уровня, где не удалось измерить байты.
- Значения секретов и персональных данных в отчёт не переносились, указаны только путь, строка и вид данных.
- Примечание: команда `rm` для временного файла `/tmp_c_root.txt` (вне репозитория, в корне Git Bash) заблокирована встроенной проверкой безопасности и не выполнена. Файл создан моей командой сравнения `constraints`, его нужно удалить вручную.

Обозначения: severity = critical / high / medium / low; confidence = high / medium / low.

---

## Сводка по приоритету

1. **high**: секреты и ПДн в tracked/untracked-файлах (B-01, B-02, B-08), `stop-all` и `clear-pm2-orphans` не покрывают voice и два retention-воркера (B-03, B-04), нет общей блокировки PM2-операций (B-05), в README PM2 рекомендованы голые `pm2 restart` (C-01).
2. **high**: пропущенная декларация `python-multipart` для backend (B-10), untracked-файлы `scripts/livekit/` ломают воспроизводимость (B-07).
3. Остальное: мусор в корне, дубли документов и скриптов, мёртвые конфиги.

---

## 1. Bugs (ошибки, риски безопасности и эксплуатации)

**B-01. [high | conf high]** Ключ в tracked-файле `WEB-itinvent/backend/.env.legacy:124`.
Файл в git (коммиты `6ac02e7e`, `710f0651`), `.gitignore:30,66` ловит только точное имя `.env`, поэтому `.env.legacy` не игнорируется.
Evidence: `SCAN_AGENT_API_KEY` непустой (30 символов, префикс `itinven…`, похож на боевой). В файле также есть внутренние хосты, логины, SMTP-настройки и `EMAIL_ADDRESS`. Значения `TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`, `SQL_SERVER_PASSWORD` пустые. Действительность ключа не проверялась.
Действие: считать ключ скомпрометированным, ротировать, удалить файл из индекса и истории, добавить `.env.*` в `.gitignore` (кроме `.env.example`).

**B-02. [high | conf high]** `WEB-itinvent/_manual_env_tests/.env1` и `.env2` (tracked).
Evidence: в `.env2:1` есть `JWT_SECRET_KEY` (18 символов, в значении есть слово-заглушка, возможно пример). `.env1` содержит `VITE_API_URL`. Файлы в индексе, `.gitignore` их не покрывает.
Действие: проверить значение; если оно рабочее, ротировать. Удалить каталог из индекса.

**B-03. [high | conf high]** `scripts/pm2/stop-all.ps1:12` — список остановки неполный.
Список `$processNames` не содержит `itinvent-voice`, `itinvent-voice-worker`, `itinvent-voice-archiver` (`ecosystem.voice.config.js:27,45,64`), `itinvent-chat-push-outbox-retention-worker` (`ecosystem.backend.config.js:337`), `itinvent-scan-system-metrics-retention-worker` (`ecosystem.scan.config.js:126`). Все пять есть в `expected apps` в `scripts/pm2/_boot_resurrect.log:5`.
Evidence: `grep -c -i "voice|outbox|system-metrics"` дал 0 для `start-all.ps1`, `restart-all.ps1`, `stop-all.ps1`. При `stop-all` эти процессы продолжают работать.
Тот же список в `start-all.ps1:13` и `restart-all.ps1:13` используется только в `-WhatIf` и не совпадает с экосистемой.

**B-04. [high | conf high по регулярным выражениям]** `scripts/pm2/clear-pm2-orphans.ps1:37-49` не чистит orphan-процессы части приложений.
- voice: нет шаблонов для `-m voice_server`, `voice_server.worker_main`, `voice_server.archiver` (`ecosystem.voice.config.js:30,48,67`).
- `start_chat_push_outbox_retention_worker.py` (`ecosystem.backend.config.js:337`) не совпадает с шаблоном в строке 44 (`start_(mail_notification|chat_push)_worker\.py`).
- `-m scan_server.system_metrics_retention_main` (`ecosystem.scan.config.js:126`) не совпадает с шаблоном в строке 41, потому что там требуется пробел после `scan_server`.
Скрипт вызывается из `start-all`, `restart-all`, `stop-all`. Orphan после `pm2 kill` может удерживать порты и singleton-блокировки. Детектор watchdog (`runtime-operations.ps1`, `Get-HubitOrphanProcesses`) эти процессы видит, а `clear-pm2-orphans` нет.

**B-05. [high | conf high по grep]** Нет общей блокировки PM2-операций.
Мьютекс `Global\HUB-IT-PM2-Operations` берут только `pm2-boot-resurrect.ps1:158`, `pm2-watchdog.ps1:21`, `restart-chat-scale.ps1:215`.
Не берут `start-all.ps1`, `restart-all.ps1` (делает `pm2 kill`), `stop-all.ps1`, `restart-backend.ps1`, `restart-scan.ps1`, `restart-chat.ps1`, `restart-ai-agents.ps1`.
Watchdog запускается каждые 3 минуты (`_watchdog.log`), и ручной `restart-all` может прийти во время его восстановления.

**B-06. [medium | conf high]** `scripts/pm2/start-all.ps1:137`, `restart-all.ps1:151` — `-ChatMode` не передаётся в экосистему.
`pm2 start ecosystem.all.config.js` не получает `HUBIT_CHAT_MODE`, а `ecosystem.all.config.js:15-21` выбирает режим из env и `.env`. Итог: `Get-ChatProcessNames` (с учётом `-ChatMode`) и реально запущенные приложения могут разойтись.
Дополнительно `chat-runtime-mode.ps1:13-33` не читает env-переопределение, которое читает `ecosystem.all.config.js:16`. Комментарий в `ecosystem.all.config.js:13-14` утверждает, что логика совпадает.

**B-07. [high | conf high]** `scripts/livekit/` целиком не в git (`git status: ??`), в том числе `livekit.example.yaml` и `set-calls-env.py`.
`scripts/pm2/ecosystem.livekit.config.js:8` ссылается на `scripts/livekit/livekit.yaml`, который игнорируется по правилу. Шаблон, из которого он создаётся, в репозиторий не попал. Свежий клон не поднимет звонки. Документ `scripts/pm2/README.md:247-250` ссылается на шаблон как на существующий.

**B-08. [high | conf high]** Персональные данные вне индекса и не игнорируются (риск `git add -A`).
- `users_export_test.csv` в корне: 2836 строк, одна колонка (по имени файла — выгрузка пользователей, содержимое не разбиралось).
- `portal_upload_duplicates.tsv` в корне: 424 строки, 8 колонок.
- `VEL/`: 80 файлов `VELG-ACC-*.txt`, ISO-8859, по 130–290 КБ, ~14 МБ. Вид данных: учётные записи (по имени и структуре), в тексте не разбирался.
- `Microsoft/Windows/` (пустое дерево, 7 октября) в корне.
Ни один из путей не в `.gitignore`.

**B-09. [high | conf high]** `scripts/purge_hub_sqlite.py:72-87` — `DELETE FROM [table]` по всем HUB-таблицам.
Нет `--dry-run`, подтверждения и флага. AGENTS.md требует dry-run, флаг и явное разрешение для любой очистки на prod.

**B-10. [high | conf medium]** Не объявлена зависимость `python-multipart` для backend.
19 модулей backend используют `UploadFile` или `Form(` (проверено grep). В `WEB-itinvent/backend/requirements.txt` и `WEB-itinvent/backend/constraints.txt` пакета нет. `scan_server/requirements.txt:10` его декларирует (`>=0.0.26`), `scan_server/constraints.txt` фиксирует `python-multipart==0.0.26`. Если в prod-venv пакет поставлен вручную, сборка на чистой машине сломается при запуске маршрутов с формами. Venv не проверялся.

**B-11. [medium | conf high]** `bot/services/pdf_generator.py:146` — жёсткий относительный путь `templates/docx_transfer_act.docx`.
Конфиг `bot/config.py:190` берёт путь из `TRANSFER_TEMPLATE_PATH`. Результат зависит от рабочего каталога процесса.

**B-12. [medium | conf medium]** Убийство процесса по порту без проверки командной строки.
`scripts/pm2/restart-chat.ps1:56-65` (порт 8002, kill на :62), `restart-chat-scale.ps1:165` (8002/8004), `restart-scan.ps1:70-76` (8011, kill на :75), `restart-backend.ps1:78` (8001) — `taskkill /F` по PID слушателя порта без проверки, что это наш процесс.
Пример риска: чужой сервис на том же порту будет убит.

**B-13. [medium | conf high]** `scripts/pm2/pm2-watchdog.ps1:35` — путь к pm2 через `$env:USERPROFILE`.
Остальные скрипты (`pm2-boot-resurrect.ps1:55-66`, `start-all.ps1:44-58`) ищут pm2 через `APPDATA`, `where.exe` и т.п. Для задачи в другом контексте (S4U/SYSTEM) путь может не совпасть.

**B-14. [medium | conf high]** `scripts/pm2/enable-chat-redis.ps1:3,122` — пароль Redis передаётся параметром CLI и пишется в `.env`.
AGENTS.md запрещает передавать секреты через CLI, когда есть env или защищённый конфиг. В `scripts/pm2/README.md` скрипт не описан.

**B-15. [medium | conf high]** `scripts/pm2/itinvent-ai-sandbox-control`: процесс вне `ecosystem.all` (`scripts/ai-sandbox/ecosystem.control.config.js:7`), отсутствует в expected apps (`_boot_resurrect.log:5`), в README PM2 не описан, но `health-check.ps1:714` считает его критичным, а `restart-ai-agents.ps1:7,42` его запускает. Автозапуск держится только на `dump.pm2`. AGENTS.md требует описать такой процесс в runbook.

**B-16. [medium | conf high]** `health-check.ps1:706-716` не проверяет voice (три процесса), `outbox`-воркер и `scan-system-metrics`-воркер. При этом `runtime-operations.ps1:116` проверяет готовность voice на 8013, а `pm2-watchdog.ps1:128` восстанавливает voice.

**B-17. [medium | conf high]** Журнал `scripts/pm2/_boot_resurrect.log` (17.10.2026) фиксирует нестабильные процессы: `itinvent-livekit` restarts=760, `itinvent-voice-worker` restarts=643, `itinvent-voice-archiver` restarts=353, `itinvent-my-files-worker` restarts=30, `itinvent-preview-worker` restarts=8. Это наблюдение по логу, а не live-проверка. Список отложенного старта (`pm2-boot-resurrect.ps1:253-257`) не содержит `voice-worker`.

**B-18. [low | conf high]** `pm2-boot-resurrect.ps1:284` — голый `Invoke-Pm2 restart` для `itinvent-scan` и `itinvent-scan-worker` в отложенном старте. Это противоречит правилу «scan только через restart-scan». Риск низкий, так как сразу после загрузки orphan-процессов обычно нет.

**B-19. [low | conf medium]** `scripts/pm2/health-check.ps1:770-772` — ветка `-RepairBackend` не проверяет код возврата (в отличие от ветки scan, строки 750-762).

**B-20. [low | conf medium]** `pm2.cmd:14-16` выбирает последний каталог `node-v*` в порядке `for /d`, а `pm2.ps1:7-10` сортирует по убыванию. Могут использоваться разные версии Node.

**B-21. [medium | conf high]** Опасный одноразовый скрипт в `scripts/pm2/restart_inventory_1c_backend_once.ps1:8,10,13` зашивает PID продовых процессов (18696, 39180) и порт 8001. Скрипт проверяет PID и падает при несовпадении (fail-closed), но лежит как часть рабочих инструментов.

**B-22. [medium | conf high]** `scripts/seed_hub_chat_loadtest_users.py:14` — жёсткий пароль `DEFAULT_PASSWORD = "LoadTest!2026"` в tracked-файле. Скрипт пишет в БД; при запуске на prod появятся учётки с известным паролем.

**B-23. [medium | conf medium]** `_fix_retention.py:10` и `_restore_row.py:9` — прод-правки `update app.my_files` в корне репозитория с жёстко зашитым `sys.path` (`:2`). Одноразовые скрипты, но tracked и без защиты от повторного запуска.

**B-24. [medium | conf medium]** `scripts/_cleanup_hub_bench_tasks.py:19-38` удаляет задачи через `hub_service.delete_task(is_admin=True)` без dry-run. Скрипт никем не вызывается (0 ссылок).

**B-25. [medium | conf low]** `scripts/password_vault_bruteforce.py` (355 строк) — перебор кандидатов `PASSWORD_VAULT_KEY`, tracked. Инструмент двойного назначения в репозитории, в шапке признан бесперспективным. Вынести из репозитория или ограничить.

**B-26. [low | conf medium]** `scripts/recover_local_store_from_backup.py` (473 строки) содержит несколько `unlink/os.remove/DELETE`, без флага dry-run. Проверить перед использованием.

---

## 2. Conflicts (расхождения документов, правил и кода)

**C-01. [high | conf high]** `scripts/pm2/README.md:229, 235, 241` — `pm2 restart itinvent-inventory`, `pm2 restart itinvent-scan`, `pm2 restart itinvent-bot`.
Конфликт с тем же README (строка ~218: «прямой PM2-restart backend-процесса на Windows не использовать»), с `SCAN-RUNTIME-STABILIZATION.md:152, 306` («НЕ использовать: pm2 restart itinvent-scan») и с AGENTS.md (только standard-скрипты). Инструкции расходятся.

**C-02. [medium | conf high]** `scripts/restore-env.ps1:7, 46` — после восстановления `.env` предлагается `pm2 restart all --update-env`. Конфликт с AGENTS.md. Скрипт также интерактивный (`Read-Host`).

**C-03. [low | conf high]** `scripts/check-passkey-backend.ps1:33` — подсказка «pm2 restart».

**C-04. [medium | conf high]** `scripts/pm2/README.md:10` перечисляет `ecosystem.backend.scale.config.js` как рабочий файл, а строка 173 велит его не запускать. `ecosystem.all.config.js:3-9` его не подключает. Файл мёртвый (см. D-05).

**C-05. [medium | conf high]** `scripts/pm2/README.md:7-19` и `:79` — список конфигов неполный: нет `ecosystem.voice.config.js` и runbook для voice. Пункт `:79` сам перечисляет voice как подключённый. Нет runbook для `scripts/ai-sandbox/ecosystem.control.config.js` (см. B-15).

**C-06. [medium | conf high]** `TESTING_CHECKLIST.md:10` — `python -m pytest tests/ --tb=short -q` («~2.5 мин») как основная команда. Конфликт с AGENTS.md («Verification commands»: от узкого к широкому, не перезапускать непокрытое) и с `TESTING.md`.

**C-07. [high | conf high]** AGENTS.md:93 ссылается на `documentation/technical/TESTING.md`, а этот файл не в git (`??`). Ссылка сломана у любого клона. Аналогично `scripts/pm2/README.md:250` и `health-check.ps1:509` ссылаются на `documentation/technical/CHAT_CALLS_LIVEKIT.md` (тоже `??`). Итого untracked в `documentation/`: `TESTING.md`, `CHAT_CALLS_LIVEKIT.md`, `NETWORK_MONITORING*.md` (3), `AI_ASSISTANT_MEMORY.md`, `EQUIPMENT_DB_TRANSFER.md`.

**C-08. [low | conf high]** `documentation/technical/REPOSITORY_MAP.md:171` утверждает, что `IS_CAPACITOR_*` всегда `false`. В коде `WEB-itinvent/frontend/src/lib/platform.js:4` (`IS_CAPACITOR_BUILD = false`) и ещё ~40 упоминаний в 22 файлах. AGENTS.md запрещает Capacitor. Это мёртвые флаги, а не возврат технологии.

**C-09. [medium | conf high]** Расхождение пинов между файлами ограничений:
- `alembic` 1.18.4 (`WEB-itinvent/backend/constraints.txt`) против 1.16.4 (`scan_server/constraints.txt`);
- `greenlet` 3.3.2 против 3.2.4;
- `markupsafe` 3.0.3 против 3.0.2.
Процессы разные, но ожидаемая единая база не соблюдена.

**C-10. [medium | conf high]** Заголовки `WEB-itinvent/backend/requirements.txt:1-2` обещают воспроизводимость через `-c constraints.txt`, но большинство записей не запинено, а `constraints.txt` корня описан как «root bot/dev runtime» и не покрывает backend. Три независимых ограничения (корень, backend, scan_server), для `scan_agent/requirements.txt` и `voice_video/requirements.txt` ограничений нет. Корневой `constraints.txt:2` датирован 2026-05-02 (генерация из окружения, не lock-файл).

**C-11. [low | conf medium]** `requirements.txt:10` (`xlrd>=2.0.0`) и `constraints.txt:51` — прямых импортов `xlrd` в tracked-коде нет (0 файлов). Нужен только pandas для `.xls`. Кандидат на удаление после проверки.

**C-12. [low | conf medium]** `voice_video/requirements.txt`: `jinja2`, `librosa`, `soundfile` без прямых импортов в tracked-коде. Проверить, нужны ли они транзитивно.

**C-13. [low | conf high]** `pytest.bot.ini:28` — `--cov-fail-under=1` (порог 1%) и `testpaths` из двух файлов. Ворота покрытия фактически не работают.

---

## 3. Duplication (дубли)

**D-01. [medium | conf high]** Одинаковые PM2-хелперы скопированы в каждом скрипте. `Resolve-Pm2Command` есть в `start-all.ps1:44-69`, `restart-all.ps1:44-69`, `stop-all.ps1:21-46`, `restart-chat.ps1:19-36`, `pm2-boot-resurrect.ps1:55-87` и в `restart-backend.ps1`. `Get-Pm2Snapshot`/`Show-Pm2Snapshot` в трёх файлах (`start-all:73-124`, `restart-all:73-124`, `stop-all:50-101`). `Add-LocalNodeToPath` в `start-all:22-42`, `restart-all:22-40`, `pm2-boot-resurrect:35-53`. `Get-PortListenerPids` в `clear-pm2-orphans.ps1:5-16`, `restart-chat.ps1:38-54`, `restart-scan.ps1` и `restart-chat-scale.ps1`. Уже есть `runtime-operations.ps1` — вынести туда.

**D-02. [medium | conf high]** `scripts/mail_box_sync_domain.ps1` и `deploy/mailbox_quota_collector/mail_box_sync_domain.ps1` идентичны (diff = 0 строк). Плюс корневые `mail_box.ps1` и `mail_box_l.ps1` — старые варианты, diff между ними ~650 строк, нигде не вызываются (кроме комментария в `deploy/.../mail_box_sync_domain.ps1:74`). `mail_box.ps1:2-3` содержит жёсткий сервер `tmn-srv-exch-01.zsgp.corp`.

**D-03. [medium | conf high]** Дубли конфигурации PM2:
- `ecosystem.chat.scale.config.js:113` (`itinvent-preview-worker`) и `:149` (`itinvent-chat-push-worker`) повторяют `ecosystem.backend.config.js:149,223` с другим env;
- `ecosystem.backend.scale.config.js:55-150` повторяет шесть воркеров из `ecosystem.backend.config.js`.
В dual-режиме используются только определения из `backend.config` (`ecosystem.all.config.js:39-40`), остальные — источник дрейфа.

**D-04. [medium | conf high]** Порченые копии документов в `documentation/technical/`: `CHANGELOG.Id_300000928c50003.md`, `FEATURES.Id_3000007fb6c002c.md`, `SCAN_ARCHITECTURE.Id_300000c6a580028.md`, `TROUBLESHOOTING.Id_300000928ca0003.md`, `USER_GUIDE.Id_300000928cb0003.md` и `documentation/README.Id_300000953120005.md`. Это UTF-16 или бинарные артефакты конфликтов, в tracked. `SCAN_ARCHITECTURE.Id_...` (2354 байта) содержит дамп HTTP-ответа (вид данных: сетевой захват). Признаков cookie/token/password по ключевым словам не найдено. Рекомендация: удалить все.

**D-05. [medium | conf high]** `TECH_DEBT_AUDIT.md` (613 строк) — три разных аудита в одном файле: 2026-09-19 (`:1`), «Scan Center audit delta 2026-07-14» (`:219`), «Tech Debt Audit 2026-06-29» (`:268`). Внутри два раздела «Executive Summary» (`:274`, `:308`) и два «Repeat-run delta». Дубли и устаревшие разделы.

**D-06. [medium | conf high]** Пересекающиеся мобильные документы: 32 файла `documentation/technical/MOBILE_*` (например `MOBILE_HUB_NATIVE_*` ×9, `MOBILE_HUB_APK_*` ×3, `MOBILE_CHAT_*` ×3, два аудита верстки и анимации за сентябрь). Нужна одна актуальная карта.

**D-07. [low | conf medium]** Пересекающиеся аудиты чата и безопасности: `CHAT_WEB_BACKEND_BUG_AUDIT_2026-09-05.md` и `CHAT_WEB_BACKEND_REMAINING_BUGS_2026-09-06.md`; `security_best_practices_report.md` (корень, 2026-09-24) и `.agents/skills/security-best-practices`, `MY_FILES_SECURITY_REVIEW.md`, `PASSWORD_VAULT_SECURITY_PLAN.md`.

**D-08. [low | conf high]** `templates/docx_transfer_act.zip` — дубль `docx_transfer_act.docx` (ссылок на `.zip` нет, ссылаются на `.docx`).

**D-09. [low | conf high]** `pm2.ps1` и `pm2.cmd` в корне — две обёртки с одной ролью.

---

## 4. Optimization (ресурсы и эксплуатация)

**O-01. [medium | conf high]** `scripts/pm2/_health_scheduled.log` — 25 МБ, без ротации. Файл в UTF-16. `pm2-watchdog.ps1:31-34` обрезает только `_watchdog.log` и только при >1 МБ (оставляет 200 строк).

**O-02. [low | conf high]** `deploy_backups/`: ~27 каталогов `frontend-dist-*` и `frontend_dist_before_*` (полные сборки frontend). Каталоги игнорируются, но занимают диск. Ретенция не описана.

**O-03. [low | conf high]** Корневые каталоги с большим числом записей (все игнорируются): `output/` (1652), `tmp/` (1353), `transfer_acts/` (1136), `_restored_from_git_ec63_b/` (341, полная копия репозитория), `artifacts/` (137), `_codex_test_tmp/` (70), `backups/` (65). Не удалять без проверки: `output/pm2-incidents` пишет watchdog (`pm2-watchdog.ps1:123`).

**O-04. [low | conf high]** `deploy_staging/`: `backend-openapi-current.json` (718 КБ) и ~20 каталогов staging-проверок за август-сентябрь. Устаревшие проверки можно убрать по ретенции.

---

## 5. Dead code / clutter

### 5.1 Таблица групп корня

Легенда: T = tracked, I = ignored (.gitignore), U = untracked не игнорируется.

| Группа | Состояние | Ссылки в коде | Рекомендация |
|---|---|---|---|
| `tmp_*.py` (11 файлов) | U, не игнорируется | 0 | Удалить или перенести в игнорируемый каталог до коммита. `tmp_pg_schema_check.py` содержит строки подключения к БД (2 строки). |
| `zup_probe*.py` (13 файлов) | U, не игнорируется | 0 | Удалить. По 1 строке с ключевыми словами (password/token) в каждом файле, проверить до коммита. |
| `_active_rows.py`, `_audit_check.py`, `_blob_check.py`, `_chunk_rhythm.py`, `_expiry_check.py`, `_file_status.py`, `_fix_retention.py`, `_process_pipeline.py`, `_restore_row.py` | T | 0 | Одноразовые. `_fix_retention.py`, `_restore_row.py` содержат `update` по `app.my_files`. Удалить или архивировать. |
| `apply_texts.py` (24.6 КБ), `apply_texts2.py` (17 КБ) | T | 0 | Одноразовые патчи текстов. Удалить. |
| `local_store.py` (31 КБ) | T | импортируется WEB-itinvent backend: `inventory_runtime.py:15`, `json_db/manager.py:15`, `api/v1/vcs.py:21`, `api/v1/inventory.py:31`, `database/equipment_db.py:85` | **Не трогать** (перенос сломает runtime). |
| `browser_probe_agent.py`, `max_probe_agent.py`, `telegram_probe_agent.py` | T | `agent/setup.py:16-18`, `agent/scripts/run_*.cmd` | Оставить. |
| `mail_box.ps1`, `mail_box_l.ps1` | T | не вызываются | Удалить (см. D-02). |
| `pm2.ps1`, `pm2.cmd` | T | AGENTS (fallback) | Оставить одну обёртку (D-09). |
| `setup.py` (BOM) | T | делегирует в `agent/setup.py` | Оставить, это шим совместимости. |
| `skills-lock.json`, `patterns_strict.yaml`, `slopo.conf.yaml`, `slopo-clean.conf.yaml` | T | только `.gitignore:37-40` | Перенести в каталог tooling (не в `tools/`: см. ниже). |
| `ОбработкаЗапросовXDTO*.txt` (3 файла, ~1.2 МБ, UTF-8 CRLF) | T | 0 | Выгрузки модулей 1С. Перенести в `docs/` или удалить. Слов «пароль/password» нет. |
| `TECH_DEBT_AUDIT.md`, `SCAN-RUNTIME-STABILIZATION.md`, `TESTING_CHECKLIST.md`, `security_best_practices_report.md` | T | см. D-05, C-06 | Перенести в `documentation/` или `docs/` как архив. |
| `portal_upload_duplicates.tsv`, `users_export_test.csv` | U, не игнорируется | 0 | Удалить (ПДн, см. B-08). |
| `VEL/` (80 файлов) | U, не игнорируется | 0 | Удалить или вынести вне репо (см. B-08). |
| `Microsoft/Windows/` | U, не игнорируется | 0 | Удалить, пустое дерево. |
| `nul` (0 байт) | U, не игнорируется | — | Имя устройства Windows. Ломает `git add` и проводник. Удалить через `\\?\` или cmd. |
| `_timed.ps1`, `_timed.ps1)` | I | — | Удалить (второй файл с лишней скобкой в имени). |
| `testwrite.txt` | I | — | Удалить. |
| `mf_*.log` (17), `bot.log*`, `debug-*.log`, `pytest-*.log`, `test-*.log`, `frontend-test.log`, `recovery-audit.log`, `tmp_*.log`, `_process_file.log` (всего ~34 `*.log`) | I | — | Удалить или ротировать. `bot.log*` может содержать идентификаторы чатов (вид данных, не разбирался). |
| `_restored_from_git_ec63/` (пусто), `_restored_from_git_ec63_b/` (341 запись, полная копия) | I | — | Удалить после подтверждения. |
| `_recovery_probe/` (13 записей, `ec63.tar` с 1302 записями) | I | — | `ec63.tar` содержит `.env.legacy`, `_manual_env_tests/.env1`, `.env2` (копии секретов). Удалить или зашифровать. |
| `_codex_test_tmp/` (70), `test_tmp_scan/` (13), `tmp_spool_test/` (5), `build/` (пусто), `dist/` (4) | I | — | Удалить после проверки. |
| `output/`, `artifacts/`, `backups/`, `tmp/`, `transfer_acts/` | I | `output/pm2-incidents` — runtime | Не трогать `output/pm2-incidents`. Остальное — по ретенции. |
| `tools/` | I (`.gitignore:163`) | runtime (node, livekit, dotnet) | **Не переносить туда файлы**: каталог игнорируется, файлы перестанут быть tracked. |
| `google-services.json` | I (`.gitignore:191`) | — | Конфиг клиента Firebase на диске, в индекс не попадает. Ок. |
| `.env` (на диске) | I | — | Ок, но не должен попадать в индекс (см. B-01 и `.gitignore:30`). |
| `iz/` (2 файла, tracked) | T | 0 (только `.gitignore:106-110`) | `move_from_tmn_law_0033.py` перемещает файлы с удалённых C$ через `shutil.move` (есть `--dry-run`), плюс `.ps1`-двойник. Одноразовая операция, архивировать. |
| `bitrix/chelovek-slova/` (3 файла PHP/CSS) | T | 0 | Не относится к стеку репозитория. Проверить и удалить. |
| `browser_probe/`, `fs_egress/`, `telegram_uia_probe/` | T | ссылаются из `agent/setup.py` и документов | Оставить. |
| `voice_video/` (47 файлов), `voice_server/` (27) | T | ссылки есть | Оставить (нет отдельного runbook, см. C-05). |

### 5.2 Скрипты `scripts/` и PM2

- **D-10 [low | conf high]** 17 одноразовых миграций `scripts/migrate_*_sqlite_to_postgres.py` и `migrate_json_to_sqlite.py`. AGENTS.md требует миграций через Alembic. Архивировать в `scripts/archive/`.
- **K-01 [medium | conf high]** Подчёркнутые одноразовые скрипты без ссылок (0 ссылок в git): `scripts/_compare_employees_email.py`, `_compare_employees_email_appeared.py`, `_diag_1c_probe.py`, `_cleanup_hub_bench_tasks.py`, `_bench_hub_task_create_reject_rerun.py`. Данные: `scripts/_hub_pg_list.txt` (129 строк), `_hub_announcements_list.txt` (39 строк), e-mail в них не найден. Удалить или архивировать.
- **K-02 [low | conf high]** Бенчмарки и профайлеры в корне `scripts/`: `bench_hub_task_*` (5), `benchmark_routerai_*` (4), `profile_chat_*` (4), `one_c_catalog_compact_*bench*` (3-4). Вынести в `scripts/perf/` (там уже есть один файл).
- **K-03 [medium | conf high]** Мёртвые и недокументированные PM2-скрипты: `scripts/pm2/list-empty-env.ps1` (0 ссылок; его `list-empty-env-pm2.js` ссылается только он), `scripts/pm2/enable-chat-redis.ps1` (0 ссылок, см. B-14), `scripts/pm2/restart_inventory_1c_backend_once.ps1` (одноразовый, см. B-21), `scripts/pm2/restart-mail-notification-worker.ps1` (0 ссылок, не описан в README, но перезапускает воркер и убивает python-процессы). Удалить или описать в runbook.
- **K-04 [low | conf medium]** `scripts/pm2/_watchdog_state.json` — runtime-состояние, не игнорируется (перезаписывается каждые 3 минуты, `pm2-watchdog.ps1:119-121`). Добавить в `.gitignore`.
- **K-05 [low | conf high]** `scripts/releases/publish_inventory_1c_frontend.py`, `scripts/network_monitoring_visibility.py` — untracked (`??`). Закоммитить или удалить.
- **K-06 [medium | conf high]** Удаление данных без защиты: `scripts/purge_hub_sqlite.py` (см. B-09), `scripts/_cleanup_hub_bench_tasks.py` (см. B-24), `scripts/recover_local_store_from_backup.py` (см. B-26).

### 5.3 deploy/, deploy_staging/, deploy_backups/

- **K-07 [medium | conf high]** `deploy/mailbox_quota_collector/collector.env:10` — ключ `MAIL_QUOTA_IMPORT_API_KEY` в открытом виде, файл на диске. Игнорируется (`.gitignore:27`), в истории нет (`git log --all` = 0 коммитов). Значение похоже на реальное, в отчёт не переносилось. Ротировать при утечке.
- **K-08 [medium | conf high]** `deploy_backups/env-before-calls-20261005-202229.bak` и `deploy_backups/env_before_jev_20261005-142904.bak` (по ~210 КБ) — полные копии `.env` с секретами. Игнорируются (`.gitignore:84`, `/deploy_backups/`). Удалить после ретенции.
- **K-09 [low | conf medium]** `deploy_backups/`: `corp_assistant_old.json`, `ai_bots_backup_20261005-132404.json`, `prompt_for_eval.txt`, `prompt_v2.txt`, `merge_ai_bots_apply.log` — вид данных: конфигурации ботов и промпты. Проверить на наличие токенов до хранения.
- **K-11 [low | conf high]** `scripts/livekit/livekit.yaml` содержит боевые ключ и секрет LiveKit (игнорируется). Файл есть только на хосте. Оставить, но проверить права.

### 5.4 Frontend (найдено по пути)

- **K-12 [low | conf high]** `WEB-itinvent/frontend/src/lib/platform.js:4` и ~40 упоминаний `IS_CAPACITOR_*` в 22 файлах (см. C-08). Мёртвая ветка кода.

### 5.5 Документы в корне и `docs/`

- **K-13 [low | conf high]** `docs/adr/` (8 ADR, tracked) — в порядке. Опорный каталог решений по AGENTS.md.

---

## 6. Таблица приложений PM2 (кросс-проверка имён)

Источники: `ecosystem.all.config.js` (единственный вход для автозапуска). Колонки — где имя встречается.

| Приложение | Экосистема (файл:строка) | start/restart/stop-all | health-check | boot expected / deferred | clear-orphans | watchdog |
|---|---|---|---|---|---|---|
| itinvent-backend | backend:11 | да | да | да / — | start_server.py | да |
| itinvent-chat (single) / -a / -b (dual) | backend:64; chat.scale:(buildChatNode) | через режим | да | да / — | start_chat_server.py | да |
| itinvent-preview-worker | backend:149; chat.scale:113 (дубль) | да | да | да / — | да | да |
| itinvent-mail-notification-worker | backend:188 | да | да | да / да | да | да |
| itinvent-chat-push-worker | backend:223; chat.scale:149 (дубль) | да | да | да / — | да | да |
| itinvent-ai-chat-worker | backend:259 | да | да | да / да | да | — |
| itinvent-my-files-worker | backend:289 | да | да | да / — | да | да |
| itinvent-hub-notifications-retention-worker | backend:310 | да | да | да / — | да | — |
| **itinvent-chat-push-outbox-retention-worker** | backend:334 | **нет** | **нет** | да / нет | **нет** | — |
| itinvent-inventory | inventory:9 | да | (InventoryUrl) | да / да | да | да (простой перезапуск) |
| itinvent-scan / -scan-worker | scan:32, :84 | да (restart-scan) | да | да / да | да | — |
| **itinvent-scan-system-metrics-retention-worker** | scan:123 | **нет** | **нет** | да / нет | **нет** | — |
| **itinvent-voice / -voice-worker / -voice-archiver** | voice:27, :45, :64 | **нет** | **нет** | да / **нет** | **нет** | да (только voice) |
| itinvent-livekit | livekit:20 (условно) | да | warn-only | да / — | (порт, не python) | — |
| itinvent-bot | bot:10 | да | — | да / да | да | — |
| **itinvent-ai-sandbox-control** | `scripts/ai-sandbox/ecosystem.control.config.js:7` (вне экосистемы) | только restart-ai-agents | да (критичный) | нет / нет | — | — |

Выводы: пять приложений (voice x3, два retention-воркера) не покрыты остановкой, health-check и orphan-очисткой (B-03, B-04, B-16). `itinvent-ai-sandbox-control` вне автозапуска (B-15).

---

## 7. Секреты и персональные данные (только вид и путь)

| Путь | Статус в git | Вид | Действие |
|---|---|---|---|
| `WEB-itinvent/backend/.env.legacy:124` | T, в истории | непустой ключ `SCAN_AGENT_API_KEY`, внутренние хосты, логины, SMTP | B-01: ротировать, удалить из индекса |
| `WEB-itinvent/_manual_env_tests/.env2:1` | T | `JWT_SECRET_KEY` (18 символов) | B-02: проверить, ротировать при реальном значении |
| `WEB-itinvent/_manual_env_tests/.env1` | T | `VITE_API_URL` | B-02: удалить из индекса |
| `deploy/mailbox_quota_collector/collector.env:10` | I, не в истории | ключ API в открытом виде | K-07 |
| `scripts/livekit/livekit.yaml` | I | ключ и секрет LiveKit | K-11 |
| `deploy_backups/*env*.bak` (2 файла) | I | копии `.env` | K-08 |
| `_recovery_probe/ec63.tar` | I | внутри `.env.legacy`, `_manual_env_tests/.env*` | удалить |
| `users_export_test.csv` | U | список пользователей (ПДн) | B-08 |
| `portal_upload_duplicates.tsv` | U | записи загрузок (8 колонок) | B-08 |
| `VEL/*.txt` (80 файлов) | U | учётные записи (ПДн), ISO-8859 | B-08 |
| `scripts/seed_hub_chat_loadtest_users.py:14` | T | жёсткий пароль тестовых учёток | B-22 |
| `scripts/pm2/_health_scheduled.log` | I | логи запросов (ПДн возможны) | O-01 |
| `bot.log*` (корень) | I | логи бота (ПДн возможны) | K-02 |

`.env.example` проверен по ключам с SECRET/TOKEN/KEY/PASSWORD: все значения пустые или заглушки, реальных значений нет.
Ключи в `ecosystem.*.js` не найдены: значения читаются из env или `.env`.

---

## 8. Requirements и зависимости (сводка)

| Файл | Pinning | Проблема |
|---|---|---|
| `requirements.txt` (корень) | `==` для `python-telegram-bot`, `>=` для остальных | `xlrd` без импортов (C-11) |
| `constraints.txt` (корень) | полные `==` | датирован 2026-05-02, не покрывает backend (C-10) |
| `WEB-itinvent/backend/requirements.txt` | большинство без версий | **нет `python-multipart`** (B-10) |
| `WEB-itinvent/backend/constraints.txt` | полные `==` (94 пина) | конфликты с scan_server по alembic/greenlet/markupsafe (C-09) |
| `scan_server/requirements.txt` + `constraints.txt` | полные | ок (содержит `python-multipart`) |
| `scan_agent/requirements.txt` | без версий, без constraints | — |
| `voice_video/requirements.txt` | без версий, без constraints | `jinja2`, `librosa`, `soundfile` без импортов (C-12) |
| `telegram_uia_probe/requirements.txt` | `>=` | — |

Общие пакеты корня и backend совпадают по версиям (openai 1.99.9, pillow 12.2.0, pydantic 2.12.5, httpx 0.28.1, lxml 6.1.0, pyodbc 5.1.0, python-docx 1.1.0 и др.). Конфликтов между корнем и backend нет.

`pytest.ini` корректен (testpaths=tests, asyncio_mode=auto). `pytest.bot.ini` см. C-13. Проверено, что оба тестовых файла из `pytest.bot.ini` существуют.

`setup.py` (корень) — шим в `agent/setup.py` (существует).

---

## 9. Документация (сводка дублей и устаревших)

| Документ | Проблема | Рекомендация |
|---|---|---|
| `documentation/technical/*.Id_*.md` (6), `documentation/README.Id_*.md` | порченые копии, UTF-16/бинарные | удалить (D-04) |
| `TECH_DEBT_AUDIT.md` | три аудита в одном файле, два дубля Executive Summary | разделить и архивировать (D-05) |
| `SCAN-RUNTIME-STABILIZATION.md` | инцидентный журнал 2026-08-04 с PID и именем хоста | перенести в `documentation/technical/incidents/` или архив |
| `TESTING_CHECKLIST.md` | команда полного прогона, противоречит AGENTS | обновить или архивировать (C-06) |
| `security_best_practices_report.md` (корень) | 2026-09-24, дублирует skill и отчёты | перенести в `documentation/technical/` (D-07) |
| `documentation/technical/TESTING.md` | не в git, ссылка из AGENTS | добавить в индекс (C-07) |
| `documentation/technical/CHAT_CALLS_LIVEKIT.md` | не в git, ссылки из runbook и health-check | добавить в индекс (C-07) |
| `documentation/technical/NETWORK_MONITORING*.md` (3) | пересекаются | объединить (D-07) |
| `documentation/technical/MOBILE_*` (32) | пересекаются | одна карта (D-06) |
| `scripts/pm2/README.md` | bare restart (C-01), нет voice и ai-sandbox (C-05), ссылка на backend.scale (C-04) | исправить |
| `documentation/technical/REPOSITORY_MAP.md:171` | «Capacitor флаги всегда false», а код есть (C-08) | уточнить |

---

## Что проверено и что нет

Проверено (статически): состав PM2-скриптов и экосистемы, сверка имён, мьютексы, регулярные выражения orphan-очистки, `.gitignore` против `git ls-files` и `git status`, секретные ключи по именам без значений, импорты зависимостей через grep, ссылки на корневые файлы и документы, журналы `_boot_resurrect.log` и `_watchdog.log`.

Не проверено: живое состояние PM2 и портов, содержимое prod-venv (наличие `python-multipart`), валидность найденного ключа (B-01), реальные размеры большинства каталогов (таймаут `du`), содержимое `VEL/`, `ОбработкаЗапросовXDTO*`, `_hub_*_list.txt` (только счётчики и признаки), запуск любых скриптов.

Удалить вручную: `/tmp_c_root.txt` (вне репозитория, создан моей командой, удаление заблокировано проверкой безопасности).
