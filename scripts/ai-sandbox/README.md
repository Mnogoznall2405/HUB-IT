# HUB OpenCode sandbox worker

OpenCode запускается только на отдельной Linux VM с rootless Podman. Worker не
работает на web/chat host, не монтирует репозиторий или каталоги HUB и не получает
RouterAI/provider key. Функция по умолчанию выключена через
`AI_SANDBOX_ENABLED=0`.

Этот каталог содержит runtime-контракт и сборочный контекст. Production,
миграции и процессы при подготовке этих файлов не менялись.

## Архитектура и сетевые границы

```text
public /chat
    -> PostgreSQL queue (Alembic 0099)
    -> itinvent-ai-sandbox-worker на отдельной VM
       -> HTTPS internal control/transfer ASGI
       -> rootless Podman container /workspace
          -> internal OpenCode API с Basic Auth
          -> hub-ai-internal (без default route)
             -> trusted HUB LLM gateway container
                -> отдельная gateway-egress network -> approved provider
```

Используются два отдельных, непубличных ASGI-приложения:

- `backend.ai_sandbox_internal_main:app` — manifest, one-time input/output
  transfer, permission/status/result control;
- `backend.ai_sandbox_gateway_main:app` — только
  `POST /v1/chat/completions` для LLM-запросов OpenCode.

У обоих приложений отключены OpenAPI, Swagger и Redoc. Они не подключены к
`main.py`, `chat_main.py` или публичному chat router и не должны публиковаться
через IIS. Между worker и control ASGI нужен внутренний HTTPS-канал с сетевым
ACL. LLM gateway — отдельный доверенный dual-homed контейнер: alias
`hub-ai-llm-gateway` находится в `hub-ai-internal`, а исходящие запросы к
PostgreSQL/LLM provider идут через отдельную `hub-ai-gateway-egress`. Контейнер
OpenCode подключается только к `hub-ai-internal` и egress network не видит.

## Зафиксированный runtime

- OpenCode `1.18.18`.
- Проверенный linux/amd64 base:
  `ghcr.io/anomalyco/opencode@sha256:d99f6cb95094eb9934ead4b600242e950ae6681d20c5a5f131a1c0a62208517f`.
- Собственный image после публикации задаётся только как
  `registry/name@sha256:<digest>`. Теги, включая `latest`, отклоняются.
- Минимально допустимая версия OpenCode — `1.0.216`; изменение baseline или
  digest требует повторного security review.

`Containerfile` проверяет OpenCode и Python 3.12, устанавливает зафиксированные
библиотеки из `requirements.lock`, затем удаляет не только команды pip, но и
runtime-модули `pip`, `setuptools`, `wheel` и `ensurepip`. Сборка завершается
ошибкой, если `find_spec()` находит эти модули или `python3 -m pip` остаётся
работоспособным.

## Подготовка отдельной VM

1. Создать одного выделенного непривилегированного service account
   `hub-ai-sandbox` и настроить rootless Podman. Worker unit, gateway unit и обе
   rootless networks обязаны работать с одинаковым `User=`: Podman networks
   принадлежат user namespace и не видны другому rootless account.
2. Создать сеть без внешнего маршрута:

   ```sh
   podman network create --internal hub-ai-internal
   podman info --format '{{.Host.Security.Rootless}} {{.Host.NetworkBackend}}'
   podman network inspect --format '{{.Internal}} {{.DNSEnabled}}' hub-ai-internal
   ```

   Проверки должны вернуть `true netavark` и `true true`: internal DNS alias
   требует Netavark/Aardvark.
   Отдельно создать сеть только для доверенного gateway и ограничить её
   firewall/ACL адресами PostgreSQL, DNS и утверждённого LLM provider:

   ```sh
   podman network create hub-ai-gateway-egress
   ```

   OpenCode-контейнеры никогда не подключаются к этой сети. Наличие двух сетей
   у gateway не превращает `hub-ai-internal` во внешнюю: маршрутизация/IP
   forwarding внутри gateway image запрещены, capabilities удалены.
3. Установить `seccomp-opencode.json` как
   `/etc/hub-ai-sandbox/seccomp-opencode.json` с read-only правами.
