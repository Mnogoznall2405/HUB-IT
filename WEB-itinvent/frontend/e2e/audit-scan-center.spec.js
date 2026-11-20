import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'Requires the isolated SQLite local stack');
test.use({ serviceWorkers: 'block' });
const json = (route, body) => route.fulfill({ json: body });

const DASHBOARD = {
  totals: { incidents_new: 2, incidents_ack: 5, hosts: 3, agents_online: 2, jobs_queued: 7 },
  daily: [], by_severity: [], by_branch: [], new_hosts: [],
};
const INCIDENT = (id, name = 'report.pdf') => ({
  id, status: 'new', severity: 'high', file_name: name,
  file_path: `C:\\docs\\${name}`, file_ext: '.pdf', hostname: 'HOST-01',
  branch: 'MSK', source_kind: 'pdf_slice', pattern_id: 'dsp_doc',
  pattern_name: 'ДСП документ', created_at: 1795100000, page: 1,
  matched_value: 'ДСП', snippet: 'текст ДСП вокруг',
});
const EMPTY_LIST = { items: [], total: 0, limit: 80, offset: 0, has_more: false };

async function login(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hubit:desktop-handoff', 'never');
  });
  const response = await page.request.post('/api/v1/auth/login', { data: {
    username: process.env.E2E_USERNAME, password: process.env.E2E_PASSWORD,
  } });
  expect(response.status()).toBe(200);
}

// Stub every scan endpoint; individual tests override specific ones.
async function stubScan(page, overrides = {}) {
  const sse = (route) => route.fulfill({
    status: 200, contentType: 'text/event-stream',
    body: 'id: s1\nevent: scan.connected\ndata: {"protocol":1}\n\n: hb\n\n',
  });
  const defaults = {
    'events': sse,
    'dashboard': (route) => json(route, DASHBOARD),
    'branches': (route) => json(route, ['MSK', 'SPB']),
    'review-items': (route) => json(route, EMPTY_LIST),
    'incidents': (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/inbox-groups')) return json(route, { items: [], total_hosts: 0, total_incidents: 0, has_more: false });
      return json(route, { ...EMPTY_LIST, items: [INCIDENT('i-1')], total: 1 });
    },
    'patterns': (route) => json(route, { items: [{ id: 'dsp_doc', name: 'ДСП документ', category: 'ДСП', weight: 5, enabled_by_default: true }] }),
    'agents/table': (route) => json(route, { items: [], total: 0 }),
    'agents': (route) => json(route, []),
    'agents/activity': (route) => json(route, { items: [] }),
    'hosts/table': (route) => json(route, { items: [], total: 0 }),
    'hosts': (route) => json(route, { items: [] }),
  };
  await page.route('**/api/v1/scan/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/api/v1/scan/')[1] || '';
    for (const key of Object.keys(overrides)) {
      if (path === key || path.startsWith(`${key}/`)) return overrides[key](route);
    }
    for (const [key, handler] of Object.entries(defaults)) {
      if (path === key || path.startsWith(`${key}/`)) return handler(route);
    }
    return json(route, {});
  });
}

test('cold open renders dashboard counts and first inbox incident', async ({ page }) => {
  await login(page);
  await stubScan(page);
  await page.goto('/scan-center');
  await expect(page.getByRole('tab', { name: /Инциденты/ })).toBeVisible();
  await page.getByRole('tab', { name: /Инциденты/ }).click();
  await expect(page.getByText('report.pdf').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('tab', { name: /Обзор/ })).toBeVisible();
});

test('inbox network error shows an alert instead of a stuck spinner', async ({ page }) => {
  await login(page);
  await stubScan(page, {
    'incidents': (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/inbox-groups')) return json(route, { items: [], total_hosts: 0, total_incidents: 0, has_more: false });
      return route.fulfill({ status: 500, json: { detail: 'boom' } });
    },
  });
  await page.goto('/scan-center');
  await page.getByRole('tab', { name: /Инциденты/ }).click();
  await expect(page.getByText(/Не удалось загрузить инциденты/)).toBeVisible({ timeout: 15000 });
});

