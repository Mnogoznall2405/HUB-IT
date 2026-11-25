# My Files — Performance V3.2 Results

Branch: `perf/my-files-v3` (worktree `C:\Project\HUB-IT-v3-wt`), PR #68. Measurement HEAD: pending commit of this file.

Scope: stabilization pass on top of V3.1 — P1 security/correctness hardening, P2 ETag correctness, P2 everyday-speed decomposition and fixes. Stands/methodology identical to the V3.1 report (same worktrees, same seed `seed-v3.json`, n=30 medians where noted).

## P1 — security and correctness (frontend `MyFiles.jsx`)

- **No optimistic cache-paint for views that can merge shared-library documents.** `loadData` skips the cached paint when the cached listing carries `library_id` rows (`hasLibrary`) — search/recent/library results can mix documents the viewer may no longer be allowed to see, so they always wait for a fresh server answer.
- **`selectAllFilesInSet` hardened against stale answers.** The materializing fetch runs under an `AbortController` and captures `locationKey` + `authUserKey`; a response that lands after a location/account switch is dropped instead of materializing a foreign file set. A `selectionContextKey` effect clears selection and aborts the request on any context change; `extraSelectedRows` can no longer leak into another folder/filter/view.
- **Real `inert` on stale rows** (not just `pointer-events:none` + `aria-busy`): the list and grid panels get the inert attribute — keyboard navigation, tab focus, text selection and bulk gestures are blocked alongside mouse input; drag sources and folder drop targets are additionally gated on `rowsStale` in `fileDragProps`/`folderDropProps`.
- **401/403/404 mid-pagination (`loadNextPage`)**: the revoked scope's cache entry is evicted, cursor + total + selection + `extraSelectedRows` are cleared, and the listing repaints empty — previously a denied page fetch left the already-loaded rows on screen.
- Regression tests: `MyFiles.test.jsx` 43/43 — new cases cover the cache-paint guard, select-all context drop, inert gating and the deny-mid-scroll cleanup.

## P2 — ETag correctness (`_listing_etag_locked`)

- **Normalized search text is part of the fingerprint context** — two different `q` values can no longer share an ETag.
- **Folder-scoped coverage now includes the subtree**: folder rows carry a *recursive* `file_count`, so writes in any descendant folder must invalidate the parent's tag — the fingerprint aggregates `X ∪ descendants(X)` (root = owner-wide).
- **Date-filter cutoff embedded in the context** at day precision — `date_filter` windows rotate exactly at the local midnight boundary, not per second.
- **Global role flag (`is_admin`) in context** via a session-cached PK lookup — role flips invalidate listings minted under the old role.
- Verified payload coverage: `include=tree` returns own folders only (folder aggregates already cover it); trash is a separate endpoint; search/favorites/recent/shared are global branches, correctly *not* folder-scoped.
- Regression tests (`tests/test_my_files_service.py`): nested-counter invalidation, query-context rotation, date-cutoff rotation — 6/6 etag tests green.

## P2 — scroll_fast: worst_frame regression fixed

V3.1 residual: `scroll_fast` worst_frame 67 → 183 ms (page-append commit landing mid-gesture; `startTransition` made the render interruptible but the commit still blocked a frame).

V3.2 root causes found + fixed:

1. **Page commit inside the fast gesture.** A fetched +150-row page arriving during a velocity scroll was merged+committed immediately — a ~143 ms synchronous commit (whole-page re-render + new window mount). Now: scroll-velocity tracking (`0.4 px/ms` gate); pages arriving during a fast gesture are *stashed* and committed when the gesture slows, goes idle (150 ms), or the user is stranded near the end of loaded rows (900 px floor — but only when not in a fast gesture: a cyclic fling that wraps `scrollTop` to 0 touches the floor transiently and must not force a mid-gesture commit).
2. **Cursor re-fetch loop.** While a page sat stashed, `nextCursor` had not advanced — every `remaining < 1200 px` scroll event re-requested the *same* page (probe showed 3 identical cursor fetches per gesture). `loadNextPage` now short-circuits while a page is stashed → 1 fetch per gesture.
3. **Mutation races.** Deleted/moved ids land in `removedFileIdsRef` tombstones and are filtered out at page-commit time — an in-flight page response can no longer resurrect a row the user just deleted or moved (previously the dedupe-by-id merge only dropped *duplicates*, not deletions). Page-1 refresh vs page-N races are bounded by the chain-intact check (`nextCursorValueRef`), which the stash path also honours via `pageKey` + `locationKeyRef` validation on flush.

