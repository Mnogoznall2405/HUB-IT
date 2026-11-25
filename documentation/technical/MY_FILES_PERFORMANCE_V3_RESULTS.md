# My Files — Performance V3 Results

Branch: `perf/my-files-v3` (worktree `C:\Project\HUB-IT-v3-wt`), HEAD at measurement: `f642b3f6`.
Stand: isolated local stack — backend uvicorn on `127.0.0.1:18013` (SQLite `e2e/stack/.state-v3/app.sqlite3`), frontend `vite preview` prod build on `127.0.0.1:5184` (`preview.proxy` mirrors dev proxy). Seed: 171 folders / 16 804 files for `e2e_admin` (`e2e/artifacts/perf-audit/seed-v3.json`, reseed via `e2e/stack/reseed_v3.py`).

Scope: everyday file-manager operations — folder open, nested/shared nav, back nav, search, 1000-file open, list↔grid toggle. Backend + SQL + network + frontend.

## What was changed

### Backend / SQL
| Change | Where | Effect |
|---|---|---|
| `ix_app_my_files_owner_live_folder` `(owner_user_id, deleted_at, folder_id, created_at)` | `appdb/models.py`, alembic `20261124_0177` | listing query: full-owner scan → index seek (`SEARCH ... USING INDEX`, temp B-tree only for ORDER BY when needed) |
| `ix_app_my_files_owner_quota_cover` `(owner_user_id, deleted_at, status, expires_at, original_size_bytes)` | same | quota SUM is an index-only scan: 28 → 20 ms live |
| `include=tree,quota` on `GET /my-files` | `my_files.py` route, `_attach_listing_includes` | one round-trip instead of `listFiles`+`listFolders`+`getQuota` = 3; verified live: nav_library api_requests 2 → 1 |
| Aggregate `ETag` + `If-None-Match` → 304 | `_listing_etag_locked`, route | unchanged revalidation: 87 ms / 42 KB → **20 ms / 0 B** (200→304 live). Fingerprint covers own rows **and** accessible library owners; `view=shared` stays ETag-free (revocation must re-run access checks every request) |
| Opt-in keyset pagination `?limit=&cursor=` → `next_cursor` | `_list_files_impl`, route, `MyFileListResponse` | `(created_at, id)` tiebreak; `limit` caps rows at SQL; unpaginated contract unchanged; malformed cursor → page 1. Verified live: page1/page2 5 items, 0 overlap, f10000 page of 100 < 1 ms |
| `_merge_library_results` union | `list_files` merge path | one `owner IN (...)` scan over accessible libraries instead of a full `_list_files_impl` per library (N+1 sessions/queries/collab+preview batches → 1) |
| `_folder_names_locked` targeted fetch | search + favorites/recent branches | fetches only referenced folders instead of the owner's whole folder map per listing |
| `counts_by_folder` restricted to displayed subtree, skipped for leaf folders | regular-folder branch | `file_count` GROUP BY no longer scans every live row of the owner (16.8 k → subtree IN-list); leaf folders skip the query entirely |

### Frontend
| Change | Where | Effect |
|---|---|---|
| `loadData` consolidated request + `If-None-Match` revalidation, cache reuse on 304; graceful fallback to legacy 3-request path | `MyFiles.jsx` | −2 requests per navigation; unchanged folders revalidate at ~20 ms |
| Delayed skeleton (150 ms) | `MyFiles.jsx` | no skeleton flash on sub-150 ms loads |
| Guarded empty `setState` (`clearSelection` etc.) | `MyFiles.jsx`, `useMyFilesUpload` | no-op state writes no longer schedule commits |
| `reconcileById` without per-entry `Set` allocation | `MyFiles.jsx` | SWR reconcile: two `for..in` passes |
| `getStoredUserKey()` memoized on `accountEpoch` | `useMyFilesUpload.js` | no localStorage+JSON.parse per render |
| `secondaryColumnSx`/`rowGridColumns` caches, `FILE_TYPE_KEY_BY_META` map, shared `now` in date filter | `MyFilesListItems.jsx`, `myFilesVisual.js`, `MyFiles.jsx` | ~200 fewer sx object serializations per windowed render; O(1) type-key lookup |
| `api/myFiles.js` accepts `limit`/`cursor`/`include`/`ifNoneMatch` | client | opt-in pagination + consolidated includes available to clients |
| `preview.proxy` in `vite.config.js` | tooling | prod-build perf runs proxy `/api` like dev server |

