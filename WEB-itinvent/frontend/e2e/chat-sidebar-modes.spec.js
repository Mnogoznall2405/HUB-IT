import { expect, test } from '@playwright/test';

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = 'e2e-artifacts/sidebar-modes';

test.skip(process.env.E2E_LOCAL !== '1', 'runs only against the local stack');
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

// Три режима панели чатов: expanded → collapsed → compact, плюс узкое окно.
// Скриншоты кладутся в e2e-artifacts/sidebar-modes/.
test('chat sidebar modes render and switch (expanded/collapsed/compact)', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat');
  await expect(page.getByTestId('chat-sidebar-desktop-header')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/01-expanded-1440.png`, fullPage: false });

  // Collapsed: rail — аватары + иконки папок, список имён скрыт.
  await page.getByRole('button', { name: 'Свернуть список чатов' }).click();
  await expect(page.getByRole('button', { name: 'Развернуть список чатов' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/02-collapsed-1440.png`, fullPage: false });

  // Обратно в expanded, затем compact: аватар + имя без preview.
  await page.getByRole('button', { name: 'Развернуть список чатов' }).click();
  await expect(page.getByRole('button', { name: 'Компактный список чатов' })).toBeVisible();
  await page.getByRole('button', { name: 'Компактный список чатов' }).click();
  await expect(page.getByRole('button', { name: 'Развернуть список чатов' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/03-compact-1440.png`, fullPage: false });
  // Горизонтальный скролл страницы отсутствует.
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientW = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollW).toBeLessThanOrEqual(clientW + 1);

  // Узкое окно 988×838 — rail по авто-схлопу или compact, переписке хватает места.
  await page.setViewportSize({ width: 988, height: 838 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/04-window-988x838.png`, fullPage: false });
  const scrollW2 = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW2).toBeLessThanOrEqual(989);
});
