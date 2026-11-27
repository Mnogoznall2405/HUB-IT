// Инструментальное профилирование emoji/sticker picker (отдельный, долгий
// спек): разбивка задержки по стадиям, p50/p95 на 20 прогонах холодного и
// тёплого сценариев, задержка hover-превью, переключение вкладок, память
// за 100 циклов открытия, longtask на главном потоке и сетевая статистика
// изображений. Результаты — JSON в e2e-artifacts/emoji-picker/perf-deep.json.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installEmojiPanelVisibility } from './perf/emoji-panel-visibility.js';

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
// Phase 2: дополнительно считает React-коммиты и ЧИСЛО ОТРЕНДЕРЕННЫХ
// компонентов в каждом коммите (обход fiber-дерева по флагу PerformedWork),
// а также DOM-мутации внутри ленты сообщений — «лишние обновления истории».
const installMeasure = () => {
  window.__perf = { t0: null, commits: [], scrollMuts: [], profiles: {} };
  window.__longTasks = [];
  const listeners = {};
  const hook = {
    renderers: new Map(),
    listeners,
    checkDCE(fn) { try { fn(); } catch { /* noop */ } },
    supportsFiber: true,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    sub(event, fn) {
      const id = Object.keys(listeners).length + 1;
      (listeners[event] = listeners[event] || []).push([id, fn]);
      return id;
    },
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    off(event, fn) {
      const list = listeners[event];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit(event, ...args) {
      (listeners[event] || []).forEach((entry) => {
        const fn = Array.isArray(entry) ? entry[1] : entry;
        try { fn(...args); } catch { /* noop */ }
      });
    },
    getFiberRoots() { return new Set(); },
    onCommitFiberRoot(id, root) {
      let rendered = 0;
      let threadRendered = 0;
      try {
        // visited-set + жёсткий лимит: конкурентный рендер может отдать
        // дерево с циклом — без защиты обход замораживает main thread.
        const seen = new Set();
        const thread = document.querySelector('[data-testid="chat-thread-scroll"]');
        const stack = [root.current];
        while (stack.length && seen.size < 100000) {
          const f = stack.pop();
          if (!f || seen.has(f)) continue;
          seen.add(f);
          if (f.flags & 1) { // PerformedWork — компонент реально рендерился
            rendered += 1;
            if (thread && f.stateNode instanceof Element && thread.contains(f.stateNode)) threadRendered += 1;
          }
          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
        }
      } catch { rendered = -1; }
      window.__perf.commits.push({ t: performance.now(), rendered, threadRendered });
    },
    onCommitFiberUnmount() {},
    onScheduleFiberRoot() {},
  };
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook });
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => window.__longTasks.push({ start: e.startTime, duration: e.duration }));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported */ }
  // Мутации внутри ленты сообщений: сигнал «история тронулась» при открытии.
  new MutationObserver((list) => {
    const scroll = document.querySelector('[data-testid="chat-thread-scroll"]');
    if (!scroll) return;
    let inside = 0;
    for (const m of list) { if (scroll.contains(m.target)) inside += 1; }
    if (inside) window.__perf.scrollMuts.push({ t: performance.now(), n: inside });
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, characterData: true,
  });
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-testid="chat-composer-emoji-button"]')) {
      window.__perf.t0 = performance.now();
    }
  }, true);
};

const measureStages = (page) => page.evaluate(() => new Promise((resolve) => {
  const t0 = window.__perf.t0 ?? performance.now();
  const marks = {};
  const stamp = (key) => {
    if (marks[key] !== undefined) return;
    marks[key] = performance.now() - t0;
    try { performance.mark(`issue80-${key}`); } catch { /* noop */ }
  };
  const deadline = performance.now() + 8000;
  const dockSel = '[data-testid="chat-emoji-dock"]';
  const emojiBtnSel = '.EmojiPickerReact button.epr-emoji';
  const searchSel = '.EmojiPickerReact input';
  // Видимость — только через window.__emojiVis (e2e/perf/emoji-panel-visibility.js):
  // после фикса #88 скрытый keep-alive док имеет visibility:hidden и СОХРАНЯЕТ
  // геометрию — проверки по rect.width/offsetParent ложно считают его видимым.
  const vis = window.__emojiVis;
  const poll = () => {
    const dock = document.querySelector(dockSel);
    if (dock && vis.userVisible(dock)) stamp('dockVisible');
    const btn = document.querySelector(`${dockSel} ${emojiBtnSel}`) || document.querySelector(emojiBtnSel);
    if (btn) {
      stamp('firstEmojiDom');
      const img = btn.querySelector('img');
      if (img && img.complete && img.naturalWidth > 0 && vis.userVisible(btn)) stamp('firstEmojiLoaded');
    }
    const search = document.querySelector(`${dockSel} ${searchSel}`) || document.querySelector(searchSel);
    if (search && !search.disabled && vis.userVisible(search)) stamp('interactive');
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
    await page.addInitScript(installEmojiPanelVisibility);
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
  await page.addInitScript(installEmojiPanelVisibility);
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

// ── Phase 2: атрибуция задержки ────────────────────────────────────────────
// Для каждого действия фиксируем не только время, но и ЧТО именно работало:
// число React-коммитов, суммарное число отрендеренных компонентов (PerformedWork),
// мутации внутри ленты сообщений и CDP-трейс (layout/style/paint/script).
const captureTrace = async (page, cdp, file) => {
  const chunks = [];
  const handler = (p) => chunks.push(...(p.value || []));
  cdp.on('Tracing.dataCollected', handler);
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-v8.cpu_profiler',
    options: 'sampling-frequency=10000',
  });
  return async () => {
    await cdp.send('Tracing.end');
    await new Promise((resolve) => {
      cdp.once('Tracing.tracingComplete', resolve);
      setTimeout(resolve, 10_000);
    });
    cdp.off('Tracing.dataCollected', handler);
    writeFileSync(file, JSON.stringify({ traceEvents: chunks }));
    return chunks;
  };
};

// Суммарное время по типам событий трейса (мкс → мс).
const traceSummary = (events) => {
  const sums = {};
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    if (!/Layout|Style|Paint|Script|Parse|Function|Task|Composite|HitTest|PrePaint|Animation/i.test(e.name)) continue;
    sums[e.name] = (sums[e.name] || 0) + e.dur / 1000;
  }
  return Object.fromEntries(
    Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([k, v]) => [k, Math.round(v * 10) / 10]),
  );
};

// Коммиты и мутации ленты в окне [t0, t0+windowMs] — атрибуция «кто работал».
const collectAttribution = (page, t0, windowMs = 4000) => page.evaluate(
  ({ t0: t, windowMs: w }) => {
    const commits = window.__perf.commits.filter((c) => c.t >= t - 2 && c.t <= t + w);
    const scrollMuts = window.__perf.scrollMuts
      .filter((m) => m.t >= t - 2 && m.t <= t + w)
      .reduce((s, m) => s + m.n, 0);
    return {
      commitCount: commits.length,
      renderedComponents: commits.reduce((s, c) => s + Math.max(0, c.rendered), 0),
      maxRenderedPerCommit: commits.reduce((m, c) => Math.max(m, c.rendered), 0),
      threadRenderedComponents: commits.reduce((s, c) => s + Math.max(0, c.threadRendered || 0), 0),
      profiles: JSON.parse(JSON.stringify(window.__perf.profiles || {})),
      scrollMutations: scrollMuts,
      longTasks: (window.__longTasks || []).filter((lt) => lt.start >= t - 2 && lt.start <= t + w)
        .map((lt) => Math.round(lt.duration)),
    };
  },
  { t0, windowMs },
);

