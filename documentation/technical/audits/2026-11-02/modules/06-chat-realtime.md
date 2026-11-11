# 06. Чат, WebSocket, вложения, realtime и push

Дата: 2026-11-02. Режим: диагностика без изменения исходников и production. Этот файл — дополнение к `TECH_DEBT_AUDIT_2026-11-02.md`.

Главный вывод: наиболее опасные новые окна находятся в отзыве доступа к уже открытым WebSocket, координации файловых upload sessions между процессами и очистке файлов после ошибки, возникшей уже после DB commit. Начальная атомарность message/outbox и ограниченные транспортные очереди не закрывают эти межслойные окна.

Проверка использует `websocket-realtime` skill: сначала существующий протокол, затем reconnect/order/duplicate/backpressure/auth. Новый транспорт или сервис не предлагается.

## 1. Границы и архитектура

Включены: обычный direct/group/notes/task chat, долговечные сообщения, WS-команды, room/inbox routing, PostgreSQL relay, resumable uploads, schedule-send и граница push/event outbox.
AI-исполнение, task canvas domain, LiveKit server, native FCM и полный frontend send controller имеют отдельные доменные границы; ниже проверены их точки подключения, но не весь внутренний runtime.
Runtime deployment и фактический активный транспорт не опрашивались. Двухпроцессный сценарий поддерживается кодом и runbook; его включение в production здесь не утверждается.

```text
ChatSocketBootstrap / Chat.jsx
  → lib/chatSocket.js (request_id, heartbeat, reconnect, subscriptions)
  → api/v1/chat/ws.py (handshake, rate limit, lease/watchdog)
  → chat/ws_commands.py (command routing)
  → api/v1/chat/_common.py (read/write executors)
  → ChatService facade
  → message_persistence / membership / read stores
  → chat PostgreSQL message, sequence, delivery state, outbox
  → realtime_side_effects / realtime_publisher
  → ChatRealtimeManager (local inbox/room fan-out)
  → PostgreSQL relay / optional Redis / local transport
  → per-socket bounded queue + sender task → client merge/hydration

HTTP uploads → ChatUploadOrchestrator
  → filesystem manifest + .part → materializer → attachment files
  → ChatFileMessagePersistence → ChatMessage/ChatMessageAttachment
  → manifest completed → postprocess → event/push dispatch

ScheduledMessageService → stable client_message_id → ChatService.send_message
  → same persistence, then scheduled status and side effects
```

Основные ссылки: `WEB-itinvent/backend/api/v1/chat/ws.py:170`, `WEB-itinvent/backend/chat/ws_commands.py:30`, `WEB-itinvent/backend/chat/message_persistence.py:626`, `WEB-itinvent/backend/chat/realtime.py:1573`, `WEB-itinvent/backend/chat/scheduled_messages.py:320`.
Контракт слоёв определён `docs/adr/0003-chat-backend-module-layout.md:16`; реализован через facade и специализированные store/orchestrator, однако shim `_api()` в `WEB-itinvent/backend/chat/ws_commands.py:14` продолжает связывать domain dispatch с API package.

## 2. Проверенные инварианты и сценарии

R = механизм воспроизведён изолированно; S = подтверждена цепочка кода; H = нужен дополнительный эксперимент. Ни R, ни S не означают production-приёмку.

| Сценарий | Наблюдение | Статус |
|---|---|---|
| Handshake без прав chat.read | Проверяется до connect | S, защита присутствует |
| Отзыв session у молчащего сокета | Watchdog закрывает 4401; ошибка validation store — 1011 | R: существующие focused tests |
| Снятие chat.write без logout | Текущий User остаётся объектом handshake | S, DCHAT-01 |
| subscribe одновременно с remove member | Проверка доступа и добавление room разделены await | S, DCHAT-02 |
| Отзыв room на другом узле при перегрузке relay | room_evict публикуется volatile | S, DCHAT-03 |
| Durable frame при полной outbound queue | Возвращает failure и disconnect; не тихий drop | S, защита присутствует |
| Slow socket send | wait_for ограничивает send, затем disconnect | S, защита присутствует |
| Повтор text send с одним client_message_id | Persistence имеет dedupe и unique-conflict recovery | S, защита присутствует |
| Повтор chunk в одном store | Pure plan распознаёт уже принятый chunk и проверяет offset | R: существующие tests |
| Один chunk одновременно в двух store | Оба успешны, bytes записаны дважды | R, DCHAT-04 |
| Ошибка serialization после commit file message | Общий exception handler удаляет staged/final bytes | S, DCHAT-05 |
| Завершённая upload session после TTL | Cleanup сохраняет каталог и lock | R, DCHAT-06 |
| Старый scheduled worker возвращает ошибку после успеха нового | sent превращается в scheduled/failed | R, DCHAT-07 |
| Crash scheduled worker выше лимита попыток | Recovery возвращает sending в scheduled без проверки бюджета | R, DCHAT-08 |
| Удаление участника пока file send ждёт conversation lock | Membership проверяется до lock и не перечитывается после | S, DCHAT-09 |
| Idle deadline при watchdog | Документация и тест helper обещают одно, реальный lease делает touch | S, DCHAT-10 |

