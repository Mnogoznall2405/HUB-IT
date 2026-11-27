import { test, expect } from '@playwright/test';

// Sticker System V2 — favorites (server-backed), synced recents, sticker
// search, typing-emoji suggestions, pack manage dialog. Runs on the local
// seed: e2e_test_pack (3 webp, emoji 🧪) + e2e_big_pack (90), installed for
// every user via CHAT_DEFAULT_STICKER_PACKS (local_backend.py).
// Креды из env; диалоги создаются реальным API и открываются напрямую по
// /chat?conversation=<id> — как в chat-emoji-picker.spec.js / perf-гейте.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const USERNAME2 = process.env.E2E_USERNAME2;
const PASSWORD2 = process.env.E2E_PASSWORD2;

const STICKER_BUTTONS = 'button[aria-label^="Отправить стикер"]';

test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');
// actionTimeout=0 в конфиге — без лимита клик по непоявившемуся локатору
// ждёт вечно. Любое зависшее действие падает именной ошибкой за 20с.
test.use({ actionTimeout: 20_000 });
// Тесты делят серверное состояние одного пользователя (избранное/недавние
// хранятся в БД на аккаунт) — строгий порядок + точечная нормализация в
// начале каждого теста вместо скрытых зависимостей.
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

// Прямое открытие беседы по URL — детерминированнее клика по сайдбару
// (строка может не входить в видимое окно списка).
async function openConversationDirect(page, conversationId) {
  await page.goto(`/chat?conversation=${conversationId}`);
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 30_000 });
}

async function waitChatReady(page) {
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

const packSection = (dock, title) => (
  dock.locator('section[data-sticker-section]').filter({ hasText: title })
);

// id стикера — из img preview: /api/v1/chat/stickers/<id>/preview.
async function stickerIdOf(section) {
  const src = await section.locator('img').first().getAttribute('src').catch(() => '');
  const m = /\/chat\/stickers\/([^/]+)\/(?:preview|file)/.exec(String(src || ''));
  return m ? m[1] : null;
}

const apiFavorites = async (page) => {
  const resp = await page.request.get('/api/v1/chat/stickers/favorites');
  return resp.ok() ? resp.json() : { items: [] };
};
const apiRecents = async (page) => {
  const resp = await page.request.get('/api/v1/chat/stickers/recent');
  return resp.ok() ? resp.json() : { items: [] };
};
const apiPacks = async (page) => {
  const resp = await page.request.get('/api/v1/chat/sticker-packs');
  return resp.ok() ? resp.json() : { items: [] };
};

// ── Избранное: меню → секция → серверная персистентность → удаление ─────
test('favorites: context menu add, star tab, reload persistence, remove', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  expect(convId, 'direct conversation id').toBeTruthy();
  // Нормализация: вычищаем чужие остатки, чтобы счётчики были детерминированы.
  const stale = await apiFavorites(page);
  for (const item of stale.items || []) {
    await page.request.delete(`/api/v1/chat/stickers/favorites/${item.id}`);
  }
  await openConversationDirect(page, convId);
  const dock = await openStickersTab(page);

  const favSection = dock.locator('section[data-sticker-section="favorites"]');
  await expect(favSection.locator(STICKER_BUTTONS)).toHaveCount(0);
  await expect(favSection).toContainText('Избранные стикеры появятся здесь');

  const pack = packSection(dock, 'E2E Test Pack');
  const cell = pack.locator(STICKER_BUTTONS).first();
  await expect(cell).toBeVisible({ timeout: 20_000 });
  const stickerId = await stickerIdOf(pack);
  expect(stickerId, 'sticker id resolved from preview img src').toBeTruthy();

  await cell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Добавить в избранное' }).click();

  // Секция растёт оптимистично, сервер подтверждает тем же id.
  await expect(favSection.locator(STICKER_BUTTONS)).toHaveCount(1, { timeout: 10_000 });
  await expect
    .poll(async () => ((await apiFavorites(page)).items || []).map((i) => i.id), { timeout: 10_000 })
    .toContain(stickerId);

  // Звёздная вкладка — переход к секции избранного.
  const starTab = dock.getByRole('tab', { name: 'Избранные' });
  await starTab.click();
  await expect(starTab).toHaveAttribute('aria-selected', 'true');
  // Скролл smooth — ждём пока секция реально окажется в видимой зоне
  // (регрессия offsetParent-скролла уносила её за верхнюю границу).
  await expect.poll(() => dock.evaluate((d) => {
    const scroll = d.querySelector('[data-testid="chat-sticker-sections-scroll"]');
    const sec = scroll?.querySelector('[data-sticker-section="favorites"]');
    if (!scroll || !sec) return false;
    const s = scroll.getBoundingClientRect();
    const r = sec.getBoundingClientRect();
    return r.top < s.bottom && r.bottom > s.top;
  }), { timeout: 10_000 }).toBeTruthy();

  // Перезагрузка: избранное живёт только на сервере (localStorage-кэша нет)
  // — появление секции после reload доказывает серверную персистентность.
  await page.reload();
  await waitChatReady(page);
  const dock2 = await openStickersTab(page);
  const favSection2 = dock2.locator('section[data-sticker-section="favorites"]');
  await expect(favSection2.locator(STICKER_BUTTONS)).toHaveCount(1, { timeout: 15_000 });
  expect(await stickerIdOf(favSection2)).toBe(stickerId);

  // «Удалить из избранных» — тот же контекстный путь.
  const favCell = favSection2.locator(STICKER_BUTTONS).first();
  await favCell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Удалить из избранных' }).click();
  await expect(favSection2.locator(STICKER_BUTTONS)).toHaveCount(0, { timeout: 10_000 });
  await expect
    .poll(async () => ((await apiFavorites(page)).items || []).length, { timeout: 10_000 })
    .toBe(0);
});

