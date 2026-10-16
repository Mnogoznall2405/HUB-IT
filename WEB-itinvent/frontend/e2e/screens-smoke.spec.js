import { test, expect } from '@playwright/test';

// Per-screen golden smoke on the real deployed build: after login, each
// primary workspace must render its own shell — not bounce to /login and
// not render a blank page. Requires E2E_USERNAME/E2E_PASSWORD for a user
// with access to these sections (same requirement as chat-smoke).
//
// Read-only: nothing here creates, edits or deletes data.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeHidden();
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

const SCREENS = [
  { path: '/feed', anchor: (page) => page.locator('#feed-page-title') },
  { path: '/chat', anchor: (page) => page.getByTestId('chat-sidebar-list-scroll') },
    { path: '/tickets', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading', { name: 'Билеты' }) },
  { path: '/my-files', anchor: (page) => page.getByTestId('my-files-create-button') },
  // tasks-create-fab is mobile-only; on desktop the section title is the anchor.
  { path: '/tasks', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading', { name: 'Задачи' }) },
  { path: '/computers', anchor: (page) => page.getByRole('heading').first() },
  { path: '/dashboard', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading', { name: 'Главная' }) },
  { path: '/help', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/settings', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/profile', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/admin', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/address-book', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading', { name: 'Адресная книга' }) },
  { path: '/company-structure', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/statistics', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/passwords', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/docflow', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/groups-access', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/warehouse-1c', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/construction', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/vcs', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/mfu', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/scan-center', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/networks', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/database', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/voice', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/dlp', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/file-egress', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/it/requests', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/kb/manage', anchor: (page) => page.getByTestId('main-layout-content').getByRole('heading').first() },
  { path: '/menu', anchor: (page) => page.getByTestId('main-layout-app-bar').getByRole('heading').first() },
];

for (const { path, anchor } of SCREENS) {
  test(`screen ${path} renders after login`, async ({ page }) => {
    await login(page);
    await page.goto(path);

    // Must not be bounced back to the login screen and must show content.
    await expect(page).toHaveURL(new RegExp(path.replace(/[/.]/g, '\\$&')), {
      timeout: 30_000,
    });
    await expect(page.getByTestId('password-auth-form')).toHaveCount(0);
    await expect(anchor(page)).toBeVisible();
  });
}
