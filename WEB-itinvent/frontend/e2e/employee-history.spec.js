import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'requires the isolated local stack');

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const item = (ownerNo = 42) => ({
  ID: ownerNo, INV_NO: `LIST-${ownerNo}`, MODEL_NAME: 'Монитор', SERIAL_NO: 'SERIAL',
  TYPE_NAME: 'Монитор', EMPL_NO: ownerNo, OWNER_DISPLAY_NAME: ownerNo === 42 ? 'Иванов И.И.' : 'Петров П.П.',
  BRANCH_NAME: 'HQ', LOCATION_NAME: 'Office', STATUS_NAME: 'В работе',
});
const event = (id, extra = {}) => ({
  hist_id: id, item_id: 10, ch_date: '2026-01-02T10:00:00', direction: 'incoming',
  inv_no: `HIST-${id}`, current_inv_no: 'LIVE-10', serial_no: `SER-${id}`,
  type_name: 'Ноутбук', model_name: 'ThinkPad', old_employee_name: 'Сидоров С.С.',
  new_employee_name: 'Иванов И.И.', old_employee_no: 7, new_employee_no: 42,
  branch_name: 'HQ', location_name: 'Office', ch_user: 'operator', ch_comment: 'Передача', ...extra,
});

async function prepare(page, history) {
  await page.addInitScript(() => localStorage.setItem('hubit:desktop-handoff', 'never'));
  await page.route('**/api/v1/equipment/**', (route) => json(route, { items: [], total: 0, pages: 0 }));
  await page.route('**/api/v1/inventory/**', (route) => json(route, { items: {} }));
  await page.route('**/api/v1/warehouse-1c/**', (route) => json(route, { status: 'not_found', items: [], candidates: [] }));
  await page.route('**/api/v1/equipment/all-grouped*', (route) => json(route, {
    grouped: { HQ: { Office: [item(), item(84)] } }, total: 2, pages: 1, data_version: 1,
  }));
  await page.route('**/api/v1/equipment/employee/*/items*', (route) => json(route, { equipment: [] }));
  await page.route('**/api/v1/equipment/employee/*/history*', history);
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
  await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await expect(page.getByTestId('main-layout-content')).toBeVisible();
  const mainMenu = page.getByRole('button', { name: 'Открыть главное меню', exact: true });
  if (await mainMenu.isVisible()) await mainMenu.click();
  await page.getByRole('button', { name: 'Инвентарь', exact: true }).click();
  await page.waitForURL('**/database');
  await page.getByText('HQ', { exact: true }).click();
  await page.getByText('Office', { exact: true }).click();
  await page.getByRole('button', { name: 'Иванов И.И.', exact: true }).first().click();
  return page.getByRole('dialog', { name: 'Оборудование сотрудника' });
}

test('lazy history for an employee with no current equipment, filters, pagination and opening the live card', async ({ page }) => {
  const requests = [];
  const dialog = await prepare(page, (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(Object.fromEntries(params));
    if (params.get('direction') === 'outgoing') {
      return json(route, { history: [event(51, { direction: 'outgoing', current_inv_no: null })], total: 1 });
    }
    const rows = params.get('page') === '2'
      ? [event(51, { direction: 'outgoing', current_inv_no: null })]
      : Array.from({ length: 50 }, (_, index) => event(index + 1));
    return json(route, { history: rows, total: 51 });
  });
  expect(requests).toHaveLength(0);
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  await expect(dialog.getByText('Показано 50 из 51')).toBeVisible();
  await dialog.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(dialog.getByText('Показано 51 из 51')).toBeVisible();
  await expect(dialog.getByText('Карточка техники недоступна')).toBeVisible();
  await dialog.getByLabel('Направление').click();
  await page.getByRole('option', { name: 'Уход', exact: true }).click();
  await dialog.getByLabel('Дата с', { exact: true }).fill('2026-01-01');
  await dialog.getByLabel('Дата по', { exact: true }).fill('2026-01-31');
  await dialog.getByLabel('Модель или номер техники').fill('ThinkPad');
  await dialog.getByRole('button', { name: 'Применить' }).click();
  await expect(dialog.getByText('Показано 1 из 1')).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ page: '1', direction: 'outgoing', date_from: '2026-01-01', date_to: '2026-01-31', q: 'ThinkPad' });
  await dialog.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect(dialog.getByText('Показано 50 из 51')).toBeVisible();
  const requestCount = requests.length;
  await dialog.getByRole('tab', { name: 'Оборудование', exact: true }).click();
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  expect(requests).toHaveLength(requestCount);
  await page.route('**/api/v1/equipment/by-inv-nos', (route) => json(route, { equipment: [{
    ...item(), INV_NO: 'LIVE-10', MODEL_NAME: 'Current card', PART_NO: '', OWNER_DEPT: '',
  }] }));
  const liveRequest = page.waitForRequest('**/api/v1/equipment/by-inv-nos');
  await dialog.getByRole('button', { name: 'Открыть технику HIST-1', exact: true }).click();
  expect((await liveRequest).postDataJSON().inv_nos).toEqual(['LIVE-10']);
  await expect(page.getByText('Current card', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(dialog.getByText('Показано 50 из 51')).toBeVisible();
});

