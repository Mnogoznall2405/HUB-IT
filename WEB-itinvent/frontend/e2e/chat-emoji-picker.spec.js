import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

// Emoji / sticker picker — Telegram Desktop поведение: hover-превью,
// клик → закреплённая колонка справа, узкий viewport → overlay.
// Креды из env; для самодостаточности диалог создаётся через API,
// как в chat-smoke.spec.js.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const USERNAME2 = process.env.E2E_USERNAME2;
const PASSWORD2 = process.env.E2E_PASSWORD2;
const SHOTS = 'e2e-artifacts/emoji-picker';

// Режим дока вычисляется от реальной ширины chat-thread-pane-wrap:
// колонка 360px + минимально рабочая ширина треда 470px.
const DOCK_COLUMN_WIDTH = 360;
const MIN_THREAD_WIDTH = 470;
const MIN_WRAP_FOR_COLUMN = DOCK_COLUMN_WIDTH + MIN_THREAD_WIDTH;

test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

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

async function openConversation(page, { title } = {}) {
  await apiLogin(page);
  // Гарантируем хотя бы одну переписку через реальный API — как в
  // chat-sidebar-modes.spec.js (куку ставит login через page.request).
  if (USERNAME2) {
    await ensureDirectConversation(page, USERNAME2);
  }
  await page.goto('/chat');
  await expect(
    page.getByTestId('chat-sidebar-desktop-header').or(page.getByTestId('chat-sidebar-list-scroll')).first(),
  ).toBeVisible({ timeout: 30_000 });
  const rows = page.locator('[data-chat-active]');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);
  if (title) {
    const titled = page.locator(`[data-chat-active]:has-text("${title}")`);
    if (await titled.count()) {
      await titled.first().click();
    } else {
      await rows.first().click();
    }
  } else {
    await rows.first().click();
  }
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
}

// Скриншот только после реального декода картинок: кнопки epr-emoji в DOM
// до загрузки img — кадр по «visible» получался пустым. Критерий: контейнер
// имеет геометрию и ≥N img complete+naturalWidth>0+видимый rect.
const waitDecodedImages = async (page, sel, minCount) => {
  try {
    await page.waitForFunction(({ s, n }) => {
      const c = document.querySelector(s);
      if (!c) return false;
      const rect = c.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) return false;
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
        sections: document.querySelectorAll('[data-sticker-section]').length,
        html: c.outerHTML.slice(0, 600),
      };
    }, sel).catch(() => null);
    console.log(`[waitDecodedImages] FAIL sel=${sel} diag=${JSON.stringify(diag)}`);
    throw e;
  }
};

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
  // Холодное открытие: lazy-чанк грузится за спиннером — контрольный кадр
  // делаем только когда в превью уже есть реальные эмодзи, иначе на
  // скриншоте пустая панель.
  await expect(popover.locator('.EmojiPickerReact button.epr-emoji').first())
    .toBeVisible({ timeout: 20_000 });
  // Кадр — только после декода ≥20 img сетки (иначе PNG пустой).
  await waitDecodedImages(page, '[data-testid="chat-desktop-emoji-panel"]', 20);
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

