# OpenCode — состояние 2026-09-14

Production-настройка разрешена пользователем. OpenCode включён в каталоге HUB.
2026-09-14 опубликованы персональные права агентов и миграция `0117`:
[правила, резервные копии и живая проверка](../../documentation/technical/AI_AGENT_ACCESS.md).
Администраторы имеют доступ автоматически; активных персональных назначений
после диагностики нет. Старое право `chat.ai.sandbox` больше не открывает агента.
Linux gateway и worker работают; control доступен по HTTPS с проверкой CA.
Доступ PostgreSQL найден в существующем .codex_tmp/db06/remote.ps1 с сохранёнными
DPAPI credentials администратора. Прежний вывод об отсутствии доступа был ошибочным.

## Провайдер

- Подписка пользователя: **OpenCode Go**.
- API https://opencode.ai/zen/go/v1, модель deepseek-v4.1-flash.
- Контракт https://opencode.ai/docs/go/: собственный User-Agent шлюза и стабильный
  x-opencode-session из проверенного scope задания.
- Ключ в защищённых env. Sandbox получает только временный bearer шлюза.
  Глобальные ключ/модель остальных AI-сервисов HUB не менялись.
- Реальный запрос через shared/llm/ успешен: 55 потоковых chunks.
  Предыдущий 401 относился к отправке ключа Go на неправильный адрес RouterAI.

## Сервер и данные

- AI 10.103.0.11: 2 CPU, 3915 MiB RAM. Один worker; задание до 2 CPU/2 GiB,
  gateway до 1 GiB, остаток ОС. Workspace LV 20 GiB, 4 GiB резерв VG.
- ext4 prjquota/nodev/nosuid/noexec, kernel quota 1 GiB на workspace.
  Root LV не менялся. EDQUOT, запрет снятия quota и прямого Internet проверены.
- Постоянные файлы: \\10.103.0.229\hubit\users через «Мои файлы» HUB.
  Linux получает выбранные копии через одноразовые HTTPS grants без SMB credentials.
- PostgreSQL 10.103.0.10: точное hostssl/SCRAM правило для 10.103.0.11/32,
  hubit_chat/hubit_chat_app. Reload без рестарта, SELECT 1 с TLS успешен.
- После backup применена миграция 20260914_0116: отсутствовавшие finalization/
  delivery поля, constraints и индексы. Фактическая схема и revision проверены.
- Control 10.103.0.217:8443, TLS/IP ACL; worker URL:
  https://hub-ai-control:8443/api/v1/chat/internal/ai/sandbox.
- Rootless Podman, UID/GID 10001, делегированный cgroupfs через CONTAINERS_CONF.

## Проверки

- Входное вложение 41 байт: manifest 200, transfer 200, доставлено на Linux.
- Сохранение входного файла в «Мои файлы» и обратное скачивание через grant:
  STORAGE_ROUNDTRIP_VERIFIED 41, содержимое совпало.
- 16 runtime/executor/migration; 7 gateway; 9 SSE/schema; 24 shared client/Go:
  прошли. Иногда pytest после успешного завершения сообщает об отказе очистки
  старого Windows Temp pytest-current; это не падение тестов.
- Исправлены libffi/psycopg в image, SDK Chat Completions вместо Responses,
  msg_ identifier, startup retry, stream_options, reasoning_content,
  Go URL/session header и upstream error до отправки SSE 200.
- Ранее прошли 14 frontend-тестов и проверка IIS hash текущего dist.
- Итоговый job 7a282ec2-22c6-4f54-be20-c0dcab29926c: succeeded/published.
  DeepSeek прочитал вложение и создал result.txt после permission allow/once.
  Текст OPENCODE_FILE_OK 42 найден в опубликованном сообщении. Результат 19 байт
  получен из чата, сохранён в «Мои файлы» и скачан обратно с совпадением байтов.
- Исправлены преобразование /workspace/ в относительные пути для policy,
  сборка message.part.delta и ожидание готовности сохранённой сессии.
  Дополнительно прошли 7 executor, 3 executor-control и 2 lifecycle теста.
- State: artifacts/ai-sandbox/smoke-20260914.json. Пользователь 1900000914 неактивен,
  без интерактивного входа; диагностический диалог не содержит других людей.
