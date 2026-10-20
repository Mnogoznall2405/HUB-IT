# Аудит backend/chat, realtime, api/v1/chat (read-only)

Область: `WEB-itinvent/backend/chat/` (все файлы), `chat_main.py`, `realtime/hub.py`, `api/v1/chat/`.
Файлы репозитория не менялись; сервисы, БД, pm2 и сборка не запускались. Все пункты проверены чтением кода; номера строк относятся к текущему рабочему дереву. Крупные файлы (`chat/service.py`, `chat/chat_group_service.py`, `chat/telegram_sticker_service.py`, `chat/push_service.py`, `api/v1/chat/conversations.py`, `api/v1/chat/messages.py`, `api/v1/chat/ai.py`, `chat/calls.py`) просмотрены точечно через поиск, не построчно.

Легенда: severity = critical/high/medium/low; confidence = high/medium/low.

## Bugs

**B1. Delivery-state outbox записывается после ACK, а reconciliation покрывает только 50 последних сообщений за 300 с.**
- `chat/message_persistence.py:586-598`: текстовый путь создаёт `_deferred_delivery_outbox` после commit, вне транзакции. `api/v1/chat/_common.py:710-725` (`_enqueue_deferred_delivery_outbox`) молча возвращает False при любой ошибке.
- `chat/event_outbox_service.py:338-342`: `repair_missing_delivery_state_outbox(lookback_sec=300, limit=50)`, вызывается из `poll_once` (около строки 649) с дефолтами.
- Сценарий: сообщение закоммичено, enqueue упал (таймаут aux-слота 5 с или ошибка БД). Repair находит такие сообщения только среди 50 самых новых за последние 300 с. Если за окно пришло больше 50 сообщений или сбой длился дольше 300 с, сообщение больше не переобрабатывается, и unread/sender-seen для него остаются неверными.
- Severity: medium. Confidence: high (код), medium (частота сбоя).

**B2. Джобы event outbox висят в статусе `processing` дольше таймаута, пока ждут семафора, и повторно уходят в очередь.**
- `chat/event_outbox_service.py:432-455` (`claim_jobs` переводит до `batch_size`=100 строк в `processing`), `:663-666` (gather с семафором `max_concurrency`=4), `:649` (`recover_stale_jobs` каждые `maintenance_interval_sec`=5 с, порог `processing_timeout_sec`=120 с, `:411-431`).
- Сценарий: при медленной публикации (около 5 с на джоб) хвост из ~100 джобов ждёт больше 120 с. `recover_stale_jobs` возвращает их в `queued`, следующий `claim_jobs` берёт их повторно, и одно событие публикуется дважды, пока первая копия ещё обрабатывается.
- Severity: medium. Confidence: medium (нужна медленная публикация).

**B3. Нет предела попыток при восстановлении зависших джобов (poison/crash loop).**
- `chat/event_outbox_service.py:411-431`: `recover_stale_jobs` ставит `queued` без проверки `attempt_count`. `:432-455`: `claim_jobs` увеличивает `attempt_count`. Проверка `attempt_count >= max_attempts` есть только в `process_job` при исключении (`:591`).
- Аналогично: `chat/push_outbox_service.py:184-203`.
- Сценарий: джоб, который убивает процесс (OOM, зависание в `publish_event_job`), никогда не доходит до `mark_failed`. Он будет бесконечно восстанавливаться и захватываться заново.
- Severity: medium. Confidence: medium.

**B4. `_update_job` и `mark_retry` перезаписывают статус по id без проверки текущего состояния.**
- `chat/event_outbox_service.py:457-480` (`_update_job`), `:482-490` (`mark_retry`).
- Сценарий: воркер A завис, джоб восстановлен и захвачен воркером B. Когда A завершится и вызовет `mark_failed` или `mark_retry`, он перезапишет состояние, которым владеет B, и джоб может быть поставлен в очередь повторно.
- Severity: low. Confidence: medium.

**B5. Repair выполняет вложенные соединения и N+1 внутри записывающей транзакции aux-слота.**
- `chat/event_outbox_service.py:351` (открыт `_aux_write_session()`), `:376-386` (отдельный SELECT участников на каждое сообщение, до 200 запросов), `:394` (`resolve_mentioned_member_user_ids`).
- Дальше: `chat/chat_mentions.py:21-47` (`sender_may_mention_all` открывает вторую `chat_session`) и `:60-97` (`user_service.get_users_map_by_ids` ходит в другой DB-сеанс).
- Сценарий: при насыщенном пуле каждый repair-поток держит aux-слот и ждёт второе соединение. Риск взаимной блокировки или таймаутов слота. Нарушает правило «нет сетевых и тяжёлых операций внутри транзакции».
- Severity: medium. Confidence: medium-high.

