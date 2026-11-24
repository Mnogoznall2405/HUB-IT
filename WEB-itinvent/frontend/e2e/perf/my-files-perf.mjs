// My Files performance audit harness (PR #18 acceptance).
//
//   seed    — populate one throwaway backend identically on both sides:
//             node e2e/perf/my-files-perf.mjs seed --base http://127.0.0.1:5181 --seed-out e2e/artifacts/perf-audit/seed-baseline.json
//   run     — measure scenarios N times and append CSV rows:
//             node e2e/perf/my-files-perf.mjs run --base http://127.0.0.1:5181 --label baseline --seed <seed.json> --runs 10
//   compare — join two results-*.csv into comparison.csv.
//
// Methodology notes:
// - Latency is taken INSIDE the page: a persistent MutationObserver stamps the
//   first and last DOM change after `mark()`, so Node<->browser roundtrips do
//   not inflate results. Semantic waits (waitForSelector) still gate the end
//   of an action; `mut_first` = first visual response, `mut_last` = settled.
// - `window.__perf.commits` counts React commits via a devtools hook stub
//   injected before app scripts (counts roots' commits, not components).
// - Network = PerformanceObserver resource entries filtered to /api/.
// - Long tasks = PerformanceObserver('longtask'); memory = performance.memory.
// - The intentional 200 ms submenu UX delay is reported separately
//   (menu_group_hover raw vs *_minus_delay).
// - Cold runs use fresh contexts + Network.setCacheDisabled; warm runs reuse a
//   single context after the app bundle is already evaluated.

import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'artifacts', 'perf-audit');
const USERNAME = process.env.E2E_USERNAME || 'e2e_admin';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-local-admin-pass';
const SUBMENU_DELAY_MS = 200;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

// ---------------------------------------------------------------- seed ----

// The backend only accepts an Origin present in its CORS allow-list — the
// preview origin (E2E_FRONTEND_PORT), not the backend port itself.
const SEED_ORIGIN = process.env.PERF_SEED_ORIGIN || null;

async function apiCall(base, cookie, method, path, body, retries = 6) {
  let response;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: SEED_ORIGIN || base,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status !== 429 || attempt === retries) break;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 200)}`);
  }
  const setCookies = response.headers.getSetCookie?.() || [];
  return { json: await response.json().catch(() => null), setCookies };
}

async function loginCookie(base) {
  const { json, setCookies } = await apiCall(base, '', 'POST', '/api/v1/auth/login', {
    username: USERNAME,
    password: PASSWORD,
  });
  if (json?.status !== 'authenticated') throw new Error(`login failed: ${JSON.stringify(json).slice(0, 200)}`);
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('login returned no session cookie');
  return cookie;
}

async function uploadFile(base, cookie, name, folderId = null, mime = 'text/plain') {
  const payload = Buffer.from(`perf ${name}\n`);
  const { json: session } = await apiCall(base, cookie, 'POST', '/api/v1/my-files/upload-sessions', {
    file_name: name,
    file_size: payload.length,
    retention_days: 30,
    mime_type: mime,
    folder_id: folderId,
  });
  const fileId = String(session?.file_id || session?.id || '');
  if (!fileId) throw new Error(`no file_id for ${name}`);
  const upload = await fetch(`${base}/api/v1/my-files/upload-sessions/${fileId}/chunks?offset=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', Origin: SEED_ORIGIN || base, Cookie: cookie },
    body: payload,
  });
  if (!upload.ok) throw new Error(`chunk ${fileId} -> ${upload.status}`);
  await apiCall(base, cookie, 'POST', `/api/v1/my-files/upload-sessions/${fileId}/complete`);
  return fileId;
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function seed(base, seedOut) {
  const stamp = Date.now().toString(36);
  const cookie = await loginCookie(base);
  const j = (r) => r.json;
  const post = (path, body) => apiCall(base, cookie, 'POST', path, body).then(j);
  const put = (path, body) => apiCall(base, cookie, 'PUT', path, body).then(j);

  // Users for the library-members scenario (30 members + admin owner).
  const users = [];
  for (let i = 1; i <= 40; i += 1) {
    const username = `perf_user_${String(i).padStart(2, '0')}`;
    try {
      const created = await post('/api/v1/auth/users', {
        username, password: 'perf-pass-1', full_name: `Perf Пользователь ${i}`,
        role: 'viewer', auth_source: 'local', is_active: true,
      });
      if (created?.id) users.push(created);
    } catch { /* user may already exist on re-seed */ }
  }
  console.log(`seed: ${users.length} users created`);

  const libA = await post('/api/v1/my-files/libraries', { name: `Perf Библиотека А ${stamp}`, quota_bytes: 0 });
  const libB = await post('/api/v1/my-files/libraries', { name: `Perf Библиотека Б ${stamp}`, quota_bytes: 0 });
  const principal = (u, role) => ({ principal_type: 'user', principal_id: String(u.id), role });
  if (libA?.id && users.length >= 30) {
    await put(`/api/v1/my-files/libraries/${libA.id}/members`, {
      members: [
        principal(users[0], 'manage'),
        ...users.slice(1, 30).map((u) => principal(u, 'view')),
      ],
    });
  }
  if (libB?.id && users.length >= 3) {
    await put(`/api/v1/my-files/libraries/${libB.id}/members`, {
      members: [
        principal(users[0], 'manage'),
        ...users.slice(1, 3).map((u) => principal(u, 'edit')),
      ],
    });
  }
  console.log(`seed: libraries ${libA?.id}, ${libB?.id}`);

  // Library folder tree: root, a depth-12 chain, and ~150 spread children.
  const libRoot = await post('/api/v1/my-files/folders', {
    name: `perf-lib-root-${stamp}`, parent_id: null, library_id: String(libA.id),
  });
  let parent = libRoot;
  const chain = [libRoot?.id];
  for (let d = 1; d <= 12; d += 1) {
    parent = await post('/api/v1/my-files/folders', {
      name: `perf-lib-d${d}-${stamp}`, parent_id: String(parent.id), library_id: String(libA.id),
    });
    chain.push(parent.id);
  }
  const spread = [];
  await pool(Array.from({ length: 150 }, (_, i) => i), 8, async (i) => {
    const under = i % 3 === 0 && spread.length ? spread[i % spread.length] : libRoot;
    const f = await post('/api/v1/my-files/folders', {
      name: `perf-lib-n${String(i).padStart(3, '0')}-${stamp}`, parent_id: String(under.id), library_id: String(libA.id),
    });
    spread.push(f);
  });
  console.log(`seed: library tree ${chain.length} deep + ${spread.length} spread`);

  // Table-size folders. PERF_TABLE_SIZES widens the default set (e.g. adds
  // 5000 for virtualization checks); the run side reads the same env var.
  const tableSizes = (process.env.PERF_TABLE_SIZES || '10,100,500,1000')
    .split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
  const tableFolders = {};
  for (const n of tableSizes) {
    const folder = await post('/api/v1/my-files/folders', { name: `perf-f${n}-${stamp}`, parent_id: null });
    const kinds = ['txt', 'md', 'csv', 'json', 'log'];
    await pool(Array.from({ length: n }, (_, i) => i), 8, async (i) => {
      await uploadFile(base, cookie, `perf-${n}-${stamp}-${String(i).padStart(4, '0')}.${kinds[i % kinds.length]}`, String(folder.id));
    });
    tableFolders[n] = folder.id;
    console.log(`seed: folder perf-f${n} = ${folder.id} (${n} files)`);
  }

  // Navigation chain + markers.
  const navA = await post('/api/v1/my-files/folders', { name: `perf-nav-a-${stamp}`, parent_id: null });
  const navB = await post('/api/v1/my-files/folders', { name: `perf-nav-b-${stamp}`, parent_id: String(navA.id) });
  const navC = await post('/api/v1/my-files/folders', { name: `perf-nav-c-${stamp}`, parent_id: String(navB.id) });
  await uploadFile(base, cookie, `marker-nav-b-${stamp}.txt`, String(navB.id));
  await uploadFile(base, cookie, `marker-nav-c-${stamp}.txt`, String(navC.id));
  await uploadFile(base, cookie, `perf-search-marker-zebra-${stamp}.txt`, null);
  await uploadFile(base, cookie, `perf-root-marker-${stamp}.txt`, null);

  const seedData = {
    base, stamp,
    libraries: { a: libA.id, b: libB.id },
    libDeepFolderId: chain[chain.length - 1],
    libChainDepth: chain.length,
    libSpreadCount: spread.length,
    tableFolders,
    nav: { a: navA.id, b: navB.id, c: navC.id },
    markerNavB: `marker-nav-b-${stamp}.txt`,
    markerSearch: `perf-search-marker-zebra-${stamp}.txt`,
    users: users.length,
  };
  mkdirSync(dirname(seedOut), { recursive: true });
  writeFileSync(seedOut, JSON.stringify(seedData, null, 2));
  console.log(`seed: done -> ${seedOut}`);
}