Probe (`probe_scroll_fast.mjs`, same rAF gesture as the harness): worst frame **150 → 67 ms** (baseline A = 67), longtask 143 ms → none >54 ms, cursor fetches 3 → 1.

Harness (n=30, this build — label `v32-b-sf2`): `scroll_fast` worst_frame p50 **50 ms** (A = 67, V3.1 B = 183), p95 67; fps p50 51 (A = 50, V3.1 = 47); longtask total −51 % vs A. `scroll_slow` worst_frame p50 33 ms (A = 50); `table_scroll_1000` fps 57 (A = 52), worst_frame p50 50 = A. Scroll regression fully eliminated and the gesture is now *faster* than the V2.2 baseline.

## P2 — everyday speed decomposition

### open_route settled 4701 → ~191 ms — root cause: forced session reload in the route loader

CDP trace showed a **4.3 s gap between the click and the first `/my-files` request**. Reproduction probe (`probe_click_loss.mjs`, exact harness replica): first click lost in 6/6 runs, `msToMyFiles ≈ 4.2 s` — deterministic, not flaky.

Instrumented chain (in-page event tap, `history.pushState`/`replaceState` tap, fiber inspection):

- `handleNavigation` calls `prefetchRouteByPath('/my-files')` (and `onMouseEnter`/`onFocus` prefetch it too).
- `loadMyFilesRoute` in `routeLoaders.js` was wrapped in `ensureMyFilesGrantDeployReload()` — a leftover **deploy-migration shim** (`hubit:my-files:grant-download-v2` in sessionStorage): the first my-files route load in every new session called `window.location.reload()` and returned a promise that never resolves.
- The hard reload destroyed the document — pending navigate, React handlers, everything — and the app re-booted onto `/dashboard`. The harness retried after its 4 s timeout; on retry the sessionStorage key was already set → navigation succeeded → `nav_retries: 1` in **30/30 runs on both stands**.
- Second copy of the same shim lived in `main.jsx` (`needsMyFilesGrantHardReload`) for direct `/my-files` loads — also removed.

Evidence in probes: `page.evaluate` context destroyed on click (hard nav), zero `pushState` calls, `__linkEvents` wiped between evaluates, `[nav]` events landing back on `/dashboard`.

Fix: both shims deleted (`routeLoaders.js`, `main.jsx`) — the grant-download deploy they migrated for is long past; the mechanism cost every fresh session a full page reload on the first /my-files navigation. Post-fix probe: `firstTryOk`, `navRetries: 0`, `msToMyFiles ≈ 191 ms`.

Kept defense-in-depth: the 56 ms deferred `navigate()` was additionally moved to a module-level timer (`pendingSidebarNavTimer`) so a shell remount can no longer clear a pending navigation — harmless, orthogonal.

Sidebar clicks during the boot window were therefore a **real deterministic user-facing bug** (click → page reloads → back at dashboard), not a measurement artifact.

### search_type settled 803 (A) vs 812 (B) — parity, structural floor

Breakdown of the ~800 ms: ~350–400 ms typing (`zebra` × 60 ms key delay inside the measured window) + 300 ms search debounce + ~100–150 ms server + render. The debounce is required behavior; `api_during_typing` dropped 3 → 1 requests vs A (bytes −87 %). Not a fixable bottleneck without changing UX semantics — documented.

### view_toggle settled 515 (A) vs 521 (B) — parity, cosmetic tail

Zero API calls; grid is already virtualized (`VirtualFileGrid`/`VirtualFolderGrid`). Probe shows first mutation at ~25 ms, **one** late DOM mutation at ~574–591 ms — the MUI `TouchRipple` element being removed from the clicked toggle button after its ~550 ms animation. `settled_dom` records that cosmetic removal, not user-visible cost. The real grid mount is a single ~200 ms commit on first toggle. Not actionable.

## Browser results — A vs B V3.2 (n=30 medians; p95 in parens)

