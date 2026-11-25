// Browser check of server-side pagination: page-1 limit, scroll prefetch,
// select-all-N coverage of unloaded rows.
import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const FOLDER_1000 = 'ba4e6ae1501e493fbea8037da36282e9';
const ROW_SEL = '[data-testid^="my-files-card-"]:not([data-testid^="my-files-card-menu-"]), '
  + '[data-testid^="my-files-folder-"]:not([data-testid^="my-files-folder-menu-"]):not([data-testid="my-files-folder-input"])';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 200)));

const apiCalls = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/v1/my-files') && !u.includes('upload') && !u.includes('libraries')) {
    apiCalls.push(new URL(u).search || u.split('?')[1] || '');
  }
});

await page.goto(`${base}/login`);
const form = page.getByTestId('password-auth-form');
const formVisible = await form.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
if (!formVisible) {
  const b = page.getByRole('button', { name: /логином и паролем|password/i }).first();
  if (await b.isVisible().catch(() => false)) await b.click();
}
await form.waitFor({ state: 'visible', timeout: 20000 });
await form.locator('input[name="username"]').fill('e2e_admin');
await form.locator('input[name="password"]').fill('e2e-local-admin-pass');
await form.getByRole('button', { name: 'Войти', exact: true }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30000 });

await page.goto(`${base}/my-files?folder=${FOLDER_1000}`);
await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 45000 });
await page.waitForTimeout(400);

const firstCall = apiCalls.find((q) => q.includes('folder_id='));
console.log('page-1 call:', firstCall ? firstCall.slice(0, 160) : 'NONE');
if (!firstCall || !firstCall.includes('limit=150')) throw new Error('page-1 did not request limit=150');

// Unique rendered row ids now (virtualized — DOM holds a window only).
const countRendered = () => page.locator(ROW_SEL).evaluateAll(
  (els) => new Set(els.map((e) => e.dataset.testid)).size,
);
const renderedBefore = await countRendered();

// Scroll the document to the end → keyset prefetch must fire.
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(1200);
const pageCalls = apiCalls.filter((q) => q.includes('cursor='));
console.log('page-N calls:', pageCalls.length, pageCalls[0] ? pageCalls[0].slice(0, 120) : '');
if (!pageCalls.length) throw new Error('scroll did not trigger a cursor fetch');

// Checkbox selects loaded rows; the "select all N" action must appear.
await page.locator('[data-testid="my-files-select-all"]').first().click();
await page.waitForTimeout(300);
const selectAllSet = page.getByTestId('my-files-select-all-set');
const visible = await selectAllSet.isVisible().catch(() => false);
console.log('select-all-set visible:', visible, 'label:', visible ? await selectAllSet.innerText() : '');
if (!visible) throw new Error('select-all-N action missing');

// Click it → an unpaginated fetch for the whole set must follow.
const callsBefore = apiCalls.length;
await selectAllSet.click();
await page.waitForTimeout(1500);
const wholeSetCall = apiCalls.slice(callsBefore).find((q) => !q.includes('cursor=') && !q.includes('limit='));
console.log('whole-set call:', wholeSetCall ? 'yes' : 'NO');
const selBar = await page.getByTestId('my-files-selection-bar').innerText();
console.log('selection bar:', selBar.slice(0, 80));
if (!selBar.includes('1000')) throw new Error('selection did not cover the whole set');

console.log('UI PAGINATION PROBE OK');
await browser.close();
