import { test, expect } from '@playwright/test';

// Pinning the left menu: a pinned menu stays fully open on pages with the
// integrated top row, survives a reload and can be unpinned again.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(process.env.E2E_LOCAL !== '1', 'sidebar pin E2E runs only against the local stack');
test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

const dockedMenu = (page) => page.locator('.MuiDrawer-docked .MuiDrawer-paper');
// The width animates between rail and full menu, so poll instead of measuring once.
const menuWidth = (page) => async () => Math.round((await dockedMenu(page).boundingBox()).width);

test('pinned portal menu stays open on integrated pages and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto('/tickets');

  // Unpinned: icon rail plus the menu button in the page's own top row.
  const topBar = page.getByTestId('page-top-bar');
  await expect(topBar.getByRole('heading', { name: 'Билеты' })).toBeVisible();
  await expect(page.getByTestId('main-layout-app-bar')).toHaveCount(0);
  await expect.poll(menuWidth(page)).toBeLessThanOrEqual(76);

  await topBar.getByRole('button', { name: 'Открыть главное меню' }).dispatchEvent('click');
  const overlayPin = page.locator('.MuiDrawer-modal').getByRole('button', { name: 'Закрепить меню' });
  await expect(overlayPin).toBeVisible();
  await overlayPin.dispatchEvent('click');

  // Pinned: full menu is docked, there is nothing to open any more.
  await expect(dockedMenu(page).getByRole('button', { name: 'Открепить меню' })).toBeVisible();
  await expect.poll(menuWidth(page)).toBeGreaterThanOrEqual(200);
  await expect(topBar.getByRole('button', { name: 'Открыть главное меню' })).toHaveCount(0);

  await page.reload();
  await expect(dockedMenu(page).getByRole('button', { name: 'Открепить меню' })).toBeVisible();
  await expect.poll(menuWidth(page)).toBeGreaterThanOrEqual(200);

  // The pin applies to the other integrated pages as well.
  await page.goto('/database');
  await expect(dockedMenu(page).getByRole('button', { name: 'Открепить меню' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть главное меню' })).toHaveCount(0);

  await dockedMenu(page).getByRole('button', { name: 'Открепить меню' }).dispatchEvent('click');
  await expect(dockedMenu(page).getByRole('button', { name: 'Закрепить меню' })).toBeVisible();
  await expect.poll(menuWidth(page)).toBeLessThanOrEqual(76);
  await expect(page.getByRole('button', { name: 'Открыть главное меню' })).toBeVisible();
});
