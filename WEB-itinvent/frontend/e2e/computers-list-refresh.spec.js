import { test, expect } from '@playwright/test';

// Вкладка «Компьютеры»: фоновое обновление не обрезает уже подгруженный список,
// а возврат на вкладку не дублирует запрос. Все API-ответы — изолированные фикстуры.
test.skip(process.env.E2E_LOCAL !== '1', 'Computers list runs against isolated API fixtures (E2E_LOCAL=1)');
test.use({ serviceWorkers: 'block' });

const user = { id: 7, username: 'computers-e2e', role: 'admin', is_active: true };

function makeComputers(count) {
  return Array.from({ length: count }, (_, idx) => {
    const n = idx + 1;
    const num = String(n).padStart(3, '0');
    const hex = n.toString(16).toUpperCase().padStart(4, '0');
    return {
      hostname: `PC-${num}`,
      mac_address: `AA-BB-CC-00-${hex.slice(0, 2)}-${hex.slice(2, 4)}`,
      status: 'online',
      age_seconds: 60,
      branch_name: 'Тест',
      location_name: 'Офис',
      database_id: 'ITINVENT',
      database_name: 'Основная БД',
      user_full_name: 'Сотрудник',
      user_login: 'employee',
      ip_primary: `10.10.0.${(n % 200) + 1}`,
      has_hardware_changes: false,
    };
  });
}

function serveSearch(ctrl, url) {
  const params = new URL(url).searchParams;
  const offset = Number(params.get('offset') || 0);
  const limit = Number(params.get('limit') || 50);
  const items = ctrl.computers.slice(offset, offset + limit).map((pc, idx) => (
    ctrl.marker && offset === 0 && idx === 0 ? { ...pc, user_full_name: 'Фоновое обновление' } : pc
  ));
  const end = offset + items.length;
  const hasMore = end < ctrl.computers.length;
  return {
    items,
    total: ctrl.computers.length,
    limit,
    offset,
    has_more: hasMore,
    next_offset: hasMore ? end : null,
    summary: {
      total: ctrl.computers.length,
      unassigned: 0,
      statuses: { online: ctrl.computers.length, stale: 0, offline: 0, unknown: 0 },
      branches: { 'Тест': ctrl.computers.length },
      outlook: {},
    },
  };
}

async function prepare(page, computers, { clock = false } = {}) {
  const ctrl = { computers, calls: [], held: [], shouldHold: null, marker: false };
  if (clock) await page.clock.install();
  await page.addInitScript((identity) => {
    localStorage.setItem('user', JSON.stringify(identity));
    localStorage.setItem('hubit:desktop-handoff', 'never');
  }, user);
  // Ни один запрос не уходит за пределы локального стека.
  await page.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort()));
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: user }));
  await page.route('**/api/v1/inventory/computers/search*', (route) => {
    const url = route.request().url();
    const params = new URL(url).searchParams;
    ctrl.calls.push({ offset: Number(params.get('offset')), limit: Number(params.get('limit')) });
    if (ctrl.shouldHold && ctrl.shouldHold(url)) {
      ctrl.held.push({ route, url });
      return undefined;
    }
    return route.fulfill({ json: serveSearch(ctrl, url) });
  });
  return ctrl;
}

async function setVisibility(page, value) {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

test('background refresh keeps the rows the user already paged in', async ({ page }) => {
  const ctrl = await prepare(page, makeComputers(260), { clock: true });
  await page.goto('/computers');

  // Подгрузка страниц идёт по сентинелу: ждём полный список (260 записей, одна группа «Офис»).
  await expect(page.getByText('Показать (260)', { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.getByText('Показать (260)', { exact: true }).click();
  await expect(page.getByText(/^PC-\d{3}$/)).toHaveCount(260);

  // Фоновый опрос на 120 с: голова списка запрашивается лимитом 200, хвост из 60 записей должен остаться.
  ctrl.marker = true;
  await page.clock.runFor(121_000);
  await expect.poll(() => ctrl.calls.some((call) => call.offset === 0 && call.limit === 200)).toBe(true);
  await expect(page.getByText('Фоновое обновление', { exact: true })).toBeVisible();
  await expect(page.getByText(/^PC-\d{3}$/)).toHaveCount(260);
});

test('returning to the tab does not duplicate a recent or in-flight computers request', async ({ page }) => {
  const ctrl = await prepare(page, makeComputers(3), { clock: true });
  await page.goto('/computers');
  await expect(page.getByText('Показать (3)', { exact: true })).toBeVisible();
  const initial = ctrl.calls.length;

  // Данные свежие (< 30 с): возврат на вкладку не запрашивает список повторно.
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await page.waitForTimeout(800);
  expect(ctrl.calls.length).toBe(initial);

  // Запрос уже идёт (ручное обновление держим открытым): возврат не добавляет второй.
  ctrl.shouldHold = () => true;
  await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await expect.poll(() => ctrl.held.length).toBe(1);
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await page.waitForTimeout(800);
  expect(ctrl.calls.length).toBe(initial + 1);

  ctrl.shouldHold = null;
  for (const entry of ctrl.held.splice(0)) {
    await entry.route.fulfill({ json: serveSearch(ctrl, entry.url) });
  }
  await expect(page.getByText('Показать (3)', { exact: true })).toBeVisible();
});

test('returning to the tab after 30 s reloads the list once', async ({ page }) => {
  const ctrl = await prepare(page, makeComputers(3), { clock: true });
  await page.goto('/computers');
  await expect(page.getByText('Показать (3)', { exact: true })).toBeVisible();
  const initial = ctrl.calls.length;

  // Прошло больше 30 с, опрос (120 с) ещё не сработал: возврат обновляет список ровно один раз.
  await page.clock.runFor(31_000);
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect.poll(() => ctrl.calls.length).toBe(initial + 1);
  await page.waitForTimeout(500);
  expect(ctrl.calls.length).toBe(initial + 1);
});
