# Исправления по аудиту 2 ноября 2026 — статус на 3 ноября

Источник плана: [TECH_DEBT_AUDIT_2026-11-02.md](../../../../TECH_DEBT_AUDIT_2026-11-02.md), 33 находки первого прохода. Всё изменено только в рабочем дереве: **ничего не закоммичено, не выкачено, не перезапущено; production, `.env`, IIS, PM2 и данные не затрагивались; `npm run build` не запускался** (пробная сборка — `vite build --outDir` вне `dist`). Рабочее дерево содержит и чужие изменения: они сюда не включены.

Решения владельца: BE-04 — ledger в PostgreSQL; FE-02 — digest содержимого + версия формата id; SC-08 — DDL Scan в Alembic с миграцией; OP-04 — разобрать advisory, обновить точечно, без `audit fix --force`.

## Исправлено

| ID | Что сделано |
|---|---|
| OP-01 | Мигратор Hub SQLite→PG: по умолчанию dry-run, запись только с `--execute`, заполненная цель — только с `--overwrite`; источник и цель проверяются до удаления. |
| OP-02 | Тесты Scan не берут обычный `SCAN_DATABASE_URL`; PG-тесты — только `SCAN_TEST_DATABASE_URL` с проверкой, что это тестовая БД. |
| OP-03 | `.gitignore`: исключение для `desktop/Hub.Desktop/Downloads/`. Сами 5 `*.cs` в git не добавлены (по запросу). |
| OP-05 | README: миграции через `ALEMBIC_DATABASE_URL`, без URL в командной строке. |
| BE-01 | ContextVar переносится в mail-executor (`copy_context().run`). |
| BE-02, BE-06 | Auth-context: адресный upsert/delete по session ID вместо load-all/replace-all; поиск по PK. |
| BE-03 | Outbox писем задач: heartbeat и finalize защищены claim-токеном (`attempt_count`). Автоповтор после неизвестного SMTP-исхода не менялся. |
| BE-04 | Ledger загрузки фото `app.equipment_photo_upload_ledger` (`inserting` → `done`), восстановление после сбоя между INSERT в `FILES` и `result.json`; без таблицы работает по-старому. Миграция `20261102_0155`. |
| BE-05 | Lock завершения загрузки фото: токен владельца и heartbeat, удаляется только свой lock. |
| FE-01 | SWR-кеш: поколения ключей, устаревшее чтение не публикуется после invalidation. |
| FE-02 | `client_id` формата `w2-` включает SHA-256 содержимого; задания, поставленные до обновления, дозагружаются под прежним `w-` id. |
| FE-03 | Мониторинг IT-объекта: один polling в полёте, guard последовательности ответов. |
| FE-04 | Очередь фото: явный статус устойчивости, предупреждение о несохранённых файлах, обработка ошибок IndexedDB. |
| FE-05 | Очередь фото привязана к сессии: чужие задания сохраняются, но не исполняются. |
| FE-06 (частично) | Перетаскивание маркера на карте обновляет только точки и аудит (2 запроса вместо 7, без списков сокетов и портов по 10 000 строк). `src/lib/networksBranchContext.js`. |
| CL-01 | Бот (`transfer.py`): после `TimedOut` документ не отправляется повторно, `delivery_unknown`; повторяется только `RetryAfter`. |
| CL-01 (тот же дефект) | `bot/handlers/database.py`: экспорт Excel — то же правило; пользователю сообщается, что файл мог прийти. |
| CL-02, CL-03, CL-04 | mobile-hub, мониторинг: медленный запрос не отменяется каждым tick; история привязана к target/interface/hours; циклы привязаны к focus/AppState. |
| CL-05 | Журнал переводов бота: адресная запись одной операции (`local_store.get_entry/set_entry`), вызовы вынесены из event loop. Retention не менялся. |
| CL-06 | Desktop: TTL 30 минут и общий лимит 500 записей реестра файлов. |
| SC-01 | Уборщик не удаляет PDF моложе 15 минут и PDF job, ещё не записанной в БД. |
| SC-02 | Результат, finding и удаление spool защищены токеном попытки. |
| SC-03 | Счётчик попыток при восстановлении не откатывается; исчерпавшие лимит задания получают `failed`. |
| SC-04 | Конструктор Inventory store не сбрасывает processing→queued; восстановление отдельно. |
| SC-05 | Snapshot Inventory и события изменений пишутся в одной транзакции. |
| SC-06 (частично) | Admission до чтения тела: multipart `/ingest/pdf-slice`, `/ingest/document` и JSON `/ingest` читают тело только под семафором ingest. |
| SC-07 | OCR-пул пересоздаётся после превышения дедлайна, остановка воркера ограничена 60 с. |
| SC-08 | Scan не выполняет DDL на старте: только сверка `scan.alembic_version` (`schema_migration_check`); миграция `20261102_0003` (индекс по hostname). Флаг `SCAN_SCHEMA_DEV_AUTO_CREATE` (по умолчанию 0) — для dev/тестов. |
| OP-04 (частично) | `npm update` уязвимых зависимостей, `pdfjs-dist` 5→6.5.438: уязвимых пакетов 22 → 14 (high 9 → 3). |

