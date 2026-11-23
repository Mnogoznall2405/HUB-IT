import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

// Replicate probe_cycle9 login() exactly, with spies.
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__spy = [];
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'user' || k === 'hubit_browser_account') window.__spy.push(`SET ${k}=${String(v).slice(0, 80)} @${location.pathname}`);
    return orig.apply(this, arguments);
  };
});
page.on('request', (r) => { const u = r.url(); if (/auth\//.test(u)) console.log(`>> ${r.method()} ${u.slice(30)}`); });
page.on('response', (r) => { const u = r.url(); if (/auth\//.test(u)) console.log(`<< ${r.status()} ${u.slice(30)}`); });

await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
const early = await page.evaluate(() => ({ u: location.pathname, user: (localStorage.getItem('user') || '').slice(0, 60), spy: window.__spy }));
console.log('EARLY', JSON.stringify(early));

const form = page.getByTestId('password-auth-form');
try {
  await form.locator('input[name="username"]').waitFor({ timeout: 15000 });
  console.log('FORM FOUND');
  await form.locator('input[name="username"]').fill('e2e_fresh');
  await form.locator('input[name="password"]').fill('e2e-local-fresh-pass');
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  console.log('POST-LOGIN URL', page.url());
} catch (e) {
  const dbg = await page.evaluate(() => ({ url: location.href, user: (localStorage.getItem('user') || '').slice(0, 80), ls: Object.keys(localStorage), spy: window.__spy }));
  console.log('MISSING', JSON.stringify(dbg, null, 1));
}
await browser.close();
