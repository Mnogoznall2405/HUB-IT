# FINAL_SIGNOFF — интеграция 42 PR фронтенд-ремедиации

Ветка: `integration/frontend-remediation` @ `a18fc5e7` (запушена)
База: `origin/main` @ `926dd9f5`
Дата: 2026-11-24

## Вердикт

**Интеграционная сборка готова к независимому ревью владельца.**
Все 42 PR включены, конфликты разрешены композицией (без ours/theirs),
обнаруженные merge-регрессы исправлены прозрачными коммитами,
регрессия зелёная (единственный fail — подтверждённый baseline).

Merge в main и production deploy **не выполнялись** — по инструкции.

## Статус каждого PR

| PR | Ветка | Статус | Примечание |
|----|-------|--------|-----------|
| #23 | fix/auth-2fa-flow | READY | post-auth hold сохранён; тесты обновлены под SPA-навигацию |
| #27 | fix/account-delegate-integrity | READY | FE-0232 гарды на месте (агент-ревью) |
| #28 | fix/account-department-race | READY | FE-0239 seq-гарды на месте |
| #29 | fix/auth-refresh-coordination | READY | + интеграционный фикс verify-2fa-login epoch (`a18fc5e7`) |
| #30 | fix/construction-beforeunload | READY | leave-guard 10/10 unit |
| #31 | fix/networks-mobile-render | READY | chunk-render в EquipmentTab/SocketsTab |
| #32 | fix/warehouse1c-keyboard | READY | совместим с #66; дубли кнопок убраны |
| #33 | fix/networks-a11y | READY | aria-label + cancelPointEdit union |
| #34 | fix/networks-csv-sanitize | READY | csvCell sanitize + тест |
| #35 | fix/networks-correctness | READY | busy-guards, confirms |
| #36 | fix/networks-sites-deadcode | READY | |
| #37 | fix/networks-map | READY | pan clamps, gestures, markers |
| #38 | fix/account-guards | DEPENDENT | stacked → мержить до #39 |
| #39 | fix/account-seq-guards | DEPENDENT | stacked → до #40 |
| #40 | fix/account-draft-loss | DEPENDENT | stacked → до #41 |
| #41 | fix/account-aibots-lazy | READY | вершина цепочки (включает #38–#40) |
| #42 | fix/database-misc | READY | |
| #43 | fix/database-races | READY | |
| #44 | fix/voice-batch | READY | |
| #45 | fix/chat-batch | READY | emoji pin-mode контракт теста обновлён |
| #46 | fix/tasks-batch | READY | |
| #47 | fix/mail-batch | READY | совместим с #66 (MailComposeHost) |
| #48 | fix/auth-misc-batch | READY | http.js/Login.css конфликты разрешены union |
| #49 | fix/myfiles-batch | READY | V2-композиция проверена агентом — оба гарда живы |
| #50 | fix/scancenter-batch | READY | |
| #51 | fix/itobjects-batch | READY | |
| #52 | fix/layout-batch | READY | |
| #53 | fix/networks-batch | READY | Networks.jsx union с ранними PR |
| #54 | fix/feed-batch | READY | |
| #55 | fix/stats-batch | READY | |
| #56 | fix/shared-batch | READY | |
| #57 | fix/dash-batch | READY | |
| #58 | fix/computers-batch | READY | |
| #59 | fix/swr-batch | READY | конфликт с #67 разрешён (swr + truncation flags) |
| #60 | fix/constr-batch | READY | |
| #61 | fix/company-batch | READY | |
| #62 | fix/pwa-batch | READY | |
| #63 | fix/mon-docflow-batch | READY | |
| #64 | fix/kb-dlp-batch | READY | |
| #65 | fix/misc-batch | READY | |
| #66 | fix/final-polish | READY | index.html merge-loss исправлен; дубли Warehouse1C убраны |
| #67 | fix/evidence-batch | READY | Networks.jsx резолюция применена и проверена |

SUPERSEDED: нет. BLOCKED: нет (см. ограничения проверки ниже).

## Реестр 324 записей — итоговые статусы

