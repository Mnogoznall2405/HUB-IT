# Интеграция Alembic 0099: OpenCode sandbox

Миграция `20260815_0099_ai_sandbox.py` имеет app scope и зависит от
`20260814_0098_ai_memory_and_bot_catalog.py`. В chat scope она ничего не меняет.
Runtime использует PostgreSQL-очередь без Redis и нового брокера.

Production, схема данных и процессы при подготовке этой интеграции не
изменялись.

## Таблицы 0099

### `ai_sandbox_sessions`

- одна session на HUB conversation, owner `user_id` и непрозрачный
  `workspace_key`, но не host path;
- `opencode_session_id`, lifecycle status, last activity и срок хранения;
- `credential_ref` не содержит Basic password, raw bearer или provider key.

### `ai_sandbox_jobs`

- связь с session/conversation/user и идемпотентный ключ
  `(conversation_id, prompt_message_id, job_type)`;
- типы `prompt`, `archive`, `attach_file`;
- lifecycle `preparing -> queued -> claimed -> running/waiting_permission ->`
  `finalizing -> succeeded` либо `cleanup_pending -> failed/cancelled`;
- claim/heartbeat/deadline/attempt и redacted `error_code`;
- partial unique index на один active job пользователя, включая `preparing`.

### `ai_sandbox_files`

- только normalized relative path, тип, MIME, size, SHA-256 и bounded diff;
- source/created chat attachment references;
- absolute host path и содержимое файла в таблице не сохраняются;
- unique `(job_id, relative_path)`; одинаковые имена входов получают разные
  непрозрачные каталоги.

### `ai_sandbox_permissions`

- уникальный OpenCode permission ID внутри session;
- redacted tool/operation/arguments preview, связанная `AiActionCard`;
- решения `approved/rejected/expired`, scope только `once/session`;
- нет global grant.

### `ai_sandbox_transfer_grants`

- одноразовый input-download или output-upload grant для конкретных job/file/user;
- хранится только token hash, status и короткий expiry;
- lifecycle `issued -> claimed -> consumed` либо `expired/revoked`;
- повторное использование или несоответствие direction/scope отклоняется.

### `ai_sandbox_gateway_grants`

- короткоживущий OpenAI-compatible bearer для конкретных job/session/user;
- raw token отсутствует в БД, сохраняется SHA-256 digest;
- request counter и hard `max_requests`, expiry и revoke timestamps;
- status `active/revoked/expired/exhausted`.

FK от jobs к sessions и от files/permissions/grants к их job/session используют
`ON DELETE CASCADE`. Downgrade удаляет таблицы в обратном порядке зависимостей.

## Runtime wiring

Публичный `/chat` подключает только
`backend.api.v1.chat.ai_sandbox.router`: panel, permission response,
archive/attach actions. Внутренние endpoints не входят в публичный router или
OpenAPI.

Отдельные entrypoints:

- `backend.ai_sandbox_internal_main:app` — worker control и content transfer;
- `backend.ai_sandbox_gateway_main:app` — LLM gateway для sandbox network.

Оба entrypoint должны быть доступны только во внутренних сетях. IIS и публичный
DNS не должны иметь маршрутов к ним. Control transfer требует service bearer;
файлы передаются через короткоживущие one-time grants. LLM gateway
проверяет bearer плюс `X-HUB-Sandbox-Job-ID`,
`X-HUB-Sandbox-Session-ID`, `X-HUB-Sandbox-User-ID`, active job, deadline и
request budget; модель выбирает сервер, а не контейнер.

`ai_chat_service` создаёт OpenCode job вместо обычного `AppAiBotRun`.
`SqlAlchemySandboxQueueRepository` выполняет reserve/claim/heartbeat/terminal
transitions. `AiSandboxWorker` запускает `ConcreteSandboxJobExecutor`, а тот
соединяет quota provisioner, rootless Podman, OpenCode control API, internal
transfer и gateway broker.

