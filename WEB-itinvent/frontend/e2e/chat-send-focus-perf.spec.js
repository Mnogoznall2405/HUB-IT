// Focused send_echo/typing_echo micro-benchmark for the sticker-V2
// regression diagnosis (PR18 branch vs c8a1d057 baseline).
//
// Same in-page measurement as chat-regression-perf.spec.js (t0 by
// performance.now() before Enter, readiness polled every rAF), plus:
//   * window.__perf.requests — XHR/fetch recorder, counts sticker API
//     calls that land inside the measured window;
//   * E2E_FOCUS_DOCK=1 — reproduces gate ordering (emoji dock opened,
//     stickers tab mounted once via warmHiddenTabs, dock closed) before
//     the send loop, to catch deferred decode/render work;
//   * E2E_FOCUS_DOCK_MODE=off|warm|open — same as DOCK=1 for 'warm';
//     'open' keeps the emoji dock OPEN during the send loop;
//   * E2E_FOCUS_EMOJI_TEXT=1 — sends "<base> 🙂" to force the
//     ChatStickerSuggestions path (suspect a).
//   * E2E_FOCUS_RUNS — sample count (default 40).
//   * E2E_FOCUS_VIEWPORTS — comma list, e.g. "1440x900,988x838".
// Run: E2E_LOCAL=1 E2E_BUILD=1 npx playwright test e2e/chat-send-focus-perf.spec.js
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

/* global window, document, performance, PerformanceObserver, XMLHttpRequest, fetch, process */

const U1 = process.env.E2E_USERNAME || 'e2e_admin';
const P1 = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const U2 = process.env.E2E_USERNAME2;
const RUNS = Number(process.env.E2E_FOCUS_RUNS || 40);
const DOCK_MODE = process.env.E2E_FOCUS_DOCK_MODE || (process.env.E2E_FOCUS_DOCK === '1' ? 'warm' : 'off');
const DOCK_WARM = DOCK_MODE === 'warm';
const DOCK_OPEN = DOCK_MODE === 'open';
const EMOJI_TEXT = process.env.E2E_FOCUS_EMOJI_TEXT === '1';
const VIEWPORTS = (process.env.E2E_FOCUS_VIEWPORTS || '1440x900')
  .split(',')
  .map((s) => {
    const [w, h] = s.trim().toLowerCase().split('x').map(Number);
    return { width: w, height: h };
  })
  .filter((v) => Number.isFinite(v.width) && v.width > 0 && Number.isFinite(v.height) && v.height > 0);
const SHOTS = 'e2e-artifacts/emoji-picker';

test.skip(process.env.E2E_LOCAL !== '1', 'focused bench needs the local stack: run with E2E_LOCAL=1 E2E_BUILD=1');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