## Очередь 1С (3 ноября, после жалобы на заявки и отсутствия ДО)

Диагноз по логам backend: `employee-compare-summary` шёл 30–60 с и занимал единственный worker 1С, поэтому `it-requests` ждали 15 с и получали 503; отсутствия ДО (около 38 с на вызов) при очереди 3 и ожидании 2 с давали 503 при любом втором одновременном запросе. Исправлено: `balances_by_warehouses` вынесен в отдельный child `warehouse1c-heavy-bridge`; для отсутствий ожидание 45 с, очередь 6, одинаковые запросы одной учётной записи делят один вызов. Backend перезапущен `restart-backend.ps1` 3 ноября; причина медленных ответов самой 1С не установлена.

## Замер BE-06 (3 ноября, временная SQLite, 200 чтений одной сессии, HEAD против рабочего дерева)

| Сессий в таблице | Чтение HEAD p50 / p95 | Чтение сейчас p50 / p95 | Запись одной сессии HEAD → сейчас |
|---|---|---|---|
| 200 | 3,7 / 3,9 мс | 0,75 / 0,80 мс | 67 → 8,5 мс |
| 1 000 | 16,0 / 65,1 мс | 0,75 / 0,81 мс | 84 → 7,5 мс |
| 3 000 | 48,6 / 102,8 мс | 0,76 / 0,84 мс | 284 → 8,7 мс |

Время HEAD растёт с числом сессий, текущее не зависит от него. Предел: SQLite в памяти процесса, не PostgreSQL production; замера на production не было.

## Второй проход, этап 1 (3 ноября) — исправлено в рабочем дереве

| ID | Что сделано | Проверка |
|---|---|---|
| DAUTH-03 | `_consume_backup_code`: атомарный `UPDATE ... WHERE used_at IS NULL`, успех только при rowcount=1. | `tests/test_auth_backup_code_race.py` (два потока, барьер после SELECT); 93 теста auth проходят. |
| DCHAT-02 | Эпоха eviction в `ChatRealtimeManager`; `chat.subscribe_conversation` повторно проверяет доступ, если между проверкой и регистрацией прошла eviction. | Тест в `test_chat_realtime_membership.py`; без fencing падает, с ним проходит. |
| DCHAT-01 | WS при периодической revalidation перечитывает пользователя (`deps.reload_active_user`): снятые `chat.read` закрывают сокет (1008), снятые `chat.write` отклоняют команды; неактивный — 4400. Окно ограничено интервалом revalidation (60 с / 30 команд). | Два теста в `test_chat_websocket_error_codes.py`. |
| DMOB-01 | `tokenStore`: при отказе удаления credentials ставится устойчивый маркер, пара считается отсутствующей, повтор очистки на cold start; неполная запись пары откатывается. | 2 теста в `tokenStore.test.ts`; jest 66 passed, `tsc` чисто. |
| DBOT-01 | `require_work_access` на всех шагах сценария «Работы» (вход, выбор, ввод серийника, подтверждение): отказ завершает диалог без SQL и записи. | `tests/test_work_access_gate.py`; существующие work-тесты получили фикстуру разрешения доступа. |

