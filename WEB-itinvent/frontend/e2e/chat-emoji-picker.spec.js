import { test, expect } from '@playwright/test';

// Emoji / sticker picker — Telegram Desktop поведение: hover-превью,
// клик → закреплённая колонка справа, узкий viewport → overlay.
// Креды из env; для самодостаточности диалог создаётся через API,
// как в chat-smoke.spec.js.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = 'e2e-artifacts/emoji-picker';

test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

async function apiLogin(page) {
  const resp = await page.request.post('/api/v1/auth/login', {
    data: { username: USERNAME, password: PASSWORD },
  });
  expect(resp.ok()).toBeTruthy();
}

async function openConversation(page) {
  await apiLogin(page);
  // Гарантируем хотя бы одну переписку через реальный API — как в
  // chat-sidebar-modes.spec.js (куку ставит login через page.request).
  const usersResp = await page.request.get('/api/v1/chat/users?limit=50');
  if (usersResp.ok()) {
    const usersJson = await usersResp.json();
    const users = usersJson.items || usersJson.users || (Array.isArray(usersJson) ? usersJson : []);
    const peer = (Array.isArray(users) ? users : []).find(
      (u) => u.username === (process.env.E2E_USERNAME2 || 'e2e_admin'),
    );
    if (peer) {
      await page.request.post('/api/v1/chat/conversations/direct', {
        data: { peer_user_id: peer.id },
      });
    }
  }
  await page.goto('/chat');
  await expect(
    page.getByTestId('chat-sidebar-desktop-header').or(page.getByTestId('chat-sidebar-list-scroll')).first(),
  ).toBeVisible({ timeout: 30_000 });
  const rows = page.locator('[data-chat-active]');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await rows.first().click();
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
}

test('hover opens preview, leaving closes it; click pins the right dock', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page);

  const button = page.getByTestId('chat-composer-emoji-button');
  const popover = page.getByTestId('chat-desktop-emoji-panel');
  const dock = page.getByTestId('chat-emoji-dock');

  // Hover-задержка ~260ms: ждём появления поповера.
  await button.hover();
  await expect(popover).toBeVisible({ timeout: 5000 });
  await expect(dock).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/emoji-hover-preview.png` });

  // Курсор уходит в панель — не закрывается; уходит совсем — закрывается.
  await popover.hover();
  await expect(popover).toBeVisible();
  await page.mouse.move(600, 300);
  await expect(popover).toBeHidden({ timeout: 5000 });

  // Клик закрепляет колонку справа — поповер при этом не висит.
  await button.click();
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute('data-layout', 'column');
  await expect(popover).toBeHidden();
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/emoji-dock-column.png` });

  // Повторный клик закрывает.
  await button.click();
  await expect(dock).toBeHidden();
});

test('sequential emoji picks keep the dock open and extend the draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page);

  await page.getByTestId('chat-composer-emoji-button').click();
  const dock = page.getByTestId('chat-emoji-dock');
  await expect(dock).toBeVisible();

  const emojiButtons = dock.locator('.EmojiPickerReact button.epr-emoji');
  await expect(emojiButtons.first()).toBeVisible({ timeout: 15_000 });
  await emojiButtons.nth(0).click();
  await emojiButtons.nth(1).click();

  const textarea = page.getByTestId('chat-composer-textarea');
  const value = await textarea.inputValue();
  expect(value.length).toBeGreaterThanOrEqual(2);
  // Панель не закрылась после вставки — режим последовательного выбора.
  await expect(dock).toBeVisible();
});

test('narrow viewport falls back to overlay inside the thread column', async ({ page }) => {
  await page.setViewportSize({ width: 988, height: 838 });
  await openConversation(page);

  await page.getByTestId('chat-composer-emoji-button').click();
  const dock = page.getByTestId('chat-emoji-dock');
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute('data-layout', 'overlay');

  // Оверлей остаётся внутри viewport — горизонтального скролла нет.
  const box = await dock.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(988);
  await page.screenshot({ path: `${SHOTS}/emoji-dock-overlay-narrow.png` });
  await page.getByTestId('chat-emoji-dock-close').click();
  await expect(dock).toBeHidden();
});

test('sticker packs load once — reopen uses the session cache', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page);

  let listPackRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/chat/sticker-packs') && request.method() === 'GET') {
      listPackRequests += 1;
    }
  });

  const button = page.getByTestId('chat-composer-emoji-button');
  const dock = page.getByTestId('chat-emoji-dock');
  const stickersTab = dock.getByRole('tab', { name: 'Стикеры' });

  await button.click();
  await stickersTab.click();
  await expect(
    dock.locator('[data-sticker-section], .MuiAlert-root, :text("Добавьте первый набор")').first(),
  ).toBeVisible({ timeout: 15_000 });
  const requestsAfterFirstOpen = listPackRequests;

  await page.getByTestId('chat-emoji-dock-close').click();
  await button.click();
  await stickersTab.click();
  await page.waitForTimeout(1200);

  expect(requestsAfterFirstOpen).toBeLessThanOrEqual(1);
  expect(listPackRequests).toBe(requestsAfterFirstOpen);
});
