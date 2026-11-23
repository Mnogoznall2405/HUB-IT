// Cycle-10 merge: remote branch authoritative for FE-0001..FE-0077;
// local cycle-9 additions renumbered +1 -> FE-0078..FE-0138.
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend/';
const remote = JSON.parse(fs.readFileSync('C:/Users/836D~1/AppData/Local/Temp/issues_remote.json', 'utf8').replace(/^\uFEFF/, ''));
const local = JSON.parse(fs.readFileSync(DIR + 'ISSUES.json', 'utf8'));

const base = remote.issues; // 75 authoritative entries
const mine = local.issues.filter(i => parseInt(i.id.slice(3), 10) >= 77); // my 61, ids 77..137
const shift = (id) => 'FE-' + String(parseInt(id.slice(3), 10) + 1).padStart(4, '0');

for (const it of mine) {
  const oldId = it.id;
  it.id = shift(it.id);
  // fix references to renumbered ids inside notes/related (only >=77 shift)
  if (Array.isArray(it.related)) it.related = it.related.map(r => parseInt(r.slice(3), 10) >= 77 ? shift(r) : r);
}

// additive patches onto remote entries (non-destructive)
const byId = Object.fromEntries(base.map(i => [i.id, i]));
const addNote = (id, txt) => { byId[id].notes = byId[id].notes ? byId[id].notes + ' | ' + txt : txt; };
const addEv = (id, txt) => { (byId[id].evidence ||= []).push(txt); };

if (byId['FE-0004']) {
  addNote('FE-0004', 'цикл 9/10: ведущая гипотеза — устаревший app-shell/SW в долгоживущем профиле (SW обновляется только полной перезагрузкой, FE-0084); согласуется с «не воспроизводится в чистом профиле»');
  (byId['FE-0004'].related ||= []).push('FE-0084');
}
if (byId['FE-0011']) {
  addEv('FE-0011', 'cycle9 runtime (local stack): docW=1930@zoom0.8, 1932@1.0, 1938@1.5 при vw=1920 — overflow на всех масштабах; probe-zoom-results.json, zoom-scan-center-*.png');
}
if (byId['FE-0060']) {
  (byId['FE-0060'].related ||= []).push('FE-0080');
}
if (byId['FE-0072']) {
  addNote('FE-0072', 'цикл 9: бизнес-403 подавляются отдельным путём — остаточный риск только для инфраструктурных 403 на auth-цепочке');
}
if (byId['FE-0047']) {
  (byId['FE-0047'].related ||= []).push('FE-0083');
  addNote('FE-0047', 'цикл 9: агент аргументирует Medium — после silent-relogin вкладка остаётся в «эпохе отказа»; severity сохранён по решению независимой проверки, см. FE-0083');
}

const merged = { ...remote, issues: [...base, ...mine] };
const c = { critical:0, high:0, medium:0, low:0, info:0, suspected:0 };
for (const it of merged.issues) {
  if (String(it.status||'').startsWith('Suspected')) c.suspected++;
  const s = String(it.severity||'').toLowerCase();
  if (s==='critical') c.critical++; else if (s==='high') c.high++;
  else if (s==='medium') c.medium++; else if (s==='low') c.low++; else c.info++;
}
merged.issueCounters = c;
merged.generatedAt = new Date().toISOString();
merged.sources = [...(remote.sources||[]), 'cycle 9: six explore agents + local-stack runtime probes (merged, renumbered FE-0078+)'];
fs.writeFileSync(DIR + 'ISSUES.json', JSON.stringify(merged, null, 2) + '\n');
const ids = merged.issues.map(i => i.id);
const dups = ids.filter((x, i) => ids.indexOf(x) !== i);
console.log('total:', merged.issues.length, 'dups:', JSON.stringify(dups), 'counters:', JSON.stringify(c));
console.log('new range:', mine[0].id, '..', mine[mine.length-1].id);
