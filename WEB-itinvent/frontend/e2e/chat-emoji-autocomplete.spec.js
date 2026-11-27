import { test, expect } from '@playwright/test';

// Issue #82 — автоподсказка эмодзи по `:keyword` в композере и поиск
// стикеров по полному CLDR-словарю (Telegram Desktop parity).
// Прогон на локальном seed: e2e_test_pack (3 webp, все 🧪) + e2e_big_pack
// (90, ротация эмодзи), установлены каждому пользователю через
// CHAT_DEFAULT_STICKER_PACKS (local_backend.py).
//
// Ключевая дискриминация CLDR-индекса: 🧪 ОТСУТСТВУЕТ в ручном словаре
// STICKER_EMOJI_KEYWORDS — до полного индекса «пробирка» не находила
// ничего, после — находит стикеры тест-набора. То же для «умора» (😂).
// Креды из env; беседа открывается напрямую по /chat?conversation=<id>.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const USERNAME2 = process.env.E2E_USERNAME2;
const PASSWORD2 = process.env.E2E_PASSWORD2;

test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');
test.use({ actionTimeout: 20_000 });
test.describe.configure({ mode: 'serial' });

async function apiLogin(page, username = USERNAME, password = PASSWORD) {
  const resp = await page.request.post('/api/v1/auth/login', {
    data: { username, password },
  });
  expect(resp.ok()).toBeTruthy();
}

async function findUserId(page, username) {
  const usersResp = await page.request.get('/api/v1/chat/users?limit=50');
  if (!usersResp.ok()) return null;
  const usersJson = await usersResp.json();
  const users = usersJson.items || usersJson.users || (Array.isArray(usersJson) ? usersJson : []);
  return (Array.isArray(users) ? users : []).find((u) => u.username === username)?.id || null;
}

async function ensureDirectConversation(page, peerUsername) {
  const peerId = await findUserId(page, peerUsername);
  if (!peerId) return null;
  const resp = await page.request.post('/api/v1/chat/conversations/direct', {
    data: { peer_user_id: peerId },
  });
  if (!resp.ok()) return null;
  const json = await resp.json();
  return json.id || json.conversation_id || null;
}

async function openConversationDirect(page, conversationId) {
  await page.goto(`/chat?conversation=${conversationId}`);
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 30_000 });
}

async function openStickersTab(page) {
  await page.getByTestId('chat-composer-emoji-button').click();
  const dock = page.getByTestId('chat-emoji-dock');
  await expect(dock).toBeVisible();
  await dock.getByRole('tab', { name: 'Стикеры' }).click();
  await expect(
    dock.locator('[data-testid="chat-sticker-sections-scroll"], .MuiAlert-root, :text("Добавьте первый набор")').first(),
  ).toBeVisible({ timeout: 20_000 });
  return dock;
}

// ── Автоподсказка эмодзи: полный пользовательский сценарий ─────────────
test('composer :keyword autocomplete inserts emoji and the message sends', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  expect(convId, 'direct conversation id').toBeTruthy();
  await openConversationDirect(page, convId);

  const composer = page.getByTestId('chat-composer-textarea');
  const list = page.getByTestId('chat-emoji-suggestions');

  // Один символ после двоеточия подсказку не открывает (порог Telegram).
  await composer.click();
  await composer.pressSequentially(':с', { delay: 30 });
  await expect(list).toHaveCount(0);

  // «:сов» — список с совой первой (CLDR reverse-поиск, RU-ключевые слова).
  await composer.pressSequentially('ов', { delay: 30 });
  await expect(list).toBeVisible({ timeout: 10_000 });
  const firstOption = list.getByRole('option').first();
  await expect(firstOption).toContainText('сова');
  // Выбор сразу активен — aria-связка композера.
  await expect(composer).toHaveAttribute('aria-expanded', 'true');

  // Enter вставляет эмодзи вместо «:сов», отправки сообщения не было.
  await composer.press('Enter');
  await expect(composer).toHaveValue('🦉 ');
  await expect(list).toHaveCount(0);

  // Второй Enter — обычная отправка: сообщение с эмодзи появляется в ленте.
  // Эмодзи в ленте — Apple-картинка с alt (renderChatEmojiText), поэтому
  // ищем изображение по доступному имени, а не текстовый символ.
  await composer.press('Enter');
  const thread = page.getByTestId('chat-thread-scroll');
  const lastBubble = thread.locator('[data-message-id]').last();
  await expect(lastBubble).toBeVisible({ timeout: 15_000 });
  await expect(lastBubble.getByRole('img', { name: '🦉' })).toBeVisible({ timeout: 15_000 });
  await expect(composer).toHaveValue('');
});

