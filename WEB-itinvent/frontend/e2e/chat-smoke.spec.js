import { test, expect } from '@playwright/test';

// Golden-path smoke: real browser, real login, real /chat page.
// Credentials come from env — nothing is committed.
// The message-send step is opt-in (E2E_SEND=1) because it writes real data.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const CAN_SEND = process.env.E2E_SEND === '1';

test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeHidden();
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

test('login opens the app shell', async ({ page }) => {
  await login(page);
  await expect(page.locator('body')).not.toContainText('Неверное имя пользователя');
});

test('chat page renders sidebar and composer', async ({ page }) => {
  await login(page);
  await page.goto('/chat');
  const sidebar = page.getByTestId('chat-sidebar-list-scroll');
  await expect(sidebar).toBeVisible();

  const firstRow = sidebar.locator('[role="button"], button, li').first();
  if (await firstRow.count()) {
    await firstRow.click();
    await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
  }
});

test('send a text message', async ({ page }) => {
  test.skip(!CAN_SEND, 'set E2E_SEND=1 to write to the real backend');
  await login(page);

  // On the local stack there may be zero conversations yet — create a direct
  // one through the real API so the send step is self-sufficient.
  let targetTitle = null;
  if (process.env.E2E_LOCAL === '1' && process.env.E2E_USERNAME2) {
    const usersResponse = await page.request.get('/api/v1/chat/users');
    const users = await usersResponse.json();
    const peer = (users.items || users).find((u) => u.username === process.env.E2E_USERNAME2);
    if (peer) {
      await page.request.post('/api/v1/chat/conversations/direct', {
        data: { peer_user_id: peer.id },
      });
      targetTitle = peer.full_name;
    }
  }

  await page.goto('/chat');
  const sidebar = page.getByTestId('chat-sidebar-list-scroll');
  if (targetTitle) {
    // click() auto-waits — a missing row here is a real failure, not a skip.
    await sidebar.getByText(targetTitle).first().click();
  } else {
    const firstRow = sidebar.locator('[role="button"], button, li').first();
    test.skip(!(await firstRow.count()), 'no conversations available');
    await firstRow.click();
  }

  const text = `e2e smoke ${new Date().toISOString()}`;
  await page.getByTestId('chat-composer-textarea').fill(text);
  await page.getByTestId('chat-composer-send-button').click();
  await expect(page.getByText(text).last()).toBeVisible();
});
