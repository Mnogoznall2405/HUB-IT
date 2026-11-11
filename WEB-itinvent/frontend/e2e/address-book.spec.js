import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../output/playwright/', import.meta.url));

test.skip(process.env.E2E_LOCAL !== '1', 'address-book E2E runs only against the local stack');
test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

const LONG_DEPARTMENT = 'Управление цифровых технологий мониторинга и сопровождения корпоративной инфраструктуры центрального аппарата';
const LONG_CITY = 'Нижнекамско-Верхнесерединский пригородный муниципальный округ';
const UNBROKEN_DEPARTMENT = 'ОченьДлинноеПодразделение'.repeat(20);

function employee(overrides = {}) {
  return {
    full_name: 'Иванов Иван Иванович',
    position: 'Ведущий специалист',
    department: LONG_DEPARTMENT,
    department_code: 'DPT-LONG-CODE-0000000000000001',
    department_location: 'Тюмень',
    employee_code: 'E-10001',
    hire_date: '2021-05-17',
    work_phones: [{ kind: 'Рабочий телефон', value: '+7 (3452) 38-42-02', normalized: '73452384202' }],
    personal_phones: [],
    work_emails: [{ kind: 'Корпоративный E-mail', value: 'ivanov@example.com' }],
    personal_emails: [],
    ...overrides,
  };
}

function stubAddressBook(page, {
  items = [],
  dismissedItems = [],
  departments,
  cities,
  status = {},
  failFirstFiltersRequest = false,
  onSearchParams,
} = {}) {
  let filtersCalls = 0;
  const searchParamsLog = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/address-book/search') {
      const params = Object.fromEntries(url.searchParams.entries());
      searchParamsLog.push(params);
      onSearchParams?.(params);
    }
  });

  const routes = [
    page.route('**/api/v1/address-book/search**', (route) => {
      const url = new URL(route.request().url());
      const dismissed = url.searchParams.get('dismissed') === 'true';
      const list = dismissed ? dismissedItems : items;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: list,
          total: list.length,
          has_more: false,
          updated_at: '2026-05-21T10:00:00+00:00',
          last_error: '',
        }),
      });
    }),
    page.route('**/api/v1/address-book/filters**', (route) => {
      filtersCalls += 1;
      if (failFirstFiltersRequest && filtersCalls === 1) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"filters down"}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          departments: departments ?? [{ name: LONG_DEPARTMENT, count: 1 }],
          cities: cities ?? [
            { name: 'Тюмень', count: 1 },
            { name: 'Москва', count: 2 },
            { name: 'Тула', count: 3 },
            { name: LONG_CITY, count: 1 },
          ],
        }),
      });
    }),
    page.route('**/api/v1/address-book/status**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        updated_at: '2026-05-21T10:00:00+00:00',
        dismissed_updated_at: '2026-05-21T10:00:00+00:00',
        last_error: '',
        last_sync_failed: false,
        sync_in_progress: false,
        ...status,
      }),
    })),
  ];
  return { routes: Promise.all(routes), searchParamsLog, getFiltersCalls: () => filtersCalls };
}

async function stubThemeMode(page, mode) {
  await page.route('**/api/v1/settings/me**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const json = await response.json();
    json.theme_mode = mode;
    return route.fulfill({ response, json });
  });
}

async function expectEffectiveTheme(page, mode) {
  await expect.poll(() => page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('web_preferences_cache') || '{}').theme_mode;
    } catch {
      return '';
    }
  })).toBe(mode);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const channels = (bodyBg.match(/[\d.]+/g) || []).map(Number).slice(0, 3);
  const luminance = channels[0] + channels[1] + channels[2];
  if (mode === 'dark') {
    expect(luminance).toBeLessThan(200);
  } else {
    expect(luminance).toBeGreaterThan(600);
  }
}

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function openAddressBook(page, stub) {
  await stub;
  await login(page);
  await page.goto('/address-book');
  await expect(page.getByTestId('address-book-header-row1')).toBeVisible({ timeout: 30_000 });
}

