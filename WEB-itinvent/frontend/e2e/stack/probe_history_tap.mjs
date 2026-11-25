import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  window.__hist = [];
  const tap = (name) => {
    const orig = history[name].bind(history);
    history[name] = (state, title, url) => {
      window.__hist.push({ t: Math.round(performance.now()), op: name, url: String(url) });
      return orig(state, title, url);
    };
  };
  tap('pushState');
  tap('replaceState');
});
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
await page.evaluate(() => { window.__hist = []; });
await navLink.click().catch(() => {});
await page.waitForTimeout(3000);
const hist = await page.evaluate(() => ({ hist: window.__hist, path: location.pathname }));
console.log(JSON.stringify(hist, null, 1));
await browser.close();
