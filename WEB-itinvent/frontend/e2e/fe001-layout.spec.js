import { expect, test } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'FE-001 request comparison uses the isolated local stack only');

const globalPaths = new Set([
  '/api/v1/hub/notifications/poll',
  '/api/v1/settings/notifications/preferences',
  '/api/v1/hub/notifications/unread-counts',
  '/api/v1/mail/unread-count',
]);

test('dashboard, feed and tickets share one shell across SPA transitions', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (globalPaths.has(path)) requests.push(path);
  });

  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
  await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard');
  await expect(page.getByTestId('dashboard-today-header')).toBeVisible();
  await page.waitForTimeout(500);

  const transitions = [
    ['/feed', '#feed-page-title'],
    ['/tasks', 'response:/api/v1/hub/tasks'],
    ['/tickets', '[data-testid="page-top-bar"] h1'],
    ['/dashboard', '[data-testid="dashboard-today-header"]'],
  ];
  const measured = [];
  for (const [path, marker] of transitions) {
    requests.length = 0;
    await page.evaluate((next) => {
      window.history.pushState({}, '', next);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    if (marker.startsWith('response:')) {
      await page.waitForResponse((res) => res.url().includes(marker.slice(9)), { timeout: 15_000 });
    } else {
      await expect(page.locator(marker)).toBeVisible();
    }
    await page.waitForTimeout(350);
    measured.push({ path, requests: [...requests] });
  }

  console.log('FE001_ROUTE_GLOBAL_REQUESTS', JSON.stringify(measured));
  // Shell-owned endpoints must not refetch on transitions inside the group.
  const all = measured.flatMap(({ requests: batch }) => batch);
  expect(all.filter((path) => path !== '/api/v1/mail/unread-count')).toEqual([]);
  // /mail/unread-count is also page data: Dashboard fetches it on mount. It may
  // appear only in the /dashboard window, at most once.
  for (const { path, requests: batch } of measured) {
    const mailCount = batch.filter((p) => p === '/api/v1/mail/unread-count').length;
    if (path === '/dashboard') expect(mailCount).toBeLessThanOrEqual(1);
    else expect(mailCount).toBe(0);
  }
});