// -------------------------------------------------------------- runner ----

const INIT_SCRIPT = `
  window.__perf = { commits: 0, commitLog: [], longtasks: [], api: [], marks: {}, muts: [], mark(name) {
    this.marks[name] = performance.now(); this.muts = [];
  }, probe(name) {
    const t = this.marks[name] || 0;
    return { mark: t, first: this.muts.length ? this.muts[0].t - t : 0,
      last: this.muts.length ? this.muts[this.muts.length - 1].t - t : 0,
      mutations: this.muts.length };
  } };
  const hook = { checkDCE() {}, supportsFiber: true, inject: () => 1,
    onCommitFiberRoot() { window.__perf.commits += 1; window.__perf.commitLog.push(performance.now()); },
    onCommitFiberUnmount() {}, onScheduleFiberRoot() {} };
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook });
  new PerformanceObserver((list) => list.getEntries()
    .forEach((e) => window.__perf.longtasks.push(e.duration)))
    .observe({ entryTypes: ['longtask'] });
  new PerformanceObserver((list) => list.getEntries().forEach((e) => {
    if (e.name.includes('/api/')) {
      window.__perf.api.push({ n: e.name.slice(e.name.indexOf('/api/'), e.name.indexOf('/api/') + 90), d: e.duration, t: e.transferSize || 0, s: e.startTime });
    }
  })).observe({ entryTypes: ['resource'] });
  new MutationObserver((list) => {
    const t = performance.now();
    window.__perf.muts.push({ t, n: list.length });
  }).observe(document.documentElement || document, {
    childList: true, subtree: true, attributes: true,
  });
`;

// Rows: file rows are my-files-card-*, folder rows my-files-folder-*; the
// row-level ⋮ (my-files-card-menu-*/my-files-folder-menu-*) must be excluded.
const ROW_SEL = '[data-testid^="my-files-card-"]:not([data-testid^="my-files-card-menu-"]), '
  + '[data-testid^="my-files-folder-"]:not([data-testid^="my-files-folder-menu-"]):not([data-testid="my-files-folder-input"])';
const MENU_SEL = 'ul[role="menu"]';
// The row ⋮ exists in both builds but only the new one carries a testid —
// the stable cross-version selector is the aria-label.
const FILE_MENU_BTN = 'button[aria-label^="Действия с файлом"]';
const FOLDER_MENU_BTN = 'button[aria-label^="Действия с папкой"]';
const COLLAPSE_BTN = '[data-testid="my-files-nav-collapse-toggle"], '
  + 'button[aria-label="Свернуть панель навигации"], button[aria-label="Развернуть панель навигации"]';
const NAV_MY_FILES = '[data-testid="main-layout-sidebar-my-files"]';
const LIBRARY_SETTINGS = '[data-testid="my-files-library-settings"], button[aria-label="Настройки общей папки"]';
const TREE_NODE = '[data-testid^="my-files-tree-folder-"]';
const SEARCH_INPUT = '[data-testid="my-files-search-input"], input[placeholder*="Поиск"]';

