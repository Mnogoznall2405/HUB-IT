import { test, expect } from '@playwright/test';

async function prepare(page, cardLinks) {
  page.on('pageerror', (error) => console.log('KB page error:', error.message));
  const user = { id: 999, username: 'kb_local_fixture', full_name: 'KB Local Fixture', role: 'admin',
    permissions: ['kb.read', 'kb.write'], is_active: true, about_onboarding_completed_at: '2026-10-18' };
  const card = { id: 'card-1', title: 'Проверка ссылок', summary_short: 'Описание карточки',
    service_key: 'audit', status: 'published', priority: 'normal', visibility_scope: 'global',
    tags: [], quick_steps: [], gallery: [], ...cardLinks };
  await page.routeWebSocket('**/*', (socket) => socket.onMessage(() => {}));
  await page.addInitScript((user) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('hubit:desktop-handoff', 'never');
  }, user);
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = { items: [], total: 0, pages: 0 };
    if (path.endsWith('/auth/me')) body = user;
    else if (/\/kb\/(categories|services|feed)$/.test(path) || path.endsWith('/departments')) body = [];
    else if (path.endsWith('/kb/cards/card-1')) body = card;
    else if (path.endsWith('/kb/cards')) body = { items: [card], total: 1 };
    return route.fulfill({ json: body });
  });
  await page.goto('/e2e/fixtures/kb-links-harness.html');
  await page.getByRole('tab', { name: 'Карточки', exact: true }).click();
  await expect(page.getByRole('heading', { name: card.title, exact: true })).toBeVisible();
}

for (const url of ['javascript:window.auditInjected=true', 'java\tscript:window.auditInjected=true', 'data:text/html,<script>1</script>', 'http://[::']) {
  test(`KB rejects unsupported card and cover URLs: ${url.split(':')[0]}`, async ({ page }) => {
    await prepare(page, { external_url: url, cover_image_url: url });
    await expect(page.getByText(/^(Открыть|Ссылка недоступна)$/)).toBeDisabled();
    await expect(page.getByText(/^(Открыть обложку|Обложка недоступна)$/)).toBeDisabled();
    await expect(page.locator('a[href^="javascript:"], a[href^="data:"]')).toHaveCount(0);
  });
}

test('KB opens valid HTTPS links and relative covers without an opener', async ({ page, context }) => {
  await context.route('https://kb.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Внешняя инструкция</p>' }));
  await context.route('http://127.0.0.1:5219/audit-cover', (route) => route.fulfill({ contentType: 'text/plain', body: 'Cover fixture' }));
  await prepare(page, { external_url: 'https://kb.example.test/instruction', cover_image_url: '/audit-cover' });
  const popupPromise = page.waitForEvent('popup');
  await page.getByText('Открыть', { exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL('https://kb.example.test/instruction');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  const coverPromise = page.waitForEvent('popup');
  await page.getByText('Открыть обложку', { exact: true }).click();
  const cover = await coverPromise;
  await cover.waitForURL('http://127.0.0.1:5219/audit-cover');
  expect(await cover.evaluate(() => window.opener === null)).toBe(true);
});
