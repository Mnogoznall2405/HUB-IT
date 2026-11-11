# 07. HUB Assistant, AI tools, shared LLM и OpenCode

Дата: 2026-11-02. Режим: read-only код и изолированные проверки; изменён только этот отчёт.
Итог: восемь находок в обычном AI runtime и интеграции gateway. Два механизма подтверждены диагностическими harness; 30 существующих тестов прошли.
Основные риски: противоречивый результат confirm/cancel, недоступные дополнительные карточки, голодание восстановления результата, долгие транзакции при чтении вложений.
Это выборочная глубокая проверка критических путей, не построчное доказательство корректности всех AI tools.

## Границы двух модулей

- Обычный HUB Assistant: `ai_chat/service.py`, `action_cards.py`, `tools/*`, `access.py`, `memory.py`, `retrieval.py`.
- HTTP: `WEB-itinvent/backend/api/v1/chat/ai.py:325` и `:348` — подтверждение/отмена карточки; обычная отправка сообщения затем вызывает очередь AI.
- Worker: `WEB-itinvent/start_ai_chat_worker.py:63` — отдельный цикл, concurrency по умолчанию 2, верхняя граница 16; batch по умолчанию 4.
- Хранение: APP — боты, персональный доступ, mapping, runs, pending actions, память и индекс KB; CHAT — сообщения/вложения; между этими commit нет общей транзакции.
- LLM: `WEB-itinvent/backend/ai_chat/openrouter_client.py:1` — совместимый re-export; реальные вызовы идут через `shared/llm/client.py`.
- OpenCode: отдельный `ai_sandbox/*`, Linux worker и gateway; ordinary `AppAiBotRun` для него не создаётся (`service.py:3792`).
- OpenCode не следует смешивать с обычным Assistant при расследовании отсутствующей карточки или ошибки отправки.
- Frontend обычной карточки: `ChatBubble.jsx:2119` → action UI → `useChatMessageActionsController.js:67` → API confirm/cancel → patch `message.action_card`.
- При ошибке подтверждения письма frontend пытается authoritative hydration; затем сохраняет неизвестный исход, а не автоматически повторяет отправку (`useChatMessageActionsController.js:86`).

## Путь обычного сообщения

1. `_enqueue_run`, `service.py:3741`, проверяет mapping владельца и доступ к боту.
2. Mapping и bot блокируются в APP (`:3825`), одинаковый trigger переиспользует имеющийся run (`:3867`).
3. Создаётся queued run с сохранённым effective_database_id (`:3882`).
4. `_process_single_run`, `:4531`, выбирает queued; PostgreSQL использует SKIP LOCKED (`:4544`).
5. После короткого claim run становится running, APP-сессия закрывается перед основным LLM циклом (`:4571`).
6. Пользователь перечитывается перед исполнением; деактивация и отзыв bot access проверяются (`:4601`, `:3708`).
7. `_execute_run`, `:5393`, формирует context, список доступных tools и policy черновиков.
8. `_build_conversation_context`, `:6514`, читает CHAT, APP memory state, сообщения, вложения и KB.
9. `_execute_tool_calls`, `:4990`, валидирует tools и запускает независимые группы через `asyncio.to_thread`; внутри группы до пяти вызовов.
10. `AiToolRegistry.execute`, `WEB-itinvent/backend/ai_chat/tools/registry.py:46`, проверяет enabled/admin/portal permission и Pydantic args.
11. Tool изменения создаёт pending action; сам draft не выполняет изменение.
12. Ответ сохраняется с `client_message_id=ai-run:<run_id>` (`service.py:4635`) для дедупликации.
13. Pending actions связываются с сообщением (`WEB-itinvent/backend/ai_chat/action_cards.py:961`), затем ставятся realtime/push side effects.
14. APP result получает result_message_id/result_delivery_enqueued; только потом run завершён (`service.py:4675`, `:4837`).
15. Repair раз в минуту восстанавливает отдельные окна между APP/CHAT commit без повторного LLM/tool/mail (`WEB-itinvent/start_ai_chat_worker.py:87`).

## Путь pending action

- `create_pending_action`, `WEB-itinvent/backend/ai_chat/action_cards.py:905`: owner/conversation проверяются, TTL фиксируется, замена прежнего communication draft делается условным UPDATE.
- `confirm_action`, `:2161`: инициатор проверен, pending→executing делается CAS по ID/owner/status.
- Подтверждённый payload письма фиксируется до Exchange (`:2183`); внешняя операция выполняется вне APP-сессии (`:2208`).
- Затем result сохраняется, только если current.status ещё executing (`:2316`).
- `cancel_action`, `:2341`: для обычных action пока используется read-then-ORM-update, что отличается от атомарного confirm.
- Письма имеют специальное восстановление по send ledger (`:206`), не вызывающее Exchange повторно.
- Статус completed у run, confirmed у action, наличие `message_id` и фактическая hydrated карточка — разные уровни доказательства.

