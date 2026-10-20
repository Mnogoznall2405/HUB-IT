import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// All API calls, WebSockets and print transports are intercepted. These checks
// can also verify a published build without changing production data or printing.

const equipment = Array.from({ length: 16 }, (_, index) => ({
  ID: index + 1, INV_NO: `QR-${String(index + 1).padStart(3, '0')}`,
  SERIAL_NO: `SN-${index + 1}`, MODEL_NAME: index ? `Monitor ${index + 1}` : 'Dell Latitude 7440',
  TYPE_NAME: 'Ноутбук', OWNER_DISPLAY_NAME: 'Тестовый сотрудник',
  BRANCH_NAME: 'QR Branch', LOCATION_NAME: 'QR Office',
}));
const user = {
  id: 999, username: 'qr_local_fixture', full_name: 'QR Local Fixture', role: 'admin',
  permissions: ['database.read'], about_onboarding_completed_at: '2026-01-01T00:00:00',
  pinned_database: 'ITINVENT', assigned_database: 'ITINVENT', is_active: true,
};
const root = '#equipment-qr-print-root';
test.use({ serviceWorkers: 'block' });

async function prepare(page, desktop = false) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.routeWebSocket('**/*', socket => socket.onMessage(() => {}));
  await page.addInitScript(({ user, desktop }) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('selected_database', 'ITINVENT');
    localStorage.setItem('hubit:desktop-handoff', 'never');
    window.__qrPrints = [];
    const capture = mode => {
      const root = document.getElementById('equipment-qr-print-root');
      window.__qrPrints.push({
        mode, widthMm: Number(root.dataset.pageWidthMm), heightMm: Number(root.dataset.pageHeightMm),
        order: Array.from(root.querySelectorAll('.equipment-qr-print-label'), node => node.dataset.invNo),
        sheets: Array.from(root.querySelectorAll('.equipment-qr-print-sheet'), node => node.children.length),
        imagesReady: Array.from(root.querySelectorAll('img')).every(image => image.complete && image.naturalWidth > 0),
      });
    };
    window.print = () => capture('browser');
    if (desktop) {
      const listeners = new Set();
      const receive = data => listeners.forEach(listener => listener({ data }));
      window.chrome ||= {};
      window.chrome.webview = {
        addEventListener: (name, listener) => { if (name === 'message') listeners.add(listener); },
        removeEventListener: (name, listener) => listeners.delete(listener),
        postMessage: message => {
          if (message.type === 'desktop.ready') {
            setTimeout(() => {
              receive({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: false } });
              receive({ type: 'desktop.capabilities', version: 1, capabilities: ['equipment-qr-print'] });
            });
          } else if (message.type === 'equipmentQr.print') {
            capture(message.mode);
            setTimeout(() => receive({ type: 'equipmentQr.printResult', version: 1,
              requestId: message.requestId, status: 'dialog-opened' }));
          }
        },
      };
    }
  }, { user, desktop });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    let body = { items: [], total: 0, pages: 0 };
    if (path.endsWith('/auth/me')) body = user;
    else if (path.includes('/database/current')) body = { id: 'ITINVENT', name: 'Local QR fixture' };
    else if (path.includes('/database/')) body = { databases: [{ id: 'ITINVENT', name: 'Local QR fixture' }] };
    else if (path.endsWith('/equipment/all-grouped')) body = { grouped: { 'QR Branch': { 'QR Office': equipment } }, total: equipment.length, pages: 1, data_version: 1 };
    else if (path.endsWith('/equipment/by-inv-nos')) body = { equipment };
    else if (path.endsWith('/equipment/branches')) body = { branches: ['QR Branch'] };
    else if (path.endsWith('/equipment/types')) body = { types: [] };
    else if (path.endsWith('/equipment/statuses')) body = { statuses: [] };
    else if (path.includes('/inventory/')) body = { items: {} };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/database');
  if (desktop) await page.getByRole('button', { name: 'Не включать', exact: true }).click();
  const branch = page.getByRole('button', { name: /QR Branch/ });
  await expect(branch).toBeVisible();
  if (await branch.getAttribute('aria-expanded') !== 'true') await branch.click();
  const location = page.getByRole('button', { name: /QR Office/ });
  await expect(location).toBeVisible();
  if (await location.getAttribute('aria-expanded') !== 'true') await location.click();
  await expect(page.getByRole('table')).toBeVisible();
  return errors;
}

async function openOptions(page, desktop) {
  if (desktop) {
    await page.getByRole('button', { name: 'Открыть способы печати QR', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Печать QR…/ }).click();
  } else {
    await page.getByRole('button', { name: 'Печать QR…', exact: true }).click();
  }
}

