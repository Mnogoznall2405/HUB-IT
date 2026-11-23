// Инструментальное профилирование emoji/sticker picker (отдельный, долгий
// спек): разбивка задержки по стадиям, p50/p95 на 20 прогонах холодного и
// тёплого сценариев, задержка hover-превью, переключение вкладок, память
// за 100 циклов открытия, longtask на главном потоке и сетевая статистика
// изображений. Результаты — JSON в e2e-artifacts/emoji-picker/perf-deep.json.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/* global window, document, performance, requestAnimationFrame, innerHeight, innerWidth, console, PerformanceObserver, process */

const USERNAME = process.env.E2E_USERNAME || 'e2e_admin';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const SHOTS = 'e2e-artifacts/emoji-picker';
const RUNS = 20;

async function apiLogin(page, username = USERNAME, password = PASSWORD) {
  const resp = await page.request.post('/api/v1/auth/login', {
    data: { username, password },
  });
  expect(resp.ok(), `login ${username}`).toBeTruthy();
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

// Фиксирует t0 в capture-фазе клика по кнопке (до React-обработчика) и
// опрашивает стадии готовности каждый кадр. «Полезное содержимое» — первый
// видимый эмодзи с реально загруженной картинкой; «готовность» — все
// видимые картинки декодированы + поиск фокусируем.
const installMeasure = () => {
  window.__perf = { t0: null };
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => window.__longTasks.push({ start: e.startTime, duration: e.duration }));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported */ }
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-testid="chat-composer-emoji-button"]')) {
      window.__perf.t0 = performance.now();
    }
  }, true);
};

const measureStages = (page) => page.evaluate(() => new Promise((resolve) => {
  const t0 = window.__perf.t0 ?? performance.now();
  const marks = {};
  const stamp = (key) => { if (marks[key] === undefined) marks[key] = performance.now() - t0; };
  const deadline = performance.now() + 20000;
  const dockSel = '[data-testid="chat-emoji-dock"]';
  const emojiBtnSel = '.EmojiPickerReact button.epr-emoji';
  const searchSel = '.EmojiPickerReact input';
  const poll = () => {
    const dock = document.querySelector(dockSel);
    if (dock && dock.getBoundingClientRect().width > 0) stamp('dockVisible');
    const btn = document.querySelector(`${dockSel} ${emojiBtnSel}`) || document.querySelector(emojiBtnSel);
    if (btn) {
      stamp('firstEmojiDom');
      const img = btn.querySelector('img');
      if (img && img.complete && img.naturalWidth > 0) stamp('firstEmojiLoaded');
    }
    const search = document.querySelector(`${dockSel} ${searchSel}`) || document.querySelector(searchSel);
    if (search && search.offsetParent !== null) stamp('interactive');
    if (marks.dockVisible !== undefined && marks.firstEmojiLoaded !== undefined && marks.interactive !== undefined) {
      const scope = document.querySelector(dockSel) || document;
      const imgs = [...scope.querySelectorAll(`${emojiBtnSel} img`)].filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      });
      Promise.all(imgs.map((i) => i.decode().catch(() => {}))).then(() => {
        marks.imagesDecoded = performance.now() - t0;
        marks.visibleEmojiImgs = imgs.length;
        resolve(marks);
      });
      return;
    }
    if (performance.now() > deadline) { resolve(marks); return; }
    requestAnimationFrame(poll);
  };
  poll();
}));

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
  return {
    n: sorted.length,
    p50: Math.round(pick(0.5)),
    p95: Math.round(pick(0.95)),
    min: Math.round(sorted[0] ?? 0),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  };
};

const resourceStats = (page) => page.evaluate(() => {
  const entries = performance.getEntriesByType('resource');
  const chunks = entries.filter((e) => e.initiatorType === 'script' || e.name.includes('/assets/'))
    .filter((e) => /moji|Emoji|chat/i.test(e.name));
  const emojiImgs = entries.filter((e) => e.name.includes('/emoji/apple/'));
  const pick = (list, name) => list.find((e) => e.name.includes(name));
  return {
    chunks: chunks.map((e) => ({
      name: e.name.split('/').pop(),
      responseEnd: Math.round(e.responseEnd),
      transferKB: Math.round((e.transferSize || 0) / 1024),
      decodedKB: Math.round((e.decodedBodySize || 0) / 1024),
    })),
    emojiChunkEnd: pick(chunks, 'emoji')?.responseEnd ?? null,
    emojiImgCount: emojiImgs.length,
    emojiImgBytes: emojiImgs.reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0),
    emojiImgDecodedBytes: emojiImgs.reduce((s, e) => s + (e.decodedBodySize || 0), 0),
  };
});

test.describe.configure({ mode: 'serial' });

