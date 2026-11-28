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

**Result:** 23 passed in 20.38s на SHA `fbacbcaa`, включая cross-process kill-after-claim proof.

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

**SHA:** `93f6a770` (PR #74), corpus hash `0fb9a10337585f13afa0635095a3f20e932f1aa20c2bc245489c42c777658841`. Reconciliation: file metadata still says `a11-v12`, но exact SHA256 совпадает с hash, который отчёт называл v13; файл не редактируется ради metadata version, чтобы не разрушить сравнимость.

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
- corpus: frozen 205 scenarios, dev=140, holdout=65, sha256 `0fb9a10337585f13afa0635095a3f20e932f1aa20c2bc245489c42c777658841`;
- split order: holdout first if budget is constrained, then dev; no peeking-driven changes between measurements;
- `AI_READ_FAST_PATH_ENABLED=0`;
- `AI_RUN_RESULT_REUSE_ENABLED=0`;
- `AI_COMPACT_SPECS_ENABLED=0` when prompt optimization is enabled;
- JEV routing configuration: explicitly recorded; if owner chooses ceilings ON, a separate quality holdout is mandatory;
- sequential execution if provider throttling/balance causes parallel 402s;
- resume allowed only with hash-verified checkpoints and immutable config.

**Pre-measurement resource envelope for budget approval:**

Исторический fast-path-ON full corpus дал 423 main LLM calls + 223 JEV calls, 1,742,511 main input tokens, 84,465 main output tokens и 1,155,256 JEV tokens. Это нижняя/историческая точка, не final config.

Fast-path-OFF control subset (31 scenarios) экстраполируется на 205 сценариев примерно как 648 main LLM calls, 238 JEV calls, 2.86M main input tokens, 133K main output tokens и 1.35M JEV tokens. С safety factor 1.25 рекомендуемый approval envelope: **не более 810 main LLM calls, 300 JEV calls, 5.3M input-equivalent tokens и 170K output tokens** на один полный dev+holdout pass. Input-equivalent conservatively считает все JEV tokens как input, потому что artifact не разделяет их input/output.

Exact dollar budget нельзя честно посчитать без approved provider/model price card. Формула: `(approved_input_price_per_mtok × input-equivalent tokens / 1M) + (approved_output_price_per_mtok × output tokens / 1M)`. Harness уже записывает token usage; если provider не возвращает cost, отсутствие cost должно быть явно отражено в artifact.

**Minimum report outputs:**

- scenario-level result rows;
- category summary;
- security matrix;
- tool errors/invalid args/duplicate calls/mode denied counts;
- tokens/cost/LLM calls;
- wall latency distribution;
- anomalies and blocked/external-system classification.

## B-006a — Benchmark pack local validation, no provider calls

**SHA:** `0321938ed88545a4b35745785c6897c6c7f3b74e` before commit `2d5b37c5`; harness/corpus content corresponds to `2d5b37c5`.

**Commands:**

```powershell
python documentation\technical\ai-architecture-audit\a9-artifacts\a9_real_run.py `
  --label seedcheck --seed --seed-only --out .codex_tmp\a11_seedcheck.json

python -m py_compile `
  documentation\technical\ai-architecture-audit\a9-artifacts\a9_real_run.py `
  documentation\technical\ai-architecture-audit\a9-artifacts\bench_seed.py `
  documentation\technical\ai-architecture-audit\a9-artifacts\bench_corpus_gen.py
```

**Result:** PASS. Manifest reports 205 scenarios, `provider_calls=0`, `env_keys_loaded=0`, corpus sha256 `0fb9a10337585f13afa0635095a3f20e932f1aa20c2bc245489c42c777658841`; py_compile PASS. Validation uses disposable sqlite only and no secrets.

**Limitations:** не LLM measurement; не проверяет external systems.

## B-006b — Draft reliability / Claude transport characterization

**SHA:** `ff320dbc` test fix; `cae317fd` documentation-only update.

**Command:**

```powershell
pytest -q tests/test_e2e_ai_draft_reliability.py
```

**Result:** 48 passed in 46.99s.

**Finding:** прежний failure был дефектом test double: mock возвращал non-stream response при `stream=True`. Streaming path ожидаемо пытался итерировать объект, fallback потреблял следующие scripted responses и сдвигал очередь. Production transport code не изменялся; это не подтверждённый production defect.

## B-007 — PostgreSQL FTS baseline for OSS-01/A14

**Status:** DONE as local/synthetic decision evidence; not production proof and not implementation approval.

Artifacts:

- report: `experiments/FTS_BASELINE_REPORT.md`
- harness: `experiments/fts_baseline.py`
- raw result: `experiments/fts_baseline_result.json`

Executed comparisons on disposable isolated PostgreSQL with 1012 synthetic rows (1000 filler + 12 target rows), 13 Russian test cases and zero LLM/provider calls:

| Algorithm | Hit@1 | Hit@3 | False-positive cases | Avg latency |
|---|---:|---:|---:|---:|
| current Python substring approximation | 0.80 | 0.90 | 1 | 2.497 ms |
| PG FTS `simple`, strict AND | 0.30 | 0.30 | 0 | 0.232 ms |
| PG FTS `russian`, strict AND | 0.70 | 0.70 | 0 | 0.284 ms |
| PG FTS `russian`, bounded OR ranked | 0.90 | 0.90 | 1 | 3.205 ms |
| pg_trgm whole-query similarity | 0.20 | 0.20 | 0 | 1.360 ms |
| pg_trgm token coverage | 0.90 | 0.90 | 0 | 3.334 ms |
| hybrid strict Russian FTS → bounded OR → trigram token coverage | **1.00** | **1.00** | **0** | 3.128 ms |

Findings:

1. `simple` FTS is unsuitable as the primary Russian retrieval configuration.
2. strict Russian AND is fast and precise but misses valid inflection/intent variants.
3. unguarded OR improves recall but can introduce false positives.
4. whole-query trigram similarity is the wrong shape for long natural-language queries.
5. per-token trigram coverage catches the typo case and avoids the tested false-positive cases, but does not solve semantic synonyms.
6. the hybrid candidate performed best on this small synthetic corpus and is the leading A14 design hypothesis.
7. ACL was only simplified in the harness; production implementation must encode/enforce the real KB ACL before `LIMIT`.
8. FTS Russian used a GIN bitmap index scan by default. Trigram index usage requires the commutator/indexable shape `document %> token`; on the tiny 1k table PostgreSQL still preferred seq scan unless forced, which is expected planner behavior and not by itself a defect.

**Limits:** synthetic small corpus only; latency is comparative smoke evidence; perfect hybrid result must not be represented as production 95% quality. Next evidence: real ACL-aware SQL predicates, migration/index design, SQLite fallback, larger corpus and fixed golden-set differential tests.

## B-008 — Process-level worker recovery proof

**Status:** DONE for crash-recovery proof; production watchdog configuration remains an owner decision.

**Executed scenario:**

1. child Python process used the production PostgreSQL claim implementation against disposable PG;
2. it committed `r1` as running while `r2` remained queued in the same conversation;
3. parent killed the child after claim commit but before completion;
4. direct verification showed `r1=running`, `r2=queued`, and no new claim could overtake the orphaned running row;
5. after simulated staleness, the real `reap_stale_runs` CAS marked only `r1` failed and `_claim_next_queued_run` released `r2`.

**Result:** PASS in `tests/test_ai_run_serialization_pg.py::test_pg_process_killed_after_claim_recovers_fifo_slot`; full file 23 passed. Limitation: minimal schema/test harness, not the full LLM worker loop.

## B-009 — Promptfoo pilot / OSS-02

**Status:** TODO design before implementation.

**Planned evidence:** version/license/telemetry review, local provider adapter, synthetic-only prompts, deterministic CI subset, separate nightly/live budgeted config. Promptfoo does not replace pytest or the frozen A11 corpus.

