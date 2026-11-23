import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
console.log('COOKIES BEFORE NAV:', JSON.stringify(await ctx.cookies()));
await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
console.log('COOKIES AFTER NAV:', JSON.stringify((await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain, path: c.path, httpOnly: c.httpOnly, value: c.value.slice(0, 40) })), null, 1));
const s = await page.evaluate(() => ({ url: location.href, user: (localStorage.getItem('user') || '').slice(0, 80) }));
console.log('STATE', JSON.stringify(s));
await browser.close();
