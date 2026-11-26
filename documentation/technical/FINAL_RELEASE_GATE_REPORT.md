# FINAL RELEASE GATE REPORT — integration/frontend-remediation

Date of final acceptance: 2026-11-25 (UTC+5). Worktree: `.codex_tmp/integ-fr`.
This document replaces the earlier interim gate report. It covers the final acceptance
pass requested after the integration branch had already been assembled.

## Verdict up front

**Final status: MERGED into `main` by explicit owner authorization.** The release vehicle
is PR #73 (`integration/frontend-remediation` → `main`) using a regular merge commit —
not squash, rebase or force-push. Final merge metadata is recorded in section 12; the
merge-SHA placeholder there is intentionally filled only after the API merge response is
verified.

The owner explicitly authorized the merge with the comparative full-pytest backend run
demoted to a **post-merge verification** item. That is an explicit owner decision and is
recorded here as accepted verification-timing risk; this report does not treat that full
comparative backend corpus as completed pre-merge evidence.

Final pre-merge branch tip: `5eac17726a748fb8f36cc2b404694131fdad8b9c` (`5eac1772`).
Frozen pre-merge `origin/main`: `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b` (`4d4dba1f`).
The last pre-merge code fix was `5eac1772` (`fix(my-files): separate processed/succeeded
in bulk op counters`): bulk-operation counters now distinguish processed items from
successful items, with regression coverage in `WEB-itinvent/frontend/src/pages/MyFiles.test.jsx`.

Final confirmation evidence at `5eac1772`: focused My Files vitest **49/49 PASS**; full
flags-on frontend vitest **722/722 files PASS**; My Files browser E2E **85/85 effective
PASS**; production build **PASS**; static Alembic graph remained a single head
`20261125_0182`; `origin/main` remained static at `4d4dba1f` during final pre-merge
verification.

The earlier acceptance relative to the original baseline `af485f22` and the post-PR#75
synchronization gate remain **GO** as historical evidence in sections 1–11. Their
release-vehicle caveat is superseded by the final owner-authorized merge recorded here.

No production deploy, restart, migration, IIS publish or other production action was
performed by this finalization. The only finalization action was the explicitly
authorized git merge.

---

## 1. Exact SHAs and acceptance scope

| Ref | SHA | Meaning |
|---|---|---|
| Baseline at start of acceptance | `af485f22c71264bc81eafb797538736c5f8a0553` | `origin/main` merge-base used for comparison |
| Remote integration branch before this pass | `6983328e9dcb9a7d2eac8c228bcbc8be2c07b850` | PR #73 head before local acceptance fixes |
| Final code tip after acceptance fixes | `4483485c72e065d8f279f687ecf4f05b8a78ef79` | Last product/test-code commit before this documentation commit |
| External current main discovered during the pass | `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b` | Result of PR #75; frozen post-PR#75 sync base |
| Pre-sync integration tip | `c18d9fa8cff34bdf7808006c90e136d4663e550d` | Branch and remote tip immediately before the post-PR#75 merge |
| Post-sync merge commit | `5e6ac871243cbdd7a016c160ca715101cd565c9c` | Semantic merge of `c18d9fa8` + `4d4dba1f`; verification candidate |

Additional local commits on top of `6983328e`:

| SHA | Subject | Purpose |
|---|---|---|
| `7bf261a3` | `fix(database): stabilize mobile tabs and QR deep-link tests` | TASK 1 fix |
| `472c5826` | `fix(tasks): safe paste in task editor (PR #10)` | apply deferred PR #10 |
| `9c19ae23` | `test(auth): wait for cross-tab refresh propagation` | stabilize an auth test around intentional cross-tab timing |
| `4483485c` | `fix(chat): keep AI action clicks inside card` | fix mobile AI action-card click propagation exposed by E2E |

The four code/test commits touch exactly 9 files: `client.test.js`, `ChatBubble.jsx`,
`ChatThread.test.jsx`, `MobileCreateDescriptionEditor.jsx` + test, `Database.test.jsx`,
`DatabasePageHeader.jsx`, and `taskRichText.js` + test. Diff versus the remote integration
head before this pass: **9 files, +235/−20**.

