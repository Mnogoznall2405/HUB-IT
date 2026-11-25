import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`[nav] ${f.url()}`); });
page.on('console', (m) => { const t = m.text(); if (t.includes('error') || t.includes('Chunk') || t.includes('Failed')) console.log(`[console] ${t.slice(0, 160)}`); });
await page.goto(`${base}/login`);
const form = page.getByTestId('password-auth-form');
const methodBtn = page.getByRole('button', { name: /логином и паролем/i }).first();
if (await methodBtn.isVisible().catch(() => false)) await methodBtn.click();
await form.waitFor({ state: 'visible', timeout: 15000 });
await form.locator('input[name="username"]').fill('e2e_admin');
await form.locator('input[name="password"]').fill('e2e-local-admin-pass');
await form.getByRole('button', { name: 'Войти', exact: true }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 }).catch(() => {});
await page.goto(`${base}/`).catch(() => {});
await page.getByTestId('main-layout-content').waitFor({ state: 'visible' });
await page.waitForURL((u) => u.pathname !== '/', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);
let navLink = page.locator('[data-testid="main-layout-sidebar-my-files"]').first();
if (!(await navLink.isVisible().catch(() => false))) {
  const toggle = page.locator('[data-testid^="main-layout-sidebar-tools-toggle"]').first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    navLink = page.locator('[data-testid="main-layout-sidebar-my-files"]').first();
  }
}
console.log('--- DOM click on link ---');
await page.evaluate(() => {
  const link = document.querySelector('[data-testid="main-layout-sidebar-my-files"]');
  link.click();
}).catch(() => {});
for (let i = 0; i < 8; i += 1) {
  await page.waitForTimeout(500);
  console.log(`t+${(i + 1) * 500}ms url=${page.url()}`);
}
await browser.close();
