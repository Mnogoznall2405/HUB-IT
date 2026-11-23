import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const CYCLE = `${DIR}/evidence/cycle13`;
const BACKUP = `${DIR}/backups/ISSUES-before-cycle13.json`;
const MARKER12 = 'перепроверено (цикл 12)';
const MARKER13 = 'перепроверено (цикл 13)';

if (!fs.existsSync(BACKUP)) {
  fs.copyFileSync(`${DIR}/ISSUES.json`, BACKUP);
}
const data = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
const byId = new Map(data.issues.map((i) => [i.id, i]));

const linesPatch = {
  'FE-0016': { lines: 'n/a', linesNote: 'Источник 401 не установлен: URL не сохранены, повторная проба без 4xx/5xx; кодовая привязка невозможна.' },
  'FE-0083': { lines: '54,66-76', relatedFiles: [{ file: 'WEB-itinvent/backend/api/v1/auth.py', lines: '135,1648-1675' }] },
  'FE-0084': { lines: '66-84', relatedFiles: [{ file: 'WEB-itinvent/frontend/src/lib/pwaInstall.js', lines: '266-285' }, { file: 'WEB-itinvent/frontend/src/pages/account/settings/HubItPwaSettingsCard.jsx', lines: '100,288-306' }] },
  'FE-0085': { lines: '184-192,266-276' },
  'FE-0086': { lines: '316-371' },
  'FE-0099': { lines: '455-457,1062-1064' },
  'FE-0100': { lines: '36-63', relatedFiles: [{ file: 'WEB-itinvent/frontend/src/components/mail/MailHtmlBody.jsx', lines: '77-78,128-137' }] },
  'FE-0102': { lines: '300-319' },
  'FE-0104': { lines: '26-30', relatedFiles: [{ file: 'WEB-itinvent/frontend/src/pages/Mail.jsx', lines: '2223,2286' }] },
  'FE-0106': { lines: '594-602' },
  'FE-0107': { lines: '183-186,459', relatedFiles: [{ file: 'WEB-itinvent/frontend/src/components/myFiles/MyFilesEditorWorkspace.jsx', lines: '25-28,78,173' }] },
  'FE-0108': { lines: '540-542', relatedFiles: [{ file: 'WEB-itinvent/frontend/src/pages/MyFiles.jsx', lines: '392-395' }] },
  'FE-0109': { lines: '46-47,551,561' },
  'FE-0111': { lines: '795,844', relatedFiles: [{ file: 'WEB-itinvent/backend/services/my_files_collab_service.py', lines: '199-211,512-514' }] },
  'FE-0114': { lines: '19,34-38', relatedFiles: [{ file: 'WEB-itinvent/frontend/src/components/mail/useMailMessageFileActions.js', lines: '291-299' }, { file: 'WEB-itinvent/backend/api/v1/mail.py', lines: '2046-2047,2103-2104' }] },
  'FE-0115': { lines: '337-360' },
  'FE-0117': { lines: '291-299,319-328' },
  'FE-0120': { lines: '12', relatedFiles: [{ file: 'WEB-itinvent/frontend/src/components/mail/officeAttachmentPreview.js', lines: '161' }] },
  'FE-0123': { lines: '1007-1039' },
  'FE-0128': { lines: '6-7,39-40', relatedFiles: [{ file: 'WEB-itinvent/frontend/src/components/hub/TaskWorkspacePanel.jsx', lines: '541' }] },
  'FE-0136': { lines: '59-76' },
  'FE-0137': { lines: '270-296' },
  'FE-0138': { lines: '240-276' },
};

for (const [id, patch] of Object.entries(linesPatch)) {
  const issue = byId.get(id);
  if (!issue) continue;
  issue.lines = patch.lines;
  if (patch.linesNote) issue.linesNote = patch.linesNote;
  if (patch.relatedFiles) {
    const existing = Array.isArray(issue.relatedFiles) ? issue.relatedFiles : [];
    const merged = [...existing];
    for (const rf of patch.relatedFiles) {
      if (!merged.some((x) => x.file === rf.file)) merged.push(rf);
    }
    issue.relatedFiles = merged;
  }
}