**B6. Снимок, отправляемый при подключении, может затереть более новые сообщения (гонка снимка и live-событий).**
- `api/v1/chat/ws.py:89-112` (`_ws_post_connect_bootstrap`): `get_realtime_snapshot` вызывается в момент T0 (строка 99), а `chat.snapshot` ставится в ту же очередь, что и live `chat.message.created`, в момент T1 (строка 107).
- Сценарий: сообщение зафиксировано и поставлено в очередь между T0 и T1. Клиент получает его, затем получает снимок T0, который его не содержит. Если клиент заменяет состояние целиком, сообщение пропадает до перезагрузки.
- Severity: medium. Confidence: medium (зависит от того, как фронтенд объединяет snapshot).

**B7. Пользователь с двумя соединениями (одно в комнате беседы, второе только в inbox) не получает `chat.message.created` на второе соединение.**
- `chat/realtime_side_effects.py:355-372` (`publish_message_created_fast_after_send`): `room_subscriber_ids` строится по пользователю (`chat/realtime.py:1230-1240` возвращает user_id любого соединения, подписанного на беседу). Такие пользователи исключаются из `inbox_targets`.
- Комнатная рассылка (`distribute=False`) уходит только на соединения, подписанные на беседу. Второе соединение того же пользователя (inbox-only, например второй таб или Desktop-оболочка) не получает событие ни одним путём.
- Сценарий: два клиента одного пользователя, один с открытой беседой, второй с сайдбаром. Во втором сообщение появится только после перезагрузки.
- Severity: medium. Confidence: medium-high.

**B8. Один сбойный relay-row блокирует realtime всего узла (head-of-line blocking), вместо пропуска.**
- `chat/postgres_realtime.py:974-1033` (`_deliver_rows`): при исключении обработчика курсор останавливается на предыдущей строке (`:1024-1031`) и исключение пробрасывается.
- `:846-875` (`_run_listener`) трактует это как обрыв соединения, переподключается и снова читает ту же строку (`_drain_relay`, `:939-962`).
- Сценарий: детерминированное исключение в `handle_distributed_event` для одного payload. Узел бесконечно переподключается с backoff, и все последующие события этого узла не доставляются. Redis-слушатель в той же ситуации логирует и продолжает (`chat/realtime.py:408-452`).
- Severity: medium. Confidence: medium (нужно детерминированное исключение обработчика).

**B9. Ограничение числа подключений на пользователя не атомарно.**
- `chat/realtime.py:754-803` (`connect`): проверка лимита и выбор вытесняемых соединений выполняются под lock (`:766-777`). Затем `await` на eviction (`:781`) и только после этого вставка (`:793-803`).
- Сценарий: параллельные подключения одного пользователя одновременно проходят проверку, и число соединений превышает `_CHAT_WS_MAX_CONNECTIONS_PER_USER`.
- Severity: low. Confidence: medium.

**B10. Входящие данные читаются целиком до проверки размера.**
- `api/v1/chat/uploads.py:49` (`payload: bytes = Body(...)`): тело чанка буферизуется полностью до `plan_upload_session_chunk` (`chat/upload_session_transfer.py:31-80`), который проверяет размер.
- `api/v1/chat/ws.py:229` (`receive_text`): проверки размера кадра нет вообще. `api/v1/chat/hub_realtime_ws.py:168-183`: кадр читается полностью, и только потом проверяется `_MAX_PAYLOAD_BYTES` (с повторным кодированием в utf-8).
- Сценарий: клиент шлёт очень большие кадры или тела, память процесса растёт до лимита сервера. Явного лимита в коде чат-WS и upload-роута нет.
- Severity: medium. Confidence: medium (зависит от лимитов сервера).

