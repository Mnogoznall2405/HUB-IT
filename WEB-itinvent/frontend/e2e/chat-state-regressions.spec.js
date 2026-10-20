import { test, expect } from '@playwright/test';

// Real application + isolated local API, using native pointer actions.
test.skip(process.env.E2E_LOCAL !== '1', 'writes only to the isolated local stack');

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
  await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByTestId('main-layout-content')).toBeVisible();
}

// Use the authenticated session in a fresh tab. On this Windows host Chrome
// drops native input in the tab that submitted login, including after its DOM
// is replaced; a fresh tab receives real pointer events. No handlers are stubbed.
async function openAuthenticatedTab(loginPage) {
  await login(loginPage);
  return loginPage.context().newPage();
}

async function seedThread(page) {
  const users = await (await page.request.get('/api/v1/chat/users')).json();
  const peer = (users.items || users).find(user => user.username === process.env.E2E_USERNAME2);
  const created = await page.request.post('/api/v1/chat/conversations/group', {
    data: { title: `State regression ${Date.now()}`, member_user_ids: [peer.id] },
  });
  expect(created.ok(), `Group seed HTTP ${created.status()}`).toBeTruthy();
  const conversation = await created.json();
  const messages = [];
  for (const body of ['Original message must stay unchanged', 'Question to answer']) {
    const sent = await page.request.post(`/api/v1/chat/conversations/${conversation.id}/messages`, { data: { body } });
    expect(sent.ok()).toBeTruthy(); messages.push(await sent.json());
  }
  return { conversation, messages };
}

async function openMenu(page, messageId) {
  const message = page.getByTestId('chat-thread-content').locator(`[data-message-id="${messageId}"] [data-chat-message-id]`);
  await expect(message).toBeVisible();
  await message.locator('[data-chat-bubble-surface="true"]').hover();
  await message.getByRole('button', { name: 'Действия', exact: true }).click();
  await expect(page.getByTestId('chat-message-context-menu')).toBeVisible();
  return page.getByTestId('chat-message-context-menu');
}

test('selected reply after editing sends a reply and leaves the original message intact', async ({ page: loginPage }) => {
  const page = await openAuthenticatedTab(loginPage);
  const { conversation, messages } = await seedThread(page);
  await page.goto(`/chat?conversation=${encodeURIComponent(conversation.id)}`);
  const editMenu = await openMenu(page, messages[0].id);
  await editMenu.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
  const selectMenu = await openMenu(page, messages[1].id);
  await selectMenu.getByRole('menuitem', { name: 'Выделить', exact: true }).click();
  await page.getByTestId('chat-selection-reply-action').click();
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
  await page.getByTestId('chat-composer-textarea').fill('Actual new reply');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  let items;
  await expect.poll(async () => {
    items = (await (await page.request.get(`/api/v1/chat/conversations/${conversation.id}/messages`)).json()).items;
    return items.filter(item => item.body === 'Actual new reply').length;
  }).toBe(1);
  expect(items.find(item => item.id === messages[0].id).body).toBe('Original message must stay unchanged');
  expect(items.find(item => item.body === 'Actual new reply').reply_preview?.id).toBe(messages[1].id);
});

test('failed unpin keeps the real server pin visible', async ({ page: loginPage }) => {
  const page = await openAuthenticatedTab(loginPage);
  const { conversation, messages } = await seedThread(page);
  const pinned = await page.request.put(`/api/v1/chat/conversations/${conversation.id}/pinned-message`, { data: { message_id: messages[0].id } });
  expect(pinned.ok()).toBeTruthy();
  await page.route('**/api/v1/chat/conversations/*/pinned-message', route => route.fulfill({ status: 503, json: { detail: 'Temporary pin failure' } }));
  await page.goto(`/chat?conversation=${encodeURIComponent(conversation.id)}`);
  const pin = page.getByTestId('chat-pinned-message-open');
  await expect(pin).toBeVisible();
  await page.getByTestId('chat-pinned-message-close').click();
  await expect(page.getByText('Temporary pin failure', { exact: true })).toBeVisible();
  await expect(pin).toBeVisible();
  const persisted = await (await page.request.get(`/api/v1/chat/conversations/${conversation.id}`)).json();
  expect(persisted.pinned_message_id).toBe(messages[0].id);
});

test('scheduled-list errors are visible and never presented as an empty queue', async ({ page: loginPage }) => {
  const page = await openAuthenticatedTab(loginPage);
  const config = await (await page.request.get('/api/v1/chat/config')).json();
  await page.route('**/api/v1/chat/config**', route => route.fulfill({ json: { ...config, scheduled_messages_enabled: true } }));
  await page.route('**/api/v1/chat/conversations/*/scheduled', route => route.fulfill({ status: 503, json: { detail: 'Scheduled list unavailable' } }));
  const { conversation } = await seedThread(page);
  await page.goto(`/chat?conversation=${encodeURIComponent(conversation.id)}`);
  const bar = page.getByTestId('chat-scheduled-bar');
  await expect(bar).toHaveText('Scheduled list unavailable');
  await bar.click();
  const dialog = page.getByRole('dialog', { name: 'Запланированные сообщения' });
  await expect(dialog.getByRole('alert')).toHaveText('Scheduled list unavailable');
  await expect(dialog.getByText('Запланированных сообщений нет.', { exact: true })).toHaveCount(0);
});