4. Создать `/var/lib/hub-ai-sandbox/workspaces` на отдельной XFS/ext4 файловой
   системе с project quota. Root-owned helper из `AI_SANDBOX_QUOTA_HELPER`
   обязан подтвердить уже установленную hard quota 1 GiB строкой
   `verified:<bytes>`; marker или проверка свободного места недостаточны.
5. Создать `/run/user/<uid>/hub-ai-sandbox` с mode `0700` для временных mode-0600
   env-файлов. Worker удаляет env-файл сразу после старта контейнера.
6. Собрать image, опубликовать в закрытом registry и зафиксировать его digest в
   `AI_SANDBOX_IMAGE`. Не включать feature flag до завершения preflight.

Trusted gateway image также собирается из текущего committed release, а не из
неопределённого внешнего artifact. `GatewayContainerfile` использует тот же
reviewed immutable linux/amd64 base, exact `gateway-requirements.lock` и
копирует только явно разрешённые Python-модули из временного tracked
`git archive` context. Полные каталоги `backend`/`shared`, `.env*`, uploads,
logs и DB-файлы в build context не попадают:

Gateway image не содержит Alembic/runtime migrations и не выполняет DDL. До
его запуска app-scope 0099 обязан быть применён штатным backend-контуром;
отсутствующая таблица приводит к отказу запроса, а не к auto-create.

```sh
: "${HUB_AI_GATEWAY_REPOSITORY:?set registry/repository without tag}"
release_ref="${HUB_RELEASE_REF:-HEAD}"
release_id="$(git rev-parse --verify "${release_ref}^{commit}")"
gateway_context="$(mktemp -d)"
trap 'rm -rf "$gateway_context"' EXIT
git archive "$release_id" \
  WEB-itinvent/backend/__init__.py \
  WEB-itinvent/backend/ai_sandbox_gateway_main.py \
  WEB-itinvent/backend/config.py \
  WEB-itinvent/backend/appdb/__init__.py \
  WEB-itinvent/backend/appdb/db.py \
  WEB-itinvent/backend/appdb/models.py \
  WEB-itinvent/backend/services/__init__.py \
  WEB-itinvent/backend/services/sql_observability.py \
  WEB-itinvent/backend/ai_sandbox/__init__.py \
  WEB-itinvent/backend/ai_sandbox/config.py \
  WEB-itinvent/backend/ai_sandbox/contracts.py \
  WEB-itinvent/backend/ai_sandbox/policy.py \
  WEB-itinvent/backend/ai_sandbox/models.py \
  WEB-itinvent/backend/ai_sandbox/gateway.py \
  shared/__init__.py \
  shared/llm/__init__.py \
  shared/llm/client.py \
  shared/llm/env.py \
  shared/llm/errors.py \
  shared/llm/models.py \
  shared/llm/openai_gateway.py \
  scripts/ai-sandbox/GatewayContainerfile \
  scripts/ai-sandbox/gateway-requirements.lock | tar -x -C "$gateway_context"
gateway_tag="${HUB_AI_GATEWAY_REPOSITORY}:${release_id}"
podman build --file "$gateway_context/scripts/ai-sandbox/GatewayContainerfile" \
  --tag "$gateway_tag" "$gateway_context"
digest_file="$gateway_context/pushed.digest"
podman push --digestfile "$digest_file" "$gateway_tag"
gateway_digest="$(cat "$digest_file")"
case "$gateway_digest" in sha256:????????????????????????????????????????????????????????????????) ;; *) exit 65 ;; esac
HUB_AI_GATEWAY_IMAGE="${HUB_AI_GATEWAY_REPOSITORY}@${gateway_digest}"
export HUB_AI_GATEWAY_IMAGE
```

Эта публикация выполняется только в отдельном разрешённом rollout. Значение с
tag не допускается в service unit: запуск использует полученный manifest digest.

Проверка RW workspace под теми же базовыми ограничениями выполняется на Linux VM
из-под непривилегированного worker-пользователя. Команда должна завершиться с
кодом 0; временный каталог создаётся только внутри выделенного workspace root:

```sh
: "${AI_SANDBOX_IMAGE:?set immutable sandbox image digest}"
sandbox_smoke_root="${AI_SANDBOX_WORKSPACE_ROOT:-/var/lib/hub-ai-sandbox/workspaces}"
sandbox_smoke_dir="$(mktemp -d "${sandbox_smoke_root%/}/smoke.XXXXXX")"
chmod 0700 "$sandbox_smoke_dir"
podman run --rm --read-only \
  --user "${AI_SANDBOX_UID:-10001}:${AI_SANDBOX_GID:-10001}" \
  --userns="keep-id:uid=${AI_SANDBOX_UID:-10001},gid=${AI_SANDBOX_GID:-10001}" \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --security-opt="seccomp=${AI_SANDBOX_SECCOMP_PROFILE:-/etc/hub-ai-sandbox/seccomp-opencode.json}" \
  --pids-limit=128 --cpus=2 --memory=2147483648 --memory-swap=2147483648 \
  --network=none --tmpfs=/tmp:rw,nosuid,nodev,noexec,size=268435456,mode=1777 \
  --volume="$sandbox_smoke_dir:/workspace:rw,nodev,nosuid,noexec" \
  --workdir=/workspace --entrypoint=/bin/sh "$AI_SANDBOX_IMAGE" \
  -ceu 'touch /workspace/.hub-write-smoke; test -f /workspace/.hub-write-smoke; rm /workspace/.hub-write-smoke'
rmdir "$sandbox_smoke_dir"
```

## Изоляция контейнера

Каждый запуск получает:

- read-only root filesystem;
- единственный RW bind конкретного диалога в `/workspace` с
  `nodev,nosuid,noexec`;
- отдельный tmpfs, UID/GID `10001`, drop-all capabilities,
  `no-new-privileges`, seccomp, private PID/IPC;
- максимум 2 CPU, 2 GiB RAM/swap, 128 PID, 1 GiB workspace;
- 120 секунд на команду, 15 минут на ответ, один active job на пользователя;
- internal-only network; OpenCode control port публикуется только на случайный
  `127.0.0.1` host-port для worker, без внешнего listener, CORS и mDNS.

Workspace проверяется до и после выполнения: запрещены symlink/hardlink,
специальные файлы, path traversal, подмена runtime config и превышение quota.
Входные и выходные файлы проходят ownership, hash/size и fail-closed antivirus
checks; ZIP/TAR дополнительно проверяются на traversal, links и archive bomb.
За один ответ принимается не более пяти результатов.

## Секреты и важное ограничение

В PostgreSQL сохраняются только SHA-256 hashes transfer/gateway tokens. В
контейнер передаются:

- уникальный Basic Auth password OpenCode server;
- короткоживущий gateway bearer, привязанный к `job/session/user`, deadline и
  request budget;
- непривилегированные scope IDs и URL внутреннего gateway.

Provider key и `AI_SANDBOX_TRANSFER_SERVICE_TOKEN` в контейнер не передаются.
Gateway принудительно заменяет указанную клиентом модель на
`AI_SANDBOX_LLM_MODEL`, ограничивает output budget и отзывает bearer после
завершения/abort. Content transfer использует отдельный service bearer на
worker-host и одноразовые токены для каждого файла.

Переменные окружения нельзя считать скрытыми от процесса в контейнере: после
разрешённого `bash` произвольный Python-код потенциально может прочитать
окружение своего процесса. Поэтому секреты должны быть только короткоживущими и
узко scoped; worker обязан остановить контейнер и выполнить revoke в `finally`.
В контейнер нельзя добавлять долговечные HUB/provider credentials.

## Политика OpenCode

- `read/glob/grep/list/lsp` разрешены только внутри `/workspace`;
- `edit` и `bash` требуют карточку подтверждения HUB;
- package install, web, external directory, внешние Git-операции, системные
  пути, env-команды и symlink запрещены;
- разрешение бывает `once` или до конца текущей HUB session, но не global;
- HUB отвечает OpenCode отдельным решением и не отправляет `remember=true`.

Permission request хранится и подтверждается атомарно вместе с существующей
`AiActionCard`. Повторные SSE events с тем же OpenCode permission ID
идемпотентны.

## Очередь, выполнение и recovery

`AiSandboxService.enqueue/get_status/cancel` подключён к `ai_chat_service` только
для OpenCode conversation. Очередь PostgreSQL не требует Redis:

- `PREPARING` резервирует один active job до копирования входов;
- worker видит только `QUEUED` и claim-ит через `FOR UPDATE SKIP LOCKED`;
- уникальность `(conversation_id, prompt_message_id, job_type)` делает reconnect
  и повторную доставку идемпотентными, включая terminal result;