**B11. Дозапись чанка после сбоя ломает upload-сессию без возможности восстановления.**
- `chat/chat_upload_orchestrator.py:212-221`: `.part` открывается в режиме `ab` и пишется до обновления манифеста.
- Сценарий: процесс падает или `write_manifest` падает после записи. Повтор того же offset проходит `plan_upload_session_chunk` (offset совпадает с манифестом) и дописывает данные повторно. Размер `.part` становится больше ожидаемого, и `chat/upload_session_completion.py:106` всегда отклоняет завершение. Сессия не восстанавливается.
- Severity: medium. Confidence: high (код), low (частота сбоя).

**B12. `release_lock` удаляет живой RLock, и параллельные потоки получают разные блокировки на одну сессию.**
- `chat/upload_sessions.py:70-79` (`lock_for`), `:81-86` (`release_lock` удаляет запись из реестра), `:141-144` (`delete_session_dir` вызывает `release_lock`).
- Сценарий: поток загрузки ждёт старый lock, cleanup удаляет его из реестра, следующий `lock_for` создаёт новый RLock. Два потока одновременно меняют один манифест и `.part`.
- Severity: low. Confidence: medium.

**B13. Пустой список user_id в `_get_presence_map` загружает все сессии системы.**
- `chat/chat_presence_service.py:127-137`: при пустом `normalized_user_ids` вызывается `session_service.list_sessions(active_only=False)` (строка 136). Он читает все строки `AppSessionRecord`, запускает `_run_maintenance` и нормализацию каждой строки (`services/session_service.py:1307-1325`). Результат кэшируется под ключом `__all__`.
- Вызовы с потенциально пустым списком: `chat/service.py:1226-1230` (поиск пользователей, 0 совпадений), `chat/chat_serialization.py:723` (`source_sender_ids` пуст), а также `chat/chat_serialization.py:92`, `:157`, `:784`, `chat/chat_thread_read_store.py:84`, `:162`, `:767`, `:1001`, `:1189`.
- Сценарий: пустой результат поиска по пользователям или список без отправителей запускает полное чтение таблицы сессий на горячем пути.
- Severity: high. Confidence: high (код), medium (частота на проде).

**B14. Ошибка построения message.created для отложенного сообщения теряет realtime-рассылку.**
- `chat/scheduled_messages.py:394-435` (`_enqueue_side_effects`): `asyncio.run(build_message_created_event_jobs(...))` (строка 419) выполняется в worker-потоке. Исключение пробрасывается в `_dispatch_one` (`:346-352`), который только логирует.
- Сообщение уже отправлено, но получатели не получат `chat.message.created`. Repair (B1) переотправляет только delivery_state, а не message.created.
- Severity: medium. Confidence: medium.

**B15. Сбой публикации message.created для карточек действий AI проглатывается молча.**
- `ai_chat/action_cards.py:1624-1641` (`_publish_chat_message_created`): `asyncio.run(...)` внутри `try/except Exception: pass`. Если функция вызвана в потоке с запущенным event loop, `RuntimeError` молча теряется.
- `ai_chat/service.py:7098` (`_enqueue_message_side_effects_after_send`): `asyncio.run` без try в этой ветке, исключение пойдёт наверх.
- Severity: low. Confidence: medium (контекст вызова проверен частично: `_process_single_run` синхронный, вероятно, работает в потоке).

**B16. Fire-and-forget задачи без сохранённой ссылки (риск сборки мусора и потери задач).**
- `api/v1/chat/_common.py:678-683` (`_schedule_chat_background_task` возвращает Task), все вызовы его отбрасывают: `:844`, `:974`, `:979`, `:993`, `:1008`, `:1052`, `:1065`, `:1088`.
- `api/v1/chat/ws.py:201-206` (`create_task(_ws_post_connect_bootstrap)`) не сохраняется и не отменяется при отключении. `:458-461` (`_publish_desktop_released`) так же.
- `chat/realtime.py:1263-1299`: `create_task` для presence без ссылки.
- Документация asyncio прямо требует хранить ссылку на задачу. Фоновые публикации и уведомления могут пропасть без следа.
- Severity: medium. Confidence: medium.

**B17. При недоступном Redis каждая presence-операция заново делает ping с таймаутом 2 с.**
- `chat/realtime.py:539-557` (`_get_sync_client`): при ошибке `_sync_client` сбрасывается в None, и каждый вызов повторяет `Redis.from_url(...).ping()`.
- Вызовы: `chat/realtime.py:559-620` (`record_presence_sync`, `clear_presence_sync`, `load_presence_snapshot`), `:1263-1290` (через `to_thread`), `chat/chat_presence_service.py:141-143` (синхронно).
- Сценарий: Redis недоступен, каждое presence-обращение блокируется до 2 с.
- Severity: medium. Confidence: high.

