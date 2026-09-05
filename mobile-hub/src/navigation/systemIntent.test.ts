import {
  clearPendingPortalPathForTests,
  consumePendingPortalPath,
  rememberSystemIntentDestination,
  routeSystemIntentPath,
} from './systemIntent';

beforeEach(clearPendingPortalPathForTests);

it.each([
  ['https://hubit.zsgp.ru/tasks?view=mine', '/tasks'],
  ['https://hubit.zsgp.ru/tasks?task=task-42', '/tasks/task-42'],
  ['hubit://portal?path=%2Fchat%3Fconversation%3D42', '/chat/42'],
  ['hubit://tasks?create=1', '/tasks/create'],
  ['hubit://tasks?view=mine', '/tasks'],
  ['/mail/inbox', '/mail?folder=inbox'],
  ['hubit://portal?path=%2Fmail%3Fmessage%3Dmessage-7%26mailbox_id%3Dbox-1', '/mail/message-7?mailboxId=box-1'],
  ['https://hubit.zsgp.ru/database?inv_no=INV%2F7&db_id=OBJ-ITINVENT&tab=acts', '/database/INV%2F7?databaseId=OBJ-ITINVENT&tab=acts'],
  ['https://hubit.zsgp.ru/my-files', '/my-files'],
  ['https://hubit.zsgp.ru/company-structure?node=dep%2F1&block=block-1&view=focus', '/company-structure?nodeId=dep%2F1&blockId=block-1'],
  ['https://hubit.zsgp.ru/docflow', '/docflow'],
  ['https://hubit.zsgp.ru/docflow?task=task-1', '/docflow?task=task-1'],
  ['https://hubit.zsgp.ru/warehouse-1c', '/menu'],
  ['https://hubit.zsgp.ru/passwords', '/passwords'],
  ['https://hubit.zsgp.ru/mfu', '/mfu'],
  ['https://hubit.zsgp.ru/dashboard', '/dashboard'],
])('maps a trusted Android intent %s', (input, expected) => {
  expect(routeSystemIntentPath(input)).toBe(expected);
});

it.each([
  'https://evil.example/tasks',
  'javascript:alert(1)',
  '//evil.example/tasks',
  '/api/v1/auth/session',
])('rejects or neutralizes an unsafe Android intent: %s', (input) => {
  const result = routeSystemIntentPath(input);
  expect(['/', '/dashboard']).toContain(result);
});

it('rejects an oversized external intent before query parsing', () => {
  const oversized = `hubit://portal?path=${'%E0%A4%A'.repeat(900)}`;
  expect(routeSystemIntentPath(oversized)).toBe('/');
});

it('remembers the portal destination through login and consumes it once', () => {
  rememberSystemIntentDestination('/web?path=%2Ftasks%3Fview%3Dmine');
  expect(consumePendingPortalPath()).toBe('/tasks?view=mine');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers a native task detail through login as the canonical portal path', () => {
  rememberSystemIntentDestination('/tasks/task%2F42');
  expect(consumePendingPortalPath()).toBe('/tasks?task=task%2F42');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers a native mailbox-scoped message through login as the canonical portal path', () => {
  rememberSystemIntentDestination('/mail/message%2F7?mailboxId=box-1&folder=inbox');
  expect(consumePendingPortalPath()).toBe('/mail?message=message%2F7&mailbox_id=box-1&folder=inbox');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers a native equipment detail through login with its database and tab', () => {
  rememberSystemIntentDestination('/database/INV%2F7?databaseId=OBJ-ITINVENT&tab=history');
  expect(consumePendingPortalPath()).toBe('/database?inv_no=INV%2F7&db_id=OBJ-ITINVENT&tab=history');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers the native My Files screen through login', () => {
  rememberSystemIntentDestination('/my-files');
  expect(consumePendingPortalPath()).toBe('/my-files');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers a native Company Structure focus through login as its portal path', () => {
  rememberSystemIntentDestination('/company-structure?nodeId=dep%2F1&blockId=block-1');
  expect(consumePendingPortalPath()).toBe('/company-structure?node=dep%2F1&block=block-1&view=focus');
  expect(consumePendingPortalPath()).toBe('');
});

it('keeps an internal native Docflow detail through login', () => {
  rememberSystemIntentDestination('/docflow/task-1');
  expect(consumePendingPortalPath()).toBe('/docflow?task=task-1');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers the native Scan Center root through login', () => {
  rememberSystemIntentDestination('/scan-center');
  expect(consumePendingPortalPath()).toBe('/scan-center');
  expect(consumePendingPortalPath()).toBe('');
});

it('canonicalizes an internal native computer detail to its safe web search after login', () => {
  rememberSystemIntentDestination('/computers/AA-BB?q=PC-01');
  expect(consumePendingPortalPath()).toBe('/computers?q=PC-01');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers the native Passwords metadata root without entry data', () => {
  rememberSystemIntentDestination('/passwords');
  expect(consumePendingPortalPath()).toBe('/passwords');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers the native Groups Access root without filters or AD data', () => {
  rememberSystemIntentDestination('/groups-access');
  expect(consumePendingPortalPath()).toBe('/groups-access');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers the native Warehouse 1C root without query or catalog data', () => {
  rememberSystemIntentDestination('/warehouse-1c');
  expect(consumePendingPortalPath()).toBe('/warehouse-1c');
  expect(consumePendingPortalPath()).toBe('');
});

it('remembers the native MFU root without device identifiers', () => {
  rememberSystemIntentDestination('/mfu');
  expect(consumePendingPortalPath()).toBe('/mfu');
  expect(consumePendingPortalPath()).toBe('');
});
