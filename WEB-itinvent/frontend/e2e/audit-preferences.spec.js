import { test, expect } from '@playwright/test';

const userA = { id: 7, username: 'user-a', role: 'viewer', is_active: true };
const userB = { id: 8, username: 'user-b', role: 'viewer', is_active: true };
const settingsA = { pinned_database: 'db-a', database_branch_filters: { 'db-a': 'PRIVATE_BRANCH_A' } };
const settingsB = { pinned_database: 'db-b', database_branch_filters: { 'db-b': 'BRANCH_B' } };
const harness = '/e2e/fixtures/session-cache-harness.html';

async function prepare(page) {
  let settings = settingsA;
  let delayed = null;
  let holdNext = '';
  let patches = 0;
  await page.addInitScript((user) => localStorage.setItem('user', JSON.stringify(user)), userA);
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: userA }));
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ json: { status: 'authenticated', user: userB } }));
  await page.route('**/api/v1/settings/me', (route) => {
    if (route.request().method() === 'PATCH') patches += 1;
    if (route.request().method() === holdNext) { holdNext = ''; delayed = route; return; }
    return route.fulfill({ json: settings });
  });
  await page.goto(harness);
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await expect(page.getByLabel('Закреплённая БД')).toHaveText('db-a');
  return {
    hold(method) { holdNext = method; },
    pending() { return delayed; },
    patches() { return patches; },
    async loginB() {
      settings = settingsB;
      await page.getByRole('button', { name: 'Войти как B', exact: true }).click();
      await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
      await expect(page.getByLabel('Закреплённая БД')).toHaveText('db-b');
    },
  };
}

async function expectB(page) {
  await expect(page.getByLabel('Закреплённая БД')).toHaveText('db-b');
  await expect(page.getByLabel('Фильтры филиалов')).toHaveText(JSON.stringify(settingsB.database_branch_filters));
  const stored = await page.evaluate(() => ({
    selected: localStorage.getItem('selected_database'),
    preferences: JSON.parse(localStorage.getItem('web_preferences_cache') || '{}'),
    branches: JSON.parse(localStorage.getItem('database_branch_filters') || '{}'),
  }));
  expect(stored.selected).toBe('db-b');
  expect(stored.preferences.pinned_database).toBe('db-b');
  expect(stored.branches).toEqual(settingsB.database_branch_filters);
}

test('logout clears account settings and database selection', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('logged out');
  await expect(page.getByLabel('Закреплённая БД')).toHaveText('empty');
  await expect(page.getByLabel('Фильтры филиалов')).toHaveText('{}');
  const stored = await page.evaluate(() => [localStorage.getItem('web_preferences_cache'), localStorage.getItem('selected_database'), localStorage.getItem('database_branch_filters')]);
  expect(stored.join('|')).not.toContain('db-a');
  expect(stored.join('|')).not.toContain('PRIVATE_BRANCH_A');
});

test('an old settings read cannot overwrite the next account', async ({ page }) => {
  const state = await prepare(page);
  state.hold('GET');
  await page.getByRole('button', { name: 'Обновить настройки', exact: true }).click();
  await expect.poll(() => Boolean(state.pending())).toBe(true);
  await state.loginB();
  const finished = page.waitForResponse((response) => response.url().endsWith('/settings/me') && response.status() === 200);
  await state.pending().fulfill({ json: settingsA });
  await (await finished).finished();
  await page.getByRole('button', { name: 'Показать кэш', exact: true }).click();
  await expectB(page);
});

for (const status of [200, 500]) {
  test(`an old settings save with HTTP ${status} cannot commit or roll back over the next account`, async ({ page }) => {
    const state = await prepare(page);
    state.hold('PATCH');
    await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
    await expect.poll(() => Boolean(state.pending())).toBe(true);
    await state.loginB();
    await state.pending().fulfill({ status, json: status === 200 ? { ...settingsA, pinned_database: 'db-a-new' } : { detail: 'fixture failure' } });
    await expect(page.getByLabel('Результат', { exact: true })).toHaveText(status === 200 ? /preferences (saved|error)/ : 'preferences error');
    await expectB(page);
  });
}

test('an old deferred settings callback cannot send a patch with the next account', async ({ page }) => {
  const state = await prepare(page);
  let delayed;
  await page.route('**/__audit/late-setting-save', (route) => { delayed = route; });
  await page.getByRole('button', { name: 'Отложить сохранение настроек', exact: true }).click();
  await expect.poll(() => Boolean(delayed)).toBe(true);
  await state.loginB();
  await delayed.fulfill({ body: 'done' });
  await expect(page.getByLabel('Результат', { exact: true })).toHaveText('preferences error');
  expect(state.patches()).toBe(0);
  await expectB(page);
});

test('unowned startup settings expose appearance only while the protected session check is pending', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('web_preferences_cache', JSON.stringify({
      pinned_database: 'LEGACY_PRIVATE_DATABASE', database_branch_filters: { secret: 'PRIVATE_BRANCH_A' }, theme_mode: 'dark',
    }));
  });
  let sessionCheck;
  await page.route('**/api/v1/auth/me*', (route) => { sessionCheck = route; });
  await page.goto(harness);
  await expect.poll(() => Boolean(sessionCheck)).toBe(true);
  await expect(page.getByLabel('Закреплённая БД')).toHaveText('empty');
  await expect(page.getByLabel('Фильтры филиалов')).toHaveText('{}');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('web_preferences_cache')))).toEqual({ theme_mode: 'dark' });
  await sessionCheck.fulfill({ status: 401, json: { detail: 'Session expired' } });
});

test('a cached account keeps its own settings during a temporary startup outage', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ status: 503, json: { detail: 'fixture temporary outage' } }));
  await page.route('**/api/v1/settings/me', (route) => route.fulfill({ status: 503, json: { detail: 'fixture temporary outage' } }));
  await page.reload();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
  await expect(page.getByLabel('Закреплённая БД')).toHaveText('db-a');
  await expect(page.getByLabel('Фильтры филиалов')).toHaveText(JSON.stringify(settingsA.database_branch_filters));
});

test('a failed settings load for the next account cannot fall back to the previous account data', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/v1/settings/me', (route) => route.fulfill({ status: 503, json: { detail: 'fixture temporary outage' } }));
  await page.getByRole('button', { name: 'Войти как B', exact: true }).click();
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-b');
  await expect(page.getByLabel('Закреплённая БД')).toHaveText('empty');
  await expect(page.getByLabel('Фильтры филиалов')).toHaveText('{}');
  const stored = await page.evaluate(() => [localStorage.getItem('web_preferences_cache'), localStorage.getItem('selected_database'), localStorage.getItem('database_branch_filters')]);
  expect(stored.join('|')).not.toContain('db-a');
  expect(stored.join('|')).not.toContain('PRIVATE_BRANCH_A');
});