Не сделано на этапе 1: DAUTH-04 (политика отзыва при admin reset — решение владельца), DAUTH-09 (кэш прав между процессами), DCHAT-03 (отзыв доступа между узлами — нужен durable intent или периодическая revalidation комнат; изменение транспорта).

## Второй проход, этап 2 (3 ноября) — целостность файлов

| ID | Что сделано | Проверка |
|---|---|---|
| DFILE-01 | My Files: `append_upload_chunk` резервирует диапазон до записи на диск; второй запрос на тот же диапазон ждёт и сверяется с записанным, а не пишет поверх. Работает в пределах процесса. | Тест в `test_my_files_service.py` (разные bytes одного диапазона → один успех, второй отказ, на диске первые bytes). |
| DFILE-02 | `_discard_unregistered_candidate`: проигравший dedup не удаляет файл, на который уже указывает зарегистрированный blob. | Тест в `test_my_files_service.py`. |
| DFILE-03 | `ref_count` меняется атомарным SQL (`+1`, `-1 WHERE ref_count > 1`, удаление blob только при `ref_count <= 1`). | Параллельный тест на 24 attach и 10 detach (SQLite): итог 15. |
| DCHAT-05 | `FileMessageCommittedError`: сбой после commit сообщения не удаляет вложения (ни в `send_files`, ни при resumable complete); повтор с тем же `client_message_id` возвращает то же сообщение. | Fault-injection тест в `test_chat_files_and_notifications_service.py`; 67 chat upload тестов проходят. |
| DMOB-02 | `downloadAuthenticatedFile`: отдельный staging-файл на каждую операцию, отмена одной загрузки не ломает другую. | Тест в `authenticatedFileDownload.test.ts`; jest `src/files` 34 passed, `tsc` чисто. |

Не сделано на этапе 2: DFILE-04 (токен попытки обработки файла: нужна колонка и миграция, решение по схеме), DCHAT-04 (межпроцессная блокировка chunk загрузки чата при двух chat-процессах), межпроцессная координация DFILE-01 при нескольких backend-процессах. Накопленные расхождения `ref_count` на production не проверялись и не исправлялись.

## Второй проход, этап 3 (3 ноября) — надёжный исход внешних действий

