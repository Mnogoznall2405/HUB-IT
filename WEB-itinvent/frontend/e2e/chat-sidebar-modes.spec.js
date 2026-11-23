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
  // composer → сообщение уходит именно выбранному чату
  const composer = page.getByRole('textbox', { name: 'Сообщение' });
  await composer.fill('e2e: проверка адресата');
  await page.keyboard.press('Enter');
  await expect(page.getByText('e2e: проверка адресата').last()).toBeVisible({ timeout: 15_000 });

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
  await page.screenshot({ path: `${SHOTS}/11-collapsed-selected.png` });

  // === COMPACT: имя + бейдж, выбор виден, шапка не перегружена ===
  await page.getByRole('button', { name: 'Развернуть список чатов' }).click();
  await page.getByRole('button', { name: 'Компактный список чатов' }).click();
  await expect(page.getByRole('button', { name: 'Развернуть список чатов' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/12-compact-selected.png` });
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(1441);

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
