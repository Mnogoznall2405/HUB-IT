// Merge cycle-12 verdicts into ISSUES.json. Audit-only script.
import fs from 'node:fs';

const ROOT = 'C:/Project/HUB-IT-main';
const DIR = `${ROOT}/audit/frontend`;
const CYCLE = `${DIR}/evidence/cycle12`;
const MARKER = 'перепроверено (цикл 12)';

const data = JSON.parse(fs.readFileSync(`${DIR}/ISSUES.json`, 'utf8'));
const byId = new Map(data.issues.map((i) => [i.id, i]));

// 1. Load and validate all verdicts.
const verdicts = new Map();
const files = fs.readdirSync(CYCLE).filter((f) => /^verdicts_\d+\.json$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const allowed = new Set(['confirmed', 'fixed-externally', 'wrong-evidence', 'not-a-defect', 'unverifiable']);
for (const file of files) {
  const list = JSON.parse(fs.readFileSync(`${CYCLE}/${file}`, 'utf8'));
  if (!Array.isArray(list)) throw new Error(`${file}: not an array`);
  for (const v of list) {
    if (!v?.id || !allowed.has(v.verdict)) throw new Error(`${file}: bad verdict entry ${JSON.stringify(v)}`);
    if (!byId.has(v.id)) throw new Error(`${file}: unknown id ${v.id}`);
    if (verdicts.has(v.id)) throw new Error(`duplicate verdict ${v.id}`);
    verdicts.set(v.id, v);
  }
}
const missing = data.issues.map((i) => i.id).filter((id) => !verdicts.has(id));
if (missing.length) throw new Error(`missing verdicts: ${missing.length} (${missing.slice(0, 10).join(', ')})`);
console.log('verdict files:', files.join(', '), '| entries:', verdicts.size);

const baseStatus = (s) => {
  const t = String(s || '').trim();
  if (t.startsWith('Confirmed')) return 'Confirmed';
  if (t.startsWith('Suspected')) return 'Suspected';
  if (t === 'Fixed-externally' || t === 'Rejected') return t;
  return t || 'Suspected';
};

const counts = { Confirmed: 0, Suspected: 0, 'Fixed-externally': 0, Rejected: 0 };
const severity = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };

for (const issue of data.issues) {
  const v = verdicts.get(issue.id);
  const current = baseStatus(issue.status);
  let next = current;

  if (v.verdict === 'confirmed') {
    next = current === 'Fixed-externally' || current === 'Rejected' ? current : (current === 'Suspected' ? 'Suspected' : 'Confirmed');
  } else if (v.verdict === 'fixed-externally') {
    next = 'Fixed-externally';
  } else if (v.verdict === 'not-a-defect') {
    next = 'Rejected';
  } else if (v.verdict === 'unverifiable') {
    next = 'Suspected';
  } else if (v.verdict === 'wrong-evidence') {
    next = 'Suspected';
  }

  issue.status = next;
  if (v.actualFile) issue.file = String(v.actualFile).replace(/\\/g, '/');
  if (v.verdict !== 'confirmed') issue.reverificationVerdict = v.verdict;

  const notes = [];
  if (v.note) notes.push(`[cycle12:${v.verdict}] ${v.note}`);
  if (notes.length) {
    issue.evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
    issue.evidence.push(...notes);
  }
  issue.verification = Array.isArray(issue.verification) ? issue.verification : [];
  if (!issue.verification.includes(MARKER)) issue.verification.push(MARKER);

  counts[next] = (counts[next] || 0) + 1;
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

const summary = {
  generatedAt: new Date().toISOString(),
  files,
  verdicts: {
    confirmed: [...verdicts.values()].filter((v) => v.verdict === 'confirmed').length,
    'fixed-externally': [...verdicts.values()].filter((v) => v.verdict === 'fixed-externally').length,
    'wrong-evidence': [...verdicts.values()].filter((v) => v.verdict === 'wrong-evidence').length,
    'not-a-defect': [...verdicts.values()].filter((v) => v.verdict === 'not-a-defect').length,
    unverifiable: [...verdicts.values()].filter((v) => v.verdict === 'unverifiable').length,
  },
  statuses: counts,
  severity,
  total: data.issues.length,
};
fs.writeFileSync(`${CYCLE}/cycle12_summary.json`, JSON.stringify(summary, null, 2) + '\n', 'utf8');
fs.writeFileSync(`${DIR}/ISSUES.json`, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(summary, null, 2));