// Wrong-evidence corrections: keep the original claim separately, update current finding.
const wrong = {
  'FE-0034': {
    title: 'IconButton без доступного имени: UsersTab, Mfu, MailTemplatesDialog, SocketsTab/EquipmentTab (Tooltip→span)',
    file: 'WEB-itinvent/frontend/src/pages/account/admin/UsersTab.jsx',
    lines: '321',
    severity: 'Medium',
    currentConclusion: 'Подтверждено в суженном виде: кнопки без aria-label остаются в UsersTab:321 и в случаях Tooltip→span (Mfu:988-990, MailTemplatesDialog:183/190, SocketsTab:285/381, EquipmentTab:313). SharedFolder/Vcs/Passwords/Voice — ложные срабатывания.',
    relatedFiles: [
      { file: 'WEB-itinvent/frontend/src/pages/Mfu.jsx', lines: '988-990' },
      { file: 'WEB-itinvent/frontend/src/components/mail/MailTemplatesDialog.jsx', lines: '183,190' },
      { file: 'WEB-itinvent/frontend/src/components/networks/SocketsTab.jsx', lines: '285,381' },
      { file: 'WEB-itinvent/frontend/src/components/networks/EquipmentTab.jsx', lines: '313' },
    ],
  },
  'FE-0115': {
    title: 'Синхронный revokeObjectURL сразу после click — хрупко на iOS Safari',
    file: 'WEB-itinvent/frontend/src/components/mail/mailMessageFileActions.js',
    lines: '337-360',
    severity: 'Low',
    currentConclusion: 'Ссылка исправлена: синхронный revoke находится в downloadBlobFile (mailMessageFileActions.js:354-359), 60-секундная задержка — только popup-ветка iOS standalone. На iOS Safari не проверялось; тот же паттерн остаётся в networksHelpers/MyFiles/Statistics/tasks/ObjectNetmapTab.',
    relatedFiles: [
      { file: 'WEB-itinvent/frontend/src/lib/networksHelpers.js', lines: '75-84' },
      { file: 'WEB-itinvent/frontend/src/pages/MyFiles.jsx', lines: '674-681' },
      { file: 'WEB-itinvent/frontend/src/pages/Statistics.jsx', lines: '324-331' },
      { file: 'WEB-itinvent/frontend/src/pages/tasks/useTasksPageController.jsx', lines: '457-464' },
      { file: 'WEB-itinvent/frontend/src/components/itObjects/ObjectNetmapTab.jsx', lines: '402-413' },
    ],
  },
  'FE-0182': {
    title: 'Voice: unhandled rejection при отказе clipboard.writeText и неочищаемый setTimeout',
    file: 'WEB-itinvent/frontend/src/pages/voice-video/VoiceLogViewer.jsx',
    lines: '166-171',
    severity: 'Low',
    currentConclusion: 'Старый TypeError опровергнут (опциональная цепочка короткозамыкает выражение). Подтверждён реальный дефект: нет .catch/fallback, отказ Clipboard API молча ничего не делает и даёт unhandledrejection; setTimeout на :169 не очищается.',
  },
  'FE-0250': {
    title: 'Аккаунт: test-only resolveAvailableSettingsTabs и избыточный adminOnlyFallback',
    file: 'WEB-itinvent/frontend/src/pages/account/accountConstants.jsx',
    lines: '32-40',
    severity: 'Info',
    currentConclusion: 'Подтверждена только вторая часть: resolveAvailableSettingsTabs используется лишь тестом SettingsAiBots.test.jsx. adminOnlyFallback читается, но не меняет результат (accountNavigationConfig.jsx:176-180); это мёртвый код, а не пользовательский дефект.',
    relatedFiles: [{ file: 'WEB-itinvent/frontend/src/components/account/accountNavigationConfig.jsx', lines: '93,122,176-180' }],
  },
};
for (const [id, patch] of Object.entries(wrong)) {
  const issue = byId.get(id);
  if (!issue) continue;
  issue.originalClaim = issue.originalClaim || issue.title;
  issue.title = patch.title;
  issue.file = patch.file;
  issue.lines = patch.lines;
  issue.severity = patch.severity;
  issue.currentConclusion = patch.currentConclusion;
  issue.relatedFiles = patch.relatedFiles;
}