- partial unique index допускает только один
  `preparing/queued/claimed/running/waiting_permission/finalizing/cleanup_pending`
  job пользователя;
- stale `claimed` можно вернуть в очередь в пределах attempt limit;
- stale `running`/`waiting_permission` никогда не replay-ится, потому что
  `edit/bash` уже могли иметь эффект; job переходит в `cleanup_pending`, а в
  terminal state — только после подтверждённого abort контейнера;
- успешное выполнение сначала сохраняет durable `finalizing` marker, result и
  assistant markdown. Recovery повторяет только детерминированный finalizer и
  не запускает OpenCode второй раз;
- общий shutdown event прерывает в том числе quiet SSE, после чего worker
  выполняет тот же retryable cleanup;
- после подтверждённого cleanup или успешной публикации session становится
  `stopped`.

Worker получает manifest и файлы только через authenticated internal control,
лениво поднимает контейнер, создаёт/продолжает OpenCode session, транслирует SSE
status/permission events, получает diff, регистрирует результаты в HUB и только
затем загружает их одноразовым output grant. Finalizer вызывается только после
успешной загрузки всех файлов; частичный upload не публикует success-сообщение.

## Retention

Workspace и OpenCode session удаляются через 30 дней после последней
активности. Sweep использует compare-and-set по `last_activity_at` и не очищает
session с active job. Перед медленным удалением fixed workspace атомарно
переименовывается в token-scoped tombstone. Ошибка оставляет session в
`purging`; следующий sweep повторяет только удаление того же tombstone и не
может открыть или удалить уже созданное новое поколение workspace. Сообщения,
уже отправленные в чат artifacts и файлы в `Мои файлы` не удаляются.

`AI_SANDBOX_ENABLED=0` запрещает новые execution, но не выключает retention,
retry `cleanup_pending` и idempotent recovery `finalizing` jobs. Для полного
отключения retention существует отдельный `AI_SANDBOX_RETENTION_ENABLED=0`, его
нельзя использовать как обычный rollback: он оставляет существующие workspace.

## Обязательная конфигурация

Полный список и безопасные placeholders находятся в `.env.example`. Для
включения необходимы как минимум:

- `AI_SANDBOX_IMAGE` с immutable digest;
- `AI_SANDBOX_CONTENT_TRANSFER_READY=1`;
- внутренний HTTPS `AI_SANDBOX_CONTENT_TRANSFER_URL` и точный allowed host;
- сильный `AI_SANDBOX_TRANSFER_SERVICE_TOKEN` только на HUB/worker hosts;
- `AI_SANDBOX_LLM_GATEWAY_URL=http://hub-ai-llm-gateway:8080/v1`;
- непустой `AI_SANDBOX_LLM_MODEL` на gateway host;
- существующий seccomp profile, internal network и проверенный quota helper.

Неверная или неполная конфигурация должна оставлять OpenCode bot выключенным и
не создавать рабочие session/job.

## Точные start-команды будущих сервисов

Control ASGI выполняется на chat/HUB host и слушает только выделенный private
interface с TLS. Gateway не запускается host-uvicorn: иначе DNS-имя
`hub-ai-llm-gateway` в rootless network не имело бы маршрутизируемого адреса.
Gateway запускается из отдельного, заранее собранного HUB runtime image с
immutable digest, без bind-mount исходного репозитория. Image содержит ровно
этот release backend/shared-llm и его locked dependencies.

Переменные `AI_SANDBOX_*_BIND_*`, `AI_SANDBOX_CONTROL_TLS_*`,
`HUB_AI_GATEWAY_IMAGE` и `HUB_AI_GATEWAY_ENV_FILE` принадлежат service unit и не
являются настройками приложения. `HUB_AI_GATEWAY_ENV_FILE` содержит gateway
DB/LLM credentials и forced model: root/systemd provisioning создаёт его для
того же выделенного `hub-ai-sandbox` account, который владеет rootless Podman
networks; mode файла — `0600`, родительского каталога — `0700`. Файл находится
вне workspace/runtime-secret mounts, поэтому OpenCode container его не видит и
он никогда не передаётся в OpenCode env.

