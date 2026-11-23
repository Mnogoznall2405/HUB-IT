# REMEDIATION BACKLOG — HUB-IT web frontend

> План исправлений, **не выполнять** в рамках аудита. Источник — `ISSUES.json` (324 записи).
> Группировка не удаляет исходные записи; ID сохранены.

## Приоритеты

- **P0** — безопасность/потеря данных/массовый logout; исправлять первыми.
- **P1** — потеря данных/неверные бизнес-данные/мобильный freeze.
- **P2** — заметное ухудшение UX, есть обход.
- **P3** — низкая вероятность/латентные/косметические.
- **Spike** — сначала доказать достижимость, потом решать.

---

## REM-01 — FE-0197: 2FA setup completion / backup codes

- **Severity / confidence:** High / high (real 2FA flow, cycle14).
- **User impact:** после настройки 2FA экран завершения/backup-кодов не показывается; пользователь может остаться без recovery-кодов.
- **Repro:** чистый 2FA-стенд, новый пользователь → setup 2FA → verify → LoginRoute уводит на post-auth до `setStep(setup_complete)`; `renderSetupCompleteStep` не выполняется.
- **Files:** `WEB-itinvent/frontend/src/pages/Login.jsx:1505-1521`; `contexts/AuthContext.jsx:557-568`; `App.jsx:237-239`.
- **Evidence limits:** cycle14 real flow; повторно не запускался без новой гипотезы.
- **Fix direction:** не размонтировать setup-flow до показа backup-кодов; вынести completion в отдельный шаг/route; не менять session/2FA policy побочно.
- **Regression tests:** Playwright 2FA setup → verify → backup codes visible → login with a backup code.
- **Dependencies:** 2FA test stand (REM-19).
- **Order:** P0.1.

## REM-02 — FE-0198: trusted-device prompt bypass

- **Severity / confidence:** High / high (real 2FA/trusted-device flow, cycle14).
- **User impact:** обязательный запрос trusted-device не показывается; устройство может не попасть в доверенные/политика обходится.
- **Repro:** 2FA login при уже установленном `user` → `setRememberDeviceOpen(true)`, но sheet не рендерится; проверить trust state и повторный вход.
- **Files:** `WEB-itinvent/frontend/src/pages/Login.jsx:1394-1415,1137-1153,1170-1181,2342-2399`.
- **Evidence limits:** cycle14; requires 2FA stand.
- **Fix direction:** рендерить trusted-device sheet независимо от post-auth unmount; проверить порядок `setUser`/sheet state; не менять серверную 2FA policy.
- **Regression tests:** login с 2FA → trusted-device prompt → accept/decline → повторный вход и проверка trust.
- **Dependencies:** REM-01/2FA stand; auth policy sign-off.
- **Order:** P0.2.

## REM-03 — FE-0059 + FE-0083: refresh resilience / family revocation

- **Severity / confidence:** High / high (refresh matrix on 9879be04).
- **User impact:** потеря ответа ротации или параллельный refresh → принудительный logout всех вкладок; потеря несохранённого ввода.
- **Repro:** A) rotate + lost response + retry after grace → 401; B) two sequential reuses → family revoked; C) 3 parallel → [200,200,401], winners dead; D) after grace old rejected, new alive.
- **Files:** `WEB-itinvent/frontend/src/api/http.js:54,66-76`; `contexts/AuthContext.jsx:171-174,256-258,471-508`; `backend/api/v1/auth.py:135,1648-1687`.
- **Evidence limits:** local isolated backend; production auth policy not changed.
- **Fix direction:** coordinate refresh across tabs (BroadcastChannel/navigator.locks) and make lost-response recovery idempotent; do not change `MAX_HITS`/grace/2FA policy without owner decision.
- **Regression tests:** matrix A-D as API E2E; two-tab refresh; lost response; new-token viability.
- **Dependencies:** auth policy review.
- **Order:** P0.3.

## REM-04 — FE-0232: delegate loss on bulk failure

