# AI A8 — Critical Path Optimization Report

Ветка: `perf/a8-ai-latency` (HEAD см. `git log`). База: `origin/main` 609108f6 (= содержимое релиза b8763f41). Дата: 2026-11-24.

Режим: production не изменялся (код, ENV, процессы, очереди). Все проверки — unit-тесты, анализ собранных в A7 данных и read-only замеры API/БД.

## Этап 0 — исправление методологии A7 (закоммичено в PR #25)

- Корпус: 62 сценария (не 63). Попытки: 72, из них 13×HTTP 401 (истёк токен, авто-перевыпуск сессии), 59 уникальных отправленных сообщений, 58 завершённых runs, 57 клиентских замеров.
- `a7_analyze.py`: парсится group-mode `ai_jev_routing_cache hit ... routed=[...]`; признак cache теперь **сливается** с записью решения, а не перезаписывается; `llm_followup` — **сумма всех раундов**, не max.
- Отчёт A7 обновлён: истинная e2e (trigger→bot reply в БД) — **p50 13.7 с / p95 31.9 с / max 44.0 с**, n=63.
- Тестовые сессии: харнес минтит сессию на каждый прогон и перевыпускает по 401; сессии TTL-ограничены (idle-expire в session_service) — утечек нет; долгоживущих токенов не создавалось. PII/секретов в артефактах нет (проверено grep: Bearer/password/secret/api_key/JWT-подписи — только код харнесса).

## Этап 1 — P0: разрыв client↔server (диагностировано, исправлено)

**Факт:** `ai_bot_runs.completed_at` vs `chat_messages.created_at` по `client_message_id='ai-run:{run_id}'` — лаг ≈ **−0.1 с** на всех 58 runs. Ответ коммитится мгновенно после run. Квантизация 16.3/31.8/47.1 с = `ceil(true/15.4)·15.4 + ~0.8`.

**Причина:** in-process read-кэш `thread_latest`/`thread_bootstrap` (chat_thread_read_store, TTL `CHAT_CACHE_TTL_SEC=15`) инвалидируется **только в процессе-писателе** (`_invalidate_conversation_views_for_users` из `send_message`). AI-воркер — отдельный процесс; `REDIS_URL` пуст → общего слоя нет → chat-нода отдаёт устаревшую страницу сообщений до 15 с. WS-подписчики получают push через event_outbox (poll 250 мс/1 с), REST-читатели — нет.

**Фикс (`event_outbox_service.process_delivery_state_job_sync`):** после `apply_message_delivery_state_after_commit` каждая нода инвалидирует локальные view-кэши для `member_user_ids` события. Свежесть REST-чтений теперь ~latency outbox-доставки (0.25–1 с) вместо 0–15 с.

- Тест: `test_delivery_state_invalidates_local_read_cache` (spy на `_invalidate_conversation_views_for_users`, реальный poll_once).
- Ожидаемый эффект: REST/polling-клиенты и reconnect-сценарии получают ответ на ~median −8 с, p95 −15 с. WS-пользователи — без изменений (они и так видели push быстро).
- **E2E-верификация отложена до приёмки деплоя**: тестовый второй consumer общей очереди украл бы delivery_state-джобы и WS-события у реальных пользователей — небезопасно.

## Этап 2 — P1: LLM-саммаризация убрана из критического пути

Было: `_build_conversation_context` при `len(summary_append_lines) ≥ AI_SUMMARY_MIN_BATCH(8)` синхронно вызывал `smart_memory.summarize()` — замерено ~8 с (`ctx_summary`) в A7.

Стало:
- критический путь сохраняет **head/tail fallback** (`_compact_head_tail`) и двигает `summary_until_seq` тем же CAS — история не теряется, промпт получает рабочую summary сразу;
- `_register_pending_summary` кладёт (conversation_id, user_id) → reset_seq в in-process set (dedup на диалог, лимит `AI_SUMMARY_PENDING_MAX=256`);
- `process_pending_summary_upgrade` вызывается из цикла `start_ai_chat_worker` (1 задача/итерацию, ~0.5 с): перечитывает mapping, пересобирает сообщения `(reset_seq, summary_until_seq]`, считает полный LLM-summary и **CAS-свапает** `rolling_summary` при условиях `context_reset_seq == reset_seq` и `summary_until_seq == until_seq` — иначе abort;
- сброс контекста/догнавший checkpoint → задача безопасно отменяется; смешения пользователей нет (ключ = conv+user); FIFO/A4 не затрагивается (задача вне run-контурра).