- Итоговый post-check: Linux gateway/worker active+enabled, orphan sandbox нет,
  manifest hashes совпали. PM2 chat, AI worker, control и My Files worker online.

## Release и rollback

- Current: /opt/hub-ai/releases/2d91ca86de1ac088d284.
- Previous: /opt/hub-ai/releases/b3962611c0fef7714aed.
- Sandbox digest: ff86cdf0cc0483eacf6cf77a9519654421652aa621edcfdd36d6704b65e98ce8.
- Gateway digest: 725ead3bf0eff35fefcfb03a5237177a78674e8c7e48c24d3bed77dafeba9cb8.
- HBA backup: /etc/postgresql/16/main/pg_hba.conf.hub-ai-20260914T042044Z.bak.
- DB backup: /var/backups/hubit-opencode-20260914/sandbox-before-0116.dump,
  SHA256 fde9aba7ba19d58734365adde371e47d6cdb481a506de13dc8f66828c7899698.
- Config backups: backups/opencode-20260913 (HUB), /root/hub-ai-backup-20260913 (AI).
- Откат после прекращения новых заданий и drain finalization/cleanup: восстановить
  согласованные release/image/config. Не удалять LV, файлы и историю. Дамп до
  миграции не содержит новых записей; не восстанавливать вслепую.
- Холодный образ прогревать в том же keep-id namespace перед заданиями:
  подготовка Podman layers может превысить runtime timeout. Active не заменяет health.

## Не подтверждено

Ручная приёмка в браузере/Desktop/Android, восстановление после полной
перезагрузки VM и многопользовательская нагрузка не проверялись.

## 2026-09-21 — восстановление и два минимальных релиза

Диагностика показала: private control ASGI на HUB (10.103.0.217:8443) не был
запущен (PM2-процесс отсутствовал с 14.09); gateway crash-loop (NRestarts>101000
из-за зависшего `Created`-контейнера без `--replace`); провайдер отвечал 400 на
пустой `tool_calls: []` от OpenCode. Control перезапущен штатным
`restart-ai-agents.ps1` (скрипт падает на `stop` отсутствующего процесса —
требуется правка). HUB-логирование sandbox добавлено: `ai_sandbox/app_service.py`
(decorator + lifecycle), `api/v1/chat/ai_sandbox.py`, `ai_chat/service.py`.

- Релиз `5968768af01ab72f92b6` (та же процедура, что build_release.py; дельта
  против production 2 файла: `run_gateway.py` + `--replace`,
  `shared/llm/openai_gateway.py` — strip пустых `tool_calls`). Предыдущий
  `/opt/hub-ai/releases/2d91ca86de1ac088d284` сохранён, откат записан в
  `/root/hub-ai-backup-20260913/previous-runtime-20260921-opencode-fix`.
- Gateway image пересобран из релиза и запинен:
  `localhost/hub/ai-llm-gateway@sha256:005e61cff19f4764b65a6bea5d0ed32967f987b2ebab734083cc08ab6b12fc51`;
  env backup `/root/hub-ai-backup-20260913/gateway-runtime-before-20260921-opencode-fix.env`.
  E2E-тест (диалог 11f9afe9, job 90f73359): succeeded за ~40 сек, ответ
  опубликован, но с утечкой reasoning в текст.
- Релиз `92591cea9e1880681e8d` (дельта — только `ai_sandbox/executor.py` из HEAD:
  публикация лишь подтверждённого текста ассистента). Откат записан в
  `/root/hub-ai-backup-20260913/previous-runtime-20260921-execfilter`.
  E2E-тест (job 4363486b): succeeded, ответ — одно чистое предложение
  «Связь подтверждена, всё работает.», без reasoning.

Грязное дерево сознательно не паковалось: в allowlist попадали чужие
незакоммиченные `config.py`, `authorization_service.py`, `shared/llm/__init__.py`
(последний сломал бы релиз — импорт отсутствующего `jev_client.py`).
Дрейф HEAD против production вне двух фиксов (`executor.py` SSE-фильтр теперь
вкатан; `config.py` MyFiles-тюнинг — нет) — кандидаты на следующий релиз.
Рестарт `itinvent-chat` для активации новых HUB-логов панели не выполнялся.