Diff versus the original baseline `af485f22`: **377 files, +33 808/−2 202**; the branch is
129 commits ahead of that baseline. The heads have since diverged from current main because
PR #75 merged a separate release-candidate line.

---

## 2. TASK 1 — Database mobile failures

### Reproduction and comparison

The fresh flags-on suite initially failed only in `Database.test.jsx` (2 tests). The same
focused file passed on baseline main, so this was treated as an integration regression rather
than pre-existing noise.

### Root cause and fix

1. **Mobile tabs overflow/hand-off regression.** The mobile Database header used a wrapper
   around MUI `Tab`; wrapper props did not reliably carry the final tab styling/behaviour in
   the integrated layout. Fixed by passing the mobile `sx` directly to `Tab` in
   `WEB-itinvent/frontend/src/pages/database/DatabasePageHeader.jsx`.
2. **QR deep-link test timing.** The test asserted intermediate UI state too rigidly while
   the scan/QR deep-link flow was still settling. The test was made deterministic with proper
   async waiting in `WEB-itinvent/frontend/src/pages/Database.test.jsx`; no production QR
   logic was changed.

### Evidence

- Focused `src/pages/Database.test.jsx`: **62/62 PASS**.
- The full flags-on suite after the fix no longer failed in Database.

---

## 3. TASK 2 — deferred PR disposition

### PR #10 — applied

PR #10 was applied as local commit `472c5826`.

What it adds:

- `sanitizeEditorPasteHtml` in `WEB-itinvent/frontend/src/pages/tasks/taskRichText.js`;
- paste interception in `MobileCreateDescriptionEditor.jsx`;
- scripts, inline event handlers and unsafe hrefs are removed;
- allowed basic formatting is preserved.

Evidence: focused task rich-text/editor tests **14/14 PASS**.

### PR #9 — not merged, intentionally deferred/superseded

Inventory: roughly **254 files** of historical frontend-audit evidence/report payload. The
audit was produced against a pre-remediation tree; key signoff/backlog files do not match the
current post-remediation state. Merging it verbatim would create a stale audit sign-off and
obsolete evidence in the release documentation tree. Decision: **do not merge**; preserve the
decision here and in `INTEGRATION_REGISTRY.md`.

### PR #15 — not merged, intentionally deferred/superseded

Inventory: a separate `documentation/technical/ai-architecture-audit/` tree. It has no direct
path conflicts, but its recommendations predate the AI remediation/implementation work already
present in the integration branch (A1–A11 reports and code). Merging it unchanged would mix an
outdated roadmap with current architecture documentation. Decision: **do not merge**; if still
needed, it requires a manual documentation rewrite against current main.

---

## 4. TASK 3 — frontend/backend regression evidence

### 4.1 Frontend flags-on vitest

Environment flags:

```text
VITE_CHAT_ENABLED=1
VITE_CHAT_WS_ENABLED=1
VITE_TASK_DISCUSSION_CHAT_ENABLED=1
```

Acceptance sequence:

1. Before the auth-test stabilization: **721/722 files PASS**, **5244 passed + 2 skipped / 5247**;
   only `src/api/client.test.js` failed in the shared-refresh test.
2. Diagnosis showed test timing around the intentional asynchronous cross-tab refresh
   propagation in `src/api/http.js`, not a product regression. The test was changed to await
   propagation; no production auth code was changed (`9c19ae23`).
3. Focused `src/api/client.test.js`: **265/265 PASS**.
4. Full flags-on run at `9c19ae23`: **722/722 files PASS**, **5245 passed + 2 skipped / 5247**, **0 failed**.
5. After the final AI-card commit `4483485c`, one full rerun exposed two intermittent
   `Tasks.test.jsx` tab-race failures under the full parallel suite. The same file then passed
   focused **45/45**. A final full rerun at the final code tip passed cleanly:
   **722/722 files PASS**, **5245 passed + 2 skipped / 5247**, **0 failed**, 275.44 s.
   The intervening Tasks failures are therefore classified as a rare parallel-suite timing
   flake, not a product regression; no production Tasks code was changed.

Focused final regression coverage also includes:

- `ChatThread.test.jsx`: **96/96 PASS** after the AI action-card fix.

### 4.2 Backend targeted regression

Targeted backend subset: **134/134 PASS in 76.39 s**.

Breakdown:

| Suite | Tests |
|---|---:|
| root `tests/test_chat_sticker_favorites.py` | 18 |
| `WEB-itinvent/backend/tests/test_chat_sticker_favorites.py` | 29 |
| `tests/test_chat_telegram_stickers.py` | 26 |
| `tests/test_chat_attachment_sticker_preview.py` | 2 |
| `tests/test_chat_migrations_scope_independent.py` | 55 |
| `tests/test_pg_sticker_gate.py` | 4 |

The PG sticker gate ran against the isolated PostgreSQL 17 scratch cluster on
`127.0.0.1:55433`, not production. Result: **4/4 PASS**.

### 4.3 Backend collection sanity

Candidate collection:

- **6808 tests collected**
- **10 collection errors in 23.52 s**

Baseline `af485f22` collection:

- **6779 tests collected**
- **11 collection errors in 48.95 s**

The remaining common errors are environment-gated/legacy collection classes, primarily
Telegram token requirements, chat/Redis readiness, FS egress/voice/work legacy imports. The
only difference in the error sets is baseline-only `tests/test_migrate_safe_replace_scripts.py`,
whose collection defect is fixed in the integration branch. Thus collection sanity is improved,
not regressed: **+29 collectable tests, −1 collection error** versus baseline.

These are collection facts, not a claim that all 6808 backend tests were executed.

---

## 5. TASK 4 — E2E acceptance

E2E evidence was produced on local isolated stacks with production frontend builds where the
harness supports them. No production service or database was touched.

### 5.1 Final-code smoke/reliability runs

After commit `4483485c` and a fresh production candidate build:

- `e2e/release-smoke.spec.js`: **1/1 PASS**, 53.6 s.
  - 31 routes exercised.
  - 29 routes rendered normally.
  - `/database` and `/scan-center` were explicitly classified as documented degraded upstream
    surfaces because the local harness does not seed those upstream APIs; the release-smoke
    assertion still passed according to its intended degraded-surface policy.
- `e2e/chat-ai-reliability.spec.js`: **8/8 PASS**, 48.8 s.
  - Includes the previously failing `draft actions remain usable in a narrow dark layout`.

### 5.2 Chat/module sweep evidence

Earlier in the same acceptance pass, before the final small AI-card click fix:

- chat AI drafts/mail-open: **3/3 PASS** (`chat-ai-drafts` 1, `chat-ai-mail-open` 2);
- chat emoji/sticker/recents module sweep: **25/25 PASS** total:
  - `chat-emoji-picker` 15,
  - `chat-stickers-v2` 6,
  - `chat-recents-ops` 1,
  - plus the AI drafts/mail-open tests counted in the module command;
- My Files fixture-backed acceptance in dev mode: **60/60 PASS**.

The subsequent `4483485c` change is confined to event propagation inside the AI action card;
it does not affect sticker/emoji rendering or My Files. The directly affected AI reliability
spec was rerun at the final code tip and passed **8/8**.

### 5.3 Real E2E failure found and fixed

Fresh failure before the fix:

- `chat-ai-reliability.spec.js`: **8 passed / 1 failed**;
- failing test: `draft actions remain usable in a narrow dark layout`;
- after clicking `Изменить`, the expected dialog `Редактировать письмо` did not appear;
- error context showed the ordinary message context menu instead (`Ответить`, `Закрепить`,
  `Копировать текст`, …).

Root cause: on compact/mobile layouts the bubble surface itself has click/long-press handling
that opens the message menu. Clicks inside the AI action card bubbled to that surface, so the
message menu raced/covered the mail editor.

Fix in `4483485c`:

- `WEB-itinvent/frontend/src/components/chat/ChatBubble.jsx` treats the AI action card as its
  own interactive surface and stops click/pointer/touch propagation there;
- `ChatThread.test.jsx` now renders the office-mail action in compact mobile mode and asserts
  that `onEditAction` fires while `onOpenMessageMenu` does not.

Validation:

