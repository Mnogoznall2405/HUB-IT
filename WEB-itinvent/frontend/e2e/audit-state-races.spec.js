import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'Requires the isolated SQLite local stack');
test.use({ serviceWorkers: 'block' });
const json = (route, body) => route.fulfill({ json: body });

async function prepare(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hubit:desktop-handoff', 'never');
    localStorage.setItem('selected_database', 'OLD');
  });
  await page.route('**/api/v1/database/list*', (route) => json(route, [
    { id: 'OLD', name: 'Старая БД' }, { id: 'NEW', name: 'Новая БД' },
  ]));
  await page.route('**/api/v1/database/current*', (route) => json(route, { id: 'OLD', name: 'Старая БД' }));
  await page.route('**/api/v1/database/switch', (route) => json(route, { success: true }));
  const response = await page.request.post('/api/v1/auth/login', { data: {
    username: process.env.E2E_USERNAME, password: process.env.E2E_PASSWORD,
  } });
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe('authenticated');
}

test('MFU database switch starts a fresh request and rejects a late response from the previous database', async ({ page }) => {
  await prepare(page);
  const oldRoutes = [];
  let switched = false;
  await page.route('**/api/v1/database/switch', (route) => {
    switched = true;
    return json(route, { success: true });
  });
  await page.route('**/api/v1/mfu/devices*', (route) => {
    if (!switched) { oldRoutes.push(route); return; }
    return json(route, { grouped: {}, totals: { devices: 42 }, db_id: 'NEW' });
  });
  await page.goto('/mfu');
  await expect.poll(() => oldRoutes.length).toBeGreaterThan(0);
  await page.getByRole('combobox', { name: 'База данных', exact: true }).click();
  await page.getByRole('option', { name: 'Новая БД', exact: true }).click();
  await expect(page.getByRole('heading', { name: '42', exact: true })).toBeVisible();
  await Promise.all(oldRoutes.map((route) => json(route, { grouped: {}, totals: { devices: 99 }, db_id: 'OLD' })));
  await expect(page.getByRole('heading', { name: '42', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '99', exact: true })).toHaveCount(0);
});

test('Computers continues loading pages after refresh interrupts an append', async ({ page }) => {
  await prepare(page);
  const computer = { hostname: 'AUDIT-PC-01', mac_address: '00-00-00-00-00-01', status: 'online', branch_name: 'Audit', location_name: 'Office' };
  let pendingAppend;
  let appendCalls = 0;
  await page.route('**/api/v1/inventory/**', (route) => json(route, { items: {} }));
  await page.route('**/api/v1/inventory/computers/search*', (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    if (offset > 0) {
      appendCalls += 1;
      if (appendCalls === 1) { pendingAppend = route; return; }
      return json(route, { items: [{ ...computer, hostname: 'AUDIT-PC-02', mac_address: '00-00-00-00-00-02' }], total: 2, offset, has_more: false });
    }
    return json(route, { items: [computer], total: 2, offset: 0, has_more: true, next_offset: 1 });
  });
  await page.goto('/computers');
  await page.getByTestId('computers-load-more-sentinel').scrollIntoViewIfNeeded();
  await expect.poll(() => appendCalls).toBe(1);
  await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await json(pendingAppend, { items: [], total: 2, has_more: false });
  await expect.poll(() => appendCalls).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('Подгружаем компьютеры в фоне…', { exact: true })).toHaveCount(0);
});

test('MyFiles enumerates a dropped file once across React and window handlers', async ({ page }) => {
  await prepare(page);
  await page.goto('/my-files');
  const zone = page.getByTestId('my-files-drop-zone');
  await expect(zone).toBeVisible();
  // Playwright cannot drag a file from the OS desktop. Inject only that drop
  // event and check propagation through the real React and window listeners.
  const dataTransfer = await page.evaluateHandle(() => {
    window.auditFileReads = 0;
    const getAsFile = DataTransferItem.prototype.getAsFile;
    DataTransferItem.prototype.webkitGetAsEntry = () => null;
    DataTransferItem.prototype.getAsFile = function () {
      const file = getAsFile.call(this);
      if (file?.name === 'audit-drop.txt') window.auditFileReads += 1;
      return file;
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File(['audit'], 'audit-drop.txt', { type: 'text/plain' }));
    return transfer;
  });
  await zone.dispatchEvent('drop', { dataTransfer });
  const dialog = page.getByRole('dialog', { name: 'Загрузка файлов', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('audit-drop.txt', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.auditFileReads)).toBe(1);
  await dataTransfer.dispose();
});

test('MyFiles special views ignore a window-level file drop', async ({ page }) => {
  await prepare(page);
  await page.goto('/my-files');
  const sections = page.getByRole('navigation', { name: 'Разделы файлов', exact: true });
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['audit'], 'special-view.txt', { type: 'text/plain' }));
    return transfer;
  });
  for (const name of ['Корзина', 'Недавние', 'Избранное']) {
    await sections.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.locator('body').dispatchEvent('drop', { dataTransfer });
    await expect(page.getByRole('dialog', { name: 'Загрузка файлов', exact: true })).toHaveCount(0);
  }
  await dataTransfer.dispose();
});