| ID | Что сделано | Проверка |
|---|---|---|
| DMAIL-01 | Транспортный сбой после начала отправки EWS (обрыв, таймаут, нечитаемый ответ) фиксируется как `MAIL_SEND_OUTCOME_UNKNOWN`, запись идемпотентности получает `unknown`, повтор с тем же ключом не отправляет письмо. Только локальные ошибки и однозначный отказ Exchange остаются `failed`. | Тест в `test_mail_send_idempotency.py`: два submit с одним ключом → один вызов отправки. |
| DMAIL-02 | Локальная ошибка после успешной отправки больше не освобождает ключ: запись помечается `sent`. | Существующие тесты idempotency/pipeline проходят; отдельного теста на этот путь нет. |
| DDOC-01 | Зависшая в `pending` команда (старше `DOCFLOW_PENDING_STALE_SECONDS`, по умолчанию 180 с, минимум 60) переводится в `state_unknown` и сверяется read-only, действие не повторяется. | Тест в `test_docflow_service.py`: свежая остаётся `pending`, старая проверяется. |
| DDOC-02 | Сверка поручения считает его применённым только если виден запуск (есть `task_ref`); объект-черновик остаётся `state_unknown`. | Параметризованный тест (без запуска / с задачей). |
| DDOC-03 | Запись в DMService: битый XML, пустой ответ, HTTP 5xx без разбираемого отказа, oversize после отправки → `Docflow1COutcomeUnknownError`. SOAP Fault и бизнес-ошибки по-прежнему отказ. | Параметризованный тест (HTML 502, битый XML, пустое тело). |
| DAI-02 | Отмена и истечение карточки действия AI — compare-and-set из `pending`; проигравший confirm/cancel перечитывает итоговое состояние, `executing` не затирается. | Гонка в `test_e2e_ai_draft_reliability.py`. |
| DAI-08 (частично) | Карточка не-почтового действия, зависшая в `executing` дольше 5 минут, становится `failed` с `outcome: unknown` и инструкцией проверить результат вручную; повтор не выполняется. | Тест в `test_e2e_ai_draft_reliability.py`. Устойчивые ключи идемпотентности и сверка по доменным сервисам не сделаны. |

Регрессионный прогон затронутых наборов (AI, почта, docflow): 179 passed.

Не сделано: DAI-08 по существу (ключи и сверка для задач, чата, переводов), автоматическая сверка факта отправки письма в Sent после `unknown` (пока только блокировка повтора и подсказка проверить «Отправленные»), идемпотентный повтор DDOC-01 после рестарта процесса без обращения пользователя (сверка запускается при опросе статуса).

## Второй проход, этап 4 (4 ноября) — очереди агентов и egress

| ID | Что сделано | Проверка |
|---|---|---|
| DSCAN-01 | `ScanAgent._outbox_move_to_dead`: pending-документ удаляется только после успешной записи dead-letter, при сбое остаётся и возвращается `False`. | Тест в `test_scan_agent_backpressure.py`. |
| DINV-01 | То же для `_inventory_queue_move_to_dead` в `agent.py` и в копии `agent/src/itinvent_agent/agent.py` (источник MSI). Копии в `deploy_staging/` — исторические снимки, не менялись. | Тест в `test_agent_ops_health.py`. |
| DINV-02 | `_post_payload` считает отправку успешной только при JSON-ответе с `success: true`; HTML прокси, битый JSON, `success: false` оставляют отчёт в очереди (обе копии агента). | Тест в `test_agent_ops_health.py`. |
| DINT-02 | `EgressSpool._move` возвращает результат и не удаляет источник при сбое; отправленное событие (сервер принял) при неудачном переносе в `sent` удаляется, чтобы не слать повторно. Статистика `drain` соответствует факту. | Тест в `test_fs_egress_core.py`. |
| DINT-03 | `build_file_left` не падает на `PermissionError` метаданных (флаг `metadata_unavailable`, без ложного хеша); `flush_due` обрабатывает события по отдельности, ограниченный повтор (3 попытки), остальные события не теряются. | Тест в `test_fs_egress_core.py`; ранее падавший UNC-тест теперь проходит (8 passed). |

Прогон: агенты и egress (`test_scan_agent*`, `test_agent*`, `test_fs_egress_core`) — все проходят. Агенты на ПК не обновлены: нужна сборка и раздача новых версий (Scan-агент, Inventory-агент/MSI).

Не сделано на этапе 4: DINV-03 (общий agent key читает чужие probe-данные — решение по модели доступа), состояние `dead-letter` пока видно только в локальном журнале агента (в heartbeat/status не выводится).

## Второй проход, этап 5 (4 ноября) — сверка и бизнес-состояние

