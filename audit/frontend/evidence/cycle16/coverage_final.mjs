import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

const routes = [
  ['/', 'Redirect', '—', 'None', 'RootRoute -> first accessible'],
  ['/login', 'Public', 'Auth', 'E2E', 'real 2FA setup/login (cycle14)'],
  ['/shared-files/:token', 'Public/Param', 'Public share', 'Functional', 'invalid-token error + retry'],
  ['/shared-folders/:token', 'Public/Param', 'Public share', 'Functional', '2000-file large folder (cycle13)'],
  ['/about', 'Standalone', '—', 'Functional', 'Перейти в HUB'],
  ['/dashboard', 'Standalone', '—', 'Smoke', 'rendered'],
  ['/feed', 'Standalone', 'API', 'E2E', 'create post -> reload (cycle16)'],
  ['/tickets', 'Standalone', 'API', 'Functional', 'create dialog'],
  ['/tasks', 'Standalone', 'API', 'E2E', 'create + edit + checklist -> reload (cycle16)'],
  ['/chat', 'Standalone', 'WS/API', 'E2E', 'notes send -> reload; cross-tab dedup (cycle16); offline send (cycle13)'],
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
  ['/mail', 'Standalone', 'Mail provider', 'Blocked', 'corporate password gate; no test mailbox'],
  ['/menu', 'Standalone', '—', 'Functional', 'navigate Tasks'],
  ['/address-book', 'Standalone', 'API', 'Functional', 'refresh/empty'],
  ['/company-structure', 'Standalone', 'API', 'Functional', 'tabs + refresh'],
  ['/warehouse-1c', 'Standalone', '1C', 'Functional', 'balances tab'],
  ['/it/objects', 'Standalone', 'API', 'Functional', 'retry/error'],
  ['/construction', 'Standalone', '1C/SQL', 'Blocked', '502: BUH20_1C creds absent'],
  ['/docflow', 'Standalone', '1C/API', 'Functional', 'connect dialog'],
  ['/passwords', 'Standalone', 'API', 'Functional', 'new record dialog'],
  ['/groups-access', 'Standalone', 'AD/API', 'Functional', 'refresh'],
  ['/my-files', 'Standalone', 'API/storage', 'E2E', 'upload + search + reload + preview (cycle16)'],
  ['/kb/manage', 'Standalone', 'KB API', 'Smoke', 'rendered? not exercised'],
  ['/help', 'Standalone', '—', 'Functional', 'open article'],
  ['/profile', 'Standalone', 'API', 'Functional', 'expand service data'],
  ['/chat/open', 'Param/Child', 'API', 'Functional', 'invalid link -> /chat'],
  ['/networks/:branchId', 'Param/Child', 'API', 'Functional', 'branch selected'],
  ['/it/requests/:requestRef?', 'Param/Child', '1C', 'Functional', 'История tab'],
  ['/it/objects/:objectRef', 'Param/Child', 'API', 'Smoke', 'not exercised'],
  ['/construction/objects/:objectId', 'Param/Child', '1C/SQL', 'Blocked', 'no configured object + 1C absent'],
  ['/construction/objects/:objectId/directions/:groupRef', 'Param/Child', '1C/SQL', 'Blocked', 'no fixture'],
  ['/construction/objects/:objectId/directions/:groupRef/requests/:requestRef', 'Param/Child', '1C/SQL', 'Blocked', 'no fixture'],
  ['/construction/objects/:objectId/requests/:requestRef', 'Param/Child', '1C/SQL', 'Blocked', 'no fixture'],
  ['/my-files/edit/:fileId', 'Param/Child', 'ONLYOFFICE', 'Smoke', 'editor error state'],
  ['/mail/compose', 'Param/Child', 'Mail provider', 'Blocked', 'credentials gate'],
  ['/settings/:section?', 'Param/Child', 'API', 'Functional', 'app section'],
  ['/admin/:section?', 'Param/Child', 'API', 'E2E', 'create synthetic user -> reload (cycle16)'],
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
const block = `# COVERAGE MATRIX — route inventory (cycle 16)

> Старые таблицы ниже — исторические (циклы 1–15). Актуальная инвентаризация построена
> непосредственно из \`App.jsx\` (51 route entry) и не считает 36 сценариев 100% покрытием.

## Полная карта маршрутов

| Маршрут | Категория | Интеграция | Уровень | Доказательство |
|---|---|---|---|---|
${rows}

## Реальный знаменатель (cycle 16)

- Всего route entry в \`App.jsx\`: **51**.
- Redirect/service: **5** (\`/\`, \`/dashboard/news\`, \`/ad-users\`, \`/kb\`, \`*\`).
- Пользовательских route entry: **46**.
- Первичные категории: 3 public, 31 standalone protected, 12 parameterized/child.
- Вложенные разделы: 12 admin sections (\`users, departments, ad-users, references, ai-bots, sessions, my-files, feedback, hub-desktop, work-schedules, chat-groups, system\`) и 6 settings tabs (\`appearance, notifications, ai, security, app, about\`).

## Покрытие

| Уровень | Кол-во | Доля от 46 user-visible |
|---|---|---|
| E2E | ${counts.E2E} | ${pct(counts.E2E)}% |
| Functional (без E2E) | ${counts.Functional} | ${pct(counts.Functional)}% |
| Functional + E2E | ${counts.Functional + counts.E2E} | ${pct(counts.Functional + counts.E2E)}% |
| Smoke-only | ${counts.Smoke} | ${pct(counts.Smoke)}% |
| Blocked (среда) | ${counts.Blocked} | ${pct(counts.Blocked)}% |
| Redirect | ${counts.None} | — |

- **Functional/E2E: ${counts.Functional + counts.E2E}/46 = ${pct(counts.Functional + counts.E2E)}%**, не 100%.
- **E2E: ${counts.E2E}/46 = ${pct(counts.E2E)}%**.
- **Smoke-only + blocked: ${counts.Smoke + counts.Blocked}/46 = ${pct(counts.Smoke + counts.Blocked)}%** без функционального действия.
- 36 action-сценариев циклов 13–15 покрывают 32 route entry; ещё 14 entry не имеют functional/E2E-действия.
- Admin sections: 2/12 functional (users, departments); settings tabs: 1/6 functional (app).

## Cycle 16 — полные E2E (UI → API → SQLite → повторное открытие)

| Сценарий | Маршрут | Что проверено | Результат |
|---|---|---|---|
| Публикация в ленте | \`/feed\` | title + body → Опубликовать → reload | PASS, запись в списке после reload |
| Задача + чек-лист | \`/tasks\` | create с исполнителем → edit описания → чек-лист → reload | PASS, изменения сохранены |
| Заметки чата | \`/chat\` | отправка → вторая вкладка → reload → API messages | PASS, 2 сообщения без дублей |
| Загрузка файла | \`/my-files\` | upload session → reload → поиск → preview содержимого | PASS, контент сохранён |
| Синтетический пользователь | \`/admin/users\` | create → reload → поиск | PASS, пользователь в списке |
| Refresh-ротация | API | lost response / grace / 3 parallel | PASS (family revoke подтверждён) |

## Явно не покрыто функционально

\`/dashboard\`, \`/database\`, \`/computers\`, \`/statistics\`, \`/kb/manage\`,
\`/my-files/edit/:fileId\`, \`/it/objects/:objectRef\`;
10 из 12 admin sections; 5 из 6 settings tabs.
Blocked: \`/mail\`, \`/mail/compose\`, \`/construction\` и 4 construction child routes.

## Уровни

- **Smoke** — страница открылась и отрисовала базовый shell.
- **Functional** — выполнено главное действие/состояние (таб, refresh, диалог, error-state), результат проверен.
- **E2E** — UI → API → SQLite/WS → повторное открытие.
- **Blocked** — среда не позволяет выполнить сценарий (нет интеграции/fixture); зафиксировано как ограничение, не как PASS.
`;
const old = fs.readFileSync(`${DIR}/COVERAGE_MATRIX.md`, 'utf8');
const marker = '# Историческая матрица (циклы 1–15)';
const idx = old.indexOf(marker);
const tail = idx >= 0 ? old.slice(idx) : '';
fs.writeFileSync(`${DIR}/COVERAGE_MATRIX.md`, block + (tail ? `\n---\n\n${tail}` : ''), 'utf8');
console.log(JSON.stringify({ counts, userVisible, total: routes.length, historyKept: Boolean(tail) }, null, 2));
