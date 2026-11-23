import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

const routes = [
  ['/', 'Redirect', '—', 'None', 'RootRoute -> first accessible'],
  ['/login', 'Public', 'Auth', 'E2E', 'real 2FA setup/login (cycle14)'],
  ['/shared-files/:token', 'Public/Param', 'Public share', 'E2E', 'access + download + revoke + forced expiry (cycle17)'],
  ['/shared-folders/:token', 'Public/Param', 'Public share', 'Functional', '2000-file large folder (cycle13)'],
  ['/about', 'Standalone', '—', 'Functional', 'Перейти в HUB'],
  ['/dashboard', 'Standalone', 'API', 'Functional', 'real greeting/task/mail/chat counters (cycle17)'],
  ['/feed', 'Standalone', 'API', 'E2E', 'create post -> reload (cycle16/17)'],
  ['/tickets', 'Standalone', 'API', 'Functional', 'create dialog'],
  ['/tasks', 'Standalone', 'API', 'E2E', 'create + edit + checklist -> reload (cycle16/17)'],
  ['/chat', 'Standalone', 'WS/API', 'E2E', 'notes send -> reload; cross-tab dedupe (cycle16/17)'],
  ['/database', 'Standalone', 'SQL Server', 'Blocked', 'equipment APIs 500/503; no SQL/branch data'],
  ['/networks', 'Standalone', 'API', 'Functional', '10k ports mobile'],
  ['/vcs', 'Standalone', 'API', 'Functional', 'add terminal dialog'],
  ['/mfu', 'Standalone', '1C/API', 'Functional', 'error/empty state'],
  ['/monitoring', 'Standalone', 'SNMP/API', 'Functional', 'empty/search state'],
  ['/computers', 'Standalone', 'API', 'Smoke', 'empty state: 0 PCs; no data fixtures'],
  ['/scan-center', 'Standalone', 'Scan API', 'Functional', 'queue tab'],
  ['/voice', 'Standalone', 'Voice API', 'Functional', 'tab + refresh'],
  ['/dlp', 'Standalone', 'DLP API', 'Functional', 'refresh'],
  ['/file-egress', 'Standalone', 'DLP API', 'Functional', 'refresh'],
  ['/statistics', 'Standalone', 'API', 'Smoke', 'controls render; 0 records / no data'],
  ['/mail', 'Standalone', 'Exchange EWS', 'Blocked', 'EWS, not IMAP/SMTP; credentials gate; MAIL_MODULE_ENABLED=0'],
  ['/menu', 'Standalone', '—', 'Functional', 'navigate Tasks'],
  ['/address-book', 'Standalone', 'API', 'Functional', 'refresh/empty'],
  ['/company-structure', 'Standalone', 'API', 'Functional', 'tabs + refresh'],
  ['/warehouse-1c', 'Standalone', '1C', 'Functional', 'balances tab'],
  ['/it/objects', 'Standalone', 'API', 'Functional', 'retry/error'],
  ['/construction', 'Standalone', '1C/SQL', 'Blocked', '502: BUH20_1C creds absent'],
  ['/docflow', 'Standalone', '1C/API', 'Functional', 'connect dialog'],
  ['/passwords', 'Standalone', 'API', 'Functional', 'new record dialog'],
  ['/groups-access', 'Standalone', 'AD/API', 'Functional', 'refresh'],
  ['/my-files', 'Standalone', 'API/storage', 'E2E', 'upload + search + reload + preview (cycle16/17)'],
  ['/kb/manage', 'Standalone', 'KB API', 'E2E', 'create article -> reload -> reopen (cycle17)'],
  ['/help', 'Standalone', '—', 'Functional', 'open article'],
  ['/profile', 'Standalone', 'API', 'Functional', 'expand service data'],
  ['/chat/open', 'Param/Child', 'API', 'Functional', 'invalid link -> /chat'],
  ['/networks/:branchId', 'Param/Child', 'API', 'Functional', 'branch selected'],
  ['/it/requests/:requestRef?', 'Param/Child', '1C', 'Functional', 'История tab'],
  ['/it/objects/:objectRef', 'Param/Child', 'API', 'Blocked', 'IT objects DB unavailable'],
  ['/construction/objects/:objectId', 'Param/Child', '1C/SQL', 'Functional', 'managed synthetic object renders (cycle17)'],
  ['/construction/objects/:objectId/directions/:groupRef', 'Param/Child', '1C/SQL', 'E2E', 'work plan saved + F5 draft loss (cycle17)'],
  ['/construction/objects/:objectId/directions/:groupRef/requests/:requestRef', 'Param/Child', '1C/SQL', 'Blocked', 'no 1C request fixture'],
  ['/construction/objects/:objectId/requests/:requestRef', 'Param/Child', '1C/SQL', 'Blocked', 'no 1C request fixture'],
  ['/my-files/edit/:fileId', 'Param/Child', 'ONLYOFFICE', 'Blocked', 'editor server unavailable'],
  ['/mail/compose', 'Param/Child', 'Exchange EWS', 'Blocked', 'credentials gate; no EWS test server'],
  ['/settings/:section?', 'Param/Child', 'API', 'Functional', 'app section'],
  ['/admin/:section?', 'Param/Child', 'API', 'E2E', 'create synthetic user -> reload (cycle16/17)'],
  ['/dashboard/news', 'Redirect', '—', 'None', 'LegacyNewsRedirect'],
  ['/ad-users', 'Redirect', '—', 'None', '-> /admin/ad-users'],
  ['/kb', 'Redirect', '—', 'None', '-> /help'],
  ['*', 'Redirect', '—', 'None', 'HomeRedirect'],
];
const counts = { E2E: 0, Functional: 0, Smoke: 0, Blocked: 0, None: 0 };
for (const r of routes) counts[r[3]] += 1;
const userVisible = routes.filter((r) => r[3] !== 'None').length;
const pct = (n) => ((n / userVisible) * 100).toFixed(1);
const rows = routes.map(([path, category, integration, level, evidence]) => `| \`${path}\` | ${category} | ${integration} | ${level} | ${evidence} |`).join('\n');
const block = `# COVERAGE MATRIX — route inventory (cycle 17)

> Исторические таблицы ниже сохранены. Актуальная инвентаризация построена из \`App.jsx\`;
> 36 action-сценариев циклов 13–15 не считаются 100% покрытием.

## Полная карта маршрутов

| Маршрут | Категория | Интеграция | Уровень | Доказательство |
|---|---|---|---|---|
${rows}

## Реальный знаменатель

- Всего route entry в \`App.jsx\`: **51**.
- Redirect/service: **5** (\`/\`, \`/dashboard/news\`, \`/ad-users\`, \`/kb\`, \`*\`).
- Пользовательских route entry: **46**.
- 3 public, 31 standalone protected, 12 parameterized/child.
- 12 admin sections, 6 settings tabs.

## Покрытие (cycle 17)

| Уровень | Кол-во | Доля от 46 |
|---|---|---|
| E2E | ${counts.E2E} | ${pct(counts.E2E)}% |
| Functional (без E2E) | ${counts.Functional} | ${pct(counts.Functional)}% |
| Functional + E2E | ${counts.Functional + counts.E2E} | ${pct(counts.Functional + counts.E2E)}% |
| Smoke-only | ${counts.Smoke} | ${pct(counts.Smoke)}% |
| Blocked (среда) | ${counts.Blocked} | ${pct(counts.Blocked)}% |
| Redirect | ${counts.None} | — |

- **Functional/E2E: ${counts.Functional + counts.E2E}/46 = ${pct(counts.Functional + counts.E2E)}%**.
- **E2E: ${counts.E2E}/46 = ${pct(counts.E2E)}%**.
- Smoke-only: \`/computers\`, \`/statistics\` — empty states без данных; не считаются проверенными с данными.
- Blocked: 8 entry, включая \`/mail\`, \`/mail/compose\`, \`/construction\`, 2 request-child, \`/database\`, \`/my-files/edit\`, \`/it/objects/:objectRef\`.

## Cycle 17 — воспроизводимость и новые E2E

| Проверка | Результат |
|---|---|
| Five E2E с нуля на clean b95c4cac | 5/5 PASS (feed, tasks, chat, myFiles, admin) |
| Public file share | access 200, download 200, revoke 204 -> 404, forced expiry -> 404/expired page |
| KB article | create -> reload -> reopen PASS |
| Construction workspace | managed object + work plan -> reload PASS; F5 draft lost without prompt |
| Dashboard | real counters render, no API errors |
| Statistics / Computers | controls render, 0 records; no data fixtures |
| Database | equipment APIs 500/503; blocked |
| My Files editor | ONLYOFFICE server unavailable; blocked |
| IT object detail | objects DB unavailable; blocked |

## Явно не покрыто функционально

\`/computers\`, \`/statistics\` (empty), 8 blocked entry; 10 из 12 admin sections
(users — E2E; departments — read-only); 5 из 6 settings tabs (app — functional).

## Уровни

- **Smoke** — страница открылась и отрисовала shell; данных нет.
- **Functional** — выполнено главное действие/состояние, результат проверен.
- **E2E** — UI → API → SQLite/WS → повторное открытие.
- **Blocked** — среда не позволяет выполнить сценарий; это ограничение, не PASS.
`;
const old = fs.readFileSync(`${DIR}/COVERAGE_MATRIX.md`, 'utf8');
const marker = '# Историческая матрица (циклы 1–15)';
const idx = old.indexOf(marker);
const tail = idx >= 0 ? old.slice(idx) : '';
fs.writeFileSync(`${DIR}/COVERAGE_MATRIX.md`, block + (tail ? `\n---\n\n${tail}` : ''), 'utf8');
console.log(JSON.stringify({ counts, userVisible, total: routes.length, historyKept: Boolean(tail) }, null, 2));
