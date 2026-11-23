import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const p = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
const issue = data.issues.find((i) => i.id === 'FE-0098');
if (issue) {
  const note = 'Live cycle 13 large-data probe: synthetic 2000-file public folder rendered in 8.38 s, 20 180 DOM nodes, body height 98 184 px, JS heap 186 MB (isolated stand, route-mocked payload). This confirms the unbounded-render impact, not just the code path.';
  issue.evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
  if (!issue.evidence.some((e) => String(e).includes('2000-file public folder'))) {
    issue.evidence.push(`[cycle13:live] ${note}`);
  }
  issue.verification = Array.isArray(issue.verification) ? issue.verification : [];
  if (!issue.verification.includes('tooling')) issue.verification.push('tooling');
  issue.reverificationHistory = Array.isArray(issue.reverificationHistory) ? issue.reverificationHistory : [];
  if (!issue.reverificationHistory.some((h) => h.sourceFile === 'manual-live-large')) {
    issue.reverificationHistory.push({ cycle: 13, date: '2026-11-23', verdict: 'confirmed', note, sourceFile: 'manual-live-large' });
  }
  issue.currentConclusion = note;
}
fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('FE-0098 patched');
