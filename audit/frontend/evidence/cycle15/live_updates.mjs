import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const p = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
const byId = new Map(data.issues.map((i) => [i.id, i]));
const allowed = ['static-code', 'local-browser', 'local-browser-mock', 'local-api', 'test-harness', 'production-observer'];
function method(issue, m) {
  issue.verification = Array.isArray(issue.verification) ? issue.verification : [];
  if (!issue.verification.includes(m)) issue.verification.push(m);
  issue.verification = allowed.filter((x) => issue.verification.includes(x));
}
function ev(issue, tag, text) {
  issue.evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
  if (!issue.evidence.some((e) => String(e).startsWith(`[cycle15:${tag}]`))) issue.evidence.push(`[cycle15:${tag}] ${text}`);
}
function hist(issue, verdict, note, sourceFile) {
  issue.reverificationHistory = Array.isArray(issue.reverificationHistory) ? issue.reverificationHistory : [];
  if (!issue.reverificationHistory.some((h) => h.sourceFile === sourceFile)) issue.reverificationHistory.push({ cycle: 15, date: '2026-11-23', verdict, note, sourceFile });
}

const i22 = byId.get('FE-0022');
method(i22, 'local-browser-mock');
ev(i22, 'live', 'Warehouse1C balances route-mocked (one row, search «кабель», real CSS build :5223): the clickable nomenclature cell renders inside a TableRow with trTabIndex=null, trRole=null, cellTabIndex=null, cellRole=null; no keyboard-focusable element on the cell. The row is reachable only by mouse.');
hist(i22, 'confirmed', 'Mocked Warehouse1C row demonstrates no keyboard focus target on the clickable nomenclature cell.', 'manual-live-warehouse-keyboard');
i22.currentConclusion = 'Подтверждено на мокированных данных: кликабельная ячейка номенклатуры не имеет tabIndex/role и не фокусируется с клавиатуры.';

const i59 = byId.get('FE-0059');
method(i59, 'local-api');
ev(i59, 'live', 'Auth disconnect probe on isolated backend (refresh grace 180 s from root .env): login, rotate refresh while discarding the new cookies (lost response), wait 185 s, retry the old refresh cookie -> 401 "Refresh token has been revoked"; old access cookie /auth/me -> 401. Reproduces forced logout after a lost rotation response.');
hist(i59, 'confirmed', 'Lost rotation response + retry after grace -> family revoked and access rejected; FE-0059 confirmed live.', 'manual-live-refresh-loss');
i59.currentConclusion = 'Подтверждено: потерянный ответ ротации + повтор старой cookie после grace даёт 401 revoked и 401 на /auth/me; пользователь разлогинен.';

const i325 = byId.get('FE-0325');
ev(i325, 'live', 'Cycle 15 PWA: three offline/online reload cycles with existing session recovered to /dashboard each time (~2.6 s offline render, cached «Нет подключения» banner); stale-SW probe installed a new waiting worker while the old controller/caches stayed active and no settings update text appeared.');
hist(i325, 'confirmed', 'Existing-session offline cycles are stable; stale-worker waits without activation and is not surfaced in settings.', 'manual-live-pwa-cycle15');

const i84 = byId.get('FE-0084');
method(i84, 'local-browser');
ev(i84, 'live', 'Stale-SW probe on built app :5223: changed sw.js version; registration.update() produced waiting=true while active/controller remained the old worker and old app-shell/assets caches were still used. Visiting /settings/app did not show an update/refresh label.');
hist(i84, 'confirmed', 'Waiting worker is not activated and update is not surfaced outside a full reload/settings state.', 'manual-live-stale-sw');
i84.currentConclusion = 'Подтверждено: новый SW уходит в waiting, старый controller и кэши остаются; в /settings/app текст обновления не появился.';

const i85 = byId.get('FE-0085');
method(i85, 'local-browser');
ev(i85, 'live', 'Stale-SW probe: new worker waiting, old controller still serves the page; other tabs would remain on the old bundle until skipWaiting+reload.');
hist(i85, 'confirmed', 'Waiting worker does not claim clients; neighboring tabs stay on old bundle.', 'manual-live-stale-sw');
i85.currentConclusion = 'Подтверждено: waiting worker не активируется, соседние вкладки остаются на старом бандле.';

const blocked = {
  'FE-0215': 'Cycle 15 mailbox investigation: local_backend forcibly sets MAIL_MODULE_ENABLED=0; no IMAP/SMTP fixture or test mailbox exists. Route-mocking can validate UI only, not server-side autosave/attachment persistence, so live check remains blocked.',
  'FE-0230': 'Cycle 15 Desktop investigation: C# DesktopBridgeHost sends hostReady only after WebView2 bridge initialization; no Windows Desktop host/build is available in this audit, and browser simulation is not a valid WebView2 proof. Need a real WebView2 host with delayed CoreWebView2 init.',
  'FE-0232': 'Cycle 15 account fixtures not prepared; no approved mutation of delegate links in the isolated DB. Static catch->empty merge->save chain remains confirmed.',
  'FE-0239': 'Cycle 15 department/user fixtures not prepared; no approved mutation. Static race remains confirmed.',
  'FE-0259': 'Cycle 15 mocked construction attempt reached the page but the workspace requires a configured object/direction («сначала настройте объект»); mocked planning alone is insufficient. F5/close/unmount still blocked by missing configured construction fixture.',
};
for (const [id, text] of Object.entries(blocked)) {
  const issue = byId.get(id);
  if (issue) { issue.statusRationale = text; ev(issue, 'blocked', text); }
}

data.highBreakdown = {
  ...data.highBreakdown,
  runtimeProven: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0078', 'FE-0083', 'FE-0197', 'FE-0198'],
  runtimeUnresolved: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0083', 'FE-0197', 'FE-0198'],
  staticOnly: ['FE-0215', 'FE-0230', 'FE-0232', 'FE-0239', 'FE-0259'],
};
fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('cycle15 live updates applied');
