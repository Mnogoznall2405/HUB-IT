# NEXT ACTIONS — программа завершена

Обновлять при каждом checkpoint. Восстановление контекста: читать `PROGRESS.json` (все 324), этот файл, `MASTER_PLAN.md`, `DECISIONS.md`, `REMEDIATION_FINAL_REPORT.md`.

## Финальное состояние (2026-12-18, final)
- **ВСЕ 324 записи закрыты: FIXED 270, REJECTED 54, OPEN 0, NEEDS_EVIDENCE 0.**
- Последний батч — evidence: PR **#67** `fix/evidence-batch` (commit 5b9f7bd6): FE-0194/0230/0115/0110/0265/0076/0300/0161 — FIXED; FE-0324/0323/0004/0051 — REJECTED (см. notes в PROGRESS.json).
- Итоговый отчёт: `REMEDIATION_FINAL_REPORT.md`.
- Известные baseline-падения тестов на origin/main (не регрессы программы): `MyFiles` files-test, `TaskWorkspacePanel.test.jsx` "opens the task canvas" (ожидает URL без `&task_tab=comments`), 5 тестов chat-модуля (Chat.test.jsx AI helpers ×3, ChatPageContent.smoke, useChatComposePrefillBootstrap) — все зелёные в `HUB-IT-main` (локальные коммиты впереди origin/main).
- Дальнейшие действия: мерж открытых PR (#47..#67) в main — решение владельца; rejected-записи с design/backend/decision-тегами — на стороне владельца.

## Merge-заметка: PR #59 (swr-batch) x PR #67 (evidence-batch)
Единственный межбатчевый конфликт — `Networks.jsx` (`loadBranchContext`). Мержить так:
- Оставить структуру из swr-batch: `applyBranchContext` + `getOrFetchSWR(..., { onRevalidated: applyBranchContext })`.
- В fetcher оставить поле `socketsTruncated: ... >= 10000` из evidence-batch.
- Внутри `applyBranchContext` оставить `if (data?.socketsTruncated) pushWarningToast(...)`.
- deps `applyBranchContext`: `[notifyError, pushWarningToast]`; deps `loadBranchContext`: `[applyBranchContext]`.
