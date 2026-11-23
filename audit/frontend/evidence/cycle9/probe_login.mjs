import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on('request', (r) => { if (r.url().includes('/api/')) logs.push(`REQ ${r.method()} ${r.url().slice(0, 140)}`); });
page.on('response', (r) => { if (r.url().includes('/api/')) logs.push(`RESP ${r.status()} ${r.url().slice(0, 140)}`); });

await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
for (const wait of [2000, 4000]) {
  await page.waitForTimeout(wait);
  const s = await page.evaluate(() => ({
    url: location.href,
    hasForm: !!document.querySelector('[data-testid="password-auth-form"]'),
    ls: Object.keys(localStorage),
    user: localStorage.getItem('user')?.slice(0, 200) ?? null,
    text: document.body.innerText.slice(0, 200),
  }));
  console.log(JSON.stringify(s, null, 1));
}
console.log('--- console/net ---');
logs.forEach((l) => console.log(l));
await browser.close();
