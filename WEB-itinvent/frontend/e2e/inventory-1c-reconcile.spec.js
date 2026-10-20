import { test, expect } from '@playwright/test';

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(
  process.env.E2E_LOCAL !== '1' || !USERNAME || !PASSWORD,
  'requires E2E_LOCAL=1 (seeded local stack)',
);

const PHILIPS_PART_NO = 'ЦБ-00195776';
const OWNER_NO = 42;

const listRow = (overrides = {}) => ({
  ID: 21,
  INV_NO: '100021',
  SERIAL_NO: 'PH-0001',
  PART_NO: PHILIPS_PART_NO,
  TYPE_NAME: 'Монитор',
  MODEL_NAME: 'Philips 243V',
  EMPL_NO: OWNER_NO,
  OWNER_DISPLAY_NAME: 'Иванов И.И.',
  STATUS_NAME: 'В работе',
  BRANCH_NAME: 'HQ',
  LOCATION_NAME: 'Office',
  ...overrides,
});

const summaryMatch = () => ({
  meta: { status: 'ok', as_of: new Date().toISOString() },
  items: [{
    owner_no: OWNER_NO,
    employee_name: 'Иванов И.И.',
    warehouse_ref: 'wh-1',
    warehouse_name: 'Иванов И.И.',
    status: 'match',
    part_status: { 'цб-00195776': 'match' },
    part_quantities: { 'цб-00195776': { hub_count: 2, qty_1c: 2 } },
    counts: {
      match: 1, diff: 0, only_hub: 0, only_1c: 0,
      no_part: 0, not_in_1c: 0, hub_items: 2,
    },
  }],
});

const json = (route, body) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function stubInventorySources(page, { balances, balancesMeta, employeeRequests = [] } = {}) {
  await page.route('**/api/v1/inventory/**', (route) => json(route, { items: {} }));
  await page.route('**/api/v1/warehouse-1c/**', (route) => (
    json(route, { status: 'ok', items: [], has_more: false })
  ));
  await page.route('**/api/v1/equipment/**', (route) => (
    json(route, { items: [], total: 0, pages: 0 })
  ));

  await page.route('**/api/v1/equipment/types*', (route) => (
    json(route, [{ type_name: 'Монитор' }])
  ));
  await page.route('**/api/v1/equipment/statuses*', (route) => (
    json(route, [{ status_name: 'В работе' }])
  ));
  await page.route('**/api/v1/equipment/branches-list*', (route) => (
    json(route, [{ branch_name: 'HQ' }])
  ));
  await page.route('**/api/v1/equipment/current-acts*', (route) => json(route, { items: [] }));

  await page.route('**/api/v1/equipment/all-grouped*', (route) => json(route, {
    grouped: {
      HQ: {
        Office: [
          listRow({ ID: 21, INV_NO: '100021', SERIAL_NO: 'PH-0001' }),
          listRow({ ID: 22, INV_NO: '100022', SERIAL_NO: 'PH-0002' }),
        ],
      },
    },
    total: 2,
    pages: 1,
    data_version: 1,
  }));

  await page.route('**/api/v1/equipment/employee/*/items*', (route) => {
    employeeRequests.push(route.request().url());
    return json(route, {
      equipment: [
        { ID: 21, INV_NO: '100021', MODEL_NAME: 'Philips 243V', PART_NO: PHILIPS_PART_NO, EMPL_NO: OWNER_NO },
        { ID: 22, INV_NO: '100022', MODEL_NAME: 'Philips 243V', PART_NO: PHILIPS_PART_NO, EMPL_NO: OWNER_NO },
      ],
    });
  });

  await page.route('**/api/v1/warehouse-1c/employee-compare-summary*', (route) => (
    json(route, summaryMatch())
  ));

  await page.route('**/api/v1/warehouse-1c/employee-warehouse*', (route) => {
    const wantsBalances = new URL(route.request().url()).searchParams.get('load_balances') === 'true';
    return json(route, {
      status: 'matched',
      warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
      candidates: [],
      balances: wantsBalances ? (balances ?? []) : [],
      ...(wantsBalances ? { balances_meta: balancesMeta } : {}),
    });
  });
}

async function expandInventoryRows(page) {
  await page.getByText('HQ', { exact: true }).click();
  await page.getByText('Office', { exact: true }).click();
  await expect(page.getByText('100021')).toBeVisible();
  await expect(page.getByText('100022')).toBeVisible();
}

test('employee dialog correction replaces the stale green list badge with 1С ≠', async ({ page }) => {
  const employeeRequests = [];
  await stubInventorySources(page, {
    employeeRequests,
    balances: [{
      nomenclature_ref: 'nom-1',
      nomenclature_code: PHILIPS_PART_NO,
      nomenclature_name: 'Монитор Philips 243V',
      qty_balance: 1,
    }],
    balancesMeta: { status: 'ok', as_of: new Date().toISOString() },
  });

  await login(page);
  await page.goto('/database');
  await expandInventoryRows(page);

  await expect(page.locator('[data-compare-status="match"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Иванов И.И.' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Оборудование сотрудника' });
  await expect(dialog).toBeVisible();

  await expect.poll(() => employeeRequests.length).toBeGreaterThanOrEqual(1);
  for (const url of employeeRequests) {
    expect(new URL(url).searchParams.get('all_databases')).not.toBe('true');
  }
  await expect(dialog.getByText('Оборудование Хаба: текущая база')).toBeVisible();

  await expect(dialog.locator('[data-compare-status="diff"]')).toHaveCount(3);

  await dialog.getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(dialog).toBeHidden();

  const badges = page.locator('[data-compare-status]');
  await expect(badges).toHaveCount(2);
  await expect(page.locator('[data-compare-status="diff"]')).toHaveCount(2);
  await expect(page.getByText('1С ≠')).toHaveCount(2);
  await expect(page.getByText('1С ✓')).toHaveCount(0);

  await page.locator('[data-compare-status="diff"]').first().hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Хаб: 2');
  await expect(tooltip).toContainText('1С: 1');

  await page.getByRole('button', { name: 'Иванов И.И.' }).first().click();
  const reopened = page.getByRole('dialog', { name: 'Оборудование сотрудника' });
  await expect(reopened.locator('[data-compare-status="diff"]')).toHaveCount(3);
  await reopened.getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(reopened).toBeHidden();
  await expect(page.locator('[data-compare-status="diff"]')).toHaveCount(2);
  await expect(page.getByText('1С ✓')).toHaveCount(0);
});

test('incomplete 1C balances metadata suppresses the badge instead of keeping stale green', async ({ page }) => {
  await stubInventorySources(page, {
    balances: [{
      nomenclature_ref: 'nom-1',
      nomenclature_code: PHILIPS_PART_NO,
      nomenclature_name: 'Монитор Philips 243V',
      qty_balance: 1,
    }],
    balancesMeta: { status: 'unknown' },
  });

  await login(page);
  await page.goto('/database');
  await expandInventoryRows(page);
  await expect(page.locator('[data-compare-status="match"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Иванов И.И.' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Оборудование сотрудника' });
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('[data-compare-status="match"]')).toHaveCount(0);
  await expect(dialog.locator('[data-compare-status="diff"]')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText('1С ✓')).toHaveCount(0);
  await expect(page.locator('[data-compare-status]')).toHaveCount(0);
});
