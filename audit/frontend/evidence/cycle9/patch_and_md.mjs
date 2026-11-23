// Cycle 9 part 2: patch old entries with new evidence + regenerate ISSUES.md tail.
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend/';
const j = JSON.parse(fs.readFileSync(DIR + 'ISSUES.json', 'utf8'));

const byId = Object.fromEntries(j.issues.map(i => [i.id, i]));

// FE-0011: zoom evidence from cycle-9 runtime measurement
if (byId['FE-0011']) {
  byId['FE-0011'].notes = '1366/1280 чисто (lg-брейкпоинт). Цикл 9 (runtime, локальный стек): docW=1930@80%, 1932@100%, 1938@150% при vw=1920 — переполнение сохраняется на всех масштабах; широкая цепочка html>body>#root>MuiBox…main (css-1rqjt25).';
  (byId['FE-0011'].evidence ||= []).push('cycle9 probe-zoom-results.json + zoom-scan-center-*.png');
}
// FE-0047: passkey/trusted-device не сбрасывают эпоху — поднимаем до Medium по доказательствам
if (byId['FE-0047']) {
  byId['FE-0047'].severity = 'Medium';
  byId['FE-0047'].notes = 'resetAuthRejectionEpoch вызывается только в refreshAuthSession (.then, http.js:70) и password-login; вход через passkey/trusted-device её не сбрасывает → после silent-relogin вкладка остаётся в «эпохе отказа». Связано с FE-0082.';
  byId['FE-0047'].related = ['FE-0082'];
}
// FE-0004: cycle-9 conclusion — вероятная причина устаревший бандл/SW
if (byId['FE-0004']) {
  byId['FE-0004'].notes = 'с сессией ошибка показывается корректно; API отдаёт 404 даже анонимно; механизм не установлен (web.config и 401-перехватчик исключены). Цикл 9: наиболее вероятная причина — устаревший бандл/SW у наблюдавшего клиента (см. FE-0083: SW обновляется только полной перезагрузкой). Требуется перепроверка на свежем бандле.';
}
// FE-0060: annotate threshold + cross-ref FE-0079
if (byId['FE-0060']) {
  byId['FE-0060'].notes = 'порог показа баннера ~2 c (ChatThreadHeader.jsx:35), но он упирается в transport-health gate (~60 c) — см. FE-0079: на half-open соединении до ~50 c «подключено».';
  byId['FE-0060'].related = ['FE-0059', 'FE-0079'];
}
// FE-0072: частично опровергнуто агентом
if (byId['FE-0072']) {
  byId['FE-0072'].notes = 'цикл 9 (агент pwa/auth): бизнес-403 подавляются отдельным путём — первоначальная формулировка уточнена; остаётся Suspected только для инфраструктурных 403 на auth-цепочке.';
}

// recalc counters (severity buckets sum to total; suspected orthogonal)
const c = { critical:0, high:0, medium:0, low:0, info:0, suspected:0 };
for (const it of j.issues) {
  if (String(it.status||'').startsWith('Suspected')) c.suspected++;
  const s = String(it.severity||'').toLowerCase();
  if (s==='critical') c.critical++; else if (s==='high') c.high++;
  else if (s==='medium') c.medium++; else if (s==='low') c.low++; else c.info++;
}
j.issueCounters = c;
fs.writeFileSync(DIR + 'ISSUES.json', JSON.stringify(j, null, 2) + '\n');
console.log('patched; counters:', JSON.stringify(c));

// ===== ISSUES.md: generate compact cards for FE-0077..FE-0137 =====
const fresh = j.issues.filter(i => parseInt(i.id.slice(3), 10) >= 77);
let md = '\n\n## Цикл 9 — карточки новых записей (FE-0077…FE-0137)\n\n';
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
const mdPath = DIR + 'ISSUES.md';
const cur = fs.readFileSync(mdPath, 'utf8');
// replace the counters table at the end
const cnt = `\n## Счётчики (цикл 9; suspected — подмножество по severity, Info входят в градации)\n\n| Серьёзность | Кол-во |\n|---|---|\n| Critical | ${c.critical} |\n| High | ${c.high} | FE-0004, FE-0022, FE-0023, FE-0059, FE-0077, FE-0082 |\n| Medium | ${c.medium} |\n| Low | ${c.low} |\n| Info | ${c.info} |\n| Suspected (подмножество) | ${c.suspected} |\n| **Всего записей** | **${j.issues.length}** |\n`;
// strip old counters table (everything after last '## Счётчики')
const idx = cur.lastIndexOf('## Счётчики');
const base = idx > 0 ? cur.slice(0, idx) : cur;
fs.writeFileSync(mdPath, base + md + cnt);
console.log('ISSUES.md updated:', fresh.length, 'cards');
