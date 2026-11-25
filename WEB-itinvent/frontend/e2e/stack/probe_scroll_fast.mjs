// Decompose scroll_fast: same rAF gesture as the harness (500px/frame, 1.5s)
// on the f1000 folder; record longtask timings + when the page-N fetch lands.
// Usage: PROBE_BASE=http://127.0.0.1:5184 node e2e/stack/probe_scroll_fast.mjs
import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const FOLDER_1000 = 'ba4e6ae1501e493fbea8037da36282e9';
const ROW_SEL = '[data-testid^="my-files-card-"]:not([data-testid^="my-files-card-menu-"]), [data-testid^="my-files-folder-"]:not([data-testid^="my-files-folder-menu-"]):not([data-testid="my-files-folder-input"])';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();

const apiT = [];
page.on('response', (res) => {
  const u = res.url();
  if (u.includes('/api/v1/my-files?') || u.includes('/api/v1/my-files&')) {
    apiT.push({ t: Date.now(), q: (u.split('?')[1] || '').slice(0, 90), status: res.status() });
  }
});

await page.addInitScript(() => {
  window.__lt = [];
  window.__frames = [];
  try {
    new PerformanceObserver((es) => {
      for (const e of es.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* noop */ }
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
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30000 });
await page.waitForTimeout(1200);

await page.goto(`${base}/my-files?folder=${FOLDER_1000}`).catch(() => page.goto(`${base}/my-files?folder=${FOLDER_1000}`));
await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 45000 });
await page.waitForTimeout(800);
apiT.length = 0;

const r = await page.evaluate(async ({ sel }) => {
  const candidates = [...document.querySelectorAll(sel)].filter((el) => el.scrollHeight > el.clientHeight + 200);
  const sc = candidates[0] || document.scrollingElement;
  sc.scrollTop = 0;
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  window.__lt.length = 0;
  const stepPx = 500; const durMs = 1500;
  let frames = 0; let worst = 0; let worstT = 0; let prev = performance.now();
  const t0 = prev;
  await new Promise((resolve) => {
    const step = (t) => {
      const dt = t - prev; prev = t;
      if (dt > worst) { worst = dt; worstT = t - t0; }
      frames += 1;
      sc.scrollTop = (sc.scrollTop + stepPx) % Math.max(1, sc.scrollHeight - sc.clientHeight);
      if (t - t0 < durMs) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  return {
    scroller: sc === document.scrollingElement ? 'document' : (sc.getAttribute('data-testid') || sc.className || 'inner'),
    frames, worst: Math.round(worst), worstT: Math.round(worstT),
    lts: window.__lt.map((e) => ({ s: Math.round(e.s - t0), d: Math.round(e.d) })),
  };
}, { sel: ROW_SEL });

console.log(JSON.stringify(r, null, 1));
console.log('API during gesture:', apiT.map((e) => `${e.status} +${e.t}ms? ${e.q}`).join('\n'));
await browser.close();