async function viewportOverflow(page) {
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
}

async function tabToLabel(page, label) {
  await page.evaluate(() => document.activeElement?.blur?.());
  for (let i = 0; i < 80; i += 1) {
    const current = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
    if (current === label) return true;
    await page.keyboard.press('Tab');
  }
  return false;
}

async function expectFocusOutline(page, label) {
  const reached = await tabToLabel(page, label);
  expect(reached, `keyboard Tab should reach "${label}"`).toBeTruthy();
  const outline = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return {
      label: el.getAttribute('aria-label') || '',
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });
  expect(outline.label).toBe(label);
  expect(outline.focusVisible).toBeTruthy();
  expect(outline.outlineStyle).not.toBe('none');
  expect(parseFloat(outline.outlineWidth)).toBeGreaterThanOrEqual(2);
  expect(outline.outlineColor).not.toBe('rgba(0, 0, 0, 0)');
}

test('desktop 1280: integrated header, rail, menu, notifications, no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubThemeMode(page, 'light');
  const staff = Array.from({ length: 60 }, (unused, index) => employee({
    full_name: `Сотрудник ${String(index + 1).padStart(2, '0')} Тестовый`,
    employee_code: `E-30${String(index).padStart(3, '0')}`,
    department: index % 4 === 0 ? LONG_DEPARTMENT : `Отдел тестирования ${index + 1}`,
  }));
  await openAddressBook(page, stubAddressBook(page, { items: staff }).routes);
  await expect(page.getByTestId('address-book-entry-detail')).toBeVisible();

  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Адресная книга' })).toBeVisible();
  await expect(page.getByTestId('main-layout-app-bar')).toHaveCount(0);

  const rail = page.locator('.MuiDrawer-docked .MuiDrawer-paper');
  await expect(rail).toBeVisible();
  const railBox = await rail.boundingBox();
  expect(railBox.width).toBeLessThanOrEqual(76);
  expect(railBox.width).toBeGreaterThanOrEqual(56);

  const menuButton = page.getByRole('button', { name: 'Открыть главное меню' });
  await menuButton.click();
  const overlayAccount = page.getByTestId('main-layout-account-button-chat-overlay');
  await expect(overlayAccount).toBeVisible();
  await expect(page.locator('.MuiDrawer-modal .MuiDrawer-paper').getByText('Адресная книга')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlayAccount).toBeHidden();

  const notificationsButton = page.getByTestId('shell-notifications-button');
  await expect(notificationsButton).toBeVisible();
  await notificationsButton.click();
  await expect(page.getByText('Уведомления').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notificationsButton).toBeVisible();

  const detail = page.getByTestId('address-book-entry-detail');
  await expect(detail.getByTestId('address-book-copy-number')).toBeVisible();
  await expect(detail.getByTestId('address-book-save-contact')).toHaveCount(0);
  await expect(detail.getByTestId('address-book-chat-detail')).toBeVisible();

  const overflow = await viewportOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.innerHeight + 1);
  for (const testId of ['address-book-entry-list-scroll', 'address-book-entry-detail-scroll']) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box).toBeTruthy();
    expect(box.y + box.height).toBeLessThanOrEqual(overflow.innerHeight + 1);
  }

  const listScroll = page.getByTestId('address-book-entry-list-scroll');
  const listDims = await listScroll.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(listDims.scrollHeight).toBeGreaterThan(listDims.clientHeight);
  const toolbarBefore = await page.getByTestId('address-book-header-row1').boundingBox();
  await listScroll.hover();
  await page.mouse.wheel(0, 4000);
  await expect(page.locator('[data-testid^="address-book-entry-row"]').last()).toBeInViewport();
  const scrollTop = await listScroll.evaluate((el) => el.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  const toolbarAfter = await page.getByTestId('address-book-header-row1').boundingBox();
  expect(toolbarAfter.y).toBe(toolbarBefore.y);

  await expectFocusOutline(page, 'Открыть главное меню');
  await expectFocusOutline(page, 'Открыть уведомления');

  await expectEffectiveTheme(page, 'light');
  await page.screenshot({ path: `${SCREENSHOT_DIR}address-book-desktop-light.png`, fullPage: false });
});