**B18. Проверка `current_user.is_active` в WebSocket-цикле использует снимок, загруженный один раз.**
- `api/v1/chat/ws.py:171` (проверка при handshake) и `:331` (проверка после revalidate в цикле): объект `current_user` не обновляется, поэтому условие не станет истинным. Деактивация пользователя во время сессии не закрывает сокет этой проверкой. Полагаться можно только на отзыв сессии (`chat/ws_auth.py:88-111`, который не смотрит на `is_active`).
- Severity: low. Confidence: high.

**B19. `WsSessionLease` меняется из двух потоков без блокировки.**
- `chat/ws_auth.py:88-111` (`revalidate` пишет `grace_deadline`, `:100`) и `:113+` (`apply_auth_payload` пишет `token`, `authenticated_until`). Вызываются из watchdog (`api/v1/chat/ws.py:52-86`) и из основного цикла через `run_in_threadpool`, общего lock нет.
- Severity: low. Confidence: low-medium.

**B20. Отключение соединения очищает typing-состояние пользователя во всех беседах, даже если у него остались другие соединения.**
- `chat/realtime.py:886-890` (`stale_typing_keys` строится только по user_id).
- Severity: low. Confidence: high.

**B21. Ошибка отправки control-кадра учитывается как «slow consumer».**
- `chat/realtime.py:1438` (`_send_control_to_connection`, `self._slow_consumer_disconnects += 1`): метрика искажается, так как это не backpressure.
- Severity: low. Confidence: high.

**B22. Ошибка во время ожидания слота критической очереди может оставить элемент в очереди при исключении у вызывающего.**
- `chat/postgres_realtime.py:524-552` (`_wait_for_critical_queue_slot`): если `put_task` завершился одновременно с `stop_task`, элемент остаётся в очереди, а вызывающий получает исключение и отменяет future (`:466-523`). Событие будет опубликовано, хотя отправитель считает, что нет. Повтор даёт дубликат.
- Severity: low. Confidence: medium.

## Conflicts

**C1. Два механизма для счётчиков unread с разной инициализацией.**
- `chat/chat_delivery_state.py:161-215` (`increment_unread_counters_for_recipients`): инкремент `unread_count + 1` (около строки 190), новые строки создаются с `unread_count=1` (строка 211). Используется файловым, forward и системным путями.
- `chat/chat_delivery_state.py:392-500` (`apply_message_delivery_state_after_commit`): абсолютный пересчёт `tip - last_read_seq` (около строк 462-480), новые строки с `unread_count=max(0, tip_seq)` (строка 494). Используется текстовым путём через outbox.
- Одна и та же сущность считается двумя способами. Инкремент не идемпотентен. Результаты расходятся, если строки нет и `last_read_seq` не совпадает с хвостом.
- Severity: medium. Confidence: medium.

**C2. Четыре реализации fan-out для `chat.message.created` с разной семантикой комнаты и inbox.**
- `chat/realtime_publisher.py:197` (`_publish_message_created`) и `:538` (`_publish_message_created_after_send`, используется `api/v1/chat/messages.py:59`, `ai.py:314`, `_common.py:1108`).
- `chat/realtime_side_effects.py:238` (`publish_message_created_after_send`, используется `ai_chat/action_cards.py:1628`) и `:280` (`publish_message_created_fast_after_send`, используется в `_common.py` через `_enqueue_critical_message_created`).
- `chat/scheduled_messages.py:394` и `ai_chat/service.py:7064` (через outbox, собственная копия).
- Разные пути по-разному решают, кому идёт комнатная рассылка, а кому inbox. Это источник B7.
- Severity: medium. Confidence: high.

**C3. Семантика ошибок обработчика разная в Redis и PostgreSQL транспортах.**
- Redis (`chat/realtime.py:408-452`): логирует и продолжает. PostgreSQL (`chat/postgres_realtime.py:974-1033`, `:846-875`): останавливает курсор и переподключается (B8).
- Одно и то же событие на Redis может быть потеряно, а на PostgreSQL заблокировать узел.
- Severity: medium. Confidence: high.

