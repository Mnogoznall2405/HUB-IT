// Цикл 12: структурная перепроверка всех записей реестра.
// Для каждой: файл существует, line-диапазон в пределах файла,
// и хотя бы один идентификатор/фрагмент из title/lines/notes/evidence
// присутствует рядом с процитированными строками (±25) или в файле вообще.
import fs from 'node:fs';
import path from 'node:path';
const REPO = 'C:/Project/HUB-IT-main';
const DIR = REPO + '/audit/frontend';
const j = JSON.parse(fs.readFileSync(DIR + '/ISSUES.json', 'utf8'));

const parseRange = (s) => {
  const m = String(s || '').match(/(\d+)\s*[-–:]?\s*(\d+)?/);
  if (!m) return null;
  return { a: +m[1], b: +(m[2] || m[1]) };
};
const idents = (text) => {
  const out = new Set();
  const re = /`([^`]{3,80})`|([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*){1,3}\(\)?|use[A-Z][A-Za-z0-9_]*|set[A-Z][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const t = (m[1] || m[2] || '').replace(/\(\)$/, '');
    if (t.length >= 4 && !/^[A-ZА-ЯЁ\s]+$/.test(t)) out.add(t.split('(')[0]);
  }
  return [...out];
};

const rows = [];
for (const it of j.issues) {
  const raw = String(it.file || '');
  // Записи могут указывать на backend/ или repo-root пути — резолвим от корня.
  const abs = raw.startsWith('WEB-itinvent') || raw.startsWith('desktop') || raw.startsWith('mobile') || raw.startsWith('backend') || raw.startsWith('scripts')
    ? path.join(REPO, raw)
    : path.join(REPO, 'WEB-itinvent/frontend', raw);
  const rel = raw;
  const row = { id: it.id, sev: it.severity, status: it.status, file: rel, lines: it.lines, verdict: 'ok', detail: '' };
  if (!fs.existsSync(abs)) { row.verdict = 'missing-file'; rows.push(row); continue; }
  if (fs.statSync(abs).isDirectory()) { row.verdict = 'is-directory'; rows.push(row); continue; }
  const src = fs.readFileSync(abs, 'utf8').split('\n');
  const r = parseRange(it.lines);
  if (r && r.a > src.length) { row.verdict = 'lines-out-of-range'; row.detail = `file has ${src.length} lines, cited ${r.a}`; rows.push(row); continue; }
  // собираем идентификаторы из claims
  const claim = [it.title, it.lines, it.notes, it.impact, ...(it.evidence || [])].join(' ');
  const ids = idents(claim).filter(x => !/^(setState|console|fetch|JSON|Object|String|Number|Error)$/.test(x));
  if (!ids.length || !r) { row.verdict = 'manual'; row.detail = 'no identifiers/range to check'; rows.push(row); continue; }
  const near = src.slice(Math.max(0, r.a - 26), Math.min(src.length, r.b + 25)).join('\n');
  const hitNear = ids.filter(x => near.includes(x));
  if (hitNear.length) { row.verdict = 'ok'; row.detail = 'near:' + hitNear.slice(0, 3).join(','); rows.push(row); continue; }
  const hitFile = ids.filter(x => src.join('\n').includes(x));
  if (hitFile.length) { row.verdict = 'line-drift'; row.detail = 'in-file:' + hitFile.slice(0, 4).join(','); }
  else { row.verdict = 'pattern-gone'; row.detail = 'none of ' + ids.slice(0, 5).join(',') + ' found in file'; }
  rows.push(row);
}
fs.writeFileSync(DIR + '/evidence/cycle12/structural.json', JSON.stringify(rows, null, 2));
const tally = {};
for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
console.log(JSON.stringify(tally));
for (const r of rows.filter(x => x.verdict !== 'ok')) console.log(r.id, r.verdict, r.file, '|', r.detail);