test('phase2 attribution: rendered components, list churn, layout cost', async ({ browser }) => {
  test.setTimeout(600_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(installMeasure);
  await page.addInitScript(installEmojiPanelVisibility);
  await apiLogin(page);
  await openChat(page);
  const cdp = await ctx.newCDPSession(page);
  const button = page.getByTestId('chat-composer-emoji-button');
  const dock = page.getByTestId('chat-emoji-dock');
  const popover = page.getByTestId('chat-desktop-emoji-panel');
  mkdirSync(SHOTS, { recursive: true });

  // Закрыть возможно открывшийся по hover-гонке поповер: его невидимый
  // MUI-backdrop перехватывает все клики страницы и блокирует dock-close.
  const dismissPopover = async () => {
    if (await popover.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden({ timeout: 5000 });
    }
  };

  // Закрыть док пользовательским путём — повторный клик по кнопке
  // (контракт контроллера: pinned → close). Крестик в шапке дока
  // не используем: при keep-alive скрытом доке его нет в доступном DOM.
  const closeDockIfOpen = async () => {
    await dismissPopover();
    if (await dock.isVisible().catch(() => false)) {
      await button.click({ timeout: 10_000 });
      await expect(dock).toBeHidden({ timeout: 10_000 });
    }
  };

  // Прогрев чанков и keep-alive — дальше только повторные открытия.
  await button.click();
  await measureStages(page);
  await closeDockIfOpen();

  const attr = { pinnedOpen: [], pinnedClose: [], popoverOpen: [], toStickers: [], backToEmoji: [] };
  const ATTR_RUNS = 5;

  for (let i = 0; i < ATTR_RUNS; i += 1) {
    console.log(`[attr] pinned iter ${i} start ${Date.now()}`);
    // ── Pinned open ──
    // CDP-трейс отключён: cpu_profiler замедляет страницу в 5–10 раз и
    // ломает бюджет теста. Атрибуция Layout/JS собрана в отдельном прогоне.
    const stopTrace = null;
    const t0 = await page.evaluate(() => { window.__perf.t0 = performance.now(); window.__perf.profiles = {}; return performance.now(); });
    await button.click();
    console.log(`[attr] iter ${i} clicked ${Date.now()}`);
    const marks = await measureStages(page);
    console.log(`[attr] iter ${i} measured ${Date.now()} marks=${JSON.stringify(marks)}`);
    const a = await collectAttribution(page, t0);
    a.stageMs = marks;
    attr.pinnedOpen.push(a);
    if (stopTrace) attr.tracePinnedOpen = traceSummary(await stopTrace());
    console.log(`[attr] iter ${i} trace done ${Date.now()}`);

    // ── Pinned close ──
    const t1 = await page.evaluate(() => { window.__perf.profiles = {}; return performance.now(); });
    await closeDockIfOpen();
    await page.waitForTimeout(150);
    attr.pinnedClose.push(await collectAttribution(page, t1));
    console.log(`[attr] iter ${i} closed ${Date.now()}`);
  }
  console.log('[attr] pinned loop done');

  // ── Hover popover: задержка от pointerenter до видимого поповера (внутри страницы) ──
  for (let i = 0; i < ATTR_RUNS; i += 1) {
    await page.mouse.move(700, 300);
    await expect(popover).toBeHidden({ timeout: 5000 });
    // Отметка ставится ВНУТРИ страницы на pointerenter кнопки — исключает
    // задержку Playwright-команды из измерения реальной latency. Слушатель
    // устанавливается отдельно: если React пересоздаст узел, t0 упадёт в
    // fallback вместо бесконечного ожидания.
    await page.evaluate(() => {
      window.__perf.hoverT0 = null;
      window.__perf.profiles = {};
      document.addEventListener('pointerenter', (e) => {
        if (window.__perf.hoverT0 === null
            && e.target instanceof Element
            && e.target.closest('[data-testid="chat-composer-emoji-button"]')) {
          window.__perf.hoverT0 = performance.now();
        }
      }, true);
      document.addEventListener('pointerover', (e) => {
        if (window.__perf.hoverT0 === null
            && e.target instanceof Element
            && e.target.closest('[data-testid="chat-composer-emoji-button"]')) {
          window.__perf.hoverT0 = performance.now();
        }
      }, true);
    });
    await button.hover();
    await expect(popover).toBeVisible({ timeout: 5000 });
    const t0 = await page.evaluate(() => window.__perf.hoverT0 ?? performance.now() - 150);
    console.log(`[attr] popover iter ${i} hoverT0 ok`);
    const a = await collectAttribution(page, t0);
    a.hoverMs = await page.evaluate((t) => {
      const pop = document.querySelector('[data-testid="chat-desktop-emoji-panel"]');
      return pop ? performance.now() - t : -1;
    }, t0);
    attr.popoverOpen.push(a);
  }

  // ── Переключение вкладок в pinned-доке (внутристраничный замер) ──
  console.log('[attr] popover loop done, tab loop');
  await page.mouse.move(700, 300);
  await expect(popover).toBeHidden({ timeout: 5000 });
  await button.click();
  await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < ATTR_RUNS; i += 1) {
    const dockState = async (tag) => {
      const s = await page.evaluate(() => {
        const d = document.querySelector('[data-testid="chat-emoji-dock"]');
        const p = document.querySelector('[data-testid="chat-desktop-emoji-panel"]');
        return `dock=${d ? (d.getBoundingClientRect().width > 0 ? 'vis' : 'hidden') : 'absent'}`
          + ` pop=${p ? (p.getBoundingClientRect().width > 0 ? 'vis' : 'hidden') : 'absent'}`;
      });
      console.log(`[attr] tab iter ${i} ${tag}: ${s}`);
    };
    const stopTrace = null;
    const t0 = await page.evaluate(() => { window.__perf.profiles = {}; return performance.now(); });
    await dockState('pre-stickers');
    await dock.getByRole('tab', { name: 'Стикеры' }).click();
    await expect(
      dock.locator('[data-sticker-section], .MuiAlert-root, :text("Добавьте первый набор")').first(),
    ).toBeVisible({ timeout: 15_000 });
    const a = await collectAttribution(page, t0);
    a.ms = await page.evaluate((t) => performance.now() - t, t0);
    attr.toStickers.push(a);
    if (stopTrace) attr.traceTabSwitch = traceSummary(await stopTrace());
    await dockState('pre-emoji');
    const t1 = await page.evaluate(() => { window.__perf.profiles = {}; return performance.now(); });
    await dock.getByRole('tab', { name: 'Эмодзи' }).click();
    await dockState('post-emoji');
    await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 15_000 });
    const b = await collectAttribution(page, t1);
    b.ms = await page.evaluate((t) => performance.now() - t, t1);
    attr.backToEmoji.push(b);
  }

  // ── Ширина переписки при pinned: реальная стоимость сжатия колонки ──
  const threadWidth = async () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-thread-scroll"]');
    return el ? Math.round(el.getBoundingClientRect().width) : null;
  });
  await expect(dock).toBeVisible();
  const wOpen = await threadWidth();
  await closeDockIfOpen();
  const wClosed = await threadWidth();
  await expect(dock).toBeHidden();

  // ── Positive control: отправка сообщения обязана дать апдейт
  // ChatMessageList в profiles. Пустой profiles = сборка не profiling,
  // и тогда «actual=0» в остальных сценариях ничего не доказывает.
  await page.evaluate(() => { window.__perf.profiles = {}; });
  const ctrlMsgCount = await page.locator('[data-message-id]').count();
  const ta = page.getByTestId('chat-composer-textarea');
  await ta.fill(`perf-control-${Date.now()}`);
  await ta.press('Enter');
  await expect(page.locator('[data-message-id]')).toHaveCount(ctrlMsgCount + 1, { timeout: 15_000 });
  await page.waitForTimeout(300);
  const positiveControl = await page.evaluate(() => window.__perf.profiles || {});
  const controlList = positiveControl['chat-message-list'] || { mount: 0, update: 0 };
  const controlOk = (controlList.mount + controlList.update) > 0;

  const summarize = (list) => ({
    commits: stats(list.map((x) => x.commitCount)),
    renderedComponents: stats(list.map((x) => x.renderedComponents)),
    maxRenderedPerCommit: stats(list.map((x) => x.maxRenderedPerCommit)),
    threadRenderedComponents: stats(list.map((x) => x.threadRenderedComponents ?? 0)),
    scrollMutations: stats(list.map((x) => x.scrollMutations)),
    longTasks: list.flatMap((x) => x.longTasks).length,
    ms: stats(list.map((x) => x.ms).filter(Number.isFinite)),
    hoverMs: stats(list.map((x) => x.hoverMs).filter(Number.isFinite)),
    stageDockVisible: stats(list.map((x) => x.stageMs?.dockVisible).filter(Number.isFinite)),
    stageFirstLoaded: stats(list.map((x) => x.stageMs?.firstEmojiLoaded).filter(Number.isFinite)),
    profiles: list.map((x) => x.profiles),
  });

  const report2 = {
    runs: ATTR_RUNS,
    scenarios: {
      pinnedOpen: summarize(attr.pinnedOpen),
      pinnedClose: summarize(attr.pinnedClose),
      popoverOpen: summarize(attr.popoverOpen),
      toStickers: summarize(attr.toStickers),
      backToEmoji: summarize(attr.backToEmoji),
    },
    threadWidthClosed: wClosed,
    threadWidthOpen: wOpen,
    positiveControl: { profiles: positiveControl, msgListCalls: controlList, ok: controlOk },
    traces: { pinnedOpen: attr.tracePinnedOpen, tabSwitch: attr.traceTabSwitch },
    measuredAt: new Date().toISOString(),
  };
  writeFileSync(`${SHOTS}/perf-phase2-attribution.json`, JSON.stringify(report2, null, 2));
  console.log('phase2 attribution:', JSON.stringify(report2, null, 2));
  expect(attr.pinnedOpen.length).toBe(ATTR_RUNS);
  expect(controlOk).toBe(true);
});

