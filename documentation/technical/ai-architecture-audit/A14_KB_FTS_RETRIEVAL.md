# A14 KB FTS Retrieval Prototype

## Scope

This branch is a dependent A14 prototype on top of the A11 release-candidate SHA `cae317fd`. It changes only the AI knowledge-base retrieval path and its PostgreSQL indexes. It does not affect production until merged and released through the normal migration/deployment process.

## Problem

Before this change:

- the Python fallback loaded all `app.ai_kb_chunks` rows and scored them in application memory;
- the existing PostgreSQL adapter used the `'simple'` FTS configuration, which is weak for Russian morphology;
- the SQL query applied `LIMIT` before ACL filtering in Python, so accessible rows could be hidden behind inaccessible rows;
- the query shape used `concat_ws`, while the live immutable index expression uses `coalesce(...) || ' ' || coalesce(...)`; `concat_ws` is only `STABLE` and cannot be used in a PostgreSQL index expression;
- template retrieval always fell back to the Python scanner;
- omitting `current_user` bypassed ACL filtering in the fallback implementation.

## Implemented design

`backend/ai_chat/retrieval_interface.py` now uses a staged PostgreSQL retrieval pipeline:

1. strict Russian FTS with `plainto_tsquery('russian', query)`;
2. bounded OR Russian FTS with token coverage if strict search has no hit;
3. pg_trgm per-token word-similarity fallback for typos and morphology outliers;
4. Python scanner only when PostgreSQL/FTS is unavailable or errors.

The trigram predicate uses the indexable commutator shape:

```sql
lower(coalesce(title, '') || ' ' || coalesce(content, '')) %> token
```

The implementation does not use whole-query trigram similarity; the baseline showed that shape is unsuitable for long natural-language queries.

## ACL design

ACL is encoded in SQL before `LIMIT` using the same metadata fields consumed by `can_view_kb_item`:

- global or invalid/missing scope normalized as global;
- private owner by `owner_user_id` or `created_by` username;
- department visibility through member/manager department ids;
- department-managers visibility through manager department ids;
- KB manage-all/admin bypass consistent with the existing policy.

The row is also checked again in Python before payload construction as defense in depth. If `current_user` is omitted, only globally visible chunks are allowed. This is intentional fail-closed behavior for future call-site mistakes; all known production AI call sites pass the authenticated user.

## Migration

`20261129_0187_ai_kb_hybrid_search_indexes` adds PostgreSQL-only indexes:

- `ix_app_ai_kb_chunks_fts_russian` on `to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(content, ''))`;
- `ix_app_ai_kb_chunks_trgm_lower` on `lower(coalesce(title, '') || ' ' || coalesce(content, '')) gin_trgm_ops`.

The existing simple index is left intact for rollback/compatibility. SQLite and chat-only scoped runs are no-ops. `pg_trgm` is created with `CREATE EXTENSION IF NOT EXISTS`, consistent with existing PostgreSQL migrations.

## Limits and non-goals

- This is not semantic/vector retrieval. Synonym/paraphrase recall remains limited.
- Fallback token coverage is intentionally strict and uses at most 12 tokens as a cost-control bound. Larger-corpus evaluation may tune this only through predeclared experiments.
- The staged pipeline stops at the first stage with hits; it does not merge strict and fallback result sets.
- Exact inventory-number behavior must remain a regression control in future golden-set evaluation.
- No production deployment, production migration, or production data was used.

## Verification performed locally

- `tests/test_ai_kb_retrieval.py`: 25 passed.
- `tests/test_ai_kb_retrieval_pg.py`: 4 passed on isolated PostgreSQL, covering morphology, typo fallback, ACL-before-LIMIT, private owner visibility, department/manager visibility and template retrieval.
- Migration rehearsal on isolated PostgreSQL: fresh/repeat `scope=all`, `scope=app`, `scope=chat`, plus `0186 -> 0187 -> downgrade 0186 -> re-upgrade`: PASS.
- `tests/test_ai_new_tools.py tests/test_ai_kb_retrieval.py`: 56 passed.

These are prototype gates, not production GO evidence. A larger fixed golden corpus and independent review are still required.
