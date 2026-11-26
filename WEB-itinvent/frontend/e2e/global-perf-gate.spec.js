// Release-gate GLOBAL perf A/B (gate part 5): cold login→dashboard first
// paint, SPA route transitions, seeded file-list load, search echo,
// per-scenario resources (API requests, network bytes, longTasks, JS heap)
// and a 20-cycle module-switch memory probe.
//
// The same file is copied verbatim into both worktrees so the measurement
// code is byte-identical on baseline (926dd9f5) and candidate
// (integration/frontend-remediation). In-page timing: t0 via
// performance.now() before the action, readiness polled every rAF; for
// cross-navigation cold runs both marks are taken on Date.now().
//
// Run: E2E_LOCAL=1 E2E_BUILD=1 E2E_GATE_SIDE=base|cand \
//      npx playwright test e2e/global-perf-gate.spec.js
// Knobs: E2E_GP_RUNS=30 (transitions/search/file-list),
//        E2E_GP_COLD=30 (cold login), E2E_GP_DURABILITY=20 (cycles),
//        E2E_GP_FILES=25 (seeded files), E2E_GP_VIEWPORT=1440x900.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

/* global window, document, performance, PerformanceObserver, XMLHttpRequest, fetch, location, process */

const U1 = process.env.E2E_USERNAME || 'e2e_admin';
const P1 = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const RUNS = Number(process.env.E2E_GP_RUNS || 30);
const COLD = Number(process.env.E2E_GP_COLD || 30);
const DURABILITY_CYCLES = Number(process.env.E2E_GP_DURABILITY || 20);
const SEED_FILES = Number(process.env.E2E_GP_FILES || 25);
const SIDE = process.env.E2E_GATE_SIDE || 'run';
const VP = (() => {
  const [w, h] = (process.env.E2E_GP_VIEWPORT || '1440x900').split('x').map(Number);
  return { width: w || 1440, height: h || 900 };
})();
const SHOTS = 'e2e-artifacts/release-gate-perf';

test.skip(process.env.E2E_LOCAL !== '1', 'global perf gate needs the local stack: run with E2E_LOCAL=1 E2E_BUILD=1');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

// Route under test: sidebar nav testid + readiness marker that is present on
// BOTH revisions. Marker lists are OR-ed (first present wins) so renderer
// differences between the branches cannot fake a verdict.
const ROUTES = [
  { key: 'dashboard', path: '/dashboard', nav: 'main-layout-sidebar-dashboard', marker: `[data-testid="dashboard-sections"]` },
  { key: 'chat', path: '/chat', nav: 'main-layout-sidebar-chat', marker: `[data-testid="chat-sidebar-list-scroll"]` },
  { key: 'mail', path: '/mail', nav: 'main-layout-sidebar-mail', marker: `[data-testid="mail-desktop-area"], [data-testid="mail-list-panel"], [data-testid="mail-mobile-list-screen"], [data-testid="mail-toolbar-desktop"], [data-testid="mail-toolbar-mobile-header"]` },
  { key: 'my-files', path: '/my-files', nav: 'main-layout-sidebar-my-files', marker: `[data-testid="my-files-filters"], [data-testid="my-files-breadcrumbs"], [data-testid="my-files-grid"], [data-testid="my-files-rows"]` },
  { key: 'tasks', path: '/tasks', nav: 'main-layout-sidebar-tasks', marker: `[data-testid="tasks-desktop-toolbar"], [data-testid="tasks-create-fab"]` },
];
// Transition cycle: every leg gets n = RUNS samples, directions alternate.
const LEGS = ['dashboard', 'chat', 'mail', 'my-files', 'tasks'];
const ROUTE = Object.fromEntries(ROUTES.map((r) => [r.key, r]));