| ID | Что сделано | Проверка |
|---|---|---|
| DBOT-02 | `save_battery_replacement`, `save_pc_cleaning`, `save_component_replacement_pc`: ошибка UPDATE, 0 затронутых строк или отсутствующая конфигурация БД возвращают `False`; запись в JSON-историю не делается, пользователь видит «Ошибка при сохранении». | `tests/test_work_handlers.py` (сбой SQL / нет строки / нет конфигурации — истории нет). |
| DBOT-03 | Оборудование при поиске помечается БД, из которой найдено (`_hubit_db_name`); подтверждение, предпросмотр последней чистки и история используют её, а не текущий выбор пользователя. | Тест: смена БД между предпросмотром и подтверждением не меняет целевую БД. |
| DBOT-05 | UPDATE описания — compare-and-set по описанию из предпросмотра (`ISNULL(CAST(DESCR AS NVARCHAR(MAX)),'') = ?`); изменённая за это время запись не перезаписывается, пользователь получает ошибку и повторяет. | Тест на SQL/параметры CAS. Реальный SQL Server не проверялся. |
| DEQP-04 | Чтение строки проверки фото идёт с `FOR UPDATE` (`_row_select`), verify/reject/unverify/причина сериализуются по строке. Миграция не нужна. | Тест на `FOR UPDATE` для PostgreSQL-диалекта; регресс 24 passed. Гонка двух сессий на реальном PostgreSQL не воспроизводилась. |
| DBIZ-03 | `execute_import` захватывает задание условным `UPDATE ... WHERE status='previewed'`; проигравший получает конфликт (409) и ничего не пишет. | Тест с «соперником», забирающим claim между чтением и UPDATE (45 passed). |
| DWH-01 | Покрытые владельцы и «только в HUB» ключуются `(db_id, owner_no)`; строка hub-only несёт `hub_db_id`. | Тесты: одинаковый OWNER_NO в двух БД — разные люди. |
| DWH-03 | Недоступный `list_owners`, count или hub-only запрос → `status=incomplete`, `exact=false`, `hub_incomplete_db_ids`; при сбое owners `hub_count=None` (не нулевой факт). | Тесты на сбой owners и hub-only (35 passed в связанных файлах). |

Не сделано на этапе 5: DBIZ-01 (словарь статусов импорта: соответствие cancelled/closed/archive меняет смысл истории — решение владельца), DBIZ-04 (путь обновления дублей без state machine/version/history — зависит от DBIZ-01 и политики административных переходов), DWH-02/04 (вне этапа). Выкладка: перезапуск бота и backend отдельной командой.

## Второй проход, этап 6 (4 ноября) — дедлайны и backpressure

| ID | Что сделано | Проверка |
|---|---|---|
| DINT-01 | `voice_server/runner._run_subprocess`: stdout читается отдельным потоком в ограниченную очередь (2000 строк, при переполнении строки отбрасываются со счётчиком, дочерний процесс не блокируется); supervisor проверяет отмену/таймаут каждые 50 мс независимо от вывода. | `tests/test_voice_server.py`: молчащий процесс останавливается по таймауту (-9), строка без перевода строки не мешает отмене (-15), поток 20 000 строк завершается (123 passed вместе с `test_voice_labeling.py`). |
| DMAIL-03 | `_run_mail_instrumented`: permit Exchange освобождается по завершению потока EWS (done-callback), а не при отмене HTTP-запроса; отменённый ещё не начавшийся вызов освобождает permit сразу. | `tests/test_mail_async_api.py`: при лимите 1 четыре отменённых вызова дают пик 1, новый запрос ждёт завершения брошенного вызова (16 passed). |
| DSCAN-02 | JSON `/api/v1/scan/ingest`: тело читается потоково с потолком (`pdf_max_bytes*3 + 2 МБ`, переопределяется `SCAN_INGEST_JSON_MAX_BYTES`), 413 по `Content-Length` и при потоковой загрузке без него; разбор и обработка не запускаются. | `tests/test_scan_server_app_presence.py` (28 passed вместе с `test_scan_server_main.py`). |
| DAI-06 | `shared/llm/client.py`: SDK `max_retries=0` (владелец повторов — шлюз); общий wall-clock бюджет `AI_OPENROUTER_RETRY_WALL_BUDGET` (90 с) на все попытки и fallback strict-JSON; повтор не начинается, если задержка не помещается в бюджет. | `tests/test_openrouter_client.py` (87 passed с gateway/jev). |
| DAI-07 | `_enqueue_run`: ограничение очереди `queued` на пользователя (`AI_RUN_QUEUE_MAX_PER_USER`, 10) и глобально (`AI_RUN_QUEUE_MAX_GLOBAL`, 500). Новый запрос при переполнении сохраняется как `failed` с текстом «Очередь AI переполнена…», явный повтор получает 429 + Retry-After. | `tests/test_ai_run_retry.py` (30 passed с rebind/watchdog). |

