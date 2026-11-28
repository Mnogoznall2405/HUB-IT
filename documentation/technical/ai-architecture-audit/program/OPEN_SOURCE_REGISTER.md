# HUB Assistant Program — OPEN SOURCE REGISTER

Обновлено: 2026-11-29. Регистр фиксирует кандидатов из roadmap §6. Версии, CVE, совместимость и telemetry должны проверяться по upstream непосредственно перед внедрением; записи ниже — программное состояние, а не финальное security approval.

## Правила интеграции

- Не исполнять непроверенные install scripts.
- Не скачивать модели с remote code execution по умолчанию.
- Не передавать корпоративные данные наружу.
- Проверять лицензии кода и весов, транзитивные зависимости, telemetry/egress, Windows x64/Python/PostgreSQL compatibility, CPU/RAM/диск, rollback.
- Каждый компонент получает отдельный PR/benchmark/GO-NO-GO-BLOCKED-DEFERRED.
- Новые production extensions/services/network egress требуют отдельного разрешения.

## OSS-01 — PostgreSQL FTS + pg_trgm / A14

**Upstream:** PostgreSQL documentation FTS и pg_trgm.

**Статус:** BASELINE DONE; dependent implementation PROTOTYPE pushed in `feat/a14-kb-fts-retrieval` head `d7eb6f8f`. Первый независимый non-paid эксперимент завершён на synthetic isolated PostgreSQL; prototype ожидает independent review и не merge-ready.

**Реальная проблема:** русский поиск KB должен работать по смыслу/словоформам/опечаткам, не только точному совпадению; старая A2 задача не считается закрытой без PG-backed proof. Дополнительно текущий A11 retrieval разделён: Python fallback сканирует все chunks, а существующий PostgreSQL FTS adapter использует `'simple'` и применяет ACL после `LIMIT`.

**Подтверждённая гипотеза:** `'simple'` FTS недостаточен для русской морфологии. Лучший локальный кандидат — strict Russian FTS с контролируемым fallback: bounded OR Russian FTS и затем pg_trgm per-token coverage для опечаток/словоформ. Это не semantic retrieval и не production proof.

**Интеграционные точки:** `WEB-itinvent/backend/ai_chat/retrieval.py`, `WEB-itinvent/backend/services/kb_service.py`, retrieval/search SQL, существующие индексы/миграции PostgreSQL.

**Benchmark:** `B-007` в `BENCHMARKS.md`; report/harness/raw JSON в `experiments/`. Результат synthetic 1k rows: hybrid Hit@1/Hit@3 = 1.0/1.0, 0 false-positive cases; current substring approximation 0.8/0.9, 1 false-positive/ACL-control case. Latency — только comparative smoke evidence.

**Риски:** регрессия exact matches, неправильный index expression/operator orientation, ACL после limit, рост cost запросов, неправильная обработка дефисов/составных терминов, broad OR false positives, SQLite fallback divergence.

**Rollback:** retrieval feature flag/default-off config; не использовать новый индекс/конфигурацию; revert migration/config, если изменение войдёт в схему.

**Решение:** CONDITIONAL GO for dependent prototype only: PostgreSQL FTS + pg_trgm остаётся первым кандидатом A14 без новых сервисов. Prototype подтверждает implementability, но перед merge требуются independent review, larger synthetic/fixed golden corpus, exact inventory controls, EXPLAIN на production-like volume, broad regression characterization и coordination после A11. No production decision.

## OSS-02 — Promptfoo / A23

**Upstream:** `https://github.com/promptfoo/promptfoo`.

**Статус:** PLANNED pilot design.

**Реальная проблема:** нужна независимая eval/redteam infrastructure поверх существующего harness, не заменяющая pytest/frozen corpus.

**Проверить перед установкой:**

- точную версию/release и maintenance;
- license;
- telemetry/network egress и способы отключения;
- transitive dependencies и supply-chain risk;
- support for local/HTTP provider;
- deterministic CI mode without external calls;
- cost controls for live eval.

**Интеграционные точки:** synthetic eval corpus, existing A11 harness output, local backend/Ollama HTTP adapter.

**Запреты:** no real personal data, no external redteam with confidential data, no replacement for existing pytest/security gates.

**Решение:** NO DECISION.

## OSS-03 — FastEmbed + pgvector / A14

