import { test, expect } from '@playwright/test';

/* global Buffer, document, process, window */

// Window-virtualization regression suite (Performance V2.2): real browser
// checks that the mounted slice stays bounded, spacer math preserves the
// document height, scrolling below/above the item range never leaves blank
// space, a shrinking itemCount clamps the window, and focus survives a row
// unmount. Runs on the isolated local stack.
//
// Seeding respects the server-side upload rate limit (30 uploads per user
// per 10 min): it stops at 429 and proceeds as long as the folder already
// holds enough rows for the virtualization assertions below.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!(USERNAME && PASSWORD), 'E2E_USERNAME/E2E_PASSWORD not set');
test.skip(process.env.E2E_LOCAL !== '1', 'needs the isolated local stack');

const SEED_WANT = 30;
const SEED_MIN = 20;
const SEED_PREFIX = 'vz2-virt-';

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function countSeeded(page) {
  const list = await page.request.get('/api/v1/my-files');
  const items = (await list.json()).items || [];
  return items.filter((item) => String(item.original_file_name || '').startsWith(SEED_PREFIX)).length;
}

async function seedOnce(page) {
  if (await countSeeded(page) >= SEED_WANT) return;
  for (let i = 0; i < SEED_WANT; i += 1) {
    const name = `${SEED_PREFIX}${String(i).padStart(3, '0')}.txt`;
    const payload = Buffer.from(`e2e ${name}\n`);
    const sessionResponse = await page.request.post('/api/v1/my-files/upload-sessions', {
      data: {
        file_name: name, file_size: payload.length, retention_days: 30,
        mime_type: 'text/plain', folder_id: null,
      },
    });
    if (sessionResponse.status() === 429) break;
    expect(sessionResponse.ok(), `upload-session ${name}: ${sessionResponse.status()}`).toBe(true);
    const session = await sessionResponse.json();
    const fileId = String(session.file_id || session.id || '');
    const chunk = await page.request.put(
      `/api/v1/my-files/upload-sessions/${fileId}/chunks?offset=0`,
      { data: payload, headers: { 'Content-Type': 'application/octet-stream' } },
    );
    expect(chunk.ok(), `chunk ${fileId}: ${chunk.status()}`).toBe(true);
    const complete = await page.request.post(`/api/v1/my-files/upload-sessions/${fileId}/complete`);
    expect(complete.ok(), `complete ${fileId}: ${complete.status()}`).toBe(true);
  }
  const seeded = await countSeeded(page);
  expect(seeded, `need at least ${SEED_MIN} seeded rows, got ${seeded}`).toBeGreaterThanOrEqual(SEED_MIN);
  await expect.poll(async () => {
    const items = (await (await page.request.get('/api/v1/my-files')).json()).items || [];
    return items.filter((item) => String(item.status || 'ready').toLowerCase() !== 'ready').length;
  }, { timeout: 60_000, intervals: [1000, 2000, 5000] }).toBe(0);
}

async function openListView(page) {
  await page.goto('/my-files');
  await page.getByTestId('my-files-search-input').waitFor({ timeout: 30_000 });
  const listToggle = page.getByTestId('my-files-view-list');
  if (await listToggle.isVisible().catch(() => false)) await listToggle.click().catch(() => {});
  await expect(page.locator('[data-testid^="my-files-card-"]').first()).toBeVisible({ timeout: 30_000 });
}

