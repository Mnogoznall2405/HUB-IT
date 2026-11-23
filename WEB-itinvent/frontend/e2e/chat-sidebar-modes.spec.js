import { expect, request as apiRequest, test } from '@playwright/test';

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = 'e2e-artifacts/sidebar-modes';

test.skip(process.env.E2E_LOCAL !== '1', 'runs only against the local stack');
test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

async function apiLogin(page, user, pass) {
  const resp = await page.request.post('/api/v1/auth/login', { data: { username: user, password: pass } });
  expect(resp.ok()).toBeTruthy();
}

const api = (page) => ({
  get: (url) => page.request.get(`/api/v1${url}`),
  post: (url, data) => page.request.post(`/api/v1${url}`, { data }),
});

// Сид ≥15 переписок: личные, группы, длинные имена, непрочитанные.
// Авторизация cookie-based: login через page.request ставит сессионную куку.
async function seedConversations(page) {
  await apiLogin(page, USERNAME, PASSWORD);
  const admin = api(page);
  const usersResp = await admin.get('/chat/users?limit=50');
  console.log('users status', usersResp.status());
  const usersJson = usersResp.ok() ? await usersResp.json() : {};
  const users = usersJson.items || usersJson.users || (Array.isArray(usersJson) ? usersJson : []);
  console.log('users count', users.length);
  const ids = (Array.isArray(users) ? users : []).map((u) => u.id).filter(Boolean);
  const titles = [
    'Проект: Объекты строительства', 'IT Обслуживание', 'Начальники участков',
    'Финансы и логистика', 'HR / Кадры', 'Архивариус длинноназванного департамента кадрового сопровождения',
    'Снабжение', 'Склад №4', 'Монтажники Братск', 'Охрана труда и промышленная безопасность',
    'Юристы', 'Пресс-служба', 'Бухгалтерия расчётного отдела',
  ];
  const convIds = [];
  for (const title of titles) {
    const resp = await admin.post('/chat/conversations/group', { title, member_user_ids: ids.slice(0, 5) });
    if (resp.ok()) convIds.push((await resp.json()).id);
    else console.log('group create failed', resp.status(), title.slice(0, 20), (await resp.text()).slice(0, 150));
  }
  for (const uid of ids.slice(0, 2)) {
    const resp = await admin.post('/chat/conversations/direct', { peer_user_id: uid });
    if (resp.ok()) convIds.push((await resp.json()).id);
    else console.log('direct create failed', resp.status(), (await resp.text()).slice(0, 150));
  }
  console.log('seeded conversations:', convIds.length);
  for (const id of convIds.slice(6, 10)) {
    await admin.post(`/chat/conversations/${id}/messages`, { body: `Проверка предпросмотра ${id.slice(0, 4)}` });
  }
  // Непрочитанные: сообщения от второго пользователя — отдельный контекст,
  // чтобы не сбить куку администратора.
  if (process.env.E2E_USERNAME2 && convIds.length) {
    const ctx = await apiRequest.newContext({
      baseURL: `http://127.0.0.1:${process.env.E2E_FRONTEND_PORT || '5174'}`,
    });
    const r = await ctx.post('/api/v1/auth/login', { data: { username: process.env.E2E_USERNAME2, password: process.env.E2E_PASSWORD2 } });
    if (r.ok()) {
      for (const id of convIds.slice(0, 6)) {
        await ctx.post(`/api/v1/chat/conversations/${id}/messages`, { data: { body: `Приёмка сайдбара ${id.slice(0, 4)}` } });
      }
    }
    await ctx.dispose();
  }
  return convIds;
}

const activeRow = (page) => page.locator('[data-chat-active][aria-current="page"]');

test.describe.configure({ timeout: 120_000 });