test('retry, empty result, date validation and switching employees reset history', async ({ page }) => {
  let calls = 0;
  const dialog = await prepare(page, (route) => {
    calls += 1;
    if (calls === 1) return json(route, { detail: 'unavailable' }, 503);
    const url = new URL(route.request().url());
    if (url.pathname.includes('/84/')) return json(route, { history: [event(84, { model_name: 'Petrov equipment' })], total: 1 });
    return json(route, { history: [], total: 0 });
  });
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  await expect(dialog.getByText('Не удалось загрузить историю перемещений.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Повторить' }).click();
  await expect(dialog.getByText('История перемещений сотрудника пока пустая.')).toBeVisible();
  await dialog.getByLabel('Дата с', { exact: true }).fill('2026-02-01');
  await dialog.getByLabel('Дата по', { exact: true }).fill('2026-01-01');
  await expect(dialog.getByRole('button', { name: 'Применить' })).toBeDisabled();
  await dialog.getByLabel('Дата по', { exact: true }).fill('2026-02-28');
  await dialog.getByRole('button', { name: 'Применить' }).click();
  await expect(dialog.getByText('По выбранным фильтрам перемещений не найдено.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).first().click();
  await page.getByRole('button', { name: 'Петров П.П.', exact: true }).first().click();
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  await expect(dialog.getByText('Petrov equipment')).toBeVisible();
  await expect(dialog.getByLabel('Дата с', { exact: true })).toHaveValue('');
});

test('database change discards a delayed previous response and uses the selected database header', async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const dialog = await prepare(page, async (route) => {
    if (route.request().headers()['x-database-id'] === 'MSK-ITINVENT') {
      return json(route, { history: [event(2, { model_name: 'Other database' })], total: 1 });
    }
    await pending;
    await json(route, { history: [event(1, { model_name: 'Stale database' })], total: 1 }).catch(() => {});
  });
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  await expect(dialog.getByText('Загрузка истории...')).toBeVisible();
  await page.route('**/api/v1/database/current*', (route) => json(route, { id: 'MSK-ITINVENT', name: 'Test other database' }));
  await page.evaluate(() => {
    localStorage.setItem('selected_database', 'MSK-ITINVENT');
    window.dispatchEvent(new CustomEvent('database-changed'));
  });
  await expect(dialog).toBeHidden();
  release();
  await page.getByText('HQ', { exact: true }).click();
  await page.getByText('Office', { exact: true }).click();
  await page.getByRole('button', { name: 'Иванов И.И.', exact: true }).first().click();
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  await expect(dialog.getByText('Other database')).toBeVisible();
  await expect(dialog.getByText('Stale database')).toHaveCount(0);
});

test('mobile history cards remain inside a narrow viewport', async ({ page }) => {
  const dialog = await prepare(page, (route) => json(route, {
    history: [event(1, { model_name: 'LongModel'.repeat(15), current_inv_no: null })], total: 1,
  }));
  await page.setViewportSize({ width: 360, height: 780 });
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  await expect(dialog.getByText('Приход', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Карточка техники недоступна')).toBeVisible();
  await expect(dialog.getByRole('table')).toHaveCount(0);
  const panel = dialog.getByRole('tabpanel');
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: '../../output/playwright/employee-history-mobile.png' });
});

test('a warehouse-only employee has no invented ITinvent history', async ({ page }) => {
  const historyRequests = [];
  const dialog = await prepare(page, (route) => {
    historyRequests.push(route.request().url());
    return json(route, { history: [], total: 0 });
  });
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).first().click();
  await page.route('**/api/v1/equipment/search/universal*', (route) => json(route, { found: false, equipment: [], total: 0, pages: 0 }));
  await page.route('**/api/v1/equipment/search/employee*', (route) => json(route, { employees: [], total: 0, pages: 0 }));
  await page.route('**/api/v1/warehouse-1c/employee-warehouse*', (route) => json(route, {
    status: 'matched', warehouse: { ref: 'warehouse-only', name: 'Без карточки ITinvent' }, balances: [], balances_meta: { status: 'ok' },
  }));
  await page.getByPlaceholder('Поиск по инв. №, парт. №, модели, сотруднику...').fill('Без карточки ITinvent');
  await page.getByRole('button', { name: 'Открыть склад и остатки', exact: true }).click();
  await dialog.getByRole('tab', { name: 'История перемещений', exact: true }).click();
  await expect(dialog.getByText('Сотрудник не найден в справочнике ITinvent. История недоступна.')).toBeVisible();
  expect(historyRequests).toHaveLength(0);
});
