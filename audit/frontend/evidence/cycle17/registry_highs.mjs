import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const file = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = Object.fromEntries(data.issues.map((i) => [i.id, i]));

const fe0215 = byId['FE-0215'];
fe0215.runtimeStatus = 'blocked-environment';
fe0215.evidence.push(
  '[cycle17:blocked] The mail transport is Exchange EWS (backend/services/mail_service.py + mail_exchange_transport.create_exchange_account), not IMAP/SMTP. A local IMAP/SMTP fixture would not be used by the backend. The isolated stack forces MAIL_MODULE_ENABLED=0 and /mail shows the corporate-password gate; no EWS test server or test mailbox exists. Live inline-image/autosave verification remains blocked; route-mocking would be UI-only.',
);
fe0215.currentConclusion =
  'Static remains confirmed. Live mail check is blocked: the backend uses Exchange EWS (not IMAP/SMTP), the isolated stack disables the mail module, and no EWS test server or mailbox is available.';
fe0215.reverificationHistory.push({
  cycle: 17,
  date: '2026-11-23',
  verdict: 'blocked',
  note: 'Transport investigation: EWS, not IMAP/SMTP. No local EWS test server/mailbox; MAIL_MODULE_ENABLED=0. Live autosave/inline-image test not possible.',
  sourceFile: 'manual-live-mail-transport',
});

const fe0230 = byId['FE-0230'];
fe0230.runtimeStatus = 'not-reproduced-live';
fe0230.evidence.push(
  '[cycle17:live] Real Windows WebView2 host: HUB.Desktop PerfBench build from b95c4cac, WebView2 157.0.4341.60, isolated profile, local stand. The desktop.ready handshake was delayed 8 s (test condition), then /settings/notifications was loaded. The card "Фоновая доставка чатов" mounted with shell=null; at the hostReady flip the "Обновить фоновую доставку" button was clicked synchronously. Result: shell=true, no pageerror/console error; the parent unmounted the card. Live crash not reproduced in this path.',
);
fe0230.statusRationale =
  'Static early-return before hooks is confirmed, but cycle 15 browser simulation and cycle 17 real WebView2 host both failed to produce the render crash: on hostReady the parent re-renders nativeShell and unmounts the card before a card-local re-render. The defect remains static-only; live user-visible effect is unproven.';
fe0230.currentConclusion =
  'Статический механизм подтверждён (return null до хуков), но live-крах не воспроизведён: в реальном WebView2 host при позднем hostReady родитель размонтирует карточку. Для краха нужен card-local re-render до parent re-render; этот сценарий не достигнут.';
fe0230.reverificationHistory.push({
  cycle: 17,
  date: '2026-11-23',
  verdict: 'inconclusive',
  note: 'Real WebView2 host with delayed hostReady + synchronous button click: no hooks error; parent unmounted the card. Static risk remains, live effect not reproduced.',
  sourceFile: 'manual-live-webview2-late-hostready',
});

const fe0232 = byId['FE-0232'];
fe0232.runtimeStatus = 'reproduced-live';
fe0232.evidence.push(
  '[cycle17:live] Synthetic users in isolated DB: owner 11 with delegate 12. Injected GET /auth/task-delegates 500 on page load; opened owner in admin, the delegate was absent from the drawer; Save sent PUT /auth/users/11/task-delegates {"items":[]} and the bulk link count went 1 -> 0. Control without injection: delegate present, Save kept 1 -> 1. Data loss reproduced; persistence checked on the real backend.',
);
fe0232.currentConclusion =
  'Confirmed live: when the bulk delegate load fails, the list has no delegate links; saving a user sends an empty items array and erases all assistant/deputy links. Control without the failure preserves the link.';
fe0232.reverificationHistory.push({
  cycle: 17,
  date: '2026-11-23',
  verdict: 'confirmed',
  note: 'Injected bulk failure: 1 link -> 0 after Save; control: 1 -> 1. Real backend persistence.',
  sourceFile: 'manual-live-admin-delegates',
});

const fe0239 = byId['FE-0239'];
fe0239.runtimeStatus = 'reproduced-live';
fe0239.evidence.push(
  '[cycle17:live] Two synthetic departments: D1 managers [11], D2 managers [13]. D1 members GET delayed 3.2 s; selected D1 then quickly D2. The late D1 response overwrote draftManagerIds while D2 was selected; Save sent PUT /departments/D2/managers {"manager_user_ids":[11]}. After: D2 managers [11], D1 unchanged [11]. Wrong-department write reproduced on the real backend.',
);
fe0239.currentConclusion =
  'Confirmed live: a late loadMembers response from the previously selected department overwrites the manager draft; Save writes those managers into the currently selected department. D2 received D1 manager [11] instead of its own [13].';
fe0239.reverificationHistory.push({
  cycle: 17,
  date: '2026-11-23',
  verdict: 'confirmed',
  note: 'Delayed D1 members load + switch to D2: D2 managers 13 -> 11. Real backend persistence.',
  sourceFile: 'manual-live-admin-departments',
});

const fe0259 = byId['FE-0259'];
fe0259.runtimeStatus = 'reproduced-live';
fe0259.evidence.push(
  '[cycle17:live] Created a managed construction object with a GUID direction in the isolated DB, added a work via the UI (plan saved to the backend, visible after reload), switched to "Сводка за день", entered 5 in "За день" (dirty, "Сохранить сводку" shown). F5 reload: no beforeunload dialog; after reload the value is empty and the dirty UI is gone. The weekly/day draft is lost without a prompt; the route-level leave guard covers SPA navigation but not reload/close.',
);
fe0259.currentConclusion =
  'Confirmed live on a synthetic managed object: the work plan saves, but an unsaved day/week draft is lost on F5 with no beforeunload prompt. useConstructionWorkLeaveGuard protects React Router navigation, not page reload/close.';
fe0259.reverificationHistory.push({
  cycle: 17,
  date: '2026-11-23',
  verdict: 'confirmed',
  note: 'Managed object + work plan; draft value 5; F5 without beforeunload; value lost. Real backend for the plan, client-side draft.',
  sourceFile: 'manual-live-construction-workspace',
});

data.highBreakdown = {
  historical: 12,
  current: 11,
  runtimeProven: [
    'FE-0022',
    'FE-0023',
    'FE-0059',
    'FE-0078',
    'FE-0083',
    'FE-0197',
    'FE-0198',
    'FE-0232',
    'FE-0239',
    'FE-0259',
  ],
  unresolvedRuntime: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0232', 'FE-0239', 'FE-0259'],
  staticOnly: ['FE-0215', 'FE-0230'],
  runtimeNotReproduced: ['FE-0230'],
  blockedEnvironment: ['FE-0215'],
};

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('updated FE-0215/0230/0232/0239/0259 and highBreakdown');