test('sidebar modes: seeded chats, selection sync, tooltips, viewports', async ({ page }) => {
  await seedConversations(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat');
  await expect(page.getByTestId('chat-sidebar-desktop-header')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);

  // === EXPANDED: выбор чата → шапка → отправка адресату ===
  // Группы живут во вкладке «Беседы» (кнопка, не role=tab).
  await page.getByRole('button', { name: /^Беседы/ }).click();
  const rows = page.locator('[data-chat-active]');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(10);
  const target = rows.nth(3);
  const targetName = ((await target.getAttribute('title')) || (await target.textContent()) || '').trim().split('\n')[0];
  await target.click();
  await expect(target).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
  // Шапка показывает имя именно выбранного чата (заголовок h6 в шапке треда).
  await expect(page.getByRole('heading', { name: targetName, exact: true })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/10-expanded-selected.png` });
  // composer → сообщение уходит именно выбранному чату. Отправка идёт
  // WS-first (HTTP — fallback), поэтому подтверждаем адресата через API:
  // GET messages выбранной беседы должен содержать отправленный текст.
  const selectedConvId = new URL(page.url()).searchParams.get('conversation');
  expect(selectedConvId).toBeTruthy();
  const composer = page.getByRole('textbox', { name: 'Сообщение' });
  await composer.fill('e2e: проверка адресата');
  await page.keyboard.press('Enter');
  await expect(page.getByText('e2e: проверка адресата').last()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => {
    const resp = await page.request.get(`/api/v1/chat/conversations/${selectedConvId}/messages`);
    if (!resp.ok()) return '';
    const json = await resp.json();
    const items = json.items || json.messages || (Array.isArray(json) ? json : []);
    return items.map((m) => String(m?.body || '')).join('\n');
  }, { timeout: 15_000 }).toContain('e2e: проверка адресата');

  // === Быстрое переключение 5+ чатов → шапка/выделение не расходятся ===
  const lastTitle = ((await rows.nth(4).getAttribute('title')) || '').trim().split('\n')[0];
  for (const i of [0, 2, 5, 1, 4]) { await rows.nth(i).click(); }
  await expect(rows.nth(4)).toHaveAttribute('aria-current', 'page');
  expect(await activeRow(page).count()).toBe(1);
  await expect(page.getByRole('heading', { name: lastTitle, exact: true })).toBeVisible({ timeout: 15_000 });

  // === COLLAPSED: аватары, tooltip мышью и клавиатурой, выбор виден ===
  await page.getByRole('button', { name: 'Свернуть список чатов' }).click();
  await expect(page.getByRole('button', { name: 'Развернуть список чатов' })).toBeVisible();
  const railRows = page.locator('[data-chat-active]');
  await railRows.nth(4).hover();
  await expect(page.getByRole('tooltip').first()).toBeVisible({ timeout: 5000 });
  await page.mouse.move(10, 400);
  // Клавиатурный tooltip: фокус на строке-аватаре показывает MUI Tooltip.
  await railRows.nth(4).focus();
  await expect(page.getByRole('tooltip').first()).toBeVisible({ timeout: 5000 });
  await railRows.nth(6).click();
  await expect(railRows.nth(6)).toHaveAttribute('aria-current', 'page');
  // FAB в dock-режиме: не перекрывает ни одну строку списка.
  const fabDock = page.getByTestId('chat-compose-fab-dock');
  await expect(fabDock).toBeVisible();
  const fabBox = await page.getByTestId('chat-compose-fab').boundingBox();
  const rowBox = await railRows.nth(6).boundingBox();
  expect(fabBox && rowBox && fabBox.y >= rowBox.y + rowBox.height - 1).toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/11-collapsed-selected.png` });

  // === COMPACT: селектор раздела вместо скрытой прокрутки вкладок ===
  await page.getByRole('button', { name: 'Развернуть список чатов' }).click();
  await page.getByRole('button', { name: 'Компактный список чатов' }).click();
  await expect(page.getByRole('button', { name: 'Развернуть список чатов' })).toBeVisible();
  // Все разделы достижимы через селектор — «Задачи» видна без прокрутки.
  const folderSelect = page.getByTestId('chat-folder-select');
  await expect(folderSelect).toBeVisible();
  await folderSelect.click();
  await expect(page.getByRole('menuitem', { name: 'Задачи' })).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}/12-compact-selected.png` });
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(1441);

  // === Реальный pointer-drag разделителя: expanded → compact → expanded ===
  await page.getByRole('button', { name: 'Развернуть список чатов' }).click();
  const separator = page.getByRole('separator', { name: 'Ширина списка чатов' });
  const sepBox = await separator.boundingBox();
  const sidebarBox = () => page.getByTestId('chat-sidebar-desktop-header').boundingBox();
  const wBefore = (await sidebarBox()).width;
  await page.mouse.move(sepBox.x + 4, sepBox.y + sepBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sepBox.x - 220, sepBox.y + sepBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(folderSelect).toBeVisible({ timeout: 5000 });
  // Хэндл переехал вместе с правым краем панели — берём свежую геометрию.
  const sepBox2 = await separator.boundingBox();
  await page.mouse.move(sepBox2.x + 4, sepBox2.y + sepBox2.height / 2);
  await page.mouse.down();
  await page.mouse.move(sepBox2.x + 240, sepBox2.y + sepBox2.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(folderSelect).toBeHidden({ timeout: 5000 });
  const wAfter = (await sidebarBox()).width;
  expect(wAfter).toBeGreaterThan(176);
  expect(wBefore).toBeGreaterThan(176);

  // === Тёмная тема приложения (theme_mode=system → prefers-color-scheme) ===
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/20-dark-expanded.png` });
  await page.getByRole('button', { name: 'Компактный список чатов' }).click();
  await page.screenshot({ path: `${SHOTS}/21-dark-compact.png` });
  await page.getByRole('button', { name: 'Свернуть список чатов' }).click();
  await page.screenshot({ path: `${SHOTS}/22-dark-collapsed.png` });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Развернуть список чатов' }).click();

  // === 988×838 ===
  await page.setViewportSize({ width: 988, height: 838 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/13-window-988x838.png` });
  const scrollW2 = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW2).toBeLessThanOrEqual(989);

  // === zoom 125% / 150% ===
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const zoom of ['125%', '150%']) {
    await page.evaluate((z) => { document.documentElement.style.zoom = z; }, zoom);
    await page.waitForTimeout(400);
    const w = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(w).toBeLessThanOrEqual(40);
  }
  await page.screenshot({ path: `${SHOTS}/14-zoom-150.png` });
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });

  // === светлая тема (если поддерживается prefers-color-scheme) ===
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/15-light.png` });
});

