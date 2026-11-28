# HUB Assistant Program — ARCHITECTURE FINDINGS

Обновлено: 2026-11-29. Формат: факт, влияние, доказательство, решение/статус. Это журнал архитектурных находок, а не замена ADR.

## AF-001 — CHAT/READ/ACT ceilings зависят от выключенного флага

**Факт:** server-side ceilings реализованы через JEV intent routing, но `AI_JEV_ROUTING` по умолчанию выключен. При выключенном флаге или ошибке классификации потолок инструментов становится `None` и не ограничивает модель.

**Влияние:** авторизация и action confirmation не зависят от этого флага и продолжают работать, однако декларируемая defence-in-depth архитектура A11 в production фактически не активна.

**Доказательство:** независимый security review PR #105; `WEB-itinvent/backend/ai_chat/service.py`, `tools/registry.py`, `tests/test_ai_jev_intent_modes.py`.

**Статус:** OPEN / owner decision required. Нельзя просто включить флаг: прежние quality measurements показывали проблемы маршрутизации; нужен independent holdout.

## AF-002 — Fast Path был главным разрушителем качества

**Факт:** в прежнем measurement PR #74 fast-path cohort имел 56.5% PASS против 95.7% non-fast-path. Проблемы: premature termination, недостаточное исследование документов, отсутствие retry/drill-down.

**Влияние:** включение fast path ради latency/cost недопустимо без переработки sufficiency gate и нового independent eval.

**Статус:** OPEN; `AI_READ_FAST_PATH_ENABLED` должен оставаться OFF до A12.

## AF-003 — Emergency Disable должен проверяться в точке принятия работы

**Факт:** первичная реализация проверяла runtime snapshot и cooperative checkpoints, но race window между snapshot и locked bot позволяла поставить новый run. Confirm через re-bound conversation мог обойти исходного бота.

**Решение:** commit `0321938e` добавил fresh locked-bot check в enqueue и проверку bot исходного run при confirm. Regression tests passed.

**Остаток:** emergency остаётся cooperative и не откатывает уже committed external actions; это нужно явно понимать в операционной модели.

## AF-004 — Result reliability является cross-transactional контрактом

**Факт:** AI result проходит через отдельные APP/chat транзакции, stable `client_message_id=ai-run:<run_id>`, outbox, viewer-specific jobs и recovery. `completed` не означает успешную внешнюю мутацию; `unknown` не означает, что действие не выполнено.

**Влияние:** нельзя оптимизировать pipeline так, чтобы потерять ordering, stable ids, dedupe keys, recovery или confirmation semantics. Это также hard compatibility contract для Rust Chat Engine V2.

**Статус:** ACTIVE CONSTRAINT.

## AF-005 — Prompt-injection protection обязана быть серверной, не prompt-only

**Факт:** nonce-marking и правила промпта существуют, но ключевой защитой является серверный grounding: получатели и цели действий принимаются только из запроса пользователя или verified server tool results текущего run.

**Влияние:** любые изменения A12+ не должны превращать содержимое документов, писем, KB, памяти или tool output в инструкции/authority.

**Статус:** ACTIVE CONSTRAINT.

## AF-006 — Database scope fail-closed подтверждён, но требует regression coverage

**Факт:** invalid explicit `database_id` не должен fallback к default/pinned; confirm-time revalidation проверяет catalog/assignment/multi-db targets.

**Доказательство:** `tests/test_ai_database_failclosed.py` — 25 passed после исправлений.

**Статус:** CLOSED для текущего diff, остаётся mandatory regression в каждом A11 final gate.

## AF-007 — Observability must be allowlist-based

**Факт:** manager diagnostics ранее могли раскрывать free-text errors/status/result fields. В PR #105 run endpoint использует explicit allowlist; commit `0321938e` закрыл `latest_run_error` в bot list.

**Влияние:** observability нельзя расширять payload/request/result/tool traces без отдельной security review.

**Статус:** CLOSED для известных endpoints; требуется audit любых новых diagnostics.

## AF-008 — Permission recheck перед мутацией должен совпадать с draft-time semantics

**Факт:** для task comment/status draft требовал `tasks.write`, а confirm исполнял с `tasks.read`. Это позволяло выполнить запись после отзыва write permission при сохранённом read permission.

