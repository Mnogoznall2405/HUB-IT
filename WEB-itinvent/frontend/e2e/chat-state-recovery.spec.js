import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'isolated local API only');

async function session(loginPage) {
  await loginPage.goto('/login');
  const form = loginPage.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
  await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(loginPage.getByTestId('main-layout-content')).toBeVisible();
  return loginPage.context().newPage();
}
async function seed(page) {
  const users = await (await page.request.get('/api/v1/chat/users')).json();
  const peer = (users.items || users).find(u => u.username === process.env.E2E_USERNAME2);
  const response = await page.request.post('/api/v1/chat/conversations/group', { data: { title: `Follow-up audit ${Date.now()}`, member_user_ids: [peer.id] } });
  expect(response.ok(), `Group seed HTTP ${response.status()}`).toBeTruthy();
  const conversation = await response.json();
  const messages = [];
  for (const body of ['Original saved message', 'Question for a new reply']) {
    const sent = await page.request.post(`/api/v1/chat/conversations/${conversation.id}/messages`, { data: { body } });
    expect(sent.ok()).toBeTruthy(); messages.push(await sent.json());
  }
  return { conversation, messages };
}
async function menu(page, id) {
  const message = page.getByTestId('chat-thread-content').locator(`[data-message-id="${id}"] [data-chat-message-id]`);
  await message.locator('[data-chat-bubble-surface="true"]').hover();
  await message.getByRole('button', { name: 'Действия', exact: true }).click();
  return page.getByTestId('chat-message-context-menu');
}
async function delayedEdit(page, conversation, message) {
  let rejectSave; let arrived = false;
  let first = true;
  const gate = new Promise(resolve => { rejectSave = resolve; });
  await page.route(`**/api/v1/chat/conversations/${conversation.id}/messages/${message.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    if (!first) return route.continue();
    first = false;
    arrived = true; await gate;
    await route.fulfill({ status: 503, json: { detail: 'Audit edit failure' } });
  });
  await page.goto(`/chat?conversation=${conversation.id}`);
  await (await menu(page, message.id)).getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  await page.getByTestId('chat-composer-textarea').fill('Edited version pending save');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  try {
    await expect.poll(() => arrived, { timeout: 10000 }).toBe(true);
  } catch (error) {
    rejectSave();
    throw error;
  }
  return rejectSave;
}

test('late failed edit must preserve a newly selected reply', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  const { conversation, messages } = await seed(page);
  const rejectSave = await delayedEdit(page, conversation, messages[0]);
  await (await menu(page, messages[1].id)).getByRole('menuitem', { name: 'Ответить', exact: true }).click();
  await expect(page.getByTestId('chat-composer-textarea')).toHaveValue('');
  rejectSave();
  await expect(page.getByText('Audit edit failure', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-composer-textarea')).toHaveValue('');
  await page.getByTestId('chat-composer-textarea').fill('Intended reply after late save failure');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  let items;
  await expect.poll(async () => {
    items = (await (await page.request.get(`/api/v1/chat/conversations/${conversation.id}/messages`)).json()).items;
    return items.some(item => item.body === 'Intended reply after late save failure');
  }).toBe(true);
  const original = items.find(item => item.id === messages[0].id);
  const replyCreated = items.some(item => item.id !== messages[0].id && item.body === 'Intended reply after late save failure' && item.reply_preview?.id === messages[1].id);
  expect.soft(original?.body).toBe(messages[0].body);
  expect.soft(replyCreated).toBe(true);
});

test('control: failed edit restores its text when no new mode was chosen', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  const { conversation, messages } = await seed(page);
  const rejectSave = await delayedEdit(page, conversation, messages[0]);
  rejectSave();
  await expect(page.getByText('Audit edit failure', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-composer-textarea')).toHaveValue('Edited version pending save');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
});

test('failed scheduled edit must preserve the entered text and date', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  const { conversation } = await seed(page);
  const created = await page.request.post(`/api/v1/chat/conversations/${conversation.id}/scheduled`, { data: {
    body: 'Original scheduled text', scheduled_for: new Date(Date.now() + 3600000).toISOString(), body_format: 'plain',
  } });
  expect(created.ok(), `Scheduled seed HTTP ${created.status()}`).toBeTruthy();
  const item = await created.json();
  await page.route(`**/api/v1/chat/scheduled/${item.id}`, route => route.fulfill({ status: 503, json: { detail: 'Audit schedule update failure' } }));
  await page.goto(`/chat?conversation=${conversation.id}`);
  await page.getByTestId('chat-scheduled-bar').click();
  await page.getByRole('button', { name: 'Изменить запланированное сообщение', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Изменить запланированное', exact: true });
  const text = dialog.getByRole('textbox', { name: 'Текст отложенного сообщения', exact: true });
  const date = dialog.getByLabel('Дата и время отправки', { exact: true });
  await text.fill('Valuable changed scheduled text');
  const nextDate = new Date(Date.now() + 7200000);
  const localDate = new Date(nextDate.getTime() - nextDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await date.fill(localDate);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Audit schedule update failure');
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  const observed = { expectedText: 'Valuable changed scheduled text', actualText: await text.inputValue(), expectedDate: localDate, actualDate: await date.inputValue() };
  expect.soft(observed.actualText).toBe(observed.expectedText);
  expect.soft(observed.actualDate).toBe(observed.expectedDate);
});

test('send-later must recover after an initial config request failure', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  const { conversation } = await seed(page);
  let failConfig = true; let failures = 0;
  await page.route('**/api/v1/chat/config**', route => {
    if (failConfig) { failures += 1; return route.fulfill({ status: 503, json: { detail: 'Audit transient config failure' } }); }
    return route.continue();
  });
  await page.goto(`/chat?conversation=${conversation.id}`);
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
  await expect.poll(() => failures).toBeGreaterThan(0);
  failConfig = false;
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  const config = await (await page.request.get('/api/v1/chat/config')).json();
  expect(config.scheduled_messages_enabled).toBe(true);
  await page.getByTestId('chat-composer-textarea').fill('Send this later after recovery');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click({ button: 'right' });
  await expect(page.getByTestId('chat-send-later-menu-item')).toBeVisible();
});

test('control: restored config in a fresh tab shows send-later', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  const { conversation } = await seed(page);
  const config = await (await page.request.get('/api/v1/chat/config')).json();
  expect(config.scheduled_messages_enabled).toBe(true);
  await page.goto(`/chat?conversation=${conversation.id}`);
  await page.getByTestId('chat-composer-textarea').fill('A fresh tab can schedule this');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click({ button: 'right' });
  await expect(page.getByTestId('chat-send-later-menu-item')).toBeVisible();
});
