# FE-0023 A/B benchmark — prod builds, 10k ports + 10k sockets + 40 devices
# Stack: local_backend.py (E2E_STATE_NAME=.state-bench, MAIL_CREDENTIALS_KEY) on :18010
#         + serve-prod.mjs static/proxy; Playwright chromium, serviceWorkers=block.
# Worktree A = 926dd9f5 (pre-fix baseline, HUB-IT-stand-a dist on :5310)
# Worktree B = final branch (HUB-IT-final dist on :5311)

## Mobile 390x844 (isMobile+touch) — FE-0023 target

### Оборудование (10 000 ports)
| metric                | A (926dd9f5)        | B (final)           |
|-----------------------|---------------------|---------------------|
| settle after tab      | 20 842 ms           | 1 870 ms            |
| cards mounted         | 10 000              | 100 + «Показать ещё»|
| DOM nodes             | 180 591             | 2 393               |
| JS heap               | 662 MB              | 52 MB               |
| long tasks            | 5 (Σ 19.4s, max 10.3s) | 3 (Σ 0.7s, max 0.28s) |
| scroll rAF gap p95    | 183 ms (25/25 janky)| 34 ms (0 janky)     |

### Розетки (10 000 sockets)
| metric                | A (926dd9f5)         | B (final)          |
|-----------------------|----------------------|--------------------|
| settle after tab      | 16 032 ms            | 1 026 ms           |
| cards mounted         | 10 000               | 100 + «Показать ещё»|
| DOM nodes             | 130 458              | 1 760              |
| JS heap               | 532 MB               | 38 MB              |
| long tasks            | 9 (Σ 28.3s, max 10.8s)| 2 (Σ 0.26s, max 0.13s) |
| scroll rAF gap p95    | 228 ms (25/25 janky) | 34 ms (0 janky)    |

## Desktop 1440x900 — parity check (virtualized table both sides)
| metric     | A          | B          |
|------------|------------|------------|
| Розетки    | 956ms/860 DOM/24MB | 964ms/860 DOM/24MB |
| Оборудование | 1391ms/925 DOM/26MB | 1366ms/925 DOM/26MB |
| scroll     | clean      | clean      |

## Verdict
- Mobile: ~11-15x faster interactive, ~75-103x fewer DOM nodes, ~13x less heap,
  long tasks practically eliminated (max 10.8s -> 0.28s), scroll 25/25 janky -> 0.
- «Показать ещё» chunk footer works (showMore=true on both tabs).
- Desktop unchanged — fix is mobile-only as designed.
- FE-0023 measurement requirement (first frame, long tasks, DOM, heap, scroll) — DONE.