## 2026-09-21 — фикс ложного таймаута команды после approval

Тест с approval через generic confirm-endpoint выявил: часы команды
взводились по первому `tool running` и тикали всё время ожидания карточки —
одобрение спустя ~2.5 мин убивалось `SandboxExecutorError@_raise_if_tool_timed_out`
(та же сигнатура у падения от 14.09). Исправление в `executor.py`:
сброс `active_tools` после подтверждённого `answer_permission`
(бюджет считается только после фактического запуска). Тест
`test_approved_permission_restarts_stale_tool_clock`, executor-набор — 15 passed.
- Релиз `63a4642f429f2bd687fd` (дельта — только `executor.py`). Откат записан в
  `/root/hub-ai-backup-20260913/previous-runtime-20260921-clockfix`.
- Доказательство в production: ожидание 200 сек перед approve (job 88b4e078) —
  succeeded, тогда как раньше это был гарантированный false timeout.

## 2026-09-22 — авто-разрешение Python и рестарт control

По просьбе пользователя bash с голым интерпретатором больше не спрашивает:
`policy.py:is_python_execution` (python/python3/python3.12/py) возвращает ALLOW
только после всех deny-проверок — pip, env, symlink, traversal, shell-операторы
по-прежнему DENY/ASK. Важно: решение принимает HUB-control на Windows, а не
Linux-worker, поэтому после заливки релиза потребовался рестарт
`itinvent-ai-sandbox-control` (новый pid, 8443 слушается).
- Релиз `f38c5b87752c8561e0d6` (дельта — только `policy.py`). Откат записан в
  `/root/hub-ai-backup-20260913/previous-runtime-20260921-pythonpolicy`.
  Тесты `test_ai_sandbox_policy.py` — 25 passed.
- Доказательство: `python3 -c "print(sum(...))"` и `7*8` — карточек нет,
  ответы корректны (`56`), `waiting_permission` не возникало.
- Замечено (не чинилось): истёкшая карточка остаётся `pending` в таблице
  разрешений и видна в панели; подтверждение возвращает `expired`.
- `edit` по-прежнему спрашивает (осознанно): announce при следующем запросе.

## 2026-09-22 — фикс off-by-one в redact_text (500 на heredoc)

Ручной тест с heredoc `python3 <<'PY'` уронил создание permission: 500 от control,
`SandboxTransferError`, job failed. Причина: `redact_text(..., max_length=128)`
возвращал до 129 символов (`text[:128] + "…"`), колонка `operation` — VARCHAR(128).
Теперь резерв под многоточие (`text[:max_length-1] + "…"`), длина ≤ max_length.
Тест `test_redact_text_never_exceeds_max_length_for_varchar_columns`;
`test_ai_sandbox_input_security.py` — 5 passed. Фикс HUB-side (redaction.py нет
в Linux-релизе) — активирован рестартом control, без релиза.

## 2026-09-22 — кавычко-чувствительный разбор shell-операторов + эксель

Ручной запрос «эксель с таблицей умножения» падал дважды: сначала heredoc —
500 redact-баг, затем heredoc — авто-DENY по `\n`, агент сдавался пустым.
Следом выяснилось: `python3 -c "a;b"` отклонялся грубым regex (`;` внутри
кавычек считался композицией). Заменён на `_has_unquoted_shell_operator`
(трекинг кавычек; вне кавычек — те же запреты). Тесты политики — 44 passed.
Фикс HUB-side, активирован рестартом control.
Доказательство в чистом диалоге (job f095fd74): проверка версии openpyxl и
создание книги — оба auto-approved без карточек; `umnozhenie.xlsx` (5375 байт,
валидный ZIP, 11 строк, J10) доставлен, sha256 совпал, приаттачен к чату.
Старый диалог засорён историей отказов — для важных задач начинать новый.


## 2026-09-22 — широкая политика: edit + безопасный bash, DOCX-тест