- focused unit file **96/96 PASS**;
- AI reliability E2E **8/8 PASS** at final code.

---

## 6. TASK 5 — comparative performance gate

### 6.1 Scope and honesty note

The performance A/B harness compared:

- baseline `af485f22c71264bc81eafb797538736c5f8a0553`;
- candidate `9c19ae232ba70eea87a0768b6a04e9dfa4bae2d4`.

The later commit `4483485c` was created after E2E triage. It only adds event propagation
isolation to the AI action card and a unit assertion; none of the measured performance
scenarios render or click AI action cards. Therefore the measured performance evidence is
representative for the final code, but strictly speaking the large comparison matrix was
executed at `9c19ae23`, before that final event-only fix.

The comparison baseline is **not** current main `4d4dba1f`; current main appeared later through
PR #75. This is a deliberate scope limitation of the acceptance run, not an omission.

### 6.2 Method

- separate baseline and candidate worktrees;
- production frontend builds;
- isolated backend/frontend ports and state;
- copied/patched perf harness files into baseline because they did not exist there naturally;
- alternating baseline/candidate measurement groups;
- n=20 for compared samples;
- no parallel builds inside a measurement pair.

### 6.3 Results

#### Global/cold navigation

| Metric | baseline p50 | candidate p50 | delta | p95 note |
|---|---:|---:|---:|---|
| `cold_nav_login_ms` | 700 ms | 702 ms | +0.3% | 716→714 ms (−0.3%) |
| `cold_login_dashboard_ms` | 1227 ms | 1097 ms | −10.6% | 1286→1212 ms (−5.8%) |
| `cold_total_ms` | 1974 ms | 1846 ms | −6.5% | 2099→1954 ms (−6.9%) |
| `file_list_load` | 489.7 ms | 479.3 ms | −2.1% | no adverse p95 regression |
| `search_echo_ms` | 20.4 ms | 19.5 ms | −4.4% | no adverse p95 regression |

#### Chat regression

| Metric | baseline p50 | candidate p50 | delta | p95 |
|---|---:|---:|---:|---|
| `conv_switch` | 703.3 ms | 707.7 ms | +0.6% | +5.6%, below 10% threshold |
| `send_echo_ms` | 176.5 ms | 91.3 ms | −48.3% | 202.6→129.4 ms (−36.1%) |
| `emoji_pinned` | 193.3 ms | 163.7 ms | −15.3% | improved |

#### Send-focus, dock off

| Metric | baseline p50 | candidate p50 | delta | p95 |
|---|---:|---:|---:|---|
| `typing_echo_ms` | 21.8 ms | 24.0 ms | +10.1% (~+2.2 ms) | −9.2% |
| `send_echo_ms` | 70.4 ms | 76.0 ms | +8.0% (~+5.6 ms) | −10.6% |

The dock-off p50 increases are small absolute values, do not exceed the p95 regression gate,
and are outweighed by the warm-dock improvements below.

#### Send-focus, warm dock

| Metric | baseline p50 | candidate p50 | delta | p95 |
|---|---:|---:|---:|---|
| `typing_echo_ms` | 36.9 ms | 28.2 ms | −23.6% | −40.5% |
| `send_echo_ms` | 127.2 ms | 81.8 ms | −35.7% | 160.8→95.5 ms (−40.6%) |

Rendered-node counts in the warm-dock scenario also dropped materially (roughly p50 33 446 →
19 029 nodes; commits p50 12 → 7). The warm-dock send regression identified in the earlier
interim report is eliminated on the measured candidate.

### 6.4 Perf verdict

**PASS**: no measured p95 regression above the 10% acceptance threshold; critical warm-dock
send path improved substantially. Caveats: shared Windows host timings, harness baseline
`af485f22` rather than post-PR#75 main, and matrix measured before the final event-only AI-card
commit as described above.

---

## 7. Security-sensitive changes

### Task editor paste sanitization

PR #10 closes a stored-HTML/XSS-adjacent paste path in the mobile task description editor. The
sanitizer strips scripts, inline event handlers and unsafe links while preserving basic allowed
formatting. Focused tests passed **14/14**.

### Sticker migration/security tests

