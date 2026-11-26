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
//   * E2E_FOCUS_ATTRIB=1 — per-commit attribution: histogram of rendered
//     fibers (PerformedWork) by component name + region counters
//     (dock/composer/thread/none by DOM containment). Fiber names are
//     minified in production builds — run attribution in dev mode
//     (without E2E_BUILD=1); commit composition is branch-identical.
// Run: E2E_LOCAL=1 E2E_BUILD=1 npx playwright test e2e/chat-send-focus-perf.spec.js
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

/* global window, document, performance, PerformanceObserver, XMLHttpRequest, fetch, process, Element */

const U1 = process.env.E2E_USERNAME || 'e2e_admin';
const P1 = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const U2 = process.env.E2E_USERNAME2;
const RUNS = Number(process.env.E2E_FOCUS_RUNS || 40);
const DOCK_MODE = process.env.E2E_FOCUS_DOCK_MODE || (process.env.E2E_FOCUS_DOCK === '1' ? 'warm' : 'off');
const DOCK_WARM = DOCK_MODE === 'warm';
const DOCK_OPEN = DOCK_MODE === 'open';
const EMOJI_TEXT = process.env.E2E_FOCUS_EMOJI_TEXT === '1';
const ATTRIB = process.env.E2E_FOCUS_ATTRIB === '1';
const NWALK = process.env.E2E_FOCUS_NWALK === '1';
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

