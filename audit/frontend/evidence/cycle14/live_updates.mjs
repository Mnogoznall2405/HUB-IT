import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const p = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
const byId = new Map(data.issues.map((i) => [i.id, i]));
const allowed = ['static', 'local-browser', 'local-browser-mock', 'local-api', 'test-harness', 'production-observer'];

function addMethod(issue, method) {
  issue.verification = Array.isArray(issue.verification) ? issue.verification : [];
  if (!issue.verification.includes(method)) issue.verification.push(method);
  issue.verification = allowed.filter((m) => issue.verification.includes(m));
}
function addEvidence(issue, tag, text) {
  issue.evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
  if (!issue.evidence.some((e) => String(e).startsWith(`[cycle14:${tag}]`))) issue.evidence.push(`[cycle14:${tag}] ${text}`);
}
function addHistory(issue, verdict, note, sourceFile) {
  issue.reverificationHistory = Array.isArray(issue.reverificationHistory) ? issue.reverificationHistory : [];
  if (!issue.reverificationHistory.some((h) => h.sourceFile === sourceFile)) issue.reverificationHistory.push({ cycle: 14, date: '2026-11-23', verdict, note, sourceFile });
}

const i197 = byId.get('FE-0197');
addMethod(i197, 'local-browser');
addEvidence(i197, 'live', 'Real 2FA flow on isolated stack 18004/5222 (policy=all, loopback=external, seeded e2e_admin): login -> 2fa_setup_required -> enable-2fa (real otpauth secret) -> TOTP -> verify-2fa. URL became /dashboard immediately; backup-code screen and codes did not appear at 4 s.');
addHistory(i197, 'confirmed', 'Real 2FA setup flow (not route-mocked) confirms LoginRoute unmounts before setup_complete.', 'manual-live-real-2fa');
i197.currentConclusion = 'Подтверждено реальным 2FA-flow: после verify-2fa URL сразу /dashboard, backup-коды не показываются.';

const i198 = byId.get('FE-0198');
addMethod(i198, 'local-browser');
addEvidence(i198, 'live', 'Real second login after enabling 2FA on 5222: login -> 2fa_required -> TOTP -> verify. External zone, discoverable_trusted_devices_count=0. URL became /dashboard; mandatory remember-device sheet did not appear.');
addHistory(i198, 'confirmed', 'Real 2FA login flow confirms mandatory trusted-device enrollment is unreachable.', 'manual-live-real-2fa');
i198.currentConclusion = 'Подтверждено реальным 2FA-login: обязательный remember-device sheet не появляется, URL сразу /dashboard.';

const i83 = byId.get('FE-0083');
addMethod(i83, 'local-browser');
addEvidence(i83, 'live', 'Two-tab browser race on isolated stack 5219/18002: three concurrent POST /auth/refresh from two pages sharing cookies -> [200,401,200]; /auth/me -> 401; a NEW refresh cookie after the race -> 401 "Refresh token has been revoked"; both tabs reloaded to /login.');
addHistory(i83, 'confirmed', 'Two-tab browser race plus new refresh token check confirms whole token family revocation, not just old-cookie rejection.', 'manual-live-two-tabs');
i83.currentConclusion = 'Подтверждено двумя вкладками и проверкой нового refresh: family отозвана, новый refresh -> 401 revoked, обе вкладки на /login.';

const i23 = byId.get('FE-0023');
addMethod(i23, 'local-browser-mock');
addEvidence(i23, 'live', 'Mobile 390x844, route-mocked 10000 ports in EquipmentTab: after switching to «Оборудование» the page blocked for ~30.45 s, rendered 10000 MUI Cards, 181642 DOM nodes, body height 1321340 px, JS heap 930 MB.');
addHistory(i23, 'confirmed', '10k-port mobile render freezes the page and creates 181k DOM nodes; virtualization absent.', 'manual-live-10k-ports');
i23.currentConclusion = 'Подтверждено live на 10 000 портов: ~30 с блокировки, 181 642 DOM-узла, heap 930 MB.';

const i98 = byId.get('FE-0098');
addMethod(i98, 'local-browser-mock');
addEvidence(i98, 'live', 'Synthetic 2000-file public folder on isolated stand: 8.38 s first render, 20180 DOM nodes, 98184 px body, 186 MB heap.');
addHistory(i98, 'confirmed', '2000-file folder render demonstrates unbounded list impact.', 'manual-live-large-2000');

const i325 = byId.get('FE-0325');
addMethod(i325, 'local-browser');
addEvidence(i325, 'live', 'PWA deep test on built app :5223: fresh offline reload stays on loader >50 s; only 2 refresh attempts during 50 s (no request storm); reconnect recovers to /login in ~2 s; offline reload with existing session shows /dashboard and «Нет подключения · Показываем сохранённые данные»; two tabs both show the loader.');
addHistory(i325, 'confirmed', 'Offline cold start hangs for fresh session, but reconnect recovers quickly and existing-session offline shell works; no infinite request storm.', 'manual-live-pwa-deep');
i325.currentConclusion = 'Подтверждено: свежая офлайн-сессия висит на загрузчике >50 с, 2 refresh-попытки за 50 с, восстановление сети возвращает /login за ~2 с; с сохранённой сессией показывается cached dashboard; две вкладки висят одинаково.';

const i259 = byId.get('FE-0259');
i259.statusRationale = 'Live browser attempt blocked: construction workspace requires a configured object/direction and 1C/SQL data; isolated stand returns «Для ведения хода работ сначала настройте объект». Static beforeunload gap remains confirmed.';

const i215 = byId.get('FE-0215');
i215.statusRationale = 'Live mail check blocked: isolated stack runs MAIL_MODULE_ENABLED=0 and has no mailbox/provider; static Quill/autosave chain remains confirmed.';

const i230 = byId.get('FE-0230');
i230.statusRationale = 'Live simulation with late desktop.hostReady did not reproduce a React hooks error because the card subtree unmounted on re-render; real WebView2 host is required.';

const i232 = byId.get('FE-0232');
i232.statusRationale = 'Live delegates test blocked: no prepared user/delegate fixtures and no approved mutation workflow in cycle 14; static catch->empty merge->save chain remains confirmed.';

const i239 = byId.get('FE-0239');
i239.statusRationale = 'Live department-manager race blocked: no prepared departments/users fixture and no approved mutation workflow in cycle 14; static race remains confirmed.';

const i22 = byId.get('FE-0022');
i22.statusRationale = 'Live keyboard check blocked: Warehouse1C balances/movements require 1C/SQL data; isolated stand has no such dataset. Static TableRow/TableCell onClick without keyboard semantics remains confirmed.';

const counts = { Confirmed: 0, Suspected: 0, 'Fixed-externally': 0, Rejected: 0 };
const severity = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
for (const i of data.issues) { counts[i.status] += 1; severity[i.severity] += 1; }
data.issueCounters = { ...data.issueCounters, critical: severity.Critical, high: severity.High, medium: severity.Medium, low: severity.Low, info: severity.Info, suspected: counts.Suspected, fixedExternally: counts['Fixed-externally'], rejected: counts.Rejected, confirmed: counts.Confirmed, total: data.issues.length };
fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ counts, severity }, null, 2));
