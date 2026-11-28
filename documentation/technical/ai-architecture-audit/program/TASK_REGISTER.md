# HUB Assistant Program — TASK REGISTER

Обновлено: 2026-11-29. Статусы: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`, `NO-GO`. Каждая задача должна иметь доказательство, точный SHA/PR и следующий проверяемый шаг.

## A11 — Release Candidate closure

| ID | Приоритет | Задача | Первопричина / доказательство | Решение / файлы | Тесты и результат | PR / SHA | Статус | Следующий шаг |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A11-001 | P0 | Независимое ревью PR #105 | release candidate требовал independent review перед gate | security/migration review выполнены; P0 не найдено, найдены P1/P2 | см. `AI_A11_RELEASE_EVIDENCE.md` | PR #105, base `455c160b` | DONE | зафиксировать финальный verdict после оставшихся gate |
| A11-002 | P0 | Закрыть emergency enqueue race | runtime snapshot читался до включения emergency, locked bot не проверялся | `WEB-itinvent/backend/ai_chat/service.py` | focused suite 46 passed; regression 302 passed | PR #105 `0321938e` | DONE | включить в exact-SHA final gate |
| A11-003 | P0 | Закрыть emergency bypass через re-bind | confirm смотрел только текущего mapping bot | `WEB-itinvent/backend/ai_chat/action_cards.py`, `tests/test_ai_bot_access.py` | regression test re-bind passed | PR #105 `0321938e` | DONE | добавить PG/HTTP confirm-matrix при следующем gate |
| A11-004 | P1 | Устранить утечку `latest_run_error` | free-text runtime error мог содержать пользовательские данные | `service.py`, `tests/test_ai_manager_observability_redaction.py` | 2/2 redaction tests passed | PR #105 `0321938e` | DONE | сверить UI expectations |
| A11-005 | P1 | Выровнять task confirm permissions | draft требовал `tasks.write`, confirm исполнял с `tasks.read` | `action_cards.py` | regression 302 passed | PR #105 `0321938e` | DONE | добавить permission-recheck matrix для всех mutating actions |
| A11-006 | P1 | Исправить sticker migration structural test | test пинил устаревший head `0185` после добавления `0186` | `tests/test_chat_sticker_favorites.py` | structural test passed | PR #105 `0321938e` | DONE | контроль через alembic heads в CI/gate |
| A11-007 | P0 | Migration gate PostgreSQL | schema change `ai_bots.emergency_disabled_at` | `.codex_tmp/verify_a11_migration_gate.py` local helper; миграция `20261128_0186` | PASS на isolated PG 17.6, включая downgrade/re-upgrade | PR #105 `0321938e` | DONE | повторить на final SHA после любых новых изменений |
| A11-008 | P0 | PG serialization gate | one-running-per-conversation и FIFO критичны | `tests/test_ai_run_serialization_pg.py` | 22 passed на isolated PG 17.6 | PR #105 `455c160b` measurement; code unchanged в `0321938e` | DONE | повторить на final SHA перед GO |
| A11-009 | P0 | Full frozen dev/holdout benchmark 205 scenarios | прежний measurement выполнен на PR #74 `93f6a770`, не на PR #105 | benchmark pack теперь интегрирован, но full run не выполнен на exact final SHA | не запущен: бюджет не подтверждён | PR #105 `2d5b37c5` | BLOCKED | подготовить смету и получить budget approval; использовать только approved isolated contour |
| A11-010 | P1 | Интегрировать benchmark harness/corpus без raw artifacts | в PR #105 отсутствовал reproducible measurement pack | `a9_real_run.py`, `bench_seed.py`, `bench_corpus_gen.py`, frozen corpus; corpus hash reconciled despite stale `a11-v12` metadata | seed-only PASS: 205 scenarios, provider_calls=0; py_compile PASS | PR #105 `2d5b37c5` | DONE | независимо проверить diff pack перед использованием как evidence |
| A11-011 | P1 | Process-level worker recovery proof | watchdog включён не по умолчанию и не задан в PM2 ecosystem | cross-process child claim + kill + real watchdog CAS + FIFO release в `tests/test_ai_run_serialization_pg.py` | 23/23 PG serialization tests passed на isolated PostgreSQL 17.6 | PR #105 `fbacbcaa` | DONE | отдельно решить production watchdog configuration |
| A11-012 | P2 | Разобрать Claude transport mock failure | test падает из-за transport/mock, не создавая карточку | `tests/test_e2e_ai_draft_reliability.py` | FAIL воспроизведён; 0 cards, `SimpleNamespace`/`pop from empty list` | PR #105 | TODO | исправить harness или доказать production-дефект |
| A11-013 | P1 | Зафиксировать production routing flags | JEV ceilings default OFF; fast path ранее разрушал качество | `service.py`, прошлые measurements | нет финального independent holdout на candidate | owner decision required | BLOCKED | подготовить варианты решения с evidence/cost/quality |

## A12 — Intelligent Fast Path V2

| ID | Приоритет | Задача | Доказательная база | Статус | Следующий шаг |
| --- | --- | --- | --- | --- | --- |
| A12-001 | P0 | Сформировать acceptance criteria и corpus subset для premature termination | fast-path cohort в прежнем измерении 56.5% PASS против 95.7% non-fast-path | TODO | после интеграции harness выделить deterministic local validators и paid eval plan |
| A12-002 | P0 | Переработать fast path только как sufficiency-gated optimization | прежний fast path завершал drill-down/retry/research раньше времени | TODO | architecture review перед кодом; не включать по умолчанию |
| A12-003 | P1 | Добавить regression tests на drill-down/retry/file rendering | выявленные дефекты read_29/31/32/34 и fallback renderer | TODO | сначала воспроизвести на exact candidate SHA локально |

## A13 — Agent Planning Engine

| ID | Приоритет | Задача | Доказательная база | Статус | Следующий шаг |
| --- | --- | --- | --- | --- | --- |
| A13-001 | P0 | Спроектировать planning contract без нового runtime/service | требуется сложное планирование, но не новый LangGraph runtime | TODO | подготовить ADR и интерфейс поверх существующего Python worker |
| A13-002 | P1 | Определить planner-only eval subset | COMPLEX/MULTISTEP слабые категории прежнего benchmark | TODO | использовать frozen corpus; не менять критерии после измерений |

## A14 — RAG V2 / OSS-01, OSS-03, OSS-04

| ID | Приоритет | Задача | Доказательная база | Статус | Следующий шаг |
| --- | --- | --- | --- | --- | --- |
| A14-001 | P0 | PG FTS baseline: `'simple'` vs `'russian'`, AND/OR fallback, ACL до LIMIT, pg_trgm | PR #15 показал качество поиска как ключевой gap; текущий код нужно сверить | TODO | isolated PG experiment + EXPLAIN; см. `OPEN_SOURCE_REGISTER.md` OSS-01 |
| A14-002 | P1 | Vector/hybrid pilot FastEmbed+pgvector | только если improved FTS недостаточен | DEFERRED | после A14-001 |
| A14-003 | P1 | Hybrid rerank bge-reranker-v2-m3 | только после reproducible retrieval baseline | DEFERRED | после A14-002 |

## A15–A24 — зарегистрированные тематические этапы

| ID | Этап | Приоритет | Текущий статус | Первый проверяемый шаг |
| --- | --- | --- | --- | --- |
| A15-001 | Memory V2 | P1 | TODO | inventory current memory semantics, isolation, evidence, reset/delete contracts |
| A16-001 | Tool Calling V2 | P0 после A11 | TODO | полная инвентаризация зарегистрированных tools, permission/effect audit matrix |
| A17-001 | Model Routing | P1 | TODO | cost/quality routing matrix на frozen representative subsets |
| A18-001 | Parallel Tool Execution | P1 | TODO | безопасное параллельное выполнение только read-only independent tools, PG load proof |
| A19-001 | Answer Verification | P1 | TODO | определить cheap deterministic verification и когда нужен LLM second pass |
| A20-001 | Document Intelligence | P1 | TODO | inventory current extractors/OCR, затем RapidOCR pilot OSS-05 |
| A21-001 | Streaming & UX | P2 | TODO | contract-first UX audit для Web/Desktop/Android без раскрытия sensitive traces |
| A22-001 | Observability & Cost Control | P0 для эксплуатации | TODO | дополнить собственный ai_run_profile/usage до решения о внешних сервисах |
| A23-001 | Eval Infrastructure / OSS-02 | P0 независимо от A11 | TODO | Promptfoo pilot design: versions, telemetry, local provider, synthetic-only corpus |
| A24-001 | Rust V2 Compatibility | P0 continuous | IN_PROGRESS | поддерживать contract matrix AI Runs/actions/outbox/WS; не переносить AI в Rust core |

## Постоянные задачи

| ID | Задача | Статус | Следующий шаг |
| --- | --- | --- | --- |
| OPS-001 | Обновлять program register после каждого commit/PR gate | IN_PROGRESS | обновить STATUS/BENCHMARKS после публикации PR #107 update |
| OPS-002 | Независимое ревью каждого значимого diff | IN_PROGRESS | для следующего benchmark pack провести diff review до использования как evidence |
| OPS-003 | Не переносить raw artifacts/scratch scripts в release PR | ACTIVE | переносить только curated harness/docs/tests |