## Server-side timings (live HTTP, p50 of 5, seeded 16.8 k owner rows)

| Request | Before V3* | After V3 | Note |
|---|---|---|---|
| `GET /my-files` f10 | 44 ms | **26 ms** | counts GROUP BY was the dominant cost |
| f100 | 50 ms | **31 ms** | |
| f1000 | 123 ms | **104 ms** | serialization-bound |
| f5000 | 480 ms | **432 ms** | 4.4 MB payload; pagination exists opt-in |
| f10000 | 902 ms | **863 ms** | 8.9 MB; `limit=100` page < 1 ms |
| search `q=zebra` | — | **51 ms** | union merge, targeted folder names |
| `GET /quota` | 28 ms | **20 ms** | covering index |
| revalidation 304 | 87 ms | **20 ms** | ETag hit |

\* "Before" measured on the same stand earlier in the session (pre-counts-fix code + indexes already applied); raw probes: `e2e/stack/probe_timings_v3.py`, `probe_sql_timings.py`.

SQL floor measured directly on the seeded DB: listing index seek ~0.1 ms, subtree GROUP BY ~1–15 ms (owner-scoped before), ETag aggregate ~10 ms (count+max over 16.8 k index entries — the price of 304 capability, kept deliberately), quota SUM ~1.2 ms.

## Browser results (vite preview prod build, Chrome, n=10)

`e2e/perf/my-files-perf.mjs run --base http://127.0.0.1:5184 --label v3-final --seed seed-v3.json --runs 10` → `results-v3-final.csv` (3 468 rows) + `traces/open_route-v3-final.json`.

Baseline caveat: the dedicated `results-v3-base.csv` run died on login mid-session (31-byte header only), so `comparison.csv` is regenerated vs `results-v2-baseline.csv` — the committed pre-V3 baseline from the previous perf round. Same harness/scenario definitions, different seed IDs and an older stand port; identical volumes. Interpret nav deltas as ±noise unless noted.

Final run (`v3-final` vs pre-V3 baseline, n=10):

| Scenario | Metric | Before | After | Δ |
|---|---|---|---|---|
| `nav_library` | api_requests / settled_dom | 2 / 167 ms | **1 / 141 ms** | −50 % / −15.6 % |
| `library_expand` | api_requests / commits / settled_dom | 2 / 7 / 203 ms | **1 / 5 / 149 ms** | −50 % / −28.6 % / −26.6 % |
| `table_1000` | heap_mb p50 | 322 MB | **122 MB** | −62 % |
| `table_500` | heap_mb p50 | 439 MB | **221 MB** | −50 % |
| `table_100` | heap_mb p50 | 191 MB | **89 MB** | −54 % |
| `table_10` | heap_mb p50 | 98 MB | **73 MB** | −25 % |
| `open_route` | heap_mb p50 | 38.5 MB | **25.1 MB** | −35 % |
| `nav_into_folder` | settled_dom | 195 ms | 205 ms | +5 % (noise) |
| `nav_nested` | settled_dom | 156 ms | 163 ms | +4.5 % (noise) |
| `nav_back` | settled_dom | 152 ms | 153 ms | ±0 |
| `search_type` | settled_dom / commits | 774 ms / 32 | 762 ms / 31 | −1.6 % |
| `view_toggle` | settled_dom | 531 ms | 544 ms | +2.4 % (noise) |
| `table_sort` | settled_dom | 1 057 ms | 1 110 ms | +5 % (noise) |
| `sidebar_expand` | settled_dom | 41 ms | 61 ms | +20 ms absolute |

- Include consolidation is proven where it applies: library scenarios dropped a full round-trip (−50 % api_requests) and ~15–27 % settled time.
- Folder nav (`nav_*` ~150–205 ms) is client-render dominated; server now contributes only ~26–31 ms of it, so backend gains are inside browser noise. The win shows up as fewer requests, lower heap and the server timings table above.
- `table_*` heap reductions are the reconcile/retained-object fixes compounding with V2.2 virtualization.
- `api_bytes` is `NaN` throughout — `PerformanceObserver.transferSize` is not exposed for proxied responses in this setup; payload deltas are covered by server-side Content-Length numbers.
- `memory_nav_churn` single-sample heap growth 17.8 → 41.7 MB (n=1 each) — flagged, not conclusive; watch on next round.
- `open_reload` heap 16.6 → 35.6 MB is bimodal noise in both runs (baseline itself oscillates 16.5 ↔ 47.9).