// Preserve original claim/evidence and build cycle-12 history for every record.
for (const issue of data.issues) {
  issue.originalClaim = issue.originalClaim || issue.title;
  const ev = Array.isArray(issue.evidence) ? issue.evidence : [];
  issue.originalEvidence = ev.filter((e) => !String(e).startsWith('[cycle12:') && !String(e).startsWith('[cycle13:'));
  const cycle12Entry = ev.find((e) => String(e).startsWith('[cycle12:'));
  let c12verdict = issue.reverificationVerdict || 'confirmed';
  let c12note = '';
  if (cycle12Entry) {
    const text = String(cycle12Entry);
    const m = /^\[cycle12:([a-z-]+)\]\s*(.*)$/i.exec(text);
    if (m) { c12verdict = m[1]; c12note = m[2]; }
  }
  issue.reverificationHistory = [{ cycle: 12, date: '2026-11-23', verdict: c12verdict, note: c12note }];
  if (!issue.currentConclusion) {
    if (issue.status === 'Rejected') issue.currentConclusion = `Отклонено: ${c12note || 'ложное срабатывание/намеренное поведение'}`;
    else if (issue.status === 'Fixed-externally') issue.currentConclusion = `Исправлено внешним коммитом: ${c12note || 'дефект больше не воспроизводится'}`;
    else if (issue.status === 'Suspected') issue.currentConclusion = `Остаётся Suspected: ${c12note || 'нужна дополнительная проверка'}`;
    else issue.currentConclusion = `Подтверждено: ${c12note || 'код/поведение соответствуют исходному утверждению'}`;
  }
}

// Cycle 13 verdicts.
const verdictFiles = fs.readdirSync(CYCLE).filter((f) => /^verdicts_.*\.json$/.test(f) && f !== 'cycle13_summary.json');
const verdicts = new Map();
for (const file of verdictFiles) {
  const list = JSON.parse(fs.readFileSync(`${CYCLE}/${file}`, 'utf8'));
  for (const v of list) {
    if (!v?.id || !v?.verdict) continue;
    if (byId.has(v.id)) verdicts.set(v.id, { ...v, sourceFile: file });
  }
}

