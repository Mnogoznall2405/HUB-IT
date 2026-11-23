# DECISIONS — программа исправлений

Формат: дата | решение | основание.

## 2026-11-23

- **D1. Реестр программы — `remediation/PROGRESS.json`, ветка `remediation/program`.** Исходный `audit/frontend/ISSUES.json` не редактируем (запрет изменения истории аудита). Поля: `auditStatus` (вердикт аудита, иммутабельно) + `status` (текущее состояние программы из enum: OPEN/IN_PROGRESS/FIXED/ALREADY_FIXED/BLOCKED/NEEDS_EVIDENCE/REJECTED/NOT_APPLICABLE).
- **D2. База всех фиксов — `origin/main` @ f84e1565.** Аудит тестировал `9879be04` (ветка feat/my-files-compact-ux, PR #18); diff по приоритетным файлам = 0, значит исправления на main воспроизводимы и валидны. Файлы MyFiles на main отличаются от аудированных (PR #18 не влит) — дефекты my-files перепроверяем на main отдельно.
- **D3. Статус-маппинг при старте:** Confirmed→OPEN, Suspected→NEEDS_EVIDENCE, Rejected→REJECTED, Fixed-externally→OPEN+notes (после проверки→ALREADY_FIXED). FE-0064 → IN_PROGRESS (уже есть PR #10 `fix/fe-0064-task-editor-safe-paste`).
- **D4. Последовательность P0:** 2FA → delegates → departments → refresh. Refresh (http.js+AuthContext+backend auth.py) самый рискованный — делаем после накопления контекста auth-слоя, не первым.
- **D5. MAX_HITS/grace/family-revocation не менять.** FE-0059/0083 решаем координацией на клиенте (single-flight + cross-tab через BroadcastChannel/navigator.locks) и идемпотентным восстановлением lost-response; изменение серверной политики — только отдельным решением владельца.
- **D6. E2E-стенд аудита не поднимаем заново без необходимости.** Для FE-0197/0198 основной шов проверки — unit/integration уровня компонента (vitest+RTL уже есть в репо: *.test.jsx) + точечный Playwright там, где стенд реально поднимается локально (`E2E_LOCAL=1`). EWS/ONLYOFFICE/iOS — BLOCKED до появления стендов (решение владельца).
- **D7. PR без merge.** Каждый PR публикуется с перечнем FE-ID, первопричиной, тестами; merge/deploy — решение владельца.
- **D8. Batch-поле в PROGRESS.json — первичная группировка PRов.** Уточняется по мере работы; не более ~10 связанных дефектов на PR.
