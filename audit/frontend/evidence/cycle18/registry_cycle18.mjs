import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const file = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = Object.fromEntries(data.issues.map((i) => [i.id, i]));

// FE-0232 — strict regression test
const fe0232 = byId['FE-0232'];
fe0232.verification = Array.from(new Set([...(fe0232.verification || []), 'local-browser']));
fe0232.runtimeStatus = 'reproduced-live';
fe0232.evidence.push(
  '[cycle18:live] Strict regression test (11 checks, exit 0): cleared links 0; seeded 1; injected bulk 500 -> drawer hides delegate; Save PUT items:[]; links 1 -> 0; reseeded 1; control without injection -> drawer shows delegate, PUT items:1, links 1 -> 1. Script audit/frontend/evidence/cycle18/fe0232-delegates.cjs.',
);
fe0232.currentConclusion =
  'Confirmed live with strict assertions: a failed bulk delegate load hides the links; saving the user sends an empty items array and erases all assistant/deputy links (1 -> 0). Control without the failure preserves the link (1 -> 1).';
fe0232.reverificationHistory.push({
  cycle: 18,
  date: '2026-11-23',
  verdict: 'confirmed',
  note: 'Strict 11-check test: seed 0->1, injected payload [] and links 1->0, control 1->1. Independent repeat passed.',
  sourceFile: 'evidence/cycle18/fe0232-delegates.cjs',
});

// FE-0239 — strict regression test
const fe0239 = byId['FE-0239'];
fe0239.verification = Array.from(new Set([...(fe0239.verification || []), 'local-browser']));
fe0239.runtimeStatus = 'reproduced-live';
fe0239.evidence.push(
  '[cycle18:live] Strict regression test (8 checks, exit 0): D1 [14], D2 [16] before; delayed D1 members response applied while D2 selected (UI shows D1 owner/delegate); Save PUT /departments/D2/managers {"manager_user_ids":[14]}; after D1 [14], D2 [14]. Script audit/frontend/evidence/cycle18/fe0239-departments.cjs.',
);
fe0239.currentConclusion =
  'Confirmed live with strict assertions: a late members response from D1 overwrites the manager draft while D2 is selected; Save writes D1 managers into D2 (D2 16 -> 14), D1 unchanged. The PUT targets the selected D2 and contains the stale D1 manager id.';
fe0239.reverificationHistory.push({
  cycle: 18,
  date: '2026-11-23',
  verdict: 'confirmed',
  note: 'Strict 8-check test: before D1 14/D2 16; stale D1 members shown under D2; PUT D2 [14]; after D2 [14]. Independent repeat passed.',
  sourceFile: 'evidence/cycle18/fe0239-departments.cjs',
});

// FE-0259 — title/scope correction + strict regression test
const fe0259 = byId['FE-0259'];
const old0259Title = fe0259.title;
fe0259.title = 'Construction-workspace: нет beforeunload — черновики дневной сводки и недельного плана теряются при F5/закрытии';
fe0259.titleHistory = [
  ...(fe0259.titleHistory || []),
  {
    title: old0259Title,
    changedInCycle: 18,
    date: '2026-11-23',
    reason:
      'The tested UI has no separate "weekly summary" control. The affected drafts are the daily summary ("Сводка за день") and the weekly plan ("Планирование"); both are lost on F5 without a warning.',
  },
];
fe0259.verification = Array.from(new Set([...(fe0259.verification || []), 'local-browser']));
fe0259.runtimeStatus = 'reproduced-live';
fe0259.evidence.push(
  '[cycle18:live] Strict regression test (11 checks, exit 0) on a synthetic managed object: work plan PUT 200 and persisted in planning API after reload; daily summary dirty ("Сохранить сводку") -> F5 without beforeunload -> value "" and dirty UI gone; weekly plan target dirty ("Сохранить план недели") -> F5 without beforeunload -> value "" and dirty UI gone. Script audit/frontend/evidence/cycle18/fe0259-construction.cjs.',
);
fe0259.currentConclusion =
  'Confirmed live with strict assertions: the work plan saves and persists, but unsaved daily-summary and weekly-plan drafts are lost on F5 without a beforeunload prompt. useConstructionWorkLeaveGuard protects React Router navigation, not reload/close. The record title now names both affected drafts, not a non-existent "weekly summary" control.';
