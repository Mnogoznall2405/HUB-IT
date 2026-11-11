import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'Isolated local browser scenarios only');
test.use({ serviceWorkers: 'block' });

const user = {
  id: 14, username: 'absence-e2e', full_name: 'Пользователь Тестовый', role: 'viewer', is_active: true,
  permissions: ['dashboard.read', 'address_book.read', 'docflow.read'],
};
const employees = ['Первый Сотрудник Тестовый', 'Второй Сотрудник Тестовый'].map((name, index) => ({
  full_name: name, employee_code: `E-${index + 1}`, position: 'Специалист', department: 'Тестовый отдел',
  work_emails: [], personal_emails: [], work_phones: [], personal_phones: [],
  absence: { kind: 'vacation', label: 'Отпуск', starts_on: '2026-10-26', returns_on: '2026-10-31', source: 'zup' },
}));
const absence = (overrides = {}) => ({
  id: 'docflow:test-1', employee_code: 'E-1', display_name: employees[0].full_name,
  starts_on: '2026-10-26', ends_on: '2026-11-04', label: 'Отпуск', comment: 'Обращаться к заместителю',
  will_handle_tasks: true, source: 'docflow', differences: ['ends_on'], matching_status: 'matched',
  ...overrides,
});
const payload = (items) => ({
  status: 'available', source: 'docflow', count: items.length, items, unresolved_count: 0,
  zup_comparison: 'available', as_of: '2026-10-29T10:00:00Z',
});

async function prepare(page) {
  await page.addInitScript((identity) => {
    localStorage.setItem('user', JSON.stringify(identity));
    localStorage.setItem('hubit:desktop-handoff', 'never');
  }, user);
  await page.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort()));
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: user }));
  await page.route('**/api/v1/address-book/search**', (route) => route.fulfill({ json: { items: employees, total: 2 } }));
  await page.route('**/api/v1/address-book/status*', (route) => route.fulfill({ json: { count: 2 } }));
  await page.route('**/api/v1/hub/dashboard*', (route) => route.fulfill({ json: {
    announcements: { items: [], total: 0 }, my_tasks: { items: [], total: 0 }, unread_counts: {}, summary: {},
    absences_today: { count: 1, items: [{ id: 'zup:E-1', source: 'zup', display_name: employees[0].full_name, kind_label: 'Отпуск', starts_on: '2026-10-26', ends_on: '2026-10-30' }] },
  } }));
}

test('card keeps ZUP and Docflow dates separate and ignores a late previous employee response', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await prepare(page);
  let releaseFirst;
  const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
  await page.route('**/api/v1/docflow/absences**', async (route) => {
    const code = new URL(route.request().url()).searchParams.get('employee_code');
    if (code === 'E-1') {
      await firstHeld;
      await route.fulfill({ json: payload([absence({ comment: 'Запоздалый ответ первого сотрудника' })]) }).catch(() => {});
    } else {
      await route.fulfill({ json: payload([absence({ id: 'docflow:test-2', employee_code: 'E-2', comment: 'Комментарий второго сотрудника' })]) });
    }
  });
  const firstRequest = page.waitForRequest((request) => request.url().includes('/docflow/absences?employee_code=E-1'));
  await page.goto('/address-book');
  await firstRequest;
  await page.locator('[data-testid^="address-book-entry-row"]').nth(1).click();
  const detail = page.getByTestId('address-book-entry-detail');
  await expect(detail.getByText('Комментарий второго сотрудника')).toBeVisible();
  releaseFirst();
  await expect(detail.getByText('Запоздалый ответ первого сотрудника')).toHaveCount(0);
  await expect(detail.getByTestId('address-book-absence-chip')).toBeVisible();
  await expect(detail.getByText(/26.10.2026 — 04.11.2026 включительно/)).toBeVisible();
  await expect(detail.getByText('Данные отличаются от ЗУП')).toBeVisible();
});

