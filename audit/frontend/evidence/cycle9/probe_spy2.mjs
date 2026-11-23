import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const of = window.fetch;
  window.__posts = [];
  window.fetch = function (...args) {
    try {
      const url = String(args[0]?.url || args[0]);
      if (url.includes('/auth/login')) {
        const body = args[1]?.body;
        window.__posts.push({ url, body: typeof body === 'string' ? body.slice(0, 200) : String(body).slice(0, 200), stack: new Error('x').stack?.slice(0, 800) });
      }
    } catch {}
    return of.apply(this, args);
  };
});
const report = { failedReqs: [] };
page.on('response', (r) => { if (r.url().includes('/api/')) report.failedReqs.push({ url: r.url().slice(0, 160), status: r.status() }); });
await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
const form = page.getByTestId('password-auth-form');
try {
  await form.locator('input[name="username"]').waitFor({ timeout: 15000 });
  console.log('FORM OK');
} catch {
  const dbg = await page.evaluate(() => ({ url: location.href, user: (localStorage.getItem('user') || '').slice(0, 80), posts: window.__posts }));
  console.log('MISSING', JSON.stringify(dbg, null, 1));
}
console.log('POSTS SEEN:', JSON.stringify(await page.evaluate(() => window.__posts)));
await browser.close();
