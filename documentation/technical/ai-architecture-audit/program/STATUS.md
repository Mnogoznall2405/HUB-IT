# HUB Assistant Program — STATUS

Обновлено: 2026-11-29. Этот файл — оперативный статус программы A11–A24. Источник истины по этапам — `AI_EVOLUTION_A11_A24_ROADMAP.md`; здесь фиксируются только проверенные состояния, exact SHA и ближайший разрешённый шаг.

## Текущее состояние

| Область | Состояние | Доказательство / SHA |
| --- | --- | --- |
| Управляющий PR | PR #107, draft, documentation-only | ветка `docs/ai-assistant-a11-a24-roadmap` |
| A11 Release Candidate | PR #105 обновлён review fixes, benchmark pack, recovery proof и characterization fix | head `cae317fd` |
| A11 verdict | **BLOCKED / NO-GO для production merge** | нет full frozen eval на exact final SHA; нет подтверждённого бюджета; не решены routing/watchdog production flags |
| A14 prototype | Dependent thematic branch `feat/a14-kb-fts-retrieval` pushed, base A11 `cae317fd` | head `d7eb6f8f`; ACL-aware hybrid FTS/pg_trgm prototype, migration reserve `20261129_0187`; не merge-ready до independent review и A11 closure |
| A12/A13/A15+ | Implementation PR не начаты | независимый non-paid OSS-01 baseline завершён; остальные этапы только design/eval preparation |

## Последние подтверждённые проверки A11

Проверялся candidate head после исправлений `0321938e`:

- PostgreSQL serialization gate на изолированном PostgreSQL 17.6: **23 passed** на SHA `fbacbcaa`, включая cross-process kill-after-claim recovery proof.
- Migration rehearsal на изолированном PostgreSQL: **PASS** (`scope=all`, `scope=app`, `scope=chat`, `0185 → 0186 → downgrade 0185 → re-upgrade`).
- Focused post-review suite: **46 passed**.
- AI regression suite после исправлений: **302 passed**.
- Characterization test `test_claude_transport_keeps_recipient_arguments_through_http_worker`: **PASS** после исправления streaming test double; весь `test_e2e_ai_draft_reliability.py` — **48 passed** на SHA `ff320dbc` (docs commit `cae317fd` не меняет runtime/tests).

## Исправления, уже включённые в PR #105

Commit `0321938e`:

- emergency kill-switch перепроверяется на locked bot во время enqueue;
- confirm pending action проверяет emergency режим бота исходного run, а не только текущего re-bound бота;
- manager bot list не раскрывает raw `latest_run_error`;
- confirm-time `tasks.write` выровнен с draft-time для task comment/status;
- sticker migration test проверяет ancestry, а не pinned head;
- добавлен `AI_A11_RELEASE_EVIDENCE.md`.

Commit `2d5b37c5`:

- интегрирован curated benchmark pack из PR #74 без raw artifacts/scratch scripts: `a9_real_run.py`, `bench_seed.py`, `bench_corpus_gen.py`, frozen corpus `bench_intel_corpus.json`;
- `--env` больше не имеет implicit default на соседний checkout; provider/test-contour settings загружаются только из явно указанного файла;
- добавлен `--seed-only` режим без платных/provider calls;
- aggregate включает заранее определённые quality rates (`pass_rate_all_scenarios`, `pass_rate_scored_scenarios`);
- добавлен `A11_BENCHMARK_PACK.md` с hash manifest и ограничениями запуска;
- локальная seed-only проверка прошла: 205 сценариев, `provider_calls=0`, `env_keys_loaded=0`; `py_compile` PASS.

## Независимый A14 prototype — текущее доказательство

Ветка `feat/a14-kb-fts-retrieval`, head `d7eb6f8f`, dependent on A11 `cae317fd`:

- реализован staged PostgreSQL retrieval: strict Russian FTS → bounded OR Russian FTS с token coverage → pg_trgm per-token fallback;
- ACL перенесён в SQL до `LIMIT`; Python fallback стал fail-closed для omitted `current_user` (только global chunks);
- template candidates тоже используют PostgreSQL path вместо unconditional Python scan;
- migration `20261129_0187` добавляет `ix_app_ai_kb_chunks_fts_russian` и `ix_app_ai_kb_chunks_trgm_lower`; зарегистрирована как dependent reserve после `20261128_0186`;
- `tests/test_ai_kb_retrieval.py` — 25 passed;
- `tests/test_ai_kb_retrieval_pg.py` — 4 passed на isolated PostgreSQL (morphology, typo, ACL-before-LIMIT, private/department/manager, template);
- migration rehearsal на isolated PostgreSQL — PASS: fresh/repeat scope=all, scope=app, scope=chat, `0186 -> 0187 -> downgrade 0186 -> re-upgrade`;
- broad AI suite на ветке — 1023 passed, 27 skipped, 2 failed в sandbox packaging tests (`shared.llm.json_stream` missing in copied artifact). Эти failures находятся вне затронутых retrieval файлов и требуют отдельной characterization, но не должны скрываться.

Это prototype evidence, не production GO. Нужны independent review, larger fixed golden corpus, exact inventory controls, EXPLAIN на production-like volume и отдельное решение о stacked/dependent PR после A11.

## Активные блокеры A11 GO

1. **BENCH-BLOCKER:** frozen dev/holdout benchmark из 205 сценариев не выполнен на exact final SHA `cae317fd` или новее. Прежний measurement относится к PR #74 head `93f6a770`, не к PR #105.
2. **BUDGET-BLOCKER:** нет подтверждённого численного бюджета и провайдера для платного LLM benchmark. Нельзя запускать полный платный прогон без этого согласования.
3. **CONFIG-BLOCKER:** production decision по `AI_JEV_ROUTING`, CHAT/READ/ACT ceilings, `AI_READ_FAST_PATH_ENABLED`, `AI_COMPACT_SPECS_ENABLED`, `AI_RUN_RESULT_REUSE_ENABLED` не зафиксировано. По прежним измерениям fast path разрушал качество и должен оставаться OFF до новых доказательств.
4. **WATCHDOG-CONFIG-BLOCKER:** process-level kill-after-claim recovery теперь доказан в isolated PG test, но watchdog всё ещё не включён штатно в PM2/ecosystem; требуется осознанное production configuration решение владельца.
5. **EXTERNAL-CONTOUR-BLOCKER:** external-dependent сценарии (ITINVENT SQL, Exchange, AD, 1C) не имеют approved isolated contour. Они должны быть запущены только в approved isolated contour или честно оставаться BLOCKED; production GO при unresolved critical BLOCKED невозможен.

## Ближайший разрешённый шаг

1. В PR #107 поддерживать полный program register (этот каталог) актуальным.
2. Сформировать/подтвердить точную денежную смету полного dev+holdout run на exact SHA `cae317fd` и передать владельцу на approval бюджета; token envelope уже зафиксирован, но exact dollar cost требует approved provider/model price card.
3. Проверить CI/review state PR #105 после последних push.
4. Параллельно, без платных вызовов, продолжать независимые локальные задачи: ACL-aware A14 FTS design/prototype и Promptfoo pilot design для OSS-02.
5. Для A14 не изменять runtime до design review: сначала exact SQL ACL parity, migration/index proof, SQLite fallback, golden differential tests и larger synthetic corpus benchmark.

## Запрещено сейчас

- merge PR #105 в main;
- deploy/restart/production migration;
- включение fast path/result reuse/compact specs как production optimization без нового independent holdout;
- запуск полного платного benchmark без подтверждённого бюджета;
- перенос raw benchmark artifacts/logs/scratch scripts из PR #74.