## 3. Реестр новых находок

### DCHAT-01 — High / S: открытый WS продолжает использовать отозванные права

- Где: `WEB-itinvent/backend/api/v1/chat/ws.py:174`, `:353`, `:376`; `WEB-itinvent/backend/chat/ws_commands.py:96`; `WEB-itinvent/backend/chat/ws_auth.py:88`; `WEB-itinvent/backend/api/v1/auth.py:2233`.
- User читается при handshake. Каждая команда передаёт тот же `current_user`; ensure_user_permission проверяет его старый набор прав.
- Lease проверяет token/JTI/session, но не актуальные права пользователя. `chat.auth` меняет lease, а не объект User.
- PATCH custom_permissions/role не закрывает сессии; явное закрытие в route есть для is_active=False. Поэтому нельзя приравнивать downgrade к деактивации.
- Сценарий: A подключился с chat.write; администратор снял chat.write; HTTP-запрос после обновления identity cache уже запрещён, прежний WS продолжает проходить старую permission-проверку.
- Это отдельное окно сверх межпроцессного identity-cache TTL из auth-аудита: срок открытого socket может быть больше TTL.
- Минимальное исправление: обновлять public User/permission revision при периодической revalidation и перед write; не менять lifetime/refresh policy попутно.
- Приёмка: открыть настоящий TestClient WS, снять chat.write штатным API, подтвердить отказ последующего send и отсутствие INSERT; chat.read revoke прекращает получение событий.
- Не проверено: полный сценарий HTTP+WS с реальной identity cache и несколькими runtime.

### DCHAT-02 — High / S: subscribe может восстановить room уже исключённому участнику

- Где: `WEB-itinvent/backend/chat/ws_commands.py:56`, `:59`, `:64`; `WEB-itinvent/backend/chat/realtime.py:1136`, `:1154`, `:1600`; `WEB-itinvent/backend/chat/realtime_publisher.py:287`.
- Последовательность subscribe: await verify_conversation_access → синхронное добавление conversation_id в socket set.
- Между успешной DB-проверкой и добавлением администратор может исключить участника и завершить eviction; затем старый subscribe добавляет room обратно.
- Room broadcast выбирает соединения по set conversation_ids; повторного DB membership lookup на каждое событие нет.
- В fast-path message.created room payload содержит сообщение (`WEB-itinvent/backend/chat/realtime_side_effects.py:321`, `:363`), поэтому речь не только о presence.
- Исправление: fencing membership generation/eviction generation вокруг проверки и регистрации; при несовпадении отказ и повторная проверка. Одной проверки до await недостаточно.
- Приёмка: задержать возврат успешной access check, выполнить remove+evict, отпустить subscribe, отправить новое сообщение; исключённый socket не получает frame и не числится room subscriber.
- Не проверено: реальное конкурентное WS/HTTP воспроизведение; это статически доказуемый порядок событий, не подтверждённый production leak.

### DCHAT-03 — High / S: удаление доступа между узлами отправлено как допускающее потерю событие

