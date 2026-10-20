import { test, expect } from '@playwright/test';

// Chat realtime delivery against the local stack (E2E_LOCAL=1 auto-fills both
// seed users; on a deployed build it only runs if someone deliberately sets
// E2E_USERNAME2/E2E_PASSWORD2 — it writes real messages).
//
//   realtime         — A → B messages arrive as WS `chat.message.created`
//                      frames, well under the ~2.5 s fallback-polling cadence
//   receiver offline — B drops off the network, A keeps writing; on reconnect
//                      B catches up with every message exactly once
//   sender offline   — A sends while offline, sees the failed marker; on
//                      reconnect the message goes out by itself, exactly once

const U1 = process.env.E2E_USERNAME;
const P1 = process.env.E2E_PASSWORD;
const U2 = process.env.E2E_USERNAME2;
const P2 = process.env.E2E_PASSWORD2;

test.skip(!(U1 && P1 && U2 && P2), 'need two users: run with E2E_LOCAL=1 or set E2E_USERNAME2/E2E_PASSWORD2');

// Soft click→visible budget for the peer. Local SQLite stack measures ~250 ms;
// fallback polling would land at ~2.5 s, so 1.5 s still proves the WS path while
// leaving headroom for a loaded CI host.
const REALTIME_P95_BUDGET_MS = 1_500;
const REALTIME_SAMPLES = 5;

// Long enough for at least one 25 s heartbeat cycle to fail while offline,
// so recovery goes through the real reconnect path, not a lucky live socket.
const RECEIVER_OFFLINE_MS = 30_000;

const CHAT_WS_PATH = '/api/v1/chat/ws';

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

const uniqueToken = (label) => `rt-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Scope to the open thread: the sidebar preview repeats the last message text.
const inThread = (page, token) => page.getByTestId('chat-thread-content').getByText(token, { exact: true });

async function sendFromComposer(page, text) {
  await page.getByTestId('chat-composer-textarea').fill(text);
  await page.getByTestId('chat-composer-send-button').click();
}

// Records inbound chat WS frames of a page: [{ at, type, raw }].
function recordChatFrames(page) {
  const frames = [];
  const sockets = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes(CHAT_WS_PATH)) return;
    sockets.push(ws);
    ws.on('framereceived', (frame) => {
      const raw = String(frame.payload || '');
      let type = '';
      try {
        type = String(JSON.parse(raw)?.type || '');
      } catch {
        // Non-JSON frame — irrelevant here.
      }
      frames.push({ at: Date.now(), type, raw });
    });
  });
  return { frames, sockets };
}

// Logs both users in, opens a direct conversation through the API and puts
// both pages on it, with one message already delivered so the threads are live.
async function openPair(browser, { beforeOpenB } = {}) {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const recorderB = beforeOpenB ? beforeOpenB(pageB) : null;

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
  const conversationId = (await direct.json()).id;

  await pageA.goto(`/chat?conversation=${conversationId}`);
  await pageA.getByTestId('chat-composer-textarea').waitFor();
  const warmup = uniqueToken('warmup');
  await sendFromComposer(pageA, warmup);
  await expect(inThread(pageA, warmup)).toBeVisible();

  await pageB.goto(`/chat?conversation=${conversationId}`);
  await pageB.getByTestId('chat-composer-textarea').waitFor();
  await expect(inThread(pageB, warmup)).toBeVisible();

  return { contextA, contextB, pageA, pageB, recorderB };
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
};

test('messages reach the peer over the chat websocket within the latency budget', async ({ browser }) => {
  test.setTimeout(120_000);
  const pair = await openPair(browser, { beforeOpenB: recordChatFrames });
  const { contextA, contextB, pageA, pageB } = pair;
  const { frames, sockets } = pair.recorderB;

  try {
    // B must hold an established chat socket before we time anything.
    await expect.poll(() => sockets.some((ws) => !ws.isClosed()), {
      message: 'peer page never opened the chat websocket (is the WS upgrade proxied?)',
    }).toBe(true);

    const latencies = [];
    for (let i = 0; i < REALTIME_SAMPLES; i += 1) {
      const token = uniqueToken(`live${i}`);
      await pageA.getByTestId('chat-composer-textarea').fill(token);
      const startedAt = Date.now();
      await pageA.getByTestId('chat-composer-send-button').click();
      await expect(inThread(pageB, token)).toBeVisible({ timeout: 10_000 });
      latencies.push(Date.now() - startedAt);

      const created = frames.filter((f) => f.type === 'chat.message.created' && f.raw.includes(token));
      expect(created.length, `no chat.message.created WS frame for ${token}`).toBeGreaterThan(0);
      await expect(inThread(pageB, token)).toHaveCount(1);
    }

    const p95 = percentile(latencies, 95);
    test.info().annotations.push({ type: 'latency-ms', description: latencies.join(', ') });
    expect(p95, `click→visible latencies: ${latencies.join(', ')} ms`).toBeLessThan(REALTIME_P95_BUDGET_MS);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('offline receiver catches up with every missed message exactly once', async ({ browser }) => {
  test.setTimeout(150_000);
  const { contextA, contextB, pageA, pageB } = await openPair(browser);

  try {
    await contextB.setOffline(true);
    const tokens = [];
    for (let i = 0; i < 3; i += 1) {
      const token = uniqueToken(`boff${i}`);
      tokens.push(token);
      await sendFromComposer(pageA, token);
      await expect(inThread(pageA, token)).toBeVisible();
    }
    await pageB.waitForTimeout(RECEIVER_OFFLINE_MS);
    for (const token of tokens) {
      await expect(inThread(pageB, token)).toHaveCount(0);
    }

    await contextB.setOffline(false);
    for (const token of tokens) {
      await expect(inThread(pageB, token)).toBeVisible({ timeout: 40_000 });
    }
    // Catch-up history + live frames must not double-render.
    await pageB.waitForTimeout(2_000);
    for (const token of tokens) {
      await expect(inThread(pageB, token)).toHaveCount(1);
    }
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('message sent while the sender is offline goes out on reconnect exactly once', async ({ browser }) => {
  test.setTimeout(150_000);
  const { contextA, contextB, pageA, pageB } = await openPair(browser);

  try {
    await contextA.setOffline(true);
    const token = uniqueToken('aoff');
    await sendFromComposer(pageA, token);
    await expect(inThread(pageA, token)).toBeVisible();
    await expect(pageA.getByLabel('Сообщение не отправлено')).toBeVisible({ timeout: 20_000 });

    // No manual retry: reconnect alone must deliver it.
    await contextA.setOffline(false);
    await expect(inThread(pageB, token)).toBeVisible({ timeout: 40_000 });
    await expect(pageA.getByLabel('Сообщение не отправлено')).toHaveCount(0, { timeout: 20_000 });

    await pageA.waitForTimeout(2_000);
    await expect(inThread(pageA, token)).toHaveCount(1);
    await expect(inThread(pageB, token)).toHaveCount(1);

    await pageA.reload();
    await pageA.getByTestId('chat-composer-textarea').waitFor();
    await expect(inThread(pageA, token)).toBeVisible();
    await pageA.waitForTimeout(1_000);
    await expect(inThread(pageA, token)).toHaveCount(1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
