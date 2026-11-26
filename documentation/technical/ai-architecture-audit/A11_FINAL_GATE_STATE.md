# A11 Final Gate — состояние (обновлено session 3)

## Зафиксированное измерение — В ПРОЦЕССЕ
- HEAD измерения: **7bd7edcb** (зафиксирован в env обоих прогонов)
- corpus sha256: 09c4ddbc5ea27554 (v12: 205 сценариев, dev=140, holdout=65)
- seed sha256: 11cfae690ed54130
- **real_run_final_dev.json** — 140 dev-сценариев, в процессе (37+ к 10:41)
- **real_run_final_holdout.json** — 65 holdout, в процессе (26+ к 10:41)
- Флаги прогонов (целевые директивы): PROMPT_OPT=1 COMPACT_SPECS=0 READ_FAST_PATH=1 DIRECT_READ=1 MEMORY_PLANNER_OPT=1 RUN_RESULT_REUSE=0 — записаны в process env лаунчера; в артефакт попадает только PROMPT_OPTIMIZATION, остальные подтверждать поведенчески (latency/tokens профиль)
- Прогоны БЫСТРЫЕ: ~25с/сценарий — профиль оптимизаций ON

## Ключевые данные уже собраны
### A9/A10 ablation (18-Scenario smoke, cycle2/3 artifacts, tokens llm_in K / llm_calls / avg wall s):
| config | PASS | in K | calls | wall |
| all OFF (fin_A) | 15/18 | 370 | 65 | 79.3 |
| fastpath only | 12/18 | 206 | 49 | 31.8 |
| directread only | 16/18 | 157 | 41 | 13.1 |
| planner only | 16/18 | 155 | 36 | 12.8 |
| ALL ON target | 16/18 | 154 | 36 | 13.8 |
- fastpath В ИЗОЛЯЦИИ просаживал качество на smoke (12/18); в целевой комбинации качество восстанавливается (16/18) при 2.4x меньше токенов, 5.7x быстрее. Ранняя просадка fastpath — известный риск premature termination; финальное подтверждение — по ms_* в final_dev.

### Security audit incremental delta (после cycle-3 аудита):
- directory head-resolution: parameterized service, bounded 15, read-only, fail-open к clarification — OK
- limit clamp bounded MAX_PEOPLE=15 — OK
- draft_policy capture broadening: любой адрес из реального tool-result verified; confirm-time card gate сохраняется — не security regression
- новых блокеров нет; стоящие находки cycle-3 (drafts вне create_pending_action, TOCTOU, admin fallback) остаются documented limitations

### Sync с main:
- main НЕ 4d4dba1f — уже **9e6227c2** (+160 коммитов, PR #73/#78 frontend/stickers)
- **overlap файлов наш diff vs main = 0** — merge должен быть чистым
- merge выполнять ТОЛЬКО после завершения прогонов (working tree = измеряемый код)

## Известные честные остатки (для отчёта)
- ms_26: модель ре-исследует вместо attach — prompt-правило корректное, ограничение следования модели
- pre-existing mock-fail: test_claude_transport_keeps_recipient_arguments (падает и без наших изменений)
- PG gate: 5 passed/22 skipped — нет живого PostgreSQL в контуре
- act_07: цепочка резолва работала, драфт отклоняла валидация — capture fix применён, верифицируется прогоном

## Осталось после прогонов
1. Анализ dev+holdout (категории, честный %, NO_CHECK)
2. fast-path premature termination verdict по ms_* сценариям
3. merge main (чистый), pytest gates на интегрированном HEAD
4. Финальный отчёт AI_A11_INTELLIGENCE_REPORT.md + PR #74 + GO/NO-GO
5. A11_FIX_CATEGORIZATION.md уже написан — включить в отчёт


## КРИТИЧЕСКИЙ БЛОКЕР — биллинг провайдеров (session 3, ~11:40)
- RouterAI: 402 Insufficient balance — hard zero, прогоны abort'нулись (provider_outage fail-fast сработал корректно)
- OpenRouter fallback (pre-approved в harness): работает, но кредиты минимальны — 402 при ПАРАЛЛЕЛЬНЫХ in-flight запросах
- Решение: прогоны ТОЛЬКО последовательно, по одному. final_holdout запущен solo в 11:36 (~3мин/сценарий с учётом retries — медленно)
- Прогресс чекпоинтится — resume банковает завершённые сценарии, даже если кредиты кончатся
- Если кредиты иссякнут до конца: нужно пополнение RouterAI или OpenRouter, затем --resume 1 продолжить
- HOLDOUT ПРИОРИТЕТ: holdout важнее для acceptance — он идёт первым; dev вторым (--resume 0 когда holdout завершится)
- Команда продолжения dev: то же что _launch_seq.ps1 но --label final_dev --split dev
- Corpus v13 зафиксирован: sha 0fb9a1033758, act_01/act_03 разметка-clarification исправлена по продуктовому решению (НЕ по результатам holdout — противоречие найдено через dev smoke act_01)
- HEAD измерения: 5e115ad1
