# HUB Assistant Program — STATUS

Обновлено: 2026-11-29. Этот файл — оперативный статус программы A11–A24. Источник истины по этапам — `AI_EVOLUTION_A11_A24_ROADMAP.md`; здесь фиксируются только проверенные состояния, exact SHA и ближайший разрешённый шаг.

## Текущее состояние

| Область | Состояние | Доказательство / SHA |
| --- | --- | --- |
| Управляющий PR | PR #107, draft, documentation-only | ветка `docs/ai-assistant-a11-a24-roadmap` |
| A11 Release Candidate | PR #105 обновлён review fixes, benchmark pack, recovery proof и characterization fix | head `cae317fd` |
| A11 verdict | **BLOCKED / NO-GO для production merge** | нет full frozen eval на exact final SHA; нет подтверждённого бюджета; не решены routing/watchdog production flags |
| A12+ | Implementation PR не начаты; независимый non-paid OSS-01 baseline завершён | FTS baseline report в `experiments/FTS_BASELINE_REPORT.md`; runtime не изменён |

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