const ONLY = (process.env.PERF_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const onlyOn = ONLY.length > 0;
const scenarioOn = (scenario) => !onlyOn || ONLY.some((p) => scenario.startsWith(p));
const blockOn = (...prefixes) => !onlyOn || ONLY.some((p) => prefixes.some((x) => p.startsWith(x) || x.startsWith(p)));

async function measure(page, name, act, readyLocator, { settleMs = 120 } = {}) {
  await page.evaluate((n) => window.__perf.mark(n), name);
  const before = await page.evaluate(() => ({
    commits: window.__perf.commits, api: window.__perf.api.length,
    heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
  }));
  await act();
  if (readyLocator) await readyLocator.waitFor({ state: 'visible', timeout: 30_000 });
  // Let the DOM settle — last mutation is "rendered".
  await page.waitForTimeout(settleMs);
  const probe = await page.evaluate((n) => ({
    ...window.__perf.probe(n),
    commits: window.__perf.commits,
    apiCount: window.__perf.api.length,
    apiBytes: window.__perf.api.reduce((s, e) => s + e.t, 0),
    longtasks: window.__perf.longtasks.splice(0).reduce((s, d) => ({ n: s.n + 1, ms: s.ms + d }), { n: 0, ms: 0 }),
    heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
    domNodes: document.querySelectorAll('*').length,
  }), name);
  return {
    first: Math.round(probe.first), last: Math.round(probe.last),
    mutations: probe.mutations, commits: probe.commits - before.commits,
    api: probe.apiCount - before.api, apiBytes: probe.apiBytes - before.apiBytes,
    longtaskN: probe.longtasks.n, longtaskMs: Math.round(probe.longtasks.ms),
    heap: probe.heap, heapDelta: probe.heap - before.heap, domNodes: probe.domNodes,
  };
}

async function loginPage(context, base) {
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  // The login page may default to the SSO method card when the backend
  // advertises windows_sso_enabled — pick the password method first.
  const form = page.getByTestId('password-auth-form');
  const formVisible = await form
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!formVisible) {
    const methodBtn = page
      .getByRole('button', { name: /логином и паролем|password/i })
      .first();
    if (await methodBtn.isVisible().catch(() => false)) {
      await methodBtn.click();
    }
  }
  await form.waitFor({ state: 'visible', timeout: 45_000 });
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await page.getByTestId('main-layout-content').waitFor({ state: 'visible', timeout: 30_000 });
  return page;
}

async function goMyFiles(page, base, folderId = null, attempt = 0) {
  const url = folderId ? `${base}/my-files?folder=${folderId}` : `${base}/my-files`;
  await page.goto(url);
  try {
    await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 45_000 });
  } catch (e) {
    // PermissionRoute can bounce a deep link to /dashboard while permissions are
    // still hydrating — identical in both builds; a real user retries the link.
    if (attempt >= 2) throw e;
    await page.waitForTimeout(1500);
    return goMyFiles(page, base, folderId, attempt + 1);
  }
}

async function captureTrace(cdp, page, file) {
  const chunks = [];
  const handler = (p) => chunks.push(...(p.value || []));
  cdp.on('Tracing.dataCollected', handler);
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-v8.cpu_profiler',
    options: 'sampling-frequency=10000',
  });
  return async () => {
    await cdp.send('Tracing.end');
    await new Promise((resolve) => {
      cdp.once('Tracing.tracingComplete', resolve);
      setTimeout(resolve, 10_000);
    });
    cdp.off('Tracing.dataCollected', handler);
    writeFileSync(file, JSON.stringify({ traceEvents: chunks }));
  };
}

