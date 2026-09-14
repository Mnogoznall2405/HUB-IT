# Rollout OpenCode

Rollout разрешён пользователем и продолжен 2026-09-14. Доступ PostgreSQL
настроен, миграция 0116 применена; gateway, worker и TLS control запущены.
Текущие результаты живой приёмки: [LIVE_STATUS.md](LIVE_STATUS.md).

## Зафиксированные цели

- Linux: TMN-SRV-AI-01, 10.103.0.11, пользователь hub-ai-sandbox (UID/GID 10001).
- Создан LV `/dev/ubuntu-vg/hub_ai_workspace`, размер 20 ГБ из свободных 24 ГБ.
  В VG оставлен резерв 4 ГБ. Существующий root LV не менялся.
- Mount: `/var/lib/hub-ai-sandbox/workspaces`, ext4, prjquota,nodev,nosuid,noexec.
- Runtime: `/opt/hub-ai/releases/<release-id>`, symlink `/opt/hub-ai/current`.
- Control на проверенном private интерфейсе HUB 10.103.0.217:8443, только Linux VM в firewall ACL;
  TLS SAN `hub-ai-control`, доверенный CA на worker. Публичный IIS не менять.
- Хранилище пользователей остаётся `\\10.103.0.229\hubit\users` на HUB.

## Подготовка и резервная копия

Перед изменениями сохранить root .env HUB с ограниченным ACL, вывод PM2 только
с именами/статусами процессов (без env), текущие image pins, seccomp/quota helper,
unit files и mount configuration. Зафиксировать текущие release/hash frontend
по штатному IIS publish workflow. Секреты не помещать в обычный release archive.

Локальный пакет создаётся `python scripts/ai-sandbox/build_release.py
--output-dir artifacts/ai-sandbox/<unique-directory>`. Проверить SHA-256 при
передаче. Перед распаковкой проверить имена членов tar: только относительные
обычные файлы, без ссылок. Разместить под root-owned `/opt/hub-ai/releases/<id>`;
проверить каждый файл по `release-manifest.json` и запретить запись service user.

## Linux

1. После отдельного согласования дисковой операции выполнить
   `bash prepare-workspace-volume.sh`. Скрипт создаёт только новый LV и отдельный
   mount unit; отказывает при существующем LV, mount или непустом каталоге.
   Если он прервался, сначала проверить созданный LV/mount — не удалять их и
   не повторять форматирование вслепую.
2. Установить quota_root.py как `/usr/local/libexec/hub-ai-sandbox-quota-root`
   (root:root 0755), quota-wrapper.sh как `/usr/local/libexec/hub-ai-sandbox-quota`
   (root:root 0755). Проверить `visudo -cf hub-ai-sandbox.sudoers`, затем установить
   в `/etc/sudoers.d/hub-ai-sandbox` (0440). Родитель libexec root-owned и не writable
   для service user. Удаление старого helper не требуется: сохранить его backup
   и заменить конкретный файл.