- Где: `WEB-itinvent/backend/chat/realtime.py:1179`, `:1195`, `:1208`; `WEB-itinvent/backend/chat/postgres_realtime.py:486`; `WEB-itinvent/backend/chat/realtime.py:1744`.
- publish_conversation_eviction очищает local room и ставит transport publish с durable=False.
- PostgreSQL bus при заполнении volatile capacity увеличивает dropped и возвращает True, не ставя событие в очередь. Ошибка транспорта также имеет только одну volatile-попытку (`WEB-itinvent/backend/chat/realtime.py:1912`).
- Узел B может сохранить room пользователя, уже исключённого на узле A. Последующие conversation_room события не выполняют membership lookup.
- Durable inbox conversation.removed сам по себе не вызывает server-side evict в distributed handler; корректный frontend может отписаться, но серверная гарантия не должна зависеть от клиентского поведения.
- Исправление: durable revocation intent с повтором/repair, либо периодическая revalidation room memberships с bounded сроком; поведение должно быть fail-closed при неизвестном отзыве.
- Приёмка: два manager, насытить volatile reserve, удалить участника на A, затем отправить room event; B обязан перестать выдавать ему payload.
- Ограничение: реальный PostgreSQL/Redis, IIS farm и outage не запускались. Классификация High относится к возможному нарушению доступа при поддерживаемом split-режиме.

### DCHAT-04 — High / R: process-local upload lock допускает дублирование chunk

- Где: `WEB-itinvent/backend/chat/upload_sessions.py:70`, `:127`; `WEB-itinvent/backend/chat/chat_upload_orchestrator.py:181`, `:211`, `:219`; `scripts/pm2/README.md:164`.
- `_locks` — обычный dict RLock внутри экземпляра. При двух chat processes/store файловые manifest и .part общие, lock — нет.
- Каждый процесс может прочитать received_bytes=0 и принять chunk 0; оба открывают .part в append и сохраняют manifest received_bytes=4.
- Изолированно выполнены реальные upload_session_chunk и plan_upload_session_chunk с двумя настоящими store, одним temp root и barrier после чтения manifest.
- Результат: successes=2, part_bytes=8, manifest_bytes=4. Manifest writes в harness специально последовательно защищены, чтобы отдельно доказать append race, не случайную коллизию общего manifest.json.tmp.
- Дополнительный риск без этой защиты: два write_manifest используют один temp filename; replace может завершиться FileNotFoundError или публиковать чужой manifest.
- Complete также работает под этим process-local lock, а materializer перезаписывает общий final_path (`WEB-itinvent/backend/chat/upload_session_completion.py:129`); нужна общая координация всей сессии.
- Исправление: существующая DB/межпроцессный lock с ownership token, versioned manifest и offset-safe write. Sticky routing может снизить вероятность, но не заменяет целостность при retry/restart.
- Приёмка: два процесса одновременно повторяют chunk и complete; итоговый digest bytes равен исходнику, одна attachment ownership, оба ответа согласованы.

### DCHAT-05 — High / S: exception после commit приводит к удалению уже сохранённых вложений

- Где: `WEB-itinvent/backend/chat/message_persistence.py:643`, `:777`, `:780`, `:788`; `WEB-itinvent/backend/chat/db.py:452`; `WEB-itinvent/backend/chat/chat_upload_orchestrator.py:352`, `:363`; `WEB-itinvent/backend/chat/upload_session_completion.py:43`.
- persist_file_message выходит из write session, которая commits, и только потом открывает отдельную read session для сериализации payload.
- Failure второго checkout/SELECT/serialization пробрасывается наружу как исключение persist_file_message, хотя message+attachment rows уже committed.
- send_files catch считает весь persistence неуспешным и удаляет written_paths. Resumable complete находится внутри materialize, чей committed=False при исключении также удаляет final files.
- Итог: DB message существует, attachment ссылается на отсутствующий файл; клиент получает ошибку. Dedupe при повторе не восстанавливает удалённые bytes автоматически.
- Исправление: отделить durable persistence result от необязательной сериализации; исключение должно явно сообщать committed/ownership state. Cleanup допустим только для доказанно не принадлежащих committed message файлов.
- Приёмка: fault injection только на втором read-session после успешного INSERT/commit; обычная загрузка и resumable complete сохраняют bytes, повтор возвращает исходное message ID и рабочее скачивание.
- Уровень S: настоящий SQL fault injection здесь не запускался; цепочка commit → second read → общий cleanup прочитана целиком.

### DCHAT-06 — Medium / R: completed upload manifests и lock registry растут без ограничения