test('deep perf: cold/warm stages, p50/p95 over 20 runs', async ({ browser }) => {
  test.setTimeout(600_000);
  const cold = [];
  const warm = [];
  const failures = { failedEmojiImgs: 0 };

  // ── Холодный: новый контекст = чистый module graph и HTTP-кэш ──
  for (let i = 0; i < RUNS; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('response', (r) => {
      if (r.url().includes('/emoji/apple/') && !r.ok()) failures.failedEmojiImgs += 1;
    });
    await page.addInitScript(installMeasure);
    await apiLogin(page);
    await openChat(page);
    await page.getByTestId('chat-composer-emoji-button').click();
    const marks = await measureStages(page);
    if (i === 0) {
      const res = await resourceStats(page);
      marks.resources = res;
    }
    marks.longTasks = await page.evaluate(
      (t0) => (window.__longTasks || []).filter((t) => t.start >= t0 - 50 && t.start <= t0 + (window.__lastEnd || 3000)),
      await page.evaluate(() => window.__perf.t0),
    );
    cold.push(marks);
    await ctx.close();
  }

  // ── Тёплый: та же страница, док открывается/закрывается ──
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(installMeasure);
  await apiLogin(page);
  await openChat(page);
  const button = page.getByTestId('chat-composer-emoji-button');
  const dock = page.getByTestId('chat-emoji-dock');
  // Первое открытие прогревает чанки — дальше меряем только повторные.
  await button.click();
  await measureStages(page);
  await page.getByTestId('chat-emoji-dock-close').click();
  await expect(dock).toBeHidden();

  // Longtask-оценка стоимости reopen на главном потоке (render+commit+layout).
  const warmLtBase = await page.evaluate(() => (window.__longTasks || []).length);
  for (let i = 0; i < RUNS; i += 1) {
    await button.click();
    const marks = await measureStages(page);
    warm.push(marks);
    await page.getByTestId('chat-emoji-dock-close').click();
    await expect(dock).toBeHidden();
  }
  const warmLongTasks = await page.evaluate(
    (base) => (window.__longTasks || []).slice(base).map((t) => t.duration),
    warmLtBase,
  );

  // ── Переключение вкладок ──
  await button.click();
  await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 20_000 });
  const toStickers = [];
  const backToEmoji = [];
  for (let i = 0; i < RUNS; i += 1) {
    const t1 = Date.now();
    await dock.getByRole('tab', { name: 'Стикеры' }).click();
    await expect(
      dock.locator('[data-sticker-section], .MuiAlert-root, :text("Добавьте первый набор")').first(),
    ).toBeVisible({ timeout: 15_000 });
    toStickers.push(Date.now() - t1);
    const t2 = Date.now();
    await dock.getByRole('tab', { name: 'Эмодзи' }).click();
    await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 15_000 });
    backToEmoji.push(Date.now() - t2);
  }

  // ── Hover-delay: pointerenter → поповер видим ──
  await page.getByTestId('chat-emoji-dock-close').click();
  await expect(dock).toBeHidden();
  const hoverDelays = [];
  const popover = page.getByTestId('chat-desktop-emoji-panel');
  for (let i = 0; i < RUNS; i += 1) {
    const t = Date.now();
    await button.hover();
    await expect(popover).toBeVisible({ timeout: 5000 });
    hoverDelays.push(Date.now() - t);
    await page.mouse.move(700, 300);
    await expect(popover).toBeHidden({ timeout: 5000 });
    await page.waitForTimeout(120);
  }

  // ── Память: 100 циклов открытия/закрытия ──
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
  const domBefore = await page.evaluate(() => document.querySelectorAll('*').length);
  for (let i = 0; i < 100; i += 1) {
    await button.click();
    await expect(dock).toBeVisible();
    await page.getByTestId('chat-emoji-dock-close').click();
    await expect(dock).toBeHidden();
  }
  await page.waitForTimeout(1000);
  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
  const domAfter = await page.evaluate(() => document.querySelectorAll('*').length);

  await ctx.close();

  const report = {
    runs: RUNS,
    viewport: '1440x900',
    cold: {
      dockVisible: stats(cold.map((m) => m.dockVisible).filter(Number.isFinite)),
      firstEmojiDom: stats(cold.map((m) => m.firstEmojiDom).filter(Number.isFinite)),
      firstEmojiLoaded: stats(cold.map((m) => m.firstEmojiLoaded).filter(Number.isFinite)),
      imagesDecoded: stats(cold.map((m) => m.imagesDecoded).filter(Number.isFinite)),
      interactive: stats(cold.map((m) => m.interactive).filter(Number.isFinite)),
      visibleEmojiImgs: cold[0]?.visibleEmojiImgs ?? null,
      resources: cold[0]?.resources ?? null,
      longTasks: cold.flatMap((m) => m.longTasks || []).length,
      failedEmojiImgs: failures.failedEmojiImgs,
    },
    warm: {
      dockVisible: stats(warm.map((m) => m.dockVisible).filter(Number.isFinite)),
      firstEmojiDom: stats(warm.map((m) => m.firstEmojiDom).filter(Number.isFinite)),
      firstEmojiLoaded: stats(warm.map((m) => m.firstEmojiLoaded).filter(Number.isFinite)),
      imagesDecoded: stats(warm.map((m) => m.imagesDecoded).filter(Number.isFinite)),
      interactive: stats(warm.map((m) => m.interactive).filter(Number.isFinite)),
    },
    tabs: { toStickers: stats(toStickers), backToEmoji: stats(backToEmoji) },
    hoverDelay: stats(hoverDelays),
    warmLongTaskMs: stats(warmLongTasks),
    memory100Cycles: {
      heapBeforeMB: Math.round(heapBefore / 1048576 * 10) / 10,
      heapAfterMB: Math.round(heapAfter / 1048576 * 10) / 10,
      domNodesBefore: domBefore,
      domNodesAfter: domAfter,
    },
    measuredAt: new Date().toISOString(),
  };
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/perf-deep.json`, JSON.stringify(report, null, 2));
  console.log('emoji-picker deep perf:', JSON.stringify(report, null, 2));
  // Мягкая проверка: стадии вообще измерились.
  expect(report.cold.firstEmojiLoaded.n).toBeGreaterThan(0);
  expect(report.warm.firstEmojiLoaded.n).toBeGreaterThan(0);
});
