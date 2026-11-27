// Issue #89 — измерительный зонд критического пути холодного открытия
// эмодзи-панели. НЕ часть регрессионного гейта: разложение fetch/decode/render
// для решения о sprite-атласе. Прогон: E2E_LOCAL=1, production build.
//
// Замеряет в холодном контексте (чистый HTTP-кэш/module graph):
//  1) полный тайминг каждого запроса /emoji/apple/64/* или /emoji/atlas/*
//     (startTime/responseEnd/размеры) относительно клика — сериализация запросов;
//  2) longtasks в окне открытия;
//  3) стоимость decode: повторный decode тех же изображений в странице
//     (нижняя граница — кэш декодированных изображений) и холодный decode
//     через createImageBitmap из fetch-blob (верхняя граница);
//  4) контрольный сценарий: открытие с ПОЛНОСТЬЮ заблокированными картинками
//     (route abort) — изолирует render-путь без стоимости изображений;
//  5) ту же стадийную разбивку, что perf-харнесс #80.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/* global window, document, performance, requestAnimationFrame, innerHeight, innerWidth, PerformanceObserver, fetch, createImageBitmap, Image, performance */

const USERNAME = process.env.E2E_USERNAME || 'e2e_admin';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const OUT = 'e2e-artifacts/emoji-picker';

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

const installProbe = () => {
  window.__probe = { t0: null, longTasks: [] };
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => window.__probe.longTasks.push({ start: e.startTime, duration: e.duration }));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* unsupported */ }
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-testid="chat-composer-emoji-button"]')) {
      window.__probe.t0 = performance.now();
    }
  }, true);
};