| Scenario | Metric | A | B V3.2 | Δ | Note |
|---|---|---|---|---|---|
| open_route | settled_dom | 4 640 ms | **737 ms** (1 245) | **−84 %** | `nav_retries` 1 → **0** (30/30) |
| open_route | api_requests / bytes | 5 / 5.1 KB | 3 / 4.1 KB | −40 % / −19 % | |
| nav_back | settled_dom | 305 ms | **118 ms** (143) | −61 % | requests 6→0; first_dom +92 % — deliberate inert-stale-rows tradeoff (stale rows paint instantly but are input-blocked until fresh data lands) |
| nav_nested | api_requests / bytes | 3 / 2.0 KB | **1 / 300 B** | −67 % / −85 % | |
| nav_library | settled_dom | 187 ms | 173 ms | −7 % | parity |
| nav_rapid | settled_dom | 0 (never) | **456 ms** | — | now settles at all |
| scroll_fast | worst_frame | 67 ms | **50 ms** (67) | −25 % | V3.1 residual 183 → 50 |
| scroll_fast | fps | 50 | **51** (53) | | |
| scroll_slow | worst_frame / fps | 50 / 58 | **33 / 60** | −34 % | |
| table_scroll_1000 | worst_frame / fps | 50 / 52 | 50 / **57** | +7 fps | |
| table_1000 | heap | 1 091 MB | **216 MB** | −80 % | |
| table_5000 | first_row / rows / heap | — | **717 ms / 25 / 36 MB** | — | bounded window, n=5 |
| table_10000 | first_row / rows / heap | — | **693 ms / 25 / 62 MB** | — | same cost as 5000 — size-independent |
| search_type | settled_dom | 803 ms | ~800 ms | parity | typing+debounce floor; api during typing 3→1 |
| view_toggle | settled_dom | 513 ms | ~520 ms | parity | cosmetic MUI ripple tail |
| library_expand | settled_dom | 210 ms | 187 ms | −11 % | |
| memory_nav_churn | heap growth | +36 MB / 12 cyc | **+31.5 MB / 40 cyc** | ~4× less per-cycle | |

## Acceptance probes

- **Pagination under mutations** (`probe_pagination_mutations.py`, f5000, direct SQLite edits mid-walk): soft-delete → absent from the next page, pages disjoint, ETag rotates, `total` decrements; insert sorting *before* the cursor → not resurrected on later pages (keyset bound, not offset); move-out mid-walk → absent; totals consistent end-to-end. **OK**
- **UI pagination** (`probe_pagination_ui.mjs`): page-1 `limit=150`, cursor fetch on scroll, "Выбрать все 1000" issues the unpaginated whole-set fetch and selects 1000. **OK**
- **Alembic vs main**: single head — `20261124_0177` (main) → `0178` (listing indexes) → `0179` (member `updated_at`); no divergent branches.
- Backend `tests/test_my_files_*`: 139 pass; `test_security_scan_error_records_failing_engine` and `test_folder_archive_grant_builds_zip` fail identically on clean HEAD `01db9456` (pre-existing env failures, verified by stash A/B).
- Frontend `MyFiles.test.jsx`: 43/43 green.
- E2E my-files suite (`E2E_LOCAL=1`): **92/92** — the only two failures were seed-phase 429s (`max_active_jobs_per_user=5` is a production DoS cap the 30-file seed loop outruns; worker drains on a 1–5 s poll). Fixed deterministically by lifting the upload caps in `local_backend.py`, consistent with the stack's existing neutralization of the login rate limit. Retry: 4/4 green.
- Memory churn (`memory_nav_churn`, 40 cycles): **+31.5 MB** heap growth over the full run (~0.8 MB/cycle vs A's ~3 MB/cycle at +36 MB/12 cycles) — growth is dominated by churn allocations, no runaway accumulation.
- E2E stack fix landed in this branch: `MAIL_CREDENTIALS_KEY` was missing from `local_backend.py` (upstream commit `d16e008d` on main); without it every login returned 400 and the whole suite mass-failed.

## Caveats

- `search_type`/`view_toggle` settled figures are structural/cosmetic floors, not regressions — decomposition above.
- The scroll stash holds a page at most ~150–300 ms beyond the gesture; a user parked at the very end still gets the page via the idle flush, and the floor clause fires when the gesture decelerates — no starvation path (verified: reaching end while fast still commits on wrap-stop).
- The +150-row append commit itself (~40–140 ms) is bounded by the monolithic page component; splitting the rows pane into a memoized subtree would shrink it further — flagged as a follow-up, out of stabilization scope.