const installHook = () => {
  // profiles: required on the candidate (ChatPerfProbe writes onRender);
  // inert on the baseline. Keep the field for byte-identical instrumentation.
  window.__perf = { t0: null, commits: [], longTasks: [], profiles: {}, requests: [], paints: {} };
  window.__longTasks = window.__perf.longTasks;
  const hook = {
    renderers: new Map(),
    listeners: {},
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    sub() { return () => {}; },
    on() {},
    off() {},
    emit() {},
    checkDCE(fn) { try { fn(); } catch { /* noop */ } },
    supportsFiber: true,
    getFiberRoots() { return new Set(); },
    onCommitFiberRoot(id, root) {
      let rendered = 0;
      try {
        const seen = new Set();
        const stack = [root.current];
        while (stack.length && seen.size < 100000) {
          const f = stack.pop();
          if (!f || seen.has(f)) continue;
          seen.add(f);
          if (f.flags & 1) rendered += 1;
          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
        }
      } catch { rendered = -1; }
      window.__perf.commits.push({ t: performance.now(), rendered });
    },
    onCommitFiberUnmount() {},
    onScheduleFiberRoot() {},
  };
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook });
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => window.__perf.longTasks.push({ start: e.startTime, duration: e.duration }));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* noop */ }
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => { window.__perf.paints[e.name] = e.startTime; });
    }).observe({ entryTypes: ['paint'] });
  } catch { /* noop */ }
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => { window.__perf.paints['largest-contentful-paint'] = e.startTime; });
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* noop */ }
  // XHR/fetch recorder: API calls that start inside a measured window are
  // attributed to that scenario (count + URL list for root-causing).
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(method, url) {
    try {
      const rec = { kind: 'xhr', method: String(method), url: String(url), t: performance.now() };
      window.__perf.requests.push(rec);
    } catch { /* noop */ }
    return xhrOpen.apply(this, arguments);
  };
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function wrappedFetch(input, init) {
      try {
        const url = typeof input === 'string' ? input : input?.url;
        const method = init?.method || (typeof input === 'object' ? input?.method : '') || 'GET';
        window.__perf.requests.push({ kind: 'fetch', method: String(method), url: String(url), t: performance.now() });
      } catch { /* noop */ }
      return origFetch.apply(this, arguments);
    };
  }
};

const waitMark = async (page, predSrc, timeout = 10000) => {
  try {
    await page.waitForFunction(`(${predSrc})()`, undefined, { timeout, polling: 'raf' });
  } catch { return -1; }
  return page.evaluate(() => performance.now());
};

// Cross-navigation marks (cold login): performance.now() resets per document.
const waitMarkDate = async (page, predSrc, timeout = 30000) => {
  try {
    await page.waitForFunction(`(${predSrc})()`, undefined, { timeout, polling: 'raf' });
  } catch { return -1; }
  return page.evaluate(() => Date.now());
};

// Per-window resource snapshot: commits, API calls (hook), bytes via
// ResourceTiming (covers chunks/css/img that bypass fetch/XHR), longTasks,
// JS heap. Same collector on both revisions.
const windowStats = (page, t0, span = 4000) => page.evaluate(([t, s]) => {
  const lo = t - 2;
  const hi = t + s;
  const cs = window.__perf.commits.filter((c) => c.t >= lo && c.t <= hi);
  const apiReqs = window.__perf.requests.filter((r) => r.t >= lo && r.t <= hi);
  const res = performance.getEntriesByType('resource').filter((e) => e.startTime >= lo && e.startTime <= hi);
  return {
    commits: cs.length,
    rendered: cs.reduce((sum, c) => sum + Math.max(0, c.rendered), 0),
    apiRequests: apiReqs.length,
    apiUrls: apiReqs.map((r) => `${r.method} ${r.url}`),
    netBytes: res.reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0),
    netResources: res.length,
    longTasks: window.__perf.longTasks.filter((lt) => lt.start >= lo && lt.start <= hi).length,
    longTaskMs: Math.round(window.__perf.longTasks.filter((lt) => lt.start >= lo && lt.start <= hi).reduce((sum, lt) => sum + lt.duration, 0)),
    heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576),
  };
}, [t0, span]);