Не сделано на этапе 6: DSCAN-04 (OCR-поток нельзя прервать — нужна процессная граница для hard deadline, отдельное решение и Windows-приёмка); ограничение очереди executor почты по глубине (permit теперь привязан к вызову, но потолок ожидающих не вводился); подсчёт очереди DAI-07 не атомарен между беседами одного пользователя (мягкий предел, не жёсткая гарантия).

## Второй проход, этап 7 (4 ноября) — согласованное UI-состояние

| ID | Что сделано | Проверка |
|---|---|---|
| DWH-05 | `useEmployeeEquipmentData`: загрузка перемещений склада получает порядковый номер; сброс (смена сотрудника/склада) и новая загрузка обесценивают старые ответы (success, error и finally); «Показать ещё» во время запроса игнорируется. | `useEmployeeEquipmentData.test.jsx`: поздний ответ A после перехода на B не попадает в B; при двух диапазонах дат побеждает последний. |
| DFILE-08 | `usePasswordVaultAccess`: эпоха раскрытия, увеличивается при hide/blur/печати и смене пользователя; ответ `reveal` из прошлой эпохи отбрасывается (ни state, ни буфер обмена). | `usePasswordVaultAccess.test.jsx`: show и copy после blur ничего не восстанавливают, обычный reveal работает. |
| DMOB-03 | `ChatVoiceNote`: счётчик жизни строки проверяется после каждого `await` (скачивание, audio mode, seek), позднее скачивание отменяется `AbortController`, поздний player не создаётся/освобождается. | `ChatVoiceNote.test.tsx`: размонтирование во время скачивания — сигнал отменён, `createAudioPlayer` не вызван. |
| DMOB-04 | `downloadChatAttachment`: те же cache/session generation и `assertCurrent`, что у trusted media; файл, дозагруженный после `clearAttachmentCache` (logout), удаляется. | `nativeAttachmentDownloads.cleanup.test.ts`; mobile `jest src/files` + ChatVoiceNote — 37 passed, `tsc` чисто. |
| DTASK-03 | `hub_service.update_task`: изменение checklist завершённой задачи (status `done`) отклоняется (400), повторная отправка неизменённого списка допустима; согласовано с `can_update_checklist`. | `tests/test_hub_tasks.py` (новый тест). |
| DTASK-04 | Realtime-событие задачи классифицируется (`taskRealtimeMembership.js`): patch / remove (строка вышла из фильтра, total−1) / reload (задача могла войти в выборку, серверные фильтры, смена отношения в «моих» режимах) / ignore. | `taskRealtimeMembership.test.js`; `src/pages/tasks` — 152 passed. |

Не сделано на этапе 7: порядок строк после remote update при сортировке по `updated_at` (строка остаётся на месте до перезагрузки); DNET MFU (добавление без синхронизации/удаления — решение по политике); браузерная E2E-приёмка фильтров и Android-приёмка воспроизведения. Фронтенд/APK не пересобирались.

## Второй проход, этап 8 (4 ноября) — эксплуатация и воспроизводимость