## Находки

### DAI-01 — CHAT-транзакция удерживается во время OCR/LLM и KB rebuild

- Уровень: High. Доказательство: S. Трудоёмкость: M. Связано с прежним NEW-CH-01, перепроверено по текущему коду.
- Где: `WEB-itinvent/backend/ai_chat/service.py:6580`, `:6653`, `:6687`; `:7306`, `:7341`; `shared/llm/client.py:727`.
- Caller: `_process_single_run` → `_execute_run` → `_build_conversation_context` → `_extract_chat_attachment_text`/`ensure_index_fresh`.
- CHAT session уже получила соединение чтением сообщений. До выхода из `with chat_session()` выполняется извлечение вложений с `openrouter_client.extract_image_text` и синхронное обновление KB index.
- Vision/network/OCR и ожидание индекса могут занимать секунды/минуты, сохраняя занятую DB connection и открытую read transaction.
- При нескольких пользователях это увеличивает pool occupancy; не утверждается, что production pool уже исчерпан.
- Исправление: внутри сессии собрать immutable metadata/путь и отсоединённые snapshot; закрыть CHAT транзакцию до extraction/index refresh.
- Приёмка: управляемо задержать image extractor; во время задержки active DB transaction для этого run отсутствует, независимый CHAT read проходит.
- Перф: до/после одинаковые N concurrent image prompts; измерить pool wait, transaction duration, p95, throughput и время vision отдельно.

### DAI-02 — cancel может перезаписать уже выигравшее confirm

- Уровень: High. Доказательство: R для механизма stale cancellation. Трудоёмкость: S/M.
- Где: `WEB-itinvent/backend/ai_chat/action_cards.py:2345`, `:2352`, `:2360`; claim confirm — `:2192`; итог confirm — `:2320`.
- HTTP callers: `WEB-itinvent/backend/api/v1/chat/ai.py:325`, `:348` запускают независимые requests.
- Сценарий: cancel читает pending; confirm делает CAS pending→executing и выполняет действие; cancel сохраняет свой stale ORM row как cancelled.
- Итог: действие уже произошло, а API/БД показывают cancelled. Подтверждение видит не-executing и не записывает реальный результат.
- Harness: реальная AST `cancel_action`; временная SQLite/SQLAlchemy; между read и mutation выполнялся настоящий CAS approving UPDATE и имитация внешнего side effect.
- Вывод: `REAL_CANCEL_RESULT={'status':'cancelled'}`, DB cancelled, `EXTERNAL_EFFECTS=['task-created']`, exit=0.
- Это не полный HTTP E2E; сериализатор сужен до статуса, внешнее создание задачи заменено контролируемым callback.
- Исправление: pending→cancelled CAS; если проиграл — перечитать authoritative action; expiry переход также не должен перезаписывать concurrent claim.
- Приёмка: concurrent confirm/cancel с barrier; один победитель, один side effect максимум, статус соответствует выполнению. Проверить также expired/confirm.

### DAI-03 — дополнительные pending cards теряются в контракте одного сообщения

- Уровень: High. Доказательство: R для attach/hydrate projection. Трудоёмкость: M, публичный контракт требует отдельного решения.
- Где: `WEB-itinvent/backend/ai_chat/action_cards.py:968`, `:976`, `:1025`, `:1035`; frontend `ChatBubble.jsx:2119`.
- `attach_run_actions_to_message` связывает все actions run с одним answer message; `get_action_cards_for_messages` оставляет только самую новую строку на message_id.
- Создание нескольких task/works actions не имеет общего ограничения «один action на run»; tool rounds допускают несколько draft requests.
- Harness реальных AST attach/read с двумя rows: attached=[first-task, second-task], hydrated={'m':second-task}; exit=0.
- Первая карточка остаётся pending в APP, но обычный контракт message.action_card не даёт её подтвердить в этом сообщении.
- Транспорт и UI всё ещё singular; нельзя исправить только порядок сортировки — тогда скрывается другая карточка.
- Варианты решения: по отдельному сообщению на action либо согласованный массив action_cards с совместимым singular fallback.
- Приёмка: два разных действия в одном запросе доступны по отдельности после realtime, reload и hydration; confirm одного не скрывает другое.

