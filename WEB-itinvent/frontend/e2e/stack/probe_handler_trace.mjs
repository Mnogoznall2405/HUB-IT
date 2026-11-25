import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  window.__hist = [];
  for (const name of ['pushState', 'replaceState']) {
    const orig = history[name].bind(history);
    history[name] = (s, t, u) => { window.__hist.push({ t: Math.round(performance.now()), op: name, url: String(u) }); return orig(s, t, u); };
  }
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
// Arm a native listener on the link, then REAL playwright click.
const r = await page.evaluate(() => {
  const link = document.querySelector('[data-testid="main-layout-sidebar-my-files"]');
  window.__linkEvents = [];
  link.addEventListener('click', () => window.__linkEvents.push({ t: Math.round(performance.now()), type: 'click-on-link' }), true);
  return { attached: true, rect: JSON.stringify(link.getBoundingClientRect()) };
});
await navLink.click().catch((e) => console.log('click err', String(e).split('\n')[0]));
await page.waitForTimeout(2500);
const out = await page.evaluate(() => ({
  linkEvents: window.__linkEvents,
  hist: window.__hist,
  path: location.pathname,
  linkExists: Boolean(document.querySelector('[data-testid="main-layout-sidebar-my-files"]')),
  bodyClickable: getComputedStyle(document.querySelector('[data-testid="main-layout-sidebar-my-files"]') || document.body).pointerEvents,
}));
console.log(JSON.stringify(out, null, 1));
await browser.close();