fe0259.reverificationHistory.push({
  cycle: 18,
  date: '2026-11-23',
  verdict: 'confirmed',
  note: 'Strict 11-check test: plan PUT 200 and persisted; daily and weekly drafts dirty; F5 no beforeunload; both values lost. Title corrected to daily summary + weekly plan.',
  sourceFile: 'evidence/cycle18/fe0259-construction.cjs',
});

// FE-0230 — independent analysis and reclassification
const fe0230 = byId['FE-0230'];
fe0230.status = 'Suspected';
fe0230.runtimeStatus = 'not-reproduced-live';
fe0230.verification = Array.from(new Set([...(fe0230.verification || []), 'test-harness']));
fe0230.statusRationale =
  'Static early return before hooks is real: the component calls 9 hooks when isNativeShellRuntime() is false and 0 hooks when true. A same-instance re-render across that flip would violate the Rules of Hooks. The parent AccountWorkspace computes nativeShell on every render and renders the card only when false; MainLayout listens to desktop.capabilities (sent immediately after hostReady) and sets state, which re-renders the layout tree and unmounts the card. The card has no hostReady subscription; its local updates are async/user-driven. Cycle 17 real WebView2 host with delayed hostReady + synchronous button click produced no hooks error; the parent unmounted the card. No reachable card-local re-render was demonstrated. Reclassified to Suspected pending a reproducible user-visible crash; severity kept High as potential impact if reached (settings page render crash), with unproven reachability.';
fe0230.evidence.push(
  '[cycle18:static] Hooks before the early return: useTheme, useMemo, useAuth, useNotification, useState x2, useEffect x2, useCallback (9). With isNativeShellRuntime() true the component returns before all 9. AccountWorkspace renders the card only when !nativeShell; MainLayout handles DESKTOP_CAPABILITIES_CHANGED_EVENT via setDesktopActionsAvailable, so the capabilities message after hostReady re-renders the tree and removes the card. ChatNotificationsSettingsCard does not subscribe to hostReady; no synchronous card-local update on the flip.',
);
fe0230.evidence.push(
  '[cycle18:live-negative] Real Windows WebView2 host (cycle 17 evidence): desktop.ready delayed 8 s, card mounted with shell=null, update button clicked synchronously at hostReady. No pageerror/console error; the parent unmounted the card. This is a negative live result, not proof that the defect is absent.',
);
fe0230.currentConclusion =
  'Статический механизм подтверждён: 9 хуков до раннего return, 0 после; смена флага на том же экземпляре нарушила бы Rules of Hooks. Но пользовательский крах не воспроизведён: hostReady сразу сопровождается capabilities, MainLayout перерисовывает дерево, и родитель размонтирует карточку; card-local re-render в этом окне не достигнут. Статус понижен до Suspected (High-импакт при достижимости, вероятность не доказана).';
fe0230.reverificationHistory.push({
  cycle: 18,
  date: '2026-11-23',
  verdict: 'not-reproduced',
  note: 'Independent hook/parent analysis + real WebView2 negative result. No reachable card-local re-render; status Suspected, severity High (potential impact, reachability unproven).',
  sourceFile: 'evidence/cycle18/fe0230-analysis.md',
});

// FE-0215 — EWS feasibility analysis
const fe0215 = byId['FE-0215'];
fe0215.runtimeStatus = 'blocked-environment';
fe0215.evidence.push(
  '[cycle18:analysis] The draft path uses Exchange EWS, not IMAP/SMTP: MailDraftLifecycle.upsert_draft creates exchangelib Message(folder=account.drafts, HTMLBody, recipients), attaches FileAttachment objects (inline images are cid attachments), calls draft_item.save() (CreateItem) and save(update_fields=...) (UpdateItem); existing drafts are fetched via account.drafts/GetItem and deleted via DeleteItem. Minimal EWS contracts: GetFolder/FindFolder (Drafts), CreateItem/UpdateItem/GetItem/DeleteItem, attachment create/get, NTLM + TLS. No EWS test server exists; a full SOAP EWS double would be a separate service, not available without owner permission. A service-level mock of Account/Message could verify the HTML/attachment payload but not UI->EWS autosave/read; it would be a limited contract test, not E2E.',
);
fe0215.currentConclusion =
  'Static remains confirmed. Full live verification is blocked: the backend uses Exchange EWS (exchangelib), the isolated stack disables the mail module, and no EWS test server/mailbox exists. A local IMAP/SMTP fixture is not applicable. A service-level mock could test the draft HTML/attachment payload only; it would be a limited contract test, not a full E2E.';

