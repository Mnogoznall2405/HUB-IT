import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const data = JSON.parse(fs.readFileSync(`${DIR}/ISSUES.json`, 'utf8'));
const verdicts = { confirmed: 0, refuted: 0, unverifiable: 0, 'fixed-externally': 0 };
for (const i of data.issues) {
  const h = (i.reverificationHistory || []).find((x) => x.cycle === 13);
  if (h && verdicts[h.verdict] !== undefined) verdicts[h.verdict] += 1;
}
data.statusModel = {
  note: 'verdict — результат конкретной перепроверки; status — текущее состояние записи в реестре. Они не обязаны совпадать: confirmed-вердикт при исходном Suspected может сохранять Suspected, если доказательство ограничено dev/средой.',
  cycle12: {
    confirmedVerdicts: 290,
    confirmedStatus: 254,
    difference: 36,
    explanation: '36 записей получили confirmed-вердикт, но остались Suspected: их утверждение подтверждалось кодом, однако пользовательский эффект зависел от dev-only/среды/объёма. Остальные 32 записи: 17 Rejected, 10 unverifiable, 4 wrong-evidence, 1 fixed-externally.'
  },
  cycle13: {
    verdicts,
    statuses: data.issueCounters,
    liveChecks: ['FE-0197', 'FE-0198', 'FE-0078', 'FE-0083', 'FE-0253', 'FE-0325'],
  },
};
fs.writeFileSync(`${DIR}/ISSUES.json`, JSON.stringify(data, null, 2) + '\n', 'utf8');
const summaryPath = `${DIR}/evidence/cycle13/cycle13_summary.json`;
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
summary.verdicts = verdicts;
summary.statusModel = data.statusModel.cycle12;
summary.liveChecks = data.statusModel.cycle13.liveChecks;
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ verdicts, counts: data.issueCounters }, null, 2));
