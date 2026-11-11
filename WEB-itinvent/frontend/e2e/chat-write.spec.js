import { test, expect } from '@playwright/test';

// Cross-user write flow against the local stack (E2E_LOCAL=1 auto-fills both
// seed users; on a deployed build it only runs if someone deliberately sets
// E2E_USERNAME2/E2E_PASSWORD2 — it creates a real conversation and message).
//
//   A (admin) opens a direct conversation with B, sends a message
//   B sees the unread badge, opens the thread, the badge clears
//   A sees the read receipt
//
// This is the browser-level twin of tests/test_e2e_chat_flow.py — the same
// golden path, through real UI instead of raw HTTP.

const U1 = process.env.E2E_USERNAME;
const P1 = process.env.E2E_PASSWORD;
const U2 = process.env.E2E_USERNAME2;
const P2 = process.env.E2E_PASSWORD2;

test.skip(!(U1 && P1 && U2 && P2), 'need two users: run with E2E_LOCAL=1 or set E2E_USERNAME2/E2E_PASSWORD2');

async function login(page, username, password) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeHidden();
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

function observeChatWebSockets(page) {
  const records = [];
  page.on('websocket', (socket) => {
    let parsed;
    try {
      parsed = new URL(socket.url());
    } catch {
      return;
    }
    if (parsed.pathname !== '/api/v1/chat/ws') return;
    const record = { socket, origin: parsed.host, received: [], sent: [] };
    const decode = (frame) => {
      const raw =
        typeof frame.payload === 'string' ? frame.payload : frame.payload?.toString('utf-8');
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return null;
      }
      return {
        type: data?.type,
        conversation_id: data?.conversation_id,
        request_id: data?.request_id,
        payload: {
          body: data?.payload?.body,
          id: data?.payload?.id,
          connection_id: data?.payload?.connection_id,
        },
      };
    };
    socket.on('framereceived', (frame) => {
      const decoded = decode(frame);
      if (decoded) record.received.push(decoded);
    });
    socket.on('framesent', (frame) => {
      const decoded = decode(frame);
      if (decoded) record.sent.push(decoded);
    });
    records.push(record);
  });
  return records;
}

function latestConnectedRecord(records) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    const connected = record.received.find((frame) => frame.type === 'chat.connected');
    if (connected) return { record, connected };
  }
  return null;
}

function findReceivedFrame(records, predicate) {
  for (const record of records) {
    const frame = record.received.find(predicate);
    if (frame) return { record, frame };
  }
  return null;
}

