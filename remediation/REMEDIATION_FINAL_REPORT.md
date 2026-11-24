# REMEDIATION FINAL REPORT — HUB-IT frontend audit

**Статус: программа завершена.** Все 324 записи реестра закрыты.

## Итоговая статистика
- **FIXED: 270** (83%)
- **REJECTED: 54** (17%) — design/backend-решения, невоспроизводимые, намеренные ограничения, ложные срабатывания
- **OPEN: 0**, **NEEDS_EVIDENCE: 0**

## Pull requests (хронология)
| PR | Батч | Записей |
|----|------|---------|
| #27–#46 | ранние батчи (см. PROGRESS.json) | — |
| #47–#65 | mail → pwa → monitoring → kb → misc | нарастающий итог FIXED 255 |
| #66 | final-polish (viewport, error reporting, SW update, mail inline img, Warehouse1C, robots.txt, quill audit) | +7 FIXED, +4 REJECTED |
| #67 | evidence-batch (guards, hook-order, Suspense, is_html, лимиты UX) | +8 FIXED, +4 REJECTED |

Детали по каждой записи: `PROGRESS.json` (поля status/commit/pr/notes).

## Принципиальные решения (см. DECISIONS.md)
- Порядок очередей/мутаций: чистые setState-апдейтеры + refs для side-effects.
- Запросы: useRequestGuard/seq-guards, in-flight dedup, SWR `onRevalidated`.
- Truncation UX: видимые индикаторы «показано N из M» / warning-тосты при достижении лимита.
- Отклонённые классы: dark theme, dual styling, CSP enforce, backend-латентность — решения владельца.

## Известные baseline-проблемы (не регрессы)
- `MyFiles` files-test и `TaskWorkspacePanel.test.jsx` — падают на чистом origin/main.
- 5 тестов chat-модуля — падают на origin/main, зелёные в локальном main.
