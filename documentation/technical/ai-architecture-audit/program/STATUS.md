# HUB Assistant Program — STATUS

Обновлено: 2026-11-29. Этот файл — оперативный статус программы A11–A24. Источник истины по этапам — `AI_EVOLUTION_A11_A24_ROADMAP.md`; здесь фиксируются только проверенные состояния, exact SHA и ближайший разрешённый шаг.

## Текущее состояние

| Область | Состояние | Доказательство / SHA |
| --- | --- | --- |
| Управляющий PR | PR #107, draft, documentation-only | ветка `docs/ai-assistant-a11-a24-roadmap` |
| A11 Release Candidate | PR #105 обновлён результатами независимого ревью | head `0321938ed88545a4b35745785c6897c6c7f3b74e` |
| A11 verdict | **BLOCKED / NO-GO для production merge** | нет full frozen eval на exact final SHA; нет подтверждённого бюджета; не решены routing/watchdog production flags |
| A12+ | Не начаты как implementation PR | можно готовить test plans и независимые измерения, но не расширять runtime до closure A11 или отдельного согласованного slice |

## Последние подтверждённые проверки A11

Проверялся candidate head после исправлений `0321938e`:

- PostgreSQL serialization gate на изолированном PostgreSQL 17.6: **22 passed**.
- Migration rehearsal на изолированном PostgreSQL: **PASS** (`scope=all`, `scope=app`, `scope=chat`, `0185 → 0186 → downgrade 0185 → re-upgrade`).
- Focused post-review suite: **46 passed**.
- AI regression suite после исправлений: **302 passed**.
- Известный characterization test `test_claude_transport_keeps_recipient_arguments_through_http_worker`: **FAIL** из-за mock/transport контура; не считается production proof, но должен быть разобран отдельно.

## Исправления, уже включённые в PR #105

Commit `0321938e`:

- emergency kill-switch перепроверяется на locked bot во время enqueue;
- confirm pending action проверяет emergency режим бота исходного run, а не только текущего re-bound бота;
- manager bot list не раскрывает raw `latest_run_error`;
- confirm-time `tasks.write` выровнен с draft-time для task comment/status;
- sticker migration test проверяет ancestry, а не pinned head;
- добавлен `AI_A11_RELEASE_EVIDENCE.md`.

## Активные блокеры A11 GO

1. **BENCH-BLOCKER:** frozen dev/holdout benchmark из 205 сценариев не выполнен на exact final SHA `0321938e` или новее. Прежний measurement относится к PR #74 head `93f6a770`, не к PR #105.
2. **BUDGET-BLOCKER:** нет подтверждённого численного бюджета и провайдера для платного LLM benchmark. Нельзя запускать полный платный прогон без этого согласования.
3. **CONFIG-BLOCKER:** production decision по `AI_JEV_ROUTING`, CHAT/READ/ACT ceilings, `AI_READ_FAST_PATH_ENABLED`, `AI_COMPACT_SPECS_ENABLED`, `AI_RUN_RESULT_REUSE_ENABLED` не зафиксировано. По прежним измерениям fast path разрушал качество и должен оставаться OFF до новых доказательств.
4. **WATCHDOG-BLOCKER:** automatic recovery crashed running runs существует и покрыт PG-тестами, но не включён штатно в PM2/ecosystem. Требуется доказательство process-level kill-after-claim или осознанное решение владельца.
5. **EVIDENCE-GAP:** нужно интегрировать обновлённый benchmark harness/corpus из PR #74, сверить corpus version/hash (`a11-v12` в файле против `v13` в отчёте) и сохранить воспроизводимые команды.

## Ближайший разрешённый шаг

1. В PR #107 завести полный program register (этот каталог) и держать его актуальным.
2. В PR #105 подготовить воспроизводимый benchmark pack без raw artifacts и secrets: harness, corpus, seed, commands, hash manifest.
3. Сформировать точную смету полного dev+holdout run на exact SHA и передать владельцу на approval бюджета.
4. Параллельно, без платных вызовов, выполнить независимые локальные задачи: process-level worker recovery proof, FTS baseline для OSS-01, Promptfoo pilot design для OSS-02.

## Запрещено сейчас

- merge PR #105 в main;
- deploy/restart/production migration;
- включение fast path/result reuse/compact specs как production optimization без нового independent holdout;
- запуск полного платного benchmark без подтверждённого бюджета;
- перенос raw benchmark artifacts/logs/scratch scripts из PR #74.
