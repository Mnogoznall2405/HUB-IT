# 12. Scan: server, worker и Windows sidecar

Дата задания: 02.11.2026. Повторная проверка текущего дерева: 03.11.2026.
Режим: чтение исходников; разрешённая запись только этого отчёта; изолированные временные SQLite/harness.
Production, .env, IIS, PM2, реальные задания и документы пользователей не использовались.
Рабочее дерево содержит изменения других задач: прежние дефекты перепроверены по свежему коду.
Обозначения: R — воспроизведено изолированно; S — подтверждено трассировкой кода; H — гипотеза/непроверенная эксплуатационная граница.
Severity описывает влияние; R/S/H описывают силу доказательства, а не приоритет.

## Главный вывод

Новые подтверждённые дефекты — потеря pending при failed dead-letter write и пропуск изменённых bytes внутри секунды.
Прежние spool/recovery/fencing исправления появились извне во время аудита: они не являются работой этого аудитора.
Свежий код содержит grace для spool, поколение claim, ограничение crash recovery и перенос чтения multipart внутрь admission.
JSON ingest, доверие к agent_id и остаточные OCR-потоки требуют отдельной проверки и ограничений.
Отчёт не подтверждает публикацию этих изменений и не оценивает состояние production.

## Карта исполнения

```text
Watchdog / scan_now → ScanAgent._scan_path → hash → _analyze_file
    → multipart pdf-slice/document или JSON ingest
    → app._run_ingest_admitted → store.queue_job → transient_jobs/{id}.pdf + scan_jobs
    → ScanWorker._tick → claim_next_jobs → _process_job
    → conversion → OCR → pattern matches → finding/incident + terminal job
ScanAgent failure → local pending JSON → _drain_outbox → server ACK → local state
Scan UI → REST projections + SSE invalidation → read-store → scan PostgreSQL/SQLite
```

Server entrypoint: `scan_server/app.py:1039`, worker: `scan_server/worker.py:858`.
Persistence: `scan_server/database.py:3092`; spool: `scan_server/pdf_spool.py:14`.
Agent transport: `scan_agent/agent.py:1642`, `:1690`, `:1743`.
Agent retry path: `scan_agent/agent.py:1792`; watcher queue: `:1860`.
`inventory_server` не является хранилищем Scan; их задания, статусы и документы нельзя смешивать.

## Состояния и инварианты

Job: queued → processing → done_clean / done_with_incident / analysis_incomplete / failed.
Повтор OCR может вернуть processing → queued, но должен сохранить поколение выдачи.
Command: queued → delivered → acknowledged → completed / failed / expired.
Команда scan_now должна дождаться ingest_complete и завершения связанных server jobs.
Наличие HTTP ACK означает постановку работы, а не успешный OCR или отсутствие чувствительных данных.
Невозможность OCR/конвертации/получения payload должна давать incomplete, а не clean.
Устаревший владелец claim не должен менять verdict, создавать incident или удалять spool нового владельца.
До удаления локального pending должен существовать серверный ACK либо сохранённая локальная замена.
Повтор event_id должен быть идемпотентен; повтор с другим scope/version не обязан дедуплицироваться.
Хеш источника и байты OCR-среза относятся к разным представлениям документа; их равенство не предполагается.

## DSCAN-01 — удаление pending после ошибки сохранения dead-letter

Severity: High. Доказательство: R. Статус: OPEN, NEW относительно начального прохода.
Код: `scan_agent/agent.py:1331-1344`.
Callers: `_outbox_prune_limits`, `scan_agent/agent.py:1398-1426`; `_drain_outbox`, `:1804`, `:1810`.
Переход в dead-letter вызывается при повреждении, превышении возраста, количества и размера.
`_outbox_write(dead_path, payload)` может упасть из-за диска/ACL/антивируса.
Исключение только логируется; следующий блок всё равно вызывает `path.unlink(missing_ok=True)`.
В результате не остаётся ни pending, ни dead-letter, хотя документ серверу не передан.
Изолированный AST harness исполнил именно текущую функцию с fault injection в writer.
После simulated full disk исходный временный pending исчез, целевой dead-letter отсутствовал.
Обе проверки утверждений завершились exit 0; временный каталог очищен.
Минимальное исправление: прекращать переход при ошибке записи; удалять source только после успешного сохранения.
Предпочтительно атомарное перемещение в пределах тома, с явной обработкой разных томов и существующей цели.
Acceptance: writer failure сохраняет исходные байты, успешный переход сохраняет payload и причину ровно один раз.
Дополнительно: ошибка должна попадать в status/heartbeat, чтобы переполнение не оставалось только в локальном логе.