| ID | Что сделано | Проверка |
|---|---|---|
| DOPS-01 | Мигратор `network/mail/mfu/reminders/env_audit` SQLite→PostgreSQL получил контракт hub-мигратора (`scripts/_migration_safety.py`): dry-run по умолчанию, `--execute`, `--overwrite` для непустой цели, прерывание при неполном/пустом источнике, DELETE+INSERT в одной транзакции со сверкой счётчиков и откатом; источник открывается read-only | `tests/test_migrate_safe_replace_scripts.py` (5) + hub-мигратор (10) |
| DOPS-02 | Пул pyodbc: соединение с неудавшимся rollback помечается сломанным и закрывается, а не возвращается в пул | `tests/test_db_pool_and_engine_cache.py` |
| DOPS-03 | `get_app_engine`/`get_app_session_factory`: создание под `RLock` (двойная проверка), без дублирования engine при гонке потоков | там же (4 passed) |
| DINT-04 | Egress-хранилище: молчаливый откат на SQLite запрещён (`FS_EGRESS_ALLOW_SQLITE_FALLBACK`); без флага `EgressStoreUnavailableError`, ingest/list отвечают 503 + Retry-After | `tests/test_app_file_egress_store.py` (4), `test_fs_egress_core` (8) |
| DINT-05 | `save_meeting_web_meta`: уникальный temp-файл и replace под замком с повтором при PermissionError (Windows) | `tests/test_voice_server.py` (69) |
| DDESK-02 | `TrimCompletedItems` вытесняет только завершённые элементы (`!CanCancel`); приостановленная загрузка остаётся отменяемой, запись `_cancelActions` удаляется вместе с элементом | `DesktopDownloadCoordinatorTests` + весь `Hub.Desktop.sln` Release: 634 passed |
| DDESK-03 | Подписка на `_downloads.Items.CollectionChanged` — именованный обработчик, отписка в `Window_Closed` | сборка Release; поведение окна не проверялось вручную |

Не сделано на этапе 8: DDESK-01 и DINT-06 (отслеживание файлов в git/документация), версия/CAS для `save_meeting_web_meta` (потерянное обновление остаётся), DOPS-04 (ping при блокирующем get).

## Остаток после этапа 8 (4 ноября)

| ID | Что сделано | Проверка |
|---|---|---|
| 8 тестов `test_e2e_ai_employee_comparison` | Причины — устаревшие допущения тестов, не регрессия аудита: (1) `balances_by_warehouses` ушёл в «тяжёлый» мост, тест подменял только обычный; (2) несколько складов одного ФИО теперь суммируются, «неоднозначно» — только при списке кандидатов ≥ `EMPLOYEE_WAREHOUSE_MATCH_LIMIT`; (3) после сбоя моста сводка 60 с не повторяет вызов 1С. Тесты обновлены под текущий контракт | 50 passed |
| Утечка в лог | `_get_employee_compare_summary`: warning о сбое сборки писал `str(exc)`, а текст ошибки моста может содержать детали подключения. Теперь только тип ошибки и `reason_code` | тот же тест (`private bridge` не попадает в лог) |

**Требует решения владельца / коммита.**
- DDESK-01 подтверждён: каталог `desktop/Hub.Desktop/Downloads/` (5 файлов) не отслежен git — чистый clone не соберётся. Тот же риск у новых файлов, которые импортируют отслеживаемые модули (`services/inventory_read.py`, `database_catalog.py`, `mfu_device_rows.py`, `my_files_*`, `user_device_service.py` и др.). Нужен коммит по явной команде; в индексе есть чужие staged-удаления, коммитить только `git commit -- <пути>`.
- AR-01 остаток (`ai_chat/tools/computers.py`, `it_reports.py` берут приватные функции из `api/v1/inventory.py`, 3800 строк) сознательно не трогался: вынос потребует переноса enrichment/scope-логики роутера без отдельного дефекта.
- DINT-05 (версия/CAS для `save_meeting_web_meta`), DINT-06, DOPS-04 — не сделаны.

