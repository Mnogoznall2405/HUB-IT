# A11 Release Evidence — рабочий контрольный журнал

Дата обновления: 2026-11-29. Документ фиксирует только проверенные факты; он не является разрешением на merge, deploy или production-миграции.

## Объект проверки

- PR: #105 `fix/a11-release-candidate`.
- Исходный проверенный head до локальных исправлений ревью: `455c160b717b0c33ea69ae3adc99a41757efabf4`.
- База: `origin/main` `59954cec0d070a8afb09659d85ef76f493367648`.
- Локальные исправления ревью ещё должны быть закоммичены отдельным commit перед повторным финальным сравнением.

## Проверенные результаты

### PASS

1. Изолированный PostgreSQL 17.6 на `127.0.0.1:55432`, тестовые БД `a11test`/`a11_test`:
   - `pytest -q tests/test_ai_run_serialization_pg.py` — **22 passed**.
2. AI regression suite на исходном head `455c160b` — **300 passed**:
   - argument recovery, database fail-closed, loop guard, manager redaction, access, runtime, generated files, JEV modes, mail recipients, stage2 tools, task draft resolution, validation diagnostics.
3. Migration rehearsal helper `.codex_tmp/verify_a11_migration_gate.py` после исправления завышенного ожидания по chat-schema:
   - fresh+repeat `scope=all` — PASS;
   - fresh `scope=app` — PASS;
   - `scope=chat` pass-through revision — PASS;
   - `0185 -> 0186 -> downgrade 0185 -> re-upgrade` — PASS;
   - elapsed 15.3s.
4. После исправлений независимого ревью focused suite — **46 passed**:
   - `test_ai_bot_access.py` 18;
   - `test_ai_manager_observability_redaction.py` 2;
   - `test_ai_database_failclosed.py` 25;
   - sticker ancestry structural test 1.

### FAIL / characterization

1. `tests/test_e2e_ai_draft_reliability.py::test_claude_transport_keeps_recipient_arguments_through_http_worker` — FAIL: 0 confirmation cards. Лог показывает mock/transport failure (`types.SimpleNamespace object is not iterable`, затем `pop from empty list`) и validation failure до создания карточки. Это воспроизводит ранее документированный pre-existing mock/transport дефект; не используется как доказательство production-ошибки без отдельного анализа.

## Исправления, внесённые по независимому ревью

1. Manager bot list больше не раскрывает raw `latest_run_error`; добавлен HTTP-boundary regression test с секретным фрагментом.
2. Enqueue повторно проверяет `emergency_disabled_at` на `SELECT ... FOR UPDATE` строке бота, закрывая гонку включения kill-switch во время постановки run.
3. Confirm pending action проверяет emergency режим бота исходного run, а не только текущего re-bound бота conversation; добавлен regression test re-bind.
4. Confirm-time permission для task comment/status выровнена с draft-time: требуется `tasks.write`, а не `tasks.read`.
5. Корневой sticker migration test больше не пингует устаревший head `0185`; проверяет один head и достижимость sticker revisions `0180/0181/0182`.

## Независимые выводы ревью

Независимые агентские ревью не заменяют human review, но дали проверяемые findings:

- Runtime-дельта PR #74 практически полностью перенесена в PR #105; raw benchmark artifacts переносить не нужно.
- Ценное не перенесено: обновлённый harness/corpus и финальный evidence report. Их следует интегрировать отдельно, после сверки версии corpus (`v12` в файле против `v13` в отчёте).
- Критических P0 не найдено.
- Остаются архитектурные/эксплуатационные вопросы: JEV routing и, соответственно, CHAT/READ/ACT ceilings по умолчанию выключены; watchdog recovery не включён в PM2 config; voice runtime содержит pre-existing unconditional `create_all` вне зоны A11.

## Блокеры GO

1. Полный frozen dev/holdout benchmark из 205 сценариев не выполнен на точном финальном SHA после всех исправлений. Прежний measurement относится к PR #74 head `93f6a770`, а не к PR #105 `455c160b` или новому SHA.
2. Не подтверждён согласованный численный бюджет/провайдер для платного LLM benchmark. Нельзя выдавать mock/partial прогон за production readiness.
3. Требуется повторный финальный прогон regression/PG gates после commit исправлений и фиксация нового exact SHA.
4. Нужно эксплуатационное решение по `AI_JEV_ROUTING`/`AI_READ_FAST_PATH` и watchdog configuration; fast-path по прежнему измерению был основным разрушителем качества и не должен включаться без новых доказательств.

## Предварительный verdict

**BLOCKED / NO-GO для production merge в текущем состоянии.** Кодовые security defects, подтверждённые в ревью, частично исправлены и покрыты focused tests, но release gate не завершён: требуется новый exact-SHA regression/PG gate, frozen full benchmark в согласованном бюджете и эксплуатационное решение по routing/watchdog. Merge/deploy/production-миграции не выполнялись.
