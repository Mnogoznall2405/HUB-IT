# RC Inventory — integration/frontend-remediation

Date of fixation: 2026-11-25 (UTC+5). Fetched from `origin` immediately before recording.

## SHAs

| Ref | SHA | Commit date | Subject |
|-----|-----|-------------|---------|
| `origin/main` (baseline) | `926dd9f542d578a156ee7239549caf041d38da21` | 2026-11-24 15:09:30 +0500 | Merge pull request #26 from Mnogoznall2405/perf/a8-ai-latency |
| `origin/integration/frontend-remediation` (candidate) | `a50ad10c1c615670fa59f5eda428498f7703ce37` | 2026-11-25 09:49:15 +0500 | test(migration): PG sticker gate on isolated PG17 + follow-up docs |

- Merge-base `origin/main` ∩ candidate = `926dd9f5…` (i.e. main is fully contained; nothing on main is missing from the candidate).
- Candidate is **116 commits ahead** of main (70 non-merge + 46 merge commits).
- Diff `origin/main...HEAD`: **311 files, +25 550 / −2 120**; within `WEB-itinvent/frontend`: **295 files, +21 630 / −2 092**.

## Integrated PRs / branches (verified ancestors of the candidate tip)

All fix batches below were merged into the integration branch by direct `git merge` of
`origin/<branch>`; their GitHub PRs target `main` and remain **open** (see next section).

### Batch PRs (open against `main`, branch content already integrated)

| PR | Branch | Title |
|----|--------|-------|
| #67 | fix/evidence-batch | fix(frontend): close NEEDS_EVIDENCE records (8 fixes) |
| #66 | fix/final-polish | fix(frontend): final polish — a11y, PWA updates, errors, mail inline, perf |
| #65 | fix/misc-batch | fix(frontend): misc batch — notifications, tasks, ad-users, drawers |
| #64 | fix/kb-dlp-batch | fix(frontend): kb+dlp batch — 6 findings |
| #63 | fix/mon-docflow-batch | fix(frontend): monitoring+docflow batch — 5 findings |
| #62 | fix/pwa-batch | fix(frontend): pwa/desktop batch — 6 findings |
| #61 | fix/company-batch | fix(company-structure): audit fixes for structure page and absences panel |
| #60 | fix/constr-batch | fix(construction): audit fixes for work workspace and objects page |
| #59 | fix/swr-batch | fix(swr-cache): guaranteed force refetch and stale revalidation delivery |
| #58 | fix/computers-batch | fix(computers): audit fixes for Computers page and employee history panel |
| #57 | fix(dash-batch) | fix(dashboard): keep cards on refresh error, dedupe alerts, in-dialog save error |
| #56 | fix/shared-batch | fix(shared-files): download error text, retry action, list cap, visible-only tick |
| #55 | fix/stats-batch | fix(statistics): SWR dedupe, seq-guarded refresh, blob error text, URL revoke delay |
| #54 | fix/feed-batch | fix(feed): attachment stubs, draft autosave guards, comment poll/lookup fixes |
| #53 | fix(networks-batch) | fix(networks): global key guards, edit-permission gates, race and virtual-scroll fixes |
| #52 | fix(layout-batch) | fix(layout): notification drawer semantics, badge accuracy, nav overlay |
| #51 | fix(itobjects-batch) | fix(it-objects): abort signal, save-failure guard, confirm revokes |
| #50 | fix(scancenter-batch) | fix(scan-center): URL-synced tabs, abort coverage, busy guards |
| #49 | fix(myfiles-batch) | fix(my-files): upload-queue guard, bulk progress, deep-link, editor-session (13 records) |
| #48 | fix(auth-misc-batch) | fix(auth-misc): storage guards, epoch reset, SPA nav, Login a11y/UX (15 records) |
| #47 | fix(mail-batch) | fix(mail): draft lifecycle, preview fetch, read-state rollback, a11y (21 records) |
| #46 | fix(tasks-batch) | fix(tasks): batch audit fixes (13 records) |
| #45 | fix(chat-batch) | fix(chat): 15 записей — pending reads, heartbeat degrade, busy/seq guards, a11y |
| #44 | fix(voice-batch) | fix(voice): 18 записей — busy/abort guards, клавиатура/a11y, perf |

### Chained PRs (base = another fix branch; all tips verified included)

