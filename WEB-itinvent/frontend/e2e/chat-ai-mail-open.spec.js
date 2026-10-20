import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'requires the isolated local stack');

for (const withMessageId of [true, false]) {
  test(`confirmed mail opens Sent ${withMessageId ? 'at the sent message' : 'without a message ID'}`, async ({ page: loginPage, context }) => {
    await loginPage.goto('/login');
    const form = loginPage.getByTestId('password-auth-form');
    await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
    await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
    await form.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(loginPage.getByTestId('main-layout-content')).toBeVisible();
    const page = await context.newPage();

    const usersResponse = await page.request.get('/api/v1/chat/users');
    const users = await usersResponse.json();
    const peer = (users.items || users).find(user => user.username === process.env.E2E_USERNAME2);
    const direct = await page.request.post('/api/v1/chat/conversations/direct', { data: { peer_user_id: peer.id } });
    expect(direct.ok()).toBeTruthy();
    const conversation = await direct.json();
    const sent = await page.request.post(`/api/v1/chat/conversations/${conversation.id}/messages`, {
      data: { body: `Отправленное письмо ${Date.now()}` },
    });
    expect(sent.ok()).toBeTruthy();
    const message = await sent.json();
    const card = {
      id: 'replay-sent-mail', action_type: 'office.mail.send', status: 'confirmed',
      preview: { title: 'Отправка письма', mail: { to: ['recipient@example.test'], subject: 'ЗУП' } },
      result: { ok: true, mailbox_id: 'mailbox 1', ...(withMessageId ? { message_id: 'sent+message?/42' } : {}) },
    };
    // Replay only the mail result at the HTTP boundary; no external mail is sent.
    await page.route('**/api/v1/chat/conversations/**', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      if (!(response.headers()['content-type'] || '').includes('application/json')) return route.fulfill({ response });
      const payload = await response.json();
      if (Array.isArray(payload.items)) payload.items = payload.items.map(item => item.id === conversation.id
        ? { ...item, kind: 'ai' }
        : item.id === message.id || item.message_id === message.id ? { ...item, action_card: card } : item);
      if (payload.conversation?.id === conversation.id) payload.conversation.kind = 'ai';
      return route.fulfill({ response, json: payload });
    });
    await page.goto(`/chat?conversation=${encodeURIComponent(conversation.id)}`);
    const bubble = page.getByTestId('chat-thread-content').locator(`[data-message-id="${message.id}"]`);
    const openMail = bubble.getByRole('button', { name: 'Открыть в почте', exact: true });
    await expect(openMail).toBeVisible();
    const openedPromise = context.waitForEvent('page', { timeout: 15000 });
    await openMail.click();
    const opened = await openedPromise;
    await expect(opened).toHaveURL(/\/mail\?/);
    const url = new URL(opened.url());
    expect(url.pathname).toBe('/mail');
    expect(url.searchParams.get('folder')).toBe('sent');
    expect(url.searchParams.get('mailbox_id')).toBe('mailbox 1');
    expect(url.searchParams.get('message')).toBe(withMessageId ? 'sent+message?/42' : null);
    await expect(page.getByRole('dialog').filter({ has: page.getByText('Редактировать письмо', { exact: true }) })).toHaveCount(0);
    await opened.close();
  });
}