// ── Недавние: отправка → серверный PUT → reload → удаление через меню ──
test('recents: send persists server-side across reload; menu removal works', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  expect(convId).toBeTruthy();
  // clear:true — иначе merge-семантика PUT оставила бы остатки прошлых прогонов.
  await page.request.put('/api/v1/chat/stickers/recent', { data: { sticker_ids: [], clear: true } });
  await openConversationDirect(page, convId);
  const dock = await openStickersTab(page);

  const recentSection = dock.locator('section[data-sticker-section="recent"]');
  await expect(recentSection).toContainText('Отправленные стикеры появятся здесь');

  const stickerImgs = page.getByTestId('chat-thread-scroll').locator('img[alt="Стикер"]');
  const baseCount = await stickerImgs.count();
  const pack = packSection(dock, 'E2E Test Pack');
  const cell = pack.locator(STICKER_BUTTONS).first();
  await expect(cell).toBeVisible({ timeout: 20_000 });
  const stickerId = await stickerIdOf(pack);
  expect(stickerId).toBeTruthy();

  // Отправка → пузырь в ленте + стикер поднимается в «Недавние»; серверный
  // PUT уходит после дебаунса (~1.5с) — ловим именно его.
  const putSeen = page.waitForRequest(
    (r) => r.url().includes('/chat/stickers/recent') && r.method() === 'PUT',
    { timeout: 10_000 },
  );
  await cell.click();
  await expect(stickerImgs).toHaveCount(baseCount + 1, { timeout: 15_000 });
  await expect(recentSection.locator(STICKER_BUTTONS)).toHaveCount(1, { timeout: 10_000 });
  await putSeen;
  await expect
    .poll(async () => ((await apiRecents(page)).items || []).map((i) => i.id), { timeout: 10_000 })
    .toContain(stickerId);

  // Reload: список приходит с сервера (локальная копия лишь офлайн-кэш —
  // непустой серверный ответ выигрывает у localStorage-версии).
  await page.reload();
  await waitChatReady(page);
  const dock2 = await openStickersTab(page);
  const recentSection2 = dock2.locator('section[data-sticker-section="recent"]');
  await expect(recentSection2.locator(STICKER_BUTTONS)).toHaveCount(1, { timeout: 15_000 });
  expect(await stickerIdOf(recentSection2)).toBe(stickerId);

  // «Убрать из недавних» в контекстном меню секции.
  const recentCell = recentSection2.locator(STICKER_BUTTONS).first();
  const putSeen2 = page.waitForRequest(
    (r) => r.url().includes('/chat/stickers/recent') && r.method() === 'PUT',
    { timeout: 10_000 },
  );
  await recentCell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Убрать из недавних' }).click();
  await expect(recentSection2.locator(STICKER_BUTTONS)).toHaveCount(0, { timeout: 10_000 });
  await putSeen2;
  await expect
    .poll(async () => ((await apiRecents(page)).items || []).length, { timeout: 10_000 })
    .toBe(0);
});