- Где: `WEB-itinvent/backend/chat/upload_sessions.py:70`, `:178`, `:200`, `:207`; `WEB-itinvent/backend/chat/service.py:769`; `tests/test_chat_upload_sessions_store.py:111`.
- Cleanup удаляет только pending с истёкшим expires_at. completed сохраняется независимо от возраста; ensure_active также обходит expiry для completed.
- Каждый scan каталога вызывает lock_for и сохраняет lock в `_locks`. У completed lock не освобождается, пока не удалён весь conversation/session другим путём.
- Repro: completed manifest с expiry 100 дней назад → cleanup deleted=0, каталог остался; локальный registry содержит его lock.
- Важная причина сохранения — retry-complete должен вернуть исходное сообщение. Поэтому просто удалять completed по прежнему TTL нельзя.
- Исправление: компактный долговечный completion ledger с оговорённым recovery сроком, bounded lock cache; удалять bulky filesystem metadata только после безопасного сохранения связи session→message.
- Приёмка: десятки тысяч completed sessions, cleanup имеет измеренный bounded cost/registry и старые подтверждённые retries ведут себя по согласованному контракту.
- Нагрузочные числа RSS/disk/p95 не измерены; доказан рост структуры, не OOM production.

### DCHAT-07 — Medium / R: старый scheduled worker переписывает успешный результат новой попытки

- Где: `WEB-itinvent/backend/chat/scheduled_messages.py:262`, `:294`, `:356`, `:369`, `:390`.
- Claim атомарен по status=scheduled, но subsequent mark_sent/mark_failed пишут только по ID; нет token/attempt guard.
- После lease recovery новый worker может отправить и отметить sent; старый worker позже сообщает transient error и возвращает ту же строку в scheduled.
- Repro реального `_mark_failed`, SQLAlchemy + SQLite memory: исходный status=sent, sent_message_id=committed-message → status=scheduled при сохранённом sent_message_id.
- Stable scheduled:<id> защищает от дублирования самого chat message; не защищает статус, повторный запуск side effects и изменение уже доставленного задания.
- Исправление: CAS по claim attempt/token во всех mark/recovery, ожидаемый status=sending; старые callbacks не имеют права менять чужую попытку.
- Приёмка: first attempt блокируется, второй после recovery завершается, old success и old error не меняют конечный sent и не создают вторичные side effects.

### DCHAT-08 — Medium / R: crash recovery scheduled messages обходит MAX_ATTEMPTS

- Где: `WEB-itinvent/backend/chat/scheduled_messages.py:76`, `:262`, `:298`, `:376`.
- Ограничение MAX_ATTEMPTS действует только в `_mark_failed`, а recovery любых старых sending возвращает scheduled; `_claim` не фильтрует attempt_count.
- Repro реального recover_stuck: sending с attempt_count=99 и старым updated_at успешно возвращён в scheduled, attempt_count=99.
- Цикл process crash после claim может повторяться без конечного статуса. Стабильный client_message_id ограничивает число сообщений, но не работу dispatcher/recovery и ложное состояние очереди.
- Исправление: recovery переводит исчерпанные попытки в явный failed/unknown; claim имеет attempt budget. Требуется различать неотправленную и уже committed операцию.
- Приёмка: многократный crash-reclaim завершается по бюджету; случай committed message перед crash восстанавливает sent без новой логической отправки.

### DCHAT-09 — High / S: file/poll send проверяет доступ до ожидания conversation write lock

- Где: `WEB-itinvent/backend/chat/message_persistence.py:645`, `:655`, `:1035`, `:1044`; `WEB-itinvent/backend/chat/chat_group_service.py:458`, `:490`; `WEB-itinvent/backend/chat/chat_membership.py:93`.
- File persistence выполняет membership/posting/files policy до lock; после ожидания lock лишь обновляет conversation и member list, но не membership отправителя и policy.
- Другой transaction может владеть lock, удалить отправителя или закрыть группу, commit; ожидавший file send продолжает INSERT после отзыва.
- Poll persistence использует такой же порядок. Forward path отдельно ставит lock до authoritative membership (`WEB-itinvent/backend/chat/message_persistence.py:849`) и служит существующим образцом.
- Исправление: дешёвая ранняя проверка допускается, но после lock обязательны актуальные membership и policy/restriction checks.
- Приёмка: задержать lock acquisition, удалить sender/закрыть group, затем отпустить; file/poll INSERT отсутствует и staged bytes безопасно убраны.
- PostgreSQL конкурентный тест не запускался. Existing test_message_write_rechecks_membership_after_lock проверяет edit/delete, не заменяет file/poll сценарий.

