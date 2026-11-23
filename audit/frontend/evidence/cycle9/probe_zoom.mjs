// Cycle-9 zoom probe: measure horizontal overflow + console errors at 80%/100%/150%
// on key pages. CSS `zoom` on <body> approximates browser zoom for layout overflow.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('C:/Project/HUB-IT-main/WEB-itinvent/frontend/package.json');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5174';
const OUT = 'C:/Project/HUB-IT-main/audit/frontend/evidence/cycle9/shots';
const results = [];

async function measure(page, label) {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const overflows = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (el.scrollWidth - el.clientWidth) > 4 && el.scrollWidth > window.innerWidth + 4) {
        if (overflows.length < 8) {
          overflows.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).slice(0, 60)}`);
        }
      }
    });
    return {
      docScrollW: de.scrollWidth,
      innerW: window.innerWidth,
      bodyScrollW: document.body?.scrollWidth || 0,
      overflowed: de.scrollWidth > window.innerWidth + 2,
      wideEls: overflows,
    };
  });
  results.push({ label, ...m });
  console.log(`${label}: docW=${m.docScrollW} innerW=${m.innerW} overflow=${m.overflowed}`);
  if (m.wideEls.length) console.log('  wide:', m.wideEls.join(' | '));
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERR ' + String(e).slice(0, 200)));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('[data-testid="password-auth-form"], input[type="password"]', { timeout: 30000 });
await page.fill('input[name="username"], input[autocomplete="username"], input[type="text"]', 'e2e_admin');
await page.fill('input[type="password"]', 'e2e-local-admin-pass');
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|about/, { timeout: 30000 });
console.log('LANDED:', page.url());

const routes = ['/dashboard', '/chat', '/scan-center', '/my-files'];
for (const route of routes) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500);
  for (const z of [0.8, 1, 1.5]) {
    await page.evaluate((zz) => { document.body.style.zoom = String(zz); }, z);
    await page.waitForTimeout(600);
    const tag = route.replace('/', '') || 'root';
    await measure(page, `${tag}@${z}`);
    if (z !== 1) await page.screenshot({ path: `${OUT}/zoom-${tag}-${z}.png`, fullPage: false });
  }
  await page.evaluate(() => { document.body.style.zoom = '1'; });
}

console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors.slice(0, 15), null, 1));
fs.writeFileSync('C:/Project/HUB-IT-main/audit/frontend/evidence/cycle9/probe-zoom-results.json', JSON.stringify(results, null, 2));
await browser.close();
console.log('DONE');
