import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const data = JSON.parse(fs.readFileSync(`${DIR}/ISSUES.json`, 'utf8'));
if (!data.issues.some((i) => i.id === 'FE-0325')) {
  data.issues.push({
    id: 'FE-0325',
    title: 'PWA offline: холодная перезагрузка зависает на «Загружаем раздел…» — AuthContext бесконечно ретраит refresh',
    category: 'Reliability/PWA',
    severity: 'Medium',
    status: 'Confirmed',
    page: 'все маршруты (проверено /login)',
    file: 'WEB-itinvent/frontend/src/contexts/AuthContext.jsx',
    lines: '310-339',
    relatedFiles: [
      { file: 'WEB-itinvent/frontend/src/main.jsx', lines: '66-84' },
      { file: 'WEB-itinvent/frontend/public/sw.js', lines: '608-626' },
    ],
    verification: ['static', 'tooling'],
    evidence: [
      'live local E2E (cycle 13): built app served by vite preview :5221, SW active and controls the page, app-shell/assets cached; offline reload /login stays on «Загружаем раздел… | Подготавливаем интерфейс HUB-IT» at 10/30/55/65 s.',
      'AuthContext verifySession: error with HTTP status 0 (offline) is not a definitive 401/403, so scheduleRetry repeats forever with max 30 s delay; setLoading(false) is never called on this path (AuthContext.jsx:310-339).',
      'SW itself serves the shell offline (200), so the hang is in auth recovery, not in the service worker navigation fallback.'
    ],
    impact: 'Пользователь PWA/Desktop после холодного запуска без сети видит бесконечный загрузчик вместо экрана входа/офлайн-режима; приложение кажется зависшим.',
    recommendation: 'При navigator.onLine=false или после N повторов status=0 завершать recovery с loading=false и показывать офлайн-экран/вход; добавить общий таймаут recovery и тест offline cold reload.',
    regressionRisk: 'medium',
    related: ['FE-0084', 'FE-0085', 'FE-0070'],
    originalClaim: 'PWA offline: холодная перезагрузка зависает на «Загружаем раздел…» — AuthContext бесконечно ретраит refresh',
    originalEvidence: [
      'live local E2E: offline reload /login stuck at loader for 65+ seconds while SW serves the app shell.'
    ],
    currentConclusion: 'Подтверждено live на изолированном стенде: SW отдаёт shell, но AuthContext не завершает recovery при status=0 и держит loading=true.',
    reverificationHistory: [
      { cycle: 13, date: '2026-11-23', verdict: 'confirmed', note: 'Live offline cold reload: loader >65 s; SW active; auth retry loop status=0.', sourceFile: 'manual-live' }
    ],
  });
}

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
fs.writeFileSync(`${DIR}/ISSUES.json`, JSON.stringify(data, null, 2) + '\n', 'utf8');
const summaryPath = `${DIR}/evidence/cycle13/cycle13_summary.json`;
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
summary.statuses = counts;
summary.severity = severity;
summary.total = data.issues.length;
summary.newFindings = ['FE-0325'];
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ counts, severity, total: data.issues.length }, null, 2));