/* ─── Issue #80: актуальный Sticker-V2 профиль ────────────────────────────
 * Расширение исходного harness под текущую панель: visible-aware готовность
 * (скрытый keep-alive DOM не считается selectable), холодные контексты,
 * первые реально загруженные превью стикеров, pack-switch, scroll-jank,
 * отклик поиска и контроли chat-entry/typing. Пишет отдельные артефакты,
 * не перетирая исторические perf-deep/perf-regression JSON.
 */
const ISSUE80_RUNS = Number(process.env.E2E_PERF_RUNS || 20);
const ISSUE80_LABEL = String(process.env.E2E_PERF_LABEL || 'current').replace(/[^a-z0-9_-]/gi, '-');
const ISSUE80_SHOTS = process.env.E2E_PERF_ARTIFACT_DIR || `${SHOTS}/issue80`;
const ISSUE80_VIEWPORT = { width: 1440, height: 900 };

const statsFine = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, p50: null, p95: null, min: null, max: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
  return {
    n: sorted.length,
    p50: Math.round(pick(0.5) * 10) / 10,
    p95: Math.round(pick(0.95) * 10) / 10,
    min: Math.round(sorted[0] * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10,
  };
};

const installIssue80Measure = () => {
  window.__perf = {
    commits: [],
    longTasks: [],
    profiles: {},
    frameWatches: {},
    frameWatchSeq: 0,
    firstComposerVisible: undefined,
    actionT0: null,
    echoTarget: null,
  };
  // Дефолтный буфер resource timing (~250 entries) переполняется ещё на
  // входе в чат + первой пачке emoji images; без расширения из атрибуции
  // пропадают как раз sticker API/preview entries, ради которых она нужна.
  try { performance.setResourceTimingBufferSize(4000); } catch { /* noop */ }
  const listeners = {};
  const hook = {
    renderers: new Map(),
    listeners,
    checkDCE(fn) { try { fn(); } catch { /* noop */ } },
    supportsFiber: true,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    sub(event, fn) {
      const id = Object.keys(listeners).length + 1;
      (listeners[event] = listeners[event] || []).push([id, fn]);
      return id;
    },
    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
    off(event, fn) {
      const list = listeners[event];
      if (!list) return;
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    emit(event, ...args) {
      (listeners[event] || []).forEach((entry) => {
        const fn = Array.isArray(entry) ? entry[1] : entry;
        try { fn(...args); } catch { /* noop */ }
      });
    },
    getFiberRoots() { return new Set(); },
    onCommitFiberRoot(id, root) {
      let rendered = 0;
      let threadRendered = 0;
      try {
        const seen = new Set();
        const thread = document.querySelector('[data-testid="chat-thread-scroll"]');
        const stack = [root.current];
        while (stack.length && seen.size < 100000) {
          const fiber = stack.pop();
          if (!fiber || seen.has(fiber)) continue;
          seen.add(fiber);
          if (fiber.flags & 1) {
            rendered += 1;
            if (thread && fiber.stateNode instanceof Element && thread.contains(fiber.stateNode)) threadRendered += 1;
          }
          if (fiber.child) stack.push(fiber.child);
          if (fiber.sibling) stack.push(fiber.sibling);
        }
      } catch { rendered = -1; }
      window.__perf.commits.push({ t: performance.now(), rendered, threadRendered });
    },
    onCommitFiberUnmount() {},
    onScheduleFiberRoot() {},
  };
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook });
  try {
    // Observer обязательно держим сильной ссылкой: иначе Chrome может
    // собрать его GC и окно действия молча останется без longtask entries.
    window.__perf.longTaskObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => window.__perf.longTasks.push({
        start: entry.startTime,
        duration: entry.duration,
      }));
    });
    window.__perf.longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported */ }

  // Контроль входа в чат из самой страницы: performance.now() здесь идёт от
  // navigation start, поэтому внешняя задержка Playwright не входит в метрику.
  const pollComposer = () => {
    const composer = document.querySelector('[data-testid="chat-composer-textarea"]');
    if (composer && composer.getBoundingClientRect().width > 0) {
      if (window.__perf.firstComposerVisible === undefined) {
        window.__perf.firstComposerVisible = performance.now();
      }
      return;
    }
    requestAnimationFrame(pollComposer);
  };
  requestAnimationFrame(pollComposer);

  // rAF-gap watcher для scroll/jank сценариев. Первая dt измеряется от
  // старта watcher'а до первого кадра — блокировка main thread видна сразу.
  window.__startFrameWatch = (label) => {
    const id = ++window.__perf.frameWatchSeq;
    const watch = {
      id,
      label: String(label || ''),
      start: performance.now(),
      end: null,
      last: null,
      frames: [],
      done: false,
      raf: null,
    };
    const tick = (timestamp) => {
      if (watch.done) return;
      const previous = watch.last === null ? watch.start : watch.last;
      watch.frames.push({ t: timestamp, dt: timestamp - previous });
      watch.last = timestamp;
      watch.raf = requestAnimationFrame(tick);
    };
    watch.raf = requestAnimationFrame(tick);
    window.__perf.frameWatches[id] = watch;
    return id;
  };
  window.__stopFrameWatch = (id) => {
    const watch = window.__perf.frameWatches[id];
    if (!watch) return null;
    watch.done = true;
    if (watch.raf !== null) cancelAnimationFrame(watch.raf);
    watch.end = performance.now();
    return JSON.parse(JSON.stringify(watch));
  };
};