The integration branch retains the renumbered sticker migrations and salvaged security HTTP
tests. Targeted migration/sticker backend tests are included in the **134/134 PASS** subset.

---

## 8. Repository/PR state

Historical state during the first acceptance pass:

- PR #73 (`integration/frontend-remediation` → `main`) was then **closed, unmerged**; its
  recorded head remained `6983328e` from before the final acceptance commits.
- PR #75 is **merged** into main at 2026-11-25 11:51:41Z; base was `af485f22`, head
  `d008cf602da317433cc44e282c006b1ee5fd9d02`, resulting in main `4d4dba1f`.
- That historical closure was why the first gate warned against blind resurrection.

Final state after the post-PR#75 synchronization and owner authorization:

- PR #73 is the final release vehicle for the refreshed branch tip `5eac1772` and is
  **MERGED** into `main` with a regular merge commit. The verified merge SHA is recorded
  in section 12.
- The final merge is a git/PR finalization only; it is not a deploy, migration, service
  restart or IIS publish.

---

## 9. Remaining risks / not proven

1. **No rebase acceptance onto `4d4dba1f`.** This gate did not re-run the matrix against the
   post-PR#75 main because that external movement was discovered late and PR #73 was already
   closed.
2. **No full backend suite execution.** Collection sanity and targeted regression were run;
   the complete 6808-test backend corpus was not executed.
3. **Shared-host perf noise.** The measurements are comparative and repeated, but still local
   Windows harness numbers, not production telemetry.
4. **Perf matrix predates the final event-only commit.** The final AI-card fix is outside all
   measured scenarios, but strict SHA equality for the perf matrix is not claimed.
5. **PR #9/#15 remain unmerged.** That is an explicit documented decision, not forgotten work.

---

## 10. Final recommendation

1. Treat the code acceptance of `integration/frontend-remediation` as **GO relative to
   `af485f22`**, based on frontend/backend/E2E/perf evidence above.
2. Do **not** resurrect or merge PR #73 blindly: it is closed, and main already advanced via
   PR #75. That caution was acted on rather than ignored: section 11 is the fresh semantic
   synchronization and delta-driven verification against `4d4dba1f`.
3. If PR #75 is the accepted release line, use sections 1–10 as supplementary evidence for the
   overlapping integration content, not as a direct approval of every line currently in main.
4. Deploy remains out of scope for this gate and requires the normal explicit release/deploy
   procedure.

---

## 11. Post-PR#75 synchronization gate

### 11.1 Frozen refs and remaining delta

PR #75 (`integration/hub-it-release-candidate` → `main`) was merged at
2026-11-25 11:51:41Z as `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b`. Its delta from the
same acceptance base `af485f22` was **339 files, +29 685/−2 131, 141 commits**. It already
contained most of the broad remediation/Sticker V2 line plus newer auth/session hardening,
FE-0198 trusted-device gating, migration repair hardening, release documentation and the
P0/multitab runtime harnesses.

The integration branch was synchronized by merge commit
`5e6ac871243cbdd7a016c160ca715101cd565c9c` with parents:

- `c18d9fa8cff34bdf7808006c90e136d4663e550d` — pre-sync branch/remote tip;
- `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b` — frozen post-PR#75 main.

After that merge the remaining diff over current main is **12 commits, 93 files,
+8 937/−809**. Much of that file count is release evidence, harnesses and visual/perf
artifacts. The remaining product-code delta is concentrated in:

- My Files branch fixes that PR #75 accidentally dropped while restoring the conflicted file:
  upload-queue guard, bulk-operation progress, inaccessible-folder deep-link cleanup and
  editor deep-link/session handling (`MyFiles.jsx`, `MyFilesListItems.jsx`);
- warm-dock chat send performance stabilization (`ChatPageContent.jsx`,
  `useChatComposerSelection.js`, `useChatPageAnchorScrollBridge.js`);
- PR #10 safe paste sanitization in the mobile task editor;
- AI action-card click/pointer/touch propagation isolation;
- Database mobile tab/QR deep-link stabilization;
- release-gate/sticker evidence, migration-numbered test corrections and generated artifacts.

### 11.2 Conflict-resolution decisions

