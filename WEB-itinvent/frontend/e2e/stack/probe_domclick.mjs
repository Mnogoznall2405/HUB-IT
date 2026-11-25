// Does a DOM-level el.click() on the sidebar link navigate? If yes, the
// handler+router path is healthy and the loss is in the input pipeline.
import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const NAV_MY_FILES = '[data-testid="main-layout-sidebar-my-files"]';

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
let navLink = page.locator(NAV_MY_FILES).first();
if (!(await navLink.isVisible().catch(() => false))) {
  const toggle = page.locator('[data-testid^="main-layout-sidebar-tools-toggle"]').first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    navLink = page.locator(NAV_MY_FILES).first();
  }
}
// DOM click path — bypasses the browser input pipeline entirely.
const r = await page.evaluate(() => {
  const link = document.querySelector('[data-testid="main-layout-sidebar-my-files"]');
  if (!link) return { found: false };
  link.click();
  return { found: true, tag: link.tagName, href: link.getAttribute('href'), role: link.getAttribute('role'), tabindex: link.getAttribute('tabindex') };
});
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({ path: location.pathname, sidebarCount: document.querySelectorAll('[data-testid^="main-layout-sidebar-"]').length }));
console.log(JSON.stringify({ domClick: r, after }, null, 1));
await browser.close();
