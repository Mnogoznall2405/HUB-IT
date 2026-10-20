import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import XLSX from 'xlsx-js-style';

test.skip(process.env.E2E_LOCAL !== '1', 'requires the isolated local stack');
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const equipment = Array.from({ length: 30 }, (_, index) => ({
  ID: index + 1, INV_NO: `INV-${String(index + 1).padStart(4, '0')}`, EMPL_NO: 42,
  MODEL_NAME: index === 0 ? 'Очень длинная модель рабочего оборудования с дополнительными характеристиками'.repeat(3) : `ThinkPad ${index + 1}`,
  TYPE_NAME: index % 2 ? 'Монитор' : 'Ноутбук', SERIAL_NO: `LONG-SERIAL-NUMBER-${index + 1}-WITHOUT-WRAPPING`,
  PART_NO: index === 29 ? '' : `CODE-${String(index + 1).padStart(4, '0')}`, current_act_available: false,
  OWNER_DISPLAY_NAME: 'Иванов И.И.', BRANCH_NAME: 'HQ', LOCATION_NAME: 'Office', STATUS_NAME: 'В работе',
}));
const balances = Array.from({ length: 32 }, (_, index) => ({
  nomenclature_ref: `nom-${index + 1}`, nomenclature_code: `CODE-${String(index + 1).padStart(4, '0')}`,
  nomenclature_name: index === 0 ? 'Ноутбук с длинным наименованием номенклатуры и техническими характеристиками'.repeat(4) : `Ноутбук ThinkPad ${index + 1}`,
  qty_balance: index === 1 ? 2 : 1,
}));

async function prepare(page, { hub = equipment, warehouse = balances, hubError = false, warehouseError = false, hubGate, warehouseGate } = {}) {
  await page.addInitScript(() => localStorage.setItem('hubit:desktop-handoff', 'never'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/v1/equipment/**', (route) => json(route, { items: [], total: 0, pages: 0 }));
  await page.route('**/api/v1/inventory/**', (route) => json(route, { items: {} }));
  await page.route('**/api/v1/warehouse-1c/**', (route) => json(route, { items: [], status: 'ok' }));
  await page.route('**/api/v1/equipment/all-grouped*', (route) => json(route, {
    grouped: { HQ: { Office: [equipment[0]] } }, total: 1, pages: 1, data_version: 1,
  }));
  await page.route('**/api/v1/equipment/employee/*/items*', async (route) => {
    await hubGate;
    return hubError ? json(route, { detail: 'unavailable' }, 503) : json(route, { equipment: hub });
  });
  await page.route('**/api/v1/warehouse-1c/employee-warehouse*', async (route) => {
    await warehouseGate;
    return warehouseError ? json(route, { detail: 'unavailable' }, 503) : json(route, {
      status: 'matched', warehouse: { ref: 'wh-layout', name: 'Иванов И.И.' },
      employment_status: 'active', employment_label: 'Сотрудник работает', balances: warehouse,
      balances_meta: { status: 'ok' },
    });
  });
  await page.route('**/api/v1/equipment/employee/*/history*', (route) => json(route, { history: [], total: 0 }));
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
  await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await expect(page.getByTestId('main-layout-content')).toBeVisible();
  await page.goto('/database');
  await page.getByText('HQ', { exact: true }).click();
  await page.getByText('Office', { exact: true }).click();
  await page.getByRole('button', { name: 'Иванов И.И.', exact: true }).first().click();
  return page.getByRole('dialog').filter({ has: page.getByText('Оборудование сотрудника', { exact: true }) });
}

