import { test, expect } from '@playwright/test';

const users = { a: { id: 7, username: 'user-a', role: 'viewer' }, b: { id: 8, username: 'user-b', role: 'viewer' } };
const fingerprint = 'audit-upload.bin|24||1000';

async function prepare(page, { legacy = false, full = false, holdCreate = false, holdAllCreates = false, holdChunk = false, holdFirstChunks = false } = {}) {
  let actor = 'a';
  let nextId = 0;
  let held = null;
  const operations = [];
  const sessions = new Map();
  const heldCreates = [];
  const heldChunks = new Map();
  if (legacy) {
    const received = full ? 24 : 8;
    const data = Buffer.alloc(24);
    for (let index = 0; index < received; index += 1) data[index] = index;
    sessions.set('legacy-a', { actor: 'a', bytes: received, total: 24, data });
  }
  await page.addInitScript(({ user, legacy, fingerprint }) => {
    localStorage.setItem('user', JSON.stringify(user));
    if (legacy) localStorage.setItem('hubit-my-files-uploads', JSON.stringify({
      [fingerprint]: { fileId: 'legacy-a', savedAt: Date.now() },
      'other-file|9||1': { fileId: 'other-owner', savedAt: Date.now() },
    }));
  }, { user: users.a, legacy, fingerprint });
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: users[actor] }));
  await page.route('**/api/v1/auth/login', (route) => {
    actor = route.request().postDataJSON().username === 'user-a' ? 'a' : 'b';
    return route.fulfill({ json: { status: 'authenticated', user: users[actor] } });
  });
  await page.route('**/api/v1/my-files/upload-sessions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/upload-sessions')[1];
    const id = path.split('/')[1];
    operations.push({ method: request.method(), id, actor, path });
    if (!id) {
      const data = request.postDataJSON();
      const fileId = `${actor}-${++nextId}`;
      sessions.set(fileId, { actor, bytes: 0, total: data.file_size, data: Buffer.alloc(data.file_size) });
      const reply = { file_id: fileId, chunk_size_bytes: 8, uploaded_bytes: 0, ranges: [] };
      if (holdCreate || (holdAllCreates && actor === 'a')) {
        holdCreate = false;
        held = () => route.fulfill({ json: reply });
        heldCreates.push(held);
        return;
      }
      return route.fulfill({ json: reply });
    }
    const session = sessions.get(id);
    if (!session || session.actor !== actor) return route.fulfill({ status: 404, json: { detail: 'File not found' } });
    if (request.method() === 'DELETE') { sessions.delete(id); return route.fulfill({ status: 204 }); }
    if (path.endsWith('/complete')) return route.fulfill({ json: { id, status: 'queued' } });
    if (path.endsWith('/chunks')) {
      const payload = request.postDataBuffer();
      payload.copy(session.data, Number(new URL(request.url()).searchParams.get('offset') || 0));
      session.bytes += payload.length;
    }
    const reply = {
      file_id: id, chunk_size_bytes: 8, file_size_bytes: session.total, uploaded_bytes: session.bytes,
      ranges: session.bytes ? [[0, session.bytes]] : [], complete: session.bytes === session.total,
    };
    if (holdChunk && path.endsWith('/chunks')) { holdChunk = false; held = () => route.fulfill({ json: reply }); return; }
    if (holdFirstChunks && path.endsWith('/chunks') && !heldChunks.has(id)) {
      heldChunks.set(id, () => route.fulfill({ json: reply }));
      return;
    }
    return route.fulfill({ json: reply });
  });
  await page.goto('/e2e/fixtures/session-cache-harness.html');
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  return { operations, sessions, held: () => held, heldCreates, heldChunks };
}

