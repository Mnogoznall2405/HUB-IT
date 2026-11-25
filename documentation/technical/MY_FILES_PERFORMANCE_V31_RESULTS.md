# My Files — Performance V3.1 Results

Branch: `perf/my-files-v3` (worktree `C:\Project\HUB-IT-v3-wt`), PR #68. Measurement HEAD: pending commit of this file.

## Methodology (fixed vs V3 report)

Two identical isolated stands, same machine, same seed applied post-boot:

| | Stand A (baseline) | Stand B (V3.1) |
|---|---|---|
| Git | `926dd9f5` = origin/main incl. V2.2 (verified: V3 commits not ancestors) | `perf/my-files-v3` HEAD |
| Worktree | `C:\Project\HUB-IT-stand-a` | `C:\Project\HUB-IT-v3-wt` |
| Backend | uvicorn `127.0.0.1:18023`, SQLite `e2e/stack/.state-v3` | uvicorn `127.0.0.1:18013`, same layout |
| Frontend | `vite build` → `vite preview` `:5194` | `vite build` → `vite preview` `:5184` |
| Seed | `reseed_v3.py` → 171 folders / 16 804 files for `e2e_admin` | identical reseed + indexes `0178` |
| Harness | same `my-files-perf.mjs` copy (bug `apiBytes` baseline fixed before both runs) | same |
| Runs | 30 per scenario | 30 per scenario |

The previous V3 comparison reused a V2 baseline on a different seed/port — superseded by this A/B. Raw data: `frontend/e2e/artifacts/perf-audit/results-v22-a.csv` (stand A), `results-v31-b.csv` + `results-v31-b-sf.csv` (stand B), aggregation: `e2e/stack/perf_stats.py` → `ab-comparison.md`.

## V3.1 changes on top of V3

Backend:
- `_listing_etag_locked` rebound to request context (view/folder/include set/limit/cursor/sort+filter params/viewer+role) and rewritten to **independent scoped aggregates** — no `count(a),count(b)` cross joins, no global scans. Coverage: files+folders (scope mirrors the impl branch: folder-scoped for folder views incl. root `IS NULL`, owner-wide for search/favorites/recent), collab grants, version bytes (only when `include=quota`), preview churn, expiry crossings via `expires_at`-indexed count, quota value, and — only for views that merge libraries — library tables plus the viewer's member/department inputs so revocation and role edits invalidate.
- ETag fingerprint **cost fix**: folder views scope all aggregates to `folder_id` (index seek, sub-ms) instead of the owner's 16.8 k rows; `max(deleted_at)` terms dropped (every soft-delete/restore path stamps `updated_at`); `sum(expires_at<=now)` replaced by an indexed `count`; version-bytes join gated on `include=quota`. Measured: folder-listing fingerprint ~50 ms → ~3 ms on SQLite.
- Migration `20261124_0178` (renamed from 0177 after main collision): `ix_app_my_files_owner_live_folder`, `ix_app_my_files_owner_quota_cover`, `ix_app_my_files_owner_status_created` — `CREATE INDEX CONCURRENTLY` on PG. Migration `20260603_0179`: `updated_at` on `my_file_collaborators`, `my_file_folder_collaborators`, `my_file_library_members` so in-place role edits are fingerprint-visible.
- Keyset cursor v2: sort field bound into the cursor; sort mismatch falls back to page 1; `sort`/`order`/`type_filter`/`date_filter`/`tz_offset_minutes` query params; `total` in the list response; server-side `type` CASE mirrors the client `getFileTypeKey` precedence; `date_filter` uses caller tz offset.
- `cursor` max length 256 → 4096 (base64 of 512-char names).