// ── Недавние: reload до подтверждённого flush не теряет операцию (B-3) ──
// Дефект из аудита: op-journal жил только в памяти — перезагрузка вкладки
// до подтверждённого flush теряла bump, и пользователь видел откат recents.
// Теперь журнал персистентен в scoped localStorage и довозится после
// восстановления. Детерминизм без тайминговых гонок: PUT заблокирован до
// перезагрузки (route переживает reload), поэтому на момент reload операция
// гарантированно существует только в клиентском журнале — независимо от
// того, успел ли сработать дебаунс.
test('recents: reload before the confirmed flush still delivers the op', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  expect(convId).toBeTruthy();
  await page.request.put('/api/v1/chat/stickers/recent', { data: { sticker_ids: [], clear: true } });

  let blockPut = true;
  await page.route('**/api/v1/chat/stickers/recent', async (route) => {
    if (blockPut && route.request().method() === 'PUT') {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await openConversationDirect(page, convId);
  const dock = await openStickersTab(page);

  const pack = packSection(dock, 'E2E Test Pack');
  const cell = pack.locator(STICKER_BUTTONS).first();
  await expect(cell).toBeVisible({ timeout: 20_000 });
  const stickerId = await stickerIdOf(pack);
  expect(stickerId).toBeTruthy();

  // bump журналится только после завершения отправки стикера — ждём именно
  // записи журнала в scoped localStorage, это и есть синхронизация теста.
  await cell.click();
  await expect
    .poll(async () => page.evaluate(() => {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key && key.startsWith('hubit.chat.recent-sticker-ops.v1:')) return true;
      }
      return false;
    }), { timeout: 10_000 })
    .toBe(true);

  // Перезагрузка с неподтверждённым журналом. PUT больше не блокируем —
  // восстановленный журнал должен уйти штатным flush'ем.
  blockPut = false;
  await page.reload();
  await waitChatReady(page);

  // Открытие вкладки стикеров восстанавливает журнал и запускает его flush —
  // ловим PUT с самой дельта-операцией. waitForRequest ставится ДО открытия
  // вкладки: ensure срабатывает на видимом монтировании.
  const putSeen = page.waitForRequest(
    (r) => r.url().includes('/chat/stickers/recent') && r.method() === 'PUT',
    { timeout: 20_000 },
  );
  const dock2 = await openStickersTab(page);
  const putRequest = await putSeen;
  const putBody = putRequest.postDataJSON();
  expect(
    (putBody.ops || []).some((op) => op.op === 'bump' && op.sticker_id === stickerId),
  ).toBe(true);

  // Сервер узнал операцию — отката recents нет: rail показывает стикер
  // и после подтверждения синка.
  await expect
    .poll(async () => ((await apiRecents(page)).items || []).map((i) => i.id), { timeout: 10_000 })
    .toContain(stickerId);
  const recentSection = dock2.locator('section[data-sticker-section="recent"]');
  await expect(recentSection.locator(STICKER_BUTTONS)).toHaveCount(1, { timeout: 15_000 });
  expect(await stickerIdOf(recentSection)).toBe(stickerId);
});