// Стадии как в #80 + время декодирования sprite-листов (если они есть).
const measureStages = (page) => page.evaluate(() => new Promise((resolve) => {
  const t0 = window.__probe.t0 ?? performance.now();
  const marks = {};
  const stamp = (key) => { if (marks[key] === undefined) marks[key] = performance.now() - t0; };
  const deadline = performance.now() + 8000;
  const dockSel = '[data-testid="chat-emoji-dock"]';
  const emojiBtnSel = '.EmojiPickerReact button.epr-emoji';
  const poll = () => {
    const dock = document.querySelector(dockSel);
    if (dock && dock.getBoundingClientRect().width > 0) stamp('dockVisible');
    const btn = document.querySelector(`${dockSel} ${emojiBtnSel}`) || document.querySelector(emojiBtnSel);
    if (btn) {
      stamp('firstEmojiDom');
      const img = btn.querySelector('img');
      if (img && img.complete && img.naturalWidth > 0) stamp('firstEmojiLoaded');
    }
    const search = document.querySelector(`${dockSel} .EmojiPickerReact input`) || document.querySelector('.EmojiPickerReact input');
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

// Ресурсные записи по картинкам эмодзи относительно клика.
const collectResources = (page) => page.evaluate(() => {
  const t0 = window.__probe.t0 ?? 0;
  const entries = performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('/emoji/apple/') || e.name.includes('/emoji-atlas/'));
  return entries.map((e) => ({
    name: e.name.split('/').pop(),
    start: Math.round((e.startTime - t0) * 10) / 10,
    responseEnd: Math.round((e.responseEnd - t0) * 10) / 10,
    duration: Math.round(e.duration * 10) / 10,
    transfer: e.transferSize || 0,
    encoded: e.encodedBodySize || 0,
    decoded: e.decodedBodySize || 0,
    protocol: e.nextHopProtocol || '',
  }));
});

// Стоимость decode: (а) повторный decode тех же PNG — нижняя граница;
// (б) createImageBitmap из свежего blob без кэша — верхняя граница холодного decode.
const measureDecodeCost = (page) => page.evaluate(async () => {
  const entries = performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('/emoji/apple/64/'))
    .slice(0, 180);
  const urls = entries.map((e) => e.name);
  const unique = [...new Set(urls)];
  // (a) warm re-decode через HTMLImageElement (decode cache может помогать)
  const t1 = performance.now();
  await Promise.all(unique.map((u) => {
    const img = new Image();
    img.src = u;
    return img.decode().catch(() => {});
  }));
  const warmDecodeMs = performance.now() - t1;
  // (б) холодный decode из bytes без браузерного image cache
  const t2 = performance.now();
  let totalPixels = 0;
  const bitmaps = await Promise.all(unique.map(async (u) => {
    const blob = await (await fetch(u, { cache: 'no-store' })).blob();
    const bmp = await createImageBitmap(blob);
    totalPixels += bmp.width * bmp.height;
    return bmp;
  }));
  const coldDecodeMs = performance.now() - t2;
  bitmaps.forEach((b) => b.close());
  return {
    count: unique.length,
    warmDecodeMs: Math.round(warmDecodeMs * 10) / 10,
    coldDecodeMs: Math.round(coldDecodeMs * 10) / 10,
    totalPixels,
  };
});

test.describe.configure({ mode: 'serial' });

test('probe: decompose cold-open critical path (fetch/decode/render)', async ({ browser }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const report = { runs: [] };

  for (let i = 0; i < 5; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(installProbe);
    await apiLogin(page);
    await openChat(page);
    await page.getByTestId('chat-composer-emoji-button').click();
    const marks = await measureStages(page);
    const resources = await collectResources(page);
    const longTasks = await page.evaluate(
      (t0) => (window.__probe.longTasks || []).filter((t) => t.start >= t0 - 50 && t.start <= t0 + 2000),
      await page.evaluate(() => window.__probe.t0),
    );
    const decodeCost = i === 0 ? await measureDecodeCost(page) : null;
    report.runs.push({ marks, longTasks, decodeCost, resources: i < 2 ? resources : undefined });
    if (i === 0) {
      // агрегат по ресурсам — только первый прогон, дальше распределения стабильны
      const responseEnds = resources.map((r) => r.responseEnd).sort((a, b) => a - b);
      report.firstRunResourceStats = {
        count: resources.length,
        bytes: resources.reduce((s, r) => s + r.transfer, 0),
        decodedBytes: resources.reduce((s, r) => s + r.decoded, 0),
        firstResponseEnd: responseEnds[0],
        lastResponseEnd: responseEnds[responseEnds.length - 1],
        medianResponseEnd: responseEnds[Math.floor(responseEnds.length / 2)],
        protocols: [...new Set(resources.map((r) => r.protocol))],
      };
    }
    await ctx.close();
  }

  // Контроль: открытие с полностью заблокированными картинками —
  // верхняя граница render-пути без стоимости изображений.
  const blocked = [];
  for (let i = 0; i < 3; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(installProbe);
    await page.route('**/emoji/apple/64/**', (route) => route.abort());
    await page.route('**/emoji-atlas/**', (route) => route.abort());
    await apiLogin(page);
    await openChat(page);
    await page.getByTestId('chat-composer-emoji-button').click();
    // imagesDecoded не наступит — меряем только DOM/interactive стадии
    const marks = await page.evaluate(() => new Promise((resolve) => {
      const t0 = window.__probe.t0 ?? performance.now();
      const marks = {};
      const stamp = (key) => { if (marks[key] === undefined) marks[key] = performance.now() - t0; };
      const deadline = performance.now() + 8000;
      const poll = () => {
        const btn = document.querySelector('.EmojiPickerReact button.epr-emoji');
        if (btn) stamp('firstEmojiDom');
        const search = document.querySelector('.EmojiPickerReact input');
        if (search && search.offsetParent !== null) stamp('interactive');
        if (marks.firstEmojiDom !== undefined && marks.interactive !== undefined) {
          // даём рендеру дорисовать сетку: 5 кадров после первого DOM
          let frames = 0;
          const count = () => {
            frames += 1;
            if (frames >= 5) {
              marks.settled = performance.now() - t0;
              marks.emojiButtons = document.querySelectorAll('.EmojiPickerReact button.epr-emoji').length;
              resolve(marks);
              return;
            }
            requestAnimationFrame(count);
          };
          requestAnimationFrame(count);
          return;
        }
        if (performance.now() > deadline) { resolve(marks); return; }
        requestAnimationFrame(poll);
      };
      poll();
    }));
    blocked.push(marks);
    await ctx.close();
  }
  report.imagesBlockedControl = blocked;

  writeFileSync(`${OUT}/atlas-probe.json`, JSON.stringify(report, null, 2));
  console.log('atlas probe:', JSON.stringify(report.firstRunResourceStats), 'blocked:', JSON.stringify(blocked));
  expect(report.runs.length).toBe(5);
});
