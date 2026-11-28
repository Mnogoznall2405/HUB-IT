# HUB Assistant Program — DECISIONS

Обновлено: 2026-11-29. Здесь фиксируются только решения с доказательствами и rollback/пересмотром. Новые решения добавляются новыми записями, старые не переписываются молча.

## D-001 — Fast Path OFF до переработки A12

**Решение:** `AI_READ_FAST_PATH_ENABLED` не должен включаться в production/final eval как оптимизация до реализации sufficiency-gated Fast Path V2 и нового independent holdout.

**Основание:** прежний measurement PR #74: fast-path cohort 56.5% PASS против 95.7% non-fast-path; дефекты premature termination/drill-down/retry/file rendering.

**Статус:** ACTIVE.

**Пересмотр:** после реализации A12 и frozen dev+holdout на exact SHA с fast-path OFF vs candidate ON.

## D-002 — Compact specs OFF при prompt optimization

**Решение:** `AI_COMPACT_SPECS_ENABLED=0` при включённом prompt optimization; compact descriptions нельзя считать безопасной экономией токенов.

**Основание:** прежние measurements показали, что compacting удаляет routing-critical examples и ухудшает выбор инструментов.

**Статус:** ACTIVE.

**Пересмотр:** только с ablation, где качество не ниже baseline и regressions объяснены.

## D-003 — Run result reuse OFF

**Решение:** `AI_RUN_RESULT_REUSE_ENABLED=0` до доказательства, что reuse не возвращает устаревшие/чужие/неполные результаты и не нарушает freshness/memory contracts.

**Статус:** ACTIVE.

**Пересмотр:** после отдельного security/correctness review и eval.

## D-004 — AI остаётся на Python, Rust core не владеет AI side effects

**Решение:** переносимые Rust Chat Engine V2 компоненты не должны реализовывать LLM orchestration, tool execution, permissions или confirmation actions. Python остаётся владельцем AI Runs и business side effects.

**Основание:** PR #106 migration contract; существующая authz/LLM/action safety в Python; необходимость независимой эволюции направлений.

**Статус:** ACTIVE.

## D-005 — Нет новых обязательных сервисов/брокеров/СУБД

**Решение:** Redis, Docker, новые брокеры сообщений, новые СУБД и обязательные внешние observability сервисы не добавляются без отдельного согласования владельца.

**Основание:** инфраструктурные ограничения HUB-IT и требование сопровождаемости.

**Статус:** ACTIVE.

## D-006 — pgvector допустим как расширение существующего PostgreSQL, но не как новая СУБД

**Решение:** pgvector может рассматриваться в OSS-03/A14 как additive extension того же PostgreSQL после FTS baseline и согласования schema migration. Он не считается новой СУБД, но production extension требует отдельного approval, проверки Windows/PG compatibility, backup/restore и rollback.

**Статус:** CONDITIONAL.

## D-007 — Raw benchmark artifacts не входят в release diff

**Решение:** raw `real_run_*.json`, logs, scratch `_*.py`, ad-hoc patch/probe scripts из PR #74 не переносятся в PR #105/main. В репозитории допустимы только curated harness, corpus, seed, hash manifest и финальные отчёты.

**Основание:** release diff должен быть reviewable; raw outputs большие, содержат noisy transient data и не являются runtime.

**Статус:** ACTIVE.

## D-008 — Emergency Disable отделён от regular disable

**Решение:** regular disable не меняет прежние owner access semantics; emergency disable блокирует новые запросы, подтверждения и новые execution stages, сохраняя историю/audit. Он не обещает отмену уже committed external actions.

**Основание:** kill-switch должен быть быстрым и предсказуемым без разрушения истории или ложных обещаний rollback.

**Статус:** ACTIVE, implementation improved in PR #105 `0321938e`.

## D-009 — CHAT/READ/ACT ceilings требуют owner decision

**Решение:** пока не принято эксплуатационное решение, нельзя считать заявленную ceilings architecture активной в production. Вариант «opt-in hardening» должен быть явно зафиксирован владельцем, либо нужен holdout после включения `AI_JEV_ROUTING`.

**Статус:** OPEN / BLOCKER для A11 GO.

## D-010 — Нет automatic retry внешних мутаций при unknown outcome

**Решение:** если внешний результат неизвестен, система не должна blindly повторять отправку/мутацию. Для mail используется ledger/idempotency и инструкция проверить Sent; для других мутаций unknown/confirmed semantics должны быть явными.

**Статус:** ACTIVE.

## D-011 — LiteLLM, Mem0, LangGraph не принимаются как замена текущих boundaries

**Решение:** `shared/llm` остаётся обязательной границей LLM; собственная memory/planning модель не заменяется Mem0/LangGraph без новых доказательств. LiteLLM отложен до доказанной multi-provider gateway потребности.

**Статус:** ACTIVE / revisit only with evidence.

## D-012 — Все платные evals требуют pre-approved budget и immutable config

**Решение:** перед full benchmark фиксируются exact SHA, corpus/seed hash, provider/model, temperature, flags, concurrency, лимит стоимости и команды. После начала измерения критерии не меняются; partial/mock не считается production readiness.

**Статус:** ACTIVE.

## D-013 — PostgreSQL FTS + pg_trgm является первым кандидатом A14 retrieval design

**Решение:** для A14 сначала проектируется ACL-aware PostgreSQL FTS/pg_trgm retrieval prototype, а не новый vector service/vector database. Semantic/vector pilot допустим только после implementation-grade evidence, что безопасный improved FTS недостаточен.

**Основание:** B-007 synthetic baseline: `'simple'` FTS непригоден для русской морфологии; strict `'russian'` быстрый и точный, но неполный; whole-query trigram непригоден; hybrid Russian FTS + controlled fallback дал лучший Hit@1/Hit@3 на synthetic corpus. PostgreSQL уже является существующей инфраструктурой, поэтому это минимальный архитектурный шаг.

**Ограничение:** это не production GO и не разрешение на runtime merge. Обязательны exact SQL ACL parity before `LIMIT`, migration/index proof, SQLite fallback, larger synthetic corpus, fixed golden-set differential tests и independent review.

**Статус:** CONDITIONAL / dependent prototype implemented, review required before any merge decision.
