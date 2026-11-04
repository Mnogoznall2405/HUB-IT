# 08. Почта и Exchange

Дата основного прохода: 2026-11-02; актуализация: 2026-11-03.
Режим: read-only исходники; изменения только этого отчёта и соседнего 09-docflow-directory.md.
Итог: семь открытых находок; прежняя потеря ContextVar устранена внешним изменением и исключена из открытых дефектов.
Главные риски: повтор письма после неизвестного результата, ложный failed после успешного EWS, обход ограничения concurrency через отмену HTTP-запросов.
Ни Exchange, ни SMTP, ни production DB не вызывались; реальные письма не создавались.
R = механизм воспроизведён изолированно; S = подтверждён текущим кодом; H = гипотеза, требующая отдельного измерения.
Severity обозначает последствия сценария, а не утверждение о наблюдаемом production-инциденте.

## Карта fullstack и ответственности

1. `WEB-itinvent/frontend/src/pages/Mail.jsx` собирает экран из отдельных контроллеров списка, mailbox и compose.
2. `components/mail/useMailListDataController.js` и `useMailViewRefreshController.js` отвечают за чтение и обновление UI.
3. `WEB-itinvent/frontend/src/components/mail/useMailQuickReply.js:45` формирует быстрый ответ, ставит локальный sending lock и сохраняет ключ операции.
4. `WEB-itinvent/frontend/src/api/mailCompose.js:71` отправляет JSON, `:80` — multipart; ключ передаётся заголовком Idempotency-Key.
5. `WEB-itinvent/backend/api/v1/mail.py:1782` принимает JSON send, `:2014` — multipart, `:2177` — IT request.
6. Dependency `get_current_mail_user`, `mail.py:187`, проверяет mail.access и устанавливает session context.
7. `_run_mail_send_call`, `mail.py:347`, ограничивает HTTP-ожидание и классифицирует timeout как неопределённый исход.
8. `_run_mail_instrumented`, `mail.py:434`, использует semaphore; `_run_in_mail_executor`, `:179`, отправляет sync EWS в отдельный executor.
9. `WEB-itinvent/backend/services/mail_service.py:4803` разрешает пользователя, mailbox, credentials, recipients, вложения и compose plan.
10. `WEB-itinvent/backend/services/mail_account_profile_resolver.py:41` получает пароль primary_session через текущую auth-сессию.
11. `WEB-itinvent/backend/services/mail_service.py:4689` резервирует persistent send ledger до внешней отправки; `:4776` записывает завершение отдельно.
12. `WEB-itinvent/backend/services/mail_send_pipeline.py:79` формирует Exchange Message/reply и вызывает EWS send.
13. `WEB-itinvent/backend/services/mail_send_idempotency.py:235` хранит состояние операции в APP через короткие app_session.
14. `WEB-itinvent/backend/services/mail_runtime_cache.py:89` хранит process-local snapshots; shared snapshots имеют отдельный store.
15. `mail.py:971` читает bootstrap snapshot и при stale запускает фоновое обновление, сохраняя быстрый путь открытия.

## Инварианты и границы атомарности

- Один ключ означает один неизменный payload в пределах user + mailbox; иной payload должен давать conflict.
- Успешный EWS нельзя превращать в «не отправлено» из-за последующей ошибки локального cache/log/store.
- Потеря ответа после передачи запроса Exchange означает unknown, пока отсутствие отправки не доказано.
- Повтор unknown допускает только проверку статуса; обычный resend создаёт риск дубликата.
- Таймаут HTTP/отмена asyncio не отменяет выполняющийся SOAP-вызов в Python thread.
- Admission limit должен ограничивать реальные выполняющиеся и ожидающие операции, включая отменённых клиентов.
- APP ledger и Exchange не имеют общей транзакции: обязательна явная модель неизвестного результата.
- Credentials primary_session требуют переноса ContextVar в executor; пользовательский mailbox scope нельзя терять.
- Данные письма и вложений не должны выводиться в диагностический отчёт или логи harness.
- Приватные mailbox snapshots должны инвалидироваться адресно, а не refetch всего экрана.

