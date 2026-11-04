import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'Creates empty dialogs only on the isolated local stack');

async function login(page) {
  const form = page.getByTestId('password-auth-form');
  await expect(form).toBeVisible();
  await form.locator('[name=username]').fill(process.env.E2E_USERNAME);
  await form.locator('[name=password]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(form).toBeHidden({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hubit:desktop-handoff', 'never'));
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.fallback() : route.abort());
});

test('portal email survives login, opens the correct peer and reuses the empty dialog', async ({ page }) => {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/chat/conversations/direct') {
      posts.push(request.postDataJSON());
    }
  });
  const target = '/chat/open#email=e2e_user%40example.com';
  await page.goto(target);
  await expect(page).toHaveURL(/\/login/);
  await login(page);
  await expect(page).toHaveURL(/\/chat\?conversation=/, { timeout: 30_000 });
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
  const conversation = new URL(page.url()).searchParams.get('conversation');
  const details = await page.request.get(`/api/v1/chat/conversations/${conversation}`);
  expect(details.ok()).toBeTruthy();
  const data = await details.json();
  expect(JSON.stringify(data)).toContain('e2e_user');
  expect(posts).toHaveLength(1);
  const messages = await page.request.get(`/api/v1/chat/conversations/${conversation}/messages`);
  expect((await messages.json()).items).toEqual([]);
  await page.goto(target);
  await expect(page).toHaveURL(new RegExp(`/chat\\?conversation=${conversation}`), { timeout: 30_000 });
  expect(posts).toHaveLength(2);
});

test('unknown employee and invalid link do not open a different conversation', async ({ page }) => {
  let directPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/chat/conversations/direct') directPosts++;
  });
  await page.goto('/chat/open#email=missing%40example.com');
  await login(page);
  await expect(page.getByRole('alert').filter({ hasText: 'не найден в HUB' })).toBeVisible({ timeout: 30_000 });
  await page.goto('/chat/open#email=bad');
  await expect(page.getByRole('alert').filter({ hasText: 'не указан корректный' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toHaveCount(0);
  await page.goto('/chat/open#email=e2e_admin%40example.com');
  await expect(page.getByRole('alert').filter({ hasText: 'не найден в HUB' })).toBeVisible();
  expect(directPosts).toBe(0);
});

test('failed lookup can be retried without sending a message', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/v1/chat/users/resolve?*', async (route) => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { detail: 'Справочник временно недоступен' } });
    return route.fallback();
  });
  await page.goto('/chat/open#email=e2e_user%40example.com');
  await login(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Справочник временно недоступен' })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\?conversation=/, { timeout: 30_000 });
  expect(attempts).toBe(2);
  const id = new URL(page.url()).searchParams.get('conversation');
  const messages = await page.request.get(`/api/v1/chat/conversations/${id}/messages`);
  expect((await messages.json()).items).toEqual([]);
});

test('late lookup cannot open the previous employee after the recipient changes', async ({ page }) => {
  await page.goto('/login');
  await login(page);
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/chat/conversations/direct') posts.push(request.postDataJSON());
  });
  let release;
  let started;
  let finished;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = new Promise((resolve) => { started = resolve; });
  const completed = new Promise((resolve) => { finished = resolve; });
  await page.route('**/api/v1/chat/users/resolve?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('email') !== 'e2e_user@example.com') return route.fallback();
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
    finished();
  });
  await page.goto('/chat/open#email=e2e_user%40example.com');
  await pending;
  await page.evaluate(() => { window.location.hash = 'email=e2e_fresh%40example.com'; });
  await expect(page).toHaveURL(/\/chat\?conversation=/, { timeout: 30_000 });
  const id = new URL(page.url()).searchParams.get('conversation');
  release();
  await completed;
  await page.waitForTimeout(200);
  expect(posts).toHaveLength(1);
  const detail = await page.request.get(`/api/v1/chat/conversations/${id}`);
  expect(JSON.stringify(await detail.json())).toContain('e2e_fresh');
  expect(new URL(page.url()).searchParams.get('conversation')).toBe(id);
});