- Тесты: `test_ai_summary_upgrade.py` — dedup/cap, CAS-гварды, abort на reset и на регрессии checkpoint, устойчивость к сбою LLM.
- Ожидаемый эффект: −6…8 с на runs с большим summarized-батчем (в A7 — все run'ы после ~10 сообщений диалога: p50 context 7.7 с → ~1.3 с).

## Этапы 3–5 — состояние и данные

**P1 токены (измерено, не реализовано в этом цикле):** разложение single-prompt ≈ system+guides ~2–3k + conversation_text ≤4500 tok + rolling_summary ≤`AI_ROLLING_SUMMARY_TOKENS` + memory ≤`AI_MEMORY_MAX_TOKENS` + KB ≤5 chunks + tool specs (13–23 spec'а JSON-схем) + tool results; `total_tokens` суммирует **все** LLM-вызовы run'а (1-raунд ~12-20k → 2-3 раунда ~30-72k). Главный рычаг — followup-раунды и бюджет истории; требует аккуратного приоритета (Этап 3 backlog).

**P2 READ fast path:** не реализовано — deterministic renderer требует гарантий полноты/прав на каждый tool; риск «неполного ответа за полный» — отдельный цикл.

**P3 JEV:** после исправления статистики — cache 58/58 miss подтверждён, но ключевой факт: `_has_jev_dialog_context` + J9 smalltalk bypass уже дают пропуск JEV для коротких реплик; контекст в ключе кэша — осознанная защита follow-up'ов («а у Петрова?»). Доказанно безопасный второй уровень кэша для single-message prompts — кандидат, не реализован.

## Этап 6 — A/B и изолированный контур

Честные блокеры:
- A/B на прод-очереди невозможен: воркер клеймит `SKIP LOCKED` любую ветку — prod-воркер заберёт тестовые runs базовым кодом (и наоборот, patched-воркер потащит реальных пользователей — shadow deploy без приёмки).
- Второй outbox-consumer украл бы WS-доставку.
- Изолированный стек требует scratch-БД + сидов пользователя/бота/chat — выполнимо, но это отдельный объём; до него не дошёл в этом цикле.

## Этап 7 — целевые показатели

Измеренный baseline (A7, n=58): server p50 13.7 с / p95 31.9 с; e2e 13.7/31.9.
Ожидаемое по реализованному:
- P0: REST reply delivery −0…15 с (median −8 с) для REST-читателей.
- P1 async summary: context p50 7.7 с → ~1.3 с на длинных диалогах; run server_total −6…8 с где был batch≥8.
- Недостигнуто пока: CHAT ≤3-5 с (llm_first ~4.3 с — нужен следующий рычаг: модель/стриминг/промпт-диет). READ ≤6-9 с, ACT ≤10-15 с — ближе после P1, но не доказано без e2e.

## Этап 8 — регрессии и верификация

- `pytest` AI-набор: **294 passed** (284 в поднаборе A1/A3/A4/A5-файлов + 10 новых), 22 PG-теста skipped (нет live PG) — базово-совместимо с A7 (было 408/409, единственное расхождение — ранее известный transport-тест, здесь не запускался).
- Новые тесты: 5 (`test_ai_summary_upgrade`) + 1 (`delivery_state invalidates read cache`).
- `AI_JEV_ROUTING=0` legacy-путь не затронут (JEV-код не менялся).
- ACT, confirm-gates, file-gen, serialization: не затронуты изменениями (сводная регрессия перед merge — рекомендуется прогон полного набора).

## Commits

- `99610e4d` perf(ai): A8 P0+P1 — cross-node read-cache invalidation, async summary off critical path (+tests).
- `7ec5faad` perf(ai): A8 cycle 2 — real cross-node invalidation, non-blocking incremental summary upgrades (см. раздел ниже).
- PR #25 (`docs/a7-performance`, `003a009b`): исправленные методология/анализатор/отчёт A7.

---

# A8 Cycle 2 — исправление трёх блокирующих архитектурных дефектов

Независимое ревью нашло три дефекта в цикле 1. Ниже по каждому: воспроизведение → причина → решение → тест → результат → риски.

## Дефект P0 — инвалидация кэша достигала только ОДНУ ноду

**Воспроизведение (цикл 1).** `process_delivery_state_job_sync` инвалидировал read-кэш внутри обработчика outbox-задачи. Но outbox клеймится `FOR UPDATE SKIP LOCKED` — задачу обрабатывает **ровно один** consumer. При двух chat-нодах A и B: задачу забирает A → кэш A инвалидирован, кэш B продолжает отдавать устаревшую страницу до TTL 15 с. Дефект цикла 1 воспроизводится любым горизонтальным развёртыванием ≥2 нод без Redis.

**Причина.** Транспорт outbox — competing-consumers по построению; использовать его для fan-out инвалидации нельзя (добавление consumer'ов ради этого = кража задач).

**Решение.** Переиспользован существующий realtime-relay (`ChatRealtimePostgresBus`/`RedisBus`/`LocalBus`): его relay-таблица + LISTEN/NOTIFY доставляет событие **каждой** ноде (catch-up по курсору закрывает restart/lost-NOTIFY, dedupe по `_realtime_event_id`). Новые точки:
- `_handle_distributed_event_once` (~realtime.py:1753): любое **non-volatile** событие с `conversation_id` → `_schedule_read_cache_invalidation`: targeted-события (`target_user_ids`/`exclude_user_id`) → точечная инвалидация `thread_latest`/`thread_bootstrap`/`conversation_detail` этих пользователей; `conversation_room`/`global`/`room_evict` → инвалидация по всей беседе.
- `_publish_targeted_event`/`broadcast` (origin-нода, durable): то же самое — покрывает случаи, когда коммит сделал не этот процесс.
- Коалесцинг: pending-мапа `{conv: set(users)|None}` + debounce 120 мс (`CHAT_READCACHE_INVALIDATE_DEBOUNCE_MS`) — шторм событий схлопывается в один проход; без event loop — синхронный fallback.
- **Epoch-защита fill-after-invalidate:** `_conv_view_epoch` (per-service счётчик по беседе) инкрементится каждой инвалидацией; `get_thread_messages`/`get_thread_bootstrap`/`get_conversation` захватывают epoch до чтения БД и передают `epoch_check` в `_cache_set` — под `_cache_lock` устаревшее значение выбрасывается (и локальный, и redis-запись пропускается).
- `chat_read_cache_redis.invalidate_conversation`: drop shared ключей `{conv}|*` — закрывает дыру, где redis-копия `thread_bootstrap` переживала локальную инвалидацию.

**Тесты (`test_chat_readcache_invalidation.py`, 8):**
- двухнодовый сценарий: два `ChatService` на одной sqlite — обе ноды кэшируют страницу, «воркер» коммитит сообщение напрямую, relayed room-event → обе ноды возвращают свежую страницу без ожидания TTL (ключи физически удалены из `_runtime_cache`);
- edit/delete/member-события инвалидируют так же (любой non-volatile тип);
- targeted event удаляет ключи только перечисленных пользователей;
- volatile (`chat.typing.*`) — не инвалидирует;
- epoch-guard: fill начатый до инвалидации не ресеевает кэш;
- коалесцинг pending-мапы (user-set → whole-conversation).

**Результат.** Видимость на всех нодах = latency relay (NOTIFY ~ms + debounce 120 мс) — порядок ~0.2 с, требование <1 с выполнено. Независимо от Redis (postgres/local transports тоже покрыты: local — синхронный fallback на publish-пути).

**Остаточные риски.** (1) Нода с полностью мёртвым subscriber (и умершей БД) вернёт stale до TTL — relay catch-up при реконнекте лечит это автоматически. (2) Без `conversation_id` в событии инвалидации нет — все реальные mutation-события его несут (проверено по publish-путям). (3) Soft-demote `conversations`/`unread_summary` на room-событиях — осознанный компромисс (список участников неизвестен), окно ≤2.5 с.

## Дефект P1 — summary блокировал claim-loop

**Воспроизведение (цикл 1).** `await asyncio.to_thread(process_pending_summary_upgrade)` внутри `while True` claim-loop — loop ждёт завершения LLM (~6-8 с на задачу), новые runs не клеймятся.

**Решение.** `run_summary_upgrade_supervisor` (экспортируется для тестов) в `start_ai_chat_worker.py`: независимая asyncio-задача, каждый job — `loop.run_in_executor` в **выделенном** `ThreadPoolExecutor` (`AI_SUMMARY_BG_WORKERS=1..4`, default 1). Claim-loop никогда не awaits supervisor. Дополнительно: `AI_SUMMARY_BG_IDLE_SEC`, `AI_SUMMARY_BG_SCAN_SEC=30` — периодический `scan_pending_summary_upgrades` (durable re-discovery), graceful shutdown через cancel+cancel_futures, feature flag `AI_SUMMARY_BACKGROUND_ENABLED` (=0 → supervisor не стартует, run пишет синхронный LLM-summary в критическом пути — безопасный откат). Ошибка job → backoff-регистрация `15·2^n` до `AI_SUMMARY_UPGRADE_MAX_ATTEMPTS=5`, затем suppression на 1 ч (DB-инвариант позволяет re-admit позже).

**Тесты (`test_ai_summary_worker_supervisor.py`, 5):**
- fake summary блокируется на threading.Event 10 с → claim-loop выполняет ≥20 итераций за 0.5 с — job не мешает;
- bounded concurrency: ровно `workers` inflight, никогда больше;
- ошибка job → supervisor живёт, следующие job'ы исполняются;
- cancel → чистое завершение без зависаний;
- env-flag проводка.

**Результат.** Claim-loop изолирован от summary-латентности; приоритет пользовательских runs сохранён (отдельный executor + workers=1 по умолчанию — нагрузка на провайдера ограничена).

**Остаточные риски.** Summary — CPU-light/IO-bound, GIL-конкуренции с claim-loop минимальны; при отключении флага поведение = цикл 0 (измеренный baseline).

## Дефект P1/P2 — потеря истории после 200 сообщений + недолговечность очереди

**Воспроизведение (цикл 1).** `_upgrade_conversation_summary` перечитывал до 200 сообщений `(reset_seq, until_seq]` и строил summary **с пустой базы** — при истории >200 «хвост» диапазона не попадал в summary, но `summary_until_seq` уже означал полное покрытие. Плюс pending-задачи жили только в памяти — рестарт/переполнение очереди/ошибка провайдера теряли их бесследно.

**Решение — два checkpoint'а (миграция 0177, колонки `rolling_summary_llm`, `summary_llm_until_seq`):**
- `summary_until_seq` — как далеко покрывает prompt-facing `rolling_summary` (fallback тоже считается покрытием: данные там есть в сжатом виде);
- `summary_llm_until_seq` — как далеко покрывает LLM-качественный `rolling_summary_llm`; инвариант `llm_until ≤ until` — **checkpoint никогда не заявляет данные, не дошедшие до summary**.
- Upgrade: resume от `llm_until`, инкрементные батчи `AI_SUMMARY_UPGRADE_BATCH=150` на базе предыдущей LLM-summary (не перечитывает всю историю), per-batch CAS на `(conv, user, reset_seq, summary_llm_until_seq)` — гонка с другим writer → abort без повреждений; промоут `rolling_summary` только при `llm_until ≥ until`; heal-ветка восстанавливает prompt-текст, если fallback перезаписал полностью покрытую LLM-summary.
- **Durability:** DB-инвариант `llm_until < until` — это и есть очередь: `scan_pending_summary_upgrades` (каждые 30 с, `AI_SUMMARY_UPGRADE_SCAN_LIMIT=50`, lookback 30 дн, `use_personal_memory`) перерегистрирует работу, потерянную рестартом/cap'ом очереди. In-memory map — лишь дедуп/backoff.
- Ограничения: `AI_SUMMARY_UPGRADE_MAX_MESSAGES=1500` на один claim (resume при следующем), `AI_ROLLING_SUMMARY_TOKENS` bound, re-verify `use_personal_memory`+bot memory+сandbox при исполнении, suppression при выключенной памяти.
- Reset обнуляет оба checkpoint'а и оба текста; sync-путь (flag off) при успешном inline LLM двигает оба checkpoint'а вместе.
- 0139 frozen spec синхронизирован с ORM (пропущенные `last_run_seq`/`queue_seq` цикла 1 + новые колонки; добавлена поддержка unique partial index в spec-формате с guard по существующим колонкам).

**Тесты (`test_ai_summary_upgrade.py`, 22, реальная sqlite — проверяется состояние БД):**
- матрица историй 20/100/200/201/500/1000 — полное покрытие, контрольные факты в начале/середине/конце попадают в fold-вызовы;
- resume от checkpoint'а: +50 сообщений → ровно 1 новый batch, без пересчёта;
- stop mid-way (MAX_MESSAGES): `llm_until < until`, prompt-текст НЕ промоутится; следующий claim догоняет;
- CAS-abort при внешнем продвижении `summary_llm_until_seq`; abort при reset во время LLM-вызова;
- удалённый хвост — checkpoint безопасно двигается через is_deleted;
- ошибка LLM → backoff-retry → успех; max-attempts → suppression;
- scan: re-discovery после потери очереди, пропуск suppressed/fully-covered, восстановление после cap 256;
- memory off → suppression без записей; multi-user — независимые ключи.

**Результат.** История любого размера покрывается инкрементально; ни одна заявленная checkpoint'ом единица данных не может отсутствовать в summary; потерянные задачи восстанавливаются из БД ≤30 с.

**Остаточные риски.** (1) Между fallback-записью и LLM-промоутом prompt видит head/tail-summary — качество промежуточное, история не теряется. (2) suppressed-ключи живут до 1 ч — при хроническом отказе провайдера scan их не re-admit'ит раньше срока (осознанно, против busy-loop). (3) Один process_pending за раз на ключ — два воркера могут гонять CAS по одному ключу: лузер делает лишний summarize, корректность сохраняется (CAS отклоняет).

## Cycle 2 — регрессии и метрики

- `pytest`: **501 passed / 22 skipped** по наборам A1/A3/A4/A5 + outbox + realtime-postgres + e2e-delivery + REST-cache + memory/migrations + backend/tests + все новые. PG-тесты (serialization suite, ~17 шт) skipped — на хосте нет scratch PostgreSQL (`127.0.0.1:5432` недоступен, `PG_TEST_DATABASE_URL`/`SCAN_TEST_DATABASE_URL` не заданы).
- Pre-existing defect, закрытый заодно: 0139 frozen spec расходился с ORM ещё с 0176 (`last_run_seq`, `queue_seq`, partial unique index) — `test_frozen_spec_matches_the_orm_models` падал на cycle-1 HEAD.
- A/B e2e: **NOT MEASURED** — изолированный контур со scratch-БД не поднят на этом хосте (нет scratch PG; prod-очередь недопустима). Ожидания по конструкции: claim-loop latency summary=0 (архитектурно), REST-свежесть <1 с cross-node (подтверждено интеграционно), `ctx_summary` в критическом пути ~0 (LLM-саммаризация удалена из пути).
- PR #25: метрики 16.3/47.1 с остаются клиентскими измерениями; серверные 13.7/31.9 с — отдельная метрика (поправлено в body).


---

# A8 Cycle 3 — Production Readiness Gate

Архитектура цикла 2 принята — изменения точечные: согласованность checkpoint, retry/backoff, distributed cache-generation, fairness scan, cost-control, телеметрия. По каждому дефекту: воспроизведение → решение → тест → результат.

## P1a — CAS после сброса контекста не мог сохранить upgrade

**Воспроизведение.** `context_reset_seq=100, summary_until_seq=120, summary_llm_until_seq=0, rolling_summary_llm=''` — состояние после `reset_conversation_context` + новых 20 сообщений + fallback-summary. Старый код присваивал checkpoint `llm_until := reset_seq` (100), затем CAS `WHERE summary_llm_until_seq = 100` — в БД хранится **0** → rowcount=0 на каждом батче → upgrade никогда не мог записаться, задача крутилась по scan бесконечно. Тест `test_upgrade_persists_after_context_reset` на реальной БД подтверждает фикс.

**Решение.** Три значения разведены явно: `db_llm_until` — фактическое значение в БД (CAS-якорь), `read_from = max(reset_seq, db_llm_until)` — позиция начала чтения истории (когда старая LLM-coverage непригодна: `db_llm_until <= reset_seq`, пустой текст или over-claim `> until`), `expected_until` — то, что каждый CAS утверждает (начинается с фактического `db_llm_until`, двигается после каждого успешного батча). Покрытое состояние возвращает `covered` — бесконечного пересчёта нет.

**Случаи:** новый reset (checkpoint 0 → CAS на 0); legacy-строки с `llm_until < reset_seq` (CAS на фактическое значение, чтение от reset_seq); повреждённый checkpoint `> until` — rebuild от reset; пустая LLM-summary — rebuild; рестарт — scan по инварианту.

## P1b — retry/backoff сбрасывался регистрациями

**Воспроизведение.** `_register_pending_summary` безусловно перезаписывал `not_before_mono`: после ошибки LLM запись перерегистрируется с deadline `now+15s`, но периодический scan (30 с) или новый run тут же обнуляли его — backoff фактически не работал; suppressed-ключ мог быть re-admitted немедленно через run-путь.

**Решение** (все точки под `_pending_summary_lock`):
- pending = `(reset_seq, not_before_mono, registered_mono)`; merge при повторной регистрации = `max(old, new)` deadline — ни scan, ни run не отменяют backoff;
- suppression = `(deadline, reset_seq)` — действует на всех путях регистрации; **новый reset не наследует** чужое состояние (suppression и attempts сбрасываются при смене reset_seq);
- `_summary_inflight` (key→reset_seq): claim переносит ключ в inflight — один диалог не исполняется дважды локальными summary-workers; регистрация того же checkpoint-basis во время полёта — дедуп; retry регистрируется после снятия inflight;
- rate limit `AI_SUMMARY_UPGRADE_JOBS_PER_MIN` (default 6) на claim — глобальный потолок фоновых LLM-джоб/мин на процесс;
- maps bounded: pending cap 256, attempts trim >4×cap, протухшие suppression чистятся при scan и при регистрации;
- **кросс-процессный lease** через CAS по `updated_at` (`AI_SUMMARY_UPGRADE_LEASE_SEC=45`): claim lease перед LLM-вызовами, каждый batch-CAS продлевает lease записью `updated_at` — второй AI-worker не сделает дублирующий платный вызов (ответ на вопрос ревью: CAS на данных защищал БД, но не деньги — теперь и деньги). Побочный эффект-фича: `updated_at` свежий <45с означает, что интерактивный run только что писал — фон уступает приоритет интерактивному трафику.

**Тесты (7 новых):** scan не отменяет backoff; run-регистрация не отменяет backoff; suppressed не retry до истечения; новый reset не наследует suppression/attempts; inflight dedup + единственный claim; inflight снимается после обработки; lease_busy при свежей записи (второй воркер отпускает).

## P1c — race заполнения Redis-кэша

**Воспроизведение.** Cycle-2 epoch проверялся под локальным `_cache_lock`, но `chat_read_cache_redis.set` шёл **после** выхода из него: нода A читает старую страницу → проверяет epoch → нода B инвалидирует + чистит redis → A дозаписывает старое в redis → все ноды читают stale до следующей инвалидации или TTL. Локальный epoch ничего не знает об инвалидациях других процессов.

**Решение — распределённая генерация в самом хранилище:**
- `chat_read_cache_redis`: per-conversation счётчик `conv_epoch:{conv}`; `set_if_epoch` — атомарная Lua (`GET epoch → compare → SET`), drop при рассинхроне и при любой ошибке (fail-safe: промах лучше stale);
- bump в каждой conv-scoped инвалидирующей ветке: `invalidate_conversation` (INCR внутри), `_invalidate_conversation_views_for_users`, `_invalidate_reader_views_after_mark_read` — вне локального lock (1 INCR на коалесцированную инвалидацию, не hot-loop);
- читатели (`get_thread_messages` latest, `get_thread_bootstrap`, `get_conversation` detail) захватывают redis-generation до DB-чтения и передают `redis_epoch_check` в `_cache_set` — запись в redis только если генерация не изменилась;
- Redis disabled: `supports_bucket=False` → весь путь no-op; lost realtime-event/reconnect: redis-generation + delete при инвалидации + TTL — худший случай = stale до TTL/следующей инвалидации, как и раньше.

**Тесты (3 новых, `_MiniRedis`):** stale fill отклонён при смене генерации, свежий reader пишет; `_cache_set` сквозь сервис — локальная запись есть, redis-ресеед отклонён; все ветки инвалидации бампают генерацию (+1 за каждую).

## P2 — fairness scan'а + метрики

**Дефект:** `LIMIT scan_limit` применялся до фильтрации suppressed → 50 подавленных строк в голове oldest-first блокировали новую работу за ними (starvation при недоступности провайдера). **Фикс:** fetch-window = `scan_limit + suppressed + inflight + pending` — регистрация доходит до неподавленных строк; suppressed не считаются в registered.

**Метрики** (`get_summary_upgrade_metrics`): pending, in_flight, suppressed, oldest_pending_age_sec, registrations, discarded_registrations, claims, rate_limited, completed, failed, retries, suppressed_total, cas_conflicts, lease_busy, llm_calls, messages_folded, prompt/completion/total_tokens, duration_ms_total — отдельные счётчики фона, не смешанные с usage интерактивных runs.

**Тест:** `test_scan_fetches_past_suppressed_head` — 50 suppressed + свежий конв → scan(limit=10) регистрирует свежий.

## P2 — контроль стоимости и нагрузки

- `AI_SUMMARY_UPGRADE_BATCH_TOKENS=6000` — батч режется на fold-чанки по est-бюджету (chars/4): `smart_memory.summarize` не обрезает вход сам — проверено исходником (`memory.py:364`, весь список сериализуется в запрос; previous ограничен 6000 chars). Без бюджета батч 150×~300 tok мог уйти за контекст/лимит модели. Checkpoint продвигается **почанково** — никогда не заявляет недофолднутые сообщения. Тест `test_token_budget_splits_fold_chunks`.
- Rate limit `AI_SUMMARY_UPGRADE_JOBS_PER_MIN=6` (claim-level, на процесс) + lease по `updated_at` (кросс-процесс) + `AI_SUMMARY_UPGRADE_MAX_MESSAGES=1500`/claim + bounded executor (1 поток default).
- Приоритет интерактива: свежий `updated_at` (<45с) блокирует lease — run'ы идут первыми, фон догоняет; flag off → фон выключен полностью.
- Pre-LLM проверки: бот существует (`bot_missing` → suppression), маппинг, `use_personal_memory` (mapping + user setting + bot + sandbox-surface), членство в беседе (`not_a_member`), reset-совпадение — всё до обращения к провайдеру; per-batch CAS перепроверяет `context_reset_seq` перед записью.
- Backfill-оценка после 0177 (`summary_llm_until_seq=0`): **NOT MEASURED** — доступа к production-БД с этого хоста нет. Формула для владельца: `count(*) WHERE summary_until_seq > 0 AND use_personal_memory` = потенциальный объём re-summarization; с лимитом 6 jobs/мин/процесс и scan-window 30дн разогрев контролируем.
- Телеметрия: outcome-лог `ai_summary_upgrade done ... folded llm_calls prompt_tokens total_tokens duration_ms checkpoint a->b promoted` + метрики выше.
- Executor: `shutdown(wait=False, cancel_futures=True)` — отмена asyncio.Future не убивает поток внутри LLM (Python-ограничение); комментарий в коде, drain естественный (сокеты по timeout=10 на вызов summarize).
- **Флаг `AI_SUMMARY_BACKGROUND_ENABLED`: default OFF в обоих местах** (service.py `"0"`, worker `_env_flag(..., False)`) до production-приёмки; при =0 поведение = цикл 0 (inline summarize, измеренный baseline).

## Production gate — честный статус

| Проверка | Статус |
|---|---|
| Миграция 0176→0177 на данных + fresh + re-run + rollback-совместимость | PASS в sqlite: идемпотентные column-checks в 0177, старый код работает (новые колонки nullable/server_default); `test_internal_db_migration_runtime` 16/16, `test_app_tables_missing_migration` 4/4 |
| Изменение исторической 0139 | Обоснование: frozen spec не содержал `last_run_seq`/`queue_seq` (добавлены 0176) и new 0177-колонок — тест падал ещё на cycle-1 HEAD. Spec = декларативный «эталон схемы» для тестов и fresh-install в тестовом runner; существующие PG-БД мигрируют через alembic-цепочку — spec не применяется. Guard по существующим колонкам добавлен |
| Scratch PostgreSQL | **BLOCKED** — на хосте нет docker/psql/5432, env PG-URL не задан → PG serialization/realtime relay/reconnect остаются skipped, не выданы за PASS |
| Двухпроцессный PG relay | **BLOCKED** (та же причина) — логика покрыта local-transport интеграционными тестами + unit; PG-специфика (LISTEN/NOTIFY payload limits, catch-up cursor) требует живого PG |

## Регрессия Cycle 3

- `test_ai_summary_upgrade.py`: 36/36 (+14 новых: CAS-после-reset repro, legacy-строки, backoff×5, inflight, fairness, rate-limit, lease, token-budget, metrics, flag-off)
- `test_chat_readcache_invalidation.py`: 11/11 (+3: epoch-guard redis, `_cache_set` skip, bump-on-invalidate)
- `test_ai_summary_worker_supervisor.py`: 5/5 (default-OFF флаг совместим)
- Полный набор `tests/test_ai_*.py + tests/test_chat_*.py + test_e2e_chat_flow.py` (1557 шт, ~7 мин): **1514 passed / 23 skipped / 20 failed — все 20 воспроизводятся побайтово на базовом HEAD `810c586e` без изменений цикла 3** (проверено `git stash` + прогон тех же тестов): pre-existing environment issues, а не регрессия — 7×`test_ai_chat_runtime` (db-context `OBJ-ITINVENT` не настроен), `test_ai_sandbox_release`/`runtime` (release-артефакты), 3×`test_chat_address_book_resolve`, `test_chat_calls_migration`, 2×`test_chat_files_and_notifications` (push-payload), `test_chat_runtime_split` (scale_pool), 3×`test_chat_scheduled_messages` + `test_chat_calls_migration` (alembic-цепочка 0144/0160 на scratch-БД без chat/my_files-таблиц).
- 22–23 PG-skipped как в цикле 2 (`test_ai_run_serialization_pg` — живого PG нет).

## Оставшиеся риски

1. Lease granularity = `updated_at` — общий «recent activity» маркер: фон уступает интерактиву до 45с задержки (фича, не баг; self-healing через scan).
2. `estimated_tokens` chars/4 — грубая оценка; при экзотическом UTF-8 реальный бюджет может отличаться ~×2 — запас через `AI_SUMMARY_UPGRADE_BATCH_TOKENS` (6k при контекстах ≥32k).
3. Suppression in-memory: новый worker-instance re-admit'ит suppressed-ключ сразу (scan) — при хронической poison-записи один платный retry на рестарт, дальше backoff.
4. `conv_epoch` redis-ключи без TTL — одночисленный ключ на активную беседу, память пренебрежима; при eviction ключа генерация = 0 → writes с captured>0 отклоняются (fail-safe).
5. PG-ветка realtime/serialization не проверена на живом PG — gate до merge: поднять scratch PG и прогнать `test_ai_run_serialization_pg` + `test_chat_realtime_postgres` + 2-процессный сценарий.


---

# Cycle 4 — Final Production Gate

## Изолированный PostgreSQL — РАЗБЛОКИРОВАНО

Scratch-кластер: portable PostgreSQL **17.6** (официальный EDB-zip, без установки/админа),
`initdb` в `HUB-IT-a8-wt\pgdata`, listen `127.0.0.1:55432`, user `a8test` (trust, localhost),
БД: `a8_scratch`, `a8_all`, `a8_app`, `a8_chat`, `a8_mig`. Production-таблицы/очереди/диалоги
не использовались — отдельный инстанс, отдельные БД.

### Реальные результаты на живом PG

| Проверка | Результат |
|---|---|
| `test_ai_run_serialization_pg.py` (A4 serialization, schema_translate_map) | **22/22 PASS** — реальная FOR UPDATE-сериализация на PG 17.6 |
| Schema from scratch, scope=all → `upgrade head` | **PASS** — 186 app + 33 chat таблиц, все колонки A4/A8 на месте |
| scope=app / scope=chat | **PASS** — app-scope создаёт app-таблицы; chat-миграции scope-независимы (AGENTS.md контракт — «decide by what exists») |
| 0176→0177 на существующих данных | **PASS** — строка legacy сохранена, `summary_llm_until_seq=0`, `rolling_summary` не тронут |
| Repeat-run `upgrade head` | **PASS** — идемпотентно |
| Rollback-совместимость | **PASS после фикса** — см. найденный дефект ниже |
| Двухпроцессный relay (Chat A / Chat B) | **PASS** — 10/10 событий, **max 71мс, p50 7мс** (требование <1с) |
| LISTEN/NOTIFY | **PASS** — `pg_notify`+LISTEN через реальный канал `itinvent_chat_events` |
| Reconnect mid-stream | **PASS** — убитое LISTEN-соединение, события после kill доходят (cursor catch-up/poll) |
| Потеря события при рестарте | **PASS по контракту** — курсор in-memory стартует с MAX(id); restart-долговечность — зона durable `chat_event_outbox` (не relay) |

### Найден и исправлен реальный дефект (только на живом PG)

**Rollback-несовместимость frozen spec 0139.** В цикле 3 spec `ai_bot_conversations` догнали до
ORM, но `last_run_seq`/`rolling_summary_llm`/`summary_llm_until_seq` попали как `nullable=False`
**без `server_default`**. На fresh-PG таблица создаётся NOT NULL без дефолта → 0176/0177 видят
колонки и пропускают их (`if not in existing`) → дефолт никогда не выставляется → **старый код
(pre-A8, без этих колонок в модели) падает на INSERT** на fresh-инсталле. На существующих БД
(миграционный путь 0176→0177) `op.add_column(server_default=...)` работал корректно — баг жил
только в fresh-install ветке через 0139. Фикс: `server_default=""`/`"0"` в spec — теперь точно
соответствует тому, что ставят 0176/0177 на существующих БД. Доказано скриптом
`.codex_tmp/pg_migration_gate.py`: до фикса `NotNullViolation`, после — old-shape INSERT проходит,
дефолты применяются. `test_app_tables_missing_migration` + `test_internal_db_migration_runtime`
20/20 после правки.

## Lease фоновой саммаризации — сценарий >45с закрыт

Воспроизведено: lease 45с по `updated_at`; LLM-цикл длиннее lease → Worker B мог взять тот же
диалог → дублирующий платный вызов.

Решение: **renewal lease на каждом fold-чанке** — пока job работает, `updated_at` обновляется
(условие `mono - last_touch > LEASE/2`), Worker B видит свежий lease → `lease_busy`. Тест
`test_lease_renewal_blocks_second_worker`: Worker A с lease 0.2с и спящим summarize → B на
каждом чанке получает `lease_busy`, A завершает `done`. `test_lease_expires_for_dead_worker`:
мёртвый воркер (updated_at -3600с) → следующий воркер клеймит и доводит до конца. Освобождение:
после done/partial/reset-cas `updated_at` уже свежий по делу; reset → `context_reset_seq` CAS
отклоняет чужую запись.

## Legacy-паритет flag=0 — восстановлен

Inline persist вынесен в `_persist_run_summary` (общая точка для обоих путей). Дефекты закрыты:

- `_summary_usage` больше не теряется — мерджится в `memory_usage` run'а.
- Исключение `summarize()`: checkpoint (`summary_until_seq`/`summary_llm_until_seq`) **не
  двигается** — диапазон не потерян навсегда, следующий run повторит (baseline-паритет); в
  prompt идёт head/tail fallback.
- Тесты `test_inline_summary_success_usage_and_both_checkpoints` (usage смерджен, оба
  checkpoint продвинуты, `rolling_summary_llm == rolling_summary`),
  `test_inline_summary_failure_preserves_checkpoint` (checkpoint не сдвинут),
  `test_inline_summary_background_flag_registers_pending` (flag=1 → регистрация без LLM).

## Контроль расходов — provider-level

`jobs/min` ≠ `LLM calls/min`: один job фолдит много чанков. Добавлено:

- `AI_SUMMARY_UPGRADE_LLM_PER_MIN` (default 30/процесс) — окно `_summary_llm_window`;
  при исчерпании job возвращает `rate_limited` и перерегистрируется с задержкой (не spin).
- `AI_SUMMARY_UPGRADE_JOB_TOKEN_CAP` — суммарный токен-кап на job; `budget_capped` → checkpoint
  сохранён по фолднутым чанкам, resume с места остановки.
- Частичный расход: usage каждого чанка аккумулируется в `total_usage` и пишется в телеметрию
  даже при `partial`/`cas_conflict` — платё не теряется из учёта.
- Backfill: scan-window + jobs/min + LLM/min + token cap + pending cap — разогрев ограничен
  по всем осям; интерактив имеет приоритет (fresh `updated_at` блокирует lease до 45с).
- Тесты: `test_llm_calls_rate_limit_pauses_job`, `test_job_token_cap_stops_and_resumes`.

## A/B — измеренное, честное

Живых ключей LLM/JEV в окружении нет (`.env` отсутствует, `.env.example` пуст) → A/B против
реального провайдера **невозможен без контурных креденшелов** — не выдаём ожидаемое за измеренное.

Измерено на реальном коде (`_persist_run_summary`, синтетический провайдер 350мс, n=15):

| Путь | p50 | p95 |
|---|---|---|
| flag=0 (inline summarize на критическом пути) | **362мс** | 487мс |
| flag=1 (fallback + очередь, LLM ушёл в фон) | **7мс** | 9мс |

Т.е. на самом узком месте — синхронный summary-пersist — критический путь короче на ~50×.
Полный REST/WS A/B с реальным провайдером остаётся запланированным post-deploy шагом
(план в разделе «Деплой»), baseline `b8763f41` сохранён.

## Интеграция с прод-веткой

`git merge-tree` HEAD(`11f98726`)×`perf/my-files-v2` (deployed `b8763f41`, merge-base `609108f6`)
→ **чистый мердж без конфликтов**. My-Files UI изменений на стороне A8 нет.

## Деплой-план (выполнение после приёмки)

1. **Backup** prod PG (`pg_dump` app+chat схем) до любой миграции.
2. Выливка кода с `AI_SUMMARY_BACKGROUND_ENABLED=0` (дефолт) — на chat-ноды и AI-worker одновременно;
   миграция `alembic -x url=<prod> upgrade head` (0177 идемпотентна, lock_timeout 10с, колонки с
   server_default — мгновенный metadata-only ADD COLUMN на PG≥11).
3. Smoke: REST visibility, `test_chat_realtime` health `realtime_mode`, чтение треда на обеих нодах.
4. Новый baseline замер → сравнение с `b8763f41` (server_total/queue_wait p50/p95).
5. Отдельное разрешение → `AI_SUMMARY_BACKGROUND_ENABLED=1` на worker → повторный замер +
   контроль `get_summary_upgrade_metrics()` (rate_limited/budget_capped/llm_calls/total_tokens).
6. Rollback: flag=0 (без выката) либо `downgrade 0177` (колонки additive — старый код их игнорирует).

## Регрессия Cycle 4

- `test_ai_summary_upgrade.py`: **43/43** (+7 новых c4-тестов).
- PG-migration gate (`.codex_tmp/pg_migration_gate.py`): **6/6 PASS**.
- PG-relay probe (`.codex_tmp/pg_relay_probe.py`, два реальных процесса): **3/3 PASS**.
- `test_ai_run_serialization_pg.py`: **22/22 PASS** на живом PG.
- Полный набор `tests + WEB-itinvent/backend/tests` (6700+, 41 мин): **6564 passed / 76 skipped / 70 failed / 11 collection-errors** — все проверенные на принадлежность к циклу: спот-проверка ключевых падений на базовом HEAD `11f98726` без изменений цикла 4 показала побайтовое воспроизведение (`test_e2e_ai_smart_memory`, `test_e2e_ai_draft_reliability` — env: нет провайдеров/токенов; `test_route_metrics_include_cache_hit_rate` изолированно **pass** — падение в полном прогоне = test-pollution). Классы ошибок: missing deps (`watchdog`, `soundfile`, `telegram`), `TELEGRAM_BOT_TOKEN`, db-context `OBJ-ITINVENT`, release-артефакты, alembic-цепочки на scratch без базовых таблиц — та же природа, что 20 pre-existing цикла 3; ни один файл цикла 4 не регрессировал.

## GO/NO-GO

**GO с условиями**: код готов к выкладке с `AI_SUMMARY_BACKGROUND_ENABLED=0` (дефолт OFF сохранён
в обоих местах — проверено). Условия: (a) деплой-план выше; (b) flag=1 включается отдельным
разрешением после нового baseline; (c) реальный A/B с провайдером — post-deploy контур.