test('desktop 1280 dark theme screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubThemeMode(page, 'dark');
  await openAddressBook(page, stubAddressBook(page, { items: [employee()] }).routes);
  await expect(page.getByTestId('address-book-entry-detail')).toBeVisible();
  await expectEffectiveTheme(page, 'dark');
  await expectFocusOutline(page, 'Открыть главное меню');
  await page.screenshot({ path: `${SCREENSHOT_DIR}address-book-desktop-dark.png`, fullPage: false });
});

test('compact 1024: detail opens in a drawer, still no page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 728 });
  await openAddressBook(page, stubAddressBook(page, { items: [employee()] }).routes);
  await expect(page.getByTestId('address-book-header-row1')).toBeVisible();
  await expect(page.getByTestId('main-layout-app-bar')).toHaveCount(0);

  await page.locator('[data-testid^="address-book-entry-row"]').first().click();
  const drawer = page.getByTestId('address-book-entry-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('address-book-save-contact')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  const overflow = await viewportOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
});

test('active employees never show a dismissal date, sentinel or real', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const sentinel = employee({ dismissal_date: '0100-01-01' });
  const staleReal = employee({
    full_name: 'Петров Пётр Петрович',
    employee_code: 'E-10002',
    dismissal_date: '2024-01-31',
  });
  await openAddressBook(page, stubAddressBook(page, { items: [sentinel, staleReal] }).routes);

  const detail = page.getByTestId('address-book-entry-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('address-book-dismissal-date')).toHaveCount(0);
  await expect(detail.getByTestId('address-book-dismissed-chip')).toHaveCount(0);
  await expect(detail).not.toContainText('01.01.0100');

  const paneBox = await page.getByTestId('address-book-entry-detail-scroll').boundingBox();
  const chipBox = await detail.locator('.MuiChip-root').first().boundingBox();
  expect(chipBox).toBeTruthy();
  expect(chipBox.x).toBeGreaterThanOrEqual(paneBox.x);
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1);

  await page.locator('[data-testid^="address-book-entry-row"]').nth(1).click();
  await expect(detail).toContainText('Петров Пётр Петрович');
  await expect(detail.getByTestId('address-book-dismissal-date')).toHaveCount(0);
});

test('dismissed tab: real date renders, sentinel collapses to status only', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dismissedWithDate = employee({
    full_name: 'Сидоров Сидор Сидорович',
    employee_code: 'E-20001',
    dismissal_date: '2026-09-30',
  });
  const dismissedSentinel = employee({
    full_name: 'Кузнецов Константин',
    employee_code: 'E-20002',
    dismissal_date: '0100-01-01',
  });
  const stub = stubAddressBook(page, {
    items: [employee()],
    dismissedItems: [dismissedWithDate, dismissedSentinel],
  });
  await openAddressBook(page, stub.routes);

  const dismissedTab = page.getByTestId('address-book-tab-dismissed');
  await expect(dismissedTab).toBeVisible();
  await dismissedTab.click();

  const detail = page.getByTestId('address-book-entry-detail');
  await expect(detail).toContainText('Сидоров Сидор Сидорович');
  await expect(detail.getByTestId('address-book-dismissed-chip')).toContainText('Уволен 30.09.2026');
  await expect(detail.getByTestId('address-book-dismissal-date')).toContainText('30.09.2026');

  await page.locator('[data-testid^="address-book-entry-row"]').nth(1).click();
  await expect(detail).toContainText('Кузнецов Константин');
  await expect(detail.getByTestId('address-book-dismissed-chip')).toContainText('Уволен');
  await expect(detail.getByTestId('address-book-dismissed-chip')).not.toContainText('0100');
  await expect(detail.getByTestId('address-book-dismissal-date')).toHaveCount(0);
});