**Решение:** commit `0321938e` выровнял confirm-time на `tasks.write`.

**Остаток:** нужна полная matrix draft permission → confirm permission → object-level permission для всех mutating action types.

## AF-009 — Worker recovery реализован; эксплуатационная конфигурация всё ещё owner decision

**Факт:** watchdog и CAS recovery существуют. Cross-process kill-after-claim proof на isolated PostgreSQL подтверждает, что orphaned `running` row не отпускает FIFO slot сам по себе, а настоящий `reap_stale_runs` помечает только этот run failed и освобождает следующий queued run.

**Влияние:** correctness recovery mechanism доказан на minimal PG harness. Оставшийся риск не architectural correctness, а production configuration: `AI_RUN_WATCHDOG_ENABLED` и heartbeat/watchdog intervals не утверждены для PM2/production.

**Статус:** mechanism CLOSED for current proof; production watchdog configuration OPEN as owner decision.

## AF-010 — Voice runtime DDL не является A11 defect, но нарушает общий PostgreSQL invariant

**Факт:** в доступном дереве voice runtime содержит unconditional `create_all` в request/store path.

**Влияние:** это противоречит правилу «нет runtime CREATE TABLE/INDEX в request path». Не введено PR #105 и не должно лечиться drive-by в A11 без отдельного scope.

**Статус:** REGISTERED / separate issue candidate.

## AF-011 — Rust Chat Engine V2 задаёт жёсткую границу совместимости

**Факт:** AI orchestration, permissions, LLM и бизнес-side effects остаются в Python. Rust core не должен становиться вторым владельцем AI/outbox/side effects. Совместимость включает AI Runs, conversations, messages, result delivery, WS events, confirmation cards, queues, sessions, auth, outbox.

**Статус:** ACTIVE CONSTRAINT для всех A12+ изменений.

## AF-012 — Некоммуникационные draft actions не имеют такого же intent-grounding, как mail recipients

**Факт:** mail recipient verification строгий. Для transfer/works/AD/WOL подтверждение всё ещё обязательно, но injected document может склонить модель создать ненужный draft; пользователь должен увидеть понятное preview и подтвердить вручную.

**Влияние:** residual social-engineering risk «подтверди не глядя».

**Статус:** ACCEPTED? Требуется owner decision либо расширение intent grounding на DB-scoped actions в A16/A19.

## AF-013 — Нет централизованного AI audit endpoint/table

**Факт:** audit след распределён между `AppAiPendingAction`, логами `ai_tool_call` и аудитом целевых систем.

**Влияние:** расследование «что ассистент сделал от имени пользователя» затруднено.

**Статус:** OPEN / backlog. Не добавлять новую инфраструктуру без отдельного доказательства потребности; минимум — retention/query contract для existing rows.

## AF-014 — KB retrieval архитектурно не масштабируется и не использует PostgreSQL FTS

**Факт:** `backend/ai_chat/retrieval.py` загружает все `AppAiKbChunk` rows и выполняет scoring в Python. В PostgreSQL уже есть FTS index с `'simple'` configuration, но runtime retrieval его не использует. Synthetic baseline B-007 показывает: `'simple'` не справляется с русской морфологией (Hit@1 0.30), strict `'russian'` лучше (0.70), trigram token coverage ловит опечатки, а hybrid Russian FTS + controlled fallback достиг 1.00 на маленьком synthetic corpus. Whole-query trigram similarity непригоден (0.20).

**Влияние:** memory/network cost retrieval растёт линейно с KB; ACL filtering нельзя корректно совместить с SQL `LIMIT`, если retrieval остаётся широким Python scan; typo tolerance и русская морфология слабые. При этом exact inventory-number behavior нельзя регрессировать.

**Влияние на A14:** PostgreSQL FTS + pg_trgm является первым кандидатом, потому что использует существующую СУБД и не требует нового service/vector DB. Но semantic synonyms им не решаются полностью. Implementation должен сначала доказать ACL-before-limit, migration/index correctness, SQLite fallback и larger-scale benchmark.

**Статус:** OPEN / leading design hypothesis for A14. Evidence only; no runtime implementation approved by this finding.
