// Exact replica of the harness open_route click path + DOM event tap.
// Records pointerdown/up/click (capture) with target testid, and when the
// URL actually changes to /my-files — to see whether the click is dropped
// (DOM swap mid-click), intercepted (overlay), or handled but nav never runs.
import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const NAV_MY_FILES = '[data-testid="main-layout-sidebar-my-files"]';
const RUNS = Number(process.env.PROBE_RUNS || 6);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const out = [];
for (let i = 0; i < RUNS; i += 1) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__ev = [];
    const tid = (t) => (t && t.closest ? (t.closest('[data-testid]')?.dataset.testid || t.tagName) : '?');
    for (const type of ['pointerdown', 'pointerup', 'click', 'mousedown', 'mouseup']) {
      document.addEventListener(type, (e) => {
        window.__ev.push({ t: Math.round(performance.now()), type, target: tid(e.target), x: Math.round(e.clientX), y: Math.round(e.clientY) });
      }, true);
    }
  });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  const form = page.getByTestId('password-auth-form');
  const methodBtn = page.getByRole('button', { name: /логином и паролем/i }).first();
  if (await methodBtn.isVisible().catch(() => false)) await methodBtn.click();
  await form.waitFor({ state: 'visible', timeout: 15000 });
  await form.locator('input[name="username"]').fill('e2e_admin');
  await form.locator('input[name="password"]').fill('e2e-local-admin-pass');
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 }).catch(() => {});

  // Harness replica: goto '/', wait for the async redirect, +400ms, click.
  await page.goto(`${base}/`).catch(() => {});
  await page.getByTestId('main-layout-content').waitFor({ state: 'visible' });
  await page.waitForURL((u) => u.pathname !== '/', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  let navLink = page.locator(NAV_MY_FILES).first();
  if (!(await navLink.isVisible().catch(() => false))) {
    const toggle = page.locator('[data-testid^="main-layout-sidebar-tools-toggle"]').first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      navLink = page.locator(NAV_MY_FILES).first();
    }
  }
  // Watch the sidebar DOM for ~2.5s: count sidebar testids every 50ms to
  // find unmount/remount windows around the harness's click moment.
  const domWatch = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    const t0 = performance.now();
    const iv = setInterval(() => {
      samples.push({
        t: Math.round(performance.now() - t0),
        sidebar: document.querySelectorAll('[data-testid^="main-layout-sidebar-"]').length,
        link: Boolean(document.querySelector('[data-testid="main-layout-sidebar-my-files"]')),
        content: Boolean(document.querySelector('[data-testid="main-layout-content"]')),
        layoutNodes: document.querySelectorAll('nav, aside, header').length,
        body: document.body ? document.body.childElementCount : -1,
      });
      if (performance.now() - t0 > 2500) { clearInterval(iv); resolve(samples); }
    }, 50);
  }));
  const gaps = [];
  for (const s of domWatch) { if (!s.link) gaps.push(s.t); }
  console.log(`run ${i} sidebar-gap ms: ${gaps.length ? `${gaps[0]}..${gaps[gaps.length - 1]} (n=${gaps.length})` : 'none'}; sample: ${JSON.stringify(domWatch.filter((_, idx) => idx % 5 === 0).slice(0, 12))}`);
  const tClick = Date.now();
  let navRetries = 0;
  let firstTryOk = false;
  let clickMs = -1;
  let clickErr = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ct = Date.now();
    await navLink.click({ timeout: 8000 }).then(() => { clickMs = Date.now() - ct; }).catch((e) => { clickErr = String(e).split('\n')[0]; });
    // Snapshot IMMEDIATELY post-click, before any wait — catches fast
    // nav-then-revert and shows whether DOM events fired at all.
    const snap = await page.evaluate(() => ({
      path: location.pathname,
      ev: (window.__ev || []).slice(-10),
      evLen: (window.__ev || []).length,
    })).catch((e) => ({ evalErr: String(e).split('\n')[0] }));
    console.log(`run ${i} post-click snap: ${JSON.stringify(snap)}`);
    // Sanity: manual mouse click AT THE LINK's box + inert/ancestor scan.
    const geo = await page.evaluate(() => {
      const links = [...document.querySelectorAll('[data-testid="main-layout-sidebar-my-files"]')];
      return links.map((l) => {
        const r = l.getBoundingClientRect();
        const inert = !!l.closest('[inert]');
        const chain = [];
        let n = l;
        while (n && chain.length < 6) { chain.push(n.getAttribute?.('data-testid') || n.tagName + (n.inert ? '(inert)' : '')); n = n.parentElement; }
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), inert, chain };
      });
    });
    console.log(`run ${i} links: ${JSON.stringify(geo)}`);
    const g = geo.find((l) => l.w > 0);
    if (g) {
      await page.mouse.click(g.x, g.y).catch(() => {});
      const tapCheck = await page.evaluate(() => ({ evLen: (window.__ev || []).length, ev: (window.__ev || []).slice(-5), path: location.pathname })).catch(() => ({}));
      console.log(`run ${i} manual-click tap: ${JSON.stringify(tapCheck)}`);
    }
    try {
      await page.waitForURL((u) => u.pathname === '/my-files', { timeout: 4000 });
      firstTryOk = attempt === 0;
      break;
    } catch {
      navRetries += 1;
      await navLink.focus().catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForURL((u) => u.pathname === '/my-files', { timeout: 4000 }).catch(() => {});
      if (page.url().includes('/my-files')) break;
    }
  }
  const ev = await page.evaluate(() => window.__ev).catch(() => []);
  const state = await page.evaluate(() => {
    const link = document.querySelector('[data-testid="main-layout-sidebar-my-files"]');
    const r = link?.getBoundingClientRect();
    const el = link ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    return {
      linkVisible: link ? Boolean(r && r.width > 0 && r.height > 0) : false,
      coverTestid: el?.closest?.('[data-testid]')?.dataset.testid || el?.tagName || null,
      pendingBanner: Boolean(document.querySelector('[class*="MuiLinearProgress"], [data-testid*="pending"]')),
    };
  }).catch(() => ({}));
  out.push({ run: i, firstTryOk, navRetries, clickMs, clickErr, msToMyFiles: Date.now() - tClick, state, events: ev.slice(-12) });
  await context.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