## DSCAN-02 — неограниченный JSON ingest

Severity: Medium. Доказательство: S. Статус: OPEN, часть прежней NEW-SC-08.
Код: `scan_server/app.py:133-153`, `:1039-1048`; caller агента `scan_agent/agent.py:1743-1780`.
Модель принимает text_excerpt, pdf_slice_b64, document_b64 и metadata без прикладного byte budget.
FastAPI читает/декодирует JSON до вызова `_run_ingest` и до его semaphore.
Multipart теперь читает bytes под semaphore; это не ограничивает отдельный JSON-маршрут.
Общий серверный/IIS body limit в этом аудите не проверен, поэтому эксплуатационный максимум неизвестен.
Крупные одновременные JSON запросы могут удерживать тело, распарсенные строки и декодированные bytes.
Минимальное исправление: ранний ASGI byte limit, ограничения полей/списков и отказ от больших inline base64.
Acceptance: oversized request получает 413 до полного накопления тела; N concurrent requests укладываются в RAM budget.
Включить отдельный сценарий legacy JSON fallback PDF и корректную запись analysis_incomplete при допустимом oversize.

## DSCAN-03 — ключ агента не привязан к agent_id

Severity: High. Доказательство: S. Статус: OPEN, прежняя NEW-SC-01.
Код: `scan_server/app.py:232-236`, poll `:1136`, result `:1153`.
`_check_agent_key` проверяет только принадлежность ключа общему набору.
Идентификатор агента берётся из запроса/payload, а не из проверенного enrollment.
Держатель допустимого общего ключа может представляться другим agent_id и забирать его команды.
Затронуты целостность inventory присутствия Scan, результаты задач и доставка self_update.
Точки выдачи команд требуют web permissions; это не устраняет доступ агента к чужому inbox.
Реальные ключи и сеть не использовались; утверждение основано на коде границы авторизации.
Минимальное исправление: server enrollment с привязкой agent_id к credential/fingerprint и ротацией.
Acceptance: агент A не poll/ack/result для B; совместимая процедура переустановки и смены ключа проверяется отдельно.

## DSCAN-04 — recycle не прекращает running OCR thread

Severity: Medium. Доказательство: S/H. Статус: CHANGED относительно SC-07/AUD9-031.
Код: `scan_server/worker.py:436-458`, `:568-572`; Windows executor создаётся около `:419`.
Новый код вызывает cancel и отделяет просроченный pool; shutdown ожидания теперь ограничен.
Running ThreadPoolExecutor future не прерывается методом cancel или shutdown(wait=False).
На повторных зависаниях native OCR старые потоки/payload могут сохраняться после создания нового pool.
Обычные finite timeout и BrokenProcessPool не доказывают эту утечку: нужен фактически не завершающийся native вызов.
Не заявляется, что runtime сейчас зависает или память уже растёт; production baseline отсутствует.
Минимальное направление: контролируемая процессная граница для hard deadline и общий cap осиротевших работ.
Acceptance: после серии настоящих deadline число процессов/потоков и RSS возвращаются к заданному потолку.
Граница остановки процесса требует отдельного Windows acceptance: daemon stopper не убивает executor thread.

## DSCAN-05 — полные таблицы для SSE cursor и spool reconcile

