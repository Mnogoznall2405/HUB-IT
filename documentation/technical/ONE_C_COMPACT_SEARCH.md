# 1C Compact Catalogue Search (D-lite)

Derived search index for 1C nomenclature/warehouses. **Disabled by default.**  
Production cutover requires a separate approved stage (shadow → canary → engine flip).

## Tables (`app`)

| Table | Role |
|---|---|
| `one_c_catalog_search_documents` | 1 row/entry: `search_text` + `search_tsv` (`simple`) |
| `one_c_catalog_search_token_stats` | token → frequency (suggest + typo candidates) |
| `one_c_catalog_search_index_state` | `building\|ready\|failed\|stale`; readers require `ready` |

Does **not** bulk-update `one_c_catalog_entries`. Old `one_c_catalog_tokens` keep writing until a later stage.

## Flags (fail-closed defaults)

See `.env.example`:

- `WAREHOUSE_1C_CATALOG_SEARCH_ENGINE=tokens|compact`
- `WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT=0` (deterministic 0–100; needs opaque `routing_user_key`)
- `WAREHOUSE_1C_CATALOG_SEARCH_CANARY_ALLOWLIST=` (optional opaque keys)
- `WAREHOUSE_1C_CATALOG_SEARCH_SHADOW=0`
- `WAREHOUSE_1C_CATALOG_WRITE_COMPACT=0`
- `WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED=0`
- `WAREHOUSE_1C_CATALOG_TYPO_FALLBACK_ENABLED=0`
- `WAREHOUSE_1C_CATALOG_MIDTOKEN_MIN_LENGTH=3`

Invalid engine → `tokens`. Compact reader used when engine=`compact` **or** canary selects the request, **and** state=`ready`.

### Canary integration point

API/service callers of `OneCCatalogSnapshotStore.search_entries(..., routing_user_key=...)` should pass an opaque routing key (never log the raw user id). Without a key, canary percent never flips traffic (fail-closed, no random). Rollback: `SEARCH_CANARY_PERCENT=0`.

### Suggest without token-row table

When compact is selected and ready, `token_frequencies` / `suggest_token_prefixes` read `one_c_catalog_search_token_stats`. Engine=`tokens` (and canary off) keeps the legacy token-row path.

### Shadow Session isolation

Shadow workers open their own Session via `get_app_session_factory` inside the worker thread, never reuse the request Session, never commit, always close in `finally`, apply `statement_timeout`, and skip when the bounded pending queue is full.

## Query stages

1. Exact code  
2. Code prefix  
3. FTS (`catalog_query_tokens` → AND + `:*`, `simple`)  
4. Mid-token trigram on `search_text` if insufficient, all tokens ≥ 3  
5. Typo via `token_stats` similarity (optional flag; never full-entry fuzzy)

2-char queries: exact + prefix only (`pp→ippon` not required).

## Backfill

One-shot CLI (not a PM2 worker):

```powershell
python scripts/one_c_catalog_compact_backfill.py
# execute only on allowed test DB + COMPACT_BACKFILL_ENABLED=1:
python scripts/one_c_catalog_compact_backfill.py --execute --allow-enabled-flag
```

Safety: refuses `hubit_chat` / system DBs; allows only `hubit_chat_retention_test_%` / `hubit_chat_1c_search_test_%`.

## Rollback

Pre-DROP: set `WAREHOUSE_1C_CATALOG_SEARCH_ENGINE=tokens` (<1 min).  
No automatic DROP of `one_c_catalog_tokens`.

## Code

- `backend/services/one_c_catalog_compact_*.py`
- Alembic `20260804_0080_one_c_catalog_compact_search.py`
- Wired in `one_c_catalog_snapshot_service.py` (dual-write post-commit, search routing, shadow)