**Upstream:** `https://github.com/qdrant/fastembed`, `https://github.com/pgvector/pgvector`.

**Статус:** DEFERRED until OSS-01 baseline.

**Реальная проблема:** semantic recall для русского KB, если improved lexical search не достигает цели.

**Архитектурное ограничение:** pgvector — extension существующего PostgreSQL, не новая СУБД. Production extension, schema migration и indexing job требуют отдельного approval и rollback plan.

**Проверить перед внедрением:**

- exact package versions, licenses, model licenses;
- Windows x64/Python compatibility;
- PostgreSQL version compatibility and availability on target server;
- backup/restore behavior for extension/vector indexes;
- model download integrity/offline packaging;
- CPU/RAM/disk cost embeddings and index build;
- dimension/model metadata, stale/deleted chunks, idempotency;
- ACL filtering in both retrieval paths before limit;
- fallback to FTS.

**Feature flag:** `AI_KB_VECTOR_ENABLED=0` по умолчанию, если реализация будет одобрена.

**Решение:** NO DECISION / DEFERRED.

## OSS-04 — FlagEmbedding / bge-reranker-v2-m3 / A14

**Upstream:** `https://github.com/FlagOpen/FlagEmbedding`, `https://huggingface.co/BAAI/bge-reranker-v2-m3`.

**Статус:** DEFERRED until hybrid retrieval baseline exists.

**Реальная проблема:** improve ranking quality после retrieval candidate generation.

**Проверить:**

- license модели и кода;
- ONNX/CPU backend support именно для этой модели, не предполагать автоматическую поддержку FastEmbed;
- top-K/threshold;
- recall@k/MRR/nDCG, grounded answers, no-answer precision;
- latency/RAM;
- offline model distribution and version pinning.

**Решение:** NO DECISION / DEFERRED.

## OSS-05 — RapidOCR / A20

**Upstream:** `https://github.com/RapidAI/RapidOCR`.

**Статус:** PLANNED after inventory of current document extraction.

**Реальная проблема:** локальный OCR русских сканов/актов/накладных без передачи документов наружу.

**Интеграционные точки:** existing `document_extractors`, shared document conversion/runtime paths, page text detection.

**Benchmark:** цифровые PDF, сканы, акты, накладные, таблицы; CER/WER, table fidelity, wall time, CPU/RAM/GPU, failure modes. Только synthetic/authorized corpus.

**Проверить:** license, native dependencies, Windows compatibility, model packaging, offline behavior, memory bounds, cancellation/timeouts.

**Rollback:** `AI_OCR_LOCAL_ENABLED=0` или отсутствие интеграции; current extractor path сохраняется.

**Решение:** NO DECISION.

## Отложенные/не принятые кандидаты

| Компонент | Текущее решение | Причина / условие пересмотра |
| --- | --- | --- |
| LiteLLM | DEFERRED | `shared/llm` обязательная граница; multi-provider gateway потребность не доказана |
| Langfuse / Phoenix / OpenTelemetry external services | DEFERRED | сначала закрыть собственные ai_run_profile/usage; новые сервисы требуют отдельного согласования |
| Mem0 | REJECTED as replacement | не заменяет собственную memory evidence/CAS/isolation; embeddings могут быть переиспользованы независимо |
| LangGraph | REJECTED as replacement | не создавать второй runtime; пересмотр только при измеренных ограничениях собственного планировщика |
| FastMCP | DEFERRED | тонкий adapter только при реальном внешнем MCP consumer и отдельном согласовании |
| Docling | DEFERRED | пилот только если RapidOCR/current extractors не справляются со сложными layout/таблицами |
| Ragas / DeepEval / DSPy / Instructor | DEFERRED | оценивать при конкретном пробеле, не заменять существующие контракты |
| ParadeDB / NeMo Guardrails / Unstructured / GPTCache / LLMLingua / pg_textsearch | NO-GO by default | нет актуальной доказанной потребности; требуется новое evidence и согласование |

## Immediate open-source work plan

1. OSS-01 local FTS/pg_trgm baseline — first, no external dependency cost.
2. OSS-02 Promptfoo security/version/telemetry review — can proceed independently before code integration.
3. OSS-03/04 remain deferred until retrieval baseline proves need.
4. OSS-05 inventory current OCR/extractors before installing anything.