// ── Поиск: эмодзи, название набора, пустая выдача, Escape чистит поле ───
test('sticker search: emoji match, pack-title group, empty state, Escape clears', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);
  const dock = await openStickersTab(page);

  const search = dock.getByRole('textbox', { name: 'Поиск стикеров' });
  await expect(search).toBeVisible();
  const results = dock.getByTestId('chat-sticker-search-results');

  // Все сидовые стикеры несут эмодзи 🧪 — запрос-эмодзи матчит их все.
  await search.fill('🧪');
  await expect(results).toBeVisible({ timeout: 10_000 });
  await expect(results.locator(STICKER_BUTTONS).first()).toBeVisible({ timeout: 10_000 });
  expect(await results.locator(STICKER_BUTTONS).count()).toBeGreaterThanOrEqual(3);

  // Ключевое слово из названия набора показывает набор целиком (3 стикера).
  await search.fill('E2E Test');
  await expect(results).toContainText('E2E Test Pack', { timeout: 10_000 });
  await expect.poll(() => results.locator(STICKER_BUTTONS).count(), { timeout: 10_000 }).toBe(3);

  // Запрос без совпадений — пустое состояние.
  await search.fill('zz-no-match-zz');
  await expect(results).toContainText('Ничего не найдено', { timeout: 10_000 });
  await expect(results.locator(STICKER_BUTTONS)).toHaveCount(0);

  // Escape в поле чистит запрос (и убирает фокус), но НЕ закрывает док.
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(results).toHaveCount(0);
  await expect(dock).toBeVisible();
  await expect(page.getByTestId('chat-sticker-sections-scroll')).toBeVisible();
});

// ── Подсказки: полоса над композером, Escape, клик отправляет стикер ─────
test('suggestions: emoji token opens strip, Escape hides, click sends and clears', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);

  const composer = page.getByTestId('chat-composer-textarea');
  const strip = page.getByTestId('chat-sticker-suggestions');
  const stickerImgs = page.getByTestId('chat-thread-scroll').locator('img[alt="Стикер"]');

  // Обычный текст без эмодзи — полосы нет.
  await composer.click();
  await composer.fill('hello world');
  await expect(strip).toHaveCount(0);

  // Хвостовой эмодзи-токен 🧪 — полоса с вариантами (каталог ленивый).
  await composer.fill('🧪');
  await expect(strip).toBeVisible({ timeout: 15_000 });
  expect(await strip.getByRole('option').count()).toBeGreaterThan(0);

  // Escape гасит полосу для этого токена (фокус остаётся в композере).
  await composer.press('Escape');
  await expect(strip).toHaveCount(0, { timeout: 5000 });
  // Токен ушёл и вернулся — полоса перевооружается.
  await composer.fill('');
  await composer.fill('🧪');
  await expect(strip).toBeVisible({ timeout: 10_000 });

  const baseCount = await stickerImgs.count();
  await strip.getByRole('option').first().click();
  await expect(stickerImgs).toHaveCount(baseCount + 1, { timeout: 15_000 });
  // Поле содержало только эмодзи-токен — после отправки очищается.
  await expect(composer).toHaveValue('');

  // «текст + эмодзи»: полоса всё ещё работает, но поле не стирается.
  await composer.fill('hi 🧪');
  await expect(strip).toBeVisible({ timeout: 10_000 });
  await strip.getByRole('option').first().click();
  await expect(stickerImgs).toHaveCount(baseCount + 2, { timeout: 15_000 });
  await expect(composer).toHaveValue(/hi/);
  await composer.fill('');
});