### DCHAT-10 — Low / S: описанная и тестируемая idle-семантика расходится с реальным lease

- Где: `documentation/technical/CHAT_BACKEND_ARCHITECTURE.md:56`; `WEB-itinvent/backend/chat/ws_auth.py:88`, `:109`; `tests/test_chat_ws_session_lifecycle.py:81`.
- Документация говорит: timer validation не продлевает idle deadline. Watchdog вызывает lease.revalidate, который после успешной assert(...touch_session=False) сам вызывает touch_session.
- Тест с названием periodic_validation_preserves_idle_deadline извлекает assert_access_token_still_valid, а не настоящий WsSessionLease.revalidate, поэтому не обнаруживает это расхождение.
- Нельзя автоматически менять поведение: код прямо сохраняет прежнюю семантику «активный socket держит session warm»; это требует решения по принятой auth policy.
- Исправление: установить действующий контракт владельцем auth, привести docs и regression к реальному watchdog→lease пути; не менять lifetime как побочный эффект аудита.

## 4. Ресурсные бюджеты и baseline для исправлений

| Ресурс | Что ограничено в коде | Что измерить до/после |
|---|---|---|
| Local socket queue | `_OUTBOUND_QUEUE_SIZE` по умолчанию 256, минимум 32 (`WEB-itinvent/backend/chat/realtime.py:43`) | qsize p95/p99, durable disconnects, payload bytes, RSS при медленных peer |
| Network send | send timeout по умолчанию 5 с (`WEB-itinvent/backend/chat/realtime.py:44`) | queue wait отдельно от socket send, ACK p95/p99 |
| Connections per user | default 4 (`WEB-itinvent/backend/chat/realtime.py:174`) | параллельный reconnect не превышает лимит; общее число пользователей — отдельная ёмкость |
| Presence watch | default 50 IDs (`WEB-itinvent/backend/chat/realtime.py:42`) | запросы presence и SQL/relay fan-out |
| PG publisher | bounded priority queue, reserves critical/durable (`WEB-itinvent/backend/chat/postgres_realtime.py:480`) | critical wait, dropped volatile, retries, publish RTT |
| Relay ID order | SHARE ROW EXCLUSIVE при allocation (`WEB-itinvent/backend/chat/postgres_realtime.py:689`) | commit p95/p99, throughput и lock wait двух узлов |
| DB pools | раздельные read/write caps, pool_timeout (`WEB-itinvent/backend/chat/db.py:192`, `:267`) | checkout wait, occupancy, DB time, transaction duration |
| Upload bytes | per-message file/total limits, streaming materialization | concurrent sessions × chunk size, disk space, hash integrity, lock wait |
| Completed sessions | явной общей границы нет | entries/locks, cleanup duration/RSS на 1k/10k/100k |
| Scheduled messages | 100 active/user, batch limits (`WEB-itinvent/backend/chat/scheduled_messages.py:75`) | admission race, failed/history rows, recovery work и dispatch lateness |

Это план безопасного isolated benchmark, не утверждение об измеренной текущей деградации. Production EXPLAIN/нагрузка не выполнялись.

## 5. Выполненные проверки и тестовые пробелы

- Выполнено: `python -m pytest -q tests/test_chat_upload_sessions_store.py tests/test_chat_upload_session_transfer.py tests/test_chat_upload_session_completion.py tests/test_chat_ws_session_lifecycle.py`.
- Результат: **22 passed, 2 warnings in 1.55s**, exit=0. Исследованы imports/fixtures: эти suites используют pure rules/temp filesystem/AST watchdog, не startup приложения или внешние сервисы.
- Перед запуском live opt-in выключен, APP_ENV=development, SCAN_DATABASE_URL пустой, realtime transport local; root conftest изолирует APP/CHAT в SQLite.
- Harness upload race/retention: exit=0; temporary directory удалён. Первая версия harness упала из-за отсутствующего timedelta в namespace; после исправления harness выполнен успешно, код приложения не менялся.
- Harness scheduled stale completion/recovery: реальные AST-методы, SQLAlchemy SQLite memory, exit=0; engine disposed.
- Прочитаны existing `test_chat_realtime_membership.py`, `test_chat_realtime_postgres.py`, `test_chat_scheduled_messages.py`, релевантные случаи `test_chat_files_and_notifications_service.py`.
- Их наличие не считается выполнением. Большие service/integration/PG suites и cross-node script не запускались.
- Не покрыто выполненными suites: permission downgrade открытого WS, subscribe/remove interleave, потеря distributed revoke, два процесса upload, failure второго read-session после commit.
- Положительные тесты sequential upload и обычного удаления room не исключают указанные гонки.