- **Severity / confidence:** High / high (strict 11/11).
- **User impact:** при сбое bulk-загрузки сохранение пользователя стирает всех помощников/замов.
- **Repro:** seed link 1 → inject `GET /auth/task-delegates` 500 → open user → Save sends `items:[]` → links 0; control without failure 1 → 1.
- **Files:** `pages/account/hooks/useAccountSectionData.js:244-251,637-644`; `pages/account/accountUserModel.js:27-39`.
- **Evidence limits:** bulk failure injected; real persistence verified.
- **Fix direction:** mark delegate data as unavailable on bulk failure; do not send `items:[]`; save only changed links or block save with retry; keep control path.
- **Regression tests:** strict FE-0232 script; bulk 500 + Save; control.
- **Dependencies:** none.
- **Order:** P0.4.

## REM-05 — FE-0239: managers written to the wrong department

- **Severity / confidence:** High / high (strict 8/8).
- **User impact:** после быстрого переключения отделов «Сохранить начальников» пишет руководителей старого отдела в новый.
- **Repro:** D1 managers [14], D2 [16]; delay D1 members; switch D1→D2; late response; Save PUT D2 [14]; D2 becomes [14].
- **Files:** `pages/account/admin/DepartmentsTab.jsx:58-89,129-142`.
- **Evidence limits:** delay injected; real backend persistence.
- **Fix direction:** request-id/AbortController for `loadMembers`; ignore stale responses; verify `selectedDepartmentId` before applying/saving; disable Save while members are loading.
- **Regression tests:** strict FE-0239 script; delayed D1 + Save D2; assert PUT id and managers of both departments.
- **Dependencies:** none.
- **Order:** P0.5.

## REM-06 — FE-0259: daily summary / weekly plan draft loss

- **Severity / confidence:** High / high (strict 11/11).
- **User impact:** F5/close/route reload теряет несохранённую дневную сводку и недельный план без предупреждения.
- **Repro:** managed object + work plan; enter day 5 / week 7; dirty; F5 → no beforeunload → value empty.
- **Files:** `components/construction/ConstructionWorkWorkspace.jsx:29-45,160-165`; `useConstructionWorkLeaveGuard.js`; `ConstructionWorkPanel.jsx:163-168` (есть beforeunload).
- **Evidence limits:** plan persists; draft loss is client-side.
- **Fix direction:** add `beforeunload` for dirty/saving (like Panel), or autosave/draft restore; keep router guard.
- **Regression tests:** strict FE-0259 script (daily + weekly + F5); in-app navigation guard.
- **Dependencies:** none.
- **Order:** P1.1.

## REM-07 — FE-0023: mobile 10k ports freeze

- **Severity / confidence:** High / high (cycle14 mobile, ~30 s, 181k DOM, 930 MB).
- **User impact:** мобильный браузер зависает/падает при большом числе портов.
- **Repro:** mobile viewport, branch with 10k ports, open networks/equipment tab; measure long tasks/DOM/heap.
- **Files:** `components/networks/EquipmentTab.jsx:351-433`; `pages/Networks.jsx:765,871`; API limits 10000.
- **Evidence limits:** cycle14 device/browser; no production data.
- **Fix direction:** pagination/virtualization; server-side search/limit with total/hasMore; avoid rendering 10k rows.
- **Regression tests:** 10k-port mobile fixture; p95 interaction, DOM count, heap; pagination.
- **Dependencies:** API total/hasMore contract.
- **Order:** P1.2.

## REM-08 — FE-0325: PWA offline cold-start hang

- **Severity / confidence:** Medium / high (cycles14-15).
- **User impact:** холодный запуск без сети — бесконечный loader; при существующей сессии — cached dashboard.
- **Repro:** built app + SW; offline reload /login; >50 s loader; 2 refresh attempts; reconnect ~2 s.
- **Files:** `contexts/AuthContext.jsx:310-339`; `main.jsx:66-84`; `public/sw.js:608-626`.
- **Evidence limits:** built app/PWA; no production SW.
- **Fix direction:** bounded recovery; offline screen/login when status=0; no infinite retry; preserve reconnect.
- **Regression tests:** PWA offline/online with fresh and cached session; stale SW activation.
- **Dependencies:** SW cache policy.
- **Order:** P2.1.

## REM-09 — FE-0215: mail inline image / autosave (blocked)

