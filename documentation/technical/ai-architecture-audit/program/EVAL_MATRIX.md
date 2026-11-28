# HUB Assistant Program — EVAL MATRIX

Обновлено: 2026-11-29. Этот файл разделяет измерения, которые можно использовать как evidence, и те, которые нельзя считать final production readiness.

## Acceptance targets программы

| Критерий | Цель | Комментарий |
| --- | ---: | --- |
| Strict success on independent holdout | ≥95% | не изменять после начала измерения |
| Critical security tests | 100% | prompt injection, permissions, isolation, recipient verification, emergency disable, fail-closed database, idempotency |
| Confirmed critical regressions | 0 | любой confirmed critical regression блокирует GO |
| Complex task quality | улучшение vs baseline | COMPLEX/MULTISTEP/CONTEXT — приоритетные слабые зоны |
| Erroneous tool/action calls | снижение без роста denial/UX regression | особенно invalid args, wrong tool, repeated calls |
| Cost/latency | снижение без ухудшения качества | tokens, provider cost, LLM calls, TTFT, p50/p95/p99, CPU/RAM/PG load |

## Известные исторические measurements — НЕ final для PR #105

### PR #74 measurement of record, head `93f6a770`

Это полезный baseline/диагностический источник, но **не evidence готовности PR #105**, потому что SHA другой.

| Split | PASS | FAIL | PARTIAL | NO_CHECK | Примечание |
| --- | ---: | ---: | ---: | ---: | --- |
| dev, 140 scenarios | 116 (82.9%) | 22 | 2 | 0 | ниже цели 95% |
| holdout, 65 scenarios | 46 (70.8%) | 14 | 3 | 2 | ниже цели 95% |

Категории по сохранённому отчёту:

| Категория | Исторический результат | Значение для программы |
| --- | --- | --- |
| SEC | 12/12 оба split | hard gate, нельзя регрессировать |
| CHAT | 30/30 | hard gate, нельзя регрессировать |
| MEMORY | 9/9 + NC | сильная зона |
| ACT dev | 14/15 | почти цель, но confirm matrix нужно расширить |
| READ | 37/50 | слабая зона |
| COMPLEX | 20/30 | слабая зона |
| CONTEXT | 10/15 | слабая зона |
| MULTISTEP | 19/27 | слабая зона |
| DOCS | 7/12 с оговорками | требуется разделить validator artifacts и product defects |

### Fast-path attribution из того же исторического measurement

| Cohort | PASS/FAIL | PASS rate | Интерпретация |
| --- | --- | ---: | --- |
| fast-path hit | 26 pass / 20 fail | 56.5% | fast path — доминирующий разрушитель качества |
| no fast path | 90 pass / 4 fail | 95.7% | почти целевой уровень на dev, но не final holdout evidence |

### A9/A10 ablation smoke, 18 scenarios

Исторический diagnostic, не production evidence:

| Config | PASS | input tokens, K | LLM calls | avg wall, sec |
| --- | ---: | ---: | ---: | ---: |
| all OFF | 15/18 | 370 | 65 | 79.3 |
| fastpath only | 12/18 | 206 | 49 | 31.8 |
| directread only | 16/18 | 157 | 41 | 13.1 |
| planner only | 16/18 | 155 | 36 | 12.8 |
| all ON target | 16/18 | 154 | 36 | 13.8 |

Вывод: directread/planner выглядели перспективно, fastpath в изоляции просаживал качество. Это не основание для включения оптимизаций без нового frozen full eval.

## Текущие non-LLM gates для PR #105 `0321938e`

| Gate | Результат | Evidence class |
| --- | ---: | --- |
| PostgreSQL serialization, isolated PG 17.6 | 22 passed | release-relevant, но нужно повторить после любого нового SHA |
| Migration rehearsal isolated PG | PASS | release-relevant, включает downgrade/re-upgrade |
| Focused post-review tests | 46 passed | regression evidence |
| AI regression suite | 302 passed | regression evidence |
| Claude transport recipient test | FAIL | characterization/mock-transport issue, требует triage |

## Матрица обязательных eval gates для следующего GO/NO-GO

| Gate | Состав | Обязательные условия | Статус |
| --- | --- | --- | --- |
| G1 Static/diff review | exact diff main...PR, security review, migration chain | independent review; findings triaged | PARTIAL |
| G2 Unit/integration regression | AI/security/action/routing tests | exact final SHA, no unexplained failures | PARTIAL: 302 passed на `0321938e`, повторить после новых изменений |
| G3 PostgreSQL migration | upgrade/downgrade/re-upgrade, scope all/app/chat, schema assertions | disposable PG, no production | PASS на helper, повторить final |
| G4 PG concurrency | `test_ai_run_serialization_pg.py` не skipped | isolated PG, exact final SHA | PASS на `455c160b`, повторить final |
| G5 Process recovery | kill worker after claim commit, watchdog recovery, FIFO | isolated process/DB; decide production config | BLOCKED |
| G6 Full frozen benchmark | dev 140 + holdout 65 scenarios | exact SHA, fixed corpus/seed/config, approved budget, no mid-run criterion changes | BLOCKED |
| G7 Security redteam matrix | injection, recipient spoofing, permission revocation, isolation, diagnostic leakage | synthetic only; 100% critical pass | PARTIAL: много regression tests есть, matrix нужно собрать в единый gate |
| G8 Rust V2 compatibility contract | AI Runs/messages/actions/outbox/WS ordering/replay | black-box contract tests or documented verification | TODO |

## Метрики, которые обязан содержать full benchmark report

- exact SHA, branch, diff base;
- corpus file/path/version/hash, seed hash, dev/holdout split;
- provider/model/version, temperature, all relevant feature flags;
- pass/fail/partial/no_check/blocked by scenario and category;
- tool selection accuracy, invalid argument count, repeated/duplicate calls, mode-denied calls;
- LLM calls per scenario/run, input/output/cached tokens, estimated provider cost;
- wall time p50/p95/p99, time to first visible response where measurable;
- PostgreSQL query/lock errors and worker/queue anomalies;
- memory/document/RAG scenario breakdown;
- security scenario matrix;
- artifacts paths/commands sufficient for reproduction;
- limitations and explicit statement that partial/mock runs are not production readiness.
