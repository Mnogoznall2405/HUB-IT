import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/* global Buffer, document, getComputedStyle, window */

// Name-column readability regression suite (P1, PR #18): the file name must get
// the flexible track at every container width — never collapse to «Инст…».
// Measures real geometry (getBoundingClientRect + resolved gridTemplateColumns)
// on the throwaway local stack and writes screenshots + metrics.json to
// e2e/artifacts/name-columns/.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const OUT_DIR = 'e2e/artifacts/name-columns';

test.skip(!(USERNAME && PASSWORD), 'E2E_USERNAME/E2E_PASSWORD not set');
test.skip(process.env.E2E_LOCAL !== '1', 'needs the isolated local stack');

const SEED_NAMES = [
  'Инструкция IT-invent бот.docx',
  'Приказ по повышению уровня ИБ ЗСПП.pdf',
  'check_in_and_present_work.docx',
  'Подбор рабочего персонала НЗ (5).xlsx',
  'Новый акт.docx',
];

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function seedFiles(page) {
  for (const name of SEED_NAMES) {
    const payload = Buffer.from(`e2e ${name}\n`);
    const sessionResponse = await page.request.post('/api/v1/my-files/upload-sessions', {
      data: {
        file_name: name,
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
}

// Everything worth knowing about the first data row's geometry, in one shot.
async function measureRow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const listPanel = document.querySelector('[data-testid="my-files-drop-zone"]');
    const row = document.querySelector('[data-testid^="my-files-card-"]');
    if (!row) return { error: 'no file row' };
    const cols = getComputedStyle(row).gridTemplateColumns.split(' ').map((v) => parseFloat(v));
    const cells = Array.from(row.children).map((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { width: Math.round(r.width), visible: style.display !== 'none' };
    });
    const nameCell = row.children[1];
    const nameCellRect = nameCell?.getBoundingClientRect();
    const nameText = nameCell?.querySelector('p, [title]');
    const textRect = nameText?.getBoundingClientRect();
    // Icon chrome inside the name cell: type icon box + trailing status icons.
    const iconBits = nameCell ? Array.from(nameCell.querySelectorAll('svg')) : [];
    const iconsWidth = iconBits.reduce((acc, svg) => acc + svg.getBoundingClientRect().width, 0);
    const headerRow = row.parentElement?.querySelector('[data-testid="my-files-sort-name"]')?.parentElement;
    const headerCols = headerRow
      ? getComputedStyle(headerRow).gridTemplateColumns.split(' ').map((v) => parseFloat(v))
      : [];
    const sortLabels = ['my-files-sort-owner', 'my-files-sort-updated', 'my-files-sort-size']
      .map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el && getComputedStyle(el).display !== 'none' ? id : null;
      })
      .filter(Boolean);
    return {
      viewport: window.innerWidth,
      docOverflow: doc.scrollWidth - doc.clientWidth,
      panelWidth: listPanel ? Math.round(listPanel.getBoundingClientRect().width) : null,
      rowWidth: Math.round(row.getBoundingClientRect().width),
      gridCols: cols,
      nameColWidth: cols[1] ?? null,
      nameCellWidth: nameCellRect ? Math.round(nameCellRect.width) : null,
      nameTextWidth: textRect ? Math.round(textRect.width) : null,
      iconsWidth: Math.round(iconsWidth),
      cellWidths: cells.map((c) => c.width),
      visibleSortLabels: sortLabels,
      headerColsMatchRow: headerCols.length === cols.length
        && headerCols.every((v, i) => Math.abs(v - cols[i]) < 1),
    };
  });
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: false });
}