const stats = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, p50: null, p95: null, min: null, max: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
  return {
    n: sorted.length,
    p50: Math.round(pick(0.5) * 10) / 10,
    p95: Math.round(pick(0.95) * 10) / 10,
    min: Math.round(sorted[0] * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10,
  };
};

const aggSamples = (samples) => ({
  ms: stats(samples.map((s) => s.ms)),
  apiRequests: stats(samples.map((s) => s.apiRequests)),
  netBytes: stats(samples.map((s) => s.netBytes)),
  netResources: stats(samples.map((s) => s.netResources)),
  commits: stats(samples.map((s) => s.commits)),
  rendered: stats(samples.map((s) => s.rendered)),
  longTasks: samples.reduce((a, s) => a + s.longTasks, 0),
  longTaskMs: samples.reduce((a, s) => a + s.longTaskMs, 0),
  heapMB: stats(samples.map((s) => s.heapMB)),
  timeouts: samples.filter((s) => s.timedOut).length,
});

async function apiLogin(page, username = U1, password = P1) {
  const resp = await page.request.post('/api/v1/auth/login', { data: { username, password } });
  expect(resp.ok(), `login ${username}`).toBeTruthy();
}

const routePred = (routeKey, extra = '') => {
  const r = ROUTE[routeKey];
  return `() => location.pathname === '${r.path}' && Boolean(document.querySelector('${r.marker}'))${extra ? ` && (${extra})` : ''}`;
};

// Nav testids are rendered in every drawer instance (mobile drawer,
// desktop rail/sidebar, chat overlay) — the hidden ones keep resolving and
// .first() can pick an invisible node. Scope every click to :visible.
// On /chat the portal sidebar is not mounted at all: navigation goes through
// the hamburger («Открыть главное меню») which opens the overlay drawer —
// that open is part of the measured user work, so it happens inside t0.
const navBtn = (page, tid) => page.locator(`[data-testid="${tid}"]:visible`).first();
const toolsToggleBtn = (page) => page.locator('[data-testid^="main-layout-sidebar-tools-toggle-"]:visible').first();
const mainMenuBtn = (page) => page.locator('button[aria-label="Открыть главное меню"]:visible').first();
const ensureNav = async (page, tid) => {
  if (await navBtn(page, tid).count() > 0) return;
  await toolsToggleBtn(page).click({ timeout: 3000 }).catch(() => {});
};
// The mail credentials dialog auto-opens on /mail and instantly re-opens on
// cancel while mailRequiresPassword holds — pointer events stay trapped.
// dispatchEvent('click') still reaches React's delegated handler, so it is
// the deterministic fallback; the real click is tried first.
const navClickCore = async (page, tid) => {
  // A visible modal means pointer events are trapped — go straight to the
  // DOM click so the measured window is not inflated by click retries.
  if (await page.locator('.MuiDialog-root:visible').count() === 0 && await navBtn(page, tid).count() > 0) {
    try { await navBtn(page, tid).click({ timeout: 2500 }); return; } catch { /* fall through */ }
  }
  await page.locator(`[data-testid="${tid}"]`).first().dispatchEvent('click');
};
// /chat mounts no portal sidebar: navigation goes through the overlay drawer
// («Открыть главное меню»). While the chat search session is active that
// button is replaced by «Закрыть поиск» — close the search first.
const openPortalNavIfNeeded = async (page, tid) => {
  if (await navBtn(page, tid).count() > 0) return;
  await page.locator('button[aria-label="Закрыть поиск"]:visible').first().click({ timeout: 1200 }).catch(() => {});
  if (await navBtn(page, tid).count() === 0) {
    await mainMenuBtn(page).click({ timeout: 3000 }).catch(() => {});
  }
  await ensureNav(page, tid);
};
const navClick = async (page, tid) => {
  await ensureNav(page, tid);
  await openPortalNavIfNeeded(page, tid);
  await navClickCore(page, tid);
};
// Measured variant: sidebar state checks happen outside t0; the hamburger
// open (chat bare shell) is part of the measured transition.
const navClickMeasured = async (page, tid) => {
  await ensureNav(page, tid);
  const t0 = await page.evaluate(() => performance.now());
  if (await navBtn(page, tid).count() === 0) {
    await openPortalNavIfNeeded(page, tid);
  }
  await navClickCore(page, tid);
  return t0;
};

