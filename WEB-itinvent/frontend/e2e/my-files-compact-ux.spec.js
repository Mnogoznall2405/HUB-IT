import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

// Compact-UX acceptance pass over the real UI on the throwaway local stack
// (E2E_LOCAL=1): grouped context menus, independent libraries-section and
// whole-panel collapse, denser rows and toolbar — plus viewport/zoom/theme
// overflow measurements and screenshots for MY_FILES_COMPACT_UX_REVIEW.md.
// Writes PNGs + metrics.json to e2e/artifacts/compact-ux/.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const OUT_DIR = 'e2e/artifacts/compact-ux';

test.skip(!(USERNAME && PASSWORD), 'E2E_USERNAME/E2E_PASSWORD not set');
test.skip(process.env.E2E_LOCAL !== '1', 'screenshots/measurements need the isolated local stack');

async function login(page, username = USERNAME, password = PASSWORD) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: false });
}

// Horizontal-overflow probe: documentElement plus every element whose own
// content is wider than its box (that's where a clipped toolbar/list hides).
async function measureOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const leaks = [];
    document.querySelectorAll('body *').forEach((el) => {
      const slack = el.scrollWidth - el.clientWidth;
      if (slack > 2 && el.clientWidth > 0) {
        const id = el.getAttribute('data-testid') || el.className?.toString().slice(0, 60) || el.tagName;
        leaks.push({ id, slack });
      }
    });
    return {
      viewport: window.innerWidth,
      docOverflow: doc.scrollWidth - doc.clientWidth,
      leaks: leaks.slice(0, 10),
    };
  });
}

async function seedDisk(page, stamp) {
  // Libraries through the API (admin on the local stack can create them).
  const libraries = [];
  for (const name of [
    `Отдел ИТ — регламенты и шаблоны ${stamp}`,
    `Подбор кандидатов резюме собеседования ${stamp}`,
  ]) {
    const response = await page.request.post('/api/v1/my-files/libraries', {
      data: { name, quota_bytes: 0 },
    });
    if (response.ok()) libraries.push(await response.json());
  }
  // Real nested folders inside the first library — the nav tree must show
  // the actual parent_id hierarchy under the opened library only.
  let libTree = null;
  if (libraries[0]?.id) {
    const libRoot = await (await page.request.post('/api/v1/my-files/folders', {
      data: { name: `Регламенты ${stamp}`, parent_id: null, library_id: String(libraries[0].id) },
    })).json();
    const libNested = await (await page.request.post('/api/v1/my-files/folders', {
      data: { name: `Архив ${stamp}`, parent_id: String(libRoot.id), library_id: String(libraries[0].id) },
    })).json();
    libTree = { library: libraries[0], root: libRoot, nested: libNested };
  }
  // Nested plain folders + a dozen files of mixed types.
  const outer = await (await page.request.post('/api/v1/my-files/folders', {
    data: { name: `Проекты ${stamp}`, parent_id: null },
  })).json();
  const inner = await (await page.request.post('/api/v1/my-files/folders', {
    data: { name: `Архив документов с очень длинным названием папки ${stamp}`, parent_id: String(outer.id) },
  })).json();
  const types = [
    ['notes', 'txt'], ['report', 'md'], ['data', 'csv'], ['config', 'json'],
    ['readme', 'log'], ['settings', 'ini'], ['table', 'xlsx'], ['slides', 'pptx'],
    ['contract', 'docx'], ['manual', 'pdf'], ['archive', 'zip'], ['script', 'py'],
  ];
  for (const [base, ext] of types) {
    const payload = Buffer.from(`e2e ${base} ${stamp}\n`);
    const sessionResponse = await page.request.post('/api/v1/my-files/upload-sessions', {
      data: {
        file_name: `${base}-${stamp}.${ext}`,
        file_size: payload.length,
        retention_days: 30,
        mime_type: 'application/octet-stream',
        folder_id: null,
      },
    });
    if (!sessionResponse.ok()) continue;
    const session = await sessionResponse.json();
    const fileId = String(session.file_id || session.id || '');
    if (!fileId) continue;
    const chunk = await page.request.put(
      `/api/v1/my-files/upload-sessions/${fileId}/chunks?offset=0`,
      { data: payload, headers: { 'Content-Type': 'application/octet-stream' } },
    ).catch(() => null);
    if (!chunk?.ok()) continue;
    await page.request.post(`/api/v1/my-files/upload-sessions/${fileId}/complete`).catch(() => null);
  }
  return { libraries, libTree, outer, inner };
}

