import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Long-history thread against the local stack (E2E_LOCAL=1 only: the history
// is bulk-inserted straight into the throwaway SQLite chat DB in
// e2e/stack/.state — sending thousands of messages through the API would take
// minutes).
//
//   bounded DOM  — paging thousands of messages up keeps at most one render
//                  window of bubbles mounted (history stays in state)
//   anchor       — loading a history page / mounting a hidden part of the
//                  window keeps the message under the viewer in place
//   jump         — "к последним" returns to the newest message
//   deep link    — ?message= to an old message outside the render window

const U1 = process.env.E2E_USERNAME;
const P1 = process.env.E2E_PASSWORD;
const U2 = process.env.E2E_USERNAME2;

test.skip(process.env.E2E_LOCAL !== '1' || !(U1 && P1 && U2), 'seeds the local SQLite stack directly: run with E2E_LOCAL=1');

const TOTAL = 2000;
// CHAT_RENDER_WINDOW_MAX in src/lib/chat/chatThreadRenderWindow.js.
const RENDER_WINDOW_MAX = 240;
const HISTORY_PAGES_TO_LOAD = 14;
const CHAT_DB_PATH = fileURLToPath(new URL('./stack/.state/chat.sqlite3', import.meta.url));

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

const WORDS = 'офис принтер картридж сервер заявка склад отчёт задача договор сеть ноутбук монитор пароль доступ'.split(' ');
const bodyFor = (index) => {
  const words = Array.from({ length: 3 + ((index * 7919) % 50) }, (_, k) => WORDS[(index + k * 13) % WORDS.length]);
  let text = `msg-${String(index).padStart(5, '0')} ${words.join(' ')}`;
  if (index % 11 === 0) text += '\nвторая строка\nтретья строка';
  return text;
};
const sqliteTimestamp = (ms) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '000');

async function seedLongConversation(request) {
  const { DatabaseSync } = await import('node:sqlite');
  const users = await (await request.get('/api/v1/chat/users')).json();
  const peer = (users.items || users).find((user) => user.username === U2);
  expect(peer, `peer ${U2} not in chat users`).toBeTruthy();
  const me = await (await request.get('/api/v1/auth/me')).json();
  const created = await request.post('/api/v1/chat/conversations/group', {
    data: { title: `E2E длинная история ${Date.now().toString(36)}`, member_user_ids: [peer.id] },
  });
  expect(created.ok()).toBeTruthy();
  const conversationId = (await created.json()).id;

  const messageIds = [];
  const startedAt = Date.now() - TOTAL * 90_000 - 3_600_000;
  const db = new DatabaseSync(CHAT_DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 10000');
    const insert = db.prepare(`INSERT INTO chat_messages (id, conversation_id, sender_user_id, kind,
      body_format, body, conversation_seq, client_message_id, reply_to_message_id, created_at, is_deleted)
      VALUES (?, ?, ?, 'text', 'plain', ?, ?, ?, ?, ?, 0)`);
    db.exec('BEGIN');
    for (let index = 0; index < TOTAL; index += 1) {
      const id = crypto.randomUUID();
      messageIds.push(id);
      const senderId = Math.floor(index / 3) % 2 === 0 ? Number(me.id) : Number(peer.id);
      const replyTo = index % 53 === 0 && index > 200 ? messageIds[index - 150] : null;
      insert.run(id, conversationId, senderId, bodyFor(index), index + 1, `e2e-long-${conversationId}-${index}`,
        replyTo, sqliteTimestamp(startedAt + index * 90_000));
    }
    db.prepare('UPDATE chat_conversations SET last_message_id = ?, last_message_seq = ?, last_message_at = ? WHERE id = ?')
      .run(messageIds[TOTAL - 1], TOTAL, sqliteTimestamp(startedAt + (TOTAL - 1) * 90_000), conversationId);
    db.exec('COMMIT');
  } finally {
    db.close();
  }

  // The newest message goes through the real API: next seq, caches, previews.
  const last = await request.post(`/api/v1/chat/conversations/${conversationId}/messages`, {
    data: { body: 'msg-final последнее сообщение', client_message_id: `e2e-long-final-${Date.now()}` },
  });
  expect(last.ok()).toBeTruthy();
  return { conversationId, messageIds };
}

const threadState = (page) => page.evaluate(() => {
  const content = document.querySelector('[data-testid="chat-thread-content"]');
  return {
    bubbles: content ? content.querySelectorAll('[data-message-id]').length : 0,
    hiddenOlder: Number(content?.getAttribute('data-hidden-older') || 0),
    hiddenNewer: Number(content?.getAttribute('data-hidden-newer') || 0),
    firstId: content?.querySelector('[data-message-id]')?.getAttribute('data-message-id') || '',
    loadingOlder: Boolean(content && content.textContent.includes('Загрузка истории')),
  };
});

// Scrolls the thread to `scrollTop` and returns the message that sits under the
// viewer (first bubble at least 120 px below the top edge) with its position.
const scrollAndPickAnchor = (page, scrollTop) => page.evaluate((top) => {
  const scroll = document.querySelector('[data-testid="chat-thread-scroll"]');
  scroll.scrollTop = top;
  const scrollTopEdge = scroll.getBoundingClientRect().top;
  const node = [...scroll.querySelectorAll('[data-chat-message-id]')]
    .find((item) => item.getBoundingClientRect().top >= scrollTopEdge + 120);
  return { id: node.getAttribute('data-chat-message-id'), top: node.getBoundingClientRect().top };
}, scrollTop);