**C4. Runtime DDL при каждом (пере)подключении в не-production среде.**
- `chat/postgres_realtime.py:1101-1116` и `:1144-1189` (`_ensure_relay_table_sync` выполняет `CREATE TABLE IF NOT EXISTS` и `CREATE INDEX`). В production проверяется только схема (`:1191-1211`).
- Правило AGENTS: «schema changes only via Alembic; no runtime CREATE TABLE/INDEX». Ограничено non-production, но для dev и staging нарушается.
- Severity: low. Confidence: high.

**C5. Два способа захвата `conversation_seq`, корректность которых держится на неявном инварианте.**
- `chat/chat_message_seq.py:25-82`: атомарный `UPDATE ... RETURNING` (текстовый путь, `chat/message_persistence.py:384`).
- `chat/message_persistence.py:144, 695, 890, 1093`: `last_message_seq + 1` в Python. Корректность держится на `_lock_conversation_for_write` (`chat/chat_membership.py:93-102`, `with_for_update`). Вызовы `append_system_message` (`chat/chat_group_admin.py:371, 601`, `chat/chat_group_invites.py:244`, `chat/chat_group_service.py` и др.) полагаются на то, что блокировка уже взята вызывающим кодом.
- При нарушении инварианта возможен дубликат `conversation_seq`: uniqueness constraint отклонит запись, и пользователь получит ошибку вместо сообщения.
- Severity: low. Confidence: medium (проверено выборочно).

## Duplication

**D1. Два почти идентичных state machine для outbox.** `chat/event_outbox_service.py:411-500` (`recover_stale_jobs`, `claim_jobs`, `_update_job`, `mark_*`) и `chat/push_outbox_service.py:184-283` (то же самое). Объединить в общий базовый класс или хелпер с параметрами таблицы и статусов.

**D2. Дубли env-хелперов и `_utc_now`.** `chat/event_outbox_service.py:40-60` (`_utc_now`, `_coerce_utc`, `_clamp_env_int`, `_env_flag`), `chat/push_outbox_service.py:39-63` (те же), `chat/scheduled_messages.py:42-62` (`_utc_now`, `_env_flag`, `_env_int`). Инлайн-парсинг `int(str(os.getenv(...)))` без обработки ошибок: `chat/realtime.py:38-70`, `chat/postgres_realtime.py:145-175`, `chat/postgres_realtime.py:1134-1142` (`CHAT_POSTGRES_CONNECT_TIMEOUT_SEC`).

**D3. Одинаковая логика в двух функциях.** `chat/realtime_side_effects.py:238-277` (блок с `_get_conversation_updates_for_users` + `_get_unread_summaries` + `_inbox_meta_jobs`) и `chat/realtime_side_effects.py:416-446` (`publish_inbox_meta_after_message_created`). Вынести общий хелпер.

**D4. Поиск дубликата по `client_message_id` повторён в трёх местах.** `chat/message_persistence.py:658-670` (файлы, inline select), `:862-870` (forward, inline select), текстовый путь через `_find_existing_client_message` (`chat/chat_delivery_state.py:503-516`). Использовать один хелпер.

**D5. Построение attachment-payload скопировано дважды.** `chat/message_persistence.py` файловый путь (около строк 690-735) и forward путь (около строк 960-1000) почти совпадают.

**D6. Побочные эффекты после отправки реализованы трижды.** `api/v1/chat/_common.py:737-800` (`_create_deferred_chat_notifications_after_send`), `chat/scheduled_messages.py:394-435` (`_enqueue_side_effects`, без семафоров push и hub), `ai_chat/service.py:7064-7100` (`_enqueue_message_side_effects_after_send`). Одна реализация с общими семафорами и порядком.

**D7. Неиспользуемый дубликат в `chat/chat_message_seq.py`.** Блок `values` (строки 44-53) строится до ветвления по диалекту и не используется в PG/sqlite ветке, где `update_values` (строки 61-70) делает то же самое.

## Optimization

**O1. Полная выборка сессий в пустом presence-запросе.** См. B13: `chat/chat_presence_service.py:136`, `services/session_service.py:1307-1325`. Исправление: при пустом `user_ids` возвращать `{}`.

**O2. N+1 при repair.** `chat/event_outbox_service.py:376-386`: отдельный SELECT участников на каждое из до 50 сообщений. Одним запросом с `IN (...)` или `GROUP BY conversation_id`.

