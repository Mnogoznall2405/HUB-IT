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