test('city filter: searchable, commits only on select, clear resets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const stub = stubAddressBook(page, {
    items: [employee()],
    departments: [
      { name: LONG_DEPARTMENT, count: 1 },
      { name: UNBROKEN_DEPARTMENT, count: 1 },
    ],
  });
  await openAddressBook(page, stub.routes);
  const searches = stub.searchParamsLog;

  const cityInput = page.getByTestId('address-book-filter-city');
  await cityInput.click();
  await expect(page.getByRole('option', { name: 'Тюмень' })).toBeVisible();
  await cityInput.fill('Тю');
  await expect(page.getByRole('option', { name: 'Тюмень' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Москва' })).toHaveCount(0);
  await cityInput.press('ArrowDown');
  await cityInput.press('Enter');
  await expect.poll(() => searches.at(-1)?.city).toBe('Тюмень');
  await expect(page.getByTestId('address-book-active-filters')).toContainText('Город: Тюмень');

  await cityInput.click();
  await cityInput.fill('Мос');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  expect(searches.filter((params) => params.city === 'Мос')).toHaveLength(0);
  expect(searches.at(-1)?.city).toBe('Тюмень');

  await cityInput.click();
  await page.getByRole('button', { name: 'Очистить', exact: true }).click();
  await expect.poll(() => searches.at(-1)?.city ?? null).toBeNull();
  await expect(page.getByTestId('address-book-active-filters')).toHaveCount(0);

  const departmentInput = page.getByTestId('address-book-filter-department');
  await departmentInput.click();
  const option = page.getByRole('option', { name: LONG_DEPARTMENT });
  await expect(option).toBeVisible();
  const optionBox = await option.boundingBox();
  const metrics = await viewportOverflow(page);
  expect(optionBox.x).toBeGreaterThanOrEqual(0);
  expect(optionBox.x + optionBox.width).toBeLessThanOrEqual(metrics.innerWidth);
  expect(optionBox.height).toBeGreaterThan(24);

  const listbox = page.getByRole('listbox');
  const listboxStyle = await listbox.evaluate((el) => getComputedStyle(el).maxHeight);
  expect(listboxStyle).toBe('320px');

  const unbrokenOption = page.getByRole('option', { name: UNBROKEN_DEPARTMENT });
  await expect(unbrokenOption).toBeVisible();
  const unbroken = await unbrokenOption.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      overflowWrap: style.overflowWrap,
      whiteSpace: style.whiteSpace,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      x: rect.x,
      right: rect.right,
    };
  });
  expect(unbroken.whiteSpace).toBe('normal');
  expect(unbroken.overflowWrap).toBe('anywhere');
  expect(unbroken.scrollWidth).toBeLessThanOrEqual(unbroken.clientWidth);
  expect(unbroken.x).toBeGreaterThanOrEqual(0);
  expect(unbroken.right).toBeLessThanOrEqual(metrics.innerWidth);
});

test('filters directory: first failure retries on the next open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const stub = stubAddressBook(page, { items: [employee()], failFirstFiltersRequest: true });
  await openAddressBook(page, stub.routes);

  const cityInput = page.getByTestId('address-book-filter-city');
  await cityInput.click();
  await expect.poll(() => stub.getFiltersCalls()).toBe(1);

  const departmentInput = page.getByTestId('address-book-filter-department');
  await departmentInput.click();
  await expect.poll(() => stub.getFiltersCalls()).toBe(2);
  await expect(page.getByRole('option', { name: LONG_DEPARTMENT })).toBeVisible();
});

