// Issue #89 — interleaved A/B замер cold-open в ОДНОЙ сессии на ОДНОМ билде:
// чётные cold-контексты идут со sprite-атласом, нечётные — с seam-выключенным
// атласом (window.__HUBIT_EMOJI_SPRITE_OFF__, поведение в точности как до #89).
// Чередование убирает дрейф машины между прогонами — ошибка измерения видна
// по разбросу внутри каждой группы. НЕ часть гейта, измерительный зонд.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/* global window, document, performance, requestAnimationFrame, innerHeight, innerWidth, Image */

const USERNAME = process.env.E2E_USERNAME || 'e2e_admin';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const OUT = 'e2e-artifacts/emoji-picker';
const RUNS_PER_MODE = 20;

async function apiLogin(page) {
  const resp = await page.request.post('/api/v1/auth/login', {
    data: { username: USERNAME, password: PASSWORD },
  });
  expect(resp.ok(), 'login').toBeTruthy();
}

async function openChat(page) {
  await page.goto('/chat');
  await expect(
    page.getByTestId('chat-sidebar-desktop-header').or(page.getByTestId('chat-sidebar-list-scroll')).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.locator('[data-chat-active]').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.locator('[data-chat-active]').first().click();
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
}

const installMeasure = () => {
  window.__perf = { t0: null };
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-testid="chat-composer-emoji-button"]')) {
      window.__perf.t0 = performance.now();
    }
  }, true);
};

// Стадийный замер, совместимый с харнессом #80: в sprite-режиме готовность —
// decode листа, в PNG-режиме — complete первого img + decode видимых.
const measureStages = (page) => page.evaluate(() => new Promise((resolve) => {
  const t0 = window.__perf.t0 ?? performance.now();
  const marks = {};
  const stamp = (key) => { if (marks[key] === undefined) marks[key] = performance.now() - t0; };
  const deadline = performance.now() + 8000;
  const dockSel = '[data-testid="chat-emoji-dock"]';
  const emojiBtnSel = '.EmojiPickerReact button.epr-emoji';
  const sheetUrlOf = (el) => {
    if (!el) return null;
    const bg = window.getComputedStyle(el).backgroundImage || '';
    const match = bg.match(/url\("?([^")]*sheet-[\w.-]+\.png)"?\)/);
    return match ? match[1] : null;
  };
  const sheetDecodes = new Map();
  const decodeSheet = (url) => {
    if (!sheetDecodes.has(url)) {
      const im = new Image();
      im.src = url;
      sheetDecodes.set(url, im.decode().catch(() => {}));
    }
    return sheetDecodes.get(url);
  };
  const poll = () => {
    const dock = document.querySelector(dockSel);
    if (dock && dock.getBoundingClientRect().width > 0) stamp('dockVisible');
    const btn = document.querySelector(`${dockSel} ${emojiBtnSel}`) || document.querySelector(emojiBtnSel);
    if (btn) {
      stamp('firstEmojiDom');
      const img = btn.querySelector('img');
      const sheetUrl = sheetUrlOf(btn);
      if (sheetUrl) {
        decodeSheet(sheetUrl).then(() => stamp('firstEmojiLoaded'));
      } else if (img && img.complete && img.naturalWidth > 0) stamp('firstEmojiLoaded');
    }
    const search = document.querySelector(`${dockSel} .EmojiPickerReact input`) || document.querySelector('.EmojiPickerReact input');
    if (search && search.offsetParent !== null) stamp('interactive');
    if (marks.dockVisible !== undefined && marks.firstEmojiLoaded !== undefined && marks.interactive !== undefined) {
      const scope = document.querySelector(dockSel) || document;
      const imgs = [...scope.querySelectorAll(`${emojiBtnSel} img`)].filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      });
      const sheets = new Set();
      imgs.forEach((i) => {
        const url = sheetUrlOf(i.closest('button.epr-emoji') || i);
        if (url) sheets.add(url);
      });
      const sheetWait = Promise.all([...sheets].map((url) => decodeSheet(url)));
      const imgWait = Promise.all(imgs.map((i) => i.decode().catch(() => {})));
      Promise.all([sheetWait, imgWait]).then(() => {
        marks.imagesDecoded = performance.now() - t0;
        marks.visibleEmojiImgs = imgs.length;
        marks.visibleSpriteSheets = sheets.size;
        resolve(marks);
      });
      return;
    }
    if (performance.now() > deadline) { resolve(marks); return; }
    requestAnimationFrame(poll);
  };
  poll();
}));

