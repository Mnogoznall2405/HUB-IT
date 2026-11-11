import { test, expect } from '@playwright/test';

const media = '/api/v1/chat/messages/audit-a/attachments/1/file?inline=1&variant=thumb';
async function connect(page) {
  await page.request.get('/__audit/media-state?authorized=0&hold=0&release=1');
  await page.goto('/e2e/fixtures/private-media-cache-harness.html');
  await page.getByRole('button', { name: 'Подключить worker', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('controlled');
}

test('an unverified client cannot read legacy private media from CacheStorage', async ({ page }) => {
  await connect(page);
  await page.evaluate(async (url) => {
    const cache = await caches.open('hubit-chat-media-v2026-04-17-1');
    await cache.put(url, new Response('PRIVATE_A'));
  }, media);
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('401:unauthorized');
});

test('logout clears only private media and rechecks HTTP authorization', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Подтвердить A', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('authenticated');
  await page.request.get('/__audit/media-state?authorized=1');
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('200:PRIVATE_A');
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((key) => key.startsWith('hubit-chat-media-')))).toBe(true);
  await page.evaluate(async () => {
    for (const key of ['another-app-cache', 'hubit-app-shell-fixture', 'hubit-app-assets-fixture', 'itinvent-push-runtime-fixture']) {
      const cache = await caches.open(key);
      await cache.put('/audit-retained', new Response('retained'));
    }
  });
  await page.request.get('/__audit/media-state?authorized=0');
  await page.getByRole('button', { name: 'Завершить сессию', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('cleared');
  const keys = await page.evaluate(() => caches.keys());
  expect(keys.some((key) => key.startsWith('hubit-chat-media-'))).toBe(false);
  for (const key of ['another-app-cache', 'hubit-app-shell-fixture', 'hubit-app-assets-fixture', 'itinvent-push-runtime-fixture']) expect(keys).toContain(key);
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('401:unauthorized');
});

test('a background response started before logout cannot write private media again', async ({ page, context }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Подтвердить A', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('authenticated');
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(() => {
    self.auditPrivateWrites = 0;
    const put = Cache.prototype.put;
    Cache.prototype.put = function (request, response) {
      if (String(request.url || request).includes('/api/v1/chat/messages/')) self.auditPrivateWrites += 1;
      return put.call(this, request, response);
    };
  });
  await page.request.get('/__audit/media-state?authorized=1');
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('200:PRIVATE_A');
  await expect.poll(() => worker.evaluate(() => self.auditPrivateWrites)).toBe(1);
  await page.request.get('/__audit/media-state?hold=1');
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/__audit/media-state')).json()).pending).toBe(1);
  await page.request.get('/__audit/media-state?authorized=0');
  await page.getByRole('button', { name: 'Завершить сессию', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('cleared');
  const late = context.waitForEvent('response', (response) => response.url().includes('/chat/messages/audit-a/') && response.status() === 200);
  await page.request.get('/__audit/media-state?hold=0&release=1');
  await (await late).finished();
  expect(await worker.evaluate(() => self.auditPrivateWrites)).toBe(1);
  expect((await page.evaluate(() => caches.keys())).some((key) => key.startsWith('hubit-chat-media-'))).toBe(false);
});

test('AuthProvider waits for logout cleanup and scopes the next account', async ({ page }) => {
  await connect(page);
  const userA = { id: 7, username: 'user-a', role: 'viewer', is_active: true };
  const userB = { id: 8, username: 'user-b', role: 'viewer', is_active: true };
  await page.route('**/api/v1/auth/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('/me') ? userA : path.endsWith('/login') ? { status: 'authenticated', user: userB } : {} });
  });
  await page.goto('/e2e/fixtures/session-cache-harness.html');
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await page.request.get('/__audit/media-state?authorized=1');
  await page.getByRole('button', { name: 'Превью чата', exact: true }).click();
  await expect(page.getByLabel('Превью', { exact: true })).toHaveText('200:PRIVATE_A');
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((key) => key.endsWith(':7')))).toBe(true);
  await page.request.get('/__audit/media-state?authorized=0');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('logged out');
  expect((await page.evaluate(() => caches.keys())).some((key) => key.startsWith('hubit-chat-media-'))).toBe(false);
  await page.getByRole('button', { name: 'Войти как B', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  await page.getByRole('button', { name: 'Превью чата', exact: true }).click();
  await expect(page.getByLabel('Превью', { exact: true })).toHaveText('401:unauthorized');
});

test('a disk cleanup failure still revokes the clients cached-media access', async ({ page, context }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Подтвердить A', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('authenticated');
  await page.request.get('/__audit/media-state?authorized=1');
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('200:PRIVATE_A');
  await page.evaluate(() => { CacheStorage.prototype.keys = async () => { throw new Error('fixture disk failure'); }; });
  await context.serviceWorkers()[0].evaluate(() => { CacheStorage.prototype.keys = async () => { throw new Error('fixture disk failure'); }; });
  await page.request.get('/__audit/media-state?authorized=0');
  await page.getByRole('button', { name: 'Завершить сессию', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('failed');
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('401:unauthorized');
});

test('an unavailable media cache falls back to server authorization', async ({ page, context }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Подтвердить A', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('authenticated');
  await context.serviceWorkers()[0].evaluate(() => {
    const open = CacheStorage.prototype.open;
    CacheStorage.prototype.open = function (name) {
      if (name.startsWith('hubit-chat-media-')) return Promise.reject(new Error('fixture unavailable cache'));
      return open.call(this, name);
    };
  });
  await page.request.get('/__audit/media-state?authorized=1');
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('200:PRIVATE_A');
});

test('cached session restoration preserves its own previews during a temporary outage', async ({ page }) => {
  await connect(page);
  let unavailable = false;
  await page.route('**/api/v1/auth/me', (route) => route.fulfill(unavailable
    ? { status: 503, json: { detail: 'fixture temporary outage' } }
    : { json: { id: 7, username: 'user-a', role: 'viewer', is_active: true } }));
  await page.goto('/e2e/fixtures/session-cache-harness.html');
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await page.request.get('/__audit/media-state?authorized=1');
  await page.getByRole('button', { name: 'Превью чата', exact: true }).click();
  await expect(page.getByLabel('Превью', { exact: true })).toHaveText('200:PRIVATE_A');
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((key) => key.endsWith(':7')))).toBe(true);
  unavailable = true;
  await page.request.get('/__audit/media-state?authorized=0');
  // A new document has a different worker clientId; only the restored session
  // can re-establish its own scope. No new server identity is accepted here.
  await page.reload();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await page.getByRole('button', { name: 'Превью чата', exact: true }).click();
  await expect(page.getByLabel('Превью', { exact: true })).toHaveText('200:PRIVATE_A');
});

test('another account cannot read an existing account cache even without disk cleanup', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Подтвердить A', exact: true }).click();
  await expect(page.getByLabel('Состояние', { exact: true })).toHaveText('authenticated');
  await page.request.get('/__audit/media-state?authorized=1');
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('200:PRIVATE_A');
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((key) => key.endsWith(':user-a')))).toBe(true);
  await page.request.get('/__audit/media-state?authorized=0');
  await page.evaluate(async () => {
    const { synchronizePrivateMediaSession } = await import('/src/lib/privateMediaSession.js');
    await synchronizePrivateMediaSession('user-b');
  });
  await page.getByRole('button', { name: 'Запросить превью', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveText('401:unauthorized');
  expect((await page.evaluate(() => caches.keys())).some((key) => key.endsWith(':user-a'))).toBe(true);
});