test('name column keeps reading width at every sidebar/details combination', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await seedFiles(page);
  await mkdir(OUT_DIR, { recursive: true });
  const metrics = {};

  await page.goto('/my-files');
  await page.getByTestId('my-files-search-input').waitFor({ timeout: 30_000 });
  await page.getByTestId('my-files-view-list').click().catch(() => {});
  await expect(page.locator('[data-testid^="my-files-card-"]').first()).toBeVisible({ timeout: 30_000 });

  // Ensure the HUB-IT main nav is expanded (pinned sidebar) for the worst case.
  await page.evaluate(() => {
    try { window.localStorage.setItem('sidebar_collapsed', '0'); } catch { /* noop */ }
  });

  const detailsToggle = page.getByTestId('my-files-details-toggle');
  const collapseToggle = page.getByTestId('my-files-nav-collapse-toggle');

  for (const width of [1024, 1280, 1366, 1600, 1920]) {
    // ── Expanded file sidebar, details closed ────────────────────────────
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('[data-testid^="my-files-card-"]').first())
      .toBeVisible({ timeout: 15_000 });
    const base = await measureRow(page);
    metrics[`w${width}`] = base;
    expect(base.docOverflow, `doc overflow at ${width}px`).toBeLessThanOrEqual(0);
    expect(base.headerColsMatchRow, `header/row columns differ at ${width}px`).toBe(true);
    await shot(page, `list-${width}-expanded`);

    // ── Details panel open: the container shrinks, name must adapt ───────
    if (await detailsToggle.isVisible().catch(() => false)) {
      await detailsToggle.click();
      await expect(detailsToggle).toHaveAttribute('aria-pressed', 'true');
      const withDetails = await measureRow(page);
      metrics[`w${width}-details`] = withDetails;
      expect(withDetails.docOverflow, `doc overflow at ${width}px+details`).toBeLessThanOrEqual(0);
      // Narrower container: name must still hold its flexible share.
      const minName = withDetails.panelWidth >= 960 ? 300 : withDetails.panelWidth >= 620 ? 240 : 180;
      expect(withDetails.nameColWidth,
        `name column ${withDetails.nameColWidth}px < ${minName}px at ${width}px+details`)
        .toBeGreaterThanOrEqual(minName);
      await shot(page, `list-${width}-details`);
      await detailsToggle.click();
      await expect(detailsToggle).toHaveAttribute('aria-pressed', 'false');
    }
  }

  // ── Collapsed file sidebar at 1280: freed space must reach the table ────
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  if (await collapseToggle.isVisible().catch(() => false)) {
    const before = await measureRow(page);
    await collapseToggle.click();
    await page.waitForTimeout(450);
    const collapsed = await measureRow(page);
    metrics.w1280collapsed = { before: before.nameColWidth, ...collapsed };
    // The container widens; secondary columns may legitimately reappear, so
    // the name keeps its tier minimum rather than strictly growing.
    expect(collapsed.panelWidth, 'collapsed sidebar must widen the file area')
      .toBeGreaterThan(before.panelWidth);
    expect(collapsed.nameColWidth, 'name column must stay readable after re-tiering')
      .toBeGreaterThanOrEqual(240);
    await shot(page, 'list-1280-file-sidebar-collapsed');
    await collapseToggle.click();
    await page.waitForTimeout(300);
  }

  // ── Narrow viewports: name takes nearly the whole row ──────────────────
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    // Layout mode switches (file sidebar unmounts below lg): wait until the
    // list actually re-renders its rows instead of racing a blank moment.
    await expect(page.locator('[data-testid^="my-files-card-"]').first())
      .toBeVisible({ timeout: 15_000 });
    const m = await measureRow(page);
    metrics[`w${width}`] = m;
    expect(m.docOverflow, `doc overflow at ${width}px`).toBeLessThanOrEqual(0);
    if (m.panelWidth < 620) {
      // Phone tier: the name keeps everything minus checkbox + ⋮ button.
      const reserved = m.rowWidth - m.nameColWidth;
      expect(reserved, `reserved chrome ${reserved}px too wide at ${width}px`)
        .toBeLessThanOrEqual(140);
    } else {
      // Wider tiers may legitimately show secondary columns — the name
      // still keeps its mid-tier minimum.
      expect(m.nameColWidth, `name column too small at ${width}px`)
        .toBeGreaterThanOrEqual(240);
    }
    expect(m.nameTextWidth, `name text area too small at ${width}px`).toBeGreaterThanOrEqual(150);
    await shot(page, `list-${width}`);
  }

  // ── Grid view sanity at 1280 ────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  const gridToggle = page.getByTestId('my-files-view-grid');
  if (await gridToggle.isVisible().catch(() => false)) {
    await gridToggle.click();
    await page.waitForTimeout(400);
    await shot(page, 'grid-1280');
    await page.getByTestId('my-files-view-list').click().catch(() => {});
  }

  await writeFile(`${OUT_DIR}/metrics.json`, JSON.stringify(metrics, null, 2));
});
