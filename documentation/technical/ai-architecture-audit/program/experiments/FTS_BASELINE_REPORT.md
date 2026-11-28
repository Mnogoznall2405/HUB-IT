# FTS baseline report — OSS-01 / B-007 / A14 research

## Status

Local, non-paid, synthetic-only baseline completed on isolated PostgreSQL. This is decision evidence for A14 research, not production proof and not a production implementation.

Artifacts:

- Harness: `experiments/fts_baseline.py`
- Raw JSON result: `experiments/fts_baseline_result.json`
- Database: disposable isolated PostgreSQL database `a14ftsbench`
- Corpus: 1012 synthetic rows (1000 filler + 12 target rows), 13 hand-written Russian test cases
- LLM/provider calls: 0
- Production data: none

## Why this baseline exists

The A11 knowledge-base retrieval path does not use PostgreSQL FTS. `backend/ai_chat/retrieval.py` loads all `AppAiKbChunk` rows and scores them in Python. This creates three risks:

1. memory/network cost grows linearly with KB size;
2. ACL filtering happens after broad row materialization rather than inside the bounded query;
3. the existing PostgreSQL FTS index is unused.

The baseline compares the current scoring shape with candidate PostgreSQL FTS/trigram strategies before any A14 implementation.

## Test corpus and cases

Target rows cover:

- exact VPN instruction;
- morphology variants (`настройках`, `подключения`, `сканирование`, `резервного`);
- typo `падключение` for `подключение`;
- semantic synonym/paraphrase `восстановить доступ` / `сброс пароля`;
- exact inventory number control;
- negative queries with no expected hits;
- private ACL control.

The private case uses a deliberately broad query token (`сервер`) that also appears in filler rows. It verifies that private rows are excluded before ranking.

## Results

| Algorithm | Hit@1 | Hit@3 | False-positive cases | Avg latency, synthetic 1012-row corpus |
|---|---:|---:|---:|---:|
| current Python substring approximation | 0.80 | 0.90 | 1 | 2.497 ms |
| PG FTS `simple`, strict AND | 0.30 | 0.30 | 0 | 0.232 ms |
| PG FTS `russian`, strict AND | 0.70 | 0.70 | 0 | 0.284 ms |
| PG FTS `russian`, bounded OR ranked | 0.90 | 0.90 | 1 | 3.205 ms |
| pg_trgm whole-query similarity | 0.20 | 0.20 | 0 | 1.360 ms |
| pg_trgm token coverage | 0.90 | 0.90 | 0 | 3.334 ms |
| hybrid: strict Russian FTS, then bounded OR, then trigram token coverage | **1.00** | **1.00** | **0** | 3.128 ms |

Important interpretation:

- These latencies are only comparative smoke measurements on the 1012-row local corpus over an already-open local connection.
- The current Python implementation additionally materializes all rows through the application layer; this harness approximates scoring locally and therefore understates real application overhead at larger corpus sizes.
- The perfect hybrid score is a small-corpus directional result only. It must not be treated as a 95% production-quality benchmark.

## Failure analysis

### Current Python substring shape

Fails:

- typo case `падключение` → no hit;
- private ACL case → broad substring ranking returns filler rows that mention the same token.

The ACL failure is especially important: even though the implementation filters private rows, filtering after broad candidate materialization can fill the small `limit` with irrelevant public rows and cannot guarantee correct ACL-aware ranking before `LIMIT` at database level.

### FTS `simple`

FTS `simple` performs no useful Russian morphology. It misses normal inflections and is unsuitable as the primary retrieval configuration. The existing `simple` GIN index should not be treated as evidence that Russian FTS is solved.

### FTS `russian`, strict AND

Strict AND has excellent precision and good latency, but misses cases where one token is absent from the document even though the overall intent is clear.

### FTS `russian`, bounded OR

Bounded OR improves recall but can create false-positive hits for broad/negative queries. It needs a floor, token coverage, strict-first ordering, or another gate.

### pg_trgm whole-query similarity

Whole-query trigram similarity is the wrong shape for long natural-language queries: long nonmatching filler text in both query and document dilutes the score.

### pg_trgm token coverage

Per-token word similarity/coverage handles the typo case and performs strongly, but it is not a semantic synonym solution by itself.

### Hybrid candidate

The best local candidate is:

1. strict Russian FTS first;
2. if insufficient, bounded OR Russian FTS with a ranking/token gate;
3. if still insufficient, trigram per-token coverage for typos and morphological outliers;
4. always enforce ACL before `LIMIT`;
5. preserve exact inventory-number behavior as a regression control.

## Index and EXPLAIN evidence

The harness created:

- `fts_simple_gin` on `to_tsvector('simple', title || content)`;
- `fts_russian_gin` on `to_tsvector('russian', title || content)`;
- `trgm_lower_gin` on `lower(title || content)` using `gin_trgm_ops`.

Evidence from the saved JSON:

- strict Russian FTS used `Bitmap Index Scan on fts_russian_gin` by default;
- on the small 1012-row test table PostgreSQL chose a sequential scan for the trigram query by default;
- forcing `enable_seqscan=off` proved that the functional trigram index can satisfy the predicate through `Bitmap Index Scan on trgm_lower_gin`.

Critical operator-orientation detail:

- `token <% document` did not expose an indexable shape;
- the commutator form `document %> token` is the indexable word-similarity shape.

This must be preserved in any implementation and verified with `EXPLAIN` on production-like data volume.

## Security/ACL requirement

The baseline is not a complete ACL implementation. It only used a simplified `visibility='public'` predicate.

Production KB access is richer:

- global;
- private owner/creator;
- department member;
- department manager;
- KB manage-all permission/admin.

Therefore A14 implementation must not copy this baseline literally. It must encode the same `can_view_kb_item` policy into SQL predicates, or use a pre-filter design proven not to leak titles/content and not to truncate results incorrectly. ACL must be applied before `LIMIT`.

## Decision evidence for OSS-01

PostgreSQL FTS + pg_trgm remains a valid first candidate for A14 retrieval improvements:

- no new service;
- no mandatory Redis/vector database;
- uses existing PostgreSQL infrastructure;
- materially better Russian morphology and typo behavior than current substring scoring;
- indexable with correctly shaped expressions.

It does **not** solve semantic synonym retrieval by itself. Semantic/vector retrieval may still be evaluated later, but only after the simpler PostgreSQL baseline is implemented safely and measured on a realistic corpus.

## Next evidence required before implementation merge

1. Correct ACL-aware SQL predicate review against `can_view_kb_item`.
2. Migration design for Russian FTS and functional trigram indexes with upgrade/downgrade proof.
3. SQLite fallback behavior for local/test environments.
4. Retrieval unit tests for morphology, typo, negative, exact inventory number and ACL-before-limit.
5. Realistic synthetic corpus benchmark at larger scale, with EXPLAIN and latency distribution.
6. Differential comparison against current retrieval output on a fixed synthetic golden set.
7. Independent review of ranking/fallback gates to avoid broad OR false positives.

