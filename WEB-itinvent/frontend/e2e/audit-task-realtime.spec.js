import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'Only isolated HTTP/WebSocket fixtures');
const user = { id: 7, username: 'audit', role: 'admin', is_active: true };
const task = (n, version = 'INITIAL') => ({
  id: `task-${n}`, title: `${version} TASK ${n}`, status: 'new', priority: 'normal',
  created_by_user_id: 7, assignee_user_ids: [7], assignee_user_id: 7, controller_user_id: 7,
  created_at: '2026-10-19T05:00:00Z', updated_at: '2026-10-19T05:00:00Z',
  checklist: [], attachments: [], observers: [],
});

async function prepare(page, count = 25) {
  const state = {
    tasks: new Map(Array.from({ length: count }, (_, n) => [n + 1, task(n + 1)])),
    reads: [], sockets: [], listReads: 0, held: [], hold: new Set(), fail: new Set(), active: 0, maxActive: 0,
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript((identity) => {
    localStorage.setItem('user', JSON.stringify(identity));
    localStorage.setItem('hubit:desktop-handoff', 'never');
    window.auditTaskChanges = 0;
    window.addEventListener('hub-realtime-task-changed', () => { window.auditTaskChanges += 1; });
  }, user);
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: user }));
  await page.route('**/api/v1/hub/tasks*', (route) => {
    state.listReads += 1;
    return route.fulfill({ json: { items: [...state.tasks.values()], total: state.tasks.size, meta: {} } });
  });
  await page.route('**/api/v1/hub/tasks/*', (route) => {
    const n = Number(new URL(route.request().url()).pathname.match(/task-(\d+)$/)?.[1]);
    state.reads.push(n);
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    const record = {
      n, json: state.tasks.get(n),
      async complete(json = this.json, status = 200) {
        try { await route.fulfill({ status, json }); } finally { state.active -= 1; }
      },
    };
    if (state.hold.has(n)) { state.held.push(record); return; }
    return state.fail.has(n) ? record.complete({ detail: 'fixture unavailable' }, 503) : record.complete();
  });
  await page.routeWebSocket('**/*', (socket) => {
    const url = new URL(socket.url());
    if (url.pathname.endsWith('/chat/hub-realtime/ws')) {
      state.sockets.push(socket);
      socket.send(JSON.stringify({ type: 'hub.realtime.connected', payload: { connection_id: `audit-${state.sockets.length}` } }));
      socket.onMessage((raw) => {
        if (JSON.parse(raw).type === 'hub.realtime.ping') socket.send(JSON.stringify({ type: 'hub.realtime.pong' }));
      });
    } else if (url.hostname === '127.0.0.1' && url.port === '5220' && url.pathname === '/') socket.connectToServer();
    else socket.close();
  });
  await page.goto('/tasks?task_mode=list&task_view=all');
  await expect(page.getByRole('table', { name: 'Список задач' })).toContainText(`INITIAL TASK ${count}`);
  await expect.poll(() => page.evaluate(async () => {
    const { hubRealtimeSocket } = await import('/src/lib/hubRealtimeSocket.js');
    return hubRealtimeSocket.isStableConnection();
  }), { timeout: 15000 }).toBe(true);
  // Auth restoration may reconnect; wait for the current socket to be stable.
  await expect(page.getByRole('table', { name: 'Список задач' })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  return state;
}

async function deliver(page, state, envelopes, received = envelopes.length) {
  const before = await page.evaluate(() => window.auditTaskChanges);
  for (const envelope of envelopes) state.sockets.at(-1).send(JSON.stringify(envelope));
  await expect.poll(() => page.evaluate(() => window.auditTaskChanges)).toBe(before + received);
  // Advance the actual 75 ms debounce only after WebSocket messages arrive.
  await page.clock.runFor(100);
}

async function update(page, state, numbers, eventPrefix = 'change', version = 'UPDATED') {
  const envelopes = [];
  for (const n of numbers) {
    state.tasks.set(n, task(n, version));
    envelopes.push({ type: 'tasks.task.updated', payload: {
      event_id: `${eventPrefix}-${n}`, task_id: `task-${n}`, operation: 'updated',
    } });
  }
  await deliver(page, state, envelopes);
}

const table = (page) => page.getByRole('table', { name: 'Список задач' });
const numbers = (count, start = 1) => Array.from({ length: count }, (_, n) => n + start);

test('a burst of 25 task changes updates every visible task without a list reload', async ({ page }) => {
  const state = await prepare(page);
  const listsBefore = state.listReads;
  await update(page, state, numbers(25));
  await expect(table(page).getByText('UPDATED TASK 25', { exact: true })).toBeVisible();
  await expect.poll(() => new Set(state.reads).size).toBe(25);
  await expect(table(page).getByTestId(/^tasks-list-row-task-/)).toHaveCount(25);
  for (let n = 1; n <= 25; n += 1) await expect(table(page).getByText(`UPDATED TASK ${n}`, { exact: true })).toBeAttached();
  expect(state.listReads).toBe(listsBefore);
});