async function chooseA4(page, testInfo) {
  const dialog = page.getByRole('dialog', { name: 'Печать QR-кодов', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Лист A4', exact: true }).check();
  await page.screenshot({ path: testInfo.outputPath('format-dialog.png') });
  await dialog.getByRole('button', { name: 'Печать', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__qrPrints.length)).toBe(1);
  await expect(page.getByText(/Открыто окно печати:/)).toBeVisible();
}

async function verifyA4(page, testInfo, counts) {
  await expect(page.locator(root)).toHaveAttribute('data-page-width-mm', '210');
  await expect(page.locator(root)).toHaveAttribute('data-page-height-mm', '297');
  await page.emulateMedia({ media: 'print' });
  const geometry = await page.locator(`${root} img`).first().evaluate(image => {
    const sheet = image.closest('.equipment-qr-print-sheet');
    const box = node => ({ width: node.getBoundingClientRect().width * 25.4 / 96,
      height: node.getBoundingClientRect().height * 25.4 / 96 });
    return { label: box(image), sheet: box(sheet), columns: getComputedStyle(sheet).gridTemplateColumns.split(' ').length };
  });
  expect(geometry.label.width).toBeCloseTo(56, 1);
  expect(geometry.label.height).toBeCloseTo(50, 1);
  expect(geometry.sheet.width).toBeLessThanOrEqual(190);
  expect(geometry.sheet.height).toBeLessThanOrEqual(277);
  expect(geometry.columns).toBe(3);
  expect(await page.locator('.equipment-qr-print-sheet').evaluateAll(nodes => nodes.map(node => node.children.length))).toEqual(counts);
  const images = await page.locator(`${root} img`).evaluateAll(nodes => nodes.map(node => node.src));
  writeFileSync(testInfo.outputPath('label-images.json'), JSON.stringify(images));
  await page.screenshot({ path: testInfo.outputPath('qr-a4.png'), fullPage: true });
  const pdf = await page.pdf({ path: testInfo.outputPath('qr-a4.pdf'), preferCSSPageSize: true, printBackground: true });
  const pdfText = pdf.toString('latin1');
  expect(pdfText.match(/\/Type\s*\/Page\b/g)).toHaveLength(counts.length);
  const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdfText);
  expect(mediaBox).not.toBeNull();
  expect(Number(mediaBox[1]) * 25.4 / 72).toBeCloseTo(210, 0);
  expect(Number(mediaBox[2]) * 25.4 / 72).toBeCloseTo(297, 0);
  await page.emulateMedia({ media: 'screen' });
}

for (const desktop of [false, true]) {
  test(`${desktop ? 'Desktop' : 'browser'}: A4 batch, cancel, pagination and repeat retain format`, async ({ page }, testInfo) => {
    const errors = await prepare(page, desktop);
    await page.getByRole('table').getByRole('checkbox').first().check();
    await openOptions(page, desktop);
    const options = page.getByRole('dialog', { name: 'Печать QR-кодов', exact: true });
    await options.getByRole('button', { name: 'Отмена' }).click();
    expect(await page.evaluate(() => window.__qrPrints)).toHaveLength(0);
    await expect(page.getByRole('table').getByRole('checkbox').first()).toBeChecked();
    await openOptions(page, desktop);
    await chooseA4(page, testInfo);
    const [captured] = await page.evaluate(() => window.__qrPrints);
    expect(captured).toMatchObject({ mode: desktop ? 'dialog' : 'browser', widthMm: 210, heightMm: 297,
      imagesReady: true, sheets: [15, 1] });
    expect(captured.order).toEqual(equipment.map(item => item.INV_NO));
    await verifyA4(page, testInfo, [15, 1]);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator(root)).toHaveCount(0);
    await page.getByRole('button', { name: 'Повторить печать', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__qrPrints.length)).toBe(2);
    const repeated = await page.evaluate(() => window.__qrPrints[1]);
    expect(repeated).toEqual(captured);
    expect(errors).toEqual([]);
  });
}

test('equipment card prints one A4 label without clearing an unrelated selection', async ({ page }, testInfo) => {
  const errors = await prepare(page);
  await page.getByRole('table').getByRole('checkbox').nth(2).check();
  await page.getByRole('button', { name: 'Actions for QR-001', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Просмотр', exact: true }).click();
  await page.getByRole('button', { name: 'Создать QR-code', exact: true }).click();
  const qrDialog = page.getByRole('dialog').filter({ hasText: 'QR-код оборудования' });
  await qrDialog.getByRole('button', { name: 'Печать', exact: true }).click();
  await chooseA4(page, testInfo);
  expect((await page.evaluate(() => window.__qrPrints[0])).order).toEqual(['QR-001']);
  await verifyA4(page, testInfo, [1]);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator(root)).toHaveCount(0);
  await qrDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть карточку оборудования', exact: true }).click();
  await expect(page.getByRole('table').getByRole('checkbox').nth(2)).toBeChecked();
  expect(errors).toEqual([]);
});

test('Desktop quick label printing keeps 56x50 pages after adding A4', async ({ page }, testInfo) => {
  const errors = await prepare(page, true);
  await page.getByRole('table').getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Быстрая печать QR', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__qrPrints.length)).toBe(1);
  expect(await page.evaluate(() => window.__qrPrints[0])).toMatchObject({
    mode: 'quick', widthMm: 56, heightMm: 50, sheets: Array(16).fill(1), imagesReady: true,
  });
  await page.emulateMedia({ media: 'print' });
  const images = await page.locator(`${root} img`).evaluateAll(nodes => nodes.map(node => node.src));
  writeFileSync(testInfo.outputPath('label-images.json'), JSON.stringify(images));
  const pdf = await page.pdf({ path: testInfo.outputPath('qr-labels.pdf'), preferCSSPageSize: true, printBackground: true });
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(16);
  expect(errors).toEqual([]);
});