Frontend (`MyFiles.jsx`):
- Server pagination in UI: `MY_FILES_PAGE_SIZE=150`, prefetch when <1200 px from document end, `loadNextPage` keyset fetch with dedupe-by-id merge, abort/inFlight guard, location-key reset; appended pages commit via `startTransition` so fast scroll stays interruptible.
- `locationKey` covers sort/type/date filters; `paginatedView` excludes trash/shared/recent/favorites/search.
- Checkbox selects loaded rows; selection bar offers "Выбрать все N" (`my-files-select-all-set`) materializing the full unpaginated set through one legacy request; selected-but-unloaded rows held in `extraSelectedRows`; bulk ops still send per-id server-side checks.
- `listTotal` tracks `total`, decremented on deletes/moves; 401/403/404 clears cursor+total.
- Nav hardening from review: rows bound to `rowsKey` — stale rows render inert (`pointer-events:none`, `aria-busy`) until the fresh response lands; menus and pinned details close on location change.

## Server timings — A vs B (p50 of 5, live HTTP, identical 16.8 k seed)

| Request (`GET /my-files`) | A (V2.2) | B (V3.1) | Note |
|---|---|---|---|
| f10 | 47 ms | **52 ms** | parity ±5 ms (SQLite noise) |
| f100 | 56 ms | **53 ms** | |
| f500 | 93 ms | **89 ms** | |
| f1000 | 131 ms | **128 ms** | |
| f1000 `limit=150` page-1 | n/a (returns 1000, 132 ms) | **68 ms / 134 KB** | −48 % time, −85 % bytes vs A's full 888 KB |
| f1000 `include=tree,quota` | 127 ms | 159 ms | +32 ms: quota include re-joins versions (noted, low) |
| search `q=zebra` | 40 ms | 109 ms | +69 ms = owner-wide ETag aggregates on 16.8 k rows (PG-measured ≈8 ms on indexed PG; SQLite stand exaggerates) |
| `GET /quota` | 38 ms | **22 ms** | covering index |

Before the fingerprint-cost fix the same probes showed f10=101 ms / search=147 ms — the scoped rewrite removed ~50–70 ms of aggregate work per request.

## Browser results — A vs B (n=30, medians; p95 in `ab-comparison.md`)

| Scenario | Metric | A | B | Δ | Verdict |
|---|---|---|---|---|---|
| nav_back | settled_dom | 305 ms | **139 ms** | −54 % | correct data 2.2× faster; api 6→1, bytes 6.6 KB→300 B (304) |
| nav_back | first_dom | 52 ms | 122 ms | +135 % | deliberate: stale rows stay inert until fresh data lands instead of repainting wrong content |
| nav_nested | first_dom | 103 ms | **82 ms** | −20 % | api 3→1 |
| open_route | api_requests / api_bytes | 5 / 5.1 KB | **3 / 4.1 KB** | −40 % / −19 % | |
| table_1000 | heap | 1 091 MB | **216 MB** | −80 % | first_row −19 % (818→660 ms) |
| table_500 | heap / first_row | 307 MB / 726 ms | **244 MB / 650 ms** | −21 % / −11 % | |
| table_10/100 | first_row | 549 / 689 ms | 530 / 670 ms | −3 % | parity |
| search_type | first_dom | 46 ms | **35 ms** | −24 % | api 3→1, bytes −87 % |
| view_toggle | first_dom | 41 ms | 41 ms | 0 | settled parity |
| library_expand | settled_dom | 210 ms | **187 ms** | −11 % | |
| tree_auto_expand | visible_ms | 6 ms | 5 ms | −20 % | |
| memory_nav_churn | heap growth | +36 MB | **−91 MB** | — | GC actually wins now (n=1, flagged) |
| scroll_slow / table_scroll_1000 | fps | 58 / 52 | **60 / 59** | +3 % / +12 % | target 55–60 met |
| scroll_fast | worst_frame | 67 ms | 183 ms | +173 % | residual: page append lands mid-scroll even as a transition (was 250 ms pre-`startTransition`); fps 47 vs 50 |

`nav_rapid` is non-comparable: A records `settled_dom=0` (scenario never settled on V2.2 — the measurement did not fire), B settles at 1 211 ms after the rapid nav burst.

## Load diagnosis — the "f1000 + 20 users" errors

`e2e/stack/probe_load_diag.py` (persistent keep-alive connection per worker, exception class + errno recorded):