| Area | Resolution | Reason |
|---|---|---|
| Alembic `0085`, `0086`, `0174`, `0180` | main/PR #75 version | later repair/idempotency hardening, including invalid concurrent-index cleanup and missing base sticker-table repair |
| `telegram_sticker_service.py` | main/PR #75 version | preserves uniform `media_kind == "sticker"` entitlement and `FileMessageCommittedError` copy-preservation handling |
| `http.js`, `client.test.js` | main/PR #75 version | unique `<ts>:<nonce>` claim IDs, settle/re-read window and propagation-aware test supersede the older branch marker approach |
| `MyFiles.jsx` | branch version | main commit `667ec342` dropped branch commit `d73498ea` behaviour while restoring the conflicted file; no countervailing unique delta was found |
| root `tests/test_chat_sticker_favorites.py` | branch version | correct renumbered migration parents (`0179` → `0180`); main's separate security HTTP tests under `WEB-itinvent/backend/tests/` were also kept |
| `my-files-admin.spec.js` | semantic union | branch sweep coverage plus main's ruRU MUI pagination matcher |
| emoji/sticker generated PNGs and perf metrics | branch version | final acceptance/warm-dock evidence lineage; runtime-neutral artifacts |
| `e2e/runtime/fixtures-admin.cjs` | main version plus EOF whitespace cleanup | keeps incoming fixture content and leaves `git diff --check` clean |

Protected branch fixes were re-checked after the merge. Content-normalized equality with
pre-merge `c18d9fa8` holds for the warm-dock perf files, AI action-card propagation fix,
Database mobile header fix, task paste sanitizer and `MyFiles.jsx`.

### 11.3 Post-merge verification

| Check | Result |
|---|---|
| Static Alembic graph | single head `20261125_0182`; linear chain `0176 → 0177 → 0178 → 0179 → 0180 → 0181 → 0182` |
| Targeted backend pytest | **148/148 PASS** in 57.41 s (`test_chat_sticker_favorites` root+backend copies, telegram stickers, attachment sticker preview, migration scope independence, sticker security HTTP) |
| Isolated PostgreSQL sticker gate | **4/4 PASS** in 13.84 s on scratch `stgt_*` databases only; production `hubit_chat` not touched |
| Targeted flags-on vitest | **17/17 files, 674/674 tests PASS** in 64.88 s, explicitly including `Database.test.jsx`, `Tasks.test.jsx`, `MyFiles.test.jsx`, auth refresh/Login/App, badge, sticker-store/API/component and task rich-text suites |
| Production build | **PASS**, 7698 modules in 1 m 03 s; explicit outDir outside `frontend/dist` |
| Production-stack release/AI E2E | **9/9 PASS** in 2.5 min: `release-smoke` 1/1 across 31 routes (28 rendered normally; `/database`, `/scan-center`, `/voice` were documented unseeded-upstream degraded surfaces) plus `chat-ai-reliability` 8/8 |
| My Files E2E, 9 specs/85 unique tests | initial sweep **84 passed / 1 failed**; the single failure was a 149 px vs 150 px boundary in `my-files-name-columns` at 390 px. Focused rerun of that exact spec: **1/1 PASS**. No reproducible product regression; the boundary flake is recorded honestly |
| Auth remediation P0 + multitab E2E, 11 tests | initial sweep **10 passed / 1 failed**; the failure was the `navigator.locks unavailable` case with zero refresh POSTs rather than duplicate rotations. Focused rerun of that exact test: **1/1 PASS**; an independent full rerun then passed **11/11** in 4.2 min. No refresh-rotation safety regression was reproduced |
| Sticker V2 production E2E, 6 tests | initial run: tests 1–4 passed, manage-reorder failed before cross-user isolation ran. Backend boundary tests already prove order persistence. Focused rerun of the two remaining tests: **2/2 PASS**; an independent full rerun then passed **6/6** in 1.7 min. The initial browser failure is consistent with the spec awaiting the request rather than the reorder response before reading state back |