test('mobile 390: filters dialog fits, city searchable, vCard only in the sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubThemeMode(page, 'light');
  const stub = stubAddressBook(page, { items: [employee()] });
  await login(page);
  await stub.routes;
  await page.goto('/address-book');
  await expect(page.getByTestId('address-book-mobile-toolbar')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('address-book-filters-button').click();
  const dialog = page.getByTestId('address-book-filters-dialog');
  await expect(dialog).toBeVisible();

  const metrics = await viewportOverflow(page);
  for (const testId of ['address-book-filter-department', 'address-book-filter-city']) {
    const box = await dialog.getByTestId(testId).boundingBox();
    expect(box.width).toBeGreaterThan(120);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(metrics.innerWidth);
  }

  const searches = stub.searchParamsLog;
  const cityInput = dialog.getByTestId('address-book-filter-city');
  await cityInput.click();
  await cityInput.fill('Тю');
  await expect(page.getByRole('option', { name: 'Тюмень' })).toBeVisible();
  await page.getByRole('option', { name: 'Тюмень' }).click();
  await expect.poll(() => searches.at(-1)?.city).toBe('Тюмень');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('address-book-active-filters')).toContainText('Город: Тюмень');

  await page.getByTestId('address-book-filters-button').click();
  const dialogAgain = page.getByTestId('address-book-filters-dialog');
  await expect(dialogAgain).toBeVisible();
  await dialogAgain.getByTestId('address-book-filter-city').click();
  await dialogAgain.getByRole('button', { name: 'Очистить', exact: true }).click();
  await expect.poll(() => searches.at(-1)?.city ?? null).toBeNull();
  await page.keyboard.press('Escape');
  await dialogAgain.getByRole('button', { name: 'Готово' }).click();
  await expect(dialogAgain).toBeHidden();

  await page.locator('[data-testid^="address-book-entry-row"]').first().click();
  const sheet = page.getByTestId('address-book-entry-sheet');
  await expect(sheet).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await sheet.getByTestId('address-book-save-contact').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.vcf');
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  await expectEffectiveTheme(page, 'light');
  await page.screenshot({ path: `${SCREENSHOT_DIR}address-book-mobile-390-light.png`, fullPage: false });
});

test('mobile 320: filters dialog fields stay inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await stubThemeMode(page, 'dark');
  const stub = stubAddressBook(page, { items: [employee()] });
  await login(page);
  await stub.routes;
  await page.goto('/address-book');
  await expect(page.getByTestId('address-book-mobile-toolbar')).toBeVisible({ timeout: 30_000 });
  await expectEffectiveTheme(page, 'dark');

  await page.getByTestId('address-book-filters-button').click();
  const dialog = page.getByTestId('address-book-filters-dialog');
  await expect(dialog).toBeVisible();
  const metrics = await viewportOverflow(page);
  for (const testId of ['address-book-filter-department', 'address-book-filter-city']) {
    const box = await dialog.getByTestId(testId).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(metrics.innerWidth);
  }
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);

  await page.screenshot({ path: `${SCREENSHOT_DIR}address-book-mobile-320-dark.png`, fullPage: false });
});

test('list states: skeleton, error panel with retry, empty state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let failSearch = false;
  let holdSearch = null;
  await page.route('**/api/v1/address-book/search**', (route) => {
    if (holdSearch) {
      return new Promise((resolve) => holdSearch.push(() => resolve(route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, has_more: false, updated_at: '', last_error: '' }),
      }))));
    }
    if (failSearch) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"down"}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, has_more: false, updated_at: '', last_error: '' }),
    });
  });
  await page.route('**/api/v1/address-book/status**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ count: 0, updated_at: '', last_error: '', last_sync_failed: false, sync_in_progress: false }),
  }));
  await login(page);

  holdSearch = [];
  await page.goto('/address-book');
  await expect(page.getByTestId('address-book-entry-list-skeleton')).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}address-book-loading.png`, fullPage: false });
  const releases = holdSearch;
  holdSearch = null;
  releases.forEach((release) => release());
  await expect(page.getByTestId('address-book-entry-list-empty')).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}address-book-empty.png`, fullPage: false });

  failSearch = true;
  await page.goto('/address-book');
  await expect(page.getByTestId('address-book-entry-list-error')).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}address-book-error.png`, fullPage: false });
  failSearch = false;
  await page.getByRole('button', { name: 'Повторить' }).first().click();
  await expect(page.getByTestId('address-book-entry-list-empty')).toBeVisible();
});