const collectNet = (page) => page.evaluate(() => {
  const entries = performance.getEntriesByType('resource');
  const pngs = entries.filter((e) => e.name.includes('/emoji/apple/'));
  const sheets = entries.filter((e) => e.name.includes('/emoji-atlas/'));
  return {
    pngCount: pngs.length,
    pngDecodedBytes: pngs.reduce((s, e) => s + (e.decodedBodySize || 0), 0),
    sheetCount: sheets.length,
    sheetDecodedBytes: sheets.reduce((s, e) => s + (e.decodedBodySize || 0), 0),
  };
});

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
  const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1);
  return {
    n: sorted.length,
    p50: Math.round(pick(0.5) * 10) / 10,
    p95: Math.round(pick(0.95) * 10) / 10,
    mean: Math.round(mean * 10) / 10,
    min: Math.round(sorted[0] ?? 0),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  };
};

test.describe.configure({ mode: 'serial' });

test('interleaved A/B: sprite atlas vs individual PNGs, same session same build', async ({ browser }) => {
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  const results = { sprite: [], plain: [] };
  const nets = { sprite: null, plain: null };

  for (let i = 0; i < RUNS_PER_MODE * 2; i += 1) {
    const spriteMode = i % 2 === 0;
    const mode = spriteMode ? 'sprite' : 'plain';
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    if (!spriteMode) {
      await page.addInitScript(() => { window.__HUBIT_EMOJI_SPRITE_OFF__ = true; });
    }
    await page.addInitScript(installMeasure);
    await apiLogin(page);
    await openChat(page);
    await page.getByTestId('chat-composer-emoji-button').click();
    const marks = await measureStages(page);
    if (!nets[mode]) nets[mode] = await collectNet(page);
    results[mode].push(marks);
    console.log(`[ab] ${mode} run ${Math.floor(i / 2)}: dom=${Math.round(marks.firstEmojiDom)} loaded=${Math.round(marks.firstEmojiLoaded)} decoded=${Math.round(marks.imagesDecoded)}`);
    await ctx.close();
  }

  const report = {
    runsPerMode: RUNS_PER_MODE,
    measuredAt: new Date().toISOString(),
    nets,
    sprite: {
      firstEmojiDom: stats(results.sprite.map((m) => m.firstEmojiDom).filter(Number.isFinite)),
      firstEmojiLoaded: stats(results.sprite.map((m) => m.firstEmojiLoaded).filter(Number.isFinite)),
      imagesDecoded: stats(results.sprite.map((m) => m.imagesDecoded).filter(Number.isFinite)),
      interactive: stats(results.sprite.map((m) => m.interactive).filter(Number.isFinite)),
    },
    plain: {
      firstEmojiDom: stats(results.plain.map((m) => m.firstEmojiDom).filter(Number.isFinite)),
      firstEmojiLoaded: stats(results.plain.map((m) => m.firstEmojiLoaded).filter(Number.isFinite)),
      imagesDecoded: stats(results.plain.map((m) => m.imagesDecoded).filter(Number.isFinite)),
      interactive: stats(results.plain.map((m) => m.interactive).filter(Number.isFinite)),
    },
    raw: results,
  };
  writeFileSync(`${OUT}/atlas-ab.json`, JSON.stringify(report, null, 2));
  console.log('A/B report:', JSON.stringify({ sprite: report.sprite, plain: report.plain, nets }, null, 1));
  expect(results.sprite.length).toBe(RUNS_PER_MODE);
  expect(results.plain.length).toBe(RUNS_PER_MODE);
});
