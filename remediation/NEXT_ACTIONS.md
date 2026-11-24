# NEXT ACTIONS — точка продолжения

Обновлять при каждом checkpoint. Восстановление контекста: читать `PROGRESS.json` (все 324), этот файл, `MASTER_PLAN.md`, `DECISIONS.md`.

## Текущее состояние (2026-11-23, checkpoint 3)

- **P0.1 закрыт**: FE-0197/0198/0199 → PR **#23** (`fix/auth-2fa-flow`, `bcb41ca0`, open). `postAuthUiHold` + unmount cleanup; a11y диалога. Ревью: APPROVE. Follow-up: required trusted-device enrollment обходится Back/reload (pre-existing, отдельный тикет).
- **P0.3 закрыт**: FE-0232 → PR **#27** (`fix/account-delegate-integrity`, `d1af1245`, open). Флаг `taskDelegatesLoadFailed` + reseed драфта после save в `UsersTab.jsx`. Тесты 4 новых. Ревью выявило второй путь того же дефекта — исправлен в том же PR.
- **P0.4 закрыт**: FE-0239 → PR **#28** (`fix/account-department-race`, `2f80488b`, open). Seq-guard в `loadMembers`, `membersDeptId`, save-time check, `selectedDepartmentIdRef`. Тесты 3 новых.
- **P0.2 закрыт**: FE-0059/0083 → PR **#29** (`fix/auth-refresh-coordination`, `faa065f1`, open). navigator.locks + epoch marker + lockless claim, ровно один transport-retry, poison-epoch после двойной потери, exact-path epoch на login/verify-2fa/passkey. 11 новых тестов, 276 зелёных. Ревью round 1: REQUEST_CHANGES → все findings устранены (residual задокументирован).
- **P1 закрыт**: FE-0259 → PR **#30** (beforeunload в ConstructionWorkWorkspace), FE-0023 → PR **#31** (mobile render-window 100-card chunks в EquipmentTab/SocketsTab), FE-0022 → PR **#32** (MovementTableRow/BalanceNomenclatureCell клавиатура).
- **P2 в работе**: батчи группами. networks (19 записей): a11y-группа FE-0024/0035/0156/0155 → PR **#33**; FE-0154 CSV formula-injection → PR **#34** (`fix/networks-csv-sanitize`, `75c7a0dd`). Далее correctness FE-0029/0145/0153, мёртвый код FE-0036/0160/0159/0146/0158, карта FE-0031/0140-0144/0151, god-component FE-0030 (отдельно, крупно). Остальные батчи: account 15, database 11, voice 9, chat 6, tasks 6, mail 5.

## Стартовое состояние (2026-11-23)

- Реестр создан: 269 OPEN + 12 NEEDS_EVIDENCE + 42 REJECTED + 1 IN_PROGRESS (FE-0064, PR #10).
- Открытые PR чужих работ: #18 (my-files compact — источник расхождений в my-files), #17 (chat emoji), #21/#22 (AI perf), #15 (AI docs), #10 (FE-0064), #9 (аудит — не трогать).
- Верифицировано: diff `9879be04..origin/main` по всем P0/P1-файлам = 0.

## Следующее действие

**P0.1 FE-0197/0198** — ветка `fix/auth-2fa-flow` от origin/main:
1. Прочитать Login.jsx (1505-1521, 1394-1415, 1137-1153, 1170-1181, 2342-2399), AuthContext.jsx (557-568), App.jsx (237-239).
2. Воспроизвести: unit/integration тест — verifyTwoFactorSetup успех → user установлен → LoginRoute уводит до setup_complete; remember-device sheet при уже установленном user.
3. Фикс: не размонтировать setup-flow до показа backup-кодов; remember-device sheet до post-auth навигации.
4. Тесты: setup→verify→backup codes visible; login→trusted-device prompt→accept/decline; backup code login; reload mid-setup.
5. PR `fix/auth-2fa-flow` → review → PROGRESS.json update.

## Очередь после P0.1

P0.3 FE-0232 (delegates) → P0.4 FE-0239 (departments) — можно параллельно; у обоих есть строгие скрипты в `audit/frontend/evidence/`.
P0.2 FE-0059/0083 — после них (самый рискованный, cross-tab + backend).

## Известные блокеры

- EWS стенд (FE-0215) — нет; ONLYOFFICE (FE-0110) — нет; iOS Safari (FE-0115) — нет; WebView2 harness (FE-0230) — нет; >limit датасеты (FE-0161/0300/0324) — нужны фикстуры.
- FE-0064 ждёт merge PR #10 (чужой PR, не merge'им сами).
