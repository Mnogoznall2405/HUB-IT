# A14 KB FTS Retrieval Prototype

## Scope

This branch is a dependent A14 prototype on top of the A11 release-candidate SHA `cae317fd`. It changes only the AI knowledge-base retrieval path and its PostgreSQL indexes. It does not affect production until merged, explicitly enabled, and released through the normal migration/deployment process.

## Problem

Before this change:

- the Python fallback loaded all `app.ai_kb_chunks` rows and scored them in application memory;
- the existing PostgreSQL adapter used the `'simple'` FTS configuration, which is weak for Russian morphology;
- SQL `LIMIT` was applied before ACL filtering in Python, so accessible rows could be hidden behind inaccessible rows;
- the query shape did not exactly match an immutable index expression;
- fallback coverage counted Russian stopwords that can never match a `tsvector`;
- exact inventory numbers could be cross-matched by trigram fallback;
- omitting `current_user` bypassed ACL filtering in the fallback implementation;
- tags and ACL ownership metadata were not complete inputs to the index rebuild hash.

## Implemented design

`backend/ai_chat/retrieval_interface.py` implements a staged PostgreSQL retrieval pipeline:

1. strict Russian FTS with `plainto_tsquery('russian', query)`;
2. exact identifier lookup for inventory/error-code-like tokens containing at least four digits when strict FTS has no hit;
3. bounded OR Russian FTS with token coverage if strict/exact search has no hit;
4. pg_trgm per-token word-similarity fallback for typos and morphology outliers;
5. Python scanner only when PostgreSQL/FTS is unavailable, disabled, or errors.

Russian stopwords are removed from fallback coverage by asking PostgreSQL itself which raw tokens produce a non-empty Russian `tsvector`. This avoids counting words such as `что`, `если`, `как`, and `не` in the coverage denominator. Coverage is adaptive: `n-1` meaningful tokens for up to three tokens, `n-2` for longer natural-language queries, always at least one.

Exact identifiers are constrained by boundary-aware literal matching. This intentionally prevents fuzzy or prefix cross-matching of nearby inventory numbers such as `88123`, `88124`, and `881234`; a wrong inventory number is safer as a miss than as a confident fuzzy hit.

The runtime document expression is exactly:

```sql
title || ' ' || content
```

Both columns are non-null in the schema. Removing `coalesce(...)` avoids expression-index mismatch caused by SQLAlchemy bind parameters and generic plans.

The trigram predicate uses the indexable commutator shape:

```sql
lower(title || ' ' || content) %> token
```

The implementation does not use whole-query trigram similarity; the baseline showed that shape is unsuitable for long natural-language queries.

## Rollback and feature flag

PostgreSQL hybrid retrieval is disabled by default. It is used only when:

```text
AI_KB_PG_HYBRID_FTS_ENABLED=1
```

Otherwise the existing Python scanner remains in force. This is the intended rollback path while the prototype is evaluated.

Template-document retrieval deliberately remains on the Python scoring contract. The first prototype attempt to use PostgreSQL for templates was rejected in review because raw `ts_rank_cd`/`word_similarity` scores are incompatible with the existing integer auto-send confidence contract (`12/+8`). Fuzzy template recall must not weaken the safety of file auto-delivery; a separate calibrated scoring design is required before PostgreSQL template retrieval is enabled.

## ACL design

ACL is encoded in SQL before `LIMIT` using the same metadata fields consumed by `can_view_kb_item`:

- global or invalid/missing scope normalized as global;
- private owner by `owner_user_id` or `created_by` username;
- department visibility through member/manager department ids;
- department-managers visibility through manager department ids;
- KB manage-all/admin bypass consistent with the existing policy.

Department membership ids are resolved once before opening the retrieval session, avoiding nested database lookups while the retrieval connection is checked out.

Rows are checked again in Python before payload construction as defense in depth. If `current_user` is omitted, retrieval returns no rows. This is intentionally fail-closed for future call-site mistakes; all known production AI call sites pass the authenticated user.

## Index content and rebuild inputs

The indexed article text now includes tags, and `_KB_INDEX_LAYOUT_VERSION` is `3`. The content hash used to decide whether a chunk set must be rebuilt now includes category, tags, ownership, creator, visibility, and department metadata in addition to content and attachment inputs. This reduces stale metadata after a sync, but does not eliminate the authoritative-source freshness window described below.

## Migration

`20261129_0187_ai_kb_hybrid_search_indexes` adds PostgreSQL-only indexes:

- `ix_app_ai_kb_chunks_fts_russian` on `to_tsvector('russian', title || ' ' || content)`;
- `ix_app_ai_kb_chunks_trgm_lower` on `lower(title || ' ' || content) gin_trgm_ops`.

The existing simple index is left intact for rollback/compatibility. SQLite and chat-only scoped runs are no-ops. `pg_trgm` is created with `CREATE EXTENSION IF NOT EXISTS`, consistent with existing PostgreSQL migrations. If an index with the same name already exists but has an incompatible definition, the migration fails explicitly instead of silently reusing it.

Plain `CREATE INDEX` blocks writes while allowing reads. Isolated rehearsal is fast on an empty/small test table, but production timing, lock waits, table/index size, free space, and maintenance-window requirements are not yet measured. Production migration remains forbidden without a separate owner-approved runbook.

## Verification performed locally

Latest focused gates on this branch:

- `tests/test_ai_kb_retrieval.py`: **29 passed**;
- `tests/test_ai_kb_retrieval_pg.py`: **6 passed** on isolated PostgreSQL, covering Russian morphology, a typo case that cannot match FTS and therefore reaches trigram fallback, natural-language stopword coverage, exact inventory identifiers, ACL-before-LIMIT, private owner visibility, and department/manager visibility;
- `tests/test_ai_new_tools.py tests/test_ai_kb_retrieval.py tests/test_ai_kb_retrieval_pg.py`: **66 passed**;
- migration rehearsal on isolated PostgreSQL: fresh/repeat `scope=all`, `scope=app`, `scope=chat`, plus `0186 -> 0187 -> downgrade 0186 -> re-upgrade`: **PASS** (`a14mig878fe15582`, elapsed 14.0s);
- `EXPLAIN` on isolated PostgreSQL with `enable_seqscan=off` showed bitmap index scans using both test-created expression indexes for the exact runtime document shapes. This is index-capability evidence on a tiny table, not production sizing evidence.

## Remaining limits and non-goals

- This is not semantic/vector retrieval. Synonym/paraphrase recall remains limited.
- The staged pipeline stops at the first stage with hits; it does not merge strict and fallback result sets.
- Retrieval ACL still primarily evaluates indexed metadata. Authoritative KB state can change inside the index freshness window; this pre-existing architecture issue remains a production-GO security blocker and must be closed by authoritative revalidation or an equivalent design before merge/release.
- `%>` candidate generation uses the database `pg_trgm.word_similarity_threshold` GUC; coverage still enforces the explicit `0.6` threshold. Production GUC evidence is required before enablement.
- No larger fixed golden corpus has been run against the implementation yet.
- No production-like volume EXPLAIN or latency benchmark has been run yet.
- No production deployment, production migration, production data, or paid provider calls were used.

These are prototype gates, not production GO evidence.
