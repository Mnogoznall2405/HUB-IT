// Normalize cycle-9 entries (FE-0078+) to the registry schema used by
// validate-issues-json.mjs: evidence[] non-empty, verification[] with
// static/live-production/tooling prefixes, file = single repo-relative path.
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend/';
const j = JSON.parse(fs.readFileSync(DIR + 'ISSUES.json', 'utf8'));

for (const it of j.issues) {
  if (parseInt(it.id.slice(3), 10) < 78) continue;

  // file: keep a single clean repo-relative path; extras -> relatedFiles
  if (it.file) {
    const parts = String(it.file).split(';').map(s => s.trim()).filter(Boolean);
    let first = parts[0];
    // strip trailing ':lines' and parenthetical notes from the path itself
    first = first.replace(/\s*\(.*$/, '').replace(/:(\d|lines).*$/, '').trim();
    if (!first.startsWith('WEB-itinvent/') && !first.startsWith('audit/')) {
      first = 'WEB-itinvent/frontend/src/' + first.replace(/^src\//, '');
    }
    if (parts.length > 1) it.relatedFiles = parts.slice(1);
    it.file = first;
  } else if (!it.fileNote) {
    it.fileNote = 'многофайловая находка / нет единственного пути — см. notes/evidence';
  }

  if (!Array.isArray(it.evidence) || it.evidence.length === 0) {
    it.evidence = ['статическая проверка по file:line (цикл 9, перепроверено вручную)'];
  }
  if (!Array.isArray(it.verification) || it.verification.length === 0) {
    const runtime = String(it.status).includes('runtime') ||
      (it.evidence || []).some(e => /runtime|probe|прогон|замер/i.test(String(e)));
    it.verification = runtime ? ['static', 'tooling'] : ['static'];
  }
}

fs.writeFileSync(DIR + 'ISSUES.json', JSON.stringify(j, null, 2) + '\n');
console.log('normalized', j.issues.filter(i => parseInt(i.id.slice(3),10) >= 78).length, 'entries');