const installHook = () => {
  window.__perf = { t0: null, commits: [], longTasks: [], profiles: {}, requests: [] };
  window.__longTasks = window.__perf.longTasks;
  const hook = {
    renderers: new Map(),
    listeners: {},
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    sub() { return () => {}; },
    on() {},
    off() {},
    emit() {},
    checkDCE(fn) { try { fn(); } catch { /* noop */ } },
    supportsFiber: true,
    getFiberRoots() { return new Set(); },
    onCommitFiberRoot(id, root) {
      let rendered = 0;
      let threadRendered = 0;
      try {
        const seen = new Set();
        const thread = document.querySelector('[data-testid="chat-thread-scroll"]');
        const stack = [root.current];
        while (stack.length && seen.size < 100000) {
          const f = stack.pop();
          if (!f || seen.has(f)) continue;
          seen.add(f);
          if (f.flags & 1) {
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
      list.getEntries().forEach((e) => window.__perf.longTasks.push({ start: e.startTime, duration: e.duration }));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* noop */ }
  // Сетевой след: любой запрос со стартом внутри окна замера фиксируется
  // с временем — видно, стреляют ли sticker-эндпоинты в send-окно.
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(method, url) {
    try {
      const rec = { kind: 'xhr', method: String(method), url: String(url), t: performance.now(), dur: null };
      window.__perf.requests.push(rec);
      this.addEventListener('loadend', () => { try { rec.dur = performance.now() - rec.t; } catch { /* noop */ } });
    } catch { /* noop */ }
    return xhrOpen.apply(this, arguments);
  };
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function wrappedFetch(input, init) {
      let rec = null;
      try {
        const url = typeof input === 'string' ? input : input?.url;
        const method = init?.method || (typeof input === 'object' ? input?.method : '') || 'GET';
        rec = { kind: 'fetch', method: String(method), url: String(url), t: performance.now(), dur: null };
        window.__perf.requests.push(rec);
      } catch { /* noop */ }
      const p = origFetch.apply(this, arguments);
      if (rec) Promise.resolve(p).finally(() => { try { rec.dur = performance.now() - rec.t; } catch { /* noop */ } }).catch(() => {});
      return p;
    };
  }
};

const waitMark = async (page, predSrc, timeout = 8000) => {
  try {
    await page.waitForFunction(`(${predSrc})()`, undefined, { timeout, polling: 'raf' });
  } catch { return -1; }
  return page.evaluate(() => performance.now());
};

const windowStats = (page, t0) => page.evaluate((t) => {
  const cs = window.__perf.commits.filter((c) => c.t >= t - 2 && c.t <= t + 4000);
  const reqs = window.__perf.requests.filter((r) => r.t >= t - 2 && r.t <= t + 4000);
  return {
    commits: cs.length,
    rendered: cs.reduce((s, c) => s + Math.max(0, c.rendered), 0),
    threadRendered: cs.reduce((s, c) => s + Math.max(0, c.threadRendered || 0), 0),
    longTasks: window.__perf.longTasks.filter((lt) => lt.start >= t - 2 && lt.start <= t + 4000).length,
    requests: reqs.map((r) => ({ m: `${r.method} ${r.url}`, dur: r.dur == null ? null : Math.round(r.dur * 10) / 10 })),
  };
}, t0);

const stats = (values) => {
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

async function apiLogin(page, username = U1, password = P1) {
  const resp = await page.request.post('/api/v1/auth/login', { data: { username, password } });
  expect(resp.ok(), `login ${username}`).toBeTruthy();
}

async function openChat(page) {
  await page.goto('/chat');
  await expect(page.getByTestId('chat-sidebar-list-scroll')).toBeVisible({ timeout: 30_000 });
}

const closeDock = async (page) => {
  const dock = page.getByTestId('chat-emoji-dock');
  await page.keyboard.press('Escape');
  if (await dock.isHidden().catch(() => true)) return;
  await page.getByTestId('chat-emoji-dock-close').click({ timeout: 5000 }).catch(() => {});
};

for (const vp of VIEWPORTS) {
  test(`send focus ${vp.width}x${vp.height} dock=${DOCK_MODE} emoji=${EMOJI_TEXT}`, async ({ browser }) => {
    test.setTimeout(600_000);
    const res = { viewport: vp, measuredAt: new Date().toISOString(), dock: DOCK_MODE, emojiText: EMOJI_TEXT, scenarios: {} };

    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript(installHook);
    const page = await ctx.newPage();
    await apiLogin(page);
    await openChat(page);

    // Собеседник + диалог как в гейте: group conv с e2e_user, открываем по id.
    const req = page.request;
    const usersResp = await req.get('/api/v1/chat/users');
    if (!usersResp.ok()) console.log(`[focus] /chat/users status=${usersResp.status()} body=${(await usersResp.text()).slice(0, 200)}`);
    const users = await usersResp.json().catch(() => ({}));
    const peer = (Array.isArray(users.items) ? users.items : []).find((u) => u.username === U2);
    expect(peer, 'peer user e2e_user').toBeTruthy();
    const convTitle = `FOCUS-send ${Date.now().toString(36)}`;
    const convResp = await req.post('/api/v1/chat/conversations/group', {
      data: { title: convTitle, member_user_ids: [peer.id] },
    });
    expect(convResp.ok(), 'create focus conv').toBeTruthy();
    const convId = (await convResp.json()).id;

    await page.goto(`/chat?conversation=${convId}`);
    const composer = page.getByTestId('chat-composer-textarea');
    await expect(composer).toBeVisible({ timeout: 30_000 });

    // Прогрев дока как в гейте: открыть, перейти на «Стикеры» (монтирует
    // вкладку + сетку + 3 fetch), вернуться, закрыть — дальше замер идёт
    // по «загрязнённой» странице, ровно как после emoji-сценариев гейта.
    // DOCK_MODE=open — та же последовательность, но док остаётся ОТКРЫТЫМ
    // на время send-цикла.
    if (DOCK_WARM || DOCK_OPEN) {
      const emojiButton = page.getByTestId('chat-composer-emoji-button');
      const dock = page.getByTestId('chat-emoji-dock');
      await emojiButton.click();
      await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 20000 });
      await dock.getByRole('tab', { name: 'Стикеры' }).click();
      await waitMark(page, `() => { const d = document.querySelector('[data-testid="chat-emoji-dock"]'); if (!d) return false; const s = d.querySelector('[data-sticker-section]') || d.querySelector('.MuiAlert-root'); return s && s.getBoundingClientRect().width > 0; }`, 15000);
      await dock.getByRole('tab', { name: 'Эмодзи' }).click().catch(() => {});
      if (DOCK_WARM) {
        await closeDock(page);
        await expect(dock).toBeHidden({ timeout: 10000 });
      } else {
        await expect(dock).toBeVisible({ timeout: 10000 });
      }
      const settle = Number(process.env.E2E_FOCUS_SETTLE_MS ?? 400);
      if (settle > 0) await page.waitForTimeout(settle);
      await page.evaluate(() => { window.__perf.requests.length = 0; window.__perf.commits.length = 0; window.__perf.longTasks.length = 0; });
    }

    // ── typing_echo control: x → echo в поле ──
    {
      const samples = [];
      for (let i = 0; i < Math.min(RUNS, 25); i += 1) {
        // При открытом доке (overlay) composer может быть перекрыт — focus()
        // без hit-проверки; клик оставлен для закрытых режимов.
        if (DOCK_OPEN) await composer.focus(); else await composer.click();
        await page.evaluate(() => { window.__perf.keyT0 = null;
          document.addEventListener('keydown', (e) => { if (window.__perf.keyT0 === null) window.__perf.keyT0 = performance.now(); }, { capture: true, once: true }); });
        await page.keyboard.type('x', { delay: 0 });
        const ready = await waitMark(page, `() => document.querySelector('[data-testid="chat-composer-textarea"]')?.value?.includes('x')`, 3000);
        const kt0 = await page.evaluate(() => window.__perf.keyT0 ?? performance.now() - 20);
        samples.push(ready - kt0);
        await composer.fill('');
      }
      res.scenarios.typing_echo_ms = stats(samples);
      console.log(`[focus] typing done p50=${res.scenarios.typing_echo_ms.p50} p95=${res.scenarios.typing_echo_ms.p95}`);
    }

    // ── send_echo: fill → t0 → Enter → пузырь ──
    {
      const samples = [];
      let sendTimeouts = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const text = EMOJI_TEXT
          ? `perf-send-${i}-${Date.now().toString(36)} 🙂`
          : `perf-send-${i}-${Date.now().toString(36)}`;
        await composer.fill(text);
        const t0 = await page.evaluate(() => performance.now());
        await page.keyboard.press('Enter');
        const bound = 10000;
        const ready = await waitMark(page, `() => [...document.querySelectorAll('[data-testid="chat-thread-scroll"] [data-message-id]')].some((el) => el.textContent.includes(${JSON.stringify(text)}))`, bound);
        const w = await windowStats(page, t0);
        samples.push({ ms: ready < 0 ? bound : ready - t0, ...w });
        if (ready < 0) sendTimeouts += 1;
      }
      const stickerReqs = samples.reduce((acc, s) => acc + s.requests.filter((r) => /sticker/i.test(r.m)).length, 0);
      const allReqs = samples.reduce((acc, s) => acc + s.requests.length, 0);
      res.scenarios.send_echo_ms = {
        ...stats(samples.map((s) => s.ms)),
        commits: stats(samples.map((s) => s.commits)),
        rendered: stats(samples.map((s) => s.rendered)),
        threadRendered: stats(samples.map((s) => s.threadRendered)),
        longTasks: samples.reduce((a, s) => a + s.longTasks, 0),
        timeouts: sendTimeouts,
        requestsTotal: allReqs,
        stickerRequests: stickerReqs,
      };
      // Сырые сэмплы — нужны для формы распределения (бимодальность).
      res.scenarios.send_echo_samples = samples.map((s) => ({
        ms: Math.round(s.ms * 10) / 10,
        commits: s.commits,
        rendered: s.rendered,
        threadRendered: s.threadRendered,
        longTasks: s.longTasks,
        requests: s.requests,
      }));
      console.log(`[focus] send done p50=${res.scenarios.send_echo_ms.p50} p95=${res.scenarios.send_echo_ms.p95} stickerReqs=${stickerReqs} reqs=${allReqs}`);
      console.log(`[focus] send samples: ${samples.map((s) => Math.round(s.ms)).join(',')}`);
    }

    const suffix = `${DOCK_MODE === 'warm' ? '-dock' : ''}${DOCK_OPEN ? '-dockopen' : ''}${EMOJI_TEXT ? '-emoji' : ''}`;
    writeFileSync(`${SHOTS}/perf-send-focus-${vp.width}x${vp.height}${suffix}.json`, JSON.stringify(res, null, 2));
    console.log('send-focus:', JSON.stringify(res.scenarios.send_echo_ms));
    await ctx.close();
  });
}