// New finding: corrupt PNG preview artifact
const fe0326 = {
  id: 'FE-0326',
  title: 'My Files: PNG-превью отдаёт повреждённый артефакт (preview.png), публичная ссылка показывает битое изображение',
  category: 'MyFiles/Preview',
  severity: 'Medium',
  status: 'Confirmed',
  page: '/my-files, /shared-files/:token',
  file: 'WEB-itinvent/backend/services/my_files_service.py',
  lines: '3568-3663',
  relatedFiles: [
    { file: 'WEB-itinvent/backend/services/document_preview_job_service.py', lines: '260-310, 503-555' },
    { file: 'WEB-itinvent/backend/api/v1/my_files.py', lines: '947-990 (public preview)' },
  ],
  verification: ['local-browser', 'local-api'],
  runtimeStatus: 'reproduced-live',
  evidence: [
    '[cycle18:local-browser] Uploaded a 64x64 solid PNG (RGB 200,30,40). Authenticated preview dialog shows an image 64x64; canvas pixel (200,30,40) — the user-visible authenticated preview works.',
    '[cycle18:local-api] GET /api/v1/my-files/{id}/preview/content -> 200 image/png, 180 bytes; Pillow Image.open(...).load() raises OSError "broken data stream". The previews dir contains the corrupt preview.png (180 bytes). Another upload\'s preview.webp (88 bytes) and thumb.webp (86 bytes) load fine.',
    '[cycle18:local-browser] Public share: /shared-files/{token} renders <img src=/api/v1/my-files/public/{token}/preview/content>; the public preview endpoint returns 200 image/png 180 bytes and Pillow fails with the same broken stream. The original file download still works.',
    '[cycle18:repeat] Reproduced on two uploads sharing blob 8726c036... (same PNG content); the uploaded original (186 bytes) opens fine in Pillow. Screenshot evidence/cycle18/shots/c18-public-preview.png.',
  ],
  impact: 'Публичная ссылка на изображение показывает битое превью; потребители /preview/content (публичный просмотр, печать/конвертация) получают невалидный PNG. Скачивание оригинала работает; аутентифицированный диалог использует WebP/thumb и выглядит корректно.',
  recommendation: 'Валидировать сгенерированный PNG-артефакт (декодирование) или отдавать для image preview валидный WebP/thumb/оригинал; добавить тест декодирования артефакта в preview worker.',
  regressionRisk: 'low',
  originalClaim: 'PNG-превью в My Files отдаёт повреждённый артефакт, публичная ссылка показывает битое изображение.',
  originalEvidence: [
    'Cycle 18 strict E2E and public-share probe on the isolated stand; Pillow decode failure; authenticated UI canvas pixel correct.',
  ],
  currentConclusion:
    'Confirmed live: the preview worker writes a corrupt preview.png for image blobs; /preview/content and the public preview endpoint return it. The authenticated dialog uses a valid WebP/thumb and works, but the public image preview is broken. Original download works.',
  reverificationHistory: [
    {
      cycle: 18,
      date: '2026-11-23',
      verdict: 'confirmed',
      note: 'Authenticated canvas preview correct; preview.png 180 bytes fails Pillow; public preview endpoint returns the same corrupt PNG. Reproduced on two uploads (blob 8726c036...).',
      sourceFile: 'evidence/cycle18/fe_public_preview.cjs',
    },
  ],
};
data.issues.push(fe0326);
byId['FE-0326'] = fe0326;

data.highBreakdown = {
  historical: 12,
  current: 11,
  allHigh: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0215', 'FE-0230', 'FE-0232', 'FE-0239', 'FE-0259'],
  runtimeProven: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0078', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0232', 'FE-0239', 'FE-0259'],
  unresolvedRuntime: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0232', 'FE-0239', 'FE-0259'],
  fixedExternally: ['FE-0078'],
  staticOnly: ['FE-0215'],
  runtimeNotReproduced: ['FE-0230'],
  suspectedHigh: ['FE-0230'],
  blockedEnvironment: ['FE-0215'],
};

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('updated FE-0232/0239/0259/0230/0215; added FE-0326; total', data.issues.length);