## 6. Отвергнутые подозрения и ограничения

- Initial PostgreSQL relay commit-order gap уже закрывается table lock; старую претензию о свободном allocation IDs нельзя повторять без иной цепочки publishers.
- Durable local queue не молча теряет message.created: overflow приводит к reconnectable disconnect, дальнейшая полнота зависит от клиентского resync.
- Client offline queue пропускает просроченные request_id (`chatSocket.js:1170`) и пишет warning при overflow (`:1111`); sendMessage/markRead требуют open. Сам shift не доказательство потери отправленного сообщения.
- Scheduled stable client_message_id исключает двойной INSERT сообщения при replay; DCHAT-07/08 относятся к ownership/status/recovery, не к гарантированному дублированию message rows.
- Resumable complete ищет message по attachment ID (`ChatService:1193`), поэтому crash после commit до manifest.completed не обязательно создаёт дубликат. DCHAT-05 — другой случай: удаление уже committed bytes при ошибке postcommit serialization.
- Completed sessions сохраняются намеренно для retry. Отмечен не сам факт retention, а отсутствие bounded lifecycle metadata/locks при бессрочном росте.
- Не проверены живой transport, IIS sticky-routing, схема chat/public, реальный pool размер, FCM/WebPush delivery, доступные диски и скачивание production attachments.
- Размер ChatService сам по себе не включён как новый баг: конкретные межслойные окна важнее числа строк.

## 7. Точный перечень просмотренных областей

- Полностью/по существенным ветвям: `chat/ws_auth.py`, `chat/ws_commands.py`, `api/v1/chat/ws.py`, `chat/upload_sessions.py`, `chat/upload_session_transfer.py`, `chat/upload_session_completion.py`, `chat/chat_upload_orchestrator.py`.
- Read/write paths и вызывающие участки: `chat/message_persistence.py`, `chat/chat_membership.py`, `chat/chat_group_service.py`, `chat/chat_group_admin.py`, `chat/chat_group_settings.py`, `chat/chat_thread_read_store.py`.
- Transport/side effects: `chat/realtime.py`, `chat/postgres_realtime.py`, `chat/realtime_publisher.py`, `chat/realtime_side_effects.py`, `chat/push_outbox_service.py`, `chat/scheduled_messages.py`.
- Facade/runtime/storage: `chat/service.py`, `chat/db.py`, `chat/models.py`, `api/v1/chat/_common.py`, `api/v1/chat/uploads.py`.
- Cross-auth callers: `api/deps.py`, `api/v1/auth.py`, `services/user_service.py`, `services/session_service.py`.
- Frontend: `lib/chatSocket.js`, `pages/chat/useChatSocketController.js`; остальные frontend message controllers не заявлены как полностью проверенные.
- Документы: `CHAT_BACKEND_ARCHITECTURE.md`, ADR-0003, relevant PM2 split-chat runbook, `TECH_DEBT_AUDIT_2026-11-02.md`, skill realtime validations.

## 8. Очерёдность работ в плане

1. DCHAT-01/02/03: восстановить серверную гарантию актуального доступа, отдельно проверить два узла и отсутствие зависимости от добровольной frontend unsubscribe.
2. DCHAT-04/05: общая ownership upload и cleanup только uncommitted файлов; acceptance обязательно проверяет реальные bytes/hash после fault injection.
3. DCHAT-09: authoritative checks после lock для file/poll, по уже существующему forward образцу.
4. DCHAT-07/08: claim fencing и terminal recovery budget для scheduled dispatcher.
5. DCHAT-06: согласовать bounded completion lifecycle без разрушения idempotent retry.
6. DCHAT-10: согласовать документацию/тест со штатной auth policy; не менять session lifetime без отдельного решения.

Исправления не применялись. Production operations, изменения схемы и публикация требуют отдельного согласованного шага.
