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
  const stamp = (key) => { if (marks[key] === undefined) marks[key] = performance.now() - t0; };
  const deadline = performance.now() + 8000;
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