## Открытые находки

### DMAIL-01 — неизвестный EWS-исход записывается как retryable failed

- Severity: High; доказательство S; статус NEW текущего углублённого прохода.
- Источник: `WEB-itinvent/backend/services/mail_send_pipeline.py:197-202`, native reply `:241-247`; caller `WEB-itinvent/backend/services/mail_service.py:4898-4917`.
- Ledger retry: `WEB-itinvent/backend/services/mail_send_idempotency.py:364-376` переводит failed обратно в processing и возвращает proceed.
- Сценарий: Exchange принял send, но соединение оборвалось до ответа; pipeline оборачивает это как MAIL_SEND_FAILED.
- Service вызывает complete_failed без различения этапа сбоя; следующий тот же ключ снова получает разрешение отправить.
- Это отличается от безопасного expired processing → unknown: ошибка транспорта переводит запись в другую ветку.
- Исправление: разделить pre-send validation failure и unknown после начала внешней мутации; unknown не возвращает proceed.
- Acceptance: mock EWS фиксирует принятие сообщения и затем рвёт ответ; два HTTP submit с одним ключом дают один EWS send.
- Дополнительно: неизвестный исход должен пережить рестарт, а status-check не должен вызывать send pipeline.

### DMAIL-02 — локальная ошибка после успешного send разрешает повторную отправку

- Severity: High; доказательство S; источник `WEB-itinvent/backend/services/mail_service.py:4933-4979`, caller `mail.py:1792` / `:2056`.
- После успешного pipeline service пишет локальный outgoing log, инвалидирует cache и только затем фиксирует sent в ledger.
- Любое исключение в этом блоке попадает в `:4967`, где ledger становится failed; API сообщает Failed to send message.
- Сценарий воспроизводится архитектурно без отказа Exchange: EWS send вернул успех, а APP/log write завершился ошибкой.
- `complete_failed` разрешает следующий retry по DMAIL-01, хотя сообщение уже отправлено.
- Исправление: сохранить факт внешнего успеха перед необязательными side effects; сбой их записи не означает failed send.
- Acceptance: после успешного EWS искусственно сломать log/cache; повтор того же ключа не вызывает второй send.
- Если durable sent checkpoint недоступен, вернуть unknown и выполнять reconciliation вместо повторной мутации.

### DMAIL-03 — отмена HTTP освобождает semaphore раньше завершения EWS

- Severity: High; доказательство R; источник `mail.py:434-461`, executor `:166-184`; caller `_run_mail_send_call:352`.
- Async context освобождает permit при CancelledError; выполняющийся thread продолжает SOAP, что отмечено самим комментарием.
- Harness извлёк реальные `_run_mail_instrumented`, `_run_mail_call_timed_sync`, `_run_in_mail_executor` через AST.
- При semaphore=1, executor=4 и четырёх отменах после начала callable получено `actual_peak_running_workers=4`.
- Следовательно, semaphore ограничивает ожидающих клиентов, но не реальную concurrency внешних операций после отмены.
- ThreadPoolExecutor ограничивает workers, однако стандартная очередь submit не имеет admission ceiling.
- Исправление: привязать permit к завершению concurrent future; ограничить очередь, а не только coroutine wait.
- Acceptance: 100 cancel/timeout запросов к медленному локальному callable; running≤limit, queued≤budget, permits возвращаются после завершения.
- Это локальный механизм перегрузки; значения production queue depth/RSS/p95 не измерялись.

### DMAIL-04 — конкурентный retry failed ledger не имеет атомарного claim