## Не сделано

| ID | Причина / что нужно |
|---|---|
| AR-01 (частично) | Из роутеров в service-слой вынесены: чтение хоста Inventory, нормализация MAC, пороги online/stale (`services/inventory_read.py`), каталог баз (`services/database_catalog.py`, им пользуются AI tools и Scan) и нормализация строк МФУ (`services/mfu_device_rows.py`). В роутерах остались совместимые алиасы. `ai_chat/tools` и `scan_server` больше не импортируют `api/v1/database.py` и `api/v1/mfu.py`. **Осталось:** `ai_chat/tools/computers.py` и `it_reports.py` всё ещё берут из `api/v1/inventory.py` `_build_computers_search_payload`, `_collect_scoped_computer_records`, `_load_changes`, `_enrich_status`, `_ensure_identity_fields`, `_ensure_runtime_fields` — это ~2000 строк поиска и кэшей с права доступа и состоянием процесса; вынос отдельным изменением. Хост и app store в роутере продублированы (тесты патчат `get_local_store` и `is_app_database_configured` в роутере), логика идентична. |
| AR-02 | Сам аудит: отдельный рефакторинг не требуется; выносить сценарии по одному при правке конкретных дефектов. |
| FE-06 (остальное) | Остальные мутации `Networks.jsx` оставлены на полном `refreshBranchContext`: на backend точки, сокеты и порты связаны. Нужен замер p95 по одному филиалу. |
| SC-06 (остальное) | Нет общего бюджета байтов и ограничения размера JSON-тела; IIS body limits не проверены. Лимит может изменить поведение агента при больших файлах (реакция агента на 413 не проверена). |
| CL-05 (retention) | Журнал операций по-прежнему не очищается — отдельное решение. |
| OP-04 (остаток) | `xlsx` (исправления нет), `react-router` (нужен v7), `nanoid` в excalidraw (major), вложенные `lodash-es` и `katex` — решения владельца. |
| BE-03 (SMTP) | Политика для неизвестного результата SMTP (запрет автоповтора) — отдельное решение. |
| Mail overload (гипотеза) | Нужен cancellation/stress harness. |

## Проверено

Backend: большой прогон 215 passed / 1 skipped; позже 139 и 129 passed (бот, Scan, переводы); сегодня бот 10 passed, Scan 111 passed. Frontend: ~1200 и 979 тестов, PDF/документы/Excel 332, `src/lib` 557; пробная `vite build` вне `dist` успешна. Mobile: jest 5, `tsc` без ошибок. Desktop: 6 тестов.

## Не проверено

Android-устройство (CL-02…04); Scan на реальном PostgreSQL; отображение PDF в браузере после `pdfjs-dist` 6; экран Networks в браузере; production; полный backend-gate и полный E2E; чистая сборка Desktop из clone.

## Выкладка (4 ноября)

- Production на `20261103_0160` (= head): миграции из списка этапов уже применены, новых нет.
- Backend, chat, scan, inventory и frontend `dist` перевыложены 4 ноября 21:08–21:48 (не в рамках этой серии); правки аудита по времени файлов вошли в backend, scan и `dist`.
- Воркеры и бот перезапущены 4 ноября ≈22:00 с кодом аудита: `ai-chat-worker`, `mail-notification-worker`, `voice`, `voice-worker`, `voice-archiver`, `bot` (health-check: 0 ошибок).
- Без правок DOPS-02/03 остались chat-a/b, inventory, preview/chat-push/monitoring/my-files и retention-воркеры (запущены раньше правки); эффект небольшой, подхватятся при ближайшем рестарте.
- Не выполнялось: сборка APK (mobile-hub: DMOB-03/04), релиз Desktop (DDESK-02/03), пересборка агентов.
