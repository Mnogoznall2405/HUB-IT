import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
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
// Watch pathname at 10ms resolution while a DOM click fires.
const trace = await page.evaluate(() => new Promise((resolve) => {
  const link = document.querySelector('[data-testid="main-layout-sidebar-my-files"]');
  const samples = [{ t: 0, p: location.pathname }];
  const t0 = performance.now();
  let last = location.pathname;
  const iv = setInterval(() => {
    if (location.pathname !== last) {
      samples.push({ t: Math.round(performance.now() - t0), p: location.pathname });
      last = location.pathname;
    }
    if (performance.now() - t0 > 3000) { clearInterval(iv); resolve(samples); }
  }, 10);
  link.click();
}));
console.log(JSON.stringify(trace));
await browser.close();