3. Установить обновлённый seccomp профиль (root:root 0444). Он блокирует смену
   project flags через legacy ioctl и оба quotactl syscall. Helper вызывается
   worker на host, а не из контейнера. Kernel ioctl constants сверены с
   [Linux UAPI fs.h](https://github.com/torvalds/linux/blob/master/include/uapi/linux/fs.h)
   и [quota.h](https://github.com/torvalds/linux/blob/master/include/uapi/linux/quota.h).
   Реальный тест запрета снятия project inheritance обязателен на целевом kernel.
4. Создать `/opt/hub-ai/venv` через `python3 -m venv`; установить
   `scripts/ai-sandbox/gateway-requirements.lock`. Это также зависимости worker;
   проверить импорты обоих entrypoint под service account с APP_ENV=production.
5. Из проверенного release собрать оба образа под hub-ai-sandbox:

   ```sh
   podman build -f scripts/ai-sandbox/Containerfile -t localhost/hub/opencode-sandbox:reviewed scripts/ai-sandbox
   podman build -f scripts/ai-sandbox/GatewayContainerfile -t localhost/hub/ai-llm-gateway:reviewed .
   ```

   Получить manifest Digest через image inspect и проверить, что запуск по
   `repository@sha256:digest` разрешается. Image ID вместо manifest Digest не
   использовать. В production env записать только проверенные immutable references.
6. Подготовить worker.env и gateway-runtime.env в `/etc/hub-ai-sandbox`;
   gateway.env в `/home/hub-ai-sandbox/gateway` (directory 0700/file 0600,
   владелец hub-ai-sandbox). Использовать соответствующие .example.
   Не помещать provider key/SMB credentials в worker env. Worker/Gateway DB roles
   должны иметь необходимые DML права на sandbox tables и не иметь DDL прав.
7. Установить три unit-файла из systemd/, выполнить `systemd-analyze verify`,
   `systemctl daemon-reload`, обеспечить linger hub-ai-sandbox. Запускать
   `hub-ai-gateway` первым. Worker включать только после control/TLS/quota checks.
   Cleanup unit автоматически не включать одновременно с execution worker.

## HUB control и включение пилота

1. В защищённом `.env` задать сильный AI_SANDBOX_TRANSFER_SERVICE_TOKEN (тот же
   на worker), CONTROL_BIND_HOST, CONTROL_BIND_PORT=8443, TLS_CERT и TLS_KEY.
   Worker должен разрешать `hub-ai-control` в private IP HUB и доверять CA;
   `SSL_CERT_FILE` должен содержать подходящий trust bundle. Не использовать verify=False.
2. Проверить firewall: 8443 доступен только с 10.103.0.11; широкий существующий
   allow-rule не должен обходить ACL. Не публиковать control через IIS.
3. Первый запуск: `pm2 start scripts/ai-sandbox/ecosystem.control.config.js`.
   Не добавлено в ecosystem.all автоматически. Проверить TLS `/health` с Linux.
4. Выполнить offline preflight для трёх service env, реальный тест quota и сети,
   затем AI_SANDBOX_CONTENT_TRANSFER_READY=1 и AI_SANDBOX_ENABLED=1 на HUB/worker.
   В gateway собственный ENABLED=1 обязателен уже при проверке LLM.
5. Перезапустить только согласованный chat-контур штатным
   `scripts/pm2/restart-chat.ps1`, опубликовать frontend штатным IIS workflow.
   Отдельно проверить, какой runtime читает bot catalog в текущей topology;
   не перезапускать API/Scan автоматически ради обновления env.

## Приёмка

Через HUB-пользователя с sandbox permission: выбрать файл в Моих файлах,
отправить с заданием, разрешить once/edit/bash, получить результат, сохранить
результат обратно, скачать и сравнить содержимое. Проверить отказ чужому file ID,
ошибку AV, отмену загрузки/смену аккаунта/диалога и восстановление worker.

Файловая квота: на новом тестовом ws проверить назначенный project и hard quota,
написать больше 1 ГБ из sandbox и получить EDQUOT; убедиться, что соседний workspace
имеет другой project, и ioctl снятия наследования отклоняется. Тесты с реальными
записями и cleanup — только внутри согласованного тестового workspace.

Gateway health недостаточен: проверить реальный job-scoped LLM запрос, отказ
без bearer и после revoke. Проверить отсутствие публичного порта gateway,
прямого Internet/SMB/DB egress у OpenCode и startup после перезагрузки VM.

## Откат

Отключить новые execution, перезапустить chat только штатным согласованным
скриптом; остановить hub-ai-worker и запустить hub-ai-cleanup. Дождаться drain
finalizing/cleanup_pending и отсутствия sandbox containers. Сохранить gateway
до завершения drain. Вернуть прошлые env/release/image pins и frontend backup.
Сохранить workspace LV, результаты на SMB и таблицы БД. После drain том можно
отмонтировать, но удаление LV/форматирование не входит в rollback приложения.
