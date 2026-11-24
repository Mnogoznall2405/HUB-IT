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
- PR #25 (`docs/a7-performance`, `003a009b`): исправленные методология/анализатор/отчёт A7.
