import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const p = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
const allowed = new Set(['static-code', 'local-browser', 'local-browser-mock', 'local-api', 'test-harness', 'production-observer']);

for (const issue of data.issues) {
  const current = Array.isArray(issue.verification) ? issue.verification : [];
  const normalized = current.map((v) => (v === 'static' ? 'static-code' : v));
  issue.verification = [...new Set(normalized.filter((v) => allowed.has(v)))];
  if (issue.verification.length === 0) issue.verification = ['static-code'];
  if (!Array.isArray(issue.verificationLegacy)) issue.verificationLegacy = [...current];
}

const fee253 = data.issues.find((i) => i.id === 'FE-0253');
if (fee253) {
  fee253.status = 'Rejected';
  fee253.currentConclusion = 'В проверенном сценарии (8 SPA-маршрутов, 12 раундов, принудительный GC) утечка не воспроизведена: heap плато 49–51 MB, после полного GC 23 MB. Это опровергает исходное «85→143 MB за 3 раунда», но не доказывает отсутствие утечек в других маршрутах, компонентах и длительных сценариях.';
  fee253.statusRationale = 'Rejected относится к конкретному утверждению о монотонном росте heap в проверенном сценарии, а не ко всему приложению.';
  fee253.verification = ['static-code', 'local-browser', 'test-harness'];
}

data.highBreakdown = {
  historical: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0078', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0215', 'FE-0230', 'FE-0232', 'FE-0239', 'FE-0259'],
  current: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0215', 'FE-0230', 'FE-0232', 'FE-0239', 'FE-0259'],
  fixed: ['FE-0078'],
  runtimeProven: ['FE-0023', 'FE-0059', 'FE-0078', 'FE-0083', 'FE-0197', 'FE-0198'],
  runtimeUnresolved: ['FE-0023', 'FE-0059', 'FE-0083', 'FE-0197', 'FE-0198'],
  staticOnly: ['FE-0022', 'FE-0215', 'FE-0230', 'FE-0232', 'FE-0239', 'FE-0259'],
};

fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
const methods = {};
for (const i of data.issues) for (const m of i.verification) methods[m] = (methods[m] || 0) + 1;
console.log(JSON.stringify({ methods, high: data.highBreakdown }, null, 2));