test('message reaches the peer, unread badge clears on read, sender sees receipt', async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);

    // Resolve the peer and open a direct conversation through the real API
    // so the test does not depend on seeded chat data.
    const usersResponse = await pageA.request.get('/api/v1/chat/users');
    expect(usersResponse.ok()).toBeTruthy();
    const users = await usersResponse.json();
    const peer = (users.items || users).find((u) => u.username === U2);
    expect(peer, `peer ${U2} not in chat users`).toBeTruthy();

    const direct = await pageA.request.post('/api/v1/chat/conversations/direct', {
      data: { peer_user_id: peer.id },
    });
    expect(direct.ok()).toBeTruthy();
    const conversation = await direct.json();
    const conversationId = conversation.id;

    // A sends the message through the real composer.
    await pageA.goto('/chat');
    const sidebarA = pageA.getByTestId('chat-sidebar-list-scroll');
    await sidebarA.getByText('E2E Пользователь').first().click();
    const text = `e2e write ${new Date().toISOString()}`;
    await pageA.getByTestId('chat-composer-textarea').fill(text);
    await pageA.getByTestId('chat-composer-send-button').click();
    await expect(pageA.getByText(text).last()).toBeVisible();

    // B sees the conversation with an unread badge, opens it, badge clears.
    await pageB.goto('/chat');
    const sidebarB = pageB.getByTestId('chat-sidebar-list-scroll');
    const unreadBadge = pageB.getByTestId(`chat-unread-badge-${conversationId}`);
    await expect(unreadBadge).toBeVisible();
    await sidebarB.getByText('E2E Админ').first().click();
    await expect(pageB.getByText(text).last()).toBeVisible();
    await expect(unreadBadge).toBeHidden({ timeout: 20_000 });

    // A eventually sees the read receipt (delivery ticks + realtime push);
    // reload so the sidebar refetches the latest receipt state.
    await pageA.reload();
    await expect(pageA.getByTestId('sidebar-delivery-read')).toBeVisible({ timeout: 30_000 });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('file attachment sent through the upload dialog reaches the peer', async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);

    const usersResponse = await pageA.request.get('/api/v1/chat/users');
    expect(usersResponse.ok()).toBeTruthy();
    const users = await usersResponse.json();
    const peer = (users.items || users).find((u) => u.username === U2);
    expect(peer, `peer ${U2} not in chat users`).toBeTruthy();

    const direct = await pageA.request.post('/api/v1/chat/conversations/direct', {
      data: { peer_user_id: peer.id },
    });
    expect(direct.ok()).toBeTruthy();

    // A attaches a file through the real composer input and confirms in the
    // upload dialog.
    await pageA.goto('/chat');
    const sidebarA = pageA.getByTestId('chat-sidebar-list-scroll');
    await sidebarA.getByText('E2E Пользователь').first().click();

    const fileName = `e2e-note-${Date.now()}.txt`;
    await pageA.getByTestId('chat-file-input').setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('e2e attachment payload\n'),
    });
    await expect(pageA.getByTestId('chat-file-upload-panel')).toBeVisible();
    await pageA.getByTestId('file-dialog-send').click();
    await expect(pageA.getByText(fileName).last()).toBeVisible({ timeout: 30_000 });

    // B opens the same thread and sees the attachment.
    await pageB.goto('/chat');
    const sidebarB = pageB.getByTestId('chat-sidebar-list-scroll');
    await sidebarB.getByText('E2E Админ').first().click();
    await expect(pageB.getByText(fileName).last()).toBeVisible({ timeout: 30_000 });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('messages arrive through the proxied WebSocket before and after reload', async ({
  browser,
}) => {
  test.skip(process.env.E2E_LOCAL !== '1', 'proxied websocket flow requires the isolated local stack');
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const socketsA = observeChatWebSockets(pageA);
  const socketsB = observeChatWebSockets(pageB);

  try {
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);

    const usersResponse = await pageA.request.get('/api/v1/chat/users');
    expect(usersResponse.ok()).toBeTruthy();
    const users = await usersResponse.json();
    const peer = (users.items || users).find((u) => u.username === U2);
    expect(peer, `peer ${U2} not in chat users`).toBeTruthy();

    const direct = await pageA.request.post('/api/v1/chat/conversations/direct', {
      data: { peer_user_id: peer.id },
    });
    expect(direct.ok()).toBeTruthy();
    const conversation = await direct.json();
    const conversationId = conversation.id;

    await pageA.goto('/chat');
    await pageB.goto('/chat');

    await expect
      .poll(() => latestConnectedRecord(socketsA) !== null, { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(() => latestConnectedRecord(socketsB) !== null, { timeout: 20_000 })
      .toBe(true);

    const connectedA = latestConnectedRecord(socketsA);
    const connectedB = latestConnectedRecord(socketsB);
    expect(connectedA.record.origin).toBe(new URL(pageA.url()).host);
    expect(connectedB.record.origin).toBe(new URL(pageB.url()).host);

    const sidebarA = pageA.getByTestId('chat-sidebar-list-scroll');
    await sidebarA.getByText('E2E Пользователь', { exact: true }).click();
    const sidebarB = pageB.getByTestId('chat-sidebar-list-scroll');
    await sidebarB.getByText('E2E Админ', { exact: true }).click();

    const subscribedWithAck = (record) =>
      record.sent.some(
        (frame) =>
          frame.type === 'chat.subscribe_conversation' &&
          frame.conversation_id === conversationId,
      ) &&
      record.received.some(
        (frame) => frame.type === 'chat.command.ok' && frame.conversation_id === conversationId,
      );

    await expect
      .poll(() => socketsA.some(subscribedWithAck), { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(() => socketsB.some(subscribedWithAck), { timeout: 20_000 })
      .toBe(true);

    const sendText = async (text) => {
      await pageA.getByTestId('chat-composer-textarea').fill(text);
      await pageA.getByTestId('chat-composer-send-button').click();
    };
    const awaitCreatedFrame = async (getRecords, text) => {
      const predicate = (frame) =>
        frame.type === 'chat.message.created' &&
        frame.conversation_id === conversationId &&
        frame.payload.body === text &&
        frame.payload.id;
      await expect
        .poll(() => findReceivedFrame(getRecords(), predicate) !== null, { timeout: 20_000 })
        .toBe(true);
      return findReceivedFrame(getRecords(), predicate);
    };

    const text1 = `e2e ws ${new Date().toISOString()}`;
    await sendText(text1);
    const created1 = await awaitCreatedFrame(() => socketsB, text1);
    expect(created1.record.origin).toBe(new URL(pageB.url()).host);
    const messageId1 = created1.frame.payload.id;

    const threadB = pageB.getByTestId('chat-thread-content');
    const bubble1 = threadB.locator(`[data-message-id="${messageId1}"]`);
    await expect(bubble1).toHaveCount(1);
    await expect(bubble1.getByText(text1)).toBeVisible();

    const beforeReloadRecords = new Set(socketsB);
    const beforeReloadConnectionIds = new Set(
      socketsB
        .flatMap((record) =>
          record.received
            .filter((frame) => frame.type === 'chat.connected')
            .map((frame) => frame.payload.connection_id),
        )
        .filter(Boolean),
    );
    const freshRecordsB = () => socketsB.filter((record) => !beforeReloadRecords.has(record));
    await pageB.reload();
    await sidebarB.getByText('E2E Админ', { exact: true }).click();

    await expect
      .poll(
        () => latestConnectedRecord(freshRecordsB()),
        { timeout: 20_000 },
      )
      .not.toBeNull();
    const reconnectedB = latestConnectedRecord(freshRecordsB());
    expect(reconnectedB.connected.payload.connection_id).toBeTruthy();
    expect(beforeReloadConnectionIds.has(reconnectedB.connected.payload.connection_id)).toBe(false);
    expect(reconnectedB.record.origin).toBe(new URL(pageB.url()).host);
    await expect
      .poll(() => freshRecordsB().some(subscribedWithAck), { timeout: 20_000 })
      .toBe(true);

    const text2 = `e2e ws after reload ${new Date().toISOString()}`;
    await sendText(text2);
    const created2 = await awaitCreatedFrame(freshRecordsB, text2);
    expect(created2.record.origin).toBe(new URL(pageB.url()).host);
    const messageId2 = created2.frame.payload.id;

    await expect(threadB.locator(`[data-message-id="${messageId1}"]`)).toHaveCount(1);
    const bubble2 = threadB.locator(`[data-message-id="${messageId2}"]`);
    await expect(bubble2).toHaveCount(1);
    await expect(bubble2.getByText(text2)).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
