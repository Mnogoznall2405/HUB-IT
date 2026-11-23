import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

const routes = [
  ['/', 'Redirect', '—', 'None', 'RootRoute -> first accessible'],
  ['/login', 'Public', 'Auth', 'E2E', 'real 2FA setup/login'],
  ['/shared-files/:token', 'Public/Param', 'Public share', 'Functional', 'invalid-token error + retry'],
  ['/shared-folders/:token', 'Public/Param', 'Public share', 'Functional', '2000-file large folder (cycle13)'],
  ['/about', 'Standalone', '—', 'Functional', 'Перейти в HUB'],
  ['/dashboard', 'Standalone', '—', 'Smoke', 'rendered'],
  ['/feed', 'Standalone', 'API', 'E2E', 'create post -> reload'],
  ['/tickets', 'Standalone', 'API', 'Functional', 'create dialog'],
  ['/tasks', 'Standalone', 'API', 'E2E', 'create task -> reload'],
  ['/chat', 'Standalone', 'WS/API', 'E2E', 'offline send/reconnect'],
  ['/database', 'Standalone', 'SQL Server', 'Smoke', 'rendered'],
  ['/networks', 'Standalone', 'API', 'Functional', '10k ports mobile'],
  ['/vcs', 'Standalone', 'API', 'Functional', 'add terminal dialog'],
  ['/mfu', 'Standalone', '1C/API', 'Functional', 'error/empty state'],
  ['/monitoring', 'Standalone', 'SNMP/API', 'Functional', 'empty/search state'],
  ['/computers', 'Standalone', 'API', 'Smoke', 'rendered'],
  ['/scan-center', 'Standalone', 'Scan API', 'Functional', 'queue tab'],
  ['/voice', 'Standalone', 'Voice API', 'Functional', 'tab + refresh'],
  ['/dlp', 'Standalone', 'DLP API', 'Functional', 'refresh'],
  ['/file-egress', 'Standalone', 'DLP API', 'Functional', 'refresh'],
  ['/statistics', 'Standalone', 'API', 'Smoke', 'rendered'],
  ['/mail', 'Standalone', 'Mail provider', 'Smoke', 'credentials gate'],
  ['/menu', 'Standalone', '—', 'Functional', 'navigate Tasks'],
  ['/address-book', 'Standalone', 'API', 'Functional', 'refresh/empty'],
  ['/company-structure', 'Standalone', 'API', 'Functional', 'tabs + refresh'],
  ['/warehouse-1c', 'Standalone', '1C', 'Functional', 'balances tab'],
  ['/it/objects', 'Standalone', 'API', 'Functional', 'retry/error'],
  ['/construction', 'Standalone', '1C/SQL', 'Functional', 'create dialog'],
  ['/docflow', 'Standalone', '1C/API', 'Functional', 'connect dialog'],
  ['/passwords', 'Standalone', 'API', 'Functional', 'new record dialog'],
  ['/groups-access', 'Standalone', 'AD/API', 'Functional', 'refresh'],
  ['/my-files', 'Standalone', 'API/storage', 'E2E', 'upload -> reload -> search'],
  ['/kb/manage', 'Standalone', 'KB API', 'Smoke', 'rendered? not exercised'],
  ['/help', 'Standalone', '—', 'Functional', 'open article'],
  ['/profile', 'Standalone', 'API', 'Functional', 'expand service data'],
  ['/chat/open', 'Param/Child', 'API', 'Functional', 'invalid link -> /chat'],
  ['/networks/:branchId', 'Param/Child', 'API', 'Functional', 'branch selected'],
  ['/it/requests/:requestRef?', 'Param/Child', '1C', 'Functional', 'История tab'],
  ['/it/objects/:objectRef', 'Param/Child', 'API', 'Smoke', 'not exercised'],
  ['/construction/objects/:objectId', 'Param/Child', '1C/SQL', 'Smoke', 'not exercised'],
  ['/construction/objects/:objectId/directions/:groupRef', 'Param/Child', '1C/SQL', 'Smoke', 'not exercised'],
  ['/construction/objects/:objectId/directions/:groupRef/requests/:requestRef', 'Param/Child', '1C/SQL', 'Smoke', 'not exercised'],
  ['/construction/objects/:objectId/requests/:requestRef', 'Param/Child', '1C/SQL', 'Smoke', 'not exercised'],
  ['/my-files/edit/:fileId', 'Param/Child', 'ONLYOFFICE', 'Smoke', 'editor error state'],
  ['/mail/compose', 'Param/Child', 'Mail provider', 'Smoke', 'not exercised'],
  ['/settings/:section?', 'Param/Child', 'API', 'Functional', 'app section'],
  ['/admin/:section?', 'Param/Child', 'API', 'E2E', 'create synthetic user -> reload'],
  ['/dashboard/news', 'Redirect', '—', 'None', 'LegacyNewsRedirect'],
  ['/ad-users', 'Redirect', '—', 'None', '-> /admin/ad-users'],
  ['/kb', 'Redirect', '—', 'None', '-> /help'],
  ['*', 'Redirect', '—', 'None', 'HomeRedirect'],
];
const counts = { E2E: 0, Functional: 0, Smoke: 0, None: 0 };
for (const r of routes) counts[r[3]] += 1;
const userVisible = routes.filter((r) => r[3] !== 'None').length;
const rows = routes.map(([path, category, integration, level, evidence]) => `| \`${path}\` | ${category} | ${integration} | ${level} | ${evidence} |`).join('\n');
const block = `# COVERAGE MATRIX — route inventory (cycle 16)

> Старые таблицы ниже — исторические (циклы 1–15). Актуальная инвентаризация построена
> непосредственно из \`App.jsx\` (51 route entry) и не считает 36 сценариев 100% покрытием.

## Полная карта маршрутов

| Маршрут | Категория | Интеграция | Уровень | Доказательство |
|---|---|---|---|---|
${rows}

## Реальный знаменатель

- Всего route entry в \`App.jsx\`: **51**.
- Redirect/service: **5** (\`/\`, \`/dashboard/news\`, \`/ad-users\`, \`/kb\`, \`*\`).
- Пользовательских route entry: **46**.
- Первичные категории: 3 public, 31 standalone protected, 12 parameterized/child.
- Вложенные разделы: 12 admin sections (\`users, departments, ad-users, references, ai-bots, sessions, my-files, feedback, hub-desktop, work-schedules, chat-groups, system\`) и 6 settings tabs (\`appearance, notifications, ai, security, app, about\`).

## Покрытие (не проценты от 36)

| Уровень | Кол-во | Доля от 46 user-visible |
|---|---|---|
| E2E | ${counts.E2E} | ${(counts.E2E / userVisible * 100).toFixed(1)}% |
| Functional (включая E2E) | ${counts.E2E + counts.Functional} | ${((counts.E2E + counts.Functional) / userVisible * 100).toFixed(1)}% |
| Smoke | ${counts.Smoke} | ${(counts.Smoke / userVisible * 100).toFixed(1)}% |
| None/redirect | ${counts.None} | — |

- **Functional/E2E: ${counts.E2E + counts.Functional}/46 = ${((counts.E2E + counts.Functional) / userVisible * 100).toFixed(1)}%**, не 100%.
- **E2E: ${counts.E2E}/46 = ${(counts.E2E / userVisible * 100).toFixed(1)}%**.
- **Smoke-only/none: ${counts.Smoke + counts.None}** (включая redirects).
- Admin sections: 2/12 functional (users, departments); settings tabs: 1/6 functional (app).

## Явно не покрыто функционально

\`/dashboard\`, \`/database\`, \`/computers\`, \`/statistics\`, \`/mail\`, \`/kb/manage\`,
\`/my-files/edit/:fileId\`, \`/it/objects/:objectRef\`, \`/mail/compose\`,
\`/construction/objects/:objectId\` и все 4 construction child routes;
10 из 12 admin sections; 5 из 6 settings tabs.

## Уровни

- **Smoke** — страница открылась и отрисовала базовый shell.
- **Functional** — выполнено главное действие/состояние (таб, refresh, диалог, error-state), результат проверен.
- **E2E** — UI → API → SQLite/WS → повторное открытие: login/2FA, feed post, task create, chat offline send, my-files upload, admin user create.
`;

const old = fs.existsSync(`${DIR}/COVERAGE_MATRIX.md`) ? fs.readFileSync(`${DIR}/COVERAGE_MATRIX.md`, 'utf8') : '';
const historical = old.includes('# COVERAGE MATRIX') ? '' : `\n\n---\n\n# Историческая матрица (циклы 1–15)\n\n${old}`;
fs.writeFileSync(`${DIR}/COVERAGE_MATRIX.md`, block + historical, 'utf8');
console.log(JSON.stringify({ counts, userVisible, total: routes.length }, null, 2));