// The /mail route auto-opens the corporate-password dialog (no stored mail
// credentials in the seed). The page marker still mounts behind the modal,
// so the leg measures fine — but the dialog must be dismissed before the
// next click or it intercepts pointer events.
const dismissOverlays = async (page) => {
  const dlg = page.locator('.MuiDialog-root:visible');
  if (await dlg.count() === 0) return;
  const cancel = dlg.first().locator('button', { hasText: /отмена|закрыть|cancel|close|не сейчас/i });
  if (await cancel.count() > 0) {
    await cancel.first().click({ timeout: 2000 }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(150);
};

// Seed an identical drive on both revisions via the real upload-session API
// (same request path the UI uses; inline worker marks files ready).
async function seedMyFiles(page, count, origin) {
  const body = (i) => `release-gate seed ${i}\n${'x'.repeat(2048)}`;
  const headers = { Origin: origin };
  for (let i = 0; i < count; i += 1) {
    const name = `rgp-file-${String(i).padStart(3, '0')}.txt`;
    const data = Buffer.from(body(i), 'utf8');
    const s = await page.request.post('/api/v1/my-files/upload-sessions', {
      headers,
      data: { file_name: name, file_size: data.length, retention_days: 30, mime_type: 'text/plain', folder_id: null, library_id: null },
    });
    if (!s.ok()) return { seeded: i, error: `session ${s.status()} ${(await s.text()).slice(0, 200)}` };
    const sid = (await s.json()).file_id || (await s.json()).id;
    const up = await page.request.put(`/api/v1/my-files/upload-sessions/${sid}/chunks?offset=0`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data,
    });
    if (!up.ok()) return { seeded: i, error: `chunk ${up.status()}` };
    const done = await page.request.post(`/api/v1/my-files/upload-sessions/${sid}/complete`, { headers });
    if (!done.ok()) return { seeded: i, error: `complete ${done.status()} ${(await done.text()).slice(0, 200)}` };
  }
  return { seeded: count };
}

test(`global perf gate ${VP.width}x${VP.height}`, async ({ browser }) => {
  test.setTimeout(1_500_000);
  const res = { side: SIDE, viewport: VP, measuredAt: new Date().toISOString(), runs: RUNS, cold: COLD, seedFiles: SEED_FILES, scenarios: {}, meta: {} };

  // ── cold_login_dashboard: fresh context per sample — true cold boot,
  // login submit, dashboard first paint (sections container rendered).
  {
    const nav = [];
    const login = [];
    const total = [];
    const windows = [];
    let timeouts = 0;
    for (let i = 0; i < COLD; i += 1) {
      const ctx = await browser.newContext({ viewport: VP });
      await ctx.addInitScript(installHook);
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      const navReady = await waitMarkDate(page, `() => document.querySelector('[data-testid="password-auth-form"] input[name="username"]')`, 30000);
      if (navReady < 0) { timeouts += 1; await ctx.close(); continue; }
      nav.push(navReady - t0);
      await page.fill('[data-testid="password-auth-form"] input[name="username"]', U1);
      await page.fill('[data-testid="password-auth-form"] input[name="password"]', P1);
      const t1 = Date.now();
      await page.click('[data-testid="password-auth-form"] button[type="submit"]');
      const dashReady = await waitMarkDate(page, `() => document.querySelector('[data-testid="dashboard-sections"]')`, 40000);
      if (dashReady < 0) { timeouts += 1; await ctx.close(); continue; }
      login.push(dashReady - t1);
      total.push(dashReady - t0);
      // Whole cold window on the login document is gone after the client
      // route change; resources heap/requests are read on the dashboard doc.
      const w = await page.evaluate(() => {
        const res = performance.getEntriesByType('resource');
        return {
          apiRequests: window.__perf?.requests?.length ?? 0,
          netBytes: res.reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0),
          netResources: res.length,
          longTasks: window.__perf?.longTasks?.length ?? 0,
          heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576),
          fcp: window.__perf?.paints?.['first-contentful-paint'] ?? null,
          lcp: window.__perf?.paints?.['largest-contentful-paint'] ?? null,
        };
      });
      windows.push(w);
      await ctx.close();
    }
    res.scenarios.cold_nav_login_ms = { ...stats(nav), timeouts };
    res.scenarios.cold_login_dashboard_ms = { ...stats(login), timeouts };
    res.scenarios.cold_total_ms = stats(total);
    res.scenarios.cold_resources = {
      apiRequests: stats(windows.map((w) => w.apiRequests)),
      netBytes: stats(windows.map((w) => w.netBytes)),
      netResources: stats(windows.map((w) => w.netResources)),
      longTasks: stats(windows.map((w) => w.longTasks)),
      heapMB: stats(windows.map((w) => w.heapMB)),
      fcp: stats(windows.map((w) => w.fcp)),
      lcp: stats(windows.map((w) => w.lcp)),
    };
    console.log(`[gperf] cold done nav p50=${res.scenarios.cold_nav_login_ms.p50} login p50=${res.scenarios.cold_login_dashboard_ms.p50} n=${total.length}`);
  }

  // ── Warm context for the remaining scenarios.
  const ctx = await browser.newContext({ viewport: VP });
  await ctx.addInitScript(installHook);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const gc = async () => {
    try { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage'); } catch { /* noop */ }
  };
  const heapMB = () => page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576));
  await apiLogin(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('dashboard-sections')).toBeVisible({ timeout: 30_000 });
  const origin = new URL(page.url()).origin;
  res.meta.origin = origin;

  // The tools sidebar group can be collapsed — open it once so the
  // /my-files nav button is mounted for the transition loop.
  await ensureNav(page, ROUTE['my-files'].nav);

  // ── Seed the drive (identical content on both revisions).
  {
    const seeded = await seedMyFiles(page, SEED_FILES, origin);
    res.meta.fileSeed = seeded;
    if (seeded.error) console.log(`[gperf] file seed stopped: ${JSON.stringify(seeded)}`);
  }

  // ── route_transition: sidebar nav clicks, readiness = pathname + marker.
  {
    const perLeg = Object.fromEntries(LEGS.map((k) => [k, []]));
    for (let i = 0; i < RUNS; i += 1) {
      for (const legKey of LEGS) {
        const leg = ROUTE[legKey];
        const t0 = await navClickMeasured(page, leg.nav);
        const ready = await waitMark(page, routePred(legKey), 15000);
        const w = await windowStats(page, t0);
        perLeg[legKey].push({ ms: ready < 0 ? 15000 : ready - t0, timedOut: ready < 0, ...w });
        await dismissOverlays(page);
      }
    }
    for (const k of LEGS) res.scenarios[`route_${k}`] = aggSamples(perLeg[k]);
    console.log(`[gperf] transitions done ${LEGS.map((k) => `${k}:p50=${res.scenarios[`route_${k}`].ms.p50}`).join(' ')}`);
  }

  // ── file_list_load: dashboard↔my-files alternation, readiness = filters +
  // a seeded file row actually rendered (virtualized grid/list tolerant).
  {
    const samples = [];
    const filePred = `() => location.pathname === '/my-files' && Boolean(document.querySelector('[data-testid="my-files-filters"], [data-testid="my-files-breadcrumbs"], [data-testid="my-files-grid"], [data-testid="my-files-rows"]')) && (document.body.innerText.match(/rgp-file-/g) || []).length >= 3`;
    for (let i = 0; i < RUNS; i += 1) {
      await navClick(page, ROUTE.dashboard.nav);
      await waitMark(page, routePred('dashboard'), 15000);
      const t0 = await navClickMeasured(page, ROUTE['my-files'].nav);
      const ready = await waitMark(page, filePred, 20000);
      const w = await windowStats(page, t0);
      samples.push({ ms: ready < 0 ? 20000 : ready - t0, timedOut: ready < 0, ...w });
      await dismissOverlays(page);
    }
    res.scenarios.file_list_load = aggSamples(samples);
    res.scenarios.file_list_load.samples = samples.map((s) => Math.round(s.ms * 10) / 10);
    console.log(`[gperf] file_list done p50=${res.scenarios.file_list_load.ms.p50} p95=${res.scenarios.file_list_load.ms.p95} timeouts=${res.scenarios.file_list_load.timeouts}`);
  }

  // ── search_echo: chat sidebar search field, keydown t0 → value echo.
  {
    await navClick(page, ROUTE.chat.nav);
    await waitMark(page, routePred('chat'), 15000);
    const search = page.getByPlaceholder('Поиск').first();
    const samples = [];
    let timeouts = 0;
    for (let i = 0; i < RUNS; i += 1) {
      await search.click();
      await page.evaluate(() => {
        window.__perf.keyT0 = null;
        document.addEventListener('keydown', () => { if (window.__perf.keyT0 === null) window.__perf.keyT0 = performance.now(); }, { capture: true, once: true });
      });
      await page.keyboard.type('x', { delay: 0 });
      const ready = await waitMark(page, `() => document.querySelector('input[placeholder="Поиск"]')?.value?.includes('x')`, 3000);
      const kt0 = await page.evaluate(() => window.__perf.keyT0 ?? performance.now() - 20);
      if (ready < 0) timeouts += 1;
      samples.push(ready < 0 ? 3000 : ready - kt0);
      await search.fill('');
    }
    res.scenarios.search_echo_ms = { ...stats(samples), timeouts };
    // Close the chat search session: while active it replaces the portal
    // hamburger with «Закрыть поиск» and breaks nav-out of /chat.
    await page.locator('button[aria-label="Закрыть поиск"]:visible').first().click({ timeout: 2000 }).catch(() => {});
    console.log(`[gperf] search done p50=${res.scenarios.search_echo_ms.p50} p95=${res.scenarios.search_echo_ms.p95}`);
  }

  // ── durability: 20 cycles × 5 legs, GC-bounded heap before/after.
  {
    await navClick(page, ROUTE.dashboard.nav);
    await waitMark(page, routePred('dashboard'), 15000);
    await gc();
    const heapBefore = await heapMB();
    const trace = [];
    for (let c = 0; c < DURABILITY_CYCLES; c += 1) {
      for (const legKey of LEGS) {
        const leg = ROUTE[legKey];
        await navClick(page, leg.nav);
        await waitMark(page, routePred(legKey), 15000);
        await dismissOverlays(page);
      }
      if (c % 5 === 4) trace.push(await heapMB());
    }
    await gc();
    const heapAfter = await heapMB();
    res.scenarios.durability_cycles = {
      cycles: DURABILITY_CYCLES,
      legsPerCycle: LEGS.length,
      heapBeforeMB: heapBefore,
      heapAfterMB: heapAfter,
      deltaMB: heapAfter - heapBefore,
      traceMB: trace,
    };
    console.log(`[gperf] durability done heap ${heapBefore}→${heapAfter} Δ${heapAfter - heapBefore}MB`);
  }

  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/global-perf-gate-${SIDE}-${VP.width}x${VP.height}.json`, JSON.stringify(res, null, 2));
  console.log('global-perf:', JSON.stringify(Object.keys(res.scenarios)));
  await ctx.close();
});
