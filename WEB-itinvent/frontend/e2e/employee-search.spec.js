import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'requires the isolated local stack');

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const employee = (id, extra = {}) => ({ owner_no: id, name: `Иванов Сотрудник ${id}`, department: 'ИТ', equipment_count: 0, ...extra });
const searchResults = page => page.getByRole('region', { name: 'Результаты поиска сотрудников' });
const commonSearch = page => page.getByPlaceholder('Поиск по инв. №, парт. №, модели, сотруднику...');

async function prepare(page, handler, { limited = false } = {}) {
  const requests = { employee: [], warehouse: [], universal: [] };
  if (limited) {
    const limitUser = user => ({ ...user, role: 'operator', permissions: ['database.read'] });
    await page.route('**/api/v1/auth/login', async route => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, user: limitUser(body.user) } });
    });
    await page.route('**/api/v1/auth/me*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: limitUser(await response.json()) });
    });
  }
  await page.route('**/api/v1/equipment/**', route => json(route, { items: [], total: 0, pages: 0 }));
  await page.route('**/api/v1/inventory/**', route => json(route, { items: {} }));
  await page.route('**/api/v1/warehouse-1c/**', route => {
    requests.warehouse.push(route.request().url());
    return json(route, { status: 'not_found', items: [], candidates: [] });
  });
  await page.route('**/api/v1/equipment/all-grouped*', route => json(route, {
    grouped: { HQ: { Office: [{ ID: 999, INV_NO: 'UNRELATED', EMPL_NO: 999, OWNER_DISPLAY_NAME: 'Другой сотрудник',
      MODEL_NAME: 'Монитор', BRANCH_NAME: 'HQ', LOCATION_NAME: 'Office' }] } }, total: 1, pages: 1, data_version: 1,
  }));
  await page.route('**/api/v1/equipment/search/universal*', route => {
    requests.universal.push(route.request().url());
    return json(route, { equipment: [], total: 0, pages: 0 });
  });
  await page.route('**/api/v1/equipment/search/employee*', route => {
    requests.employee.push({ url: route.request().url(), database: route.request().headers()['x-database-id'] });
    return handler(route);
  });
  await page.route('**/api/v1/equipment/employee/*/items*', route => json(route, { equipment: [] }));
  await page.route('**/api/v1/equipment/employee/*/history*', route => json(route, {
    history: [{ hist_id: 1, item_id: 1, ch_date: '2026-01-02T10:00:00', direction: 'outgoing',
      inv_no: 'RETURNED-1', model_name: 'Возвращённый ноутбук', old_employee_no: 1, new_employee_no: 999 }], total: 1,
  }));
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
  await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'));
  await expect(page.getByTestId('main-layout-content')).toBeVisible();
  const mainMenu = page.getByRole('button', { name: 'Открыть главное меню', exact: true });
  if (await mainMenu.isVisible()) await mainMenu.click();
  await page.getByRole('button', { name: 'Инвентарь', exact: true }).click();
  await page.waitForURL('**/database');
  await expect(commonSearch(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сотрудники', exact: true })).toHaveCount(0);
  return requests;
}

test('finds an employee with zero equipment, opens returned history, and requires no 1C permission', async ({ page }) => {
  const requests = await prepare(page, route => json(route, { employees: [employee(1)], total: 1 }), { limited: true });
  await commonSearch(page).fill('Иванов');
  const results = searchResults(page);
  await expect(results.getByText('ИТ · Техника: 0')).toBeVisible();
  await results.getByRole('button', { name: /Иванов Сотрудник 1/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Оборудование сотрудника' });
  await expect(dialog.getByText('У сотрудника нет закреплённого оборудования в Хабе.')).toBeVisible();
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  await expect(dialog.getByText('Возвращённый ноутбук')).toBeVisible();
  await expect(dialog.getByText('Уход', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).first().click();
  await expect(results.getByText('Показано 1 из 1')).toBeVisible();
  expect(requests.employee).toHaveLength(1);
  expect(requests.employee[0].database).toBeTruthy();
  expect(requests.warehouse).toHaveLength(0);
  expect(requests.universal.length).toBeGreaterThan(0);
});

test('paginates employees including namesakes and opens the selected identity', async ({ page }) => {
  const requests = await prepare(page, route => {
    const params = new URL(route.request().url()).searchParams;
    const rows = params.get('page') === '2' ? [employee(51)] : Array.from({ length: 50 }, (_, index) => employee(index + 1));
    rows[0] = employee(params.get('page') === '2' ? 51 : 1, { name: 'Иванов Иван', department: params.get('page') === '2' ? 'АСУ' : 'ИТ' });
    return json(route, { employees: rows, total: 51 });
  });
  await commonSearch(page).fill('Иванов');
  await expect(searchResults(page).getByText('Показано 50 из 51')).toBeVisible();
  await searchResults(page).getByRole('button', { name: 'Показать ещё сотрудников' }).click();
  await expect(searchResults(page).getByText('Показано 51 из 51')).toBeVisible();
  const selected = searchResults(page).getByRole('button', { name: /Иванов Иван АСУ/ });
  await selected.focus();
  const request = page.waitForRequest('**/api/v1/equipment/employee/51/items*');
  await selected.press('Enter');
  await request;
  await expect(page.getByRole('dialog', { name: 'Оборудование сотрудника' })).toBeVisible();
  expect(requests.employee.map(entry => new URL(entry.url).searchParams.get('page'))).toEqual(['1', '2']);
});

test('keeps failed search distinct from empty results and retries; clear resets the results', async ({ page }) => {
  let calls = 0;
  await prepare(page, route => ++calls === 1 ? json(route, { detail: 'Справочник временно недоступен' }, 503) : json(route, { employees: [], total: 0 }), { limited: true });
  const input = commonSearch(page);
  await input.fill('Несуществующий');
  await input.press('Enter');
  await expect(searchResults(page).getByText('Справочник временно недоступен')).toBeVisible();
  await expect(searchResults(page).getByText('Сотрудники не найдены в текущей базе ITinvent.')).toHaveCount(0);
  await searchResults(page).getByRole('button', { name: 'Повторить' }).click();
  await expect(searchResults(page).getByText('Сотрудники не найдены в текущей базе ITinvent.')).toBeVisible();
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(searchResults(page)).toHaveCount(0);
  expect(calls).toBe(2);
});

test('database switch cancels old search, resets scope and pins new requests', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const requests = await prepare(page, async route => {
    if (route.request().headers()['x-database-id'] === 'MSK-ITINVENT') return json(route, { employees: [employee(2, { name: 'Иванов из новой базы' })], total: 1 });
    await pending;
    await json(route, { employees: [employee(1, { name: 'Устаревший сотрудник' })], total: 1 }).catch(() => {});
  });
  await commonSearch(page).fill('Иванов');
  await expect.poll(() => requests.employee.length).toBe(1);
  await page.route('**/api/v1/database/current*', route => json(route, { id: 'MSK-ITINVENT', name: 'Other database' }));
  await page.evaluate(() => {
    localStorage.setItem('selected_database', 'MSK-ITINVENT');
    window.dispatchEvent(new CustomEvent('database-changed'));
  });
  await expect(searchResults(page)).toBeHidden();
  release();
  await commonSearch(page).fill('Иванов');
  await expect(searchResults(page).getByText('Иванов из новой базы')).toBeVisible();
  await expect(page.getByText('Устаревший сотрудник')).toHaveCount(0);
  expect(requests.employee.at(-1).database).toBe('MSK-ITINVENT');
});

test('employee search fits a narrow viewport and preserves the equipment search mode', async ({ page }) => {
  await prepare(page, route => json(route, { employees: [employee(1, { name: 'ОченьДлинноеФИО'.repeat(12) })], total: 1 }));
  await page.setViewportSize({ width: 360, height: 780 });
  await commonSearch(page).fill('Очень');
  await expect(searchResults(page).getByText('Показано 1 из 1')).toBeVisible();
  expect(await searchResults(page).evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '../../output/playwright/employee-search-mobile.png' });
  await page.getByRole('button', { name: 'Акты', exact: true }).click();
  await expect(searchResults(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Карточки', exact: true }).click();
  await expect(commonSearch(page)).toBeVisible();
});

test('the same query shows matching equipment and employees even when equipment was found', async ({ page }) => {
  const requests = await prepare(page, route => json(route, { employees: [employee(1)], total: 1 }), { limited: true });
  await page.route('**/api/v1/equipment/search/universal*', route => {
    requests.universal.push(route.request().url());
    return json(route, { found: true, equipment: [{ id: 999, inv_no: 'MATCHED-999', model_name: 'Совпавшая техника',
      employee_name: 'Иванов Другой', empl_no: 999, branch_name: 'HQ', location_name: 'Office', type_name: 'Монитор' }], total: 1, pages: 1 });
  });
  await commonSearch(page).fill('Иванов');
  await expect(searchResults(page).getByRole('button', { name: /Иванов Сотрудник 1/ })).toBeVisible();
  await expect(page.getByText('Совпавшая техника', { exact: true }).first()).toBeVisible();
  expect(requests.employee).toHaveLength(1);
  expect(requests.warehouse).toHaveLength(0);
});
