// Wave3 runtime probe: heap across route switches + zoom mail/tasks/database.
import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';
const BASE = 'http://127.0.0.1:5174';
const api = 'http://127.0.0.1:18001/api';
const ROUTES = ['/dashboard', '/tasks', '/mail', '/my-files', '/scan-center', '/help', '/networks', '/chat'];
const browser = await chromium.launch({channel:'chrome'});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERR ' + String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 160)); });

await page.goto(BASE + '/login');
const form = page.getByTestId('password-auth-form');
await form.locator('input[name="username"]').fill('e2e_admin');
await form.locator('input[name="password"]').fill('e2e-local-admin-pass');
await form.getByRole('button', { name: 'Войти', exact: true }).click();
await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

// --- Heap probe: 3 rounds through all routes ---
const heap = [];
const client = await ctx.newCDPSession(page);
for (let round = 0; round < 3; round++) {
  for (const r of ROUTES) {
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  const m = await client.send('Runtime.evaluate', { expression: 'performance.memory ? performance.memory.usedJSHeapSize : 0', returnByValue: true });
  heap.push(Math.round((m.result.value || 0) / 1048576));
  console.log(`round ${round + 1} heap: ${heap[heap.length - 1]}MB`);
}
// listeners count check via Performance measurement is complex; heap trend suffices.

// --- Zoom probe: mail/tasks/database at 150% and 200% ---
for (const zoom of ['1.5', '2.0']) {
  for (const r of ['/mail', '/tasks', '/database', '/help']) {
    await page.emulateMedia({ reducedMotion: null }).catch(() => {});
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate(z => { document.documentElement.style.zoom = z; }, zoom).catch(() => {});
    await page.waitForTimeout(400);
    const o = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: window.innerWidth, url: location.pathname }));
    const hof = o.docW - o.vw;
    console.log(`zoom ${zoom} ${r}: docW=${o.docW} overflow=${hof}px`);
  }
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; }).catch(() => {});
}

// --- Session error matrix: what happens when backend kills session (403 on a page) ---
const bctx = await browser.newContext();
const bp = await bctx.newPage();
await bp.goto(BASE + '/login');
const bf = bp.getByTestId('password-auth-form');
await bf.locator('input[name="username"]').fill('e2e_fresh');
await bf.locator('input[name="password"]').fill('e2e-local-fresh-pass');
await bf.getByRole('button', { name: 'Войти', exact: true }).click();
await bp.waitForTimeout(2500);
console.log('fresh-user url:', bp.url());
// inject 500 on next api request to see error UX
await bp.route('**/api/**', route => route.fulfill({ status: 500, body: '{"detail":"forced-500"}' }));
await bp.goto(BASE + '/tasks', { waitUntil: 'domcontentloaded' }).catch(() => {});
await bp.waitForTimeout(2500);
const vis = await bp.evaluate(() => ({ url: location.pathname, errText: document.body.innerText.slice(0, 400) }));
console.log('500-mode /tasks →', JSON.stringify(vis).slice(0, 500));
await bctx.close();

console.log('errors:', errors.length ? errors.slice(0, 15) : 'none');
await browser.close();
