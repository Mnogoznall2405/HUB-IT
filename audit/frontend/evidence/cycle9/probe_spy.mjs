import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'user') {
      console.log(`[SPY] localStorage.user SET at ${location.pathname}: ${String(v).slice(0, 120)}`);
      console.log(new Error('trace').stack.slice(0, 1500));
    }
    return orig.apply(this, arguments);
  };
  const origGet = Storage.prototype.getItem;
  Storage.prototype.getItem = function (k) {
    const v = origGet.apply(this, arguments);
    if (k === 'user' && v) console.log(`[SPY] localStorage.user READ non-null at ${location.pathname}: ${String(v).slice(0, 100)}`);
    return v;
  };
});
page.on('console', (m) => { if (m.text().includes('SPY') || m.text().includes('trace')) console.log(m.text().slice(0, 600)); });
page.on('request', (r) => { const u = r.url(); if (/auth\/(login|refresh|me|sso)/.test(u)) console.log(`>> ${r.method()} ${u.slice(30)}`); });
page.on('response', (r) => { const u = r.url(); if (/auth\/(login|refresh|me|sso)/.test(u)) console.log(`<< ${r.status()} ${u.slice(30)}`); });
await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
console.log('FINAL URL:', page.url());
await browser.close();