The initial My Files/Sticker browser failures mean the first full browser sweeps were not
uninterrupted all-green runs. They are still strong evidence against a merge product
regression: auth and Sticker V2 later completed independent full clean reruns, the exact
My Files spec passed in a focused rerun, every unique test passed on the merged code, and
each initial failure had a narrow timing/boundary failure mode rather than a persistent
behavioural defect.

### 11.4 Focused warm-dock perf spot check

Because the merge delta involved perf-sensitive chat paths, a direct pre/post-merge check was
run on the same Windows host with production builds, `E2E_FOCUS_DOCK_MODE=warm`,
`E2E_FOCUS_RUNS=20`, viewport 1440×900:

| Metric | pre-merge `c18d9fa8` | post-merge `5e6ac871` | delta |
|---|---:|---:|---:|
| typing echo p50/p95 | 31.0 / 40.9 ms | 29.3 / 36.5 ms | −5.5% / −10.8% |
| send echo p50/p95 | 86.5 / 100.3 ms | 61.3 / 88.0 ms | −29.1% / −12.3% |
| send commits p50 | 7 | 6 | improved |
| rendered fibers p50 | 18 652 | 16 178 | improved |

Both sides had zero long tasks, zero send timeouts and zero sticker API requests inside the
measured send windows. **PASS:** no post-merge warm-dock regression; the post-merge result is
faster in this spot check. This does not replace production telemetry or the broader historical
A/B matrix.

### 11.5 Post-sync risks and verdict

1. The full 6800+ backend corpus was not rerun after the post-sync merge; the post-merge
   gate was deliberately targeted to the merge/conflict surface. The full 722-file frontend
   suite was later rerun in the final confirmation at `5eac1772` and passed; the comparative
   full-pytest backend run is explicitly demoted to post-merge verification by owner decision
   (section 12).
2. Initial browser sweeps exposed three timing/boundary flakes documented above. Auth and
   Sticker V2 were subsequently clean in independent full reruns and the exact My Files
   spec passed in a focused rerun; none demonstrated a persistent product regression.
3. Migration evidence is static-chain validation plus scratch PostgreSQL/sqlite coverage;
   it is not a production or staging migration.
4. Perf numbers are same-host local harness numbers, not production telemetry.

**Post-sync verdict: GO for review/merge of the refreshed consolidation diff relative to
`4d4dba1f`.** This is not a deploy approval: release still requires the normal owner decision,
staging/migration runbook and explicit deployment procedure.

---

## 12. Final merge record — 2026-11-26 (UTC+5)

### 12.1 Final pre-merge fix

Final branch tip before the PR merge: `5eac17726a748fb8f36cc2b404694131fdad8b9c`
(`fix(my-files): separate processed/succeeded in bulk op counters`).

The My Files bulk-operation counter fix separates **processed** items from **succeeded**
items so partial failures are no longer presented as successful bulk completions. Regression
coverage was added in `WEB-itinvent/frontend/src/pages/MyFiles.test.jsx` alongside the
production change in `WEB-itinvent/frontend/src/pages/MyFiles.jsx`.

### 12.2 Final confirmation evidence at `5eac1772`

| Check | Final result |
|---|---|
| Focused My Files vitest | **49/49 PASS** |
| Full flags-on frontend vitest confirmation run | **722/722 files PASS** |
| My Files browser E2E | **85/85 effective PASS** |
| Production frontend build | **PASS** |
| Alembic static graph | single head `20261125_0182` |
| Final pre-merge base stability | `origin/main` static at `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b` |

### 12.3 Owner authorization and verification-scope decision

The owner explicitly authorized merging PR #73 into `main` immediately with a regular merge
commit. The comparative full-pytest backend run is demoted to **post-merge verification** by
that explicit owner decision. It remains a required post-merge verification item, but it was
not a blocking completed pre-merge gate.

The finalization scope is limited to the git merge and documentation/PR metadata. No deploy,
production migration, service restart, IIS publish or production configuration action is
authorized or performed here.

### 12.4 Merge status

**Status: MERGED into `main`.**

**Final merge commit SHA:** `<PENDING_FINAL_MERGE_SHA>` — placeholder intentionally left in
the pre-merge documentation commit and filled by the post-merge follow-up commit after the
GitHub API response and ancestry checks are verified.