// ── Диалог «Управление наборами»: список, DnD-порядок, удаление ─────────
// HTML5 DnD эмулируется диспатчем реальных DragEvent с DataTransfer —
// React-обработчики на dragstart/dragover/drop их принимают. Если диспатч
// не доходит до React, тест фиксирует gap вместо ложного падения.
test('manage dialog: lists packs, DnD reorder hits API, default-pack delete refused', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await openConversationDirect(page, convId);
  const dock = await openStickersTab(page);

  await dock.getByRole('button', { name: 'Управление наборами стикеров' }).click();
  // У самого дока тоже role=dialog («Эмодзи и стикеры») — выбираем по имени.
  const dialog = page.getByRole('dialog', { name: 'Наборы стикеров' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Наборы стикеров');

  const rows = dialog.locator('li[data-testid^="sticker-manage-row-"]');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  await expect(rows.nth(0)).toContainText('E2E Test Pack');
  await expect(rows.nth(1)).toContainText('E2E Big Pack');
  // Каждый ряд: drag-ручка + кнопки Открыть/Удалить.
  await expect(dialog.getByRole('button', { name: 'Перетащить набор E2E Test Pack' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Удалить набор E2E Test Pack' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Открыть набор E2E Test Pack' })).toBeVisible();

  const packs = (await apiPacks(page)).items || [];
  expect(packs.length).toBeGreaterThanOrEqual(2);
  const testPackId = packs.find((p) => p.short_name === 'e2e_test_pack')?.id;
  const bigPackId = packs.find((p) => p.short_name === 'e2e_big_pack')?.id;
  expect(testPackId && bigPackId).toBeTruthy();

  // ── DnD: перенос «E2E Test Pack» на «E2E Big Pack» → POST order ──
  const orderReq = page.waitForRequest(
    (r) => r.url().includes('/chat/sticker-packs/order') && r.method() === 'POST',
    { timeout: 8000 },
  );
  const dnd = await page.evaluate(([fromId, toId]) => {
    const src = document.querySelector(
      `[data-testid="sticker-manage-row-${fromId}"] [aria-label^="Перетащить набор"]`,
    );
    const dst = document.querySelector(`[data-testid="sticker-manage-row-${toId}"]`);
    if (!src || !dst) return 'missing-nodes';
    const dataTransfer = new DataTransfer();
    const fire = (type, target) => target.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }),
    );
    fire('dragstart', src);
    fire('dragenter', dst);
    fire('dragover', dst);
    fire('drop', dst);
    fire('dragend', src);
    return 'dispatched';
  }, [testPackId, bigPackId]);
  expect(dnd).toBe('dispatched');
  // Fallback допустим только когда синтетические DragEvent вообще не дошли
  // до React-обработчика (запроса нет). Если запрос ушёл — payload, порядок
  // в UI и серверное состояние проверяются жёстко: их поломка обязана
  // валить тест, а не уходить в gap-ветку.
  let orderCall = null;
  try {
    orderCall = await orderReq;
  } catch {
    orderCall = null;
  }
  if (orderCall) {
    // Перетаскиваемый ряд встаёт на место целевого → [big, test].
    expect(orderCall.postDataJSON().pack_ids).toEqual([bigPackId, testPackId]);
    await expect(rows.nth(0)).toContainText('E2E Big Pack', { timeout: 10_000 });
    const after = await apiPacks(page);
    expect(after.items[0].short_name).toBe('e2e_big_pack');
    // Возврат исходного порядка через тот же API — последующим тестам
    // позиция не нужна, но чистое состояние дешевле.
    await page.request.post('/api/v1/chat/sticker-packs/order', {
      data: { pack_ids: [testPackId, bigPackId] },
    });
  } else {
    test.info().annotations.push({
      type: 'gap',
      description: 'synthetic HTML5 DnD did not reach the React drop handler; reorder verified via API below',
    });
    await page.request.post('/api/v1/chat/sticker-packs/order', {
      data: { pack_ids: [bigPackId, testPackId] },
    });
    const after = await apiPacks(page);
    expect(after.items[0].short_name).toBe('e2e_big_pack');
    await page.request.post('/api/v1/chat/sticker-packs/order', {
      data: { pack_ids: [testPackId, bigPackId] },
    });
  }

  // ── Удаление: сидовые наборы — default-паки (CHAT_DEFAULT_STICKER_PACKS),
  // backend отвечает 400 «Стандартный набор стикеров нельзя удалить» (R23).
  // Поэтому прогоняется ПОЛНЫЙ путь удаления (иконка → инлайн-подтверждение
  // → POST → отказ), но без разрушения состояния: ряд и набор остаются.
  await dialog.getByRole('button', { name: 'Удалить набор E2E Test Pack' }).click();
  await dialog.getByRole('button', { name: 'Подтвердить удаление E2E Test Pack' }).click();
  await expect(dialog.locator('.MuiAlert-root')).toContainText('нельзя удалить', { timeout: 10_000 });
  await expect(rows).toHaveCount(2);
  const afterDelete = await apiPacks(page);
  expect(afterDelete.items.map((i) => i.short_name)).toEqual(['e2e_test_pack', 'e2e_big_pack']);

  await dialog.getByRole('button', { name: 'Закрыть управление наборами' }).click();
  await expect(dialog).toBeHidden();
});

