// Decomposition probe for open_route settled: what happens between the
// sidebar click and the last DOM mutation on /my-files (SPA navigation,
// same as the perf harness measures).
// Usage: PROBE_BASE=http://127.0.0.1:5184 node e2e/stack/probe_open_route_decomp.mjs
import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const ROW_SEL = '[data-testid^="my-files-card-"]:not([data-testid^="my-files-card-menu-"]), [data-testid^="my-files-folder-"]:not([data-testid^="my-files-folder-menu-"]):not([data-testid="my-files-folder-input"])';
const NAV_MY_FILES = '[data-testid="main-layout-sidebar-my-files"]';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();

await page.addInitScript(() => {
  window.__muts = [];
  window.__apiLog = [];
  window.__t0 = 0;
  const mo = new MutationObserver((list) => {
    window.__muts.push({ t: performance.now(), n: list.length });
  });
  mo.observe(document, { childList: true, subtree: true, attributes: true });
  new PerformanceObserver((entries) => {
    for (const e of entries.getEntries()) {
      if (e.name.includes('/api/')) window.__apiLog.push({ name: e.name, start: e.startTime, dur: e.duration });
    }
  }).observe({ type: 'resource', buffered: true });
});

await page.goto(`${base}/login`);
const form = page.getByTestId('password-auth-form');
const formVisible = await form.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
if (!formVisible) {
  const methodBtn = page.getByRole('button', { name: /логином и паролем|password/i }).first();
  if (await methodBtn.isVisible().catch(() => false)) await methodBtn.click();
}
await form.waitFor({ state: 'visible', timeout: 15000 });
await form.locator('input[name="username"]').fill('e2e_admin');
await form.locator('input[name="password"]').fill('e2e-local-admin-pass');
await form.getByRole('button', { name: 'Войти', exact: true }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 }).catch(() => {});

// Warm app: visit my-files once so the chunk is loaded.
await page.goto(`${base}/my-files`);
await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
// Reproduce the harness: land on the home route and click the sidebar link as
// soon as it is visible — while the dashboard is still mounting.
await page.goto(`${base}/dashboard`).catch(() => {});
// "Мой диск" sits inside the collapsed "tools" sidebar group — expand it like
// the harness does, then click immediately while the dashboard still mounts.
await page.locator('[data-testid^="main-layout-sidebar-"]').first().waitFor({ state: 'visible', timeout: 15000 });
let navLink = page.locator(NAV_MY_FILES).first();
if (!(await navLink.isVisible().catch(() => false))) {
  const toggle = page.locator('[data-testid^="main-layout-sidebar-tools-toggle"]').first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    navLink = page.locator(NAV_MY_FILES).first();
  }
}
await navLink.waitFor({ state: 'visible', timeout: 15000 });

// SPA navigate via the sidebar link (what the harness measures).
await page.evaluate(() => {
  window.__muts = [];
  window.__apiLog = [];
  window.__t0 = performance.now();
});
await navLink.click();
await page.waitForURL((u) => u.pathname === '/my-files', { timeout: 8000 }).catch(() => {});

const firstRow = await page.evaluate(async () => {
  const t0 = window.__t0;
  return await new Promise((resolve) => {
    const check = () => {
      const row = document.querySelector('[data-testid^="my-files-card-"], [data-testid^="my-files-folder-"]:not([data-testid="my-files-folder-input"])');
      if (row) return resolve(Math.round(performance.now() - t0));
      if (performance.now() - t0 > 30000) return resolve(-1);
      requestAnimationFrame(check);
    };
    check();
  });
});

const settled = await page.evaluate(async () => {
  const t0 = window.__t0;
  return await new Promise((resolve) => {
    const check = () => {
      const muts = window.__muts;
      const now = performance.now();
      const last = muts.length ? muts[muts.length - 1].t : 0;
      if (muts.length && now - last > 120) return resolve(Math.round(last - t0));
      if (now - t0 > 15000) return resolve(Math.round(last - t0));
      setTimeout(check, 50);
    };
    check();
  });
});

const apiLog = await page.evaluate(() => window.__apiLog.map((e) => {
  const u = new URL(e.name);
  return { path: u.pathname + u.search, start: Math.round(e.start - (window.__navEpoch || 0)), dur: Math.round(e.dur) };
}));
const muts = await page.evaluate(() => window.__muts.map((m) => Math.round(m.t - window.__t0)).filter((t) => t >= 0));

// Group mutations into windows of 500ms to see the tail shape.
const buckets = {};
for (const t of muts) {
  const b = Math.floor(t / 500) * 500;
  buckets[b] = (buckets[b] || 0) + 1;
}

console.log(JSON.stringify({
  first_row_ms: firstRow,
  settled_ms: settled,
  mutation_windows: buckets,
  total_mutations: muts.length,
  api: apiLog,
}, null, 1));
await browser.close();