test('mobile card retries a failed read and renders a comment as text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  let failed = true;
  await page.route('**/api/v1/docflow/absences**', async (route) => {
    if (failed && new URL(route.request().url()).searchParams.has('employee_code')) {
      failed = false;
      await route.fulfill({ status: 503, json: { detail: { code: 'DOCFLOW_1C_UNAVAILABLE' } } });
    } else {
      await route.fulfill({ json: payload([absence({ comment: '<img src=x onerror=alert(1)>' })]) });
    }
  });
  await page.goto('/address-book');
  await page.locator('[data-testid^="address-book-entry-row"]').first().click();
  const panel = page.getByTestId('docflow-absences').filter({ visible: true });
  await expect(panel.getByText(/Отсутствия Документооборота недоступны/)).toBeVisible();
  await panel.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(panel.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible();
  await expect(panel.locator('img[src="x"]')).toHaveCount(0);
  await expect(panel.getByText('Будет разбирать задачи')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test('search results show Docflow absence beside the name before opening the card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  await page.route('**/api/v1/docflow/absences**', (route) => route.fulfill({ json: payload([
    absence(),
    absence({ id: 'unresolved', employee_code: null, display_name: employees[1].full_name, matching_status: 'unresolved' }),
  ]) }));
  await page.goto('/address-book');
  const rows = page.locator('[data-testid^="address-book-entry-row"]');
  const mark = rows.first().getByTestId('address-book-docflow-absence-mark');
  await expect(mark).toHaveText('Отпуск · до 04.11.2026 · ДО');
  await expect(rows.first().getByTestId('address-book-zup-row-mark')).toBeVisible();
  await expect(mark).toHaveAttribute('aria-label', /Данные отличаются от ЗУП/);
  await expect(rows.nth(1).getByTestId('address-book-docflow-absence-mark')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Поиск по адресной книге' }).fill(employees[0].full_name);
  await expect(mark).toBeVisible();
});

test('mobile search shows a Docflow-only absence and retries a failed source read', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.route('**/api/v1/address-book/search**', (route) => route.fulfill({ json: {
    items: [{ ...employees[0], absence: null }], total: 1,
  } }));
  let failed = true;
  await page.route('**/api/v1/docflow/absences**', async (route) => {
    const global = !new URL(route.request().url()).searchParams.has('employee_code');
    if (global && failed) {
      failed = false;
      await route.fulfill({ status: 503, json: { detail: { code: 'DOCFLOW_1C_UNAVAILABLE' } } });
    } else {
      await route.fulfill({ json: payload([absence({ label: 'Больничный', kind: 'sick', differences: [] })]) });
    }
  });
  await page.goto('/address-book');
  const row = page.locator('[data-testid^="address-book-entry-row"]').first();
  const sourceError = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить отметки отсутствий Документооборота.' });
  await expect(row.getByTestId('address-book-docflow-absence-mark')).toHaveCount(0);
  await sourceError.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(row.getByTestId('address-book-docflow-absence-mark')).toHaveText('Больничный · до 04.11.2026 · ДО');
  await expect(row.getByTestId('address-book-zup-row-mark')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test('dashboard shows unlinked Docflow rows without replacing ZUP or claiming equality', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  await page.route('**/api/v1/docflow/absences**', (route) => route.fulfill({ json: {
    ...payload([absence({ employee_code: null, display_name: 'Несопоставленный Сотрудник', matching_status: 'unresolved', differences: [] })]),
    unresolved_count: 1, zup_comparison: 'unavailable',
  } }));
  await page.goto('/');
  await expect(page.getByTestId('dashboard-absences-list').getByText(employees[0].full_name)).toBeVisible();
  const panel = page.getByTestId('docflow-absences');
  await expect(panel.getByText('Несопоставленный Сотрудник')).toBeVisible();
  await expect(panel.getByText('Связь с адресной книгой не подтверждена')).toBeVisible();
  await expect(panel.getByText(/Сравнение с ЗУП недоступно/)).toBeVisible();
  await expect(panel.getByText('Данные отличаются от ЗУП')).toHaveCount(0);
});
