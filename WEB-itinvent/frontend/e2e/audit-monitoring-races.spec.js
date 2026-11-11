import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'Only isolated API fixtures');
const user = { id: 7, username: 'audit', role: 'admin', is_active: true };
const now = new Date().toISOString();
const device = (id, name) => ({
  id, name, address: id === 'a' ? '192.0.2.1' : '192.0.2.2', enabled: true,
  current: { checked_at: now, last_success_at: now, snmp_status: 'ok', ping: { status: 'ok' }, device: {} },
  interfaces: [{ id: `${id}-port`, name: `${name}-port`, settings: {}, current: { oper: 1, type: 6 } }],
});
const targets = { a: device('a', 'Audit A'), b: device('b', 'Audit B') };

async function completeProbe(page, probe, json, status = 200) {
  const response = page.waitForResponse((item) => item.url() === probe.route.request().url() && item.request().method() === 'POST');
  await probe.route.fulfill({ status, json });
  await (await response).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const ports = (page) => page.getByRole('table', { name: 'Состояние интерфейсов' });
const updated = (id) => ({ ...targets[id], interfaces: [{ ...targets[id].interfaces[0], id: `${id}-new`, name: `NEW ${id}-port` }] });

async function prepare(page) {
  const probes = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript((identity) => {
    localStorage.setItem('user', JSON.stringify(identity));
    localStorage.setItem('hubit:desktop-handoff', 'never');
  }, user);
  // No request can reach production or real equipment, including WebSockets.
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
  await page.routeWebSocket('**/*', (socket) => {
    const url = new URL(socket.url());
    if (url.hostname === '127.0.0.1' && url.port === '5220' && url.pathname === '/') socket.connectToServer();
    else socket.close();
  });
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: user }));
  await page.route('**/api/v1/monitoring/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/overview')) return route.fulfill({ json: { targets: Object.values(targets), checked_at: now } });
    const id = path.match(/\/targets\/([^/]+)/)?.[1];
    if (path.endsWith('/probe')) { probes.push({ id, route }); return; }
    if (path.endsWith('/history')) return route.fulfill({ json: { points: [] } });
    if (id) return route.fulfill({ json: targets[id] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/monitoring');
  await page.getByRole('button', { name: 'Открыть Audit A', exact: true }).click();
  await page.getByRole('tab', { name: 'Интерфейсы', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Состояние интерфейсов' })).toContainText('Audit A-port');
  return probes;
}

test('late probe of A cannot erase the selected B interfaces', async ({ page }) => {
  const probes = await prepare(page);
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(1);
  await page.getByRole('button', { name: 'Открыть Audit B', exact: true }).click();
  await expect(ports(page)).toContainText('Audit B-port');
  await completeProbe(page, probes[0], targets.a);
  await expect(page.getByRole('button', { name: 'Опросить', exact: true })).toBeEnabled();
  await expect(ports(page)).toContainText('Audit B-port');
});

test('late probe error of A is not shown on B', async ({ page }) => {
  const probes = await prepare(page);
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(1);
  await page.getByRole('button', { name: 'Открыть Audit B', exact: true }).click();
  await expect(ports(page)).toContainText('Audit B-port');
  await completeProbe(page, probes[0], { detail: 'STALE_PROBE_ERROR' }, 503);
  await expect(page.getByText('STALE_PROBE_ERROR', { exact: true })).toHaveCount(0);
  await expect(ports(page)).toContainText('Audit B-port');
});

test('returning A to B to A does not accept an old probe of A', async ({ page }) => {
  const probes = await prepare(page);
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(1);
  await page.getByRole('button', { name: 'Открыть Audit B', exact: true }).click();
  await expect(ports(page)).toContainText('Audit B-port');
  await page.getByRole('button', { name: 'Открыть Audit A', exact: true }).click();
  await expect(ports(page)).toContainText('Audit A-port');
  await completeProbe(page, probes[0], updated('a'));
  await expect(ports(page)).toContainText('Audit A-port');
  await expect(ports(page)).not.toContainText('NEW a-port');
});

test('old completion cannot stop the new selected device probe', async ({ page }) => {
  const probes = await prepare(page);
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(1);
  await page.getByRole('button', { name: 'Открыть Audit B', exact: true }).click();
  await expect(ports(page)).toContainText('Audit B-port');
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(2);
  await completeProbe(page, probes[0], { detail: 'STALE_PROBE_ERROR' }, 503);
  await expect(page.getByRole('button', { name: 'Опрашиваем…', exact: true })).toBeDisabled();
  await expect(page.getByText('STALE_PROBE_ERROR', { exact: true })).toHaveCount(0);
  await completeProbe(page, probes[1], updated('b'));
  await expect(ports(page)).toContainText('NEW b-port');
  await expect(page.getByRole('button', { name: 'Опросить', exact: true })).toBeEnabled();
});

test('current device probe updates its interfaces and permits another probe', async ({ page }) => {
  const probes = await prepare(page);
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(1);
  await completeProbe(page, probes[0], updated('a'));
  await expect(ports(page)).toContainText('NEW a-port');
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(2);
  await completeProbe(page, probes[1], targets.a);
  await expect(ports(page)).toContainText('Audit A-port');
});

test('current probe failure shows its error and leaves retry available', async ({ page }) => {
  const probes = await prepare(page);
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(1);
  await completeProbe(page, probes[0], { detail: 'CURRENT_PROBE_ERROR' }, 503);
  await expect(page.getByText('CURRENT_PROBE_ERROR', { exact: true })).toBeVisible();
  await expect(ports(page)).toContainText('Audit A-port');
  await expect(page.getByRole('button', { name: 'Опросить', exact: true })).toBeEnabled();
});

test('earlier detail GET cannot overwrite a completed manual probe', async ({ page }) => {
  const probes = await prepare(page);
  let oldDetail;
  await page.route('**/api/v1/monitoring/targets/a', (route) => { oldDetail = route; });
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect.poll(() => Boolean(oldDetail)).toBe(true);
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(1);
  await completeProbe(page, probes[0], updated('a'));
  await expect(ports(page)).toContainText('NEW a-port');
  await oldDetail.fulfill({ json: targets.a });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(ports(page)).toContainText('NEW a-port');
});

test('response for another device is rejected without changing selected interfaces', async ({ page }) => {
  const probes = await prepare(page);
  await page.getByRole('button', { name: 'Опросить', exact: true }).click();
  await expect.poll(() => probes.length).toBe(1);
  await completeProbe(page, probes[0], targets.b);
  await expect(ports(page)).toContainText('Audit A-port');
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось обновить данные. Проверьте подключение и повторите.' })).toBeVisible();
});
