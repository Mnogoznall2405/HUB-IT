# MERGE_ORDER — рекомендуемый порядок merge 42 PR

База: `origin/main` @ `926dd9f5` (после merge PR #26, My Files V2).
Интеграционная ветка: `integration/frontend-remediation` @ `53732f53`.

Порядок ниже — фактический порядок, в котором PR были вмержены в
интеграционную ветку и проверены. Он же рекомендуется для merge в `main`,
т.к. минимизирует конфликты и сохраняет stacked-зависимости.

## Волна 1 — фундамент: auth + account + early singles

| # | PR | Ветка | Почему рано |
|---|-----|-------|-------------|
| 1 | #23 | fix/auth-2fa-flow | трогает Login.jsx/AuthContext — база для auth-конфликтов |
| 2 | #27 | fix/account-delegate-integrity | первый из account-блока |
| 3 | #28 | fix/account-department-race | account |
| 4 | #29 | fix/auth-refresh-coordination | http.js — конфликтует с #48, мержить раньше |
| 5 | #30 | fix/construction-beforeunload | изолирован |
| 6 | #31 | fix/networks-mobile-render | первый из 7 networks-PR |
| 7 | #32 | fix/warehouse1c-keyboard | конфликтует с #66, раньше лучше |
| 8 | #33 | fix/networks-a11y | Networks.jsx цепочка |
| 9 | #34 | fix/networks-csv-sanitize | Networks.jsx |
| 10 | #35 | fix/networks-correctness | Networks.jsx |
| 11 | #36 | fix/networks-sites-deadcode | Networks.jsx |
| 12 | #37 | fix/networks-map | **конфликт**: Networks.jsx IconButton (aria-label + cancelPointEdit union) |

## Волна 2 — stacked account chain (строго по порядку)

| # | PR | Ветка | Зависимость |
|---|-----|-------|-------------|
| 13 | #38 | fix/account-guards | base для #39 |
| 14 | #39 | fix/account-seq-guards | зависит от #38 (stacked) |
| 15 | #40 | fix/account-draft-loss | зависит от #39 |
| 16 | #41 | fix/account-aibots-lazy | зависит от #40 |

⚠️ #38→#41 — stacked: каждый PR построен поверх предыдущего. Мержить строго
в этом порядке или только верхушку #41 (она включает все нижние коммиты).

## Волна 3 — доменные батчи

| # | PR | Ветка |
|---|-----|-------|
| 17 | #42 | fix/database-misc |
| 18 | #43 | fix/database-races |
| 19 | #44 | fix/voice-batch |
| 20 | #45 | fix/chat-batch |
| 21 | #46 | fix/tasks-batch |
| 22 | #47 | fix/mail-batch |
| 23 | #48 | fix/auth-misc-batch | **конфликт**: http.js (с #29), Login.css |
| 24 | #49 | fix/myfiles-batch | уже содержит merge origin/main (V2-композиция) |
| 25 | #50 | fix/scancenter-batch |
| 26 | #51 | fix/itobjects-batch |
| 27 | #52 | fix/layout-batch |
| 28 | #53 | fix/networks-batch | **конфликт**: Networks.jsx (с ранними networks-PR) |
| 29 | #54 | fix/feed-batch |
| 30 | #55 | fix/stats-batch |
| 31 | #56 | fix/shared-batch |
| 32 | #57 | fix/dash-batch |
| 33 | #58 | fix/computers-batch |
| 34 | #59 | fix/swr-batch | **конфликт с #67**: Networks.jsx loadBranchContext |
| 35 | #60 | fix/constr-batch |
| 36 | #61 | fix/company-batch |
| 37 | #62 | fix/pwa-batch |
| 38 | #63 | fix/mon-docflow-batch |
| 39 | #64 | fix/kb-dlp-batch |
| 40 | #65 | fix/misc-batch |
| 41 | #66 | fix/final-polish | **конфликт**: MailComposeHost (с #47), pwaInstall (с #62), Warehouse1C (с #32), index.html |
| 42 | #67 | fix/evidence-batch | **конфликт с #59**: Networks.jsx — резолюция описана ниже |

## Ключевые конфликтные пары и резолюции

| Пара | Файл | Резолюция |
|------|------|-----------|
| #59 × #67 | Networks.jsx `loadBranchContext` | swr-версия (`applyBranchContext` + `onRevalidated` + fetcher); `socketsTruncated`/`portsTruncated` флаги добавлены в fetcher swr-версии, warning-тосты в apply. Дубль `loadBranchContext` из #67 удалён |
| #48 × #29 | http.js | union: refresh-координация вкладок (#29) + правки #48 |
| #37 × ранние | Networks.jsx IconButton | `aria-label` (#33) + `cancelPointEdit()` (#37) — union |
| #66 × #47 | MailComposeHost.jsx | inline-images fix (#66) поверх mail-batch правок — union |
| #66 × #32 | Warehouse1C.jsx | keyboard (#32) + useVisibleRows incremental render (#66) — union |
| #66 × #62 | pwaInstall/MainLayout | update-check интервал (#66) + pwa-правки (#62) — union |
| #49 × main | MyFiles.jsx | deep-link `?folder=` reset (403/404/410) + V2 evict + postMutationLoadData — композиция обоих catch-гардеров |

## Merge-loss инциденты, исправленные в интеграции

1. `useVirtualizedTableWindow.js` — потерян `containerWidth` state при мерже
   → восстановлен (state, вызовы в containerRef/updateViewport, поле в обоих return).
2. `index.html` — мерж #66 убрал `maximum-scale=1.0, user-scalable=no` из
   viewport → восстановлено до baseline-директивы (commit `53732f53`).

## Правила

- Не мержить #38–#41 иначе чем подряд в указанном порядке.
- После #48 перепроверять http.js и Login.jsx (самые конфликтные auth-файлы).
- После #59 и #67 перепроверять Networks.jsx целиком.
- PR #9 (аудит) и #10 (fix/fe-0064) НЕ входят в программу — не мержить.
