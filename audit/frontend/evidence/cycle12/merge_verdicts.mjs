// Цикл 12: слияние вердиктов независимой перепроверки в ISSUES.json.
// confirmed → + 'перепроверено (цикл 12)' в verification; note уточняется в notes.
// fixed-externally → status 'Suspected (fixed-externally)' + префикс в notes.
// not-a-defect → status 'Suspected (опровергнуто)' + note.
// unverifiable → status 'Suspected (unverifiable)' если была Confirmed.
// wrong-evidence → actualFile в file, уточнение в notes, downgrade по списку.
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend';
const j = JSON.parse(fs.readFileSync(DIR + '/ISSUES.json', 'utf8'));
const verdicts = {};
for (let i = 1; i <= 8; i++)
  for (const v of JSON.parse(fs.readFileSync(DIR + '/evidence/cycle12/verdicts_' + i + '.json', 'utf8')))
    verdicts[v.id] = v;

// wrong-evidence: остаётся ли реальный дефект?
const WE_DOWNGRADE = new Set(['FE-0034', 'FE-0274']); // дефект не подтвердился
const WE_KEEP = new Set(['FE-0182', 'FE-0166']);      // механизм уточнён, дефект реален

let counts = { confirmed: 0, 'fixed-externally': 0, 'wrong-evidence': 0, 'not-a-defect': 0, unverifiable: 0, missing: 0 };
for (const it of j.issues) {
  const v = verdicts[it.id];
  if (!v) { counts.missing++; continue; }
  counts[v.verdict] = (counts[v.verdict] || 0) + 1;
  it.verification = it.verification || [];
  if (!it.verification.includes('перепроверено (цикл 12)'))
    it.verification.push('перепроверено (цикл 12)');

  switch (v.verdict) {
    case 'confirmed':
      it.notes = (it.notes || '') + ' Перепроверено: ' + v.note;
      break;
    case 'fixed-externally':
      it.status = 'Suspected (fixed-externally)';
      it.notes = 'ИСПРАВЛЕНО вне цикла аудита: ' + v.note + ' | Было: ' + (it.notes || '');
      break;
    case 'not-a-defect':
      it.status = 'Suspected (опровергнуто перепроверкой)';
      it.notes = 'ОПРОВЕРГНУТО перепроверкой цикла 12: ' + v.note + ' | Было: ' + (it.notes || '');
      break;
    case 'unverifiable':
      if (String(it.status).startsWith('Confirmed')) it.status = 'Suspected (unverifiable)';
      it.notes = 'Перепроверка: по коду не доказуемо — ' + v.note + ' | ' + (it.notes || '');
      break;
    case 'wrong-evidence':
      if (v.actualFile) it.file = v.actualFile;
      if (WE_DOWNGRADE.has(it.id)) {
        it.status = 'Suspected (уточнено)';
        it.notes = 'Цитированные места опровергнуты; остаточное: ' + v.note + ' | ' + (it.notes || '');
      } else {
        it.notes = 'Уточнение механизма (цикл 12): ' + v.note + ' | ' + (it.notes || '');
      }
      break;
  }
  if (v.actualFile && !it.file.includes(v.actualFile.split('/').pop()))
    it.relatedFiles = [...new Set([...(it.relatedFiles || []), v.actualFile])];
}
const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0, suspected: 0 };
for (const it of j.issues) {
  if (String(it.status || '').startsWith('Suspected')) c.suspected++;
  const s = String(it.severity || '').toLowerCase();
  c[s === 'critical' ? 'critical' : s === 'high' ? 'high' : s === 'medium' ? 'medium' : s === 'low' ? 'low' : 'info']++;
}
j.issueCounters = c;
fs.copyFileSync(DIR + '/ISSUES.json', DIR + '/backups/ISSUES.before-cycle12-verdicts.json');
fs.writeFileSync(DIR + '/ISSUES.json', JSON.stringify(j, null, 2) + '\n');
console.log('verdicts applied:', JSON.stringify(counts), '| counters:', JSON.stringify(c));