test('compact UX: populated disk, all widths and zooms, menus, collapse, themes', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const stamp = Date.now();
  await login(page);
  const seeded = await seedDisk(page, stamp);
  await mkdir(OUT_DIR, { recursive: true });

  const metrics = { seedLibraries: seeded.libraries.length, widths: {}, zooms: {}, menus: {}, collapse: {} };

  await page.goto('/my-files');
  await page.getByTestId('my-files-search-input').waitFor({ timeout: 30_000 });

  // ── Widths: toolbar/breadcrumbs/sidebar at 390..1600 ────────────────────
  for (const width of [390, 768, 1024, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(350);
    const m = await measureOverflow(page);
    metrics.widths[width] = m;
    await shot(page, `width-${width}`);
    if (width >= 1024) {
      expect(m.docOverflow, `horizontal doc overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  }

  // ── Zooms at a Desktop-like window width ────────────────────────────────
  await page.setViewportSize({ width: 1024, height: 800 });
  for (const zoom of [1.25, 1.5, 2.0]) {
    await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
    await page.waitForTimeout(300);
    metrics.zooms[zoom] = await measureOverflow(page);
    await shot(page, `zoom-${Math.round(zoom * 100)}`);
  }
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });

  // ── File context menu: grouped first level + flyout ─────────────────────
  await page.setViewportSize({ width: 1024, height: 800 });
  const card = page.locator('[data-testid^="my-files-card-"]').first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click({ button: 'right' });
  const fileMenu = page.getByRole('menu').first();
  await expect(fileMenu).toBeVisible();
  metrics.menus.fileTopLevel = await fileMenu.getByRole('menuitem').allTextContents();
  await shot(page, 'menu-file-top');

  // «Организовать» opens a real flyout on click; sibling flyouts replace it.
  const organizeGroup = page.getByTestId('file-action-group-organize');
  if (await organizeGroup.count()) {
    await organizeGroup.click();
    await expect(page.getByRole('menuitem', { name: 'Переименовать', exact: true })).toBeVisible();
    await shot(page, 'menu-file-organize-open');
  }
  const moreGroup = page.getByTestId('file-action-group-more');
  if (await moreGroup.count()) {
    // Click (also the touch path) — hover swaps flyouts mid-gesture and the
    // parent list re-renders, which makes a scripted hover racy.
    await moreGroup.click();
    await expect(page.getByRole('menuitem', { name: 'Сведения', exact: true })).toBeVisible();
    await shot(page, 'menu-file-more-open');
    metrics.menus.moreItems = await page.getByRole('menu').nth(1).getByRole('menuitem').allTextContents().catch(() => []);
  }
  // Escape from the flyout returns to the parent row, Escape again closes all.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 5_000 });
  metrics.menus.escapesClean = true;

  // ── Folder context menu uses the same grouping ──────────────────────────
  const folderRow = page.getByTestId(`my-files-folder-${seeded.outer.id}`);
  if (await folderRow.count()) {
    await folderRow.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    metrics.menus.folderTopLevel = await page.getByRole('menu').first().getByRole('menuitem').allTextContents();
    const folderOrganize = page.getByTestId('folder-action-group-organize');
    if (await folderOrganize.count()) {
      await folderOrganize.click();
      await shot(page, 'menu-folder-organize-open');
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }

  // ── Row quick actions: hover pill, always-visible ⋮ ─────────────────────
  await page.getByTestId('my-files-view-list').click();
  const row = page.locator('[data-testid^="my-files-card-"]').first();
  await row.hover();
  await page.waitForTimeout(300);
  await shot(page, 'row-hover-quick-actions');

  // ── Libraries section collapse is independent ───────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByTestId('my-files-search-input').waitFor({ timeout: 30_000 });
  const libToggle = page.getByTestId('my-files-libraries-toggle');
  if (await libToggle.count()) {
    await shot(page, 'sidebar-libraries-expanded');
    await libToggle.click();
    await expect(page.getByTestId('my-files-libraries-toggle')).toHaveAttribute('aria-expanded', 'false');
    await shot(page, 'sidebar-libraries-collapsed');
    metrics.collapse.sectionWorks = true;
    await libToggle.click();
  }

  // ── Whole-panel collapse → 64px icon rail + libraries flyout ────────────
  const collapseToggle = page.getByTestId('my-files-nav-collapse-toggle');
  if (await collapseToggle.count()) {
    await collapseToggle.click();
    await page.waitForTimeout(350);
    const flyoutButton = page.getByTestId('my-files-libraries-flyout');
    metrics.collapse.iconRail = {
      flyoutVisible: await flyoutButton.isVisible().catch(() => false),
      navDriveVisible: await page.getByTestId('my-files-nav-drive').isVisible().catch(() => false),
    };
    await shot(page, 'sidebar-panel-collapsed');
    if (await flyoutButton.count()) {
      await flyoutButton.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await shot(page, 'sidebar-collapsed-libraries-flyout');
      await page.keyboard.press('Escape');
    }
    await collapseToggle.click();
    await page.waitForTimeout(300);
    metrics.collapse.works = true;
  }

  // ── Library nav tree: real parent_id hierarchy under the open library ───
  if (seeded.libTree?.library?.id) {
    await page.goto(`/my-files?library=${seeded.libTree.library.id}`);
    await page.getByTestId('my-files-search-input').waitFor({ timeout: 30_000 });
    const rootNode = page.getByTestId(`my-files-tree-folder-${seeded.libTree.root.id}`);
    await expect(rootNode).toBeVisible({ timeout: 15_000 });
    await shot(page, 'sidebar-library-tree');
    const toggle = page.getByTestId(`my-files-tree-toggle-${seeded.libTree.root.id}`);
    if (await toggle.count()) {
      await toggle.click();
      await expect(page.getByTestId(`my-files-tree-folder-${seeded.libTree.nested.id}`)).toBeVisible();
      await shot(page, 'sidebar-library-tree-expanded');
      metrics.libraryTree = { rootVisible: true, nestedAfterToggle: true };
    }
  }

  // ── Dark theme pass at a narrow width ───────────────────────────────────
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(400);
  metrics.darkOverflow = await measureOverflow(page);
  await shot(page, 'dark-768');
  const card2 = page.locator('[data-testid^="my-files-card-"]').first();
  if (await card2.count()) {
    await card2.click({ button: 'right' });
    await shot(page, 'dark-menu-file');
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({ colorScheme: 'light' });

  await writeFile(`${OUT_DIR}/metrics.json`, JSON.stringify(metrics, null, 2));
});
