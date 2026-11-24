# INTEGRATION_REPORT — интеграция 42 PR фронтенд-ремедиации

Репозиторий: `Mnogoznall2405/HUB-IT`
Ветка: `integration/frontend-remediation` (worktree `C:\Project\HUB-IT-integration`)
База: `origin/main` @ `926dd9f542d578a156ee7239549caf041d38da21` (post-PR #26, My Files V2)
Итоговый SHA: `a18fc5e7` (включает agent-review фиксы)
Дата: 2026-11-24

## 1. Scope и метод

- В программу включены PR #23 и #27–#67 (42 PR). PR #9 (аудит, источник
  реестра) и #10 (fix/fe-0064, сторонний) **не включены** — `fix/fe-0064`
  подтверждённо не является ancestor интеграционной ветки.
- Каждый PR вмержен последовательно как `origin/<branch>` merge-commit,
  без `--ours`/`--theirs`: конфликты разрешались композицией обеих сторон.
- Проверка включения: для каждого remote head `git merge-base --is-ancestor`
  → **все 42/42 = True** (плюс stacked-коммиты цепочки #38–#41).

## 2. Конфликты и резолюции

| # | Конфликт | Резолюция |
|---|----------|-----------|
| 1 | #49 × main V2 (MyFiles.jsx rewrite) | Pre-merge в #49: deep-link `?folder=` reset (403/404/410 + warning) идёт первым, за ним V2 evict+очистка (401/403/404); deps объединены; `postMutationLoadData` сохранён. 113/113 тестов |
| 2 | #48 × (#29, #23, #43) — http.js, Login.css | http.js: union refresh-координации (#29) и правок #48; Login.css: touch-target 36px+ (#48) |
| 3 | #37 × ранние networks — Networks.jsx IconButton | union `aria-label` (#33) + `cancelPointEdit()` (#37) |
| 4 | #53 × ранние networks — Networks.jsx | union маркеров секций |
| 5 | #66 × #47 — MailComposeHost.jsx | inline-images (FE-0215) поверх mail-batch; оба изменения сохранены |
| 6 | #66 × #62 — pwaInstall/MainLayout | update-check интервал (#66) + pwa-правки (#62) |
| 7 | #66 × #32 — Warehouse1C.jsx | keyboard (#32) + useVisibleRows incremental render (#66) |
| 8 | #67 × #59 — Networks.jsx `loadBranchContext` | swr-версия (`applyBranchContext`+`onRevalidated`), `socketsTruncated`/`portsTruncated` флаги перенесены в swr-fetcher, warning-тосты в apply; дубль функции из #67 удалён |

## 3. Найденные и устранённые merge-loss инциденты

| Инцидент | Файл | Что произошло | Статус |
|----------|------|----------------|--------|
| containerWidth | `useVirtualizedTableWindow.js` | state `containerWidth`/`setContainerWidth` потерян при мержe → `ReferenceError` в рантайме | FIXED в интеграции (state + вызовы + оба return-объекта) |
| viewport-директивы | `index.html` | мерж #66 заменил baseline-строку, убрав `maximum-scale=1.0, user-scalable=no` | FIXED (`53732f53`) — восстановлен union с `interactive-widget=resizes-content` |
| post-auth навигация | `Login.postAuthHold.test.jsx` | merged-дизайн отдаёт навигацию SPA вместо `location.assign`; тесты требовали старый контракт | FIXED — тесты обновлены, hold-семантика сохранена |
| emoji toggle label | `ChatComposer.behavior.test.jsx` | main добавил pin-режим → кнопка 'Закрепить панель эмодзи'; тест искал 'Закрыть' (падал и на baseline) | FIXED — поиск по testid |
| deferred revoke | `mailMessageFileActions.test.js` | fake timers ставились после вызова — отложенный revoke не продвигался | FIXED — порядок исправлен |

## 4. Результаты регрессии

Подробно — `REGRESSION_RESULTS.md`. Кратко:

- **vitest**: 5152 passed / 2 skipped / **1 fail** — `ChatPageContent.smoke`
  embedded-discussion, **подтверждён как baseline** на 926dd9f5-lineage
  (тот же таймаут + jsdom XHR AggregateError на чистом main).
- **build**: PASS. **backend pytest**: 21/21 PASS. **diff --check**: чисто.
- **E2E (E2E_LOCAL)**: стек поднимается (SQLite backend + vite), login
  работает; экраны с inventory-данными блокируются отсутствием SQL Server —
  частичное покрытие, см. §6.

## 5. Сверка 324 записей реестра

- FIXED **270** — все из 42 merged PR; каждый head = ancestor интеграции →
  статус фактически `FIXED_IN_INTEGRATION` для всех FIXED-записей.
- REJECTED **49** — после ревизии: 5 записей с `auditStatus=Confirmed`,
  отклонённых по scope-причинам (FE-0030, FE-0038, FE-0039, FE-0065,
  FE-0077), **переведены в OPEN** — дефект подтверждён, решение за владельцем.
- OPEN **5** — вышеуказанные deferred-записи.
- NEEDS_EVIDENCE **0**.

## 6. Ограничения проверки

- Полный браузерный E2E (multi-tab refresh FE-0059/0083, полный 2FA-цикл
  FE-0197/0198) частично покрыт unit/jsdom; локальный playwright-стек
  поднимается, но без SQL Server часть экранов не рендерится.
- Networks 10k-портов замер — BLOCKED (нет данных в песочнице);
  chunk-render — защитная оптимизация без подтверждающего замера.
- `data/local_store.db` — pre-existing дефект изоляции backend-тестов
  (глобальный синглтон шарит состояние); не регресс интеграции, backend
  не изменён.

## 7. Статусы PR

Все 42 PR: **READY** для merge в main в порядке `MERGE_ORDER.md`
(каждый протестирован в интеграции; конфликты задокументированы и
разрешены композицией). Исключения/оговорки — в `FINAL_SIGNOFF.md`.

## 8. Независимое ревью агентов

4 доменных ревьюера проверили интегрированный код (не свои PR):

- **State/Async/Data Integrity** — CLEAN (только косметические indent-артефакты
  и pre-existing дизайн-замечания). Все seq/busy/draft-гарды и делегаты
  FE-0232/FE-0239 на месте; swr-инвалидации не потеряны.
- **Networks & Performance** — 1 MEDIUM (дубль кнопок «Показать ещё» в
  Warehouse1C mobile — merge-duplication → исправлено `a18fc5e7`),
  3 LOW (truncation-warning при revalidate портов → исправлено `a18fc5e7`;
  dead `editingPort`; focus-loss при исчерпании списка; dead imports — оставлены
  как pre-existing lint-noise).
- **Auth & Security** — 1 MEDIUM (endpoint `/auth/verify-2fa-login` не входил
  в новый endsWith-список epoch-reset в http.js — введено ремедиацией →
  исправлено `a18fc5e7`), 1 HIGH-кандидат оказался **pre-existing дефектом
  main** (dead trusted-device path в renderVerifyStep — идентично на
  926dd9f5, см. FINAL_SIGNOFF §Known Issues), 4 LOW informational.
- **Final merge-loss scan** — 42 мержа разобраны через reflog; 5 ручных
  конфликт-резолюций проверены; конфликт-маркеров/дублей нет. 1 owner-
  decision (viewport zoom-lock vs WCAG pinch-zoom — см. §7 FINAL_SIGNOFF),
  1 INFO (FE-0064 вне программы по дизайну).
