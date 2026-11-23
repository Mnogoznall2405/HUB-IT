import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const p = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(p, 'utf8'));

const liveMethods = {
  'FE-0078': ['local-browser'],
  'FE-0083': ['local-api'],
  'FE-0098': ['local-browser-mock'],
  'FE-0197': ['local-browser-mock'],
  'FE-0198': ['local-browser-mock'],
  'FE-0253': ['local-browser', 'test-harness'],
  'FE-0325': ['local-browser'],
};

const allowed = ['static', 'local-browser', 'local-browser-mock', 'local-api', 'test-harness', 'production-observer'];
for (const issue of data.issues) {
  const legacy = Array.isArray(issue.verification) ? [...issue.verification] : [];
  issue.verificationLegacy = legacy;
  const methods = new Set();
  if (legacy.some((v) => String(v).startsWith('static'))) methods.add('static');
  if (legacy.some((v) => String(v).startsWith('live-production'))) methods.add('production-observer');
  if (legacy.some((v) => String(v).startsWith('tooling'))) methods.add('test-harness');
  for (const m of liveMethods[issue.id] || []) methods.add(m);
  if (methods.size === 0) methods.add('static');
  issue.verification = allowed.filter((m) => methods.has(m));
}

const byId = new Map(data.issues.map((i) => [i.id, i]));

const fee253 = byId.get('FE-0253');
if (fee253) {
  fee253.status = 'Rejected';
  fee253.currentConclusion = 'Опровергнуто циклом 13/14: 12 раундов по 8 SPA-маршрутам с HeapProfiler.collectGarbage перед каждым чтением дали плато 49–51 MB и падение до 23 MB после полного GC. Исходные 85→143 MB — отложенный GC/кэш lazy-чанков, а не утечка.';
  fee253.evidence = Array.isArray(fee253.evidence) ? fee253.evidence : [];
  const note = 'Cycle 13/14 memory probe: 12 rounds x 8 routes with forced GC; heap 37.1→51 plateau→23.3 after full GC; no monotonic growth.';
  if (!fee253.evidence.some((e) => String(e).includes('12 rounds x 8 routes'))) fee253.evidence.push(`[cycle14:refuted] ${note}`);
  fee253.reverificationHistory = Array.isArray(fee253.reverificationHistory) ? fee253.reverificationHistory : [];
  if (!fee253.reverificationHistory.some((h) => h.sourceFile === 'manual-live-memory-12')) {
    fee253.reverificationHistory.push({ cycle: 14, date: '2026-11-23', verdict: 'refuted', note, sourceFile: 'manual-live-memory-12' });
  }
  fee253.statusRationale = 'Положительный статический вердикт цикла 13 (механизм кэша) не подтвердил пользовательскую утечку; 12-раундовый GC-замер её опроверг.';
}

const rationale = {
  'FE-0194': 'Статический вердикт подтверждает отсутствие guard, но пользовательский краш требует частичного patchTarget без name при рассинхронизации списка и детали. Воспроизводимого пользовательского сценария нет — статус Suspected.',
  'FE-0300': 'Статический вердикт подтверждает отсутствие индикатора усечения, но эффект требует >200 диалогов на хост. Такого набора данных в доступной среде нет — статус Suspected.',
  'FE-0324': 'Статический вердикт подтверждает кламп и отсутствие total/hasMore, но эффект требует >1000 отделов или >500 movements. Production-объём не запрашивался — статус Suspected.',
};
for (const [id, text] of Object.entries(rationale)) {
  const issue = byId.get(id);
  if (issue) issue.statusRationale = text;
}

data.verificationProtocol = {
  version: 2,
  effectiveFrom: '2026-11-23',
  methods: {
    'static-code': 'Чтение исходников и контрактов без запуска приложения.',
    'local-browser': 'Браузер на изолированном стенде с реальным backend/SQLite и тестовыми пользователями.',
    'local-browser-mock': 'Браузер на изолированном стенде с перехваченными API-ответами; проверяется UI-поведение, не серверный контракт.',
    'local-api': 'HTTP-пробы к изолированному backend (SQLite) без UI.',
    'test-harness': 'Vitest/Node/Playwright-обвязка, замеры и синтетические payload.',
    'production-observer': 'Историческое read-only наблюдение production; не новые мутации.',
  },
  note: 'verification[] — очищенные методы; verificationLegacy[] сохраняет исходные значения циклов 1–13.',
};

const counts = { Confirmed: 0, Suspected: 0, 'Fixed-externally': 0, Rejected: 0 };
const severity = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
for (const i of data.issues) {
  counts[i.status] = (counts[i.status] || 0) + 1;
  severity[i.severity] = (severity[i.severity] || 0) + 1;
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
fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ counts, severity, total: data.issues.length, methods: data.verificationProtocol.methods }, null, 2));