const installHook = ({ attrib, nwalk } = {}) => {
  window.__perf = { t0: null, commits: [], longTasks: [], profiles: {}, requests: [] };
  window.__longTasks = window.__perf.longTasks;
  // Читаемое имя fiber'а: function/memo/forwardRef — по type, иначе по тэгу.
  // В production-сборке имена минифицированы — атрибуцию гоняем в dev-режиме.
  const fiberName = (f) => {
    const t = f.type;
    if (typeof t === 'string') return `<${t}>`;
    if (typeof t === 'function') return t.displayName || t.name || 'anonymous';
    if (t && typeof t === 'object') {
      const inner = t.type;
      if (typeof inner === 'function') return inner.displayName || inner.name || 'anonymous';
      if (inner && typeof inner === 'object' && typeof inner.render === 'function') {
        return inner.render.displayName || inner.render.name || 'forwardRef';
      }
      if (typeof t.render === 'function') return t.render.displayName || t.render.name || 'forwardRef';
      return 'objectType';
    }
    switch (f.tag) {
      case 3: return 'HostRoot';
      case 7: return 'Fragment';
      case 8: return 'Mode';
      case 9: return 'ContextConsumer';
      case 10: return 'ContextProvider';
      case 12: return 'Profiler';
      case 13: return 'Suspense';
      case 22: return 'Offscreen';
      default: return `tag${f.tag}`;
    }
  };
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
      if (nwalk) {
        window.__perf.commits.push({ t: performance.now(), rendered: 0, threadRendered: 0 });
        return;
      }

      let rendered = 0;
      let threadRendered = 0;
      const names = attrib ? Object.create(null) : null;
      const regions = attrib ? { dock: 0, composer: 0, thread: 0, none: 0 } : null;
      let pickerAncestry = null;
      try {
        const seen = new Set();
        const thread = document.querySelector('[data-testid="chat-thread-scroll"]');
        const dock = attrib ? document.querySelector('[data-testid="chat-emoji-dock"]') : null;
        const composer = attrib ? document.querySelector('[data-testid="chat-composer-dock"]') : null;
        // DFS с наследованием региона: композитный fiber относится к региону
        // ближайшего host-предка (dock/composer/thread — непересекающиеся
        // поддеревья; приоритет dock > composer > thread на случай вложенности).
        const stack = [[root.current, 0]];
        while (stack.length && seen.size < 100000) {
          const entry = stack.pop();
          const f = entry[0];
          if (!f || seen.has(f)) continue;
          seen.add(f);
          let region = entry[1];
          if (attrib && f.stateNode instanceof Element) {
            if (dock && dock.contains(f.stateNode)) region = 2;
            else if (composer && composer.contains(f.stateNode)) region = 3;
            else if (thread && thread.contains(f.stateNode)) region = 1;
          }
          if (f.flags & 1) {
            rendered += 1;
            if (thread && f.stateNode instanceof Element && thread.contains(f.stateNode)) threadRendered += 1;
            if (attrib) {
              const name = fiberName(f);
              if (name) names[name] = (names[name] || 0) + 1;
              if (region === 2) regions.dock += 1;
              else if (region === 3) regions.composer += 1;
              else if (region === 1) regions.thread += 1;
              else regions.none += 1;
              // Ancestry chain of key picker internals: decides whether the
              // render comes from above (memo breach) or from picker-internal
              // state. '*' marks ancestors carrying PerformedWork this commit.
              if ((name === 'PickerContextProvider' || name === 'EmojiList') && !pickerAncestry) {
                const chain = [];
                let cur = f.return;
                let guard = 0;
                while (cur && guard < 60) {
                  guard += 1;
                  const an = fiberName(cur);
                  if (an && !an.startsWith('<') && !an.startsWith('tag')) {
                    chain.push(an + ((cur.flags & 1) ? '*' : ''));
                  }
                  cur = cur.return;
                }
                pickerAncestry = chain;
              }
            }
          }
          if (f.child) stack.push([f.child, region]);
          if (f.sibling) stack.push([f.sibling, region]);
        }
      } catch { rendered = -1; }
      const rec = { t: performance.now(), rendered, threadRendered };
      if (attrib) {
        rec.names = names;
        rec.regions = regions;
        if (pickerAncestry) rec.pickerAncestry = pickerAncestry;
      }
      window.__perf.commits.push(rec);
    },
    onCommitFiberUnmount() {},
    onScheduleFiberRoot() {},
  };
  // Совместимость со старой схемой без region-наследования: не-attrib прогоны
  // ходят по плоскому стеку, как раньше (те же накладные расходы).
  if (!attrib && !nwalk) {
    hook.onCommitFiberRoot = function onCommitFiberRootPlain(id, root) {
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
    };
  }
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
  const out = {
    commits: cs.length,
    rendered: cs.reduce((s, c) => s + Math.max(0, c.rendered), 0),
    threadRendered: cs.reduce((s, c) => s + Math.max(0, c.threadRendered || 0), 0),
    longTasks: window.__perf.longTasks.filter((lt) => lt.start >= t - 2 && lt.start <= t + 4000).length,
    requests: reqs.map((r) => ({ m: `${r.method} ${r.url}`, dur: r.dur == null ? null : Math.round(r.dur * 10) / 10 })),
  };
  if (cs.some((c) => c.names)) {
    const names = Object.create(null);
    const regions = { dock: 0, composer: 0, thread: 0, none: 0 };
    cs.forEach((c) => {
      if (c.names) Object.keys(c.names).forEach((n) => { names[n] = (names[n] || 0) + c.names[n]; });
      if (c.regions) Object.keys(regions).forEach((r) => { regions[r] += c.regions[r] || 0; });
    });
    out.names = names;
    out.regions = regions;
  }
  return out;
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
    await ctx.addInitScript(installHook, { attrib: ATTRIB, nwalk: NWALK });
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
      const windows = [];
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
        if (ATTRIB) windows.push(await windowStats(page, kt0));
        await composer.fill('');
        // fill('') — тоже keystroke-like обновление композера; окно следующего
        // замера начинается после него, пересечения нет.
        if (ATTRIB) await page.waitForTimeout(120);
      }
      res.scenarios.typing_echo_ms = stats(samples);
      if (ATTRIB && windows.length) {
        // Агрегат по окнам набора текста: медиана rendered/regions на окно +
        // суммарная гистограмма имён для выявления повторяющихся рендеров.
        res.scenarios.typing_attrib = {
          rendered: stats(windows.map((w) => w.rendered)),
          regionsMedian: {
            dock: stats(windows.map((w) => w.regions?.dock ?? 0)).p50,
            composer: stats(windows.map((w) => w.regions?.composer ?? 0)).p50,
            thread: stats(windows.map((w) => w.regions?.thread ?? 0)).p50,
            none: stats(windows.map((w) => w.regions?.none ?? 0)).p50,
          },
          namesTotal: windows.reduce((acc, w) => {
            Object.keys(w.names || {}).forEach((n) => { acc[n] = (acc[n] || 0) + w.names[n]; });
            return acc;
          }, {}),
          windows: windows.length,
        };
      }
      console.log(`[focus] typing done p50=${res.scenarios.typing_echo_ms.p50} p95=${res.scenarios.typing_echo_ms.p95}`);
    }

    // ── send_echo: fill → t0 → Enter → пузырь ──
    let profilesBeforeSend = null;
    {
      const samples = [];
      let sendTimeouts = 0;
      // Snapshot profiler counters before the measured send loop: a diff
      // afterwards proves whether the hidden dock subtree REALLY re-renders
      // per send (Profiler.onRender fires only when the wrapped tree updates),
      // unlike raw PerformedWork flags, which stay stale below memo bailouts.
      profilesBeforeSend = await page.evaluate(() => JSON.parse(JSON.stringify(window.__perf.profiles || {})));
      for (let i = 0; i < RUNS; i += 1) {
        const text = EMOJI_TEXT
          ? `perf-send-${i}-${Date.now().toString(36)} 🙂`
          : `perf-send-${i}-${Date.now().toString(36)}`;
        await composer.fill(text);
        const t0 = await page.evaluate((first) => {
          if (first) window.__perf.firstSendT0 = performance.now();
          return performance.now();
        }, i === 2);
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
        ...(s.regions ? { regions: s.regions } : {}),
      }));
      if (ATTRIB) {
        res.scenarios.send_attrib = {
          regionsMedian: {
            dock: stats(samples.map((s) => s.regions?.dock ?? 0)).p50,
            composer: stats(samples.map((s) => s.regions?.composer ?? 0)).p50,
            thread: stats(samples.map((s) => s.regions?.thread ?? 0)).p50,
            none: stats(samples.map((s) => s.regions?.none ?? 0)).p50,
          },
          namesTotal: samples.reduce((acc, s) => {
            Object.keys(s.names || {}).forEach((n) => { acc[n] = (acc[n] || 0) + s.names[n]; });
            return acc;
          }, {}),
        };
      }
      console.log(`[focus] send done p50=${res.scenarios.send_echo_ms.p50} p95=${res.scenarios.send_echo_ms.p95} stickerReqs=${stickerReqs} reqs=${allReqs}`);
      console.log(`[focus] send samples: ${samples.map((s) => Math.round(s.ms)).join(',')}`);
    }

    if (ATTRIB) {
      // TEMP-проба стабильности пропов memo-границ (useTempPropProbe):
      // какие пропы меняют identity между рендерами дока/вкладки.
      res.propChanges = await page.evaluate(() => window.__perf.propChanges || null);
      const profilesAfter = await page.evaluate(() => window.__perf.profiles || null);
      res.profiles = profilesAfter;
      res.profilesSendDiff = Object.keys(profilesAfter || {}).reduce((acc, k) => {
        const b = (profilesBeforeSend || {})[k] || { mount: 0, update: 0, actual: 0, base: 0 };
        const a = profilesAfter[k];
        acc[k] = { mount: a.mount - b.mount, update: a.update - b.update, actual: a.actual - b.actual };
        return acc;
      }, {});
      // Покоммитный таймлайн: окно первого send-замера — точная атрибуция,
      // что рендерится синхронно с echo, а что в хвосте (refresh/reorder).
      const firstT0 = await page.evaluate(() => window.__perf.firstSendT0 ?? null);
      res.commitsDump = await page.evaluate((t0) => {
        if (!t0) return null;
        return window.__perf.commits
          .filter((c) => c.t >= t0 - 2 && c.t <= t0 + 1500)
          .map((c) => ({
            dt: Math.round((c.t - t0) * 10) / 10,
            rendered: c.rendered,
            regions: c.regions,
            names: c.names,
            pickerAncestry: c.pickerAncestry || null,
          }));
      }, firstT0);
    }
    const suffix = `${DOCK_MODE === 'warm' ? '-dock' : ''}${DOCK_OPEN ? '-dockopen' : ''}${EMOJI_TEXT ? '-emoji' : ''}${ATTRIB ? '-attrib' : ''}`;
    writeFileSync(`${SHOTS}/perf-send-focus-${vp.width}x${vp.height}${suffix}.json`, JSON.stringify(res, null, 2));
    console.log('send-focus:', JSON.stringify(res.scenarios.send_echo_ms));
    await ctx.close();
  });
}