test('shared filters, status counters, exports, clipboard, task and warehouse navigation', async ({ page, context }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const dialog = await prepare(page);
  await expect(dialog.getByText('Совпадает: 56', { exact: true })).toBeVisible();
  await dialog.getByLabel('Поиск', { exact: true }).fill('INV-0003');
  await expect(dialog.getByRole('table', { name: 'Оборудование Хаба' }).locator('tbody tr')).toHaveCount(1);
  await dialog.getByLabel('Поиск', { exact: true }).fill('');
  await dialog.getByLabel('Тип оборудования').click();
  await page.getByRole('option', { name: 'Монитор', exact: true }).click();
  await expect(dialog.getByRole('table', { name: 'Оборудование Хаба' }).locator('tbody tr')).toHaveCount(15);
  await dialog.getByLabel('Тип оборудования').click();
  await page.getByRole('option', { name: 'Все типы', exact: true }).click();
  await dialog.getByLabel('Статус сверки').click();
  await page.getByRole('option', { name: 'Кол-во ≠', exact: true }).click();
  await expect(dialog.locator('tr[data-compare-status="diff"]')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Кол-во ≠: 2', exact: true }).click();
  for (const [label, status, count] of [['Совпадает: 56', 'match', 56], ['Только в Хабе: 0', 'only_hub', 0], ['Только в 1С: 3', 'only_1c', 3]]) {
    const badge = dialog.getByRole('button', { name: label, exact: true });
    await badge.click();
    await expect(badge).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator(`tr[data-compare-status="${status}"]`)).toHaveCount(count);
    await badge.click();
  }
  await dialog.getByRole('button', { name: 'Без парт. №: 1', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'INV-0030', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Без парт. №: 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Без акта: 30', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Без акта: 30', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Без акта: 30', exact: true }).click();
  await dialog.getByRole('button', { name: 'По типам', exact: true }).click();
  await expect(dialog.getByText('Монитор · 15', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'По типам', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Выгрузить в Excel', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const workbook = XLSX.read(readFileSync(await download.path()), { type: 'buffer' });
  const text = workbook.SheetNames.map((name) => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n');
  expect(text).toContain('INV-0001');
  expect(text).toContain('CODE-0032');
  await dialog.getByRole('button', { name: 'Скопировать расхождения', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Скопировано', exact: true })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain('Иванов И.И.');
  expect(clipboard).toContain('INV-0002');
  const project = await page.request.post('/api/v1/hub/task-projects', { data: { name: `Layout QA ${Date.now()}`, code: `LAYOUT-${Date.now()}` } });
  expect(project.ok()).toBe(true);
  await dialog.getByRole('button', { name: 'Задача на инвентаризацию', exact: true }).click();
  const taskDialog = page.getByRole('dialog', { name: /^Задача на инвентаризацию/ });
  await expect(taskDialog.getByLabel('Название')).toHaveValue('Инвентаризация расхождений — Иванов И.И.');
  expect(await taskDialog.getByLabel('Описание').inputValue()).toContain('INV-0002');
  await taskDialog.getByRole('combobox', { name: 'Исполнитель' }).click();
  await page.getByRole('option').first().click();
  const created = page.waitForResponse((response) => response.url().endsWith('/hub/tasks') && response.request().method() === 'POST');
  await taskDialog.getByRole('button', { name: 'Создать задачу', exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  const id = payload.items?.[0]?.id || payload.task?.id || payload.id || payload.task_id;
  const stored = await page.request.get(`/api/v1/hub/tasks/${id}`);
  expect(stored.ok()).toBe(true);
  expect(JSON.stringify(await stored.json())).toContain('INV-0002');
  await expect(taskDialog.getByText('Задача создана. Список расхождений вложен в описание.')).toBeVisible();
  await taskDialog.getByRole('button', { name: 'Готово' }).click();
  await dialog.getByRole('tab', { name: 'Перемещения', exact: true }).click();
  await expect(dialog.getByLabel('Период с')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Остатки', exact: true }).click();
  await expect(dialog.getByRole('table', { name: 'Остатки 1С' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Открыть в Складе 1С', exact: true }).first().click();
  await page.waitForURL('**/warehouse-1c?**');
  expect(new URL(page.url()).searchParams.get('warehouseRef')).toBe('wh-layout');
});

for (const state of ['empty', 'hub-error', 'warehouse-error']) {
  test(`stable workspace in ${state} state`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const dialog = await prepare(page, { hub: state === 'empty' ? [] : equipment, warehouse: state === 'empty' ? [] : balances,
      hubError: state === 'hub-error', warehouseError: state === 'warehouse-error' });
    if (state === 'empty') {
      await expect(dialog.getByText('У сотрудника нет закреплённого оборудования в Хабе.')).toBeVisible();
      await expect(dialog.getByText('На складе нет позиций с ненулевым конечном остатком.')).toBeVisible();
    } else {
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Скопировать расхождения', exact: true })).toBeDisabled();
      await expect(dialog.getByText('Совпадает:', { exact: false })).toHaveCount(0);
    }
    await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true }).last()).toBeInViewport();
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  });
}

test('loading keeps panel geometry and incomplete comparisons disabled', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  let releaseHub;
  let releaseWarehouse;
  const hubGate = new Promise((resolve) => { releaseHub = resolve; });
  const warehouseGate = new Promise((resolve) => { releaseWarehouse = resolve; });
  const dialog = await prepare(page, { hubGate, warehouseGate });
  await expect(dialog.getByText('Загрузка оборудования из Хаба...')).toBeVisible();
  await expect(dialog.getByText('Поиск склада в 1С...')).toBeVisible();
  const before = await dialog.getByTestId('employee-warehouse-panel').boundingBox();
  releaseHub();
  await expect(dialog.getByRole('table', { name: 'Оборудование Хаба' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Скопировать расхождения', exact: true })).toBeDisabled();
  releaseWarehouse();
  await expect(dialog.getByRole('table', { name: 'Остатки 1С' })).toBeVisible();
  await expect(dialog.getByText('Совпадает: 56', { exact: true })).toBeVisible();
  const after = await dialog.getByTestId('employee-warehouse-panel').boundingBox();
  expect(after.height).toBeCloseTo(before.height, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test('mobile equipment panels, filters and footer stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const dialog = await prepare(page);
  await expect(dialog.getByRole('tab', { name: 'В Хабе', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Поиск', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Фильтры', exact: true }).click();
  await dialog.getByLabel('Поиск', { exact: true }).fill('nothing-matches');
  await expect(dialog.getByText('По фильтру в Хабе ничего не найдено.')).toBeVisible();
  await dialog.getByLabel('Поиск', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Фильтры', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Склад 1С', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Открыть в Складе 1С', exact: true }).first()).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true }).last()).toBeInViewport();
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: '../../output/employee-equipment-layout/after-mobile.png' });
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
  test(`comparison workspace at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const dialog = await prepare(page);
    await expect(dialog.getByRole('table')).toHaveCount(2);
    await expect(dialog.getByText('Совпадает: 56', { exact: true })).toBeVisible();
    const metrics = await dialog.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const tables = [...node.querySelectorAll('table')].map((table) => {
        const container = table.parentElement;
        const box = container.getBoundingClientRect();
        return { top: box.top, height: box.height, width: box.width, horizontalOverflow: container.scrollWidth - container.clientWidth,
          visibleRows: [...table.querySelectorAll('tbody tr')].filter((row) => row.getBoundingClientRect().bottom <= box.bottom).length };
      });
      return { width: rect.width, height: rect.height, tables, pageOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    const phase = process.env.LAYOUT_BASELINE === '1' ? 'before' : 'after';
    writeFileSync(`../../output/employee-equipment-layout/${phase}-${viewport.width}.json`, JSON.stringify(metrics, null, 2));
    await page.screenshot({ path: `../../output/employee-equipment-layout/${phase}-${viewport.width}.png` });
    if (phase === 'before') return;
    expect(Math.abs(metrics.tables[0].top - metrics.tables[1].top)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.tables[0].height - metrics.tables[1].height)).toBeLessThanOrEqual(1);
    expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
    for (const table of metrics.tables) {
      expect(table.horizontalOverflow).toBeLessThanOrEqual(1);
      expect(table.visibleRows).toBeGreaterThanOrEqual(viewport.width === 1920 ? 15 : 9);
    }
    const hubTable = dialog.getByRole('table', { name: 'Оборудование Хаба' });
    const warehouseTable = dialog.getByRole('table', { name: 'Остатки 1С' });
    const serial = hubTable.getByText(equipment[0].SERIAL_NO, { exact: true });
    await expect(serial).toHaveAttribute('title', equipment[0].SERIAL_NO);
    expect((await serial.boundingBox()).height).toBeLessThanOrEqual(17);
    for (const [table, value] of [[hubTable, equipment[0].MODEL_NAME], [warehouseTable, balances[0].nomenclature_name]]) {
      const text = table.getByText(value, { exact: true });
      await expect(text).toHaveAttribute('title', value);
      expect((await text.boundingBox()).height).toBeLessThanOrEqual(33);
    }
    const container = dialog.getByRole('table').first().locator('..');
    const headerTop = (await dialog.getByRole('columnheader', { name: 'Инв. №' }).boundingBox()).y;
    await container.evaluate((node) => { node.scrollTop = 250; });
    expect((await dialog.getByRole('columnheader', { name: 'Инв. №' }).boundingBox()).y).toBeCloseTo(headerTop, 0);
    const warehouseContainer = warehouseTable.locator('..');
    expect(await warehouseContainer.evaluate((node) => node.scrollTop)).toBe(0);
    const warehouseHeaderTop = (await warehouseTable.getByRole('columnheader', { name: 'Номенклатура' }).boundingBox()).y;
    await warehouseContainer.evaluate((node) => { node.scrollTop = 250; });
    expect((await warehouseTable.getByRole('columnheader', { name: 'Номенклатура' }).boundingBox()).y).toBeCloseTo(warehouseHeaderTop, 0);
    await expect(dialog.getByRole('button', { name: 'Выгрузить в Excel', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true }).last()).toBeInViewport();
    await page.setViewportSize({ width: 1000, height: 768 });
    await expect(dialog.getByRole('table')).toHaveCount(1);
    await dialog.getByRole('tab', { name: 'Склад 1С', exact: true }).click();
    await expect(dialog.getByRole('columnheader', { name: 'Номенклатура' })).toBeVisible();
    await page.setViewportSize(viewport);
    await expect(dialog.getByRole('table')).toHaveCount(2);
  });
}