| PR | Branch | Base |
|----|--------|------|
| #43 | fix/database-races | fix/database-misc |
| #42 | fix/database-misc | main |
| #41 | fix/account-aibots-lazy | fix/account-draft-loss |
| #40 | fix/account-draft-loss | fix/account-seq-guards |
| #39 | fix/account-seq-guards | fix/account-guards |
| #38 | fix/account-guards | main |
| #37 | fix/networks-map | fix/networks-sites-deadcode |
| #36 | fix/networks-sites-deadcode | fix/networks-correctness |
| #35 | fix/networks-correctness | main |

### Single-fix PRs integrated

| PR | Branch | Title |
|----|--------|-------|
| #34 | fix/networks-csv-sanitize | fix(networks): sanitize CSV export cells against formula injection |
| #33 | fix/networks-a11y | a11y(networks): labels, keyboard access, valid card DOM |
| #32 | fix/warehouse1c-keyboard | a11y(warehouse1c): keyboard access for clickable desktop rows/cells |
| #31 | fix/networks-mobile-render | perf(networks): chunk mobile card lists |
| #30 | fix(construction-beforeunload) | fix(construction): warn on beforeunload for unsaved drafts |
| #29 | fix(auth-refresh-coordination) | fix(auth): coordinate refresh-token rotation across tabs |
| #28 | fix(account-department-race) | fix(account): department managers race writes roles to wrong dept |
| #27 | fix(account-delegate-integrity) | fix(account): stop wiping task delegates after failed bulk load |
| #23 | fix(auth-2fa-flow) | fix(auth): post-auth UI hold for 2FA backup codes and trusted-device prompt |

### Feature PR integrated

| PR | Branch | Title | Status |
|----|--------|-------|--------|
| #69 | feat/chat-sticker-system-v2 | feat(chat): sticker system V2 — favorites, synced recents, search, suggestions | Branch merged into candidate (merge `e6aa925`); PR itself still **open** against `main` |

## AGREED-but-unmerged PRs (open, NOT contained in candidate)

| PR | Branch | Title | Notes |
|----|--------|-------|-------|
| #68 | perf/my-files-v3 | My Files Performance V3: listing indexes, include=tree,quota, ETag/304, cursor pagination | **Open, not integrated.** Tip `01db9456` (V3.1 — ETag cost, honest A/B bench, load diagnostics). Updated 2026-11-24T14:04Z — most recent activity of all open PRs. |
| #10 | fix/fe-0064-task-editor-safe-paste | fix(FE-0064): безопасная вставка HTML в мобильный редактор описания задачи | Open, not integrated. Tip `1d93d28b`. |
| #15 | docs/ai-architecture-audit | Docs: аудит архитектуры встроенного ИИ и оценка open-source инструментов | Open, not integrated (docs-only). Tip `77518c4e`. |
| #9 | audit/frontend-2026-11-22 | audit(frontend): непрерывный аудит web-фронтенда — 324 записи | Open, not integrated (audit report). Tip `bbc9ed1e`. |

### Verification answers

- **PR #45 (fix/chat-batch)**: NOT merged to `main` — PR is still **open**; however `origin/fix/chat-batch` IS an ancestor of the candidate (merged via `9a6e167f`), so its content is in the RC.
- **PR #68 (perf/my-files-v3)**: still **open** and **not** in the RC.
- **PR #69 (feat/chat-sticker-system-v2)**: content **is** in the RC; PR still open against main.

## Recently closed PRs (already on main, ≤2026-11-24)

#26 perf/a8-ai-latency (main tip), #24 perf/my-files-v2, #18 feat/my-files-compact-ux,
#25 docs/a7-performance, #17 feat/chat-emoji-picker-telegram, #22 perf/ai-jev-a51,
#21 perf/ai-jev-smart-routing-a5, #20 security/ai-prompt-injection-a3,
#19 fix/ai-conversation-run-serialization-a4, #16 fix/ai-worker-stability-a1,
#14 feat/files-ui-redesign, #13 feat/chat-sidebar-telegram-modes, #11 feat/document-printing,
#12 feat/onlyoffice-preview-migration (native preview viewers), #8 feat/onlyoffice-preview-migration (ONLYOFFICE engine).
Older: #7, #6, #5, #3, #2, #1, #4.
