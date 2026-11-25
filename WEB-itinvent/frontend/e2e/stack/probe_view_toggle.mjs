// Decomposition probe for view_toggle settled: mutation/commit timeline after
// the list->grid switch inside the f100 folder.
// Usage: PROBE_BASE=http://127.0.0.1:5184 PROBE_FOLDER=<fid> node e2e/stack/probe_view_toggle.mjs
import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const FOLDER = process.env.PROBE_FOLDER || '9e941cbdb9324de59fb21dde3729e783'; // f100

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();

await page.addInitScript(() => {
  window.__muts = [];
  window.__lt = [];
  const mo = new MutationObserver((list) => {
    window.__muts.push({ t: performance.now(), n: list.length });
  });
  mo.observe(document, { childList: true, subtree: true, attributes: true });
  try {
    new PerformanceObserver((es) => {
      for (const e of es.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask support */ }
});

await page.goto(`${base}/login`);
const form = page.getByTestId('password-auth-form');
const formVisible = await form.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
if (!formVisible) {
  const b = page.getByRole('button', { name: /логином и паролем|password/i }).first();
  if (await b.isVisible().catch(() => false)) await b.click();
}
await form.waitFor({ state: 'visible', timeout: 20000 });
await form.locator('input[name="username"]').fill('e2e_admin');
await form.locator('input[name="password"]').fill('e2e-local-admin-pass');
await form.getByRole('button', { name: 'Войти', exact: true }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 });

await page.goto(`${base}/my-files?folder=${FOLDER}`);
const ROW_SEL = '[data-testid^="my-files-card-"]:not([data-testid^="my-files-card-menu-"]), [data-testid^="my-files-folder-"]:not([data-testid^="my-files-folder-menu-"]):not([data-testid="my-files-folder-input"])';
await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(1200);

const results = [];
for (let i = 0; i < 5; i += 1) {
  const t0 = await page.evaluate(() => (window.__muts = [], window.__lt = [], performance.now()));
  const gridBtn = page.locator('[data-testid="my-files-view-grid"]').first();
  const listBtn = page.locator('[data-testid="my-files-view-list"]').first();
  const btn = (await gridBtn.isVisible().catch(() => false)) ? gridBtn : listBtn;
  const to = btn === gridBtn ? 'grid' : 'list';
  await btn.click();
  await page.waitForTimeout(900);
  const r = await page.evaluate((t0) => {
    const muts = window.__muts.map((m) => Math.round(m.t - t0));
    const last = muts.length ? muts[muts.length - 1] : -1;
    const first = muts.length ? muts[0] : -1;
    return {
      first_mut: first,
      last_mut: last,
      total: muts.length,
      late: muts.filter((t) => t > 250),
      longtasks: window.__lt.map((e) => ({ s: Math.round(e.s - t0), d: Math.round(e.d) })),
      gridNodes: document.querySelectorAll('[data-testid="my-files-grid"] *').length,
      listNodes: document.querySelectorAll('[data-testid="my-files-list-panel"] *').length,
    };
  }, t0);
  console.log(`${to}: ${JSON.stringify(r)}`);
  results.push(r);
  await page.waitForTimeout(400);
}
await browser.close();
