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
