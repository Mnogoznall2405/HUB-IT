# HUB Assistant Program — BENCHMARKS

Обновлено: 2026-11-29. Здесь фиксируются воспроизводимые benchmark/config facts. Не включать secrets, connection strings, access tokens или реальные персональные данные.

## Принципы benchmark evidence

Каждый benchmark обязан фиксировать:

- exact code SHA и branch;
- corpus path/version/hash;
- seed hash/version;
- provider/model/version, temperature, feature flags;
- hardware/OS/PostgreSQL version;
- concurrency/worker settings;
- budget cap и фактическую стоимость;
- commands для запуска;
- artifacts и limitations.

Partial run, mock run, ad-hoc synthetic run и smoke run не являются production readiness evidence.

## B-001 — A11 PostgreSQL serialization gate

**SHA:** `455c160b717b0c33ea69ae3adc99a41757efabf4` initial candidate; enforcement changes in `0321938e` не затрагивают serialization implementation напрямую, но final gate нужно повторить.

**Environment:** локальный изолированный PostgreSQL 17.6 на `127.0.0.1:55432`, test DB/schema только для tests.

**Command:**

```powershell
pytest -q tests/test_ai_run_serialization_pg.py
```

**Result:** 22 passed in ~20s.

**Limitations:** не доказывает process-level kill/restart recovery и production configuration watchdog.

## B-002 — A11 migration rehearsal

**SHA:** `455c160b` + local review fixes; повторить на exact final SHA.

**Environment:** disposable PostgreSQL 17.6; helper создаёт/удаляет только local test databases.

**Command:**

```powershell
python .codex_tmp\verify_a11_migration_gate.py
```

**Result:** PASS, elapsed 15.3s:

- scope=all fresh+repeat head;
- scope=app fresh head;
- scope=chat pass-through revision;
- `0185 -> 0186 -> downgrade 0185 -> re-upgrade`.

**Notes:** первоначальная версия helper ошибочно требовала отсутствие chat tables в scope=app. Это было исправлено, потому что chat migrations intentionally создают missing chat tables независимо от `itinvent_scope`.

## B-003 — AI regression after review fixes

**SHA:** `0321938ed88545a4b35745785c6897c6c7f3b74e`.

**Command:**

```powershell
pytest -q tests/test_ai_argument_recovery.py tests/test_ai_database_failclosed.py tests/test_ai_loop_guard.py tests/test_ai_manager_observability_redaction.py tests/test_ai_bot_access.py tests/test_ai_chat_runtime.py tests/test_ai_generated_files.py tests/test_ai_jev_intent_modes.py tests/test_ai_mail_draft_recipients.py tests/test_ai_stage2_tools.py tests/test_ai_task_draft_resolution.py tests/test_ai_tool_validation_diagnostic.py
```

**Result:** 302 passed in 56.10s.

## B-004 — Focused review regression

**SHA:** `0321938e`.

**Command:**

```powershell
pytest -q tests/test_ai_bot_access.py tests/test_ai_manager_observability_redaction.py tests/test_ai_database_failclosed.py tests/test_chat_sticker_favorites.py::test_sticker_favorites_revision_is_the_single_head_descendant
```

**Result:** 46 passed in 16.38s.

## B-005 — Historical PR #74 full measurement, not valid for PR #105 GO

**SHA:** `93f6a770` (PR #74), corpus reported as v13 sha `0fb9a1033758`; artifact file in tree self-identifies as `a11-v12`, поэтому перед reuse нужно сверить происхождение/hash.

**Artifacts in PR #74 only:** `real_run_fin2_dev.json`, `real_run_fin2_holdout.json`, control artifacts. Не переносить raw artifacts wholesale в release PR.

**Results:**

- dev 140/140: PASS 116 (82.9%), FAIL 22, PARTIAL 2;
- holdout 65/65: PASS 46 (70.8%), FAIL 14, PARTIAL 3, NO_CHECK 2;
- SEC 12/12 and CHAT 30/30 in both splits;
- fast-path cohort: 56.5% PASS vs 95.7% without fast path;
- dev tokens: ~1248K input / 60K output, 296 LLM calls, wall p50 ~8.2s;
- holdout tokens: ~495K input / 25K output, 127 LLM calls, wall p50 ~7.5s.

**Limitations:** не exact SHA PR #105; quality below 95%; fast path was enabled in measured configuration and must not be enabled in final release config.

## B-006 — Required full frozen benchmark for PR #105

**Status:** BLOCKED pending approved numeric budget/provider.

**Planned immutable configuration draft:**

- exact SHA: final PR #105 head after all code/harness changes;
- corpus: frozen 205 scenarios, dev=140, holdout=65; exact file/hash to be fixed after corpus version reconciliation;
- split order: holdout first if budget is constrained, then dev; no peeking-driven changes between measurements;
- `AI_READ_FAST_PATH_ENABLED=0`;
- `AI_RUN_RESULT_REUSE_ENABLED=0`;
- `AI_COMPACT_SPECS_ENABLED=0` when prompt optimization is enabled;
- JEV routing configuration: explicitly recorded; if owner chooses ceilings ON, a separate quality holdout is mandatory;
- sequential execution if provider throttling/balance causes parallel 402s;
- resume allowed only with hash-verified checkpoints and immutable config.

**Minimum report outputs:**

- scenario-level result rows;
- category summary;
- security matrix;
- tool errors/invalid args/duplicate calls/mode denied counts;
- tokens/cost/LLM calls;
- wall latency distribution;
- anomalies and blocked/external-system classification.

## B-007 — PostgreSQL FTS baseline for OSS-01/A14

**Status:** TODO, local/non-paid.

**Planned comparisons on isolated PG:**

1. current `'simple'` FTS path;
2. corrected `'russian'` configuration;
3. strict AND vs bounded OR fallback;
4. pg_trgm similarity for typos;
5. exact inventory-number queries as regression control;
6. ACL filtering before LIMIT;
7. EXPLAIN evidence for index use.

**Metrics:** Hit@1/Hit@3, false hits on negative queries, latency distribution, index scan vs seq scan, row counts. No production data.

## B-008 — Process-level worker recovery proof

**Status:** TODO, local/non-paid.

**Planned scenario:**

1. start two independent worker processes against disposable PG;
2. enqueue several runs in one conversation and in different conversations;
3. kill one worker after claim commit but before completion;
4. verify no duplicate running rows, no lost FIFO, watchdog CAS marks stale run failed, next queued run starts only after recovery;
5. repeat with watchdog disabled to characterize behavior honestly.

## B-009 — Promptfoo pilot / OSS-02

**Status:** TODO design before implementation.

**Planned evidence:** version/license/telemetry review, local provider adapter, synthetic-only prompts, deterministic CI subset, separate nightly/live budgeted config. Promptfoo does not replace pytest or the frozen A11 corpus.