Control ASGI работает на выделенном private listener chat/HUB host. Gateway —
отдельный trusted container из pinned HUB runtime image без source bind mount:
он подключён к `hub-ai-internal` с alias `hub-ai-llm-gateway` и отдельно к
`hub-ai-gateway-egress`. Только gateway имеет egress к PostgreSQL/provider;
OpenCode подключён исключительно к internal network. Полная hardened команда,
health/DNS-проверка и Linux VM smoke находятся в `README.md`. Основные
entrypoint-команды будущих units:

Worker/gateway units и сети `hub-ai-internal`/`hub-ai-gateway-egress` принадлежат
одному выделенному rootless Podman account (`User=hub-ai-sandbox`): сети разных
rootless users не разделяются. `HUB_AI_GATEWAY_ENV_FILE` provision-ится
root/systemd для этого account и читается rootless Podman CLI: owner UID должен
совпадать с service UID, mode файла `0600`, parent directory `0700`. Файл лежит
вне любых OpenCode mounts и не передаётся в его environment.

```sh
python -m uvicorn backend.ai_sandbox_internal_main:app --host "$AI_SANDBOX_CONTROL_BIND_HOST" --port "${AI_SANDBOX_CONTROL_BIND_PORT:-8443}" --ssl-certfile "$AI_SANDBOX_CONTROL_TLS_CERT" --ssl-keyfile "$AI_SANDBOX_CONTROL_TLS_KEY" --no-server-header
podman run --detach --replace --name hub-ai-llm-gateway --user 10001:10001 --userns=keep-id:uid=10001,gid=10001 --read-only --cap-drop=ALL --security-opt=no-new-privileges --network=hub-ai-internal:alias=hub-ai-llm-gateway --network=hub-ai-gateway-egress --env-file "$HUB_AI_GATEWAY_ENV_FILE" "$HUB_AI_GATEWAY_IMAGE"
python -m backend.ai_sandbox_worker_main --worker-id "$(hostname -s)-sandbox-1" --poll-seconds 1
python -m backend.ai_sandbox_worker_main --worker-id "$(hostname -s)-sandbox-cleanup" --cleanup-only --poll-seconds 1
```

Control bind остаётся internal-only и использует TLS; gateway не публикует
host-port, а его внутренний DNS alias проверяется из `hub-ai-internal`.
Copy-paste Linux VM smoke с реальным
`touch /workspace` и полным набором mount/resource ограничений находится в
`README.md`. Там же приведён build/push из committed `git archive` через
`GatewayContainerfile` + exact `gateway-requirements.lock`. Архив и все `COPY`
используют явный файловый allowlist: полные каталоги backend/shared, `.env*`,
uploads, logs и DB-файлы не входят даже во временный build context. Unit запускает
результат только по registry manifest digest. Ни одна из этих команд в рамках
интеграции не запускалась.

Gateway image не включает Alembic и не выполняет schema initialization/DDL:
0099 применяется заранее штатным backend migration-контуром, а запрос при
неполной схеме завершается fail-closed.

## Инварианты очереди и восстановления

1. Сначала создаётся `PREPARING`; только после ownership/AV/archive validation и
   записи metadata job атомарно становится `QUEUED`.
2. Duplicate того же message/job type возвращает существующий job в queued или
   terminal state и не создаёт второй запуск.
3. Worker claim-ит только queued rows через `FOR UPDATE SKIP LOCKED`.
4. Stale `claimed` можно retry до attempt limit. Stale `running` и
   `waiting_permission` не replay-ятся: они переходят в `cleanup_pending`, а
   terminal state фиксируется только после успешного container abort/revoke.
   Имя контейнера включает job identity, поэтому поздний cleanup старого job
   физически не может остановить новый run той же session.
5. После execution worker атомарно записывает `finalizing` marker, result и
   assistant markdown. Stale `finalizing` повторяет только детерминированную
   публикацию результата, но никогда не запускает execute повторно.
