import { test, expect, chromium } from '@playwright/test';

// Accessibility acceptance for the grouped context menus (NestedMenuItem):
//   - a REAL keyboard sequence on a real page (focus the ⋮ trigger, Enter,
//     ArrowDown, ArrowRight, ArrowLeft, Escape) — not jsdom fireEvent;
//   - focus + aria-hidden interaction: while a flyout Modal is open it
//     aria-hides the parent menu, so the focused element must live inside
//     the flyout, never inside the hidden subtree;
//   - real touch (hasTouch context + touchscreen.tap) — the tap must open
//     the flyout and keep it open, not flicker it;
//   - ARIA contract screen readers consume: role=menu/menuitem,
//     aria-haspopup/aria-expanded on group rows, aria-label on the flyout.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!(USERNAME && PASSWORD), 'E2E_USERNAME/E2E_PASSWORD not set');
test.skip(process.env.E2E_LOCAL !== '1', 'needs the isolated local stack');

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function seedOneFile(page, stamp) {
  const payload = Buffer.from(`a11y ${stamp}\n`);
  const sessionResponse = await page.request.post('/api/v1/my-files/upload-sessions', {
    data: {
      file_name: `a11y-${stamp}.txt`,
      file_size: payload.length,
      retention_days: 30,
      mime_type: 'text/plain',
      folder_id: null,
    },
  });
  test.skip(!sessionResponse.ok(), 'upload-session seed unavailable');
  const session = await sessionResponse.json();
  const fileId = String(session.file_id || session.id || '');
  await page.request.put(`/api/v1/my-files/upload-sessions/${fileId}/chunks?offset=0`, {
    data: payload,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  await page.request.post(`/api/v1/my-files/upload-sessions/${fileId}/complete`);
  return fileId;
}

async function openMyFiles(page) {
  await page.goto('/my-files');
  // Both tests assert file-action-group-* rows, which only exist on FILE menus;
  // folder rows render before files, so a leftover folder must not win .first().
  const firstAction = page.locator('[data-testid^="my-files-menu-file-"]').first();
  await expect(firstAction).toBeVisible({ timeout: 20_000 });
  return firstAction;
}

const focusedTestId = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') || '');
const focusInsideHiddenTree = (page) => page.evaluate(() => {
  let node = document.activeElement;
  while (node && node !== document.body) {
    if (node.getAttribute?.('aria-hidden') === 'true') return true;
    node = node.parentElement;
  }
  return false;
});
const focusInsideSelector = (page, selector) => page.evaluate((sel) => {
  const target = document.querySelector(sel);
  return Boolean(target && target.contains(document.activeElement));
}, selector);

test('keyboard: Enter opens, ArrowRight/Left drive the flyout, Escape restores the trigger', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  await seedOneFile(page, stamp);
  const action = await openMyFiles(page);

  // Focus the ⋮ trigger the way a keyboard user reaches it, then Enter.
  // The row list can re-render right after load (sort/hint) and steal focus —
  // a keyboard user just presses Enter again on the still-focused control,
  // so the retry mirrors real behaviour without masking a broken menu.
  let menuOpened = false;
  for (let attempt = 0; attempt < 3 && !menuOpened; attempt += 1) {
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    menuOpened = await page.getByRole('menu').isVisible().catch(() => false);
    if (!menuOpened) await page.keyboard.press('Escape'); // dismiss whatever grabbed it
  }
  await expect(page.getByRole('menu')).toBeVisible();

  // Walk down until a submenu group row is focused.
  let onGroup = false;
  for (let i = 0; i < 12 && !onGroup; i += 1) {
    const tid = await focusedTestId(page);
    if (tid && tid.endsWith('-group-organize')) onGroup = true;
    else await page.keyboard.press('ArrowDown');
  }
  expect(onGroup, 'ArrowDown never reached the «Организовать» group row').toBe(true);
  const groupRow = page.getByTestId('file-action-group-organize');
  await expect(groupRow).toHaveAttribute('aria-haspopup', 'menu');
  await expect(groupRow).toHaveAttribute('aria-expanded', 'false');

  // ArrowRight opens the flyout; focus must land INSIDE it — the parent menu
  // is aria-hidden by the flyout Modal at this point, so focus inside the
  // parent would be a screen-reader trap.
  await page.keyboard.press('ArrowRight');
  const flyout = page.getByRole('menu', { name: 'Организовать' });
  await expect(flyout).toBeVisible();
  await expect(groupRow).toHaveAttribute('aria-expanded', 'true');
  expect(await focusInsideSelector(page, 'ul[aria-label="Организовать"]')).toBe(true);
  expect(await focusInsideHiddenTree(page)).toBe(false);
  const parentHidden = await page.evaluate(
    () => Boolean(document.querySelector('[aria-hidden="true"] [role="menu"]')),
  );
  expect(parentHidden, 'parent menu was expected under aria-hidden while the flyout modal is open').toBe(true);

  // ArrowLeft closes the flyout and returns focus to the (now unhidden) row.
  await page.keyboard.press('ArrowLeft');
  await expect(flyout).not.toBeVisible();
  expect(await focusedTestId(page)).toBe('file-action-group-organize');
  expect(await focusInsideHiddenTree(page)).toBe(false);

  // Escape closes the whole menu and restores focus to the ⋮ trigger.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).not.toBeVisible();
  const triggerTid = await action.getAttribute('data-testid');
  expect(await focusedTestId(page)).toBe(triggerTid);
});

test('touch: a real tap keeps the flyout open and a flyout item still works', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await login(page);
    const stamp = Date.now();
    await seedOneFile(page, stamp);
    const action = await openMyFiles(page);

    // locator.tap() performs real touch tap with actionability checks — it
    // waits for a stable bounding box, which a raw touchscreen.tap() at a
    // mid-transition coordinate does not get (the MUI Menu grow transition
    // would shift the row under the finger).
    await action.tap();
    await expect(page.getByRole('menu')).toBeVisible();

    const group = page.getByTestId('file-action-group-more');
    await expect(group).toBeVisible();
    await group.tap();
    // The single tap must open the flyout and KEEP it open — the fixed bug
    // was emulated-mouseenter + click of one gesture toggling it shut.
    const flyout = page.getByRole('menu', { name: 'Дополнительно' });
    await expect(flyout).toBeVisible();
    await page.waitForTimeout(300);
    await expect(flyout).toBeVisible();
    await expect(group).toHaveAttribute('aria-expanded', 'true');

    // A real tap on a flyout item runs its operation — «Сведения» opens the
    // details side panel (role=complementary), not a dialog.
    await flyout.getByRole('menuitem', { name: 'Сведения', exact: true }).tap();
    await expect(page.getByRole('complementary', { name: 'Панель сведений' }))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('menu')).not.toBeVisible();
  } finally {
    await context.close();
  }
});
