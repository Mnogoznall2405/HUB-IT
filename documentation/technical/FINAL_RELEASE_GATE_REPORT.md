# FINAL RELEASE GATE REPORT — integration/frontend-remediation

Date of final acceptance: 2026-11-25 (UTC+5). Worktree: `.codex_tmp/integ-fr`.
This document replaces the earlier interim gate report. It covers the final acceptance
pass requested after the integration branch had already been assembled.

## Verdict up front

**Code-gate verdict for the acceptance baseline: GO**, with the explicit caveats below.

**Release-vehicle verdict: PR #73 is superseded/closed.** During this acceptance pass
`origin/main` moved externally from `af485f22` to `4d4dba1f` through **PR #75**
(`release: unified HUB-IT release candidate (42 remediation PRs + Sticker V2 + main integration)`),
and PR #73 was closed unmerged at 2026-11-25 11:52:58Z. Therefore this report is a
branch-local final acceptance record for `integration/frontend-remediation`, not approval
to merge the already-closed PR over current main. If this branch is still intended as a
release source, it needs a fresh diff/rebase review against `4d4dba1f`; otherwise use the
already merged PR #75/main release line.

No production deploy, restart, migration or merge was performed by this gate.

---

## 1. Exact SHAs and acceptance scope

| Ref | SHA | Meaning |
|---|---|---|
| Baseline at start of acceptance | `af485f22c71264bc81eafb797538736c5f8a0553` | `origin/main` merge-base used for comparison |
| Remote integration branch before this pass | `6983328e9dcb9a7d2eac8c228bcbc8be2c07b850` | PR #73 head before local acceptance fixes |
| Final code tip after acceptance fixes | `4483485c72e065d8f279f687ecf4f05b8a78ef79` | Last product/test-code commit before this documentation commit |
| External current main discovered during the pass | `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b` | Result of PR #75; not the perf baseline |

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

- PR #73 (`integration/frontend-remediation` → `main`) is **closed, unmerged**; its recorded
  head remains `6983328e` from before the final acceptance commits.
- PR #75 is **merged** into main at 2026-11-25 11:51:41Z; base was `af485f22`, head
  `d008cf602da317433cc44e282c006b1ee5fd9d02`, resulting in main `4d4dba1f`.
- Therefore the exact branch accepted here is not automatically the current release line.
  Any further release decision must compare this branch with the PR #75 content already in
  `4d4dba1f`.

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
   PR #75. If the branch still contains unique required deltas, open a fresh comparison/review
   against `4d4dba1f` and run only the delta-driven checks.
3. If PR #75 is the accepted release line, use this report as supplementary evidence for the
   overlapping integration content, not as a direct approval of every line currently in main.
4. Deploy remains out of scope for this gate and requires the normal explicit release/deploy
   procedure.