## Concurrent load (same session, parallel listings)

`e2e/stack/probe_load.py` — N workers × 3 sequential requests, single-user cookie (server concurrency is what matters):

| Users | f100 p50 | f100 p95 | f1000 p50 | Note |
|---|---|---|---|---|
| 1 | 34 ms | 34 ms | 110 ms | |
| 5 | 189 ms | 225 ms | 916 ms | anyio tokens ~9–10 |
| 10 | 377 ms | 424 ms | 2 278 ms | |
| 20 | 728 ms | 1 111 ms | — | app pool size 5, overflow 7 |
| 50 | 1 939 ms | 3 225 ms | — | CPU-bound serialization queue |
| 100 | 3 594 ms | 6 685 ms | — | ~22 req/s ceiling for one worker |

All f100 requests returned 200 — fair queuing, no errors. The ceiling is a **single-worker CPU bound** (per-request serialization ~30–90 ms), not a my-files defect: production scales by workers; app-DB pool (size 5 + overflow 7) and `anyio` thread tokens are the queue points.

f1000 at ≥20 users showed bursts of fast (~60–270 ms) failed responses from the client side (~60–300 errors across runs) while spot-checked server responses were all 200s at ~1.7–3 s — consistent with client-side socket/connection-limit exhaustion under 8.9 MB responses, not server errors (backend stayed alive, pool overflow 7). Unconfirmed; flagged for a follow-up load round with per-error status capture.

## Regression status

- Backend: `test_my_files_service.py` + `test_my_files_api.py` + `test_my_files_folders.py` + `test_my_files_libraries_api.py` — **all green** (3 pre-existing env failures reproduced identically on the untouched baseline worktree: `test_security_scan_error_records_failing_engine`, `test_folder_share_lists_subtree_files_and_grants_download`, `test_folder_archive_grant_builds_zip`).
- New tests: cursor page-walk, malformed-cursor fallback, library union merge, FakeMyFilesService signature — `tests/test_my_files_service.py`, `tests/test_my_files_api.py`.
- Frontend: `MyFiles.test.jsx` + `MyFilesListItems.test.jsx` + `useWindowVirtualRows.test.jsx` — **49/49 green**.
- Migration 0177: upgrade / downgrade / re-run on populated SQLite verified; SQL Server compatible (plain `CREATE INDEX`); write impact measured — insert +3 ms / update ±0 / delete +4 ms per 2 000 rows.
- MeasuredBox "skip children at width=0" was **reverted** — children would never mount in jsdom/hidden containers (proved by 2 failing page tests); kept as backlog note.

## Known limitations / V3 backlog

1. **Frontend pagination adoption** — server ships opt-in `limit`/`cursor`; wiring the UI (infinite scroll / load-more) changes "select all" semantics — owner UX decision.
2. **ETag aggregate** costs ~10 ms per listing on 16.8 k rows (needed for 304 on nav-back). Could be dropped below 1 ms with a dedicated `MAX(updated_at)` index — diminishing returns.
3. **`_merge_library_results`** now one union scan, but `library_role_locked` still runs per library (N small); deeper batching possible.
4. **Serialization is the remaining big-folder cost** (~0.09 ms/row → 10 k ≈ 870 ms): slimming `_response` fields for listings or opt-in pagination is the lever.
5. **Concurrent ceiling** is worker-bound, not endpoint-bound (see table) — production worker scaling out of scope.
6. `MainLayout` re-renders on every URL change (needs `location` for active nav/chat) — refactor left out as risky for the gain.
7. Preview-stat fair scheduling across users (8-worker dedicated pool is already isolated) — V2.2 backlog item, unchanged.

Artifacts: `frontend/e2e/artifacts/perf-audit/{results-v3a,results-v3-opt,results-v3-final,comparison,seed-v3}.csv|json`, `traces/{open_route-v3a,open_route-v3-opt,open_route-v3-final}.json`; probes in `frontend/e2e/stack/` (`probe_load.py`, `probe_timings_v3.py`, `probe_sql_timings.py`, `reseed_v3.py`, `apply_indexes.py`).