### DAI-04 — repair голодает на последних уже исправных 50 runs

- Уровень: High. Доказательство: S. Трудоёмкость: M.
- Где: `WEB-itinvent/backend/ai_chat/service.py:4345`, `:4347`, `:4355`; запуск `WEB-itinvent/start_ai_chat_worker.py:87`.
- Query выбирает последние 50 running/completed/failed за сутки до проверки result_delivery_enqueued.
- Если у 50 более новых runs доставка уже завершена, они всё равно занимают всю выборку; Python сразу skip-ает их.
- Более старый run с отсутствующим result_message/card/realtime delivery ни на одном цикле не попадёт в repair, затем выйдет за cutoff суток.
- Это не ограничение только batch throughput: набор кандидатов не продвигается при успешном skip.
- Исправление: durable delivery-state/нуждающиеся кандидаты в SQL либо keyset-pagination с ограничением полного прохода и next cursor.
- Приёмка: один старый broken run + 60 новых healthy; repair достигает старого за ограниченное число циклов, не вызывает LLM/tools/send повторно.
- UI-проверка: карточка появляется после reconnect/reload без нового пользовательского «отправь ещё раз».

### DAI-05 — отзыв отдельного portal permission не обновляет tool context активного run

- Уровень: High. Доказательство: S. Трудоёмкость: M.
- Где: `WEB-itinvent/backend/ai_chat/service.py:5405`, `:5408`, `:3708`; `WEB-itinvent/backend/ai_chat/tools/registry.py:70`; `WEB-itinvent/backend/ai_chat/tool_permissions.py:150`.
- User payload загружается один раз в начале `_execute_run`; registry повторно проверяет разрешение по этому же snapshot.
- `_raise_if_run_cancelled` перечитывает bot access/активность, но не заменяет tool_context.user_payload свежими portal permissions.
- Если администратор снимает database.read, оставляя chat.ai.use и bot доступ, последующий tool round продолжит читать ITINVENT по старому payload.
- Деактивация пользователя и полный отзыв bot access — отдельные пути, они здесь не объявлены сломанными.
- Исправление: перед tool boundary получить актуальный минимальный authorization snapshot/версию; не держать DB transaction на внешнем выполнении.
- Приёмка: остановить run до второго tool, снять только domain permission; tool не вызывается, данные не попадают в ответ/result trace.
- Для подтверждения действия HTTP current_user также является request snapshot; не обещать моментальную отмену уже начатого внешнего эффекта.

### DAI-06 — вложенные provider retries не имеют общего wall-clock budget

- Уровень: Medium. Доказательство: S. Трудоёмкость: M.
- Где: `shared/llm/client.py:80`, `:450`, `:474`, `:481`, `:648`, `:674`; обычный worker — `WEB-itinvent/start_ai_chat_worker.py:116`.
- OpenAI создаётся без явного max_retries; локально установленный SDK имеет DEFAULT_MAX_RETRIES=2 (`openai/_constants.py:10`).
- Внешний `_with_transient_retry` по умолчанию делает три попытки. На совпадающих retryable transport ошибок один logical completion может сделать до девяти HTTP attempts.
- Strict JSON fallback способен запустить ещё один внешний retry-cycle; точное число зависит от типа ответа и повторов SDK, не каждая ошибка даёт максимум.
- timeout применяется к каждому запросу; общий elapsed deadline и cancellation между внутренними SDK retries в gateway не заданы.
- Последствие: стоимость и задержка могут превосходить ожидаемый «один timeout»; token-budget не ограничивает это wall time.
- Исправление: один владелец retry policy, явный max_retries SDK, общий monotonic deadline и классификация ошибок; сохранить safe fallback только для поддерживаемого schema отказа.
- Приёмка: scripted transport с timeout/429/503/schema error считает реальные попытки и общее время; число вызовов и elapsed укладываются в согласованный бюджет.

### DAI-07 — ordinary AI queue не имеет явного ограничения backlog

- Уровень: Medium. Доказательство: S, риск перегрузки, не измеренный production инцидент. Трудоёмкость: M.
- Где: `WEB-itinvent/backend/ai_chat/service.py:3823`, `:3867`, `:3882`; `WEB-itinvent/start_ai_chat_worker.py:67`, `:116`.
- Под lock mapping проверяется дедупликация одинакового trigger, но не размер очереди distinct сообщений на пользователя/беседу/global.
- Worker concurrency ограничена; при поступлении новых запросов быстрее LLM throughput durable queued rows продолжают накапливаться.
- Watchdog opt-in, default off (`WEB-itinvent/start_ai_chat_worker.py:70`); он не заменяет admission и по возрасту может отклонить законно ожидающие queued runs.
- Chat transport rate limit не означает ограничение накопленного AI backlog при медленном provider.
- Исправление: явный bounded admission/очередность по пользователю, отличать queued wait timeout от running liveness, понятный queue_full/Retry-After.
- Приёмка: slow provider + burst разных prompts; память/rows/queue wait ограничены, принятые prompts не исчезают и отказы видны пользователю.

