import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

const mode = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
if (mode === 'write') {
  await page.evaluate(() => localStorage.setItem('probe_marker', 'MARKER_' + Date.now()));
  console.log('wrote marker');
} else {
  const v = await page.evaluate(() => localStorage.getItem('probe_marker'));
  console.log('marker =', v);
}
await browser.close();
