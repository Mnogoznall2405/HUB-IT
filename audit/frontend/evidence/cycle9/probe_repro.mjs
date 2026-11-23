import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

for (let i = 0; i < 4; i++) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const s = await page.evaluate(() => ({ url: location.href, user: localStorage.getItem('user')?.slice(0, 60) ?? null }));
  console.log(`run ${i}: ${s.url} user=${s.user}`);
  await browser.close();
}