### DAI-08 — crash после не-mail side effect оставляет executing без reconciliation

- Уровень: High. Доказательство: S. Трудоёмкость: L для устойчивой идемпотентности нескольких подсистем.
- Где: `WEB-itinvent/backend/ai_chat/action_cards.py:2208`, `:2253`, `:2265`, `:2316`; mail-only reconcile `:206`.
- Claim executing committed до task/chat/transfer side effect; его результат фиксируется отдельной APP transaction после завершения.
- Если процесс падает после внешнего/domain commit и до result commit, action остаётся executing; confirm повторно лишь возвращает статус, cancel его не завершает.
- Mail имеет ledger reconcile, но эквивалентного общего восстановления для non-mail actions в просмотренном пути нет.
- Например task creation получает payload/current_user без action id (`:2066`), поэтому recovery не имеет устойчивого correlation ключа созданной задачи.
- Исправление: action execution intent с idempotency/correlation key у конкретного domain service и status-check recovery; не автоматический resend/reexecute.
- Пока исход неизвестен — явный outcome_unknown с инструкцией проверки, а не confirmed/failed с ложным смыслом.
- Приёмка: crash injection после task/chat commit; recovery находит одну созданную сущность и закрывает action без второго side effect.

## OpenCode: проверенные защитные границы

- `WEB-itinvent/backend/ai_sandbox/worker.py:112`: отдельные состояния claimed/running/waiting_permission/finalizing/cleanup_pending; не переиспользует ordinary runs.
- Heartbeat в отдельном thread раз в 30 с (`:168`), finalize требует сохранённого finalization intent (`:236`).
- При feature-off worker не исполняет новую работу, но восстанавливает cleanup с allow_requeue=False (`:120`).
- `WEB-itinvent/backend/ai_sandbox/app_service.py:1716`: результат scope проверяется через job/session/user и активный статус под row lock.
- Output union ограничен; attached metadata нельзя заменить другими bytes/hash (`:1749`, `:1770`).
- `finalize_worker_result`, `:1800`: все outputs должны уже быть attached, сообщения имеют стабильный UUID5; финализация не делает успех до завершения файлов.
- `WEB-itinvent/backend/ai_sandbox/gateway.py:135`: bearer ограничен job/session/user, TTL не дольше deadline, request budget максимум 128.
- `shared/llm/openai_gateway.py:123`: ограничения messages/tools/поля, общий сериализованный input cap и forced_model.
- Empty tool_calls отбрасываются перед provider (`:173`): прежнюю provider-400 причину не следует повторять как текущий дефект.
- Поток SSE выдаётся без буферизации полного ответа (`:207`).
- Полный Linux/Podman runtime, quota helper и сетевые политики в этой проверке не запускались; их наличие не доказывает активное состояние production.

## Матрица сценариев и проверки

| Сценарий | Наблюдение | Граница |
|---|---|---|
| Confirm/confirm одной pending action | CAS есть | Полный concurrent HTTP сценарий не запускался |
| Confirm/cancel | DAI-02 воспроизведён | Реальный cancel + SQLite interleaving, внешняя операция заменена |
| Две карточки одного run | DAI-03 воспроизведён | Реальные attach/read запросы, serializer narrowed to IDs |
| Unknown mail send | Ledger status-check, fail-closed, auto-resend не найден | Exchange не вызывался |
| Watchdog против concurrent completed/refreshed run | Существующие 10 тестов прошли | SQLite, не PostgreSQL locks |
| Retry last run, concurrent retry | Существующие 10 тестов прошли | SQLite BEGIN IMMEDIATE эмулирует row lock |
| Формы recipient от модели | 10 тестов нормализации прошли | Не проверка реальных адресатов/доставки |
| Отзыв domain permission посреди run | DAI-05 статически прослежен | Нужен boundary delayed-tool сценарий |
| Broken delivery вне последних 50 | DAI-04 алгоритмически подтверждён | Нужен fixture 61+ runs |
| Сбой после task commit | DAI-08 статически прослежен | Нужен crash injection и authoritative status check |