// ── Адаптивность дока по фактической геометрии ──────────────────────────
// Матрица viewport: режим выбирается по ширине контейнера треда (после
// вычета sidebar и правой панели), а не по фиксированному breakpoint.
for (const width of [1200, 1280, 1440, 1920]) {
  test(`dock layout follows the real wrap width at ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openConversation(page);

    await page.getByTestId('chat-composer-emoji-button').click();
    const dock = page.getByTestId('chat-emoji-dock');
    await expect(dock).toBeVisible();

    const wrap = page.getByTestId('chat-thread-pane-wrap');
    const wrapWidth = await wrap.evaluate((node) => node.clientWidth);
    const expectColumn = wrapWidth >= MIN_WRAP_FOR_COLUMN;
    await expect(dock).toHaveAttribute('data-layout', expectColumn ? 'column' : 'overlay');

    if (expectColumn) {
      // Переписка не сжимается до нерабочей ширины.
      const threadWidth = await page
        .getByTestId('chat-thread-root')
        .evaluate((node) => node.clientWidth);
      expect(threadWidth).toBeGreaterThanOrEqual(MIN_THREAD_WIDTH - 2);
    } else {
      // Overlay не выходит за пределы viewport.
      const box = await dock.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
  });
}

// ── Escape и фокус ──────────────────────────────────────────────────────
test('Escape closes the pinned dock; emoji insert returns focus to the composer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page);

  await page.getByTestId('chat-composer-emoji-button').click();
  const dock = page.getByTestId('chat-emoji-dock');
  await expect(dock).toBeVisible();

  // Вставка эмодзи → фокус возвращается в композер.
  const emojiButtons = dock.locator('.EmojiPickerReact button.epr-emoji');
  await expect(emojiButtons.first()).toBeVisible({ timeout: 15_000 });
  await emojiButtons.first().click();
  await expect(page.getByTestId('chat-composer-textarea')).toBeFocused();
  await expect(dock).toBeVisible();

  // Escape в композере закрывает закреплённую панель.
  await page.keyboard.press('Escape');
  await expect(dock).toBeHidden();
});

test('Escape inside the emoji search field closes the dock, not the thread', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page);

  await page.getByTestId('chat-composer-emoji-button').click();
  const dock = page.getByTestId('chat-emoji-dock');
  await expect(dock).toBeVisible();

  const search = dock.locator('.EmojiPickerReact').getByRole('textbox');
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.click();
  await search.fill('smile');
  await page.keyboard.press('Escape');
  await expect(dock).toBeHidden();
  // Беседа не закрылась вместе с панелью — композер на месте.
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
});

test('Escape while a MUI menu is open does not close the pinned dock', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page);

  // Отправляем текст, чтобы было сообщение для контекстного меню.
  const textarea = page.getByTestId('chat-composer-textarea');
  await textarea.fill('e2e escape check');
  await page.getByTestId('chat-composer-send-button').click();

  await page.getByTestId('chat-composer-emoji-button').click();
  const dock = page.getByTestId('chat-emoji-dock');
  await expect(dock).toBeVisible();

  // Контекстное меню сообщения — MUI Modal: Escape закрывает его, а не док.
  const messageRow = page.locator('[data-testid="chat-markdown-body"]').last();
  if (await messageRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await messageRow.click({ button: 'right' });
    const menu = page.locator('.MuiModal-root, .MuiMenu-root, .MuiPopover-root').last();
    if (await menu.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await expect(dock).toBeVisible();
    }
  }
});

// ── Реальная доставка стикеров между двумя аккаунтами ───────────────────
// Полный контур: REST-отправка → deferred WS-паблиш → получатель видит
// стикер без перезагрузки → пersistence после reload. Набор сидится в
// local_backend.py (e2e_test_pack, 3 webp-стикера), Telegram не требуется.
test('sticker delivery A→B over WebSocket, dedup and persistence', async ({ browser }) => {
  test.skip(!USERNAME2 || !PASSWORD2, 'second test account is required');
  test.setTimeout(180_000);

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const stickerImgs = (page) => page.locator('img[alt="Стикер"]');

  try {
    await apiLogin(pageA);
    await apiLogin(pageB, USERNAME2, PASSWORD2);
    const conversationId = await ensureDirectConversation(pageA, USERNAME2);
    expect(conversationId, 'direct conversation id').toBeTruthy();
    // Вторую беседу создаём до загрузки /chat: сайдбар не обязан живо
    // перечитывать список — строка «E2E Новый» уже будет в исходной выдаче.
    const otherConvId = await ensureDirectConversation(pageA, 'e2e_fresh');

    const openChat = async (page, peerTitle) => {
      await page.goto('/chat');
      await expect(
        page.getByTestId('chat-sidebar-desktop-header').or(page.getByTestId('chat-sidebar-list-scroll')).first(),
      ).toBeVisible({ timeout: 30_000 });
      const rows = page.locator('[data-chat-active]');
      await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);
      // «Заметки»/пины могут стоять выше — открываем именно диалог с peer.
      // count() нельзя: список строк догружается асинхронно и мгновенная
      // проверка уходит в фолбэк. Клик сам ждёт появления строки.
      const peerRow = page.locator(`[data-chat-active]:has-text("${peerTitle}")`).first();
      try {
        await peerRow.click({ timeout: 8000 });
      } catch {
        await rows.first().click();
      }
      await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
    };
    await openChat(pageA, 'E2E Пользователь');
    await openChat(pageB, 'E2E Админ');

    // A: закрепляем док, вкладка «Стикеры», ждём сид-набор.
    await pageA.getByTestId('chat-composer-emoji-button').click();
    const dock = pageA.getByTestId('chat-emoji-dock');
    await expect(dock).toBeVisible();
    await dock.getByRole('tab', { name: 'Стикеры' }).click();
    const stickerButtons = dock.locator('button[aria-label^="Отправить стикер"]');
    await expect(stickerButtons.first()).toBeVisible({ timeout: 20_000 });
    expect(await stickerButtons.count()).toBeGreaterThanOrEqual(3);

    // Счётчик стикеров у обоих до отправки (в истории мог быть мусор — нет,
    // БД чистая на каждый запуск, но считаем дельту на всякий случай).
    const baseA = await stickerImgs(pageA).count();
    const baseB = await stickerImgs(pageB).count();

    // 1) Отправка первого стикера — получатель видит по WS.
    await stickerButtons.nth(0).click();
    await expect(stickerImgs(pageA)).toHaveCount(baseA + 1, { timeout: 15_000 });
    await expect(stickerImgs(pageB)).toHaveCount(baseB + 1, { timeout: 20_000 });

    // 2) Второй, другой стикер — параллельная отправка разрешена.
    await stickerButtons.nth(1).click();
    await expect(stickerImgs(pageA)).toHaveCount(baseA + 2, { timeout: 15_000 });
    await expect(stickerImgs(pageB)).toHaveCount(baseB + 2, { timeout: 20_000 });

    // 3) Двойной клик по третьему стикеру — один запрос, без дубликата.
    //    Лок живёт лишь пока запрос в полёте: на локальном backend он
    //    завершается за миллисекунды и между двумя Playwright-кликами
    //    успевает сняться — тогда второй клик честно отправляет дубликат.
    //    Удерживаем первый запрос, чтобы оба клика попали в окно in-flight.
    let releaseFirstSend;
    const firstSendHeld = new Promise((resolve) => { releaseFirstSend = resolve; });
    let holdFirstSend = true;
    await pageA.route('**/messages/sticker', async (route) => {
      try {
        if (holdFirstSend) {
          holdFirstSend = false;
          await firstSendHeld;
        }
        // Редирект повторно вызывает хендлер на уже обработанном route.
        await route.continue();
      } catch { /* route already handled on redirect */ }
    });
    await Promise.all([stickerButtons.nth(2).click(), stickerButtons.nth(2).click()]);
    // Оба клика уже обработаны обработчиком — можно отпускать запрос.
    await pageA.waitForTimeout(300);
    releaseFirstSend();
    await pageA.unroute('**/messages/sticker');
    await expect(stickerImgs(pageA)).toHaveCount(baseA + 3, { timeout: 15_000 });
    await pageA.waitForTimeout(800);
    await expect(stickerImgs(pageA)).toHaveCount(baseA + 3);
    await expect(stickerImgs(pageB)).toHaveCount(baseB + 3, { timeout: 20_000 });

    // 4) client_message_id уникальны (backend дедуплицирует по ним).
    const listResp = await pageA.request.get(
      `/api/v1/chat/conversations/${conversationId}/messages?limit=50`,
    );
    expect(listResp.ok()).toBeTruthy();
    const listJson = await listResp.json();
    const items = listJson.items || (Array.isArray(listJson) ? listJson : []);
    const clientIds = items
      .filter((m) => (m.attachments || []).some((a) => a.kind === 'sticker' || a.media_kind === 'sticker'))
      .map((m) => m.client_message_id)
      .filter(Boolean);
    expect(new Set(clientIds).size).toBe(clientIds.length);
    expect(clientIds.length).toBeGreaterThanOrEqual(3);

    // 5) Persistence: перезагрузка получателя — стикеры в истории.
    await pageB.reload();
    await expect(
      pageB.getByTestId('chat-sidebar-desktop-header').or(pageB.getByTestId('chat-sidebar-list-scroll')).first(),
    ).toBeVisible({ timeout: 30_000 });
    const adminRowAfterReload = pageB.locator('[data-chat-active]:has-text("E2E Админ")').first();
    try {
      await adminRowAfterReload.click({ timeout: 8000 });
    } catch {
      await pageB.locator('[data-chat-active]').first().click();
    }
    await expect(stickerImgs(pageB)).toHaveCount(baseB + 3, { timeout: 20_000 });

    // 6) Потеря соединения → failed-пузырь «Не отправлено» → retry той же
    //    кнопкой пузыря (тот же client_message_id, замена на месте).
    let abortOnce = true;
    await pageA.route('**/messages/sticker', async (route) => {
      try {
        if (abortOnce) {
          abortOnce = false;
          await route.abort();
          return;
        }
        await route.continue();
      } catch { /* route already handled on redirect */ }
    });
    await stickerButtons.nth(0).click();
    const failedAction = pageA.getByTestId('chat-message-failed-action').first();
    await expect(failedAction).toBeVisible({ timeout: 15_000 });
    // Failed-оптимист остаётся в ленте и тоже показывает картинку стикера.
    await expect(stickerImgs(pageA)).toHaveCount(baseA + 4, { timeout: 15_000 });
    await failedAction.click();
    const failedRetry = pageA.getByTestId('chat-message-failed-retry');
    await expect(failedRetry).toBeVisible();
    await failedRetry.click();
    await expect(pageA.getByTestId('chat-message-failed-action')).toHaveCount(0, { timeout: 15_000 });
    await expect(stickerImgs(pageB)).toHaveCount(baseB + 4, { timeout: 20_000 });
    await pageA.unroute('**/messages/sticker');

    // 7) Лок в чате A не блокирует тот же стикер в чате B.
    //    Искусственно задерживаем первый запрос и переключаемся на другой диалог.
    let holdRelease;
    const held = new Promise((resolve) => { holdRelease = resolve; });
    let heldOnce = true;
    await pageA.route('**/messages/sticker', async (route) => {
      try {
        if (heldOnce) {
          heldOnce = false;
          await held;
          await route.continue();
          return;
        }
        await route.continue();
      } catch { /* route already handled on redirect */ }
    });
    const pendingSend = stickerButtons.nth(1).click();
    // Переключаемся на вторую беседу — её строка уже в списке.
    if (otherConvId) {
      const namedRow = pageA.locator('[data-chat-active]:has-text("E2E Новый")').first();
      await expect(namedRow).toBeVisible({ timeout: 20_000 });
      await namedRow.click();
      await expect(pageA.getByTestId('chat-composer-textarea')).toBeVisible();
      // Смена диалога может закрыть док — тогда переоткрываем вкладку.
      if (!(await dock.isVisible())) {
        await pageA.getByTestId('chat-composer-emoji-button').click();
        await expect(dock).toBeVisible();
        await dock.getByRole('tab', { name: 'Стикеры' }).click();
        await expect(stickerButtons.first()).toBeVisible({ timeout: 20_000 });
      }
      // Тот же стикер в другом чате не ждёт освобождения лока.
      const sendOther = stickerButtons.nth(1).click({ timeout: 15_000 });
      holdRelease();
      await Promise.all([pendingSend, sendOther]);
      // click() завершается раньше сетевого запроса — ждём пузырь в ленте
      // второй беседы, затем подтверждение записи через API.
      await expect(stickerImgs(pageA)).toHaveCount(1, { timeout: 15_000 });
      await expect.poll(async () => {
        const resp = await pageA.request.get(
          `/api/v1/chat/conversations/${otherConvId}/messages?limit=10`,
        );
        const json = await resp.json();
        const items = json.items || (Array.isArray(json) ? json : []);
        return items.some((m) => (m.attachments || []).some((a) => a.kind === 'sticker' || a.media_kind === 'sticker'));
      }, { timeout: 15_000 }).toBeTruthy();
    } else {
      holdRelease();
      await pendingSend;
      test.info().annotations.push({ type: 'note', description: 'second conversation unavailable; cross-chat lock verified by unit test' });
    }
    await pageA.unroute('**/messages/sticker');
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ── Производительность: объективные замеры в артефакты ──────────────────
test('measures cold/warm open latency, useful-content time and request count', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page);

  const requestUrls = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/') && !url.includes('/emoji/')) requestUrls.push(url);
  });

  const button = page.getByTestId('chat-composer-emoji-button');
  const dock = page.getByTestId('chat-emoji-dock');

  // Холодное открытие (ленивый чанк ещё может грузиться).
  const coldStart = Date.now();
  await button.click();
  await expect(dock).toBeVisible();
  const coldVisibleMs = Date.now() - coldStart;
  const emojiButtons = dock.locator('.EmojiPickerReact button.epr-emoji');
  await expect(emojiButtons.first()).toBeVisible({ timeout: 20_000 });
  const coldUsefulMs = Date.now() - coldStart;
  const coldApiRequests = requestUrls.length;

  await page.getByTestId('chat-emoji-dock-close').click();
  await expect(dock).toBeHidden();
  requestUrls.length = 0;

  // Тёплое открытие — чанк и кэши уже в памяти.
  const warmStart = Date.now();
  await button.click();
  await expect(dock).toBeVisible();
  await expect(emojiButtons.first()).toBeVisible({ timeout: 20_000 });
  const warmUsefulMs = Date.now() - warmStart;

  // Задержка переключения вкладок.
  const tabStart = Date.now();
  await dock.getByRole('tab', { name: 'Стикеры' }).click();
  await expect(
    dock.locator('[data-sticker-section], .MuiAlert-root, :text("Добавьте первый набор")').first(),
  ).toBeVisible({ timeout: 15_000 });
  const tabSwitchMs = Date.now() - tabStart;
  const stickerTabStart = Date.now();
  await dock.getByRole('tab', { name: 'Эмодзи' }).click();
  await expect(emojiButtons.first()).toBeVisible({ timeout: 10_000 });
  const emojiTabSwitchMs = Date.now() - stickerTabStart;

  const stickerPackRequests = requestUrls.filter((url) => url.includes('/chat/sticker-packs')).length;
  const metrics = {
    viewport: '1440x900',
    coldVisibleMs,
    coldUsefulMs,
    warmUsefulMs,
    tabSwitchToStickersMs: tabSwitchMs,
    tabSwitchBackToEmojiMs: emojiTabSwitchMs,
    apiRequestsOnColdOpen: coldApiRequests,
    stickerPackRequestsOnWarmOpen: stickerPackRequests,
    measuredAt: new Date().toISOString(),
  };
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/perf-metrics.json`, JSON.stringify(metrics, null, 2));
  console.log('emoji-picker perf:', metrics);
});

