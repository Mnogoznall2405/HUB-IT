# Интеграция с 1С Документооборот через DMService

## Назначение

Раздел `/docflow` показывает персональные задания пользователя из 1С:Документооборот КОРП. Задания не копируются в `hub_tasks`: состояние, маршруты, права и авторство решения остаются в 1С. HUB-IT хранит только зашифрованное персональное подключение, аудит и журнал идемпотентных команд.

Поддержанная редакция для операций записи — `2.1.37.5.CORP`. При другой версии чтение остаётся доступным, а действия и создание процессов блокируются до проверки allowlist.

## Транспорт и границы доверия

Backend использует штатный web-сервис `DMService` и единственную SOAP-операцию `execute`. HTTP-клиент не принимает имя SOAP/XDTO-метода от браузера. Серверные сериализаторы разрешают только:

- `DMGetVersionRequest`, `DMGetCurrentUserRequest`, `DMGetSettingsRequest`;
- `DMGetObjectListRequest`, `DMRetrieveRequest`;
- `DMAcceptTasksRequest`, `DMUpdateRequest`, `DMLaunchBusinessProcessRequest`.

Basic Auth передаётся персонально в каждый запрос из зашифрованного профиля `app.docflow_credentials`. Логин, пароль, Authorization и XML запроса не журналируются. XML разбирается без DTD, внешних сущностей и сетевых ссылок; размер ответа и файла ограничен.

Production должен использовать HTTPS с FQDN, совпадающим с сертификатом, и доступной цепочкой отзыва. Временный HTTP допускается только явным `DOCFLOW_DM_ALLOW_INSECURE_HTTP=1`. По умолчанию операции записи через HTTP отдельно блокируются; автоматического fallback на COM нет.

## Чтение заданий

`GET /tasks` формирует `DMGetObjectListRequest` типа `DMBusinessProcessTask`. Во всех scope обязательно передаются `byUser=true` и `typed=true`:

| Scope | DMService | Фильтрация HUB-IT |
|---|---|---|
| `inbox` | `withExecuted=false` | только `executed=false` |
| `completed` | `withExecuted=true` | только `executed=true` |
| `all` | `withExecuted=true` | без фильтра по `executed` |

Поиск добавляет стандартное условие `name LIKE`. Публичный `limit` применяется после ответа, потому что эта редакция 1С игнорирует лимит списка задач. При превышении возвращается `truncated=true`, а не ложной пустой список.

Перед карточкой, файлом и действием backend снова получает персональный список с `byUser=true` и проверяет наличие ссылки. Карточка читается `DMRetrieveRequest` с фактическим XDTO-типом задачи. Из неё возвращаются процесс, этап, сроки, автор, результат, предметы и связанные документы.

## Файлы

Файлы обнаруживаются только внутри задачи и её связанных предметов. Перед скачиванием связь проверяется заново. Метаданные и `binaryData` читаются через `DMRetrieveRequest` для `DMFile`/`DMFileVersion`; COM и UNC fallback в активном контуре отсутствуют.

Размер проверяется до декодирования и во время потоковой base64-записи во временный файл. Файл удаляется после ответа. Общий предпросмотр HUB-IT для PDF и Office остаётся без изменения. Если DMService не может прочитать файловый том, возвращается `DOCFLOW_FILE_STORAGE_UNAVAILABLE`; обход сервисной или AD-учёткой не выполняется.

## Действия

`POST /tasks/{task_ref}/actions` требует `docflow.act`, `Idempotency-Key` и подписанный `state_token`. Перед записью повторно проверяются пользователь, активность, состояние, версия DMService и точный XDTO-тип.

Для `2.1.37.5.CORP` разрешены:

| Код | XDTO-поле | ObjectID | Комментарий |
|---|---|---|---|
| `acknowledge` | завершение задания | — | необязателен |
| `approve` | `approvalResult` | `Согласовано` | необязателен |
| `approve_with_comments` | `approvalResult` | `СогласованоСЗамечаниями` | обязателен |
| `reject` согласования | `approvalResult` | `НеСогласовано` | обязателен |
| `approve` утверждения | `confirmationResult` | `Утверждено` | необязателен |
| `reject` утверждения | `confirmationResult` | `НеУтверждено` | обязателен |
| `complete` | `executionComment` | — | обязателен |

Непринятое задание сначала передаётся в `DMAcceptTasksRequest`, перечитывается и только затем обновляется типизированным `DMUpdateRequest` с `executed=true`. После записи задание перечитывается; успех подтверждается только по `executed`, дате и точному результату.

Команда заранее фиксируется в `app.docflow_commands`. Запись не повторяется автоматически. Тайм-аут после отправки даёт `202 state_unknown`; `/commands/{id}` выполняет только чтение состояния. Комментарий в локальный аудит не сохраняется.

Если 1С требует электронную подпись, backend возвращает `DOCFLOW_DIGITAL_SIGNATURE_REQUIRED`. Локальные кнопки скрываются, а пользователь получает «Выполнить в 1С» по `DOCFLOW_WEB_URL`.

## Создание поручения

Поиск документов выполняется для фиксированных XDTO-типов `DMInternalDocument`, `DMIncomingDocument`, `DMOutgoingDocument`, поиск исполнителя — для `DMUser`. `POST /assignments` требует `docflow.create` и идемпотентный ключ.

### Поиск документов и исполнителей