// t0 ставится capture-обработчиком на самом целевом элементе непосредственно
// перед пользовательским click — протокольная задержка Playwright в замер не входит.
const armActionClick = async (locator) => {
  await locator.evaluate((element) => {
    element.addEventListener('click', () => {
      window.__perf.actionT0 = performance.now();
      try { performance.mark('issue80-action'); } catch { /* noop */ }
    }, { capture: true, once: true });
  });
};

// Первый selectable emoji: кнопка реально видима пользователю, не disabled,
// а её img complete && naturalWidth>0. decode — отдельная стадия,
// чтобы не подменять требуемую метрику более строгой.
// Видимость — только через window.__emojiVis (e2e/perf/emoji-panel-visibility.js):
// после фикса #88 скрытый keep-alive док имеет visibility:hidden и СОХРАНЯЕТ
// геометрию — прежняя проверка по одним rect-размерам ложно считала скрытую
// панель видимой (в warm reopen все стадии «измерялись» бы за ~0 мс).
const measureEmojiPanelOpen = (page) => page.evaluate(() => new Promise((resolve) => {
  const t0 = window.__perf.actionT0 ?? performance.now();
  const marks = { t0 };
  let selectableAt = null;
  let decodeRequested = false;
  const stamp = (key) => {
    if (marks[key] !== undefined) return;
    marks[key] = performance.now() - t0;
    try { performance.mark(`issue80-${key}`); } catch { /* noop */ }
  };
  const vis = window.__emojiVis;
  const deadline = performance.now() + 8000;
  const poll = () => {
    const dock = document.querySelector('[data-testid="chat-emoji-dock"]');
    if (dock && vis.userVisible(dock)) stamp('dockVisible');
    const button = dock?.querySelector('.EmojiPickerReact button.epr-emoji');
    if (button) {
      stamp('firstEmojiDom');
      const img = button.querySelector('img');
      if (!button.disabled && vis.userVisible(button) && img && img.complete && img.naturalWidth > 0) {
        stamp('firstEmojiSelectable');
        if (selectableAt === null) selectableAt = performance.now();
        if (!decodeRequested) {
          decodeRequested = true;
          img.decode().catch(() => {}).finally(() => {
            if (marks.firstEmojiDecoded === undefined) marks.firstEmojiDecoded = performance.now() - t0;
          });
        }
      }
    }
    const search = dock?.querySelector('.EmojiPickerReact input');
    if (search && vis.userVisible(search) && !search.disabled) stamp('interactive');
    const decodeDone = marks.firstEmojiDecoded !== undefined
      || (selectableAt !== null && performance.now() - selectableAt > 250);
    if (marks.firstEmojiSelectable !== undefined && marks.interactive !== undefined && decodeDone) {
      resolve(marks);
      return;
    }
    if (performance.now() > deadline) {
      marks.timedOut = true;
      resolve(marks);
      return;
    }
    requestAnimationFrame(poll);
  };
  poll();
}));

// Первая видимая и кликабельная превью-картинка в сетке стикеров. Все узлы
// ищутся только внутри scroll-контейнера секций — нижняя pack-strip не считается.
const measureStickerPanelReady = (page) => page.evaluate(() => new Promise((resolve) => {
  const t0 = window.__perf.actionT0 ?? performance.now();
  const marks = { t0 };
  const stamp = (key) => {
    if (marks[key] !== undefined) return;
    marks[key] = performance.now() - t0;
    try { performance.mark(`issue80-${key}`); } catch { /* noop */ }
  };
  const intersects = (element, root) => {
    if (!element || !root) return false;
    const rect = element.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.bottom > rootRect.top + 1 && rect.top < rootRect.bottom - 1
      && rect.right > rootRect.left + 1 && rect.left < rootRect.right - 1;
  };
  const deadline = performance.now() + 9000;
  const poll = () => {
    const dock = document.querySelector('[data-testid="chat-emoji-dock"]');
    const selected = dock?.querySelector('.MuiTabs-root [role="tab"][aria-selected="true"]');
    if (selected && /стикер/i.test(selected.textContent || '')) stamp('stickersTabSelected');
    const scroll = dock?.querySelector('[data-testid="chat-sticker-sections-scroll"]');
    if (scroll && scroll.getBoundingClientRect().width > 0) stamp('stickerScrollVisible');
    if (scroll) {
      const buttons = [...scroll.querySelectorAll('button[aria-label^="Отправить стикер"]')];
      if (buttons.length > 0) stamp('firstStickerDom');
      const ready = buttons.filter((button) => {
        if (button.disabled || !intersects(button, scroll)) return false;
        const img = button.querySelector('img');
        return Boolean(img && img.complete && img.naturalWidth > 0 && intersects(img, scroll));
      });
      if (ready.length > 0) {
        stamp('firstStickerPreview');
        marks.readyPreviewCount = ready.length;
      }
    }
    if (marks.firstStickerPreview !== undefined) {
      resolve(marks);
      return;
    }
    if (performance.now() > deadline) {
      marks.timedOut = true;
      resolve(marks);
      return;
    }
    requestAnimationFrame(poll);
  };
  poll();
}));

// Pack-switch: целевая секция должна реально попасть в viewport скролла,
// а её первый стикер — быть видимым, загруженным и кликабельным.
const measurePackReady = (page, packTitle) => page.evaluate((targetTitle) => new Promise((resolve) => {
  const t0 = window.__perf.actionT0 ?? performance.now();
  const marks = { t0 };
  const stamp = (key) => {
    if (marks[key] !== undefined) return;
    marks[key] = performance.now() - t0;
    try { performance.mark(`issue80-${key}`); } catch { /* noop */ }
  };
  const intersects = (element, root) => {
    if (!element || !root) return false;
    const rect = element.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.bottom > rootRect.top + 1 && rect.top < rootRect.bottom - 1
      && rect.right > rootRect.left + 1 && rect.left < rootRect.right - 1;
  };
  const deadline = performance.now() + 9000;
  const poll = () => {
    const dock = document.querySelector('[data-testid="chat-emoji-dock"]');
    const scroll = dock?.querySelector('[data-testid="chat-sticker-sections-scroll"]');
    const sections = scroll ? [...scroll.querySelectorAll('[data-sticker-section]')] : [];
    const section = sections.find((node) => String(node.textContent || '').includes(targetTitle));
    if (section) {
      stamp('targetSectionDom');
      if (intersects(section, scroll)) stamp('targetSectionVisible');
      const buttons = [...section.querySelectorAll('button[aria-label^="Отправить стикер"]')];
      const ready = buttons.filter((button) => {
        if (button.disabled || !intersects(button, scroll)) return false;
        const img = button.querySelector('img');
        return Boolean(img && img.complete && img.naturalWidth > 0 && intersects(img, scroll));
      });
      if (ready.length > 0) {
        stamp('firstTargetStickerPreview');
        marks.readyTargetPreviewCount = ready.length;
      }
    }
    if (marks.firstTargetStickerPreview !== undefined) {
      resolve(marks);
      return;
    }
    if (performance.now() > deadline) {
      marks.timedOut = true;
      resolve(marks);
      return;
    }
    requestAnimationFrame(poll);
  };
  poll();
}), packTitle);