- **Severity / confidence:** High / static-only; runtime blocked.
- **User impact:** inline-изображение может потеряться из черновика после autosave.
- **Repro:** compose HTML with inline image → autosave → reopen draft; compare HTML/cid.
- **Files:** `components/mail/MailComposeHost.jsx:524-539`; `MailRichTextEditor.jsx:151-157,228-242`; `mailComposeHtml.js:138-145`; backend `services/mail_draft_lifecycle.py:88-137`.
- **Evidence limits:** Exchange EWS, MAIL_MODULE_ENABLED=0, no EWS test server/mailbox. Full E2E impossible; service-level fake Account/Message only.
- **Fix direction:** only after test contract; verify cid/inline attachment persistence; do not change EWS transport.
- **Regression tests:** EWS test double or limited service-level contract; compose → save → reopen → image present.
- **Dependencies:** REM-19 EWS double; owner permission.
- **Order:** P2.2 (blocked).

## REM-10 — FE-0194: monitoring nameless target guard

- **Severity / confidence:** Low / medium (mocked browser reproduction).
- **User impact:** malformed/partial target without `name` crashes the monitoring grid/error boundary.
- **Repro:** mocked `/monitoring/overview` target without name → TypeError `split` at `MonitoringDeviceGrid.jsx:29` → route error boundary.
- **Files:** `pages/monitoring/MonitoringDeviceGrid.jsx:29`; `monitoringFormat.js` `displayTargetName`.
- **Evidence limits:** mocked payload; real backend target without name not observed.
- **Fix direction:** use `displayTargetName`/`String(target.name || '')` instead of direct `split`; add defensive guard at list boundary.
- **Regression tests:** mocked overview nameless target; grid renders fallback; no error boundary.
- **Dependencies:** none.
- **Order:** P2.3.

## REM-11 — FE-0110: editor close hang when DocSpace iframe fails

- **Severity / confidence:** Medium / suspected.
- **User impact:** закрытие редактора может зависнуть, если iframe упал; `editor.requestClose()` не отвечает.
- **Repro:** ONLYOFFICE editor with broken iframe → click close → pending request.
- **Files:** `components/myFiles/useMyFilesEditorSession.js:436-440`.
- **Evidence limits:** no ONLYOFFICE test server.
- **Fix direction:** timeout/cancel close request; allow fallback close; keep session cleanup.
- **Regression tests:** ONLYOFFICE failure harness; close within timeout.
- **Dependencies:** REM-19 ONLYOFFICE.
- **Order:** P2.4 (blocked).

## REM-12 — silent list truncation family: FE-0161 / FE-0300 / FE-0323 / FE-0324

- **Severity / confidence:** Low-Medium / suspected; data-dependent.
- **User impact:** неполные списки/счётчики без признака усечения (ports 10000/5000, DLP chats 200, scan hosts fallback, DB lookups 500/1000).
- **Repro:** datasets above limits; compare total/hasMore and UI count.
- **Files:** `pages/Networks.jsx:765,871,1059,2030`; `pages/FileEgress.jsx:220-235`; `api/scanHosts.js:123-148`; `pages/database/useDatabaseLookups.js:28-39`.
- **Evidence limits:** no >limit fixtures; FE-0323 latent (not called in prod).
- **Fix direction:** return/display total/hasMore; explicit “показаны первые N”; server-side search/pagination; don’t silently slice.
- **Regression tests:** limit+1 fixtures for each list; UI truncation notice.
- **Dependencies:** API contract.
- **Order:** P3.1.

## REM-13 — FE-0051: swrCache detached response

- **Severity / confidence:** Low / suspected (static).
- **User impact:** consumer may apply an invalidated in-flight response.
- **Repro:** algorithm harness: invalidate while fetch in flight; resolve detached response.
- **Files:** `lib/swrCache.js:63-77,120-129`.
- **Evidence limits:** no runtime reproduction; algorithm test needed.
- **Fix direction:** generation/abort token; reject/ignore detached responses for consumers.
- **Regression tests:** unit/race harness (algorithm exception allowed).
- **Dependencies:** none.
- **Order:** P3.2.

## REM-14 — FE-0076: AI mail plain-text with is_html=true

- **Severity / confidence:** Low / suspected.
- **User impact:** malformed mail body/HTML rendering.
- **Repro:** AI mail action with plain-text body and `is_html=true`.
- **Files:** `pages/chat/AiMailActionEditDialog.jsx:119-129`.
- **Evidence limits:** mail/AI harness blocked.
- **Fix direction:** normalize body/html flag; escape plain text.
- **Regression tests:** AI mail fixture.
- **Dependencies:** mail/AI harness.
- **Order:** P3.3.