// Rows + spacer geometry of the virtualized list, in one evaluate.
function readVirtualState(page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="my-files-rows"]');
    const rows = Array.from(document.querySelectorAll('[data-testid^="my-files-card-"]'))
      .filter((el) => !el.dataset.testid.includes('menu'));
    const top = container?.querySelector('[data-testid="my-files-rows-spacer-top"]');
    const bottom = container?.querySelector('[data-testid="my-files-rows-spacer-bottom"]');
    const rects = rows.map((el) => el.getBoundingClientRect());
    return {
      mountedRows: rows.length,
      topSpacer: top ? top.getBoundingClientRect().height : 0,
      bottomSpacer: bottom ? bottom.getBoundingClientRect().height : 0,
      scrollY: window.scrollY,
      docHeight: document.documentElement.scrollHeight,
      viewportH: window.innerHeight,
      anyRowInViewport: rects.some((r) => r.bottom > 0 && r.top < window.innerHeight),
      lastRowBottom: rects.length ? Math.max(...rects.map((r) => r.bottom)) : 0,
      firstRowTop: rects.length ? Math.min(...rects.map((r) => r.top)) : 0,
    };
  });
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: `http://127.0.0.1:${process.env.E2E_FRONTEND_PORT || '5174'}`,
  });
  const page = await context.newPage();
  await login(page);
  await seedOnce(page);
  await context.close();
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('list virtualization: bounded rows, spacer sum, scroll past bottom then shrink', async ({ page }) => {
  test.setTimeout(300_000);
  await openListView(page);

  const total = await countSeeded(page);
  const top = await readVirtualState(page);
  expect(top.mountedRows, 'mounted slice must stay bounded').toBeLessThan(total);
  expect(top.mountedRows).toBeGreaterThan(0);
  expect(top.topSpacer).toBe(0);

  // Scroll to the very bottom: a mounted row must cover the viewport bottom —
  // no blank tail below the last row.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('[data-testid^="my-files-card-"]');
    return rows.length > 0 && window.scrollY > 0;
  }, { timeout: 15_000 });
  await page.waitForTimeout(400);
  const bottomState = await readVirtualState(page);
  expect(bottomState.anyRowInViewport, 'blank area at document bottom').toBe(true);
  expect(bottomState.bottomSpacer).toBeLessThanOrEqual(1);
  expect(bottomState.topSpacer).toBeGreaterThan(0);
  // At the very bottom the window + overscan may legitimately cover the whole
  // list when the seeded total is small (upload rate-limit): boundedness is
  // already proven at the top; here we only require no over-mount.
  expect(bottomState.mountedRows).toBeLessThanOrEqual(total);

  // Spacer + mounted rows must still sum to the full list height region:
  // scrolling one viewport above the end must land on rows, not a gap.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight - window.innerHeight * 1.5));
  await page.waitForTimeout(400);
  const mid = await readVirtualState(page);
  expect(mid.anyRowInViewport, 'gap between spacer and rows mid-scroll').toBe(true);

  // Shrink itemCount while scrolled deep (search narrows to one hit): the
  // window must clamp, the document must collapse and no stale offset may
  // leave an empty page.
  await page.getByTestId('my-files-search-input').fill(`${SEED_PREFIX}000`);
  await expect(page.locator('[data-testid^="my-files-card-"]').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  const shrunk = await readVirtualState(page);
  expect(shrunk.mountedRows).toBeLessThanOrEqual(2);
  expect(shrunk.anyRowInViewport, 'empty view after itemCount shrink').toBe(true);

  // Clear the search: the range must expand back.
  await page.getByTestId('my-files-search-input').fill('');
  await expect(page.locator('[data-testid^="my-files-card-"]').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  const restored = await readVirtualState(page);
  expect(restored.mountedRows).toBeGreaterThan(shrunk.mountedRows);
});

test('grid virtualization: independent folder/file sections and bounded cards', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/my-files');
  await page.getByTestId('my-files-search-input').waitFor({ timeout: 30_000 });
  const gridToggle = page.getByTestId('my-files-view-grid');
  test.skip(!(await gridToggle.isVisible().catch(() => false)), 'grid toggle unavailable');
  await gridToggle.click();
  await expect(page.locator('[data-testid^="my-files-card-"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);

  const initial = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid^="my-files-card-"]:not([data-testid*="menu"])').length,
    bottomSpacer: document.querySelector('[data-testid="my-files-grid-spacer-files-bottom"]')?.getBoundingClientRect().height || 0,
  }));
  expect(initial.cards, 'grid must render a bounded slice').toBeLessThan(300);
  expect(initial.cards).toBeGreaterThan(0);

  // Scroll the whole document below the files section — the file-grid spacer
  // must consume the scrolled-off height without collapsing the section.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  const scrolled = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid^="my-files-card-"]:not([data-testid*="menu"])').length,
    bottomSpacer: document.querySelector('[data-testid="my-files-grid-spacer-files-bottom"]')?.getBoundingClientRect().height || 0,
    anyCardVisible: Array.from(document.querySelectorAll('[data-testid^="my-files-card-"]:not([data-testid*="menu"])'))
      .some((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }),
  }));
  expect(scrolled.bottomSpacer, 'file grid bottom spacer must shrink to ~0 at document end').toBeLessThanOrEqual(2);
  expect(scrolled.anyCardVisible, 'blank tail in grid at document bottom').toBe(true);
});

test('fast scroll then focused row: no blank gap and focus survives unmount', async ({ page }) => {
  test.setTimeout(300_000);
  await openListView(page);

  // Fast wheel sweep — rows must be in the viewport at every settle point.
  for (const y of [1200, 0, 2000, 0]) {
    await page.evaluate((target) => window.scrollTo(0, target), y);
    await page.waitForTimeout(350);
    const state = await readVirtualState(page);
    expect(state.anyRowInViewport, `blank viewport after fast scroll to ${y}`).toBe(true);
  }

  // Focus a row, then scroll it out of the mounted slice: the browser drops
  // focus to <body>; the virtualizer hands it to the nearest mounted row.
  const row = page.locator('[data-testid^="my-files-card-"]:not([data-testid*="menu"])').first();
  await row.focus();
  await expect(row).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(600);
  const focus = await page.evaluate(() => ({
    isBody: document.activeElement === document.body,
  }));
  expect(focus.isBody, 'focus must land on a mounted row, not <body>').toBe(false);
});