По просьбе пользователя: edit — ALLOW (path-гарды сохранены; python и так
позволял те же записи, попутный контроль остался на доставке результатов).
Bash: ALLOW для python*, heredoc и безопасного coreutils-набора
(ls/cat/head/tail/wc/pwd/mkdir/touch/cp/mv/echo/printf/sort/uniq/diff/file/
stat/du/df/uname/whoami/date/grep) после всех deny-проверок. rm/chmod/sed/awk,
pip, сеть, композиция — ASK/DENY как раньше. Тесты политики — 56 passed.
Активация рестартом control (оценка политики — HUB-side).
Доказательство DOCX->XLSX (job d0d4c85f): загрузка DOCX (1048 байт, таблицы),
3 bash auto-approved (inspect/parse/s openpyxl), equipment-summary.xlsx
(4974 байта: inv_no/model/room/status=ok, 3 строки) доставлен, sha256 сошёлся,
приаттачен к чату. Ноль карточек.


## 2026-09-22 — мониторинг sandbox-контура

Причина недельного простоя control и 101k рестартов gateway: их никто не
наблюдал. Добавлено (код, без включения расписаний):
- scripts/pm2/health-check.ps1: процесс itinvent-ai-sandbox-control в
  Critical PM2 + новая секция sandbox-control (online + слушатель 8443,
  шторм рестартов). Проверено прогоном: ok.
- scripts/pm2/restart-ai-agents.ps1: stop отсутствующего процесса больше не
  роняет скрипт после остановки ai-worker.
- Linux: scripts/ai-sandbox/monitor-sandbox.sh (read-only: units, контейнер
  Up, podman, TCP control) + systemd/hub-ai-monitor.{service,timer}
  (каждые 5 мин, статус в /run/hub-ai-sandbox/monitor.status).
  Установка на ВМ и включение таймера — отдельным разрешением.
Замечено попутно (не трогалось): порт 8001 занят orphan-PID, PM2 backend
перезапускается кем-то каждые минуты — нужен отдельный разбор.


## 2026-09-22 — мониторинг включён

- HUB health-check.ps1: секция sandbox-control (процесс + 8443) + exit 1 при
  fail-строках для планировщика; починен stop-баг 
estart-ai-agents.ps1.
- Windows-задача HUBit PM2 Health Check (Interactive, каждые 15 мин, лог
  scripts/pm2/_health_scheduled.log). SYSTEM не подошёл: PM2-снапшот
  недоступен из другой учётки (ложный fail) — добавлен warn при недоступности
  снапшота. Сейчас задача красная по-настоящему: orphan backend на 8001.
- Linux hub-ai-monitor.{service,timer} установлены и включены (каждые 5 мин,
  статус /run/hub-ai-sandbox/monitor.status = ok). По пути выяснено:
  podman info висит под systemd-юнитом (из SSH работает) — в мониторе
  оставлен best-effort warn; жёсткие сигналы: units, контейнер Up, TCP control.
- Retention в порядке: sweep каждые 60 сек делает сам worker
  (purge_expired_once); hub-ai-cleanup — только drain-режим (by design).
  Диск workspace 1%.
- Открыто: orphan start_server.py (ex-PM2, держит 8001, PM2-backend в
  crash-loop 47+ рестартов) — требуется kill с просадкой API; параллельно
  кто-то рестартует backend и gateway/worker на ВМ (06:20 UTC) — координация.


## 2026-09-22 — UX-пакет: протухшие карточки, пустой ответ, дубль аттача

- Snapshot сам гасит мёртвые permission-строки (job terminal / action
  expired-потерян -> rejected): панель больше не показывает невечные карточки,
  воркер не висит до дедлайна. Тест 	est_ai_sandbox_snapshot_expiry.py — 2 passed.
  Заодно подтверждено: старый диалог 11f9afe9 удалён (маппинг отсутствует).
- Пустой результат: executor пишет причину (...без результата: уточните
  запрос..., если файлов нет) + info-лог sandbox empty result.
  Релиз 03fcd1d380b7a47e901 (дельта — 1 файл executor.py), worker
  перезапущен, откат записан.
- Панель: прикреплённый файл показывает чип «Прикреплено» вместо повторной
  кнопки (дубли 09:41/09:43 были: авто-доставка финализатора + ручной attach
  из проверки). Тесты OpenCodeConversationContext — 5 passed.
- Опубликовано в IIS (сборка грязным деревом по решению), chat перезапущен.
  Регресс: простое задание — succeeded.