- Для `GET /assignments/documents` нужен запрос `q` не короче **3 символов**. Пустой или короткий `q` не вызывает `DMGetObjectList`: иначе три полных списка типов документов упираются в read timeout (~25 с) и API отдаёт **503**.
- Условие `name` уходит как `comparisonOperator=LIKE` со значением `%query%`. В ДО 2.1 `%…%` автоматически добавляется только если оператор сравнения **не** передан; при явном `LIKE` без `%` получается почти exact match.
- Типы документов запрашиваются **параллельно** (`asyncio.gather`); падение одного типа не обнуляет остальные. При `tooManyObjects` или обрезке по `limit` ответ содержит `truncated: true` и `reason` («уточните поиск»).
- Prefetch на открытии диалога: исполнители с пустым `q` допустимы (~2 с); документы — нет.
- UI: кнопка «Найти» для документов disabled при `q < 3`; при 503/504 — «1С не успела ответить — уточните название или номер».

Backend заранее выделяет UUID, записывает типизированный `DMBusinessProcessOrder` через `DMUpdateRequest`, запускает его `DMLaunchBusinessProcessRequest` и перечитывает процесс. Поддерживаются существующий документ, один исполнитель, необязательный контролёр, срок, важность, название и описание. Новые документы, загрузка файлов и произвольные маршруты не создаются.

### Операционный unlock записи (create)

Без этого `POST /assignments` в проде останется выключенным:

1. `DOCFLOW_DM_SERVICE_URL` = **HTTPS** FQDN, `DOCFLOW_DM_SERVICE_TLS_VERIFY=1`
2. `DOCFLOW_WRITE_ENABLED=1`, `DOCFLOW_CREATE_ENABLED=1`
3. Pilot: `DOCFLOW_CREATE_PILOT_USER_IDS` или `DOCFLOW_CREATE_ALL_USERS=1`
4. Версия 1С = `2.1.37.5.CORP` (pin в клиенте)
5. RBAC `docflow.create`
6. Restart: `scripts/pm2/restart-backend.ps1` + `health-check.ps1`
7. Smoke: `python scripts/docflow_dmservice_smoke.py` (read); затем ручной create с префиксом `HUB-IT TEST`

## API

Все маршруты имеют префикс `/api/v1/docflow`, требуют HUB-сессию и возвращают `Cache-Control: no-store`.

| Метод | Маршрут | Право |
|---|---|---|
| `GET/PUT/DELETE` | `/profile*` | `docflow.read` |
| `GET` | `/tasks`, `/tasks/{ref}`, `/inbox-summary` | `docflow.read` |
| `GET` | `/tasks/{ref}/files/{file_ref}/content` и `/preview/pdf` | `docflow.read` |
| `POST` | `/tasks/{ref}/actions` | `docflow.act` |
| `GET` | `/commands/{id}` | `docflow.act` |
| `GET/POST` | `/assignments*` | `docflow.create` |
| `GET` | `/metadata` | `docflow.admin` |

## Основная конфигурация

| Переменная | Назначение |
|---|---|
| `DOCFLOW_TRANSPORT=dmservice` | Активный транспорт; `com` — только ручной временный rollback |
| `DOCFLOW_DM_SERVICE_URL` | URL без `?wsdl`, в production только HTTPS/FQDN |
| `DOCFLOW_DM_SERVICE_TLS_VERIFY=1` | Обязательная проверка TLS |
| `DOCFLOW_DM_SERVICE_CA_BUNDLE` | Необязательный PEM bundle корпоративного УЦ |
| `DOCFLOW_DM_*_TIMEOUT_SECONDS` | Раздельные connect/read/write/file/queue timeout |
| `DOCFLOW_DM_MAX_CONCURRENCY=16` | Общий предел одновременных SOAP-вызовов процесса |
| `DOCFLOW_DM_QUEUE_LIMIT` | Верхняя граница ожидающих вызовов |
| `DOCFLOW_DM_MAX_RESPONSE_BYTES` | Максимальный SOAP-ответ |
| `DOCFLOW_MAX_FILE_BYTES` | Максимальный оригинал файла |
| `DOCFLOW_WEB_URL` | Штатный web-клиент для заданий с ЭП |
| `DOCFLOW_WRITE_ENABLED` / `DOCFLOW_CREATE_ENABLED` | Глобальные серверные флаги |
| `DOCFLOW_WRITE_ALL_USERS` / `DOCFLOW_CREATE_ALL_USERS` | Доступ всем пользователям с соответствующим RBAC-правом |
| `DOCFLOW_ACTION_STATE_KEY` | HMAC-ключ `state_token`; fallback выводится из ключа профилей |

## Выпуск и rollback

1. Запустить backend unit-тесты, frontend suite и production build.
2. Выполнить `python scripts/docflow_dmservice_smoke.py`: это только версия, текущий пользователь, настройки, входящие и карточка без записи.
3. Проверить HTTPS, файл и тестовые задания `HUB-IT TEST` для каждого действия.
4. Только после HTTPS включать действия и создание всем обладателям `docflow.act/create`.
5. Перезапустить штатным `scripts/pm2/restart-backend.ps1`, затем выполнить `health-check.ps1`.

`itinvent-docflow-gateway` удалён из PM2, restart и health-check. На одну контрольную неделю код COM остаётся только как ручной rollback `DOCFLOW_TRANSPORT=com`; он никогда не выбирается автоматически. После стабильного периода rollback-код удаляется отдельным изменением.

Read-only smoke 30.07.2026 подтвердил `2.1.37.5.CORP`, персональный список, карточку, связанный объект и метаданные файлов. Текущая HTTP-публикация функциональна, но запись заблокирована до HTTPS.
