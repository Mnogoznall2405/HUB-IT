import { test, expect } from '@playwright/test';

// Replay a delayed enriched message through the real app's WebSocket boundary.
// The local backend handles login, membership and persistence; mail is never sent.
test.skip(process.env.E2E_LOCAL !== '1', 'requires the isolated local stack');

async function login(page, username, password) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByTestId('main-layout-content')).toBeVisible();
}

test('a delayed draft card enriches the same message without reload or duplication', async ({ browser }) => {
  const receiver = await browser.newContext();
  const sender = await browser.newContext();
  const page = await receiver.newPage();
  const senderPage = await sender.newPage();
  const text = `Подготовил черновик ${Date.now()}`;
  let socketRoute;
  let originalFrame;
  let enrichedFrame;
  let connected = false;
  try {
    await page.routeWebSocket('**/api/v1/chat/ws**', (socket) => {
      socketRoute = socket;
      const server = socket.connectToServer();
      server.onMessage((data) => {
        let frame;
        try { frame = JSON.parse(String(data)); } catch { socket.send(data); return; }
        if (frame.type === 'chat.connected') connected = true;
        if (frame.type === 'chat.message.created' && frame.payload?.body === text) {
          if (originalFrame) return; // Room and inbox may deliver the same row.
          originalFrame = frame;
          enrichedFrame = {
            ...frame,
            payload: {
              ...frame.payload,
              action_card: {
                id: 'replay-draft', action_type: 'office.mail.send', status: 'pending',
                preview: {
                  title: 'Отправка письма', summary: 'Добавление почты в ЗУП',
                  mail: { to: ['recipient@example.test'], subject: 'ЗУП', body: 'Добавьте employee@example.test' },
                },
              },
            },
          };
          socket.send(JSON.stringify({ ...frame, payload: { ...frame.payload, action_card: null } }));
          return;
        }
        socket.send(data);
      });
    });
    await login(page, process.env.E2E_USERNAME, process.env.E2E_PASSWORD);
    await login(senderPage, process.env.E2E_USERNAME2, process.env.E2E_PASSWORD2);
    const usersResponse = await page.request.get('/api/v1/chat/users');
    const users = await usersResponse.json();
    const peer = (users.items || users).find((user) => user.username === process.env.E2E_USERNAME2);
    expect(peer).toBeTruthy();
    const direct = await page.request.post('/api/v1/chat/conversations/direct', { data: { peer_user_id: peer.id } });
    expect(direct.ok()).toBeTruthy();
    const conversation = await direct.json();
    await page.goto(`/chat?conversation=${encodeURIComponent(conversation.id)}`);
    await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
    await expect.poll(() => connected).toBe(true);
    const sent = await senderPage.request.post(`/api/v1/chat/conversations/${conversation.id}/messages`, {
      data: { body: text },
    });
    expect(sent.ok()).toBeTruthy();
    await expect.poll(() => Boolean(originalFrame)).toBe(true);
    const bubble = page.getByTestId('chat-thread-content').locator(`[data-message-id="${originalFrame.payload.id}"]`);
    await expect(bubble).toHaveCount(1);
    await expect(bubble.getByText(text, { exact: true })).toBeVisible();
    await expect(bubble.getByTestId('chat-ai-action-card')).toHaveCount(0);

    socketRoute.send(JSON.stringify(enrichedFrame));
    await expect(bubble.getByTestId('chat-ai-action-card')).toBeVisible();
    await expect(bubble.getByRole('button', { name: 'Подтвердить и отправить', exact: true })).toBeVisible();
    await expect(bubble).toHaveCount(1);

    // A late lean duplicate must preserve the card already shown.
    socketRoute.send(JSON.stringify({ ...originalFrame, payload: { ...originalFrame.payload, payload_mode: 'lean', action_card: null } }));
    await expect(bubble.getByTestId('chat-ai-action-card')).toBeVisible();
    // A full update to the same card must also arrive (e.g. cancellation).
    socketRoute.send(JSON.stringify({ ...enrichedFrame, payload: {
      ...enrichedFrame.payload, action_card: { ...enrichedFrame.payload.action_card, status: 'cancelled' },
    } }));
    await expect(bubble.getByRole('button', { name: 'Подтвердить и отправить', exact: true })).toHaveCount(0);
    await expect(bubble.getByTestId('chat-ai-action-card')).toBeVisible();
    await expect(bubble).toHaveCount(1);
  } finally {
    await receiver.close();
    await sender.close();
  }
});
