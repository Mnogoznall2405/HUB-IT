import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) console.log(`>> ${r.method()} ${u.slice(22)}`); });
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('/api/')) {
    let body = '';
    try { body = (await r.text()).slice(0, 200); } catch {}
    console.log(`<< ${r.status()} ${u.slice(22)} ${body.replace(/\s+/g, ' ')}`);
  }
});
await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
const s = await page.evaluate(() => ({ url: location.href, ls: Object.keys(localStorage), user: localStorage.getItem('user')?.slice(0, 150) }));
console.log('STATE', JSON.stringify(s));
await browser.close();
