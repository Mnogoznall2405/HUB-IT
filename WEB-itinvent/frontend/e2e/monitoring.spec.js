import { test, expect } from '@playwright/test';

// Real local API + isolated SQLite seed, never a deployed host or live device.
// Native pointer and keyboard actions, no synthetic DOM events.
test.skip(process.env.E2E_LOCAL !== '1' || process.env.E2E_MONITORING_SEED !== '1', 'Requires isolated monitoring fixtures');
test.use({ serviceWorkers: 'block', actionTimeout: 20000 });

async function login(page, reader = false, openDevice = true) {
  // Monitoring scenarios authenticate through the real HTTP boundary;
  // the separate auth suite owns login-page redirects and prompts.
  const response = await page.request.post('/api/v1/auth/login', { data: {
    username: reader ? process.env.E2E_USERNAME2 : process.env.E2E_USERNAME,
    password: reader ? process.env.E2E_PASSWORD2 : process.env.E2E_PASSWORD,
  } });
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe('authenticated');
  // Synthetic history is static and collection is disabled. Freeze Date at its
  // observation time so Windows startup time cannot age the fixture into stale data.
  const overview = await (await page.request.get('/api/v1/monitoring/overview')).json();
  const observedAt = Math.max(...overview.targets.map(row => new Date(row.current?.checked_at).getTime()).filter(Number.isFinite));
  await page.clock.setFixedTime(new Date(observedAt));
  await page.goto('/monitoring');
  await expect(page.getByRole('heading', { name: 'Мониторинг', exact: true, level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  if (openDevice) await page.getByRole('button', { name: 'Открыть Можайск', exact: true }).click();
}

test('initial equipment cards, search, real sparklines and back navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1556, height: 1000 });
  await login(page, false, false);
  const grid = page.getByRole('region', { name: 'Оборудование сети', exact: true });
  await expect(grid.getByRole('button', { name: /^Открыть / })).toHaveCount(20);
  await expect(grid.getByRole('button', { name: 'Открыть Можайск' }).locator('svg path').last()).toHaveAttribute('d', /M/);
  await expect(page.getByRole('tab', { name: 'Интерфейсы', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('monitoring-cards.png') });
  await page.getByLabel('Найти оборудование', { exact: true }).fill('192.0.2.11');
  await expect(grid.getByRole('button', { name: /^Открыть / })).toHaveCount(1);
  await expect(grid.getByRole('button')).toContainText('Склад');
  await page.getByLabel('Найти оборудование', { exact: true }).clear();
  await grid.getByRole('button', { name: 'Открыть Можайск' }).click();
  await expect(page.getByTestId('monitoring-chart')).toHaveCount(4);
  await page.getByRole('button', { name: 'Все устройства', exact: true }).click();
  await expect(grid).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await grid.getByRole('button', { name: 'Открыть Можайск' }).scrollIntoViewIfNeeded();
  await expect(grid.getByRole('button', { name: 'Открыть Можайск' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('monitoring-cards-mobile.png') });
});

test('central node is centered alone above Moscow, Saint Petersburg and the remaining equipment', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, false, false);
  const grid = page.getByRole('region', { name: 'Оборудование сети', exact: true });
  const cards = grid.getByRole('button', { name: /^Открыть / });
  const central = grid.getByRole('button', { name: 'Открыть Центральный узел', exact: true });
  const order = ['Центральный узел', 'Москва', 'Москва · резерв', 'Санкт-Петербург', 'Санкт-Петербург · резерв'];
  for (const [index, name] of order.entries()) await expect(cards.nth(index)).toHaveAccessibleName(`Открыть ${name}`);
  await expect(central).toHaveCount(1);
  for (const width of [1440, 1556, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const container = await grid.boundingBox();
    const main = await central.boundingBox();
    expect(Math.abs(main.x + main.width / 2 - container.x - container.width / 2)).toBeLessThan(1);
    const moscow = await cards.nth(1).boundingBox();
    expect(moscow.y).toBeGreaterThan(main.y + main.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    if (width === 1440 || width === 390) await page.screenshot({ path: testInfo.outputPath(`monitoring-hierarchy-${width}.png`) });
  }
  await central.focus();
  await page.keyboard.press('Tab');
  await expect(cards.nth(1)).toBeFocused();
  const search = page.getByLabel('Найти оборудование', { exact: true });
  await search.fill('Москва');
  await expect(cards).toHaveCount(2);
  await expect(central).toHaveCount(0);
  expect(Math.abs((await cards.first().boundingBox()).y - (await grid.boundingBox()).y)).toBeLessThan(1);
  await search.fill('Санкт-Петербург');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAccessibleName('Открыть Санкт-Петербург');
  await search.clear();
  await central.click();
  const list = page.getByRole('list', { name: 'Выбор устройства', exact: true });
  for (const [index, name] of order.entries()) await expect(list.getByRole('button').nth(index)).toHaveAccessibleName(`Открыть ${name}`);
  await page.keyboard.press('Escape');
  await expect(grid).toBeVisible();
  await expect(central).toHaveCount(1);
});

test('compact header, outage timestamps and friendly names on the equipment cards', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, false, false);
  const header = page.getByRole('banner', { name: 'Панель мониторинга' });
  await expect(header.getByLabel('Найти оборудование', { exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Подключить устройство', exact: true })).toBeVisible();
  const grid = page.getByRole('region', { name: 'Оборудование сети', exact: true });
  const moj = grid.getByRole('button', { name: 'Открыть Можайск', exact: true });
  await expect(moj.getByRole('heading', { name: 'Можайск', exact: true })).toBeVisible();
  await expect(moj).toContainText('Последний обрыв:');
  await expect(moj).toContainText('18 мин');
  const offline = grid.getByRole('button', { name: 'Открыть Котельный', exact: true });
  await expect(offline).toContainText(/Нет связи · 1[89] мин/);
  await expect(offline).toContainText(/Обрыв: \d{2}\.\d{2}, \d{2}:\d{2}/);
  await expect(grid.getByRole('button', { name: 'Открыть Склад · коммутатор', exact: true })).toContainText('Недоступен с начала наблюдения');
  await expect(grid.getByRole('button', { name: 'Открыть Тикси', exact: true })).toContainText('Упал WAN');
  const headerBox = await header.boundingBox();
  expect((await grid.boundingBox()).y - headerBox.y - headerBox.height).toBeLessThan(100);
  await page.screenshot({ path: testInfo.outputPath('monitoring-compact-outages.png') });
  await header.getByLabel('Найти оборудование', { exact: true }).fill('котельный');
  await expect(grid.getByRole('button', { name: /^Открыть / })).toHaveCount(1);
  await expect(offline).toBeVisible();
  await header.getByLabel('Найти оборудование', { exact: true }).clear();
  await page.setViewportSize({ width: 390, height: 844 });
  await header.getByRole('button', { name: 'Действия мониторинга' }).click();
  await expect(page.getByRole('menuitem', { name: 'Подключить устройство', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('monitoring-compact-mobile.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(header.getByRole('button', { name: 'Действия мониторинга' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const observedAt = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(observedAt + 10 * 60000));
  await header.getByLabel('Найти оборудование', { exact: true }).fill('Можайск');
  await expect(moj).toContainText('Данные устарели');
  await page.clock.setFixedTime(new Date(observedAt));
  await header.getByLabel('Найти оборудование', { exact: true }).clear();
  await expect(moj).toContainText('В сети');
});

test('opening a scrolled card starts at the top and background refresh preserves the reading position', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await login(page, false, false);
  const grid = page.getByRole('region', { name: 'Оборудование сети', exact: true });
  const last = grid.getByRole('button', { name: /^Открыть / }).last();
  await last.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await last.click();
  await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId('monitoring-chart')).toHaveCount(4);
  await page.getByRole('region', { name: 'Ресурсы устройства', exact: true }).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  const refreshed = page.waitForResponse(r => r.url().endsWith('/monitoring/overview') && r.status() === 200);
  await page.getByRole('banner', { name: 'Панель мониторинга' }).getByRole('button', { name: 'Обновить', exact: true }).click();
  await refreshed;
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThan(5);
  await page.getByRole('button', { name: 'Все устройства', exact: true }).click();
  await expect(grid).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('Escape closes overlays first, then returns from the device to the filtered equipment list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const header = page.getByRole('banner', { name: 'Панель мониторинга' });
  const grid = page.getByRole('region', { name: 'Оборудование сети', exact: true });
  const overviewTab = page.getByRole('tab', { name: 'Обзор', exact: true });

  await header.getByRole('button', { name: 'Настройки устройства', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Настройки устройства', exact: true });
  await settings.getByRole('textbox', { name: /^Название в мониторинге/ }).fill('Не сохранять это имя');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(overviewTab).toBeVisible();

  await page.getByRole('combobox', { name: /^Период/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.MuiMenu-root')).toHaveCount(0);
  await expect(overviewTab).toBeVisible();

  await header.getByRole('button', { name: 'Удалить устройство', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Удалить устройство из мониторинга?', exact: true });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(overviewTab).toBeVisible();

  const search = header.getByLabel('Найти оборудование', { exact: true });
  await search.fill('Можайск');
  await page.keyboard.press('Escape');
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('button', { name: /^Открыть / })).toHaveCount(1);
  await expect(search).toHaveValue('Можайск');
  await expect(search).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(grid).toBeVisible();

  await grid.getByRole('button', { name: 'Открыть Можайск', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await header.getByRole('button', { name: 'Действия мониторинга', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.MuiMenu-root')).toHaveCount(0);
  await expect(overviewTab).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(grid).toBeVisible();
  await expect(search).toBeFocused();
});

test('charts, values table, port control and offline events', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);
  await expect(page.getByTestId('monitoring-chart')).toHaveCount(4);
  await page.getByRole('combobox', { name: /^Период/ }).click();
  await page.getByRole('option', { name: 'Последний час', exact: true }).click();
  await page.getByRole('button', { name: 'Таблица значений', exact: true }).first().click();
  await expect(page.getByRole('table', { name: /Трафик.*последние значения/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('monitoring-desktop.png') });
  await page.getByRole('tab', { name: 'Интерфейсы', exact: true }).click();
  const ports = page.getByRole('table', { name: 'Состояние интерфейсов' });
  await expect(ports.getByRole('row').filter({ hasText: 'ether8' })).toContainText('Выключен');
  await ports.getByRole('button', { name: 'Настроить ether1_wan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Контроль интерфейса ether1_wan' });
  await dialog.getByLabel('Приём, Мбит/с', { exact: true }).fill('150');
  await dialog.getByRole('button', { name: 'Сохранить настройки порта' }).click();
  await expect(dialog).toBeHidden();
  const overview = await (await page.request.get('/api/v1/monitoring/overview')).json();
  const router = overview.targets.find(row => row.address === '192.0.2.10');
  const detail = await (await page.request.get(`/api/v1/monitoring/targets/${router.id}`)).json();
  expect(detail.interfaces.find(row => row.name === 'ether1_wan').settings.capacity_rx_bps).toBe(150e6);
  await page.getByRole('button', { name: 'Открыть Склад · коммутатор', exact: true }).click();
  await page.getByRole('tab', { name: 'События', exact: true }).click();
  await expect(page.getByText('Устройство недоступно из HUB', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('pin follows the chosen interface on the card and after reload, switches and unpins', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const select = page.getByRole('combobox', { name: /^Интерфейс для графиков/ });
  await select.click();
  await page.getByRole('option', { name: 'ether24_uplink', exact: true }).click();
  await page.getByRole('button', { name: 'Закрепить ether24_uplink', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открепить ether24_uplink', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Трафик · ether24_uplink', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const card = page.getByRole('region', { name: 'Оборудование сети', exact: true }).getByRole('button', { name: 'Открыть Можайск', exact: true });
  await expect(card).toContainText('ether24_uplink · закреплён');
  await expect(card.locator('svg path').last()).toHaveAttribute('d', /M/);
  await page.reload();
  await card.click();
  await expect(select).toContainText('ether24_uplink · закреплён');
  await page.setViewportSize({ width: 390, height: 844 });
  await select.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('monitoring-pinned-mobile.png') });
  await select.click();
  await page.getByRole('option', { name: /^ether1_wan/ }).click();
  await page.getByRole('button', { name: 'Закрепить ether1_wan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открепить ether1_wan', exact: true })).toBeEnabled();
  const overview = await (await page.request.get('/api/v1/monitoring/overview')).json();
  const target = overview.targets.find(row => row.address === '192.0.2.10');
  const detail = await (await page.request.get(`/api/v1/monitoring/targets/${target.id}`)).json();
  expect(detail.interfaces.filter(row => row.settings.pinned).map(row => row.name)).toEqual(['ether1_wan']);
  await page.getByRole('button', { name: 'Открепить ether1_wan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Закрепить ether1_wan', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('connect registry card with a write-only profile and pause collection', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Подключить устройство', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Подключить устройство', exact: true });
  await dialog.getByRole('combobox', { name: 'Устройство из раздела «Сети»' }).fill('Новый');
  await page.getByRole('option', { name: /Новый коммутатор/ }).click();
  await dialog.getByRole('button', { name: 'Новый профиль', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Новый профиль SNMP', exact: true });
  await profile.getByLabel(/^Название профиля/).fill('Browser test profile');
  await profile.getByLabel(/^Community/).fill('test-only-browser-profile');
  await profile.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(profile).toBeHidden();
  await dialog.getByLabel('Собирать данные устройства').uncheck();
  await dialog.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Новый коммутатор', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Опросить', exact: true })).toBeDisabled();
  const response = await page.request.get('/api/v1/monitoring/profiles');
  expect(await response.text()).not.toContain('test-only-browser-profile');
});

test('individual read access, mobile layout and keyboard navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, true);
  await expect(page.getByTestId('monitoring-chart')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Подключить устройство', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Настройки устройства', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Закрепить|Открепить) / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Действия мониторинга', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Удалить устройство', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await page.request.get('/api/v1/monitoring/profiles')).status()).toBe(403);
  const readerOverview = await (await page.request.get('/api/v1/monitoring/overview')).json();
  expect((await page.request.delete(`/api/v1/monitoring/targets/${readerOverview.targets[0].id}`)).status()).toBe(403);
  await page.getByRole('tab', { name: 'Обзор', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Интерфейсы', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Графики ether8', exact: true }).filter({ visible: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('monitoring-mobile.png'), fullPage: true });
});

test('custom history range and dark charts preserve unavailable metrics', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);
  await expect(page.getByTestId('monitoring-chart')).toHaveCount(4);
  await page.getByRole('combobox', { name: /^Период/ }).click();
  await page.getByRole('option', { name: 'Свой период', exact: true }).click();
  const dates = await page.evaluate(() => {
    const local = (at) => new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return { start: local(Date.now() - 1800000), end: local(Date.now()) };
  });
  const response = page.waitForResponse(r => r.url().includes('/history?') && r.url().includes('start=') && r.status() === 200);
  await page.getByLabel('С начала', { exact: true }).fill(dates.start);
  await page.getByLabel('До', { exact: true }).fill(dates.end);
  await response;
  await expect(page.getByTestId('monitoring-chart')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Графики', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Доступность ICMP и SNMP', exact: true })).toBeVisible();
  const storage = page.getByRole('region', { name: 'Использование хранилища', exact: true });
  await expect(storage).toContainText('Пока нет измерений');
  const dark = await page.evaluate(() => {
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
    return rgb.slice(0, 3).every(value => value < 100);
  });
  expect(dark).toBe(true);
  await page.getByRole('heading', { name: 'Мониторинг', level: 1 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('monitoring-dark.png') });
  await page.getByRole('button', { name: 'Все устройства', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Оборудование сети', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('monitoring-cards-dark.png') });
});

test('delete device confirms history loss, cancels safely and preserves other registry cards', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const before = await (await page.request.get('/api/v1/monitoring/overview')).json();
  const target = before.targets.find(row => row.address === '192.0.2.10');
  const profiles = await (await page.request.get('/api/v1/monitoring/profiles')).json();
  const catalog = await (await page.request.get('/api/v1/monitoring/catalog')).json();
  const path = `/api/v1/monitoring/targets/${target.id}`;
  expect((await (await page.request.get(`${path}/history`)).json()).has_data).toBe(true);
  const deletes = [];
  page.on('request', request => { if (request.method() === 'DELETE') deletes.push(request.url()); });

  await page.getByRole('button', { name: 'Удалить устройство', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Удалить устройство из мониторинга?', exact: true });
  await expect(dialog).toContainText('Можайск');
  await expect(dialog).toContainText('без возможности восстановления через интерфейс');
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(deletes).toHaveLength(0);
  expect((await page.request.get(path)).status()).toBe(200);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Действия мониторинга', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Удалить устройство', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('.MuiMenu-root')).toHaveCount(0);
  await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('monitoring-delete-mobile.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(deletes).toHaveLength(0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Удалить устройство', exact: true }).click();
  await page.context().setOffline(true);
  await dialog.getByRole('button', { name: 'Удалить устройство и историю', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось удалить устройство' })).toBeVisible();
  await page.context().setOffline(false);
  expect((await page.request.get(path)).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Удалить устройство', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Удалить устройство', exact: true }).click();
  const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(path));
  await dialog.getByRole('button', { name: 'Удалить устройство и историю', exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByRole('region', { name: 'Оборудование сети', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Устройство «Можайск» и его история мониторинга удалены.' })).toBeVisible();
  await expect(page.getByLabel('Найти оборудование', { exact: true })).toBeFocused();
  expect((await page.request.get(path)).status()).toBe(404);
  expect((await page.request.get(`${path}/history`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/monitoring/events?target_id=${target.id}`)).status()).toBe(404);
  const after = await (await page.request.get('/api/v1/monitoring/overview')).json();
  expect(after.targets.map(row => row.id).sort()).toEqual(before.targets.filter(row => row.id !== target.id).map(row => row.id).sort());
  expect(await (await page.request.get('/api/v1/monitoring/profiles')).json()).toEqual(profiles);
  expect(await (await page.request.get('/api/v1/monitoring/catalog')).json()).toEqual(catalog);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Открыть Можайск', exact: true })).toHaveCount(0);
});