- Severity: High; доказательство S; источник `WEB-itinvent/backend/services/mail_send_idempotency.py:250-258`, `:334-376`; caller `WEB-itinvent/backend/services/mail_service.py:4740`.
- Начальный INSERT защищён UNIQUE и обработкой IntegrityError; повтор существующей failed-записи идёт через обычный SELECT.
- Два процесса могут прочитать failed до первого commit, каждый обновить status=processing и каждый вернуть proceed.
- Обычный ORM UPDATE по PK не проверяет исходный status и ownership token.
- Параллельный тест начального claim (`tests/test_mail_send_idempotency.py:243`) не доказывает безопасность failed→processing.
- Исправление: CAS UPDATE status/версии с rowcount=1 либо SELECT FOR UPDATE внутри короткой транзакции.
- Acceptance: существующая failed-запись, два независимых DB session, barrier после чтения; ровно один proceed и один send.
- На PostgreSQL сценарий требует отдельного test DB; в production он не исполнялся.

### DMAIL-05 — IT request не передаёт idempotency key до общего send

- Severity: Medium; доказательство S; source `WEB-itinvent/backend/services/mail_service.py:5468-5510`, callers `mail.py:2177` и `:2195`.
- Маршруты IT request и метод `send_it_request` не принимают/не прокидывают ключ, хотя общий send поддерживает его.
- Метод генерирует письмо по шаблону и вызывает send_message без idempotency_key/require_idempotency.
- `_claim_send_idempotency`, `WEB-itinvent/backend/services/mail_service.py:4710-4712`, возвращает None для пустого ключа даже при включённом feature flag.
- Следовательно, именно этот путь обходит ledger независимо от флага; runtime значение feature flag не читалось.
- Исправление: один контракт ключа от UI через оба IT маршрута до send_message, включая multipart.
- Acceptance: double click, timeout и повтор запроса IT-шаблона с тем же ключом создают не более одной внешней отправки.

### DMAIL-06 — native reply теряет correlation Internet-Message-ID

- Severity: Medium; доказательство S; источник `WEB-itinvent/backend/services/mail_send_pipeline.py:177-198`, `:204-247`; caller `WEB-itinvent/backend/services/mail_service.py:4902-4904`.
- Ledger генерирует internet_message_id и передаёт его pipeline для последующей идентификации внешней операции.
- В обычной ветке ID присваивается Message перед send; native threaded reply отправляется раньше этой ветки.
- `_send_threaded_reply` не принимает internet_message_id и не назначает его reply.
- После неизвестного результата ledger-ID нельзя считать надёжным идентификатором письма в Sent для всех путей отправки.
- Исправление: единая поддержка correlation для native reply либо явная capability/alternative reconciliation key.
- Acceptance: JSON reply, multipart reply и standalone send сохраняют одну устойчивую связь ledger↔реальный EWS message.
- Сам по себе этот пункт не доказывает автоматического дубля: опасность возникает при восстановлении неизвестного исхода.

### DMAIL-07 — клиентская отмена отправки классифицируется как «не отправлено»

- Severity: Medium; доказательство S; `WEB-itinvent/frontend/src/components/mail/mailSendOutcome.js:69`; caller `WEB-itinvent/frontend/src/api/mailCompose.js:122-126`.
- `ERR_CANCELED` без HTTP response возвращает NOT_SENT, хотя multipart поддерживает AbortSignal и серверный thread мог уже начать EWS.
- Это противоречит backend модели DMAIL-03: abort прекращает ожидание клиента, а не подтверждает отсутствие отправки.
- Исправление: отличать cancellation до submit от cancellation после передачи; последний исход считать unknown/maybe_sent.
- Acceptance: отменить отправку после server-side send-start; UI не сообщает однозначно «Письмо не отправлено» и не делает автоматический resend.
- Сетевой browser сценарий не запускался; подтверждена текущая функция классификации и проводка signal.

## Перепроверенный прежний дефект

- BE-01 из первого прохода больше не открыт: `mail.py:183` вызывает `contextvars.copy_context()`, `:184` — `ctx.run(...)`.
- Ранний harness до внешней правки показывал caller=session-A / executor=None.
- Повторный harness по текущей функции показал caller=session-A / executor=session-A.
- Исправление выполнено вне этого audit-agent; ему не приписывается авторство, deployment или полная acceptance AD-почты.
- Наличие исправленного context не устраняет cancellation/permitting DMAIL-03.