Severity: Medium. Доказательство: S; влияние на latency — H.
Код: `scan_server/database.py:852-880`, `:1491-1514`; caller `scan_server/realtime.py:89-101`.
С подписчиками cursor каждые две секунды считает GROUP BY count/max по четырём таблицам.
Reconcile загружает все scan_jobs и строит множества в памяти под store lock.
В runtime с default RLock это конкурирует с ingest/claim и тяжёлыми projection-запросами.
Числа production строк, p95/p99 и планы SQL не измерялись; это доказанный путь O(N), не измеренная деградация.
Минимальное действие: baseline на сопоставимом тестовом объёме, затем bounded reconcile и дешёвый change cursor.
Acceptance: RSS, lock hold, ingest p95/p99 и SQL duration при фиксированном объёме до/после.
Не менять null-lock режим без проверки всех check-then-write операций.

## DSCAN-06 — хеширование и чтение изменяемого файла не образуют snapshot

Severity: Medium. Доказательство: H, открытый вопрос durability.
Код: `scan_agent/agent.py:1991-1996`; hash helper `:601`; анализ открывает тот же путь повторно.
Watcher может увидеть документ в момент сохранения приложением.
Между stat/hash/analyze файл может измениться, и event_id/file_hash опишут другое состояние, чем отправленные bytes.
Текущее чтение кода не подтвердило обязательную повторную проверку stat/hash после формирования payload.
Не воспроизводился сценарий concurrent replace, поэтому это не объявляется подтверждённой потерей документа.
Минимальная проверка: deterministically replace файл между hash и analyze в изолированном тесте.
Acceptance: mismatch приводит к повторной постановке, stable snapshot или явному incomplete; clean по чужому hash запрещён.

## DSCAN-07 — изменение файла внутри секунды ошибочно считается уже проверенным

Severity: High. Доказательство: R. Статус: OPEN, NEW.
Код: `scan_agent/agent.py:1487-1502`; caller раннего skip `:1987-1988`.
State записывает mtime с секундной точностью; проверка сравнивает int(stat_result.st_mtime), size и наличие старого hash.
Новый hash не вычисляется, если эта проверка вернула True: `_sha256_file` вызывается только после неё, `:1991`.
Два сохранения одинакового размера внутри одной секунды имеют различные mtime_ns и bytes, но одинаковый int(mtime).
Изолированный AST harness создал public→secret при том же размере и mtime 1700000000.1→1700000000.9.
Фактический SHA256 изменился, однако текущая `_already_scanned` вернула True; обе проверки подтверждены exit 0.
Watcher event не спасает: вызванный повторный `_scan_path` снова проходит этот fast path.
Минимальное исправление: хранить/сравнивать mtime_ns, валидировать совместимость старого state и повторять анализ при сомнении.
Для файловых систем с грубой точностью нужен дополнительный критерий или rehash по явному change event.
Acceptance: same-size save в той же секунде повторно анализируется; реально неизменный файл остаётся дешёвым skip.
Это отдельный воспроизведённый дефект, не подтверждение гипотезы concurrent replace из DSCAN-06.

## Перепроверка прежних выводов

SC-01 / NEW-SC-22: CHANGED — `database.py:1482` вводит 900-second grace для новых orphan spool.
Исходный мгновенный reconcile больше не должен удалять свежий файл; длительный незавершённый INSERT за grace не проверен.
SC-02: CHANGED — `_claim_guard`, `database.py:32-36`, защищает finalize/retry/finding по attempt_count.
Worker передаёт claim generation, `worker.py:873-890`; новый stale owner test включён в focused run.
SC-03 / NEW-SC-03: CHANGED — recovery не уменьшает attempts и завершает exhausted, `database.py:3325-3353`.
Лимит обычного OCR error существовал ранее: `retry_limit = min(max_attempts, 2)`, `worker.py:1090-1106`.
Неверно описывать каждый OCR timeout как бесконечный retry: первоначальная находка относилась к process crash.
SC-06 multipart: CHANGED — чтение pdf/document перенесено под ingest semaphore, `app.py:1074-1076`.
JSON часть SC-06 остаётся DSCAN-02; multipart admission не означает защиту от дискового spool exhaustion ASGI.
SC-07: CHANGED — bounded shutdown/recycle добавлены, `worker.py:157-174`; остаток описан DSCAN-04.
Runtime DDL: CHANGED — startup использует prepare_scan_schema, `database.py:930-933` и `WEB-itinvent/backend/chat/db.py:144-149`.
DDL теперь включается явным SCAN_SCHEMA_DEV_AUTO_CREATE; production rollout и миграции не выполнялись.