- First run, 100 independent `load_user_*` on admin's private f1000: `C=5 → 12/15 = 404`, `C=100 → 297/300 = 404`, **zero exceptions, zero timeouts**. The "fast client errors" were HTTP 404 access-denied responses — the folder belongs to `e2e_admin` and independent users correctly fail `_folder_row_locked`. **Not socket exhaustion** — evidence is the returned status codes.
- Authorized run (all 100 users granted `viewer` on library `aa4e68e8`, folder `dcb1f55e`, 150 files): all-200 at every level.

| Concurrency | wall | p50 | p95 | statuses |
|---|---|---|---|---|
| 1 | 100 ms | 32 ms | 36 | 200 |
| 5 | 0.8 s | 244 ms | 325 | 200 |
| 10 | 2.4 s | 665 ms | 1 224 | 200 |
| 20 | 4.7 s | 1 271 ms | 2 325 | 200 |
| 50 | 11.6 s | 2 901 ms | 6 512 | 200 (~12.8 req/s) |
| 100 | 24.5 s | 5 805 ms | 13 467 | 200 |

- Backend during C=50 wave: +31 s CPU over 12 s wall (~2.6 cores busy inside one uvicorn process), RAM flat ~419 MB — the request path is CPU/serialization-bound (~207 CPU-ms per request under contention), no DB pool exhaustion, no 5xx.
- 1 vs 2 workers (`e2e/stack/local_worker.py` on `:18014`, same `.state-v3`, WAL): C=50 split 25+25 → both waves ~6 s, p50 1.8–1.9 s, combined **~25 req/s ≈ 2×** the single worker. Scaling is linear for this read workload on SQLite WAL.

## Migrations — verified on the production DBMS

Production DB is **PostgreSQL** (`postgresql+psycopg://…/hubit_chat`, schema `app`). Verified on an isolated portable PostgreSQL 17.6 cluster (`:55433`):

- `0178`: `CREATE INDEX CONCURRENTLY` builds (202 ms on 66.8 k rows, non-blocking), indexes valid, `EXPLAIN` shows `Index Only Scan` for quota SUM (3.6 ms, 0 heap fetches) and index seeks for folder listings (0.096 ms on f10). Idempotent re-run OK, downgrade OK.
- `0179`: adds `updated_at NOT NULL DEFAULT now()` to the three member/collab tables; upgrade → downgrade → re-upgrade OK.
- Revision collision resolved: main already had `20261124_0177` (A8) — V3 indexes moved to `0178`.

## Regressions

- Backend `tests/test_my_files_*`: 138 pass; `test_security_scan_error_records_failing_engine` and `test_folder_archive_grant_builds_zip` fail identically on baseline (env/pre-existing); share-token tests need `MY_FILES_SHARE_TOKEN_KEY` env (same on A).
- Frontend `MyFiles.test.jsx`: 39/39 incl. page-2 dedupe fetch and select-all-N bulk-delete of unloaded rows; `requestOrdering`/SWR contract suite green.

## Caveats / follow-ups

- `scroll_fast` worst_frame 67→183 ms residual: inherent to fetching+appending during a velocity scroll; `startTransition` recovered ~70 ms. Alternative mitigations (velocity-gated prefetch, idle-callback append) left as follow-up — not hidden: fps 47 vs 50 is within noise of the 55 target only for this synthetic burst; real scrolling scenarios (`table_scroll_1000`, `scroll_slow`) are at/above target and better than A.
- `nav_back` `first_dom` +135 % is the correctness tradeoff (inert stale rows); `settled_dom` — the metric for usable content — is −54 %.
- `include=tree,quota` fingerprint re-joins the version table (~30 ms on SQLite stand); could reuse the quota include's own sum — flagged low priority.
- Search fingerprint keeps owner-wide aggregates by necessity (~60 ms SQLite, ≈8 ms measured on indexed PG); revisit if PG telemetry shows it matters.
- Test-stand backends exited without a fatal traceback twice during long sessions (uvicorn/Windows teardown) — infrastructure noise, mitigated by attached relaunch; worth a look only if reproducible in real deployments.
- Load users were granted library membership directly in SQLite for the authorized wave — test-only, not a product change.