## REM-15 — FE-0115: revokeObjectURL immediately after click

- **Severity / confidence:** Low / suspected.
- **User impact:** download may fail on iOS Safari.
- **Repro:** download blob link; revoke immediately; iOS Safari.
- **Files:** `components/mail/mailMessageFileActions.js:337-360`; `lib/networksHelpers.js:75-84`; `pages/MyFiles.jsx:674-681`.
- **Evidence limits:** no iOS Safari/WebKit.
- **Fix direction:** delay revoke (setTimeout/after load) or use navigation-safe download.
- **Regression tests:** WebKit/iOS download.
- **Dependencies:** iOS device/Safari.
- **Order:** P3.4.

## REM-16 — FE-0004: shared-folder invalid → login in long-lived profile

- **Severity / confidence:** Medium / suspected.
- **User impact:** гость видит экран входа вместо ошибки ссылки в «долгом» профиле.
- **Repro:** persistent Chrome profile with prior auth/SW; open `/shared-folders/:invalid`.
- **Files:** `pages/SharedFolder.jsx:47-57`.
- **Evidence limits:** clean profile does not reproduce.
- **Fix direction:** ensure public route clears/ignores auth redirect; deterministic error state.
- **Regression tests:** persistent profile + invalid token; clean profile control.
- **Dependencies:** profile/SW harness.
- **Order:** P3.5.

## REM-17 — FE-0265: single Suspense null on dialogs layer

- **Severity / confidence:** Low / suspected.
- **User impact:** lazy suspend may unmount all open dialogs.
- **Repro:** lazy chunk failure/suspend while dialogs open.
- **Files:** `pages/tasks/TasksDialogsLayer.jsx:28`.
- **Evidence limits:** no lazy-failure harness.
- **Fix direction:** per-dialog Suspense/error boundary or keep mounted; fallback.
- **Regression tests:** lazy failure with two dialogs open.
- **Dependencies:** chunk-failure harness.
- **Order:** P3.6.

## REM-18 — FE-0230: Desktop hooks early return (spike)

- **Severity / confidence:** High / suspected; live negative.
- **User impact:** potential settings render crash if a card-local re-render is reached.
- **Repro:** not yet; needs late hostReady + card-local state update before parent unmount.
- **Files:** `ChatNotificationsSettingsCard.jsx:29-45`; `AccountWorkspace.jsx:53,250`; `MainLayout.jsx:441-449`.
- **Evidence limits:** real WebView2 negative; no reachable path.
- **Fix direction (after spike):** move early return after hooks or split browser/desktop components; keep parent guard.
- **Regression tests:** WebView2 harness with controlled hostReady/state update.
- **Dependencies:** REM-19 WebView2 harness.
- **Order:** Spike, not P0.

## REM-19 — audit/test infrastructure

- **Items:**
  - Validate every PNG/image fixture with Pillow before upload (prevent FE-0326-class false positives).
  - EWS-compatible double or service-level fake Account/Message for FE-0215; label limited.
  - ONLYOFFICE test server for FE-0110 and editor routes.
  - SQL test set for FE-0324, `/database`, `/it/objects`, equipment.
  - Data fixtures > limits for FE-0161/0300/0323; >200 chats; >1000 departments.
  - 2FA/trusted-device stand for FE-0197/0198.
  - Mobile 10k-port harness for FE-0023.
  - PWA/stale-SW harness for FE-0325.
  - WebView2 PerfBench harness for FE-0230.
- **Dependencies:** owner permission for any new server/dependency.
- **Order:** parallel with P0/P1.

## Связанные группы

- **Auth refresh:** FE-0059 + FE-0083 (one fix area, two records).
- **Account admin:** FE-0232 + FE-0239 (same admin data layer, different races).
- **Silent truncation:** FE-0161 + FE-0300 + FE-0323 + FE-0324 (same UX/API contract).
- **Desktop runtime:** FE-0230 + WebView2 harness.
- **Test false positive:** FE-0326 — no app task; fixture validation.

Итоговый порядок: **P0 2FA → refresh → delegates → managers; P1 drafts → mobile; P2 PWA → EWS/monitoring/editor; P3 truncation/races; parallel test infrastructure.**
