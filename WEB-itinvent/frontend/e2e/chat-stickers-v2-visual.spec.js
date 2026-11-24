import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Sticker System V2 — визуальная приёмка (ЭТАП 12). Реальные скриншоты
// всех новых поверхностей: hover-поповер, закреплённый док, избранное,
// недавние, поиск, подсказки, контекстное меню, диалоги наборов,
// полученный стикер, узкий overlay, светлая/тёмная темы.
// Каждый кадр делается только после того, как img целевой области реально
// декодированы (complete && naturalWidth>0 && rect>0) — иначе PNG пустой.
// Креды из env; состояние общее по serial-цепочке: тест 1 наполняет
// избранное/недавние/ленту, остальные снимают.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const USERNAME2 = process.env.E2E_USERNAME2;
const PASSWORD2 = process.env.E2E_PASSWORD2;
const SHOTS = 'e2e-artifacts/stickers-v2';

const STICKER_BUTTONS = 'button[aria-label^="Отправить стикер"]';

test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');
test.use({ actionTimeout: 20_000 });
test.describe.configure({ mode: 'serial' });
test.beforeAll(() => { mkdirSync(SHOTS, { recursive: true }); });

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

// Кадр — только после реального декода: контейнер имеет геометрию и
// ≥minCount img complete+naturalWidth>0+видимый rect. Как в
// chat-emoji-picker.spec.js — иначе PNG получается пустым.
const waitDecodedImages = async (page, sel, minCount) => {
  try {
    await page.waitForFunction(({ s, n }) => {
      const c = document.querySelector(s);
      if (!c) return false;
      const rect = c.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return false;
      const ok = [...c.querySelectorAll('img')].filter(
        (i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0,
      );
      return ok.length >= n;
    }, { s: sel, n: minCount }, { timeout: 25_000, polling: 'raf' });
  } catch (e) {
    const diag = await page.evaluate((s) => {
      const c = document.querySelector(s);
      if (!c) return { found: false };
      const imgs = [...c.querySelectorAll('img')];
      return {
        found: true,
        rect: c.getBoundingClientRect().toJSON?.() || null,
        totalImgs: imgs.length,
        decoded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        html: c.outerHTML.slice(0, 500),
      };
    }, sel).catch(() => null);
    console.log(`[waitDecodedImages] FAIL sel=${sel} diag=${JSON.stringify(diag)}`);
    throw e;
  }
};

const DOCK = '[data-testid="chat-emoji-dock"]';
const POPOVER = '[data-testid="chat-desktop-emoji-panel"]';
const SECTIONS_SCROLL = '[data-testid="chat-sticker-sections-scroll"]';

async function openDockStickers(page) {
  const dock = page.getByTestId('chat-emoji-dock');
  if (!(await dock.isVisible().catch(() => false))) {
    await page.getByTestId('chat-composer-emoji-button').click();
  }
  await expect(dock).toBeVisible();
  const stickersTab = dock.getByRole('tab', { name: 'Стикеры' });
  if ((await stickersTab.getAttribute('aria-selected')) !== 'true') {
    await stickersTab.click();
  }
  await expect(
    dock.locator(`${SECTIONS_SCROLL}, .MuiAlert-root, :text("Добавьте первый набор")`).first(),
  ).toBeVisible({ timeout: 20_000 });
  return dock;
}

const packSection = (dock, title) => (
  dock.locator('section[data-sticker-section]').filter({ hasText: title })
);

// Клик по вкладке-обложке на нижней полосе → секция реально в видимой
// зоне скролл-контейнера (smooth scroll, ждём пересечения rect'ов).
async function scrollSectionIntoView(dock, tabName, sectionId) {
  await dock.getByRole('tab', { name: tabName }).click();
  // locator.evaluate(fn, arg): первый параметр функции — сам элемент дока,
  // arg идёт вторым (у page.evaluate аргумент — первый).
  await expect.poll(() => dock.evaluate((el, { id }) => {
    const scroll = el.querySelector('[data-testid="chat-sticker-sections-scroll"]')
      || document.querySelector('[data-testid="chat-sticker-sections-scroll"]');
    const sec = scroll?.querySelector(`[data-sticker-section="${id}"]`);
    if (!scroll || !sec) return false;
    const s = scroll.getBoundingClientRect();
    const r = sec.getBoundingClientRect();
    return r.top < s.bottom - 4 && r.bottom > s.top + 4;
  }, { id: sectionId }), { timeout: 10_000 }).toBeTruthy();
}

const apiFavorites = async (page) => {
  const resp = await page.request.get('/api/v1/chat/stickers/favorites');
  return resp.ok() ? resp.json() : { items: [] };
};
const apiRecents = async (page) => {
  const resp = await page.request.get('/api/v1/chat/stickers/recent');
  return resp.ok() ? resp.json() : { items: [] };
};

const patchTheme = (page, mode) => page.request.patch('/api/v1/settings/me', { data: { theme_mode: mode } });
const setThemeCache = (page, mode) => page.evaluate((m) => {
  const key = 'web_preferences_cache';
  const raw = window.localStorage.getItem(key);
  const prefs = raw ? JSON.parse(raw) : {};
  prefs.theme_mode = m;
  window.localStorage.setItem(key, JSON.stringify(prefs));
}, mode);

/* ── 1. Наполнение: избранное через меню, недавние через отправку,
      входящий стикер от второго пользователя; снимки context-menu,
      favorites, recents, received ── */
test('01 populate: favorites, recents, received sticker + context menu shot', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  expect(convId).toBeTruthy();

  // Детерминизм: чужие остатки из прежних прогонов вычищаем через API.
  for (const item of (await apiFavorites(page)).items || []) {
    await page.request.delete(`/api/v1/chat/stickers/favorites/${item.id}`);
  }
  await page.request.put('/api/v1/chat/stickers/recent', { data: { sticker_ids: [] } });

  await openConversationDirect(page, convId);
  const dock = await openDockStickers(page);

  // ── Контекстное меню: ПКМ по первой ячейке набора → кадр с меню ──
  const pack = packSection(dock, 'E2E Test Pack');
  const firstCell = pack.locator(STICKER_BUTTONS).first();
  await expect(firstCell).toBeVisible({ timeout: 20_000 });
  await firstCell.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Добавить в избранное' }))
    .toBeVisible({ timeout: 10_000 });
  // MUI-меню открывается scale/fade-анимацией — иначе кадр ловит
  // полупрозрачную бумагу поверх сетки.
  await page.waitForTimeout(350);
  await waitDecodedImages(page, DOCK, 4);
  await page.screenshot({ path: `${SHOTS}/08-context-menu.png` });
  await page.getByRole('menuitem', { name: 'Добавить в избранное' }).click();

  const favSection = dock.locator('section[data-sticker-section="favorites"]');
  await expect(favSection.locator(STICKER_BUTTONS)).toHaveCount(1, { timeout: 10_000 });

  // Ещё два избранных — из второго набора (визуальное разнообразие).
  const bigPackSectionId = await page.evaluate(() => {
    const sec = [...document.querySelectorAll(
      '[data-testid="chat-sticker-sections-scroll"] [data-sticker-section]',
    )];
    return sec.find((s) => s.textContent?.includes('E2E Big Pack'))?.dataset.stickerSection || '';
  });
  expect(bigPackSectionId).toBeTruthy();
  await scrollSectionIntoView(dock, 'E2E Big Pack', bigPackSectionId);
  const bigPack = packSection(dock, 'E2E Big Pack');
  for (const idx of [0, 1]) {
    const cell = bigPack.locator(STICKER_BUTTONS).nth(idx);
    await expect(cell).toBeVisible({ timeout: 10_000 });
    await cell.click({ button: 'right' });
    const item = page.getByRole('menuitem', { name: 'Добавить в избранное' });
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.click();
  }
  await expect(favSection.locator(STICKER_BUTTONS)).toHaveCount(3, { timeout: 10_000 });

  // ── Отправка стикера кликом → в ленту и в «Недавние» ──
  const threadStickers = page.getByTestId('chat-thread-scroll').locator('img[alt="Стикер"]');
  const baseCount = await threadStickers.count();
  const sendCell = bigPack.locator(STICKER_BUTTONS).nth(2);
  await expect(sendCell).toBeVisible({ timeout: 10_000 });
  await sendCell.click();
  await expect(threadStickers).toHaveCount(baseCount + 1, { timeout: 15_000 });

  // ── Входящий стикер от второго пользователя реальным API ──
  const ctx2 = await browser.newContext();
  try {
    const page2 = await ctx2.newPage();
    await apiLogin(page2, USERNAME2, PASSWORD2);
    const packsResp = await page2.request.get('/api/v1/chat/sticker-packs');
    expect(packsResp.ok()).toBeTruthy();
    const packs = (await packsResp.json()).items || [];
    const stickerId = packs.find((p) => p.short_name === 'e2e_test_pack')?.stickers?.[1]?.id
      || packs[0]?.stickers?.[0]?.id;
    expect(stickerId).toBeTruthy();
    const sendResp = await page2.request.post(
      `/api/v1/chat/conversations/${convId}/messages/sticker`,
      { data: { sticker_id: stickerId } },
    );
    expect(sendResp.ok()).toBeTruthy();
  } finally {
    await ctx2.close();
  }
  try {
    await expect(threadStickers).toHaveCount(baseCount + 2, { timeout: 15_000 });
  } catch {
    // WS/поллинг не довёз сообщение за 15 с — reload догоняет историю.
    await page.reload();
    await expect(page.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId('chat-thread-scroll').locator('img[alt="Стикер"]'),
    ).toHaveCount(baseCount + 2, { timeout: 20_000 });
  }
  await waitDecodedImages(page, '[data-testid="chat-thread-scroll"]', 2);
  // Кадр ленты делаем с закрытым доком — открытая панель перекрывает
  // переписку, и полученный стикер не виден.
  const dockEl = page.getByTestId('chat-emoji-dock');
  if (await dockEl.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    if (await dockEl.isVisible().catch(() => false)) {
      await page.getByTestId('chat-emoji-dock-close').click();
    }
  }
  await expect(dockEl).toBeHidden({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/11-received-sticker.png` });

  // Док мог закрыться fallback-reload'ом или Escape — переоткрываем
  // идемпотентно для секционных кадров ниже.
  const dockLive = await openDockStickers(page);

  // ── Секция «Недавние» наполнена → кадр ──
  const recentSection = dockLive.locator('section[data-sticker-section="recent"]');
  await expect(recentSection.locator(STICKER_BUTTONS).first()).toBeVisible({ timeout: 10_000 });
  await scrollSectionIntoView(dockLive, 'Недавние', 'recent');
  await waitDecodedImages(page, `${DOCK} [data-sticker-section="recent"]`, 1);
  await dockLive.screenshot({ path: `${SHOTS}/04-recents.png` });

  // ── Секция «Избранные» (3 стикера) → кадр ──
  await scrollSectionIntoView(dockLive, 'Избранные', 'favorites');
  await waitDecodedImages(page, `${DOCK} [data-sticker-section="favorites"]`, 3);
  await dockLive.screenshot({ path: `${SHOTS}/03-favorites.png` });
});

/* ── 2. Панели: hover-поповер со стикерами, закреплённый док справа ── */
test('02 panels: hover popover stickers grid + pinned dock column', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);

  // Hover-поповер: задержка ~140 мс, ждём появления и вкладку «Стикеры».
  const button = page.getByTestId('chat-composer-emoji-button');
  const popover = page.getByTestId('chat-desktop-emoji-panel');
  await button.hover();
  await expect(popover).toBeVisible({ timeout: 8000 });
  const popStickersTab = popover.getByRole('tab', { name: 'Стикеры' });
  await popStickersTab.click();
  await expect(popover.locator(SECTIONS_SCROLL)).toBeVisible({ timeout: 20_000 });
  await waitDecodedImages(page, `${POPOVER} ${SECTIONS_SCROLL}`, 4);
  await page.screenshot({ path: `${SHOTS}/01-popover-grid.png` });

  // Клик закрепляет док справа — поповер прячется.
  await button.click();
  const dock = page.getByTestId('chat-emoji-dock');
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute('data-layout', 'column');
  await expect(popover).toBeHidden();
  await openDockStickers(page);
  await waitDecodedImages(page, `${DOCK} ${SECTIONS_SCROLL}`, 4);
  await page.screenshot({ path: `${SHOTS}/02-dock-column.png` });
});

/* ── 3. Поиск: эмодзи-запрос и словесный запрос ── */
test('03 search: emoji query and keyword query', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);
  const dock = await openDockStickers(page);

  const search = dock.getByRole('textbox', { name: 'Поиск стикеров' });
  const results = dock.getByTestId('chat-sticker-search-results');

  await search.fill('🧪');
  await expect(results.locator(STICKER_BUTTONS).first()).toBeVisible({ timeout: 15_000 });
  await waitDecodedImages(page, `${DOCK} [data-testid="chat-sticker-search-results"]`, 4);
  await dock.screenshot({ path: `${SHOTS}/05-search-emoji.png` });

  // Словесный запрос: «сердце» матчит ключевые слова эмодзи ❤️ —
  // показывает подмножество, а не название набора.
  await search.fill('сердце');
  await expect(results.locator(STICKER_BUTTONS).first()).toBeVisible({ timeout: 15_000 });
  await waitDecodedImages(page, `${DOCK} [data-testid="chat-sticker-search-results"]`, 4);
  await dock.screenshot({ path: `${SHOTS}/06-search-word.png` });
});

/* ── 4. Подсказки над композером + диалоги наборов ── */
test('04 suggestions strip + manage dialog + pack preview dialog', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);

  // Полоса подсказок: хвостовой эмодзи-токен 🧪.
  const composer = page.getByTestId('chat-composer-textarea');
  await composer.click();
  await composer.fill('🧪');
  const strip = page.getByTestId('chat-sticker-suggestions');
  await expect(strip).toBeVisible({ timeout: 20_000 });
  await expect(strip.getByRole('option').first()).toBeVisible();
  await waitDecodedImages(page, '[data-testid="chat-sticker-suggestions"]', 3);
  await page.screenshot({ path: `${SHOTS}/07-suggestions.png` });
  await composer.fill('');
  await expect(strip).toHaveCount(0, { timeout: 5000 });

  // Диалог управления наборами — шестерёнка во вкладке стикеров.
  const dock = await openDockStickers(page);
  await dock.getByRole('button', { name: 'Управление наборами стикеров' }).click();
  const manage = page.getByRole('dialog', { name: 'Наборы стикеров' });
  await expect(manage).toBeVisible();
  await expect(manage.locator('li[data-testid^="sticker-manage-row-"]')).toHaveCount(2, { timeout: 10_000 });
  await waitDecodedImages(page, '.MuiDialog-root', 2);
  await page.screenshot({ path: `${SHOTS}/09-manage-dialog.png` });
  await manage.getByRole('button', { name: 'Закрыть управление наборами' }).click();
  await expect(manage).toBeHidden();

  // Превью набора — клик по стикеру в ленте (входящий от user2 из теста 01
  // либо собственный). Кнопка «Открыть набор стикеров» — обёртка стикера.
  await page.keyboard.press('Escape');
  await expect(dock).toBeHidden({ timeout: 10_000 });
  const stickerAttachment = page.getByTestId('chat-thread-scroll')
    .getByRole('button', { name: 'Открыть набор стикеров' }).last();
  await expect(stickerAttachment).toBeVisible({ timeout: 15_000 });
  await stickerAttachment.click();
  const packDialog = page.getByRole('dialog').filter({ has: page.getByTestId('chat-sticker-pack-grid') });
  await expect(packDialog).toBeVisible({ timeout: 15_000 });
  await waitDecodedImages(page, '[data-testid="chat-sticker-pack-grid"]', 3);
  await page.screenshot({ path: `${SHOTS}/10-pack-preview.png` });
  await page.keyboard.press('Escape');
});

/* ── 5. Узкий overlay (988) + светлая/тёмная темы основной панели ── */
test('05 narrow overlay + light/dark theme variants', async ({ page }) => {
  test.setTimeout(240_000);
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  expect(convId).toBeTruthy();

  // ── Светлая панель 1440 ──
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversationDirect(page, convId);
  let dock = await openDockStickers(page);
  await waitDecodedImages(page, `${DOCK} ${SECTIONS_SCROLL}`, 4);
  await page.screenshot({ path: `${SHOTS}/13-panel-light.png` });

  // ── Узкий overlay (988×838), светлая тема ──
  await page.setViewportSize({ width: 988, height: 838 });
  await page.waitForTimeout(400);
  if ((await dock.getAttribute('data-layout')) !== 'overlay') {
    await page.getByTestId('chat-emoji-dock-close').click();
    await page.getByTestId('chat-composer-emoji-button').click();
    dock = await openDockStickers(page);
  }
  await expect(dock).toHaveAttribute('data-layout', 'overlay');
  await waitDecodedImages(page, `${DOCK} ${SECTIONS_SCROLL}`, 4);
  await page.screenshot({ path: `${SHOTS}/12-overlay-988.png` });

  // ── Тёмная тема: серверная настройка + кэш web_preferences ──
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    expect((await patchTheme(page, 'dark')).ok()).toBeTruthy();
    await setThemeCache(page, 'dark');
    await page.reload();
    // Контроль применения: body в тёмной палитре, иначе кадр "dark" светлый.
    await expect
      .poll(() => page.evaluate(() => window.getComputedStyle(document.body).backgroundColor), { timeout: 20_000 })
      .toBe('rgb(15, 17, 21)');
    await openConversationDirect(page, convId);
    dock = await openDockStickers(page);
    const dockBg = await dock.evaluate((node) => window.getComputedStyle(node).backgroundColor);
    expect(dockBg).not.toBe('rgb(255, 255, 255)');
    await waitDecodedImages(page, `${DOCK} ${SECTIONS_SCROLL}`, 4);
    await page.screenshot({ path: `${SHOTS}/14-panel-dark.png` });
  } finally {
    await patchTheme(page, 'system');
    await setThemeCache(page, 'system').catch(() => {});
  }
});
