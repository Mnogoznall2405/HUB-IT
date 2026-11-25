// Quick smoke: login on preview build and check my-files cards render.
import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
await page.goto(`${base}/login`);
const form = page.getByTestId('password-auth-form');
const ok = await form.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
console.log('form:', ok);
await form.locator('input[name="username"]').fill('e2e_admin');
await form.locator('input[name="password"]').fill('e2e-local-admin-pass');
await form.getByRole('button', { name: 'Войти', exact: true }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 }).catch(() => console.log('no redirect'));
console.log('after login url:', page.url());
await page.goto(`${base}/my-files`);
const t0 = Date.now();
const sel = '[data-testid^="my-files-card-"]:not([data-testid^="my-files-card-menu-"]), [data-testid^="my-files-folder-"]:not([data-testid^="my-files-folder-menu-"]):not([data-testid="my-files-folder-input"])';
const cards = await page.locator(sel).first().waitFor({ state: 'visible', timeout: 45000 }).then(() => true).catch(() => false);
console.log('cards:', cards, Date.now() - t0, 'ms');
if (!cards) {
  const ids = await page.locator('[data-testid]').evaluateAll((els) => els.map((e) => e.dataset.testid).slice(0, 40));
  console.log('testids:', JSON.stringify(ids));
  console.log('body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 400));
}
await browser.close();