```sh
cd /opt/hub/WEB-itinvent

python -m uvicorn backend.ai_sandbox_internal_main:app \
  --host "${AI_SANDBOX_CONTROL_BIND_HOST:?set internal-only bind IP}" \
  --port "${AI_SANDBOX_CONTROL_BIND_PORT:-8443}" \
  --ssl-certfile "${AI_SANDBOX_CONTROL_TLS_CERT:?set TLS certificate path}" \
  --ssl-keyfile "${AI_SANDBOX_CONTROL_TLS_KEY:?set TLS private-key path}" \
  --no-server-header

: "${HUB_AI_GATEWAY_IMAGE:?set pinned HUB gateway image@sha256 digest}"
: "${HUB_AI_GATEWAY_ENV_FILE:?set service-user-owned mode-0600 gateway env file}"
case "$HUB_AI_GATEWAY_IMAGE" in *@sha256:*) ;; *) exit 64 ;; esac
test "$(stat -c '%a' "$HUB_AI_GATEWAY_ENV_FILE")" = 600
test "$(stat -c '%u' "$HUB_AI_GATEWAY_ENV_FILE")" = "$(id -u)"
test "$(stat -c '%a' "$(dirname "$HUB_AI_GATEWAY_ENV_FILE")")" = 700
test "$(stat -c '%u' "$(dirname "$HUB_AI_GATEWAY_ENV_FILE")")" = "$(id -u)"
podman run --detach --replace \
  --name hub-ai-llm-gateway \
  --user 10001:10001 --userns=keep-id:uid=10001,gid=10001 \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit=128 --cpus=1 --memory=1073741824 --memory-swap=1073741824 \
  --tmpfs=/tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777 \
  --network=hub-ai-internal:alias=hub-ai-llm-gateway \
  --network=hub-ai-gateway-egress \
  --env-file "$HUB_AI_GATEWAY_ENV_FILE" \
  "$HUB_AI_GATEWAY_IMAGE"

python -m backend.ai_sandbox_worker_main \
  --worker-id "$(hostname -s)-sandbox-1" --poll-seconds 1
```

При rollback/maintenance новые execution отключаются, а durable finalization,
`cleanup_pending` и retention продолжают дренироваться отдельным режимом:

```sh
cd /opt/hub/WEB-itinvent
python -m backend.ai_sandbox_worker_main \
  --worker-id "$(hostname -s)-sandbox-cleanup" --cleanup-only --poll-seconds 1
```

Для одного диагностического прохода к cleanup-команде добавляется `--once`.
Эти команды являются шаблоном для будущих systemd units, а не указанием
запускать процессы вручную в production.

Gateway не публикует host-port. Проверка DNS/health выполняется из одноразового
контейнера только в `hub-ai-internal`; ответ должен быть
`{"status":"ok","service":"ai-sandbox-gateway"}`:

```sh
podman run --rm --network=hub-ai-internal --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges --entrypoint=python3 "$AI_SANDBOX_IMAGE" \
  -c 'import urllib.request; print(urllib.request.urlopen("http://hub-ai-llm-gateway:8080/health", timeout=5).read().decode())'
test -z "$(podman port hub-ai-llm-gateway)"
```

Перед пилотом на VM также проверяется, что OpenCode-контейнер не имеет маршрута
в `hub-ai-gateway-egress`, не достигает public Internet напрямую, а gateway
имеет доступ только к нужной БД/provider через инфраструктурный ACL.

## Проверка перед отдельным rollout

Из корня репозитория:

```powershell
pytest -q tests/test_ai_sandbox_migration.py tests/test_ai_sandbox_gateway.py tests/test_ai_sandbox_queue_repository.py tests/test_ai_sandbox_input_security.py tests/test_ai_sandbox_transfer.py
pytest -q tests/test_ai_sandbox_lifecycle.py tests/test_ai_sandbox_two_phase_output.py tests/test_ai_sandbox_paths.py tests/test_ai_sandbox_policy.py tests/test_ai_sandbox_runtime.py tests/test_ai_sandbox_service_worker.py tests/test_shared_llm_openai_gateway.py
```

Дополнительно на изолированной Linux VM нужны: build image, проверка digest,
rootless Podman/network/quota, попытки traversal/symlink/network/package install,
CPU/RAM/PID/time limits, cancel/reconnect и retention retry. Миграцию 0099 нужно
проверить upgrade/downgrade на отдельной PostgreSQL базе до production.

Порядок будущего rollout и rollback описан в `INTEGRATION_0099.md`. Этот документ
не является разрешением выполнять миграцию, публикацию или restart.