**O3. По одному INSERT на джоб при fan-out.** `chat/event_outbox_service.py:299-330` (`enqueue_events`): для беседы на N участников отдельный `INSERT ... ON CONFLICT` на каждого получателя внутри одной транзакции. Можно одним многострочным insert.

**O4. Head-of-line в фоновых эффектах.** `api/v1/chat/_common.py:967-973`: `await _enqueue_deferred_delivery_outbox(...)` (до 5 с ожидания aux-слота) стоит перед запуском инвалидации кэша, уведомлений и inbox-meta в той же корутине.

**O5. Глобальная блокировка на каждый batch публикации.** `chat/postgres_realtime.py:675-702` (`_publish_batch_sync`): `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` на каждый batch каждого узла. Это сериализует публикации всех узлов. Блокировка нужна для порядка commit (по комментарию в коде), но она задаёт предел масштабирования. Проверить под нагрузкой.

**O6. Повторные обходы всех соединений под глобальным lock на каждое сообщение.** `chat/realtime.py:1230-1240` (`conversation_room_user_ids`) и `:1553-1571` (`publish_conversation_room_event`) делают полный обход `_connections` под `self._lock`. В `chat/realtime_side_effects.py:355-372` для одного сообщения такие обходы повторяются. Одного прохода достаточно.

**O7. Запись в БД на каждый revalidate WebSocket.** `chat/ws_auth.py:~124-128` (`session_service.touch_session`) выполняется на каждый revalidate. `session_service.list_sessions` запускает `_run_maintenance` на каждый вызов (`services/session_service.py:1307-1308`).

## Dead code

**X1. Неиспользуемые функции seq.** `chat/chat_message_seq.py:10-22` (`claim_next_conversation_seq`) и `:99-118` (`touch_conversation_last_message`) не имеют вызовов. Их импортируют `chat/message_persistence.py:24` и `:26`, но не используют.

**X2. Ключ, который никогда не создаётся.** `chat/service.py:2766` (`payload.pop("_deferred_delivery_state", None)`): ключ нигде не выставляется (проверено rg по всему backend).

**X3. Мёртвая ветка NOTIFY-payload.** `chat/postgres_realtime.py:924-930` (`notification.get("event")`): `_publish_batch_sync` отправляет только `{"batch": n}` (`:700-703`), поэтому ветка не выполняется.

**X4. Неиспользуемый метод.** `chat/event_outbox_service.py:247-258` (`enqueue_event`, единственное число): вызовов нет, в rg есть только определение.

**X5. Неиспользуемая функция.** `chat/chat_mentions.py:17-18` (`mentions_everyone`): вызовов нет.

**X6. Отладочная инструментация в продакшн-коде.** 10 блоков `# #region agent log` с try/except pass внутри горячего пути: `chat/chat_notification_orchestrator.py:305`, `chat/chat_conversation_read_store.py:111, 127, 437`, `api/v1/chat/ws.py:395`, `api/v1/chat/_common.py:193, 754, 786`, `chat/realtime_publisher.py:521`, `chat/realtime_side_effects.py:382`. Удалить или заменить метриками.

**X7. Неиспользуемый локальный `values`.** См. D7 (`chat/chat_message_seq.py:44-53`).

## Итог

| Раздел | Количество | Главные пункты |
|---|---|---|
| Bugs | 22 | B13 (полная выборка сессий на пустом presence), B1 (потеря delivery-state за пределами окна repair), B8 (head-of-line блокировка relay-узла) |
| Conflicts | 5 | C2 (четыре пути fan-out message.created), C1 (два способа unread), C3 (разная семантика ошибок Redis и PG) |
| Duplication | 7 | D1 (два outbox state machine), D6 (побочные эффекты в трёх местах), D2 (env-хелперы) |
| Optimization | 7 | O1 (= B13), O2 (N+1 в repair), O5 (глобальный lock публикации) |
| Dead code | 7 | X6 (10 блоков agent-log), X1 (неиспользуемые seq-функции), X3 (мёртвая ветка NOTIFY) |

Не проверено построчно: `chat/service.py` (4262 строки), `chat/chat_group_service.py`, `chat/telegram_sticker_service.py`, `chat/push_service.py`, `api/v1/chat/conversations.py`, `api/v1/chat/messages.py`, `chat/calls.py`. Они просмотрены только поиском по ключевым словам. Для `ai_chat` (вне области) упомянуты только точки вызова `asyncio.run` (B15).