Запуск: `python -m pytest -q tests/test_ai_run_watchdog.py tests/test_ai_run_retry.py tests/test_ai_mail_draft_recipients.py`.
Окружение перед запуском: APP_ENV=development, live APP opt-in=0, SCAN_DATABASE_URL пустой, CHAT_REALTIME_TRANSPORT=local.
Fixtures прочитаны: используют временные SQLite и monkeypatch публикации; LLM/Exchange не вызывались.
Результат: **30 passed, 4 warnings, 32,62 с, exit=0**.
После assertions pytest atexit получил WinError 5 при cleanup старого pytest-current вне репозитория. Это отдельное ограничение очистки окружения.
Оба диагностических harness завершились exit=0, временные SQLite удалены; никакие production models/config не импортировались harness.

## Производительность и необходимые измерения

- Лимиты tool rounds 1–12 и calls/round 1–5 присутствуют (`WEB-itinvent/backend/ai_chat/tools/context.py:309`). Это ограничивает число tools, но не длительность каждого.
- История CHAT ограничена 20 DB/render messages и 200 older summary rows (`service.py:198`, `:6591`, `:6618`).
- Attachment text cache ограничен числом записей (`service.py:7347`); общий вес строк/bytes отдельно не ограничен — измерить до объявления утечки.
- Выборка восстановления ограничена, но DAI-04 показывает отличие bounded batch от корректного обхода backlog.
- Baseline: очередь wait p50/p95/p99, LLM request attempts, provider elapsed, pool wait/transaction duration, tool timings, repaired/eligible/skipped deliveries.
- Сценарии объёма: 1/2/8 пользователей; 0/1/5 изображений; 1/60/500 repair candidates; одинаковая история и scripted provider latency.
- Production нагрузка и p95/p99 не измерялись. Синтетические результаты не переносить на SQL Server/PostgreSQL без оговорки.

## Отвергнутые упрощённые выводы

- «LLM весь выполняется внутри APP transaction» неверно: основной worker закрывает APP claim до `_execute_run`; DAI-01 относится к вложенному CHAT-context пути.
- «Repeat confirm всегда повторяет письмо» неверно: есть pending CAS и send ledger; DAI-08 отдельно для non-mail crash-gap.
- «Bot access фильтруется только в UI» неверно: registry и access.py имеют server checks; DAI-05 касается устаревшего domain-permission snapshot.
- «Результат с completed обязан уже показывать карточку» неверно: APP, CHAT и side effects отдельны; проверять hydration и delivery markers.
- «Repair повторно вызывает LLM» не подтверждено: его путь только восстанавливает сообщение/cards/delivery со стабильными идентификаторами.
- «OpenCode использует обычный unrestricted LLM endpoint» неверно: отдельный gateway forced_model, scoped grants и caps.

## План закрытия и точное покрытие

1. DAI-02: CAS отмены/expiry, concurrent approve/cancel test, authoritative read после проигрыша.
2. DAI-03: согласовать singular/plural карточки; boundary two-action delivery/reload test.
3. DAI-04: корректная выборка repair и проверка 60 healthy + old broken без повторного выполнения.
4. DAI-01: закрыть DB session до внешнего I/O, сравнить pool/latency baseline.
5. DAI-05: fresh authorization перед каждым tool boundary, revoke-between-rounds test.
6. DAI-08: по типам действий durable keys и reconciliation; unknown outcome запрещает автоматический replay.
7. DAI-06/07: единый deadline/retry budget и admission с измерением queue wait.

Прочитаны relevant spans: AGENTS.md; текущий общий аудит; ai_chat/service.py (enqueue/cancel/progress/process/repair/tools/context/attachments); action_cards.py (create/attach/read/confirm/cancel/mail reconcile); access.py; tool_permissions.py; tools/registry.py; tools/context.py; draft_policy.py; memory.py (контракты/первая часть); retrieval.py (index lifecycle/первые стадии); openrouter_client.py; shared/llm/client.py (retry/build/stream/vision); openai_gateway.py; start_ai_chat_worker.py; ai_sandbox/worker.py, app_service.py (record/finalize), gateway.py и начало sqlalchemy_repository.py; frontend action/hydration spans; fixtures и названные тесты.
Не прочитаны построчно все tool implementations, полный memory/retrieval, artifact formats, sandbox executor/control/policy/runtime и все frontend OpenCode панели. Эти части требуют отдельной сверки перед изменением соответствующего поведения.
Новые тесты/исправления не добавлялись. Код, схема, конфигурация и production не менялись. Деплой этого отчёта не нужен.
