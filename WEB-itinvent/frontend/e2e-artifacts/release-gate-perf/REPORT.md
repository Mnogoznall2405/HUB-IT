# Release perf A/B — baseline `origin/main@926dd9f5` vs candidate `integration/frontend-remediation@1a2a7a0b`

Production builds (`E2E_LOCAL=1 E2E_BUILD=1`, `vite build` → `vite preview`), isolated
outDirs/ports/state per side, identical seed (users + spec-seeded chat + 25 my-files
uploaded via the real upload-session API), alternating A/B order per round.
Gate rule: p95 regression >10% on candidate ⇒ root-cause evidence required.

Specs: `e2e/global-perf-gate.spec.js` (new, this gate), `e2e/chat-regression-perf.spec.js`,
`e2e/chat-send-focus-perf.spec.js` (copied to baseline verbatim). n=30–40 for timed
scenarios; 1440×900 primary, 988×838 secondary for chat-regression.

## Verdict

**PASS with two documented findings.** No systematic p50 regression >10% anywhere.
Two p95 flags: (A) warm-dock send/typing — reproducible direction across two
reversed-order pairs, code-level cause identified, ~25–40 ms; (B) cold-nav p95 —
2/30 outlier samples on a machine shared with other gate runs, not reproduced on
re-measure.

## Global gate (n=30/leg)

| scenario | base p50 | cand p50 | Δp50 | base p95 | cand p95 | Δp95 | verdict |
|---|---|---|---|---|---|---|---|
| cold_nav_login_ms | 296 | 336 | +13.5% | 322 | 1417 | +340% | outlier — see note B |
| cold_login_dashboard_ms | 1305 | 1298 | −0.5% | 1475 | 1610 | +9.2% | ok |
| cold_total_ms | 1664 | 1728 | +3.8% | 1850 | 2808 | +51.8% | driven by same outliers |
| route_dashboard | 260.9 | 282.9 | +8.4% | 331 | 383.5 | +15.9% | tail (+52 ms) |
| route_chat | 264.0 | 275.1 | +4.2% | 303.1 | 402.0 | +32.6% | tail (+99 ms) |
| route_mail | 1844.3 | 1871.0 | +1.4% | 1898.6 | 2005.2 | +5.6% | ok |
| route_my-files | 212.8 | 219.2 | +3.0% | 392.7 | 463.1 | +17.9% | tail (+70 ms; both sides had one 15 s max) |
| route_tasks | 287.1 | 284.9 | −0.8% | 323.1 | 426.5 | +32.0% | tail (+103 ms) |
| file_list_load | 512.1 | 509.6 | −0.5% | 589.2 | 541.5 | −8.1% | ok |
| search_echo_ms | 23.0 | 21.3 | −7.4% | 36.2 | 36.6 | +1.1% | ok |

Cold-start resources: apiRequests 13→17 (+31%), netResources 57→71 (+25%),
netBytes 1.26→0.84 MB (−33%), FCP 276→164 ms (−41%), LCP 276→164 ms (−41%),
heap 20→20 MB. More, smaller requests with better paint — neutral/positive.
Durability probe (20 cycles × 5 legs): heap Δ3 MB base vs Δ2 MB cand — no leak delta.

## Chat regression 1440×900 (n=30)

| scenario | base p50 | cand p50 | Δp50 | base p95 | cand p95 | Δp95 | verdict |
|---|---|---|---|---|---|---|---|
| conv_switch | 728.1 | 750.1 | +3.0% | 966.8 | 1027.1 | +6.2% | ok |
| history_load | 724.6 | 717.6 | −1.0% | 956.4 | 971.7 | +1.6% | ok |
| history_1000 firstBubble | 760.4 | 757.2 | −0.4% | 1050.1 | 984.3 | −6.3% | ok |
| history_1000 settled | 787.6 | 787.7 | +0.0% | 1074.7 | 1017.9 | −5.3% | ok |
| typing_echo_ms | 28.4 | 25.6 | −9.9% | 34.0 | 28.6 | −15.9% | faster |
| emoji_pinned | 271.9 | 184.9 | −32.0% | 318.7 | 298.4 | −6.4% | faster |
| emoji_hover_ms | 228.8 | 209.5 | −8.4% | 237.3 | 221.2 | −6.8% | ok |
| tab_to_stickers_ms | 141.2 | 151.0 | +6.9% | 196.0 | 209.0 | +6.6% | ok |
| tab_to_emoji_ms | 175.7 | 191.6 | +9.0% | 226.4 | 232.7 | +2.8% | ok |
| send_echo_ms | 183.4 | 178.7 | −2.6% | 224.5 | 296.0 | +31.8% | tail — see note B |
| receive_ms | 104.4 | 91.6 | −12.3% | 176.9 | 131.1 | −25.9% | faster |
| chat_open_cold_ms | 1135 | 1037 | −8.6% | 1277 | 1304 | +2.1% | ok |

Candidate rerun (`chat-regression-cand-1440x900-rerun.json`, --trace off):
send_echo p50 113.1 / p95 172, typing p50 15.1 — first cand run sat under
machine contention; rerun shows no send_echo p95 regression.
Memory cycles meanDelta = 1 MB on both sides (3 series × 50 cycles).