test('a late response from an older filter does not clobber the new result', async ({ page }) => {
  await login(page);
  let pending;
  let qCalls = 0;
  await stubScan(page, {
    'incidents': (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/inbox-groups')) return json(route, { items: [], total_hosts: 0, total_incidents: 0, has_more: false });
      const q = url.searchParams.get('q');
      if (q === 'newfile') {
        return json(route, { ...EMPTY_LIST, items: [INCIDENT('i-9', 'newfile.pdf')], total: 1 });
      }
      qCalls += 1;
      if (qCalls === 1) { pending = route; return; }
      return json(route, EMPTY_LIST);
    },
  });
  await page.goto('/scan-center');
  await page.getByRole('tab', { name: /Инциденты/ }).click();
  await expect.poll(() => qCalls).toBeGreaterThan(0);
  await page.getByLabel('Поиск').fill('newfile');
  await expect(page.getByText('newfile.pdf').first()).toBeVisible({ timeout: 15000 });
  // The stale first response arrives after the filtered one — must be ignored.
  await json(pending, { ...EMPTY_LIST, items: [INCIDENT('i-stale', 'stale.pdf')], total: 1 });
  await expect(page.getByText('newfile.pdf').first()).toBeVisible();
  await expect(page.getByText('stale.pdf')).toHaveCount(0);
});

test('ack of a selected incident issues POST ack and refreshes the list', async ({ page }) => {
  await login(page);
  let acked = false;
  await stubScan(page, {
    'incidents/i-1/ack': (route) => { acked = true; return json(route, { success: true, incident: { ...INCIDENT('i-1'), status: 'ack' } }); },
  });
  await page.goto('/scan-center');
  await page.getByRole('tab', { name: /Инциденты/ }).click();
  await expect(page.getByText('report.pdf').first()).toBeVisible({ timeout: 15000 });
  await page.getByText('report.pdf').first().click();
  await page.getByRole('button', { name: 'Отметить просмотренным' }).click();
  await expect.poll(() => acked).toBe(true);
});

test('empty inbox shows the empty state, not an error', async ({ page }) => {
  await login(page);
  await stubScan(page, {
    'incidents': (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/inbox-groups')) return json(route, { items: [], total_hosts: 0, total_incidents: 0, has_more: false });
      return json(route, EMPTY_LIST);
    },
  });
  await page.goto('/scan-center');
  await page.getByRole('tab', { name: /Инциденты/ }).click();
  await expect(page.getByText('Инциденты не найдены')).toBeVisible({ timeout: 15000 });
});

test('section navigation is keyboard reachable', async ({ page }) => {
  await login(page);
  await stubScan(page);
  await page.goto('/scan-center');
  const hostsTab = page.getByRole('tab', { name: /Компьютеры/ });
  await hostsTab.focus();
  await page.keyboard.press('Enter');
  await expect(hostsTab).toHaveAttribute('aria-selected', 'true');
});

// --- Defect-evidence tests: expected-fail while the documented bugs exist ---

test('dashboard failure renders an error instead of healthy contour', async ({ page }, testInfo) => {
  test.fail(true, 'U2: dashboard error is masked as success "Контур работает" (ScanCenterHeader.jsx:22-31, ScanCenterPage.jsx:803-808)');
  await login(page);
  await stubScan(page, {
    'dashboard': (route) => route.fulfill({ status: 500, json: { detail: 'boom' } }),
  });
  await page.goto('/scan-center');
  // Buggy state documented: totals={} → success chip.
  await expect(page.getByText('Контур работает')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: testInfo.outputPath('u2-dashboard-error-healthy.png'), fullPage: true });
  // Desired behavior: some error indication.
  await expect(page.getByText(/не удалось|ошибка|недоступ/i)).toBeVisible({ timeout: 5000 });
});

test('inbox incident rows are keyboard-focusable elements', async ({ page }) => {
  test.fail(true, 'U1: inbox rows are Paper+onClick without role/tabIndex/onKeyDown (ScanCenterPage.jsx:1925-1973)');
  await login(page);
  await stubScan(page);
  await page.goto('/scan-center');
  await page.getByRole('tab', { name: /Инциденты/ }).click();
  const row = page.locator('.MuiPaper-root', { has: page.getByText('report.pdf') }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  // Desired: the row exposes an interactive role and is tabbable.
  await expect(row).toHaveAttribute('role', /option|button|row/, { timeout: 5000 });
});

test('bulk ack failure surfaces an error notification', async ({ page }, testInfo) => {
  test.fail(true, 'U3: bulk ack completes silently — no success/error notice (ScanCenterPage.jsx:1530-1550)');
  await login(page);
  await stubScan(page, {
    'incidents/bulk-ack': (route) => route.fulfill({ status: 500, json: { detail: 'boom' } }),
  });
  await page.goto('/scan-center');
  await page.getByRole('tab', { name: /Инциденты/ }).click();
  await expect(page.getByText('report.pdf').first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Просмотрено по фильтру/ }).click();
  await page.getByRole('button', { name: 'Отметить просмотренными' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: testInfo.outputPath('u3-bulk-ack-silent.png'), fullPage: true });
  // Desired: an Alert/notice about the failed bulk operation.
  await expect(page.getByRole('alert').filter({ hasText: /не удалось|ошибка/i })).toBeVisible({ timeout: 5000 });
});
