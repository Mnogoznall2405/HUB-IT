import { test, expect } from '@playwright/test';

const userA = { id: 7, username: 'user-a', role: 'viewer', is_active: true };
const userB = { id: 8, username: 'user-b', role: 'viewer', is_active: true };
const harness = '/e2e/fixtures/session-cache-harness.html';

async function prepare(page) {
  let currentUser = userA;
  await page.addInitScript((user) => {
    if (!localStorage.getItem('user')) localStorage.setItem('user', JSON.stringify(user));
  }, userA);
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: currentUser }));
  await page.route('**/api/v1/auth/login', (route) => {
    currentUser = route.request().postDataJSON().username === 'user-a' ? userA : userB;
    return route.fulfill({ json: { status: 'authenticated', user: currentUser } });
  });
  await page.goto(harness);
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
}

async function search(page, query) {
  await page.getByLabel('Поиск почты', { exact: true }).fill(query);
  await page.getByRole('button', { name: 'Применить поиск почты', exact: true }).click();
  await expect(page.getByLabel('История поиска почты')).toContainText(query);
}

async function loginB(page) {
  await page.getByRole('button', { name: 'Войти как B', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
}

test('logout and another login clear old mail search state', async ({ page }) => {
  await prepare(page);
  await search(page, 'PRIVATE_SEARCH_A');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('logged out');
  await expect(page.getByLabel('История поиска почты')).toHaveText('empty');
  await expect(page.getByLabel('Применённый поиск почты')).toHaveText('empty');
  await expect(page.getByLabel('Поиск почты', { exact: true })).toHaveValue('');
  await loginB(page);
  await expect(page.getByLabel('История поиска почты')).toHaveText('empty');
});

test('own mail searches survive reload but stay isolated from another account', async ({ page }) => {
  await prepare(page);
  await search(page, 'PRIVATE_SEARCH_A');
  await page.reload();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await expect(page.getByLabel('История поиска почты')).toHaveText('PRIVATE_SEARCH_A');
  await loginB(page);
  await expect(page.getByLabel('История поиска почты')).toHaveText('empty');
  await search(page, 'SEARCH_B');
  await page.reload();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  await expect(page.getByLabel('История поиска почты')).toHaveText('SEARCH_B');
  await page.getByRole('button', { name: 'Войти как A', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await expect(page.getByLabel('История поиска почты')).toHaveText('PRIVATE_SEARCH_A');
});

test('late mail search callbacks cannot restore another sessions history', async ({ page }) => {
  await prepare(page);
  let delayed;
  await page.route('**/__audit/late-mail-search', (route) => { delayed = route; });
  await page.getByRole('button', { name: 'Отложить поиск почты', exact: true }).click();
  await expect.poll(() => Boolean(delayed)).toBe(true);
  await loginB(page);
  const completed = page.waitForResponse('**/__audit/late-mail-search');
  await delayed.fulfill({ body: 'done' });
  await (await completed).finished();
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('История поиска почты')).toHaveText('empty');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('mail_recent_searches_v1')).map((key) => localStorage.getItem(key)).join('|'))).not.toContain('LATE_PRIVATE_A');
});

test('unowned legacy mail search history is not assigned to the signed in account', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mail_recent_searches_v1', JSON.stringify([{ q: 'LEGACY_PRIVATE_SEARCH' }])));
  await prepare(page);
  await expect(page.getByLabel('История поиска почты')).toHaveText('empty');
  expect(await page.evaluate(() => localStorage.getItem('mail_recent_searches_v1'))).toBeNull();
});

test('logout fences a pending callback even after signing into the same account again', async ({ page }) => {
  await prepare(page);
  let delayed;
  await page.route('**/__audit/late-mail-search', (route) => { delayed = route; });
  await page.getByRole('button', { name: 'Отложить поиск почты', exact: true }).click();
  await expect.poll(() => Boolean(delayed)).toBe(true);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('logged out');
  await page.getByRole('button', { name: 'Войти как A', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  const completed = page.waitForResponse('**/__audit/late-mail-search');
  await delayed.fulfill({ body: 'done' });
  await (await completed).finished();
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('История поиска почты')).toHaveText('empty');
});