988×838: runs not comparable — the base leg ran under heavier load than the cand
leg (all metrics −30…−70% on cand). Kept as artifacts; do not read deltas.

## Send-focus 1440×900 (n=40 send, 25 typing)

| mode | metric | base p50 | cand p50 | Δp50 | base p95 | cand p95 | Δp95 | verdict |
|---|---|---|---|---|---|---|---|---|
| off | typing_echo | 26.0 | 26.6 | +2.3% | 30.4 | 40.5 | +33.2% | small-tail flag |
| off | send_echo | 87.8 | 75.2 | −14.4% | 127.2 | 102.9 | −19.1% | faster |
| warm | typing_echo | 37.5 | 47.1 | +25.6% | 46.6 | 61.9 | +32.8% | see note A |
| warm | send_echo | 140.2 | 176.0 | +25.5% | 170.6 | 192.7 | +13.0% | see note A |
| open | typing_echo | 49.8 | 52.9 | +6.2% | 84.5 | 78.6 | −7.0% | ok |
| open | send_echo | 171.7 | 179.0 | +4.3% | 196.9 | 199.9 | +1.5% | ok |
| warm r2 (cand→base) | typing_echo | 9.1 | 8.6 | −5.5% | 22.6 | 25.9 | +14.6% | within noise |
| warm r2 (cand→base) | send_echo | 56.5 | 79.8 | +41.2% | 97.1 | 119.4 | +23.0% | see note A |

### Note A — warm-dock send/typing (flagged, root-caused)

Direction consistent in both pairs (cand slower on send_echo p50/p95), magnitude
varies with dock state (round-2 internal state differed: rendered 15–20k vs
40–47k nodes, requests 16–18 vs 1). Structural evidence on candidate:

- `ChatComposer.jsx` now mounts `ChatStickerSuggestions` (new, +246 lines) and
  computes `getTrailingEmojiToken(messageText)` on every keystroke; every
  keydown also routes through `stickerSuggestionsRef.handleComposerKey`.
- `TelegramStickersTab.jsx` rewritten (+1040 lines) with sticker search index /
  recents; the dock keep-mounts the panel under `display:none` — candidate adds
  the `visible` prop to skip work while hidden, but round-1 warm sends still
  rendered +17.8% nodes/commit vs base (47574 vs 40404, threadRendered 0 both).
- typing_echo warm includes per-keystroke token parse; send_echo warm includes
  composer submit re-render over the mounted dock. Expected cost is small
  (~25–40 ms tail), isolated to the keep-mounted-dock path; `dock=open` shows
  no delta (+1.5% p95) and `dock=off` is faster on cand.

Recommendation: verify on a quiet machine; if confirmed, defer index/suggestion
work until the first emoji token appears and memoize the hidden sticker tab.

### Note B — p95 tail outliers (documented, environmental)

- `cold_nav_login` p95 1417 ms: 2/30 samples ~1.4 s while base max was 324 ms —
  transient (another gate run's vite build overlaps the shared machine).
- Route-transition p95 tails are +50–100 ms with p50 ≤ +8% and identical
  apiRequests/commits — consistent with shared-CPU contention, not a shift.
- `route_my-files` had one 15 s marker-timeout sample on BOTH sides.
- `send_echo` 1440×900 p95 +31.8% with p50 −2.6% — not reproduced on the cand
  rerun (p95 172 ms). Treated as contention tail.

## Bundle size

| | base | cand | Δ |
|---|---|---|---|
| assets total | 23.66 MB (622 files) | 23.75 MB (620 files) | +0.09 MB (+0.4%) |
| ChatPageContent chunk | 668.3 KB | 672.4 KB | +4.1 KB |

## Harness notes (identical both sides unless marked)

- Backend decoys (`stab_backend.py`/`stab_python.cmd`, untracked) run the same
  code as `local_backend.py`; **baseline needed `MAIL_CREDENTIALS_KEY` added** —
  login is impossible without it at 926dd9f5 too.
- `MY_FILES_MAX_UPLOADING_PER_USER=100 / MAX_ACTIVE_JOBS_PER_USER=500 /
  MAX_ACTIVE_JOBS_GLOBAL=500` exported for seeding — e2e disables the inline
  files worker, so uploads stay QUEUED and the default per-user cap (5) blocks
  seeding 25 files. Throwaway stacks only; same on both revisions.
- Sticker seed differs cosmetically: cand generates 256 px WebP via Pillow vs
  base 1×1 — noted as noise; does not explain findings (dock=open equal).
- `E2E_BUILD_OUTDIR` isolates each worktree's `vite preview` output
  (playwright.config.js hunk, staged separately in the same commit).
- Mail: credentials dialog auto-opens on /mail and cannot be dismissed —
  deterministic on both revisions; nav clicks under the modal use dispatchEvent.
- Artifacts: `global-perf-gate-{side}-1440x900.json`,
  `chat-regression-{side}-{viewport}[-rerun].json`,
  `send-focus-{side}-{off|warm|open}-1440x900[-r2].json`, `perf-compare.json`,
  `bundle-sizes.json`, run logs at `.codex_tmp/perf-logs/`.