const keepSuspected = new Set(['FE-0161', 'FE-0194', 'FE-0300', 'FE-0324']);
const liveManual = {
  'FE-0078': { verdict: 'fixed-externally', note: 'Live E2E cycle 13: chat-realtime.spec.js «sender is offline» прошёл на 8462d971 (3/3, 1.9m), включая sender count=1 после reconnect и reload.', codeRefs: ['WEB-itinvent/frontend/src/lib/chatSocket.js:1107-1186', 'WEB-itinvent/frontend/src/pages/chat/useChatThreadMessageMerge.js:25-68'] },
  'FE-0083': { verdict: 'confirmed', note: 'Live cycle 13: 3 параллельных POST /auth/refresh с одной кукой дали [401,200,200], затем /auth/me 401 — family отозвана, вкладки разлогинены.', codeRefs: ['WEB-itinvent/frontend/src/api/http.js:54,66-76', 'WEB-itinvent/backend/api/v1/auth.py:135,1648-1675'] },
  'FE-0197': { verdict: 'confirmed', note: 'Live cycle 13 (route-mocked 2FA на изолированном стенде): после verify-2fa URL сразу /dashboard, экран backup-кодов не появился ни через 0.25/0.8/2/4 c.', codeRefs: ['WEB-itinvent/frontend/src/pages/Login.jsx:1505-1521', 'WEB-itinvent/frontend/src/contexts/AuthContext.jsx:557-568', 'WEB-itinvent/frontend/src/App.jsx:237-252'] },
  'FE-0198': { verdict: 'confirmed', note: 'Live cycle 13 (route-mocked 2FA на изолированном стенде): после verify-2fa-login URL сразу /dashboard, remember-device sheet не появился ни через 0.25/0.8/2/4 c.', codeRefs: ['WEB-itinvent/frontend/src/pages/Login.jsx:1404-1415', 'WEB-itinvent/frontend/src/App.jsx:237-252'] },
  'FE-0230': { verdict: 'confirmed', note: 'Static remains confirmed; live simulation with a late desktop.hostReady on the isolated stand did not reproduce a hooks error (card subtree unmounted on re-render), so live reproduction is inconclusive.', codeRefs: ['WEB-itinvent/frontend/src/pages/account/settings/HubItPwaSettingsCard.jsx:34-38', 'WEB-itinvent/frontend/src/lib/platform.js:14-16'] },
  'FE-0215': { verdict: 'confirmed', note: 'Static remains confirmed; live mail check not possible: isolated stack runs MAIL_MODULE_ENABLED=0 and has no mailbox.', codeRefs: ['WEB-itinvent/frontend/src/components/mail/MailComposeHost.jsx:524-539', 'WEB-itinvent/frontend/src/components/mail/mailComposeHtml.js:138-145'] },
  'FE-0232': { verdict: 'confirmed', note: 'Static remains confirmed; live account-admin race not executed in cycle 13 (no test-data mutation outside throwaway stack).', codeRefs: ['WEB-itinvent/frontend/src/pages/account/hooks/useAccountSectionData.js:244-251,637-644'] },
  'FE-0239': { verdict: 'confirmed', note: 'Static remains confirmed; live department-manager race not executed in cycle 13.', codeRefs: ['WEB-itinvent/frontend/src/pages/account/admin/DepartmentsTab.jsx:58-89,129-142'] },
  'FE-0259': { verdict: 'confirmed', note: 'Static remains confirmed; live construction-workspace check blocked: local stack has no 1C/SQL construction data.', codeRefs: ['WEB-itinvent/frontend/src/components/construction/ConstructionWorkWorkspace.jsx:40-41,165'] },
};
for (const [id, v] of Object.entries(liveManual)) verdicts.set(id, v);

const counts = { Confirmed: 0, Suspected: 0, 'Fixed-externally': 0, Rejected: 0 };
const severity = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };

for (const issue of data.issues) {
  const v = verdicts.get(issue.id);
  if (v) {
    let next = issue.status;
    if (v.verdict === 'refuted') next = 'Rejected';
    else if (v.verdict === 'fixed-externally') next = 'Fixed-externally';
    else if (v.verdict === 'unverifiable') next = 'Suspected';
    else if (v.verdict === 'confirmed') next = keepSuspected.has(issue.id) ? 'Suspected' : 'Confirmed';
    issue.status = next;
    issue.evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
    const note = String(v.note || '');
    if (note) issue.evidence.push(`[cycle13:${v.verdict}] ${note}`);
    issue.verification = Array.isArray(issue.verification) ? issue.verification : [];
    if (!issue.verification.includes(MARKER13)) issue.verification.push(MARKER13);
    issue.reverificationHistory = Array.isArray(issue.reverificationHistory) ? issue.reverificationHistory : [];
    issue.reverificationHistory.push({ cycle: 13, date: '2026-11-23', verdict: v.verdict, note, sourceFile: v.sourceFile || 'manual' });
    issue.currentConclusion = note || issue.currentConclusion;
  }
  counts[issue.status] = (counts[issue.status] || 0) + 1;
  severity[issue.severity] = (severity[issue.severity] || 0) + 1;
}

data.issueCounters = {
  ...data.issueCounters,
  critical: severity.Critical,
  high: severity.High,
  medium: severity.Medium,
  low: severity.Low,
  info: severity.Info,
  suspected: counts.Suspected,
  fixedExternally: counts['Fixed-externally'],
  rejected: counts.Rejected,
  confirmed: counts.Confirmed,
  total: data.issues.length,
};

fs.writeFileSync(`${DIR}/ISSUES.json`, JSON.stringify(data, null, 2) + '\n', 'utf8');
const summary = { generatedAt: new Date().toISOString(), verdictFiles, verdicts: verdicts.size, statuses: counts, severity, total: data.issues.length };
fs.writeFileSync(`${CYCLE}/cycle13_summary.json`, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(summary, null, 2));