// Отклик keystroke: capture keydown на конкретном input → значение появилось
// в этом же input. Пост-фильтрация отдельно видна через longtask/commit window.
const measureKeyEcho = async (page, locator, text) => {
  await locator.evaluate((element) => {
    window.__perf.echoTarget = element;
    const stamp = () => { window.__perf.actionT0 = performance.now(); };
    // ASCII проходит через keydown, а Cyrillic/Unicode в Playwright часто
    // идёт через insertText без аппаратного keydown — t0 надо брать из
    // beforeinput, иначе метрика случайно стартует от предыдущего click.
    element.addEventListener('keydown', stamp, { capture: true, once: true });
    element.addEventListener('beforeinput', stamp, { capture: true, once: true });
  });
  await locator.click();
  await page.keyboard.type(text, { delay: 0 });
  const result = await page.evaluate((expected) => new Promise((resolve) => {
    const input = window.__perf.echoTarget;
    const t0 = window.__perf.actionT0 ?? performance.now();
    const deadline = performance.now() + 2000;
    const poll = () => {
      if (input && String(input.value || '').includes(expected)) {
        resolve({ t0, echoMs: performance.now() - t0, timedOut: false });
        return;
      }
      if (performance.now() > deadline) {
        resolve({ t0, echoMs: 2000, timedOut: true });
        return;
      }
      requestAnimationFrame(poll);
    };
    poll();
  }), text);
  await page.evaluate(() => { window.__perf.echoTarget = null; });
  return result;
};

// Атрибуция критического пути без чтения сырых сотен image entries в Node:
// JS chunks (включая те, что начались до click), API wait/download, группы
// изображений, React commits и longtask в окне действия.
const collectMeasurementWindow = (page, t0, windowMs = 4000) => page.evaluate(
  ({ t0: start, windowMs: windowLength }) => {
    const now = performance.now();
    const end = Math.min(start + windowLength, now);
    const rel = (value) => Math.round((value - start) * 10) / 10;
    const round = (value) => Math.round(value * 10) / 10;
    const entries = performance.getEntriesByType('resource');
    const inWindow = entries.filter((entry) => entry.startTime <= end && entry.responseEnd >= start - 10);
    const criticalScriptNames = [
      'ChatPageContent',
      'ChatEmojiPanel',
      'emoji-picker-react',
      'ChatDialogs',
      'ChatContextPanel',
    ];
    const scripts = criticalScriptNames.map((needle) => {
      const entry = [...entries].reverse().find((item) => item.name.includes(needle));
      if (!entry) return null;
      return {
        name: entry.name.split('/').pop(),
        startRel: rel(entry.startTime),
        responseStartRel: rel(entry.responseStart),
        responseEndRel: rel(entry.responseEnd),
        durationMs: round(entry.duration),
        transferKB: Math.round((entry.transferSize || 0) / 1024),
        encodedKB: Math.round((entry.encodedBodySize || 0) / 1024),
        decodedKB: Math.round((entry.decodedBodySize || 0) / 1024),
      };
    }).filter(Boolean);
    const apiEntries = inWindow
      .filter((entry) => entry.name.includes('/api/v1/chat/sticker'))
      .map((entry) => ({
        kind: entry.name.includes('/chat/sticker-packs') ? 'packs'
          : entry.name.includes('/chat/stickers/favorites') ? 'favorites'
            : entry.name.includes('/chat/stickers/recent') ? 'recents'
              : entry.name.includes('/preview') ? 'preview-file'
                : entry.name.includes('/file') ? 'sticker-file'
                  : 'other',
        name: entry.name.split('/').slice(-3).join('/'),
        startRel: rel(entry.startTime),
        responseStartRel: rel(entry.responseStart),
        responseEndRel: rel(entry.responseEnd),
        durationMs: round(entry.duration),
        waitMs: round(Math.max(0, entry.responseStart - entry.startTime)),
        downloadMs: round(Math.max(0, entry.responseEnd - entry.responseStart)),
        transferKB: Math.round((entry.transferSize || 0) / 1024),
        encodedKB: Math.round((entry.encodedBodySize || 0) / 1024),
      }));
    const mediaStats = (predicate) => {
      const list = inWindow.filter(predicate);
      if (!list.length) return { count: 0 };
      return {
        count: list.length,
        firstStartRel: rel(Math.min(...list.map((entry) => entry.startTime))),
        firstEndRel: rel(Math.min(...list.map((entry) => entry.responseEnd))),
        lastEndRel: rel(Math.max(...list.map((entry) => entry.responseEnd))),
        transferKB: Math.round(list.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) / 1024),
        encodedKB: Math.round(list.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0) / 1024),
        decodedKB: Math.round(list.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0) / 1024),
      };
    };
    const commits = window.__perf.commits.filter((commit) => commit.t >= start - 2 && commit.t <= end);
    const longTasks = window.__perf.longTasks.filter((task) => task.start >= start - 2 && task.start <= end);
    return {
      scripts,
      api: apiEntries,
      emojiImages: mediaStats((entry) => entry.name.includes('/emoji/apple/')),
      stickerPreviews: mediaStats((entry) => entry.name.includes('/chat/stickers/') && entry.name.includes('/preview')),
      commitCount: commits.length,
      renderedComponents: commits.reduce((sum, commit) => sum + Math.max(0, commit.rendered), 0),
      maxRenderedPerCommit: commits.reduce((max, commit) => Math.max(max, commit.rendered), 0),
      threadRenderedComponents: commits.reduce((sum, commit) => sum + Math.max(0, commit.threadRendered || 0), 0),
      longTaskCount: longTasks.length,
      longTaskTotalMs: round(longTasks.reduce((sum, task) => sum + task.duration, 0)),
      longTaskMaxMs: round(longTasks.reduce((max, task) => Math.max(max, task.duration), 0)),
      longTasks: longTasks.map((task) => ({ startRel: rel(task.start), durationMs: round(task.duration) })),
      windowEndRel: rel(end),
    };
  },
  { t0, windowMs },
);

const issue80DirectConversation = async (page) => {
  const usersResp = await page.request.get('/api/v1/chat/users?limit=50');
  expect(usersResp.ok(), 'chat users for perf conversation').toBeTruthy();
  const usersJson = await usersResp.json();
  const users = usersJson.items || usersJson.users || (Array.isArray(usersJson) ? usersJson : []);
  const peerUsername = process.env.E2E_USERNAME2 || 'e2e_user';
  const peer = users.find((user) => user.username === peerUsername) || users.find((user) => user.username !== (process.env.E2E_USERNAME || 'e2e_admin'));
  expect(peer, 'peer user for perf conversation').toBeTruthy();
  const resp = await page.request.post('/api/v1/chat/conversations/direct', {
    data: { peer_user_id: peer.id },
  });
  expect(resp.ok(), 'create/reuse direct perf conversation').toBeTruthy();
  const json = await resp.json();
  return json.id || json.conversation_id;
};

const openIssue80Chat = async (page, conversationId) => {
  await page.goto(`/chat?conversation=${conversationId}`);
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.__perf?.firstComposerVisible !== undefined, undefined, { timeout: 15_000 });
  return page.evaluate(() => window.__perf.firstComposerVisible);
};

const summarizeIssue80Scenario = (samples, markKey, attributionKey, markKeys) => ({
  ...Object.fromEntries(markKeys.map((key) => [
    key,
    statsFine(samples.map((sample) => sample[markKey]?.[key]).filter(Number.isFinite)),
  ])),
  timeouts: samples.filter((sample) => sample[markKey]?.timedOut).length,
  commits: statsFine(samples.map((sample) => sample[attributionKey]?.commitCount).filter(Number.isFinite)),
  renderedComponents: statsFine(samples.map((sample) => sample[attributionKey]?.renderedComponents).filter(Number.isFinite)),
  maxRenderedPerCommit: statsFine(samples.map((sample) => sample[attributionKey]?.maxRenderedPerCommit).filter(Number.isFinite)),
  threadRenderedComponents: statsFine(samples.map((sample) => sample[attributionKey]?.threadRenderedComponents).filter(Number.isFinite)),
  longTaskCount: samples.reduce((sum, sample) => sum + (sample[attributionKey]?.longTaskCount || 0), 0),
  longTaskTotalMs: statsFine(samples.map((sample) => sample[attributionKey]?.longTaskTotalMs).filter(Number.isFinite)),
  longTaskMaxMs: statsFine(samples.map((sample) => sample[attributionKey]?.longTaskMaxMs).filter(Number.isFinite)),
});

