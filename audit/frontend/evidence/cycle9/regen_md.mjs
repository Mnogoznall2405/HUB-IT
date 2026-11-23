// Regenerate ISSUES.md cycle-9 section with renumbered ids (FE-0078..FE-0138).
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend/';
const j = JSON.parse(fs.readFileSync(DIR + 'ISSUES.json', 'utf8'));
const fresh = j.issues.filter(i => parseInt(i.id.slice(3), 10) >= 78);

let md = '\n\n## Цикл 9 — карточки новых записей (FE-0078…FE-0138)\n\n';
md += '> Перенумерация цикла 10: исходные черновые id FE-0077…FE-0137 сдвинуты на +1 —\n';
md += '> удалённая ветка `audit/frontend-2026-11-22` уже содержала FE-0077\n';
md += '> (почта: медленное сохранение черновиков). Старые id не тронуты.\n\n';
for (const i of fresh) {
  md += `### ${i.id} — ${i.title}\n`;
  md += `- Категория: ${i.category} | Серьёзность: ${i.severity} | Статус: ${i.status}\n`;
  if (i.page) md += `- Страница: ${i.page}\n`;
  if (i.file) md += `- Файл: \`${i.file}\`${i.lines ? ' :' + i.lines : ''}\n`;
  if (i.notes) md += `- Суть/механизм: ${i.notes}\n`;
  if (i.evidence?.length) md += `- Доказательства: ${i.evidence.join('; ')}\n`;
  if (i.related?.length) md += `- Связано: ${i.related.join(', ')}\n`;
  md += '\n';
}
const c = j.issueCounters;
md += `## Счётчики (цикл 12, после перепроверки всех записей)\n\n`;
md += `| Серьёзность | Кол-во |\n|---|---|\n| Critical | ${c.critical} |\n| High | ${c.high} (FE-0022, FE-0023, FE-0059, FE-0078, FE-0083, FE-0197, FE-0198, FE-0215, FE-0230, FE-0232, FE-0239, FE-0259) |\n| Medium | ${c.medium} |\n| Low | ${c.low} |\n| Info | ${c.info} |\n| Confirmed | ${c.confirmed ?? ''} |\n| Suspected (подмножество) | ${c.suspected} |\n| Fixed-externally | ${c.fixedExternally ?? 0} |\n| Rejected | ${c.rejected ?? 0} |\n| **Всего записей** | **${j.issues.length}** |\n`;

const cur = fs.readFileSync(DIR + 'ISSUES.md', 'utf8');
const idx = cur.lastIndexOf('## Цикл 9 — карточки');
const base = idx > 0 ? cur.slice(0, idx) : cur;
fs.writeFileSync(DIR + 'ISSUES.md', base + md);
console.log('ISSUES.md regenerated:', fresh.length, 'cards; base kept', idx, 'chars');