test('overlapping bursts drain all IDs with at most ten item reads in flight', async ({ page }) => {
  const state = await prepare(page);
  const listsBefore = state.listReads;
  numbers(10).forEach((n) => state.hold.add(n));
  await update(page, state, numbers(10));
  await expect.poll(() => state.held.length).toBe(10);
  await update(page, state, numbers(15, 11), 'second');
  expect(state.active).toBe(10);
  expect(state.reads).toHaveLength(10);
  await Promise.all(state.held.map((record) => record.complete()));
  await expect(table(page).getByText('UPDATED TASK 25', { exact: true })).toBeAttached();
  await expect.poll(() => new Set(state.reads).size).toBe(25);
  expect(state.maxActive).toBeLessThanOrEqual(10);
  expect(state.listReads).toBe(listsBefore);
});

test('duplicate delivery and repeated task IDs coalesce into one current item read', async ({ page }) => {
  const state = await prepare(page);
  state.tasks.set(1, task(1, 'LATEST'));
  const event = (id) => ({ type: 'tasks.task.updated', payload: { event_id: id, task_id: 'task-1', operation: 'updated' } });
  await deliver(page, state, [event('duplicate'), event('duplicate'), event('same-task-new-event')], 2);
  await expect(table(page).getByText('LATEST TASK 1', { exact: true })).toBeVisible();
  expect(state.reads).toEqual([1]);
});

test('an update arriving during a read cannot be overwritten by that old response', async ({ page }) => {
  const state = await prepare(page);
  state.hold.add(1);
  await update(page, state, [1], 'old', 'OBSOLETE');
  await expect.poll(() => state.held.length).toBe(1);
  await update(page, state, [1], 'new', 'LATEST');
  await state.held[0].complete();
  await expect.poll(() => state.held.length).toBe(2);
  await expect(table(page).getByText('INITIAL TASK 1', { exact: true })).toBeVisible();
  await expect(table(page).getByText('OBSOLETE TASK 1', { exact: true })).toHaveCount(0);
  await state.held[1].complete();
  await expect(table(page).getByText('LATEST TASK 1', { exact: true })).toBeVisible();
});

test('one failed item does not discard the rest and reports incomplete refresh', async ({ page }) => {
  const state = await prepare(page);
  state.fail.add(1);
  await update(page, state, numbers(25));
  await expect(table(page).getByText('UPDATED TASK 25', { exact: true })).toBeAttached();
  await expect(table(page).getByText('INITIAL TASK 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Не удалось обновить часть задач. Обновите список, чтобы получить актуальные данные.', { exact: true })).toBeVisible();
  await expect.poll(() => new Set(state.reads).size).toBe(25);
});

test('deletion snapshot supersedes queued updates and cannot resurrect a deleted row', async ({ page }) => {
  const state = await prepare(page);
  const listsBefore = state.listReads;
  numbers(10).forEach((n) => state.hold.add(n));
  await update(page, state, numbers(25));
  await expect.poll(() => state.held.length).toBe(10);
  state.tasks.delete(1);
  await deliver(page, state, [{ type: 'tasks.task.deleted', payload: { event_id: 'delete-1', task_id: 'task-1', operation: 'deleted' } }]);
  await Promise.all(state.held.map((record) => record.complete()));
  await expect(table(page).getByTestId('tasks-list-row-task-1')).toHaveCount(0);
  await expect(table(page).getByTestId(/^tasks-list-row-task-/)).toHaveCount(24);
  expect(state.listReads).toBe(listsBefore + 1);
  expect(state.reads).toHaveLength(10);
});

test('WebSocket reconnect restores a snapshot after an interrupted update burst', async ({ page }) => {
  const state = await prepare(page);
  const socketsBefore = state.sockets.length;
  const listsBefore = state.listReads;
  numbers(10).forEach((n) => state.hold.add(n));
  await update(page, state, numbers(25));
  await expect.poll(() => state.held.length).toBe(10);
  for (const n of numbers(25)) state.tasks.set(n, task(n, 'SNAPSHOT'));
  state.sockets.at(-1).close({ code: 1008, reason: 'fixture reconnect' });
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/hubRealtimeSocket.js')).hubRealtimeSocket.status)).toBe('reconnecting');
  await page.clock.runFor(10000);
  await expect.poll(() => state.sockets.length).toBe(socketsBefore + 1);
  await page.clock.runFor(100);
  await Promise.all(state.held.map((record) => record.complete()));
  await expect(table(page).getByText('SNAPSHOT TASK 25', { exact: true })).toBeAttached();
  await expect(table(page).getByText('SNAPSHOT TASK 1', { exact: true })).toBeVisible();
  expect(state.listReads).toBe(listsBefore + 1);
  expect(state.reads).toHaveLength(10);
});