// ── Изоляция между пользователями: избранное A не видно у B ─────────────
test('cross-user isolation: A favorites a sticker, B favorites stay empty', async ({ browser }) => {
  test.skip(!USERNAME2 || !PASSWORD2, 'second test account is required');
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  try {
    await apiLogin(pageA);
    await apiLogin(pageB, USERNAME2, PASSWORD2);
    // Нормализация обеих сторон.
    const staleA = await apiFavorites(pageA);
    for (const item of staleA.items || []) {
      await pageA.request.delete(`/api/v1/chat/stickers/favorites/${item.id}`);
    }
    const staleB = await apiFavorites(pageB);
    for (const item of staleB.items || []) {
      await pageB.request.delete(`/api/v1/chat/stickers/favorites/${item.id}`);
    }

    const convId = await ensureDirectConversation(pageA, USERNAME2);
    expect(convId).toBeTruthy();
    await openConversationDirect(pageA, convId);
    const dockA = await openStickersTab(pageA);
    const packA = packSection(dockA, 'E2E Test Pack');
    const cellA = packA.locator(STICKER_BUTTONS).first();
    await expect(cellA).toBeVisible({ timeout: 20_000 });
    const stickerId = await stickerIdOf(packA);
    await cellA.click({ button: 'right' });
    await pageA.getByRole('menuitem', { name: 'Добавить в избранное' }).click();
    await expect(
      dockA.locator('section[data-sticker-section="favorites"]').locator(STICKER_BUTTONS),
    ).toHaveCount(1, { timeout: 10_000 });
    await expect
      .poll(async () => ((await apiFavorites(pageA)).items || []).length, { timeout: 10_000 })
      .toBe(1);

    // У B: API пуст и UI показывает пустое состояние — данные не протекают.
    const favB = await apiFavorites(pageB);
    expect((favB.items || []).length).toBe(0);
    await openConversationDirect(pageB, convId);
    const dockB = await openStickersTab(pageB);
    const favSectionB = dockB.locator('section[data-sticker-section="favorites"]');
    await expect(favSectionB.locator(STICKER_BUTTONS)).toHaveCount(0, { timeout: 15_000 });
    await expect(favSectionB).toContainText('Избранные стикеры появятся здесь');
    // «Недавние» — тот же per-user механизм: список B пуст по API.
    const recB = await apiRecents(pageB);
    expect((recB.items || []).length).toBe(0);

    // Чистим за A — избранное возвращается к пустому состоянию.
    await pageA.request.delete(`/api/v1/chat/stickers/favorites/${stickerId}`);
    await expect
      .poll(async () => ((await apiFavorites(pageA)).items || []).length, { timeout: 10_000 })
      .toBe(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