| Статус | Кол-во | Интерпретация |
|--------|--------|---------------|
| FIXED | 270 | FIXED_IN_PR → все подтверждены FIXED_IN_INTEGRATION (42/42 head = ancestor) |
| REJECTED | 49 | верифицированные ложные срабатывания / Suspected-записи |
| OPEN | 5 | FE-0030, FE-0038, FE-0039, FE-0065, FE-0077 — Confirmed-дефекты, решение за владельцем (переведены из REJECTED: scope-отклонение запрещено правилами) |

## Инциденты интеграции и их разрешение

| # | Инцидент | Статус |
|---|----------|--------|
| 1 | `containerWidth` потерян при мерже (useVirtualizedTableWindow) | FIXED |
| 2 | viewport-директивы потеряны при мерже #66 | FIXED (`53732f53`) |
| 3 | `/auth/verify-2fa-login` не сбрасывал auth-epoch (агент-ревью) | FIXED (`a18fc5e7`) |
| 4 | Дубли «Показать ещё» в Warehouse1C mobile (merge-duplication) | FIXED (`a18fc5e7`) |
| 5 | Truncation-warning не срабатывал при swr-revalidate портов | FIXED (`a18fc5e7`) |
| 6 | Устаревший контракт тестов: post-auth nav (SPA), emoji pin-mode label, deferred revoke timers | Тесты обновлены |

## Known Issues (не блокеры merge; pre-existing на main)

1. **Trusted-device verify-step — dead code** (`Login.jsx`): гейт
   `canUseTrustedDeviceHero = step === 'password'` делает HeroAction в
   `renderVerifyStep` недостижимым. Идентично на `926dd9f5` — дефект main,
   НЕ регресс интеграции. Фолбэк на TOTP работает. Рекомендуется отдельный
   фикс владельцем.
2. **Backend-тест изоляция**: `local_store` синглтон шарит состояние между
   pytest-прогонами через `data/local_store.db`. Pre-existing; backend в
   интеграции не менялся.
3. **Viewport zoom-lock**: `user-scalable=no` — решение main (PWA app-feel);
   #66 предлагал снять для WCAG pinch-zoom, но его же тест фиксировал lock.
   Оставлен baseline-lock; решение за владельцем.
4. **FE-0064** — фикс живёт в стороннем PR #10 (вне программы). Владельцу
   мержить отдельно.
5. Флаки под нагрузкой полного прогона: `ChatThread` deferred-picker,
   `Database` row helpers — зелёные изолированно.
6. `ChatPageContent.smoke` embedded-discussion — baseline-fail на чистом
   main (XHR AggregateError в jsdom), не регресс.

## Ограничения проверки (честные границы sign-off)

- **Полный браузерный E2E не завершён**: локальный playwright-стек
  (E2E_LOCAL, SQLite backend + vite) поднимается и login работает, но без
  SQL Server экраны с inventory-данными не рендерят anchors; после ~1.5
  мин на тест прогон остановлен как непродуктивный в песочнице. Для
  окончательного P0 sign-off FE-0197/0198 (2FA-цикл), FE-0059/0083
  (multi-tab refresh) и FE-0232/0239 нужен стенд владельца — unit/jsdom
  покрытие этих сценариев есть и зелёное.
- **Networks 10k-портов perf-замер**: не выполнен (нет данных). Chunk-render
  — защитная оптимизация; утверждать измеренный выигрыш нельзя.
- **FE-0215** (mail inline images): код-ревью агента подтверждает retention-
  логику blob/ cid-маппинга; EWS-контракт end-to-end на реальном сервере не
  проверен.

## Рекомендация владельцу

1. Merge по `MERGE_ORDER.md` — либо точечно 42 PR, либо саму ветку
   `integration/frontend-remediation` одним мержем (все конфликты уже
   разрешены).
2. Прогнать E2E на стенде с SQL Server (screens-smoke + multi-tab + 2FA).
3. Решить 5 OPEN-записей (arch/design/backend-scope) и 4 Known Issues.
4. Отдельно: PR #10 (FE-0064) и устранение trusted-device dead path.