test('sidebar search: temp expand from rail/compact, results, ×/Esc/back, mode restore', async ({ page }) => {
  await seedConversations(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat');
  await expect(page.getByTestId('chat-sidebar-desktop-header')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);

  const railSearchBtn = page.getByRole('button', { name: 'Поиск чатов' });
  const searchInput = page.getByRole('textbox', { name: 'Поиск чатов' });
  const layoutMode = () => page.evaluate(() => JSON.parse(localStorage.getItem('hub.chat.sidebarLayout') || '{}').mode);

  // === Collapsed: лупа → временная панель ~340px + автофокус ===
  await page.getByRole('button', { name: 'Свернуть список чатов' }).click();
  await expect(page.getByRole('button', { name: 'Развернуть список чатов' })).toBeVisible();
  await railSearchBtn.click();
  await expect(searchInput).toBeFocused({ timeout: 5000 });
  await expect(page.getByRole('separator', { name: 'Ширина списка чатов' })).toHaveAttribute('aria-valuenow', '340');
  // Сеанс поиска: ← вместо второстепенных кнопок.
  await expect(page.getByRole('button', { name: 'Закрыть поиск' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Свернуть список чатов' })).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/30-search-temp-expanded.png` });

  // === Ввод → серверные результаты; выбор открывает чат и возвращает rail ===
  // SQLite lower() не опускает кириллицу (отличие от PostgreSQL в проде) —
  // ищем по ASCII-токену, чтобы проверять сам путь поиска, а не коллацию тестовой БД.
  await searchInput.fill('it');
  const result = page.getByRole('button', { name: /IT Обслуживание/ }).first();
  await expect(result).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/31-search-results.png` });
  await result.click();
  await expect(page.getByRole('heading', { name: 'IT Обслуживание', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Развернуть список чатов' })).toBeVisible({ timeout: 5000 });
  // Временная ширина поиска не записалась как пользовательская настройка.
  expect(await layoutMode()).toBe('collapsed');

  // === Compact: поля нет — кнопка «Поиск» на всю ширину ===
  await page.getByRole('button', { name: 'Развернуть список чатов' }).click();
  await page.getByRole('button', { name: 'Компактный список чатов' }).click();
  await expect(page.getByTestId('chat-search-open')).toBeVisible();
  await expect(searchInput).not.toBeVisible();
  await page.screenshot({ path: `${SHOTS}/32-compact-search-button.png` });
  await page.getByTestId('chat-search-open').click();
  await expect(searchInput).toBeFocused({ timeout: 5000 });

  // === × чистит текст и остаётся в поиске; Esc чистит, затем закрывает ===
  await searchInput.fill('Снабжение');
  await expect(page.getByRole('button', { name: 'Очистить поиск' })).toBeVisible();
  await page.getByRole('button', { name: 'Очистить поиск' }).click();
  await expect(searchInput).toHaveValue('');
  await searchInput.fill('Снабжение');
  await searchInput.press('Escape');
  await expect(searchInput).toHaveValue('');
  await searchInput.press('Escape');
  await expect(page.getByTestId('chat-search-open')).toBeVisible({ timeout: 5000 });
  expect(await layoutMode()).toBe('compact');

  // === Поиск существующего собеседника → открытие диалога → compact назад ===
  await page.getByTestId('chat-search-open').click();
  await expect(searchInput).toBeFocused({ timeout: 5000 });
  await searchInput.fill('e2e');
  const personResult = page.getByRole('button', { name: /e2e/i }).first();
  await expect(personResult).toBeVisible({ timeout: 15_000 });
  await personResult.click();
  await expect(page.getByTestId('chat-search-open')).toBeVisible({ timeout: 5000 });
  await expect.poll(() => new URL(page.url()).searchParams.get('conversation'), { timeout: 10_000 }).toBeTruthy();

  // === Expanded: «Назад» закрывает поиск без смены постоянного режима ===
  await page.getByRole('button', { name: 'Развернуть список чатов' }).click();
  await searchInput.fill('Юристы');
  await expect(page.getByRole('button', { name: 'Закрыть поиск' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();
  await expect(searchInput).toHaveValue('');
  expect(await layoutMode()).toBe('expanded');

  // === 988×838: поиск из rail не ломает раскладку и не даёт переполнения ===
  await page.setViewportSize({ width: 988, height: 838 });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Свернуть список чатов' }).click();
  await railSearchBtn.click();
  await expect(searchInput).toBeFocused({ timeout: 5000 });
  const scrollW3 = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW3).toBeLessThanOrEqual(989);
  await page.screenshot({ path: `${SHOTS}/33-search-988.png` });
});