async function run(base, label, seedFile, runs) {
  const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
  const csvFile = join(OUT_DIR, `results-${label}.csv`);
  const traceDir = join(OUT_DIR, 'traces');
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(traceDir, { recursive: true });
  if (!existsSync(csvFile)) {
    writeFileSync(csvFile, 'scenario,metric,unit,value,run\n');
  }
  // Stream rows to disk immediately — a late scenario failure must not lose
  // everything measured before it.
  const emit = (scenario, metric, value, unit = 'ms', runIdx = 0) => {
    if (!scenarioOn(scenario)) return;
    const v = typeof value === 'number' ? Math.round(value * 100) / 100 : value;
    appendFileSync(csvFile, `${scenario},${metric},${unit},${v},${runIdx}\n`);
  };

  // Same engine the e2e suite uses: bundled chromium crashes on this host.
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const viewport = { width: 1440, height: 900 };

  const timed = async (page, scenario, runIdx, act, readyLocator, opts = {}) => {
    if (!scenarioOn(scenario)) return { first: 0, last: 0 };
    const r = await measure(page, `${scenario}#${runIdx}`, act, readyLocator, opts);
    emit(scenario, 'first_dom', r.first, 'ms', runIdx);
    emit(scenario, 'settled_dom', r.last, 'ms', runIdx);
    emit(scenario, 'commits', r.commits, 'count', runIdx);
    emit(scenario, 'mutations', r.mutations, 'count', runIdx);
    emit(scenario, 'api_requests', r.api, 'count', runIdx);
    emit(scenario, 'api_bytes', r.apiBytes, 'bytes', runIdx);
    emit(scenario, 'longtasks', r.longtaskN, 'count', runIdx);
    emit(scenario, 'longtask_ms', r.longtaskMs, 'ms', runIdx);
    if (opts.extra) await opts.extra(r);
    return r;
  };

  // ---- A: initial open -----------------------------------------------------
  for (let i = 0; i < (blockOn('open_') ? runs : 0); i += 1) {
    // Route transition: land on dashboard first (bundle warm), then My Files.
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await context.addInitScript(INIT_SCRIPT);
    const page = await loginPage(context, base);
    await page.goto(`${base}/`);
    await page.getByTestId('main-layout-content').waitFor({ state: 'visible' });
    // "/" asynchronously redirects to the default route (/dashboard); a nav click
    // issued before it settles loses the race and the app lands on /dashboard.
    await page.waitForURL((u) => u.pathname !== '/', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    // "Мой диск" sits inside the collapsed "tools" sidebar group — expand it first.
    let navLink = page.locator(NAV_MY_FILES).first();
    if (!(await navLink.isVisible().catch(() => false))) {
      const toggle = page.locator('[data-testid^="main-layout-sidebar-tools-toggle"]').first();
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
        navLink = page.locator(NAV_MY_FILES).first();
      }
    }
    const cdp = i === 0 ? await context.newCDPSession(page) : null;
    const stopTrace = cdp ? await captureTrace(cdp, page, join(traceDir, `open_route-${label}.json`)) : null;
    // Sidebar nav clicks race with MainLayout remounts (the 56ms deferred
    // navigate is cleared on unmount) — a real user just clicks again, so retry
    // and report the retry count as a per-version metric.
    let navRetries = 0;
    await timed(page, 'open_route', i, async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await navLink.click({ timeout: 8000 }).catch(() => {});
        try {
          await page.waitForURL((u) => u.pathname === '/my-files', { timeout: 4000 });
          break;
        } catch {
          navRetries += 1;
          await navLink.focus().catch(() => {});
          await page.keyboard.press('Enter').catch(() => {});
          await page.waitForURL((u) => u.pathname === '/my-files', { timeout: 4000 }).catch(() => {});
          if (page.url().includes('/my-files')) break;
        }
      }
    }, page.locator(ROW_SEL).first(), {
      extra: async (r) => {
        emit('open_route', 'nav_retries', navRetries, 'count', i);
        emit('open_route', 'dom_nodes', r.domNodes, 'count', i);
        emit('open_route', 'heap_mb', r.heap / 1048576, 'MB', i);
      },
    });
    if (stopTrace) await stopTrace();
    await context.close();
  }

  for (let i = 0; i < (blockOn('open_') ? runs : 0); i += 1) {
    // Full reload on /my-files — warm HTTP cache, real JS re-eval.
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await context.addInitScript(INIT_SCRIPT);
    const page = await loginPage(context, base);
    await goMyFiles(page, base);
    await page.evaluate((n) => window.__perf.mark(n), `open_reload#${i}`);
    const b = await page.evaluate(() => ({ commits: window.__perf.commits, api: window.__perf.api.length }));
    await page.reload();
    await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 45_000 });
    const p = await page.evaluate((n) => ({
      nav: performance.getEntriesByType('navigation')[0]?.duration || 0,
      now: performance.now(),
      api: window.__perf.api.length, commits: window.__perf.commits,
      domNodes: document.querySelectorAll('*').length,
      heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
      lt: window.__perf.longtasks.splice(0).reduce((s, d) => ({ n: s.n + 1, ms: s.ms + d }), { n: 0, ms: 0 }),
    }), `open_reload#${i}`);
    emit('open_reload', 'first_row_ms', p.now, 'ms', i);
    emit('open_reload', 'nav_duration', p.nav, 'ms', i);
    emit('open_reload', 'api_requests', p.api - b.api, 'count', i);
    emit('open_reload', 'commits', p.commits - b.commits, 'count', i);
    emit('open_reload', 'dom_nodes', p.domNodes, 'count', i);
    emit('open_reload', 'heap_mb', p.heap / 1048576, 'MB', i);
    emit('open_reload', 'longtask_ms', Math.round(p.lt.ms), 'ms', i);
    await context.close();
  }

  for (let i = 0; i < (blockOn('open_') ? Math.min(runs, 5) : 0); i += 1) {
    // Cold: no HTTP cache at all — first contact with every asset.
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(`${base}/login`);
    const form = page.getByTestId('password-auth-form');
    if (!(await form.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /логином и паролем|password/i }).first().click();
    }
    await form.waitFor({ state: 'visible', timeout: 15_000 });
    await form.locator('input[name="username"]').fill(USERNAME);
    await form.locator('input[name="password"]').fill(PASSWORD);
    await form.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
    // The post-login landing keeps issuing client-side redirects (default-route
    // resolution, desktop-handoff); wait for the pathname to be stable for a
    // beat before navigating away, or goto races a context-destroying redirect.
    await page.waitForFunction(() => {
      const w = window.__stablePath || (window.__stablePath = { p: location.pathname, t: Date.now() });
      if (location.pathname !== w.p) { w.p = location.pathname; w.t = Date.now(); }
      return Date.now() - w.t > 1500;
    }, { timeout: 20_000, polling: 250 }).catch(() => {});
    const t0 = Date.now();
    let bounced = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto(`${base}/my-files`).catch(() => {});
      try {
        await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 45_000 });
        break;
      } catch {
        bounced += 1;
        if (attempt === 2) throw new Error('open_cold: /my-files unreachable after 3 attempts');
        await page.waitForTimeout(1500);
      }
    }
    const p = await page.evaluate(() => ({
      now: performance.now(),
      api: window.__perf.api.length,
      heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
      domNodes: document.querySelectorAll('*').length,
    }));
    emit('open_cold', 'first_row_ms', p.now, 'ms', i);
    emit('open_cold', 'wall_ms', Date.now() - t0, 'ms', i);
    emit('open_cold', 'redirect_bounces', bounced, 'count', i);
    emit('open_cold', 'api_requests', p.api, 'count', i);
    emit('open_cold', 'dom_nodes', p.domNodes, 'count', i);
    emit('open_cold', 'heap_mb', p.heap / 1048576, 'MB', i);
    await context.close();
  }

  // Warm context for the rest of the scenarios.
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await context.addInitScript(INIT_SCRIPT);
  const page = await loginPage(context, base);

  // ---- B: folder switching -------------------------------------------------
  for (let i = 0; i < (blockOn('nav_') ? runs : 0); i += 1) {
    await goMyFiles(page, base);
    if (scenarioOn('nav_into_folder')) {
      await timed(page, 'nav_into_folder', i,
        () => page.locator(`[data-testid="my-files-folder-${seed.tableFolders[10]}"]`).first().click(),
        page.locator('[data-testid^="my-files-card-"]').first());
    } else {
      // Unmeasured setup: nav_back still needs to be inside the folder.
      await page.locator(`[data-testid="my-files-folder-${seed.tableFolders[10]}"]`).first().click();
      await page.locator('[data-testid^="my-files-card-"]').first().waitFor({ state: 'visible', timeout: 30_000 });
    }
    await timed(page, 'nav_back', i,
      () => page.goBack(),
      page.locator(`[data-testid="my-files-folder-${seed.tableFolders[10]}"]`));
  }
  for (let i = 0; i < (blockOn('nav_') ? runs : 0); i += 1) {
    await goMyFiles(page, base, seed.nav.a);
    await timed(page, 'nav_nested', i,
      () => page.locator(`[data-testid="my-files-folder-${seed.nav.b}"]`).first().click(),
      page.getByText(seed.markerNavB));
  }
  for (let i = 0; i < (blockOn('nav_') ? runs : 0); i += 1) {
    await goMyFiles(page, base);
    const libNav = page.locator(`[data-testid="my-files-library-${seed.libraries.a}"]`).first();
    await timed(page, 'nav_library', i,
      () => libNav.click(),
      page.locator(ROW_SEL).first());
  }
  // Rapid switching — must land on the LAST folder's content (stale-response check).
  for (let i = 0; i < (blockOn('nav_') ? runs : 0); i += 1) {
    await goMyFiles(page, base);
    await page.evaluate((n) => window.__perf.mark(n), `nav_rapid#${i}`);
    await page.locator(`[data-testid="my-files-folder-${seed.nav.a}"]`).first().click();
    await page.goBack();
    await page.locator(`[data-testid="my-files-folder-${seed.tableFolders[10]}"]`).first().click();
    const probe = await page.evaluate((n) => window.__perf.probe(n), `nav_rapid#${i}`);
    const correct = await page.locator('[data-testid^="my-files-card-"]').count();
    emit('nav_rapid', 'settled_dom', probe.last, 'ms', i);
    emit('nav_rapid', 'file_rows', correct, 'count', i);
  }

  // ---- C: table sizes ------------------------------------------------------
  const tableSizes = (process.env.PERF_TABLE_SIZES || '10,100,500,1000')
    .split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => seed.tableFolders[n]);
  for (const n of tableSizes) {
    const fid = seed.tableFolders[n];
    for (let i = 0; i < (blockOn('table_') ? runs : 0); i += 1) {
      await goMyFiles(page, base);
      const t0 = await page.evaluate((nm) => (window.__perf.mark(nm), performance.now()), `table_${n}#${i}`);
      await page.goto(`${base}/my-files?folder=${fid}`);
      await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 60_000 });
      await page.waitForTimeout(150);
      const p = await page.evaluate((nm) => ({
        ...window.__perf.probe(nm),
        commits: window.__perf.commits,
        api: window.__perf.api.length,
        rows: document.querySelectorAll('[data-testid^="my-files-card-"], [data-testid^="my-files-folder-"]').length,
        domNodes: document.querySelectorAll('*').length,
        heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
        lt: window.__perf.longtasks.splice(0).reduce((s, d) => s + d, 0),
      }), `table_${n}#${i}`);
      emit(`table_${n}`, 'first_row_ms', p.last || (await page.evaluate(() => performance.now())) - t0, 'ms', i);
      emit(`table_${n}`, 'rows_rendered', p.rows, 'count', i);
      emit(`table_${n}`, 'dom_nodes', p.domNodes, 'count', i);
      emit(`table_${n}`, 'commits', p.commits, 'count', i);
      emit(`table_${n}`, 'api_requests', p.api, 'count', i);
      emit(`table_${n}`, 'heap_mb', p.heap / 1048576, 'MB', i);
      emit(`table_${n}`, 'longtask_ms', Math.round(p.lt), 'ms', i);
    }
  }

  // Scroll-to-bottom inside the 1000 folder. Legacy builds expand 200-row
  // chunks via «Показать ещё»; the virtualized build mounts rows on scroll.
  for (let i = 0; i < (blockOn('table_') ? runs : 0); i += 1) {
    await goMyFiles(page, base, seed.tableFolders[1000]);
    const more = page.getByRole('button', { name: /Показать ещё/ }).first();
    if (await more.isVisible().catch(() => false)) {
      const before = await page.locator(ROW_SEL).count();
      await timed(page, 'table_show_more', i, () => more.click(), null, { settleMs: 200 });
      emit('table_show_more', 'rows_before', before, 'count', i);
      emit('table_show_more', 'rows_after', await page.locator(ROW_SEL).count(), 'count', i);
    } else {
      await timed(page, 'table_scroll_bottom', i,
        () => page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)),
        null, { settleMs: 250 });
      emit('table_scroll_bottom', 'rows_dom', await page.locator(ROW_SEL).count(), 'count', i);
      const bottomSpacer = await page.locator('[data-testid="my-files-rows-spacer-bottom"]').count();
      emit('table_scroll_bottom', 'reached_end', bottomSpacer === 0 ? 1 : 0, 'bool', i);
    }
  }

  // Sort inside the 500 folder.
  for (let i = 0; i < (blockOn('table_') ? runs : 0); i += 1) {
    await goMyFiles(page, base, seed.tableFolders[500]);
    const firstName = await page.locator(ROW_SEL).first().textContent();
    await timed(page, 'table_sort', i,
      () => page.getByText('Название', { exact: true }).first().click(),
      null, { settleMs: 250 });
    emit('table_sort', 'order_changed', (await page.locator(ROW_SEL).first().textContent()) !== firstName ? 1 : 0, 'bool', i);
  }

  // Scroll FPS in the 1000 folder. Legacy builds expand all 200-row chunks
  // first; the virtualized build mounts rows as the document scrolls.
  for (let i = 0; i < (blockOn('table_') ? runs : 0); i += 1) {
    await goMyFiles(page, base, seed.tableFolders[1000]);
    const more = page.getByRole('button', { name: /Показать ещё/ }).first();
    for (let k = 0; k < 5 && (await more.isVisible().catch(() => false)); k += 1) {
      await more.click();
      await page.waitForTimeout(250);
    }
    // One full pass so every thumbnail/lazy piece has mounted at least once.
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const scroller = '[data-testid="main-layout-content"], main [class*="MuiBox"], main';
    const stats = await page.evaluate(async (sel) => {
      const candidates = [...document.querySelectorAll(sel)].filter((el) => el.scrollHeight > el.clientHeight + 200);
      const sc = candidates[0]
        || (document.scrollingElement && document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 200
          ? document.scrollingElement : null);
      if (!sc) return { fps: -1, frames: 0 };
      window.__perf.longtasks.length = 0;
      const commits0 = window.__perf.commits;
      const muts0 = window.__perf.muts.length;
      let frames = 0; let worst = 0; let prev = performance.now();
      const t0 = prev;
      await new Promise((resolve) => {
        const step = (t) => {
          const dt = t - prev; prev = t;
          worst = Math.max(worst, dt); frames += 1;
          sc.scrollTop = (sc.scrollTop + 140) % Math.max(1, sc.scrollHeight - sc.clientHeight);
          if (t - t0 < 1500) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });
      return { fps: frames / ((performance.now() - t0) / 1000), frames, worst: Math.round(worst),
        lt: window.__perf.longtasks.splice(0).reduce((s, d) => s + d, 0),
        commits: window.__perf.commits - commits0,
        muts: window.__perf.muts.length - muts0,
        rows: document.querySelectorAll('[data-testid^="my-files-card-"]').length };
    }, scroller);
    emit('table_scroll_1000', 'fps', stats.fps, 'fps', i);
    emit('table_scroll_1000', 'worst_frame', stats.worst, 'ms', i);
    emit('table_scroll_1000', 'longtask_ms', Math.round(stats.lt), 'ms', i);
    emit('table_scroll_1000', 'commits', stats.commits, 'count', i);
    emit('table_scroll_1000', 'mutations', stats.muts, 'count', i);
    emit('table_scroll_1000', 'rows_dom', stats.rows, 'count', i);

    // Scroll-mode variants on the same 1000 folder: slow wheel-like drift,
    // fast swipe, and a scrollbar-drag jump start->end. Each measures the same
    // fps/worst/commits trio so regressions are attributable per mode.
    const modes = [
      ['scroll_slow', 40, 2500],
      ['scroll_fast', 500, 1500],
    ];
    for (const [name, stepPx, durMs] of modes) {
      const m = await page.evaluate(async ({ sel, stepPx, durMs }) => {
        const candidates = [...document.querySelectorAll(sel)].filter((el) => el.scrollHeight > el.clientHeight + 200);
        const sc = candidates[0] || document.scrollingElement;
        if (!sc) return { fps: -1 };
        sc.scrollTop = 0;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        window.__perf.longtasks.length = 0;
        const commits0 = window.__perf.commits;
        let frames = 0; let worst = 0; let prev = performance.now();
        const t0 = prev;
        await new Promise((resolve) => {
          const step = (t) => {
            const dt = t - prev; prev = t;
            worst = Math.max(worst, dt); frames += 1;
            sc.scrollTop = (sc.scrollTop + stepPx) % Math.max(1, sc.scrollHeight - sc.clientHeight);
            if (t - t0 < durMs) requestAnimationFrame(step); else resolve();
          };
          requestAnimationFrame(step);
        });
        return { fps: frames / ((performance.now() - t0) / 1000), worst: Math.round(worst),
          lt: window.__perf.longtasks.splice(0).reduce((s, d) => s + d, 0),
          commits: window.__perf.commits - commits0 };
      }, { sel: scroller, stepPx, durMs });
      emit(name, 'fps', m.fps, 'fps', i);
      emit(name, 'worst_frame', m.worst, 'ms', i);
      emit(name, 'longtask_ms', Math.round(m.lt), 'ms', i);
      emit(name, 'commits', m.commits, 'count', i);
    }

    const jump = await page.evaluate(async (sel) => {
      const candidates = [...document.querySelectorAll(sel)].filter((el) => el.scrollHeight > el.clientHeight + 200);
      const sc = candidates[0] || document.scrollingElement;
      sc.scrollTop = 0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const commits0 = window.__perf.commits;
      const t0 = performance.now();
      sc.scrollTop = sc.scrollHeight - sc.clientHeight;
      // Time until the last row is mounted (blank-window latency).
      const lastRow = () => {
        const rows = document.querySelectorAll('[data-testid^="my-files-card-"], [data-testid^="my-files-folder-"]');
        return rows.length ? rows[rows.length - 1].getBoundingClientRect().top < innerHeight : false;
      };
      let settled = -1;
      await new Promise((resolve) => {
        const chk = () => { if (lastRow()) { settled = performance.now() - t0; resolve(); } else if (performance.now() - t0 > 3000) resolve(); else requestAnimationFrame(chk); };
        requestAnimationFrame(chk);
      });
      return { settled: Math.round(settled), commits: window.__perf.commits - commits0 };
    }, scroller);
    emit('scroll_jump_end', 'settled_dom', jump.settled, 'ms', i);
    emit('scroll_jump_end', 'commits', jump.commits, 'count', i);
  }

  // Selection latency + select-all + view toggle in the 100 folder.
  for (let i = 0; i < (blockOn('table_','view_toggle','details_') ? runs : 0); i += 1) {
    await goMyFiles(page, base, seed.tableFolders[100]);
    const firstRow = page.locator(ROW_SEL).first();
    const checkbox = firstRow.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible().catch(() => false)) {
      await timed(page, 'table_select', i, () => checkbox.click(), null, { settleMs: 60 });
    }
    const headerCheck = page.locator('input[type="checkbox"][aria-label*="выбрать"], thead input[type="checkbox"]').first();
    if (await headerCheck.isVisible().catch(() => false)) {
      await timed(page, 'table_select_all', i, () => headerCheck.click(), null, { settleMs: 150 });
    }
    const gridBtn = page.locator('[data-testid="my-files-view-grid"]').first();
    if (await gridBtn.isVisible().catch(() => false)) {
      if (scenarioOn('view_toggle')) {
        await timed(page, 'view_toggle', i, () => gridBtn.click(), null, { settleMs: 200 });
      } else if (scenarioOn('view_toggle_back')) {
        // Unmeasured setup: the back-toggle needs the grid view first.
        await gridBtn.click();
        await page.waitForTimeout(200);
      }
      await timed(page, 'view_toggle_back', i,
        () => page.locator('[data-testid="my-files-view-list"]').first().click(), null, { settleMs: 200 });
    }
    // Details panel open/close — the panel steals list width and (in the
    // container-query build) re-tiers the column scheme, so measure both ways.
    const detailsBtn = page.locator('[data-testid="my-files-details-toggle"]').first();
    const detailsPanel = page.locator('[data-testid="my-files-details-panel"]').first();
    if (await detailsBtn.isVisible().catch(() => false)) {
      await timed(page, 'details_open', i, () => detailsBtn.click(), detailsPanel, { settleMs: 200 });
      await timed(page, 'details_close', i, () => detailsBtn.click(), null, { settleMs: 200 });
    }
  }

  // Details open at the largest table — the re-tier must not jank on 1000 rows.
  for (let i = 0; i < (blockOn('details_') ? runs : 0); i += 1) {
    await goMyFiles(page, base, seed.tableFolders[1000]);
    const detailsBtn = page.locator('[data-testid="my-files-details-toggle"]').first();
    const detailsPanel = page.locator('[data-testid="my-files-details-panel"]').first();
    if (await detailsBtn.isVisible().catch(() => false)) {
      await timed(page, 'details_open_1000', i, () => detailsBtn.click(), detailsPanel, { settleMs: 250 });
      await timed(page, 'details_close_1000', i, () => detailsBtn.click(), null, { settleMs: 250 });
    }
  }

  // ---- D: context menus ----------------------------------------------------
  for (let i = 0; i < (blockOn('menu_') ? runs : 0); i += 1) {
    await goMyFiles(page, base, seed.tableFolders[100]);
    const rows = page.locator('[data-testid^="my-files-card-"]:not([data-testid^="my-files-card-menu-"])');
    const firstRow = rows.first();
    // Right-click opens the shared FileActionsContextMenu in BOTH builds (the
    // baseline has no visible ⋮ — its action column is hover-reveal icons).
    await timed(page, 'menu_open_first', i, () => firstRow.click({ button: 'right' }), page.locator(MENU_SEL).first());
    await page.keyboard.press('Escape');
    // Scroll to the list end so the last item is mounted (window virtualization).
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForTimeout(150);
    const lastRow = rows.nth((await rows.count()) - 1);
    await timed(page, 'menu_open_last', i, () => lastRow.click({ button: 'right' }), page.locator(MENU_SEL).first());
    // Group flyout — PR #18 feature; on the flat baseline menu there is no
    // group row, so record -1 instead of failing the whole run. Runs while the
    // right-click menu is still open.
    const group = page.getByTestId('file-action-group-organize');
    if (await group.isVisible().catch(() => false)) {
      await timed(page, 'menu_group_hover', i, () => group.hover(), page.locator('ul[aria-label="Организовать"]'));
      const r2 = await timed(page, 'menu_group_switch', i, () => page.getByTestId('file-action-group-more').hover(),
        page.locator('ul[aria-label="Дополнительно"]'));
      emit('menu_group_switch', 'settled_minus_delay', Math.max(0, r2.last - SUBMENU_DELAY_MS), 'ms', i);
    } else {
      for (const m of ['first_dom', 'settled_dom']) {
        emit('menu_group_hover', m, -1, 'ms', i);
        emit('menu_group_switch', m, -1, 'ms', i);
      }
    }
    await timed(page, 'menu_escape', i, () => page.keyboard.press('Escape'), null, { settleMs: 250 });
    await page.keyboard.press('Escape');
    // ⋮-button latency is measurable only where the button exists (after build).
    const kebab = page.locator(FILE_MENU_BTN).first();
    if (await kebab.isVisible().catch(() => false)) {
      await timed(page, 'menu_open_kebab', i, () => kebab.click(), page.locator(MENU_SEL).first());
      await page.keyboard.press('Escape');
    } else {
      emit('menu_open_kebab', 'first_dom', -1, 'ms', i);
      emit('menu_open_kebab', 'settled_dom', -1, 'ms', i);
    }
  }

  // ---- E: sidebar & tree ---------------------------------------------------
  for (let i = 0; i < (blockOn('sidebar_') ? runs : 0); i += 1) {
    await goMyFiles(page, base);
    const collapse = page.locator(COLLAPSE_BTN).first();
    if (await collapse.isVisible().catch(() => false)) {
      await timed(page, 'sidebar_collapse', i, () => collapse.click(), null, { settleMs: 200 });
      await timed(page, 'sidebar_expand', i, () => collapse.click(), null, { settleMs: 200 });
    }
  }
  // Library navigation cost exists in both builds; the folder TREE under a
  // library is a PR #18 feature (flat in baseline → -1).
  for (let i = 0; i < (blockOn('library_expand') ? runs : 0); i += 1) {
    await goMyFiles(page, base);
    const lib = page.locator(`[data-testid="my-files-library-${seed.libraries.a}"]`).first();
    await timed(page, 'library_expand', i, () => lib.click(), page.locator(ROW_SEL).first());
    emit('library_expand', 'tree_nodes', await page.locator(TREE_NODE).count(), 'count', i);
  }
  for (let i = 0; i < (blockOn('tree_') ? runs : 0); i += 1) {
    // Deep-folder URL: the whole ancestor chain must auto-expand (PR feature).
    await page.goto(`${base}/my-files?library=${seed.libraries.a}&folder=${seed.libDeepFolderId}`);
    await page.locator(ROW_SEL).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const t0 = await page.evaluate((n) => (window.__perf.mark(n), performance.now()), `tree_auto_expand#${i}`);
    const deep = page.locator(`[data-testid="my-files-tree-folder-${seed.libDeepFolderId}"]`).first();
    const found = await deep.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    const probe = await page.evaluate((n) => window.__perf.probe(n), `tree_auto_expand#${i}`);
    emit('tree_auto_expand', 'visible_ms', found ? (probe.last || (await page.evaluate(() => performance.now())) - t0) : -1, 'ms', i);
    emit('tree_auto_expand', 'ancestors_visible', await page.locator(TREE_NODE).count(), 'count', i);
  }

  // ---- F: search & filters --------------------------------------------------
  for (let i = 0; i < (blockOn('search_') ? runs : 0); i += 1) {
    await goMyFiles(page, base);
    const search = page.locator(SEARCH_INPUT).first();
    const apiBefore = await page.evaluate(() => window.__perf.api.length);
    await timed(page, 'search_type', i, async () => {
      await search.click();
      await search.pressSequentially('zebra', { delay: 60 });
    }, page.getByText(seed.markerSearch), { settleMs: 400 });
    const apiAfter = await page.evaluate(() => window.__perf.api.length);
    emit('search_type', 'api_during_typing', apiAfter - apiBefore, 'count', i);
    await search.fill('');
  }

  // ---- G: library settings dialog ------------------------------------------
  for (let i = 0; i < (blockOn('library_dialog') ? runs : 0); i += 1) {
    await goMyFiles(page, base);
    const lib = page.locator(`[data-testid="my-files-library-${seed.libraries.a}"]`).first();
    await lib.click();
    const settingsBtn = page.locator('[data-testid="my-files-library-settings"]').first();
    if (await settingsBtn.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) {
      await timed(page, 'library_dialog_open', i, () => settingsBtn.click(),
        page.getByRole('dialog').first(), { settleMs: 300 });
      const memberRowSel = '[data-testid="my-files-library-members"] [data-testid^="my-files-library-member-menu-"]';
      const accessTab = page.locator('[data-testid="my-files-library-tab-access"]');
      if (await accessTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await timed(page, 'library_dialog_access_tab', i,
          () => accessTab.click(),
          page.locator(`${memberRowSel}, [data-testid="my-files-library-members"]`).first(), { settleMs: 200 });
      }
      await page.locator(memberRowSel).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      emit('library_dialog_open', 'member_rows', await page.locator(memberRowSel).count(), 'count', i);
      // Save without edits — must not emit a members PUT.
      const apiB = await page.evaluate(() => window.__perf.api.filter((e) => /members/.test(e.n)).length);
      const save = page.getByRole('button', { name: /Сохранить/ }).first();
      if (await save.isEnabled().catch(() => false)) {
        await save.click();
        await page.waitForTimeout(800);
        const membersCalls = await page.evaluate(() => window.__perf.api.filter((e) => /members/.test(e.n)).length);
        emit('library_dialog_save', 'member_puts_on_noop_save', membersCalls - apiB, 'count', i);
      } else {
        await page.keyboard.press('Escape');
      }
      await page.keyboard.press('Escape');
    }
  }

  // ---- Memory churn: repeated navigation ------------------------------------
  {
    await goMyFiles(page, base);
    const heaps = [];
    const memCycles = Number(process.env.PERF_MEM_CYCLES || '12');
    for (let i = 0; i < (blockOn('memory_') ? memCycles : 0); i += 1) {
      await page.locator(`[data-testid="my-files-folder-${seed.tableFolders[10]}"]`).first().click();
      await page.locator(ROW_SEL).first().waitFor({ state: 'visible' });
      await page.goBack();
      await page.locator(`[data-testid="my-files-folder-${seed.tableFolders[10]}"]`).waitFor({ state: 'visible' });
      heaps.push(await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0));
    }
    emit('memory_nav_churn', 'heap_first_mb', heaps[0], 'MB', 0);
    emit('memory_nav_churn', 'heap_last_mb', heaps[heaps.length - 1], 'MB', 0);
    emit('memory_nav_churn', 'heap_growth_mb', heaps[heaps.length - 1] - heaps[0], 'MB', 0);
  }

  await context.close();
  await browser.close();
  console.log(`run: done -> ${csvFile}`);
}

