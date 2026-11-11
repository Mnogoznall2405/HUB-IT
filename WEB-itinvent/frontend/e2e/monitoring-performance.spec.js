import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.skip(process.env.E2E_LOCAL !== '1', 'Requires isolated API fixtures');
const identity = { id: 7, username: 'monitor-test', role: 'admin', is_active: true };
const initial = new Date();
const device = (id) => ({
  id, name: id === 'a' ? 'Central' : 'Branch', address: `192.0.2.${id === 'a' ? 1 : 2}`, enabled: true,
  current: { checked_at: initial.toISOString(), icmp_checked_at: initial.toISOString(), sample_at: initial.toISOString(), last_success_at: initial.toISOString(), status: 'online', snmp_status: 'ok', device: {}, ping: { status: 'online' } },
  interfaces: [{ id: `${id}-port`, name: 'ether1', settings: { role: 'wan' }, current: { oper: 1, type: 6 } }], events: [],
});
const history = (id, port) => ({
  resolution_seconds: 120, has_data: true, totals: {},
  points: Array.from({ length: 721 }, (_, i) => ({ at: new Date(initial.getTime() - (720 - i) * 120000).toISOString(),
    ...(port ? { rx_bps: 1e6, tx_bps: 2e6, rx_util_pct: 1, tx_util_pct: 2 } : { latency_ms: id === 'a' ? 7 : 29, cpu_pct: 15, memory_pct: 30, ping_up: 1, snmp_up: 1 }) })),
});
const latency = (page) => page.getByRole('region', { name: 'Задержка до устройства', exact: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function prepare(page, options = {}) {
  const targets = { a: device('a'), b: device('b') };
  if (options.qualityPoints) targets.a.current.icmp_history_since = options.qualityPoints[0].at;
  const calls = [];
  const state = { portError: options.portError || false, latency: 7, observedAt: initial.toISOString() };
  const latencyPoints = new Map(['a', 'b'].map((id) => [id, options.qualityPoints || Array.from({ length: options.latencyPoints || 8641 }, (_, i) => ({
    at: new Date(initial.getTime() - ((options.latencyPoints || 8641) - 1 - i) * 10000).toISOString(),
    latency_ms: id === 'a' ? 7 : 29, source_resolution_seconds: 10,
  }))]));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript((user) => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('hubit:desktop-handoff', 'never'); }, identity);
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
  await page.routeWebSocket('**/*', (socket) => {
    const url = new URL(socket.url());
    if (url.hostname === '127.0.0.1' && url.port === '5220' && url.pathname === '/') socket.connectToServer();
    else socket.close();
  });
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: identity }));
  await page.route('**/api/v1/monitoring/**', async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.match(/\/targets\/([^/]+)/)?.[1];
    if (url.pathname.endsWith('/overview')) return route.fulfill({ json: { targets: Object.values(targets), checked_at: new Date().toISOString() } });
    if (url.pathname.endsWith('/latency-history')) {
      let points = latencyPoints.get(id);
      if (id === 'a' && Date.parse(points.at(-1).at) < Date.parse(state.observedAt)) {
        points = [...points, { at: state.observedAt, latency_ms: state.latency, source_resolution_seconds: 10 }];
        latencyPoints.set(id, points);
      }
      const after = url.searchParams.get('after');
      const selected = after ? points.filter((p) => Date.parse(p.at) >= Date.parse(after)) : points;
      calls.push({ id, latency: true, after, points: selected.length });
      await wait(options.systemDelay || 0);
      return route.fulfill({ json: { points: selected, resolution_seconds: 10, has_data: true,
        window_start: points[0].at, replace_from: after || points[0].at } });
    }
    if (url.pathname.endsWith('/history')) {
      const port = Boolean(url.searchParams.get('interface_id'));
      calls.push({ id, port });
      await wait(port ? options.portDelay || 0 : options.systemDelay || 0);
      return state.portError && port ? route.fulfill({ status: 503, json: { detail: 'Port history unavailable' } }) : route.fulfill({ json: history(id, port) });
    }
    if (id) {
      await wait(options.detailDelay || 0);
      return route.fulfill({ json: { ...targets[id], current: { ...targets[id].current, checked_at: new Date().toISOString(),
        icmp_checked_at: id === 'a' ? state.observedAt : initial.toISOString() } } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/monitoring');
  await expect(page.getByRole('button', { name: 'Открыть Central', exact: true })).toBeVisible();
  return { calls, state };
}

test('system graphs open before slow detail and port history', async ({ page }) => {
  await prepare(page, { detailDelay: 2500, portDelay: 10000 });
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  await expect(latency(page).getByTestId('monitoring-chart')).toBeVisible({ timeout: 1500 });
  await expect(latency(page)).toContainText('7 мс');
});

test('port history error preserves system graphs and can be retried', async ({ page }) => {
  const { state } = await prepare(page, { portError: true });
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  await expect(latency(page).getByTestId('monitoring-chart')).toBeVisible();
  const error = page.getByRole('alert').filter({ hasText: 'Графики интерфейса' });
  await expect(error).toBeVisible();
  state.portError = false;
  await error.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Трафик · ether1', exact: true }).getByTestId('monitoring-chart')).toBeVisible();
});

test('status refresh reuses history and cached return cannot show another device', async ({ page }) => {
  await page.clock.install();
  const { calls } = await prepare(page);
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  await expect(latency(page)).toContainText('7 мс');
  await expect.poll(() => calls.length).toBe(3);
  await page.clock.fastForward(31000);
  await expect(latency(page)).toContainText('7 мс');
  expect(calls.length).toBe(3);
  await page.getByRole('button', { name: 'Открыть Branch', exact: true }).click();
  await expect(latency(page)).toContainText('29 мс');
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  await expect(latency(page)).toContainText('7 мс');
  expect(calls.filter((c) => c.id === 'a').length).toBe(3);
});

test('latency chart receives only the new tail every ten seconds and reload restores its history', async ({ page }) => {
  await page.clock.install();
  const { calls, state } = await prepare(page);
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  await expect(latency(page)).toContainText('7 мс');
  const ordinaryHistory = () => calls.filter((c) => !c.latency).length;
  await expect.poll(ordinaryHistory).toBe(2);
  state.latency = 17; state.observedAt = new Date(initial.getTime() + 10000).toISOString();
  await page.clock.fastForward(10000);
  await expect(latency(page)).toContainText('17 мс');
  expect(ordinaryHistory()).toBe(2);
  const update = calls.filter((c) => c.latency).at(-1);
  expect(update.after).toBeTruthy();
  expect(update.points).toBeLessThan(10);
  await latency(page).getByRole('button', { name: 'Таблица значений' }).click();
  await expect(latency(page).getByRole('cell', { name: '7 мс', exact: true }).first()).toBeVisible();
  await expect(latency(page).getByRole('cell', { name: '17 мс', exact: true })).toBeVisible();
  const reloadBoundary = calls.length;
  await page.reload();
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  await expect(latency(page)).toContainText('17 мс');
  expect(calls.slice(reloadBoundary).find((c) => c.latency).after).toBeNull();
});

test('quality separates missing checks, ICMP failures and collector errors after reload', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const qualityPoints = ['online', 'offline', 'partial', 'collector_error', 'missing', 'pending'].map((quality_status, i) => ({
    at: new Date(initial.getTime() - (5-i)*10000).toISOString(), quality_status, source_resolution_seconds: 10,
    latency_ms: i === 0 ? 7 : i === 2 ? 19 : null, sent: i < 3 ? 3 : null,
    received: i < 3 ? [3,0,2][i] : i === 3 ? 1 : null,
    error: i === 3 ? 'collector_timeout' : null,
  }));
  await prepare(page, { qualityPoints });
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  const chart = latency(page);
  await expect(chart).toContainText('Выполнено 3 из 5 проверок · пропущено 1 · ошибок проверки 1');
  await expect(chart).toContainText('Полнота: 60%');
  await expect(chart).toContainText('Есть пробелы наблюдения');
  await chart.getByRole('button', { name: 'Таблица значений' }).click();
  await expect(chart.getByRole('row').filter({ hasText: 'Нет ответа ICMP' })).toContainText('0 из 3 ответов');
  await expect(chart.getByRole('row').filter({ hasText: 'Ошибка проверки' })).toContainText('Истёк срок выполнения ping на сервере');
  await expect(chart.getByRole('row').filter({ hasText: 'Проверка пропущена' })).toContainText('Нет измерения');
  await page.screenshot({ path: testInfo.outputPath('quality-desktop.png'), fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  await expect(chart).toContainText('Выполнено 3 из 5 проверок');
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(chart).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('quality-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a period containing only missing checks still exposes quality and its values table', async ({ page }) => {
  await prepare(page, { qualityPoints: ['missing', 'collector_error'].map((quality_status, i) => ({
    at: new Date(initial.getTime() - (1-i)*10000).toISOString(), quality_status, latency_ms: null, source_resolution_seconds: 10,
  })) });
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  const chart = latency(page);
  await expect(chart).toContainText('Выполнено 0 из 2 проверок');
  await chart.getByRole('button', { name: 'Таблица значений' }).click();
  await expect(chart.getByRole('row').filter({ hasText: 'Проверка пропущена' })).toBeVisible();
  await expect(chart.getByRole('row').filter({ hasText: 'Ошибка проверки' })).toBeVisible();
});

test('quality continues refreshing when the collector stops updating its ICMP timestamp', async ({ page }) => {
  await page.clock.install();
  const points = [
    { at: new Date(initial.getTime()-10000).toISOString(), quality_status: 'online', latency_ms: 7, source_resolution_seconds: 10 },
    { at: initial.toISOString(), quality_status: 'pending', latency_ms: null, source_resolution_seconds: 10 },
  ];
  const { calls } = await prepare(page, { qualityPoints: points });
  await page.getByRole('button', { name: 'Открыть Central', exact: true }).click();
  await expect(latency(page)).toContainText('Выполнено 1 из 1 проверок');
  const before = calls.filter(call => call.latency).length;
  points[1].quality_status = 'missing';
  points.push({ at: new Date(initial.getTime()+10000).toISOString(), quality_status: 'pending', latency_ms: null, source_resolution_seconds: 10 });
  await page.clock.fastForward(10000);
  await expect(latency(page)).toContainText('Выполнено 1 из 2 проверок · пропущено 1');
  expect(calls.filter(call => call.latency).length).toBeGreaterThan(before);
});

test('benchmark repeated native opens with 721-point histories', async ({ page }, testInfo) => {
  test.skip(process.env.MONITORING_BENCHMARK !== '1', 'Explicit benchmark only');
  test.setTimeout(300000);
  const { calls } = await prepare(page, { detailDelay: 80, systemDelay: 40, portDelay: 180 });
  const profiler = process.env.MONITORING_BROWSER_PROFILE === '1' ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
  const rounds = [];
  for (let round = 0; round < Number(process.env.MONITORING_BENCHMARK_ROUNDS || 3); round += 1) {
    const values = [];
    for (let i = 0; i < Number(process.env.MONITORING_BENCHMARK_OPENS || 30); i += 1) {
      const label = i % 2 ? 'Branch' : 'Central';
      const expected = i % 2 ? '29 мс' : '7 мс';
      const started = performance.now();
      await page.getByRole('button', { name: `Открыть ${label}`, exact: true }).click();
      await expect(latency(page).getByTestId('monitoring-chart')).toBeVisible();
      await expect(latency(page)).toContainText(expected);
      values.push(performance.now() - started);
      await page.getByRole('button', { name: 'Все устройства', exact: true }).click();
    }
    const sorted = [...values].sort((a, b) => a - b);
    rounds.push({ p50: sorted[Math.ceil(sorted.length * 0.5) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], p99: sorted[sorted.length - 1], values });
  }
  if (profiler) {
    const profile = await profiler.send('Profiler.stop');
    await writeFile(testInfo.outputPath('chart-rendering.cpuprofile'), JSON.stringify(profile.profile));
    await profiler.detach();
  }
  const path = testInfo.outputPath(`benchmark-${process.env.MONITORING_BENCHMARK_LABEL || 'run'}.json`);
  await writeFile(path, JSON.stringify({ rounds, historyRequests: calls.length, fixture: { devices: 2, points: 721, detailMs: 80, systemMs: 40, portMs: 180 } }, null, 2));
  console.log(JSON.stringify({ rounds: rounds.map(({ values, ...rest }) => rest), historyRequests: calls.length }));
});