test('issue80 perf: sticker-v2 cold/warm panel, pack switch, scroll and controls', async ({ browser }) => {
  test.setTimeout(1_200_000);
  mkdirSync(ISSUE80_SHOTS, { recursive: true });
  const coldSamples = [];
  let conversationId = null;

  // ── Cold cache/profile: новый browser context на каждый прогон. Клик по
  // панели делается сразу после готовности композера — это честный первый
  // пользовательский путь; prefetch race дополнительно виден по script timing.
  for (let i = 0; i < ISSUE80_RUNS; i += 1) {
    const ctx = await browser.newContext({ viewport: ISSUE80_VIEWPORT });
    await ctx.addInitScript(installIssue80Measure);
    await ctx.addInitScript(installEmojiPanelVisibility);
    const page = await ctx.newPage();
    // Cold cache должен быть честным даже если Chromium разделяет HTTP-cache
    // между incognito-context'ами: на время cold-прогона кэш выключен на
    // уровне CDP. Warm-контекст ниже сознательно остаётся с обычным кэшем.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await apiLogin(page);
    if (!conversationId) conversationId = await issue80DirectConversation(page);
    const chatEntryMs = await openIssue80Chat(page, conversationId);

    const emojiButton = page.getByTestId('chat-composer-emoji-button');
    const dock = page.getByTestId('chat-emoji-dock');
    await armActionClick(emojiButton);
    await emojiButton.click();
    const emojiMarks = await measureEmojiPanelOpen(page);
    await page.waitForTimeout(150);
    const emojiAttribution = await collectMeasurementWindow(page, emojiMarks.t0, 5000);

    const stickersTab = dock.getByRole('tab', { name: 'Стикеры' });
    await armActionClick(stickersTab);
    await stickersTab.click();
    const stickerMarks = await measureStickerPanelReady(page);
    await page.waitForTimeout(250);
    const stickerAttribution = await collectMeasurementWindow(page, stickerMarks.t0, 6000);

    // Делаем исходную позицию честной для pack-switch: перед кликом по набору
    // пользователь находится внизу длинного списка, целевая первая строка не видна.
    await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="chat-emoji-dock"] [data-testid="chat-sticker-sections-scroll"]');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
    await page.waitForTimeout(80);
    const bigPackTab = dock.getByRole('tab', { name: 'E2E Big Pack' });
    await armActionClick(bigPackTab);
    await bigPackTab.click();
    const packMarks = await measurePackReady(page, 'E2E Big Pack');
    await page.waitForTimeout(250);
    const packAttribution = await collectMeasurementWindow(page, packMarks.t0, 5000);

    coldSamples.push({
      iteration: i,
      chatEntryMs,
      emojiMarks,
      emojiAttribution,
      stickerMarks,
      stickerAttribution,
      packMarks,
      packAttribution,
    });
    await ctx.close();
  }

  // ── Warm cache/profile: один контекст, keep-alive и HTTP/API-кэши прогреты.
  const warmCtx = await browser.newContext({ viewport: ISSUE80_VIEWPORT });
  await warmCtx.addInitScript(installIssue80Measure);
  await warmCtx.addInitScript(installEmojiPanelVisibility);
  const page = await warmCtx.newPage();
  await apiLogin(page);
  if (!conversationId) conversationId = await issue80DirectConversation(page);
  const warmChatEntryMs = await openIssue80Chat(page, conversationId);
  const emojiButton = page.getByTestId('chat-composer-emoji-button');
  const dock = page.getByTestId('chat-emoji-dock');

  // Полный прогрев панели/вкладок; нижние строки большого набора специально
  // не прокручиваем — первый scroll ниже остаётся cold-images сценарием.
  await armActionClick(emojiButton);
  await emojiButton.click();
  await measureEmojiPanelOpen(page);
  await armActionClick(dock.getByRole('tab', { name: 'Стикеры' }));
  await dock.getByRole('tab', { name: 'Стикеры' }).click();
  await measureStickerPanelReady(page);
  await armActionClick(dock.getByRole('tab', { name: 'Эмодзи' }));
  await dock.getByRole('tab', { name: 'Эмодзи' }).click();
  await measureEmojiPanelOpen(page);

  const warmReopenSamples = [];
  for (let i = 0; i < ISSUE80_RUNS; i += 1) {
    await page.getByTestId('chat-emoji-dock-close').click();
    await expect(dock).toBeHidden({ timeout: 10_000 });
    await armActionClick(emojiButton);
    await emojiButton.click();
    const marks = await measureEmojiPanelOpen(page);
    const attribution = await collectMeasurementWindow(page, marks.t0, 2500);
    warmReopenSamples.push({ iteration: i, marks, attribution });
  }

  const warmStickerTabSamples = [];
  const warmEmojiTabSamples = [];
  for (let i = 0; i < ISSUE80_RUNS; i += 1) {
    const stickersTab = dock.getByRole('tab', { name: 'Стикеры' });
    await armActionClick(stickersTab);
    await stickersTab.click();
    const stickerMarks = await measureStickerPanelReady(page);
    const stickerAttribution = await collectMeasurementWindow(page, stickerMarks.t0, 2500);
    warmStickerTabSamples.push({ iteration: i, marks: stickerMarks, attribution: stickerAttribution });

    const emojiTab = dock.getByRole('tab', { name: 'Эмодзи' });
    await armActionClick(emojiTab);
    await emojiTab.click();
    const emojiMarks = await measureEmojiPanelOpen(page);
    const emojiAttribution = await collectMeasurementWindow(page, emojiMarks.t0, 2500);
    warmEmojiTabSamples.push({ iteration: i, marks: emojiMarks, attribution: emojiAttribution });
  }

  // Pack-switch: активируем стикеры и чередуем оба seeded pack'а. Метрика
  // включает smooth scroll — это пользовательская задержка переключения.
  await armActionClick(dock.getByRole('tab', { name: 'Стикеры' }));
  await dock.getByRole('tab', { name: 'Стикеры' }).click();
  await measureStickerPanelReady(page);
  const warmPackSamples = [];
  for (let i = 0; i < ISSUE80_RUNS; i += 1) {
    const title = i % 2 === 0 ? 'E2E Big Pack' : 'E2E Test Pack';
    const packTab = dock.getByRole('tab', { name: title });
    await armActionClick(packTab);
    await packTab.click();
    const marks = await measurePackReady(page, title);
    const attribution = await collectMeasurementWindow(page, marks.t0, 3000);
    warmPackSamples.push({ iteration: i, title, marks, attribution });
  }

  // ── Scroll большого набора: rAF gaps + longtasks. Первый проход — cold
  // image cache для нижних строк, последующие — warm image cache.
  const scrollSamples = [];
  const scrollLocator = dock.getByTestId('chat-sticker-sections-scroll');
  for (let i = 0; i < ISSUE80_RUNS; i += 1) {
    await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="chat-emoji-dock"] [data-testid="chat-sticker-sections-scroll"]');
      if (!scroll) return;
      const sections = [...scroll.querySelectorAll('[data-sticker-section]')];
      const big = sections.find((node) => String(node.textContent || '').includes('E2E Big Pack'));
      if (!big) return;
      scroll.scrollTop = Math.max(0, scroll.scrollTop + big.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 4);
    });
    await page.waitForTimeout(80);
    const watchId = await page.evaluate(() => window.__startFrameWatch('big-pack-scroll'));
    const box = await scrollLocator.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(220, box.height / 2));
    const beforeScroll = await page.evaluate(() => document.querySelector('[data-testid="chat-emoji-dock"] [data-testid="chat-sticker-sections-scroll"]')?.scrollTop || 0);
    for (let step = 0; step < 8; step += 1) {
      await page.mouse.wheel(0, 420);
      await page.waitForTimeout(24);
    }
    await page.waitForTimeout(450);
    const watch = await page.evaluate((id) => window.__stopFrameWatch(id), watchId);
    const afterScroll = await page.evaluate(() => document.querySelector('[data-testid="chat-emoji-dock"] [data-testid="chat-sticker-sections-scroll"]')?.scrollTop || 0);
    const longTaskInfo = await page.evaluate(({ start, end }) => {
      const tasks = window.__perf.longTasks.filter((task) => task.start >= start - 2 && task.start <= end + 2);
      return {
        count: tasks.length,
        totalMs: tasks.reduce((sum, task) => sum + task.duration, 0),
        maxMs: tasks.reduce((max, task) => Math.max(max, task.duration), 0),
      };
    }, { start: watch?.start || 0, end: watch?.end || 0 });
    const frameDts = (watch?.frames || []).map((frame) => frame.dt).filter((dt) => dt > 0 && dt < 5000);
    scrollSamples.push({
      iteration: i,
      coldImages: i === 0,
      durationMs: watch ? watch.end - watch.start : 0,
      scrollDeltaPx: afterScroll - beforeScroll,
      frameCount: frameDts.length,
      maxFrameMs: frameDts.reduce((max, dt) => Math.max(max, dt), 0),
      meanFrameMs: frameDts.length ? frameDts.reduce((sum, dt) => sum + dt, 0) / frameDts.length : 0,
      framesOver30Ms: frameDts.filter((dt) => dt > 30).length,
      framesOver50Ms: frameDts.filter((dt) => dt > 50).length,
      framesOver100Ms: frameDts.filter((dt) => dt > 100).length,
      longTaskCount: longTaskInfo.count,
      longTaskTotalMs: longTaskInfo.totalMs,
      longTaskMaxMs: longTaskInfo.maxMs,
    });
  }

  // ── Emoji search keystroke: input echo и post-key main-thread цена.
  await armActionClick(dock.getByRole('tab', { name: 'Эмодзи' }));
  await dock.getByRole('tab', { name: 'Эмодзи' }).click();
  await measureEmojiPanelOpen(page);
  const emojiSearch = dock.locator('.EmojiPickerReact input').first();
  await expect(emojiSearch).toBeVisible({ timeout: 10_000 });
  const emojiSearchSamples = [];
  const searchChars = ['s', 'm', 'i', 'l', 'e'];
  for (let i = 0; i < ISSUE80_RUNS; i += 1) {
    await emojiSearch.fill('');
    await page.waitForTimeout(50);
    const char = searchChars[i % searchChars.length];
    const echo = await measureKeyEcho(page, emojiSearch, char);
    await page.waitForTimeout(180);
    const attribution = await collectMeasurementWindow(page, echo.t0, 260);
    emojiSearchSamples.push({ iteration: i, char, echo, attribution });
    await emojiSearch.fill('');
    await page.waitForTimeout(80);
  }

  // Дополнительный Sticker-V2 сценарий: первый символ строит/использует
  // общий search index; echo и post-key longtask фиксируются раздельно.
  await armActionClick(dock.getByRole('tab', { name: 'Стикеры' }));
  await dock.getByRole('tab', { name: 'Стикеры' }).click();
  await measureStickerPanelReady(page);
  const stickerSearch = dock.getByRole('textbox', { name: 'Поиск стикеров' });
  const stickerSearchSamples = [];
  const stickerChars = ['с', 'е', 'р', 'д', 'ц'];
  for (let i = 0; i < ISSUE80_RUNS; i += 1) {
    await stickerSearch.fill('');
    await page.waitForTimeout(50);
    const char = stickerChars[i % stickerChars.length];
    const echo = await measureKeyEcho(page, stickerSearch, char);
    await page.waitForTimeout(180);
    const attribution = await collectMeasurementWindow(page, echo.t0, 260);
    stickerSearchSamples.push({ iteration: i, char, echo, attribution });
    await stickerSearch.fill('');
    await page.waitForTimeout(80);
  }

  // ── CONTROL: composer typing echo, обычный ASCII без эмодзи (suggestions
  // не активируются). fill('') между прогонами в измеряемое окно не входит.
  const composer = page.getByTestId('chat-composer-textarea');
  const typingSamples = [];
  for (let i = 0; i < ISSUE80_RUNS; i += 1) {
    await composer.fill('');
    await page.waitForTimeout(50);
    const echo = await measureKeyEcho(page, composer, 'x');
    await page.waitForTimeout(120);
    const attribution = await collectMeasurementWindow(page, echo.t0, 180);
    typingSamples.push({ iteration: i, echo, attribution });
    await composer.fill('');
  }

  const emojiMarkKeys = ['dockVisible', 'firstEmojiDom', 'firstEmojiSelectable', 'firstEmojiDecoded', 'interactive'];
  const stickerMarkKeys = ['stickersTabSelected', 'stickerScrollVisible', 'firstStickerDom', 'firstStickerPreview'];
  const packMarkKeys = ['targetSectionDom', 'targetSectionVisible', 'firstTargetStickerPreview'];
  const echoStats = (samples) => ({
    echoMs: statsFine(samples.map((sample) => sample.echo?.echoMs ?? sample.echoMs)),
    timeouts: samples.filter((sample) => sample.echo?.timedOut || sample.timedOut).length,
    postKeyLongTaskCount: samples.reduce((sum, sample) => sum + (sample.attribution?.longTaskCount || 0), 0),
    postKeyLongTaskTotalMs: statsFine(samples.map((sample) => sample.attribution?.longTaskTotalMs).filter(Number.isFinite)),
    postKeyLongTaskMaxMs: statsFine(samples.map((sample) => sample.attribution?.longTaskMaxMs).filter(Number.isFinite)),
    postKeyCommits: statsFine(samples.map((sample) => sample.attribution?.commitCount).filter(Number.isFinite)),
    postKeyRenderedComponents: statsFine(samples.map((sample) => sample.attribution?.renderedComponents).filter(Number.isFinite)),
  });

  const report = {
    label: ISSUE80_LABEL,
    runs: ISSUE80_RUNS,
    viewport: `${ISSUE80_VIEWPORT.width}x${ISSUE80_VIEWPORT.height}`,
    measuredAt: new Date().toISOString(),
    seed: 'e2e_test_pack(3 webp) + e2e_big_pack(90 webp)',
    cold: {
      chatEntryMs: statsFine(coldSamples.map((sample) => sample.chatEntryMs)),
      emojiOpen: summarizeIssue80Scenario(coldSamples, 'emojiMarks', 'emojiAttribution', emojiMarkKeys),
      firstStickerSwitch: summarizeIssue80Scenario(coldSamples, 'stickerMarks', 'stickerAttribution', stickerMarkKeys),
      firstBigPackSwitch: summarizeIssue80Scenario(coldSamples, 'packMarks', 'packAttribution', packMarkKeys),
    },
    warm: {
      chatEntryMs: warmChatEntryMs,
      reopenEmojiPanel: summarizeIssue80Scenario(warmReopenSamples, 'marks', 'attribution', emojiMarkKeys),
      switchToStickers: summarizeIssue80Scenario(warmStickerTabSamples, 'marks', 'attribution', stickerMarkKeys),
      switchToEmoji: summarizeIssue80Scenario(warmEmojiTabSamples, 'marks', 'attribution', emojiMarkKeys),
      packSwitch: summarizeIssue80Scenario(warmPackSamples, 'marks', 'attribution', packMarkKeys),
      emojiSearchKeystroke: echoStats(emojiSearchSamples),
      stickerSearchKeystroke: echoStats(stickerSearchSamples),
      composerTypingEcho: echoStats(typingSamples),
      bigPackScroll: {
        durationMs: statsFine(scrollSamples.map((sample) => sample.durationMs)),
        scrollDeltaPx: statsFine(scrollSamples.map((sample) => sample.scrollDeltaPx)),
        frameCount: statsFine(scrollSamples.map((sample) => sample.frameCount)),
        maxFrameMs: statsFine(scrollSamples.map((sample) => sample.maxFrameMs)),
        meanFrameMs: statsFine(scrollSamples.map((sample) => sample.meanFrameMs)),
        framesOver30Ms: statsFine(scrollSamples.map((sample) => sample.framesOver30Ms)),
        framesOver50Ms: statsFine(scrollSamples.map((sample) => sample.framesOver50Ms)),
        framesOver100Ms: statsFine(scrollSamples.map((sample) => sample.framesOver100Ms)),
        longTaskCount: scrollSamples.reduce((sum, sample) => sum + sample.longTaskCount, 0),
        longTaskTotalMs: statsFine(scrollSamples.map((sample) => sample.longTaskTotalMs)),
        longTaskMaxMs: statsFine(scrollSamples.map((sample) => sample.longTaskMaxMs)),
        coldImageRun: scrollSamples[0] || null,
      },
    },
    samples: {
      cold: coldSamples,
      warmReopen: warmReopenSamples,
      warmStickerTab: warmStickerTabSamples,
      warmEmojiTab: warmEmojiTabSamples,
      warmPack: warmPackSamples,
      scroll: scrollSamples,
      emojiSearch: emojiSearchSamples,
      stickerSearch: stickerSearchSamples,
      typing: typingSamples,
    },
  };
  writeFileSync(`${ISSUE80_SHOTS}/perf-issue80-${ISSUE80_LABEL}.json`, JSON.stringify(report, null, 2));
  console.log(`issue80 perf ${ISSUE80_LABEL}:`, JSON.stringify({
    cold: report.cold,
    warm: {
      reopenEmojiPanel: report.warm.reopenEmojiPanel,
      switchToStickers: report.warm.switchToStickers,
      packSwitch: report.warm.packSwitch,
      bigPackScroll: report.warm.bigPackScroll,
      composerTypingEcho: report.warm.composerTypingEcho,
    },
  }, null, 2));

  await warmCtx.close();
  expect(report.cold.emojiOpen.firstEmojiSelectable.n).toBeGreaterThan(0);
  expect(report.cold.firstStickerSwitch.firstStickerPreview.n).toBeGreaterThan(0);
  expect(report.warm.reopenEmojiPanel.firstEmojiSelectable.n).toBeGreaterThan(0);
});