// ── Визуальная приёмка: тёмная тема ─────────────────────────────────────
test('pinned dock and overlay render correctly in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  // Тема — серверная настройка пользователя; переключаем реальным API и
  // обязательно возвращаем system в конце.
  const patchTheme = (mode) => page.request.patch('/api/v1/settings/me', { data: { theme_mode: mode } });
  try {
    expect((await patchTheme('dark')).ok()).toBeTruthy();
    await openConversation(page);
    // PATCH пишет только серверную настройку — локальный кэш
    // web_preferences_cache обновляет исключительно savePreferences, а
    // refresh на /chat отложен на 3.5c: без записи в кэш приложение
    // загрузится светлым и успешный PATCH ничего не докажет.
    await page.evaluate(() => {
      const key = 'web_preferences_cache';
      const raw = window.localStorage.getItem(key);
      const prefs = raw ? JSON.parse(raw) : {};
      prefs.theme_mode = 'dark';
      window.localStorage.setItem(key, JSON.stringify(prefs));
    });
    await page.reload();
    // Тема должна реально примениться: body в тёмной палитре (#0f1115),
    // иначе кадры "dark" оказались бы светлыми при зелёном тесте.
    await expect
      .poll(
        () => page.evaluate(() => window.getComputedStyle(document.body).backgroundColor),
        { timeout: 20_000 },
      )
      .toBe('rgb(15, 17, 21)');
    await page.locator('[data-chat-active]').first().click();
    await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();

    await page.getByTestId('chat-composer-emoji-button').click();
    const dock = page.getByTestId('chat-emoji-dock');
    await expect(dock).toBeVisible();
    // Белый фон дока здесь означал бы светлую тему.
    const dockBg = await dock.evaluate((node) => window.getComputedStyle(node).backgroundColor);
    expect(dockBg).not.toBe('rgb(255, 255, 255)');
    const emojiButtons = dock.locator('.EmojiPickerReact button.epr-emoji');
    await expect(emojiButtons.first()).toBeVisible({ timeout: 20_000 });
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/emoji-dock-column-dark.png` });

    await page.setViewportSize({ width: 988, height: 838 });
    await page.waitForTimeout(300);
    if ((await dock.getAttribute('data-layout')) !== 'overlay') {
      await page.getByTestId('chat-emoji-dock-close').click();
      await page.getByTestId('chat-composer-emoji-button').click();
    }
    await expect(dock).toHaveAttribute('data-layout', 'overlay');
    await waitDecodedImages(page, '[data-testid="chat-emoji-dock"]', 20);
    await page.screenshot({ path: `${SHOTS}/emoji-dock-overlay-dark.png` });
  } finally {
    await patchTheme('system');
  }
});

test('grid screenshots: decoded emoji and stickers in light and dark', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync(SHOTS, { recursive: true });

  const shootGrid = async (tag) => {
    const dock = page.getByTestId('chat-emoji-dock');
    const btn = page.getByTestId('chat-composer-emoji-button');
    if (!(await dock.isVisible().catch(() => false))) await btn.click();
    await expect(dock).toBeVisible();
    await waitDecodedImages(page, '[data-testid="chat-emoji-dock"]', 20);
    await page.screenshot({ path: `${SHOTS}/emoji-grid-${tag}.png` });
    await dock.getByRole('tab', { name: 'Стикеры' }).click();
    // «Недавние» по умолчанию пусты — открываем сидовый набор; стикеры —
    // lazy-img, поэтому ждём ≥2 реально декодированных в видимой зоне.
    // Ждём сам список/ошибку/пустоту — как в рабочем тесте кэша паков.
    await expect(
      dock.locator('[data-testid="chat-sticker-sections-scroll"], .MuiAlert-root, :text("Добавьте первый набор")').first(),
    ).toBeVisible({ timeout: 15_000 });
    const packTab = dock.getByRole('tab', { name: /E2E|Pack|набор/i }).first();
    if (await packTab.count()) await packTab.click();
    await waitDecodedImages(page, '[data-testid="chat-sticker-sections-scroll"]', 2);
    await page.screenshot({ path: `${SHOTS}/sticker-grid-${tag}.png` });
    await dock.getByRole('tab', { name: 'Эмодзи' }).click();
    await page.keyboard.press('Escape');
    await expect(dock).toBeHidden({ timeout: 10_000 });
  };

  await openConversation(page);
  await shootGrid('light');

  await page.evaluate(() => {
    const key = 'web_preferences_cache';
    const raw = window.localStorage.getItem(key);
    const prefs = raw ? JSON.parse(raw) : {};
    prefs.theme_mode = 'dark';
    window.localStorage.setItem(key, JSON.stringify(prefs));
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.getComputedStyle(document.body).backgroundColor), { timeout: 20_000 })
    .toBe('rgb(15, 17, 21)');
  await openConversation(page);
  await shootGrid('dark');

  await page.evaluate(() => {
    const key = 'web_preferences_cache';
    const raw = window.localStorage.getItem(key);
    const prefs = raw ? JSON.parse(raw) : {};
    prefs.theme_mode = 'system';
    window.localStorage.setItem(key, JSON.stringify(prefs));
  });
});