test('autocomplete keyboard: arrows move selection, Escape hides only the list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);

  const composer = page.getByTestId('chat-composer-textarea');
  const list = page.getByTestId('chat-emoji-suggestions');

  // «:умор» — CLDR-выдача: 🤣 первым, 😂 вторым (unicode-порядок).
  await composer.click();
  await composer.fill(':умор');
  await expect(list).toBeVisible({ timeout: 10_000 });
  const options = list.getByRole('option');
  expect(await options.count()).toBeGreaterThanOrEqual(2);

  // Стрелка вниз переносит выбор — aria-activedescendant следует.
  await composer.press('ArrowDown');
  const selected = list.locator('[data-suggestion-active="true"]');
  await expect(selected).toHaveCount(1);
  const activeId = await selected.getAttribute('id');
  await expect(composer).toHaveAttribute('aria-activedescendant', String(activeId));

  // Enter вставляет ВЫБРАННЫЙ эмодзи (второй — 😂), не первый.
  await composer.press('Enter');
  await expect(composer).toHaveValue('😂 ');

  // Escape при видимом списке гасит только его — текст не тронут.
  await composer.fill(':сов');
  await expect(list).toBeVisible({ timeout: 10_000 });
  await composer.press('Escape');
  await expect(list).toHaveCount(0, { timeout: 5000 });
  await expect(composer).toHaveValue(':сов');
  // Тот же запрос — список остаётся скрытым; новая буква перевооружает.
  await composer.pressSequentially('а', { delay: 30 });
  await expect(list).toBeVisible({ timeout: 10_000 });
  await composer.fill('');
});

test('colon in time and inside words does not trigger autocomplete', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);

  const composer = page.getByTestId('chat-composer-textarea');
  const list = page.getByTestId('chat-emoji-suggestions');

  await composer.click();
  // «встреча в 12:30» — двоеточие внутри числа, триггера нет.
  await composer.pressSequentially('встреча в 12:30', { delay: 15 });
  await expect(list).toHaveCount(0);
  // «http:»-подобный ввод — двоеточие сразу после букв.
  await composer.fill('смотри http:сов');
  await expect(list).toHaveCount(0);
  // Пробел перед двоеточием — легальный триггер (контроль).
  await composer.fill('смотри :сов');
  await expect(list).toBeVisible({ timeout: 10_000 });
  await composer.fill('');
});

test('mention flow is not disturbed by the emoji autocomplete', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);

  const composer = page.getByTestId('chat-composer-textarea');
  await composer.click();
  await composer.fill('@');
  const mentions = page.getByTestId('chat-mention-suggestions');
  await expect(mentions).toBeVisible({ timeout: 10_000 });
  // Emoji-список при открытых упоминаниях не появляется.
  await expect(page.getByTestId('chat-emoji-suggestions')).toHaveCount(0);
  await composer.press('Escape');
  await composer.fill('');
});

// ── Поиск стикеров по полному CLDR-словарю (TASK C) ────────────────────
test('sticker search finds test tubes by CLDR-only keyword «пробирка»', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);
  const dock = await openStickersTab(page);

  const search = dock.getByRole('textbox', { name: 'Поиск стикеров' });
  const results = dock.getByTestId('chat-sticker-search-results');
  await expect(search).toBeVisible();

  // «пробирка» — слово ТОЛЬКО из CLDR: в ручном словаре 🧪 нет вовсе.
  // До полного индекса выдача была пустой.
  await search.fill('пробирка');
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect.poll(
    () => results.locator('button[aria-label^="Отправить стикер"]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);

  // EN-ветка того же эмодзи: experiment/chemistry — CLDR-теги test tube.
  await search.fill('experiment');
  await expect.poll(
    () => results.locator('button[aria-label^="Отправить стикер"]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);

  // Мультисловный запрос: оба слова обязаны попасть (AND-семантика).
  await search.fill('пробирка химия');
  await expect.poll(
    () => results.locator('button[aria-label^="Отправить стикер"]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);
  await search.fill('пробирка zz-no-match');
  await expect(results.locator('button[aria-label^="Отправить стикер"]')).toHaveCount(0, { timeout: 10_000 });

  // Ручной словарь продолжает работать поверх CLDR: «хаха» — curated
  // разговорный синоним 😂, которого нет в CLDR-тегах.
  await search.fill('хаха');
  await expect.poll(
    () => results.locator('button[aria-label^="Отправить стикер"]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);

  await search.press('Escape');
  await expect(search).toHaveValue('');
});