6. Все output-файлы сначала регистрируются и загружаются; finalizer и assistant
   success выполняются только после успеха всей группы.
7. SIGTERM и штатный shutdown используют общий event с executor: quiet SSE
   прерывается, job проходит через retryable cleanup.
8. Terminal job переводит session в `stopped`; retention purge разрешён только
   без active jobs и с compare-and-set по last activity.
9. Retention присваивает generation token и атомарно отсоединяет fixed workspace
   в token-scoped tombstone. Неудача оставляет session в `purging`; stale retry
   удаляет только тот же tombstone, не переоткрывая fixed key по timeout.

## Проверки миграции и контрактов

Автоматические тесты:

- `tests/test_ai_sandbox_migration.py` — app/chat scope, все шесть таблиц,
  gateway/transfer indexes и полный downgrade;
- `tests/test_ai_sandbox_gateway.py` — hash-only registry, wrong scope, expiry,
  revoke, request budget/replay, forced model, headers и public OpenAPI isolation;
- `tests/test_ai_sandbox_queue_repository.py` — queued/completed/concurrent
  duplicate, один `PREPARING`, stale no-replay и purge retry;
- `tests/test_ai_sandbox_input_security.py` — fail-closed AV и вредоносный archive;
- `tests/test_ai_sandbox_transfer.py` — redaction, endpoint/path и hash checks;
- `tests/test_ai_sandbox_two_phase_output.py` — отсутствие premature finalize
  при partial upload и cumulative limit в пять результатов;
- `tests/test_ai_sandbox_lifecycle.py` — durable finalization/recovery,
  retryable cleanup и SIGTERM/quiet-SSE shutdown;
- существующие `test_ai_sandbox_paths/policy/runtime/service_worker.py` и
  `test_shared_llm_openai_gateway.py` — filesystem, container, policy и OpenAI
  normalization/SSE.

Локальный migration test использует SQLite compatibility path. До production
нужно отдельно прогнать upgrade/downgrade на изолированной PostgreSQL с той же
`schema_translate_map`/app scope конфигурацией, что и целевой runtime, и
проверить фактические schema, FK, partial index и locks.

## Порядок будущего rollout

1. Оставить `AI_SANDBOX_ENABLED=0` и развернуть 0098/основной AI UX.
2. На изолированной PostgreSQL проверить 0099 upgrade/downgrade, затем применить
   app-scope 0099 штатным Alembic-механизмом.
3. Подготовить отдельную Linux VM, rootless Podman, quota helper, internal
   network, seccomp и custom image с immutable digest.
4. Разместить internal control ASGI и dual-homed LLM gateway по topology выше,
   настроить TLS/ACL/service secret, server-forced model и запрет прямого
   egress для OpenCode network.
5. Выполнить sandbox security/integration tests на VM, включая cancel,
   reconnect, permissions, output upload и retention retry.
6. Включить `AI_SANDBOX_ENABLED` только для пилотной группы с
   `chat.ai.sandbox`, наблюдать queue age, failures, stale jobs, orphan
   containers, AV rejects и purge retries.
7. После пилота выдать RBAC разрешённым пользователям.

Перед каждым production шагом требуется отдельное разрешение пользователя и
read-only preflight фактической схемы, процессов, listeners и конфигурации.

## Rollback

- Сначала выключить `AI_SANDBOX_ENABLED`, остановить execution worker и оставить
  `--cleanup-only` unit для idempotent `finalizing`, retry cleanup и retention.
- После drain отозвать/истечь gateway и transfer grants, проверить отсутствие
  orphan containers. Cleanup-only unit продолжает retention, пока существуют
  sandbox sessions/workspaces.
- Обычные AI-диалоги и человеческие чаты продолжают работать.
- Downgrade 0099 выполнять только отдельным согласованным окном после проверки,
  что данные sandbox больше не нужны; выключение feature не требует немедленно
  удалять таблицы.

Этот файл описывает процедуру, но не выполняет migration, deployment, изменение
IIS/PM2/.env или restart.