const anchorTop = (page, id) => page.evaluate((messageId) => (
  document.querySelector(`[data-chat-message-id="${messageId}"]`)?.getBoundingClientRect().top ?? null
), id);

test('long history: bounded DOM, stable anchor, jump to latest and deep link', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, U1, P1);
  const { conversationId, messageIds } = await seedLongConversation(page.request);

  let historyPages = 0;
  page.on('response', (response) => {
    if (response.url().includes('before_message_id=')) historyPages += 1;
  });

  await page.goto(`/chat?conversation=${conversationId}`);
  const thread = page.getByTestId('chat-thread-content');
  await expect(thread.getByText('msg-final последнее сообщение')).toBeVisible();

  // 1. Page the history up with the wheel (trusted events arm auto-loading).
  const scroll = page.getByTestId('chat-thread-scroll');
  const box = await scroll.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const deadline = Date.now() + 120_000;
  while (historyPages < HISTORY_PAGES_TO_LOAD && Date.now() < deadline) {
    await page.mouse.wheel(0, -5000);
    await page.waitForTimeout(200);
  }
  expect(historyPages).toBeGreaterThanOrEqual(HISTORY_PAGES_TO_LOAD);
  await expect.poll(async () => (await threadState(page)).loadingOlder).toBe(false);
  let state = await threadState(page);
  // ~24 + 14×50 messages are loaded, only one render window is mounted and the
  // newest part is unmounted below.
  expect(state.bubbles).toBeLessThanOrEqual(RENDER_WINDOW_MAX);
  expect(state.hiddenNewer).toBeGreaterThan(0);

  // 2. Network history page: the message under the viewer stays in place.
  expect(state.hiddenOlder).toBe(0);
  const loadEarlier = thread.getByRole('button', { name: 'Показать ранние сообщения', exact: true });
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => loadEarlier.evaluate((node) => {
    const viewport = node.closest('[data-testid="chat-thread-scroll"]').getBoundingClientRect();
    return node.parentElement.getBoundingClientRect().bottom <= viewport.top;
  })).toBe(true);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await expect.poll(async () => (await threadState(page)).loadingOlder).toBe(false);
  state = await threadState(page);
  expect(state.hiddenOlder).toBe(0);
  const pagesBefore = historyPages;
  const firstBefore = state.firstId;
  const nextHistoryPage = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === `/api/v1/chat/conversations/${conversationId}/messages`
      && url.searchParams.has('before_message_id')
      && response.status() === 200;
  });
  const networkAnchor = await scrollAndPickAnchor(page, 0);
  await nextHistoryPage;
  await expect.poll(() => historyPages).toBeGreaterThan(pagesBefore);
  await expect.poll(async () => (await threadState(page)).firstId).not.toBe(firstBefore);
  await page.waitForTimeout(300);
  expect(Math.abs((await anchorTop(page, networkAnchor.id)) - networkAnchor.top)).toBeLessThanOrEqual(2);
  expect((await threadState(page)).bubbles).toBeLessThanOrEqual(RENDER_WINDOW_MAX);

  // 3. Scroll down far enough for the window to slide: the top part unmounts.
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(40);
  }
  await expect.poll(async () => (await threadState(page)).hiddenOlder).toBeGreaterThan(0);
  state = await threadState(page);
  expect(state.bubbles).toBeLessThanOrEqual(RENDER_WINDOW_MAX);

  // 4. Mounting the hidden older part of the window (no network) keeps the
  //    anchor too.
  const hiddenOlderBefore = state.hiddenOlder;
  const localAnchor = await scrollAndPickAnchor(page, 200);
  await expect.poll(async () => (await threadState(page)).hiddenOlder).toBeLessThan(hiddenOlderBefore);
  await page.waitForTimeout(300);
  expect(Math.abs((await anchorTop(page, localAnchor.id)) - localAnchor.top)).toBeLessThanOrEqual(2);

  // 5. "К последним" goes back to the newest message from deep history.
  await page.getByTestId('chat-jump-to-latest').click();
  await expect(thread.getByText('msg-final последнее сообщение')).toBeInViewport();
  state = await threadState(page);
  expect(state.hiddenNewer).toBe(0);
  expect(state.bubbles).toBeLessThanOrEqual(RENDER_WINDOW_MAX);

  // 6. Deep link to an old message: it is loaded, but falls outside the
  //    render window that follows the tail — the window recentres on it.
  const targetIndex = TOTAL - 450;
  await page.goto(`/chat?conversation=${conversationId}&message=${messageIds[targetIndex]}`);
  const target = page.locator(`[data-chat-message-id="${messageIds[targetIndex]}"]`);
  await expect(target).toBeInViewport({ timeout: 30_000 });
  await expect(target).toContainText(`msg-${String(targetIndex).padStart(5, '0')}`);
  state = await threadState(page);
  expect(state.bubbles).toBeLessThanOrEqual(RENDER_WINDOW_MAX);
  expect(state.hiddenNewer).toBeGreaterThan(0);

  // 7. Sending while reading old history: the window returns to the tail and
  //    the own message is visible exactly once.
  const text = `e2e long-history send ${Date.now().toString(36)}`;
  await page.getByTestId('chat-composer-textarea').fill(text);
  await page.getByTestId('chat-composer-send-button').click();
  await expect(thread.getByText(text, { exact: true })).toBeInViewport();
  await page.waitForTimeout(1_000);
  await expect(thread.getByText(text, { exact: true })).toHaveCount(1);
  expect((await threadState(page)).hiddenNewer).toBe(0);
});
