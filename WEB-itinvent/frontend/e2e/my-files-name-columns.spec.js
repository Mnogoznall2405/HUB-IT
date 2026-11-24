import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/* global Buffer, document, getComputedStyle, process, window */

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
  // Deliberately longer than any realistic name column — must degrade to a
  // long visible prefix with one ellipsis, never to 4–8 characters.
  'Очень длинное название документа для проверки обрезания текста в колонке названия файлового менеджера.xlsx',
];

// The favorited file carries a status star inside the name cell — it must not
// eat the text width.
const FAVORITE_NAME = SEED_NAMES[1];

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

// Fail-fast seeding: every stage of upload-session/chunk/complete must succeed,
// and the file must actually appear in the listing — a silent skip here used to
// turn readability assertions into false positives on an empty folder.
async function seedFiles(page) {
  const fileIds = [];
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
    expect(sessionResponse.ok(),
      `upload-session ${name}: ${sessionResponse.status()} ${await sessionResponse.text()}`)
      .toBe(true);
    const session = await sessionResponse.json();
    const fileId = String(session.file_id || session.id || '');
    expect(fileId, `upload-session ${name}: missing file_id in ${JSON.stringify(session)}`)
      .toBeTruthy();
    const chunk = await page.request.put(
      `/api/v1/my-files/upload-sessions/${fileId}/chunks?offset=0`,
      { data: payload, headers: { 'Content-Type': 'application/octet-stream' } },
    );
    expect(chunk.ok(), `chunk ${fileId} (${name}): ${chunk.status()}`).toBe(true);
    const complete = await page.request.post(`/api/v1/my-files/upload-sessions/${fileId}/complete`);
    expect(complete.ok(), `complete ${fileId} (${name}): ${complete.status()}`).toBe(true);
    fileIds.push({ name, fileId });
  }

  // The seeded set must be visible in the listing — verify via the same API
  // the page itself uses.
  const list = await page.request.get('/api/v1/my-files');
  expect(list.ok(), `file list after seed: ${list.status()}`).toBe(true);
  const listedNames = JSON.stringify(await list.json());
  for (const { name } of fileIds) {
    expect(listedNames, `seeded file absent from /my-files listing: ${name}`)
      .toContain(name);
  }

  // A status icon inside the name cell must not eat the name: mark one file
  // favorite and verify the flag round-trips through the listing.
  const favorite = fileIds.find((f) => f.name === FAVORITE_NAME);
  const patch = await page.request.patch(`/api/v1/my-files/${favorite.fileId}`, {
    data: { is_favorite: true },
  });
  expect(patch.ok(), `favorite ${favorite.fileId}: ${patch.status()}`).toBe(true);
}

// Everything worth knowing about the row geometry AND actual readability, in
// one shot: per-row name text width and clipped fraction, not just the first row.
async function measureRow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const listPanel = document.querySelector('[data-testid="my-files-drop-zone"]');
    const rows = Array.from(document.querySelectorAll('[data-testid^="my-files-card-"]'))
      .filter((r) => r.getBoundingClientRect().width > 0);
    const row = rows[0];
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
    // Per-row readability: how much of each file name is actually rendered.
    const readability = rows.map((r) => {
      const cell = r.children[1];
      const textEl = cell?.querySelector('p, [title]');
      if (!textEl) return null;
      const client = textEl.getBoundingClientRect().width;
      const full = textEl.scrollWidth;
      const svgs = Array.from(cell.querySelectorAll('svg'));
      return {
        name: (textEl.getAttribute('title') || textEl.textContent || '').trim(),
        textWidth: Math.round(client),
        fullTextWidth: Math.round(full),
        // >1 means clipped; 1.0 = fully visible.
        clipRatio: full > 0 ? Math.round((client / full) * 100) / 100 : null,
        icons: svgs.length,
        iconsWidth: Math.round(svgs.reduce((a, s) => a + s.getBoundingClientRect().width, 0)),
      };
    }).filter(Boolean);
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
      readability,
      headerColsMatchRow: headerCols.length === cols.length
        && headerCols.every((v, i) => Math.abs(v - cols[i]) < 1),
    };
  });
}

// Readability assertions shared by every configuration: no seeded name may be
// squeezed to a 4–8 character stub, and the wide tier must show realistic
// names in full.
function expectReadableNames(m, label) {
  expect(m.readability?.length, `${label}: no rows measured`).toBeGreaterThanOrEqual(5);
  for (const r of m.readability) {
    // A short name («Новый акт.docx» ≈ 90px) is fully visible below 150px — the
    // real defect is a long name squeezed to a stub, so require the lesser of
    // 150px and the name's own full width.
    const readableFloor = Math.min(150, r.fullTextWidth || 150);
    expect(r.textWidth, `${label}: «${r.name}» shows only ${r.textWidth}px of text`)
      .toBeGreaterThanOrEqual(readableFloor);
    expect(r.iconsWidth, `${label}: «${r.name}» status icons eat ${r.iconsWidth}px`)
      .toBeLessThanOrEqual(80);
  }
  if (m.panelWidth >= 960) {
    // Wide tier: every name except the deliberately extreme one renders fully.
    for (const r of m.readability) {
      const isExtreme = r.name.startsWith('Очень длинное название');
      expect(r.clipRatio, `${label}: «${r.name}» clipped to ${r.clipRatio} on a ${m.panelWidth}px panel`)
        .toBeGreaterThanOrEqual(isExtreme ? 0.4 : 0.85);
    }
  }
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
    expectReadableNames(base, `${width}px expanded`);
    await shot(page, `list-${width}-expanded`);

    // ── Details panel open: the container shrinks, name must adapt ───────
    if (await detailsToggle.isVisible().catch(() => false)) {
      await detailsToggle.click();
      await expect(detailsToggle).toHaveAttribute('aria-pressed', 'true');
      const withDetails = await measureRow(page);
      metrics[`w${width}-details`] = withDetails;
      expect(withDetails.docOverflow, `doc overflow at ${width}px+details`).toBeLessThanOrEqual(0);
      expectReadableNames(withDetails, `${width}px+details`);
      // Narrower container: name must still hold its flexible share.
      const minName = withDetails.panelWidth >= 960 ? 300 : withDetails.panelWidth >= 620 ? 240 : 180;
      expect(withDetails.nameColWidth,
        `name column ${withDetails.nameColWidth}px < ${minName}px at ${width}px+details`)
        .toBeGreaterThanOrEqual(minName);
      await shot(page, `list-${width}-details`);
      // Below lg the panel is a temporary Drawer whose modal backdrop swallows
      // the toggle click — close it via Escape (the drawer's own onClose).
      const detailsDrawer = page.locator('.MuiDrawer-modal:has([data-testid="my-files-details-panel"])');
      if (await detailsDrawer.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
      } else {
        await detailsToggle.click();
      }
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
    expectReadableNames(m, `${width}px`);
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
