import { test, expect } from '@playwright/test';

const userA = { id: 7, username: 'user-a', role: 'viewer', is_active: true };
const userB = { id: 8, username: 'user-b', role: 'viewer', is_active: true };
const harness = '/e2e/fixtures/session-cache-harness.html';

async function prepare(page) {
  await page.addInitScript((user) => localStorage.setItem('user', JSON.stringify(user)), userA);
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: userA }));
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ json: { status: 'authenticated', user: userB } }));
  await page.goto(harness);
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await page.getByRole('button', { name: 'Сохранить кэш', exact: true }).click();
}

test('logout and another login fence late session and shared-cache responses', async ({ page }) => {
  await prepare(page);
  let oldSession;
  let oldData;
  await page.route('**/api/v1/auth/me*', (route) => { oldSession = route; });
  await page.route('**/__audit/private-cache', (route) => { oldData = route; });
  await page.getByRole('button', { name: 'Проверить сессию', exact: true }).click();
  await page.getByRole('button', { name: 'Запросить данные', exact: true }).click();
  await expect.poll(() => Boolean(oldSession && oldData)).toBe(true);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('logged out');
  await page.getByRole('button', { name: 'Войти как B', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('Кэш', { exact: true })).toHaveText('empty');
  await page.route('**/__audit/private-cache', (route) => route.fulfill({ body: 'user-b' }));
  await page.getByRole('button', { name: 'Запросить данные', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('data loaded');
  await oldData.fulfill({ body: 'user-a' });
  await oldSession.fulfill({ json: userA });
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('Кэш', { exact: true })).toHaveText('user-b');
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user')).username)).toBe('user-b');
});

test('a transient session check error preserves the account and cache', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ status: 503, json: { detail: 'fixture offline' } }));
  await page.getByRole('button', { name: 'Проверить сессию', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('session error');
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('Кэш', { exact: true })).toHaveText('user-a');
});

test('a definitive session rejection clears shared caches', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ status: 401, json: { detail: 'Session expired' } }));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, json: { detail: 'Session expired' } }));
  await page.getByRole('button', { name: 'Проверить сессию', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('anonymous');
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('Кэш', { exact: true })).toHaveText('empty');
});

test('another window login starts a fresh check instead of reusing the previous account request', async ({ page, context }) => {
  await prepare(page);
  let oldCheck;
  await page.route('**/api/v1/auth/me*', (route) => {
    if (!oldCheck) { oldCheck = route; return; }
    return route.fulfill({ json: userB });
  });
  await page.getByRole('button', { name: 'Проверить сессию', exact: true }).click();
  await expect.poll(() => Boolean(oldCheck)).toBe(true);
  const other = await context.newPage();
  await other.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await other.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: userA }));
  await other.route('**/api/v1/auth/login', (route) => route.fulfill({ json: { status: 'authenticated', user: userB } }));
  await other.goto(harness);
  await expect(other.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await other.getByRole('button', { name: 'Войти как B', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  await oldCheck.fulfill({ json: userA });
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('Кэш', { exact: true })).toHaveText('empty');
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  await other.close();
});

test('logout clears notification history, seen IDs, active toasts and their queue', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Добавить уведомления', exact: true }).click();
  await expect(page.getByLabel('История уведомлений')).toContainText('Приватное A');
  await expect(page.getByLabel('Просмотрено A')).toHaveText('true');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('logged out');
  await expect(page.getByLabel('История уведомлений')).toHaveText('empty');
  await expect(page.getByLabel('Просмотрено A')).toHaveText('false');
  await expect(page.getByTestId('toast-stack')).not.toContainText('Приватное A');
  await expect(page.getByTestId('toast-stack')).not.toContainText('Очередь A');
  await page.getByRole('button', { name: 'Войти как B', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  await expect(page.getByLabel('История уведомлений')).toHaveText('empty');
  const stored = await page.evaluate(() => [localStorage.getItem('itinvent_toast_history'), localStorage.getItem('itinvent_hub_seen_ids')]);
  expect(stored.join('|')).not.toContain('Приватное A');
  expect(stored.join('|')).not.toContain('private-a');
});

test('notification completion from an old session cannot populate another account', async ({ page }) => {
  await prepare(page);
  let delayed;
  await page.route('**/__audit/late-notification', (route) => { delayed = route; });
  await page.getByRole('button', { name: 'Отложенное уведомление', exact: true }).click();
  await expect.poll(() => Boolean(delayed)).toBe(true);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('logged out');
  await page.getByRole('button', { name: 'Войти как B', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  const completed = page.waitForResponse('**/__audit/late-notification');
  await delayed.fulfill({ body: 'done' });
  await (await completed).finished();
  // A separate click is processed after the completed fetch's microtasks.
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expect(page.getByLabel('История уведомлений')).toHaveText('empty');
  await expect(page.getByTestId('toast-stack')).not.toContainText('Позднее A');
});

test('a reload preserves notification history belonging to the same account', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Добавить уведомления', exact: true }).click();
  await expect(page.getByLabel('История уведомлений')).toContainText('Приватное A');
  await page.reload();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await expect(page.getByLabel('История уведомлений')).toContainText('Приватное A');
  await expect(page.getByLabel('Просмотрено A')).toHaveText('true');
});

test('unowned legacy notification history is discarded rather than assigned to a new session', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('itinvent_toast_history', JSON.stringify([{ message: 'LEGACY_PRIVATE_A', title: 'legacy' }]));
    localStorage.setItem('itinvent_hub_seen_ids', JSON.stringify(['private-a']));
  });
  await prepare(page);
  await expect(page.getByLabel('История уведомлений')).toHaveText('empty');
  await expect(page.getByLabel('Просмотрено A')).toHaveText('false');
  expect(await page.evaluate(() => localStorage.getItem('itinvent_toast_history'))).not.toContain('LEGACY_PRIVATE_A');
});

test('logout in another window clears this windows notifications as well', async ({ page, context }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Добавить уведомления', exact: true }).click();
  await expect(page.getByLabel('История уведомлений')).toContainText('Приватное A');
  const other = await context.newPage();
  await other.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await other.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: userA }));
  await other.goto(harness);
  await expect(other.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await other.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('anonymous');
  await expect(page.getByLabel('История уведомлений')).toHaveText('empty');
  await expect(page.getByLabel('Просмотрено A')).toHaveText('false');
  await expect(page.getByTestId('toast-stack')).not.toContainText('Приватное A');
  await other.close();
});

test('a definitive session rejection also clears private notifications', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Добавить уведомления', exact: true }).click();
  await expect(page.getByLabel('История уведомлений')).toContainText('Приватное A');
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ status: 401, json: { detail: 'Session expired' } }));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, json: { detail: 'Session expired' } }));
  await page.getByRole('button', { name: 'Проверить сессию', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('anonymous');
  await expect(page.getByLabel('История уведомлений')).toHaveText('empty');
  await expect(page.getByLabel('Просмотрено A')).toHaveText('false');
  await expect(page.getByTestId('toast-stack')).not.toContainText('Приватное A');
});
