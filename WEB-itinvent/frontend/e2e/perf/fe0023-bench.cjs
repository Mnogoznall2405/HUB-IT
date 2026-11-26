#!/usr/bin/env node
/*
 * FE-0023 perf benchmark — Networks mobile card lists with 10k ports/sockets.
 *
 * Measures (per scenario): time-to-settled-DOM after tab activation, longtask
 * count/total, DOM node count, JS heap (CDP Performance.getMetrics), and a
 * synthetic scroll pass (frame gaps > 50ms).
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:PORT node fe0023-bench.cjs --viewport mobile|desktop
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5310';
const VIEWPORT = (process.argv.find((a) => a.startsWith('--viewport=')) || '').split('=')[1] || 'mobile';
const N_PORTS = 10000;
const N_SOCKETS = 10000;
const N_DEVICES = 40;

function makePorts() {
  const ports = [];
  for (let i = 0; i < N_PORTS; i++) {
    const dev = (i % N_DEVICES) + 1;
    ports.push({
      id: i + 1,
      device_id: dev,
      device_code: `ASW-${String(dev).padStart(2, '0')}`,
      port_name: `Gi1/0/${(i % 48) + 1}`,
      patch_panel_port: `PP-${Math.floor(i / 48)}-${(i % 48) + 1}`,
      location_code: `K${(i % 9) + 1}-${i % 40}`,
      vlan_raw: `${100 + (i % 20)}`,
      endpoint_name_raw: `WS-${String(i).padStart(5, '0')}`,
      endpoint_ip_raw: `10.20.${Math.floor(i / 250)}.${i % 250}`,
      endpoint_mac_raw: `AA:BB:CC:${String(Math.floor(i / 65536) % 256).padStart(2, '0')}:${String(Math.floor(i / 256) % 256).padStart(2, '0')}:${String(i % 256).padStart(2, '0')}`,
      fio: `Пользователь ${i}`,
      socket_id: null,
    });
  }
  return ports;
}

function makeSockets() {
  const sockets = [];
  for (let i = 0; i < N_SOCKETS; i++) {
    sockets.push({
      id: i + 1,
      socket_code: `A${i + 1}`,
      port_id: null,
      map_point_id: null,
      comment: '',
    });
  }
  return sockets;
}

function makeDevices() {
  const devices = [];
  for (let i = 1; i <= N_DEVICES; i++) {
    devices.push({ id: i, device_code: `ASW-${String(i).padStart(2, '0')}`, model: 'SW48', location: `K${(i % 9) + 1}` });
  }
  return devices;
}

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function installRoutes(page) {
  const ports = makePorts();
  const sockets = makeSockets();
  const devices = makeDevices();
  await page.route('**/api/v1/networks/**', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (/^\/api\/v1\/networks\/branches$/.test(p)) {
      return json(route, { branches: [{ id: 1, name: 'HQ-Mega', city: 'tmn', default_site_code: 'hq' }] });
    }
    if (/^\/api\/v1\/networks\/branches\/1\/overview$/.test(p)) {
      return json(route, {
        branch: { id: 1, name: 'HQ-Mega', city: 'tmn' },
        metrics: { sockets_count: N_SOCKETS, ports_count: N_PORTS, devices_count: N_DEVICES, points_count: 0 },
      });
    }
    if (/^\/api\/v1\/networks\/branches\/1\/devices$/.test(p)) return json(route, { devices });
    if (/^\/api\/v1\/networks\/branches\/1\/maps$/.test(p)) return json(route, { maps: [] });
    if (/^\/api\/v1\/networks\/branches\/1\/map-points$/.test(p)) return json(route, { points: [] });
    if (/^\/api\/v1\/networks\/branches\/1\/sockets$/.test(p)) return json(route, { sockets });
    if (/^\/api\/v1\/networks\/branches\/1\/ports$/.test(p)) return json(route, { ports });
    if (/^\/api\/v1\/networks\/devices\/(\d+)\/ports$/.test(p)) {
      const devId = Number(p.match(/devices\/(\d+)\/ports/)[1]);
      return json(route, { ports: ports.filter((pt) => pt.device_id === devId) });
    }
    if (/^\/api\/v1\/networks\/audit$/.test(p)) return json(route, { items: [] });
    return json(route, {});
  });
}

async function login(ctx) {
  // API login — cookies land in the browser context jar; identical on both builds.
  const res = await ctx.request.post(BASE + '/api/v1/auth/login', {
    data: { username: 'e2e_admin', password: 'e2e-local-admin-pass' },
  });
  if (res.status() !== 200) throw new Error(`login ${res.status()}`);
  const body = await res.json();
  if (body.status !== 'authenticated') throw new Error(`login status ${body.status}`);
}

const INSTRUMENT = `
  window.__perf = { longTasks: [], settledAt: null };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ entryTypes: ['longtask'] });
`;

async function domSettled(page, t0, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stableCount = 0;
  while (Date.now() < deadline) {
    const now = await page.evaluate(() => performance.now());
    const cards = await page.evaluate(() => document.querySelectorAll('.MuiCard-root').length + document.querySelectorAll('tbody tr').length);
    if (cards === last && cards > 0) {
      stableCount += 1;
      if (stableCount >= 2 && now - t0 > 400) return { ok: true, elapsed: now - t0, cards };
    } else {
      stableCount = 0;
      last = cards;
    }
    await page.waitForTimeout(400);
  }
  return { ok: false, elapsed: timeoutMs, cards: last };
}

async function measureTab(page, tabName, cdp) {
  // Arm observer, click the tab, wait for DOM to settle.
  await page.evaluate(INSTRUMENT);
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole('tab', { name: tabName }).click();
  await page.waitForFunction(
    (name) => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() === name,
    tabName, { timeout: 30000 },
  ).catch(() => {});
  console.log(`[bench] ${tabName} selected=`, await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()));
  // FE-0023 scenario: "Все устройства" (whole-branch list). If a device chip is
  // selected, reset to the branch-wide view before measuring.
  if (tabName === 'Оборудование') {
    const allChip = page.getByText('Все устройства', { exact: true }).first();
    if (await allChip.count()) {
      const isSel = await page.evaluate(() => document.querySelector('.MuiChip-filled')?.textContent?.includes('Все устройства'));
      if (!isSel) await allChip.click().catch(() => {});
    }
  }
  const settle = await domSettled(page, t0, 200000);
  if (!settle.ok) {
    const dbg = await page.evaluate(() => ({
      selectedChip: document.querySelector('.MuiChip-filled')?.textContent || null,
      panelText: document.querySelector('main')?.innerText?.slice(0, 400) || document.body.innerText.slice(0, 400),
      portsReq: window.__lastPortsReq || null,
    })).catch((e) => ({ err: String(e) }));
    console.log(`[bench] ${tabName} settle-timeout debug:`, JSON.stringify(dbg));
  }
  const stats = await page.evaluate(() => ({
    longCount: window.__perf.longTasks.length,
    longTotal: Math.round(window.__perf.longTasks.reduce((s, t) => s + t.dur, 0)),
    longMax: Math.round(Math.max(0, ...window.__perf.longTasks.map((t) => t.dur))),
    domNodes: document.querySelectorAll('*').length,
    cards: document.querySelectorAll('.MuiCard-root').length,
    showMore: !!document.querySelector('[class*="MuiButton"],button') && document.body.innerText.includes('Показать ещё'),
  }));
  const metrics = await cdp.send('Performance.getMetrics');
  const heap = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0;
  // Scroll pass: 25 viewport scrolls, count rAF gaps.
  const scroll = await page.evaluate(async () => {
    const el = document.scrollingElement || document.documentElement;
    const gaps = [];
    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      gaps.push(performance.now() - start);
      el.scrollTop += 700;
      if (el.scrollTop >= el.scrollHeight - el.clientHeight - 10) el.scrollTop = 0;
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      frames: gaps.length,
      janky: gaps.filter((g) => g > 50).length,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0),
      max: Math.round(sorted[sorted.length - 1] || 0),
    };
  });
  return { tab: tabName, settle, stats, heapMB: Math.round(heap / 1048576), scroll };
}

async function main() {
  const mobile = VIEWPORT === 'mobile';
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' }
      : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' },
  );
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await installRoutes(page);
  await login(ctx);
  await page.goto(BASE + '/networks/1', { waitUntil: 'load' });
  await page.waitForSelector('text=HQ-Mega', { timeout: 30000 });
  await page.waitForTimeout(6000); // let initial tab + branch context load fully

  const results = { viewport: VIEWPORT, base: BASE, tabs: [] };
  if (mobile) {
    // Mobile default tab is 'maps'; click through the two heavy tabs.
    results.tabs.push(await measureTab(page, 'Оборудование', cdp));
    results.tabs.push(await measureTab(page, 'Розетки', cdp));
  } else {
    // Desktop opens on 'equipment' already — settle is the load itself.
    results.tabs.push(await measureTab(page, 'Розетки', cdp));
    results.tabs.push(await measureTab(page, 'Оборудование', cdp));
    const domNow = await page.evaluate(() => document.querySelectorAll('*').length);
    results.desktopEquipmentDomNodes = domNow;
  }
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
}

main().catch((e) => {
  console.error('BENCH_FAILED', e);
  process.exit(1);
});