// ------------------------------------------------------------- compare ----

function compare(outDir) {
  const parse = (file) => {
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const header = lines.shift();
    return lines.filter(Boolean).map((l) => {
      const [scenario, metric, unit, value, run] = l.split(',');
      return { scenario, metric, unit, value: Number(value), run: Number(run) };
    });
  };
  const dedupe = (rows) => {
    const m = new Map();
    rows.forEach((r) => m.set(`${r.scenario}|${r.metric}|${r.run}`, r));
    return [...m.values()];
  };
  const stats = (rows, scenario, metric) => {
    const vals = rows.filter((r) => r.scenario === scenario && r.metric === metric && r.value !== -1).map((r) => r.value).sort((a, b) => a - b);
    if (!vals.length) return null;
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    return { n: vals.length, min: vals[0], p50: q(0.5), p95: q(0.95), max: vals[vals.length - 1] };
  };
  const base = dedupe(parse(join(outDir, 'results-baseline.csv')));
  const after = dedupe(parse(join(outDir, 'results-after.csv')));
  const keys = new Set([...base, ...after].map((r) => `${r.scenario}|${r.metric}|${r.unit}`));
  const lines = ['scenario,metric,unit,base_p50,base_p95,base_min,base_max,after_p50,after_p95,after_min,after_max,delta_p50_pct,delta_p95_pct,n_base,n_after'];
  [...keys].sort().forEach((key) => {
    const [scenario, metric, unit] = key.split('|');
    const b = stats(base, scenario, metric);
    const a = stats(after, scenario, metric);
    const d50 = b && a && b.p50 ? Math.round(((a.p50 - b.p50) / b.p50) * 1000) / 10 : '';
    const d95 = b && a && b.p95 ? Math.round(((a.p95 - b.p95) / b.p95) * 1000) / 10 : '';
    lines.push(`${scenario},${metric},${unit},${b ? [b.p50, b.p95, b.min, b.max].join(',') : ',,,'},${a ? [a.p50, a.p95, a.min, a.max].join(',') : ',,,'},${d50},${d95},${b?.n || 0},${a?.n || 0}`);
  });
  const out = join(outDir, 'comparison.csv');
  writeFileSync(out, lines.join('\n'));
  console.log(`compare -> ${out} (${keys.size} metrics)`);
}

// ---------------------------------------------------------------- main ----

const base = opt('base');
if (cmd === 'seed') {
  await seed(base, opt('seed-out', join(OUT_DIR, 'seed.json')));
} else if (cmd === 'run') {
  await run(base, opt('label', 'run'), opt('seed', join(OUT_DIR, 'seed.json')), Number(opt('runs', '10')));
} else if (cmd === 'compare') {
  compare(opt('dir', OUT_DIR));
} else {
  console.log('usage: my-files-perf.mjs seed|run|compare --base <url> [--label x] [--seed f.json] [--runs 10]');
}