## Проверки, метрики и пределы покрытия

Первоначальный isolated SQLite harness воспроизвёл три старых дефекта до внешних исправлений.
Исторический вывод нельзя использовать как доказательство, что свежий код всё ещё ломается так же.
Свежий AST harness подтвердил DSCAN-01 и DSCAN-07 на текущем source; exit 0, временные файлы очищены.
Focused pytest: 25 passed, 2 warnings, exit 0; crash recovery, stale owner, OCR deadline, inventory queue, agent backpressure.
Команда: `python -m pytest -q tests/test_scan_server_tables.py::test_repeated_crash_recovery_ends_in_failed_instead_of_retrying_forever tests/test_scan_server_tables.py::test_stale_owner_cannot_finish_or_record_findings_for_a_reclaimed_job tests/test_scan_server_worker.py::test_ocr_task_over_deadline_does_not_block_the_next_job_and_shutdown_is_bounded tests/test_inventory_server.py tests/test_scan_agent_backpressure.py`.
Дополнительная проверка свежего grace: `python -m pytest -q tests/test_scan_server_tables.py::test_reconcile_spares_a_fresh_pdf_that_has_no_job_row_yet` — 1 passed, 2 warnings, exit 0.
Итого 26 passed в двух непересекающихся запусках; DB URL явно изолированы, SCAN_TEST_DATABASE_URL пуст.
У первого запуска после summary atexit cleanup pytest сообщил WinError 5 на pytest-current; assertions прошли, cleanup был неполным.
Свежий grace test и harness завершились без этой ошибки; чужие каталоги pytest не очищались.
Без production измерений нет основания обещать ускорение или называть текущий throughput достаточным.
Для performance acceptance нужны 1/6/12 agent uploads, фиксированный набор PDF/image/office и одинаковый объём истории.
Фиксировать queue wait, OCR pool wait, conversion/OCR duration, RSS, threads, DB lock wait и p95/p99 ingest.
Обязательны restart во время write/claim/OCR/finalize и повтор event_id после потери HTTP ответа.
PostgreSQL concurrent claim и migration upgrade/downgrade в этом module pass не запускались.
Tesseract/LibreOffice на реальных документах, SMB/OneDrive replace, self-update MSI и Windows shutdown не запускались.
Hash полного источника не является проверкой подписи MSI или хешем OCR-среза.

## Что не является подтверждённым дефектом

PostgreSQL claim использует SKIP LOCKED + UPDATE RETURNING; первичная выдача атомарна.
Отсутствующий spool и недоступные правила дают incomplete, а не чистый результат (`worker.py:909-947`).
SSE несёт invalidation sections, поэтому дроп oldest при maxsize=16 не равен потере business event.
Клиентский resync при переполнении SSE отдельно не проверялся.
Scan agent сохраняет pending с backoff/Retry-After и не отмечает failed upload как успешно scanned.
Последний outbox item дожидается успешного ingest_complete перед удалением, `agent.py:1815-1836`.
MSI SHA256 действительно сверяется перед установкой, `scan_agent/agent.py:2431-2438`.
Authenticode trust и безопасность канала выдачи hash — отдельные гарантии, не подтверждённые одним SHA256.

## Прочитанные области и следующие границы

Прочитаны app ingest/poll/result/admission, ScanStore queue/recovery/finalize/finding/reconcile/schema hooks.
Прочитаны ScanWorker claim/OCR/conversion/failure/finally/shutdown и PdfSpoolStore atomic write/delete.
Прочитаны agent hash/state/outbox/dead-letter/Retry-After/multipart/fallback/self-update.
Изучены scan architecture docs, предыдущий TECH_DEBT_AUDIT и текущая test DB isolation.
Не проведён полный построчный аудит OCR image processing, всех regex, всех UI projections и каждой Alembic revision.
Не проверялись реальные retention-delete и архивы; их запуск не разрешён этой задачей.
Приоритет: DSCAN-01, затем JSON/identity; спорные resource/perf выводы сначала воспроизводить на test data.
Деплой, restart, изменение ключей и migrations потребуют отдельного согласования.
