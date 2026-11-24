# NEXT ACTIONS — точка продолжения

Обновлять при каждом checkpoint. Восстановление контекста: читать `PROGRESS.json` (все 324), этот файл, `MASTER_PLAN.md`, `DECISIONS.md`.

## Текущее состояние (2026-11-25, checkpoint 5)
- **FIXED 39** из 324 (OPEN 229, NEEDS_EVIDENCE 12, REJECTED 42, IN_PROGRESS 2: FE-0064 чужой PR #10 + FE-0159 residual).
- **Networks карта** закрыта ранее: FE-0031/0140/0141/0142/0151 -> PR **#37** (ix/networks-map 43b356be). Остаток батча — только FE-0030 (декомпозиция Networks.jsx ~80 useState, отдельная задача).
- **Account-батч 10/17**: PR **#38** (ix/account-guards, main-based): FE-0234/0235 (UsersTab notify+delete busy+aria), FE-0236 (SessionsTab chip+confirm), FE-0237 (cleanup/purge confirm), FE-0242 (schedules reset confirm), FE-0249 (mailbox delete wording), FE-0251 (avatar confirm, mailbox busy+валидация, AiBalanceCard threshold draft, QuotaEditor Enter+notify, syncFromAD confirm, savingAiBotId guards, fontScale NaN-guard), FE-0034 leftovers (aria-labels Mfu.jsx + MailTemplatesDialog.jsx), FE-0250 (test-only resolver удалён + mock-echo describe). Тесты: 73/73 account+Settings зелёные; WorkSchedules test — стаб window.confirm; preferences test — NaN-guard без клэмпа (1.25 легитимно).
- **FE-0233** -> PR **#27** дополнен (4a10b583, на ветке delegates): частичный успех create/update user при падении updateTaskDelegates -> notifyInfo вместо полного провала.
- **Account остаток (следующий кластер)**: seq-guards FE-0238 (FeedbackAdminSection loadMore race), FE-0240/0241 (ItinventReferencesTab lookups seq + openDelete race), FE-0247 (шесть loader-ов в useAccountSectionData), FE-0248 (MyFilesStats.load seq); draft-loss FE-0243 (EnvVariablesTab refresh wipe), FE-0244 (AdminLoginAllowlistSettingsCard draft), FE-0245 (password groups pseudo-autosave); perf FE-0019 (30 API calls on admin load, authSessions.js).
- **Потом**: database 11, voice 9, chat 6, tasks 6, mail 5; финал — REMEDIATION_FINAL_REPORT.md.
## Текущее состояние (2026-11-25, checkpoint 6)
- **FIXED 48** из 324 (OPEN 220, NEEDS_EVIDENCE 12, REJECTED 42, IN_PROGRESS 2: FE-0064 чужой PR #10 + FE-0159 residual). **Account-батч закрыт целиком (17/17).**
- PR **#38** ix/account-guards -> main: FE-0034/0234/0235/0236/0237/0242/0249/0250/0251.
- PR **#39** ix/account-seq-guards -> base fix/account-guards (stacked): FE-0238/0240/0241/0247/0248 — useRequestGuard на 6 loader-ов, loadMore/reload раздельные seq, deleteSeq, MyFilesStats seq.
- PR **#40** ix/account-draft-loss -> base fix/account-seq-guards (stacked): FE-0243 (env merge-seed + dirty-confirm), FE-0244 (synced-ref в двух карточках), FE-0245 (реальный debounce-autosave групп паролей + flush on refresh/unmount).
- PR **#41** ix/account-aibots-lazy -> base fix/account-draft-loss (stacked): FE-0019 — lazy per-bot runs на вкладке diagnostics; фан-аут ~30 запросов убран.
- Порядок мержа account-цепочки: #38 -> #39 -> #40 -> #41 (каждый base указывает на предыдущую ветку; перед мержем очередного PR его base можно переключить на main или мержить последовательно).
- **Следующий батч**: database 21 запись (см. PROGRESS.json batch=database). План: misc-кластер (FE-0293/0294/0295/0305/0316) -> seq/race (0283/0306/0307/0308/0309/0310/0311/0314/0315/0313/0320/0321/0287) -> a11y/layout (FE-0010 Login labels, FE-0252 overflow 200%).
- Потом: voice 9, chat 6, tasks 6, mail 5; финал — REMEDIATION_FINAL_REPORT.md.
## Сессия 2 (checkpoint 4)



- **FIXED 24** из 324 (OPEN 244, NEEDS_EVIDENCE 12, REJECTED 42, IN_PROGRESS 2: FE-0064 чужой PR #10 + FE-0159 residual).
- **Сессия 2 (эта)**: FE-0154 → PR **#34** (CSV formula-injection); FE-0029/0145/0153 → PR **#35** (keydown-ref, mapBusy/pointBusy, confirm-ы); FE-0036/0146/0158/0159/0160/0143/0144 → PR **#36** (`fix/networks-sites-deadcode`, **stacked на #35** — мержить после него): site code/name из данных филиала, мёртвый код (ImportDialog.jsx, mobilePortEditorOpen, hasBranchDbChanges, focusPointId, pointEditMode-проп, containerWidth), canEdit-guard на MAC sync, сброс stale map image.
- **Networks-батч остаток**: FE-0140 (Отмена не откатывает mapPoints), FE-0141 (мобильное размещение точки), FE-0142 (жест панорамы съедается), FE-0151 (clamp панорамы), FE-0031 (ре-рендер на pointermove), FE-0030 (god-component — крупная декомпозиция, отдельная задача).
- **Следующие батчи**: account 15, database 11, voice 9, chat 6, tasks 6, mail 5 — по PROGRESS.json `batch`.
- **FE-0159 residual**: селектор города требует продуктового решения (нет источника списка городов).

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

## Checkpoint 2026-11-24
- Database batch COMPLETE: PR #42 (misc+lifecycle) -> main; PR #43 (races+a11y/overflow/export) stacked on fix/database-misc — merge after #42.
- Open PRs order: #38 -> #39 (stacked), #40, #41, #42 -> #43 (stacked), plus earlier #23..#36.
- Next batch: voice (9), chat (6), tasks (6), mail (5). Deferred: FE-0030 Networks.jsx decomposition.