async function start(page) { await page.getByRole('button', { name: 'Загрузить тестовый файл', exact: true }).click(); }
async function loginB(page) {
  await page.getByRole('button', { name: 'Войти как B', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
}

test('a delayed reservation cannot continue upload or cleanup with another account', async ({ page }) => {
  const state = await prepare(page, { holdCreate: true });
  await start(page);
  await expect.poll(() => Boolean(state.held())).toBe(true);
  await loginB(page);
  await state.held()();
  await expect(page.getByLabel('Результат загрузки')).toContainText('error:');
  expect(state.operations.filter((operation) => operation.actor === 'b' && operation.id === 'a-1')).toEqual([]);
  expect(state.sessions.has('a-1')).toBe(true);
});

test('a verified legacy session resumes received bytes without creating a second reservation', async ({ page }) => {
  const state = await prepare(page, { legacy: true, holdChunk: true });
  await start(page);
  await expect.poll(() => Boolean(state.held())).toBe(true);
  const migrating = await page.evaluate(() => ({ legacy: JSON.parse(localStorage.getItem('hubit-my-files-uploads') || '{}'), own: JSON.parse(localStorage.getItem('hubit-my-files-uploads:7') || '{}') }));
  expect(migrating.own[fingerprint].fileId).toBe('legacy-a');
  expect(migrating.legacy[fingerprint]).toBeUndefined();
  await state.held()();
  await expect(page.getByLabel('Результат загрузки')).toHaveText('completed');
  expect(state.operations.filter((operation) => operation.path === '')).toHaveLength(0);
  expect(state.operations.filter((operation) => operation.path.endsWith('/chunks'))).toHaveLength(2);
  expect(state.sessions.get('legacy-a').bytes).toBe(24);
  expect([...state.sessions.get('legacy-a').data]).toEqual([...Array(24).keys()]);
  const cache = await page.evaluate(() => ({ legacy: JSON.parse(localStorage.getItem('hubit-my-files-uploads') || '{}'), own: JSON.parse(localStorage.getItem('hubit-my-files-uploads:7') || '{}') }));
  expect(cache.legacy[fingerprint]).toBeUndefined();
  expect(cache.legacy['other-file|9||1'].fileId).toBe('other-owner');
  expect(cache.own).toEqual({});
});

test('a fully received active reservation resumes completion without uploading twice', async ({ page }) => {
  const state = await prepare(page, { legacy: true, full: true });
  await start(page);
  await expect(page.getByLabel('Результат загрузки')).toHaveText('completed');
  expect(state.operations.filter((operation) => operation.path === '' || operation.path.endsWith('/chunks'))).toEqual([]);
  expect(state.operations.some((operation) => operation.id === 'legacy-a' && operation.path.endsWith('/complete'))).toBe(true);
});

test('an old multi-file queue cannot start its next file under the new account', async ({ page }) => {
  const state = await prepare(page, { holdAllCreates: true });
  await page.getByRole('button', { name: 'Очередь трёх файлов', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить очередь', exact: true }).click();
  await expect.poll(() => state.operations.filter((operation) => operation.path === '').length).toBe(2);
  await loginB(page);
  await expect(page.getByLabel('Очередь загрузки')).toHaveText('idle');
  expect(state.operations.filter((operation) => operation.actor === 'b')).toEqual([]);
});

test('a partial upload remains resumable by its owner after another account uploads the same file', async ({ page }) => {
  const state = await prepare(page, { holdChunk: true });
  await start(page);
  await expect.poll(() => Boolean(state.held())).toBe(true);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem('hubit-my-files-uploads:7'))[key].fileId, fingerprint)).toBe('a-1');
  await loginB(page);
  await expect(page.getByLabel('Результат загрузки')).toHaveText('error:ERR_SESSION_CHANGED');
  await state.held()();
  await start(page);
  await expect(page.getByLabel('Результат загрузки')).toHaveText('completed');
  expect(state.operations.filter((operation) => operation.actor === 'b' && operation.id === 'a-1')).toEqual([]);
  expect([...state.sessions.get('b-2').data]).toEqual([...Array(24).keys()]);
  await page.getByRole('button', { name: 'Войти как A', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await start(page);
  await expect(page.getByLabel('Результат загрузки')).toHaveText('completed');
  expect(state.operations.filter((operation) => operation.actor === 'a' && operation.path === '')).toHaveLength(1);
  expect([...state.sessions.get('a-1').data]).toEqual([...Array(24).keys()]);
  expect(state.operations.filter((operation) => operation.method === 'DELETE')).toEqual([]);
});

test('a failed ownership check does not migrate or delete another owners legacy metadata', async ({ page }) => {
  const state = await prepare(page, { legacy: true });
  await loginB(page);
  await start(page);
  await expect(page.getByLabel('Результат загрузки')).toHaveText('completed');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem('hubit-my-files-uploads'))[key].fileId, fingerprint)).toBe('legacy-a');
  expect(state.sessions.get('legacy-a').bytes).toBe(8);
  expect(state.operations.filter((operation) => operation.method === 'DELETE')).toEqual([]);
  expect([...state.sessions.get('b-1').data]).toEqual([...Array(24).keys()]);
});

test('a delayed folder preparation cannot start further upload operations after account change', async ({ page }) => {
  const state = await prepare(page);
  let folderRequest;
  const folderRequests = [];
  await page.route('**/api/v1/my-files/folders', (route) => {
    folderRequests.push(route.request().postDataJSON());
    folderRequest = route;
  });
  await page.getByRole('button', { name: 'Очередь папки', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить очередь', exact: true }).click();
  await expect.poll(() => Boolean(folderRequest)).toBe(true);
  await loginB(page);
  const finished = page.waitForResponse('**/api/v1/my-files/folders');
  await folderRequest.fulfill({ json: { id: 'folder-a' } });
  await (await finished).finished();
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('Очередь загрузки')).toHaveText('idle');
  expect(folderRequests).toHaveLength(1);
  expect(state.operations).toEqual([]);
});

test('failed scoped persistence cannot erase a resumable legacy record', async ({ page }) => {
  const state = await prepare(page, { legacy: true, holdChunk: true });
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'hubit-my-files-uploads:7') throw new DOMException('fixture quota failure', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await start(page);
  await expect.poll(() => Boolean(state.held())).toBe(true);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem('hubit-my-files-uploads'))[key]?.fileId, fingerprint)).toBe('legacy-a');
  await state.held()();
  await expect(page.getByLabel('Результат загрузки')).toHaveText('completed');
});

test('completion of one concurrent upload cannot erase another sessions resume record', async ({ page }) => {
  const state = await prepare(page, { holdAllCreates: true, holdFirstChunks: true });
  await start(page);
  await expect.poll(() => state.heldCreates.length).toBe(1);
  await start(page);
  await expect.poll(() => state.heldCreates.length).toBe(2);
  await state.heldCreates[0]();
  await expect.poll(() => state.heldChunks.has('a-1')).toBe(true);
  await state.heldCreates[1]();
  await expect.poll(() => state.heldChunks.has('a-2')).toBe(true);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem('hubit-my-files-uploads:7'))[key].fileId, fingerprint)).toBe('a-2');
  await state.heldChunks.get('a-1')();
  await expect.poll(() => state.operations.some((operation) => operation.path === '/a-1/complete')).toBe(true);
  await expect(page.getByLabel('Результат загрузки')).toHaveText('completed');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem('hubit-my-files-uploads:7'))[key]?.fileId, fingerprint)).toBe('a-2');
  await state.heldChunks.get('a-2')();
  await expect.poll(() => state.operations.some((operation) => operation.path === '/a-2/complete')).toBe(true);
});