// Лёгкий timeline trace без cpu_profiler (он искажает latency в 5–10×):
// один representative cold-open и один первый переход на стикеры.
const captureTimelineTrace = async (cdp, file) => {
  const chunks = [];
  const handler = (payload) => chunks.push(...(payload.value || []));
  cdp.on('Tracing.dataCollected', handler);
  await cdp.send('Tracing.start', { categories: 'devtools.timeline' });
  return async () => {
    await cdp.send('Tracing.end');
    await new Promise((resolve) => {
      cdp.once('Tracing.tracingComplete', resolve);
      setTimeout(resolve, 10_000);
    });
    cdp.off('Tracing.dataCollected', handler);
    writeFileSync(file, JSON.stringify({ traceEvents: chunks }));
    return chunks;
  };
};

test('issue80 perf traces: representative cold open and sticker switch', async ({ browser }) => {
  test.setTimeout(300_000);
  mkdirSync(ISSUE80_SHOTS, { recursive: true });
  const ctx = await browser.newContext({ viewport: ISSUE80_VIEWPORT });
  await ctx.addInitScript(installIssue80Measure);
  await ctx.addInitScript(installEmojiPanelVisibility);
  const page = await ctx.newPage();
  // Representative trace тоже должен быть cold-cache, а не зависеть от того,
  // как Chromium разделяет HTTP-cache между browser context'ами.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await apiLogin(page);
  const conversationId = await issue80DirectConversation(page);
  await openIssue80Chat(page, conversationId);
  const emojiButton = page.getByTestId('chat-composer-emoji-button');
  const dock = page.getByTestId('chat-emoji-dock');

  const coldTraceFile = `${ISSUE80_SHOTS}/trace-cold-open-${ISSUE80_LABEL}.json`;
  const stopColdTrace = await captureTimelineTrace(cdp, coldTraceFile);
  await armActionClick(emojiButton);
  await emojiButton.click();
  const coldMarks = await measureEmojiPanelOpen(page);
  await page.waitForTimeout(500);
  const coldEvents = await stopColdTrace();
  writeFileSync(`${ISSUE80_SHOTS}/trace-cold-open-summary-${ISSUE80_LABEL}.json`, JSON.stringify({
    marks: coldMarks,
    summary: traceSummary(coldEvents),
  }, null, 2));

  const stickerTraceFile = `${ISSUE80_SHOTS}/trace-sticker-switch-${ISSUE80_LABEL}.json`;
  const stopStickerTrace = await captureTimelineTrace(cdp, stickerTraceFile);
  const stickersTab = dock.getByRole('tab', { name: 'Стикеры' });
  await armActionClick(stickersTab);
  await stickersTab.click();
  const stickerMarks = await measureStickerPanelReady(page);
  await page.waitForTimeout(800);
  const stickerEvents = await stopStickerTrace();
  writeFileSync(`${ISSUE80_SHOTS}/trace-sticker-switch-summary-${ISSUE80_LABEL}.json`, JSON.stringify({
    marks: stickerMarks,
    summary: traceSummary(stickerEvents),
  }, null, 2));

  // Тёплое повторное открытие keep-alive dock: отдельный trace нужен потому,
  // что здесь нет ни chunk/module loading, ни первичной загрузки изображений.
  // Если сценарий всё ещё стоит десятки миллисекунд, узкое место — React/layout
  // работа на самом unhide, а не сеть.
  await dock.getByRole('tab', { name: 'Эмодзи' }).click();
  await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 5000 });
  await page.getByTestId('chat-emoji-dock-close').click();
  await expect(dock).toBeHidden({ timeout: 5000 });
  await page.waitForTimeout(400);

  const warmTraceFile = `${ISSUE80_SHOTS}/trace-warm-reopen-${ISSUE80_LABEL}.json`;
  const stopWarmTrace = await captureTimelineTrace(cdp, warmTraceFile);
  await armActionClick(emojiButton);
  await emojiButton.click();
  const warmMarks = await measureEmojiPanelOpen(page);
  await page.waitForTimeout(500);
  const warmEvents = await stopWarmTrace();
  writeFileSync(`${ISSUE80_SHOTS}/trace-warm-reopen-summary-${ISSUE80_LABEL}.json`, JSON.stringify({
    marks: warmMarks,
    summary: traceSummary(warmEvents),
  }, null, 2));

  await ctx.close();
  expect(coldEvents.length).toBeGreaterThan(0);
  expect(stickerEvents.length).toBeGreaterThan(0);
  expect(warmEvents.length).toBeGreaterThan(0);
});