## Ресурсы, транзакции и производительность

- Executor mail имеет 16 workers по умолчанию и clamp 4–64 (`mail.py:166-169`); это не ограничивает очередь памяти.
- Bootstrap snapshots и background refresh снижают холодное EWS ожидание (`mail.py:971-1034`).
- Stale snapshot выставляет state=ok для UI (`:1011`); это намеренное SWR-поведение, а не доказательство живого Exchange.
- MailRuntimeCache применяет политики размера и числа записей (`WEB-itinvent/backend/services/mail_runtime_cache.py:113-137`); переполнение не следует заявлять по одному наличию dict.
- Singleflight ожидает Event без timeout (`WEB-itinvent/backend/services/mail_runtime_cache.py:210`); зависший producer остаётся гипотезой, нужен bounded EWS budget end-to-end.
- Claim и finish ledger используют отдельные app_session; сеть не держится в одной ledger-транзакции.
- Полного аудита всех вложенных mailbox-store транзакций и всех EWS retry policies этот проход не доказывает.
- Baseline production p50/p95/p99, queue wait, thread queue depth, RSS и SOAP request count не снимались.
- После исправления DMAIL-03 сравнивать одинаковые normal/cancel/timeout потоки и объём вложений, а не единичный happy path.

## Проверки и ограничения

- AST harness ContextVar: текущий session ID сохранён; harness не импортирует backend/config и не открывает DB.
- AST harness cancellation: лимит=1, peak workers=4; только threading.Event и локальные callbacks, без EWS.
- Реальные функции извлекались целиком; подменялись instrumentation hooks и внешний callable, а не алгоритм admission.
- Существующие mail suites в этом углублении не запускались: разрешённый узкий профиль использован для DMService, см. файл 09.
- До запуска DMService прочитаны tests/conftest.py и fixtures; APP/CHAT/SCAN защищены от live URL.
- Browser/AD credential rotation, native EWS reply semantics и PostgreSQL конкурентный failed retry остаются acceptance gaps.
- Никакие команды отправки почты, просмотра .env, рестарта или деплоя не выполнялись.

## Рассмотрено и не признано самостоятельным дефектом

- Выделенный executor нужен, чтобы mail не занимал общий hub/chat pool; это оправданная изоляция.
- Для primary_session не следует возвращать хранение plaintext пароля ради починки ContextVar.
- Unknown processing lease уже не выполняет автоматический resend (`WEB-itinvent/backend/services/mail_send_idempotency.py:391-407`); проблема в других переходах.
- Начальный INSERT claim с UNIQUE/IntegrityError корректно отличается от retry существующего failed.
- Быстрый ответ сохраняет key при неуспехе (`useMailQuickReply.js:75-82`); нельзя объявлять отсутствие ключей во всём UI.
- Warning о возможно отправленном письме уже существует (`mailSendOutcome.js:22-30`); его backend ledger должен поддерживать последовательно.

## Coverage list и следующие acceptance-проверки

- Прочитаны UI Mail/quick reply, mailCompose API, mailSendOutcome, маршруты JSON/multipart/IT request.
- Прослежены executor/context/limiter, профили mailbox/session, service send, pipeline normal/native reply, persistent ledger и runtime cache.
- Из существующих тестов изучены test_mail_send_idempotency.py, test_mail_send_timeouts.py, test_mail_send_pipeline.py.
- Нужны boundary-сценарии EWS accepted→connection lost, send success→APP failure, failed→concurrent retry и cancel→permit ownership.
- Runtime Exchange throttling, все операции draft/move/delete, AI consent и MIME/HTML rendering не объявлены полностью проверенными.
- Предлагаемые исправления требуют отдельного implementation запроса; production publication и включение feature flags — отдельного согласования.
