// Production-гейт всего чата (Phase 2.1): одинаковые условия до/после
// (E2E_BUILD=1 → vite build + preview), p50/p95 на 20 прогонах, два
// viewport, история 1000 сообщений. Замеры — внутристраничные (t0 в
// capture-фазе события, готовность опрашивается каждый rAF), задержка
// Playwright-команд в цифры не входит.
// Результаты: e2e-artifacts/emoji-picker/perf-chat-regression-{WxH}.json
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* global window, document, performance, requestAnimationFrame, PerformanceObserver, process */

const U1 = process.env.E2E_USERNAME || 'e2e_admin';
const P1 = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const U2 = process.env.E2E_USERNAME2;
const P2 = process.env.E2E_PASSWORD2 || process.env.E2E_PASSWORD;
const RUNS = Number(process.env.E2E_GATE_RUNS || 20);
const COLD_RUNS = Number(process.env.E2E_GATE_COLD || 5);
// E2E_GATE_GC=1: HeapProfiler.collectGarbage перед каждым измеренным
// действием — убирает GC как скрытый конфаундер между ревизиями.
const GATE_GC = process.env.E2E_GATE_GC === '1';
const TOTAL_LONG = 1000;
const CHAT_DB_PATH = fileURLToPath(new URL('./stack/.state/chat.sqlite3', import.meta.url));
const SHOTS = 'e2e-artifacts/emoji-picker';

test.skip(process.env.E2E_LOCAL !== '1', 'production gate needs the local stack: run with E2E_LOCAL=1 E2E_BUILD=1');
test.describe.configure({ mode: 'serial' });
// Без лимита клик по непоявившемуся локатору ждёт вечно (actionTimeout=0
// в конфиге). Любое зависшее действие должно упасть именной ошибкой за 20с.
test.use({ actionTimeout: 20_000 });

// ── Инструментация: коммиты (PerformedWork), longtask, t0 по capture ──
const installHook = () => {
  window.__perf = { t0: null, commits: [], longTasks: [] };
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
  document.addEventListener('keydown', (e) => {
    if (e.target?.closest?.('[data-testid="chat-composer-textarea"]')) {
      window.__perf.t0 = performance.now();
    }
  }, true);
};

// Готовность изнутри страницы: waitForFunction опрашивает каждый rAF,
// возвращаем момент resolve из самой страницы. Таймаут → -1: вызывающий
// код обязан учесть его явно (timeouts в отчёте), молча не выкидываем.
const waitMark = async (page, predSrc, timeout = 8000) => {
  try {
    await page.waitForFunction(`(${predSrc})()`, undefined, { timeout, polling: 'raf' });
  } catch { return -1; }
  return page.evaluate(() => performance.now());
};

// Таймаут не исключается молча: сэмпл идёт в статистику цензурированным
// значением = bound, плюс счётчик timeouts в сценарии.
const pushSample = (arr, ready, t0, bound, bag) => {
  if (ready < 0) { bag.timeouts = (bag.timeouts || 0) + 1; arr.push(bound); }
  else arr.push(ready - t0);
};

// Cold-навигация: performance.now() сбрасывается на navigation → обе
// отметки берём в Date.now() (единые часы до и после goto).
const waitMarkDate = async (page, predSrc, timeout = 8000) => {
  try {
    await page.waitForFunction(`(${predSrc})()`, undefined, { timeout, polling: 'raf' });
  } catch { return -1; }
  return page.evaluate(() => Date.now());
};

const windowStats = (page, t0) => page.evaluate((t) => {
  const cs = window.__perf.commits.filter((c) => c.t >= t - 2 && c.t <= t + 4000);
  return {
    commits: cs.length,
    rendered: cs.reduce((s, c) => s + Math.max(0, c.rendered), 0),
    threadRendered: cs.reduce((s, c) => s + Math.max(0, c.threadRendered || 0), 0),
    longTasks: window.__perf.longTasks.filter((lt) => lt.start >= t - 2 && lt.start <= t + 4000).length,
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
  await expect.poll(() => page.locator('[data-chat-active]').count(), { timeout: 15_000 }).toBeGreaterThan(0);
}

// Диалог может не входить в видимое окно списка — открываем через поиск.
const openConvByTitle = async (page, title) => {
  const search = page.getByPlaceholder('Поиск');
  await search.fill(title);
  const item = page.locator('[data-chat-active]', { hasText: title }).first();
  await item.click({ timeout: 15000 });
  // Без слепого ожидания: waitMark сам подтвердит готовность в rAF.
};

// В overlay-режиме (узкая ширина) бэкдроп MUI перехватывает клик по
// кнопке — закрываем как пользователь: Escape, затем крестик дока.
const closeDock = async (page) => {
  const dock = page.getByTestId('chat-emoji-dock');
  await page.keyboard.press('Escape');
  if (await dock.isHidden().catch(() => true)) return;
  await page.getByTestId('chat-emoji-dock-close').click({ timeout: 5000 }).catch(() => {});
};

const clickConv = async (page, index) => {
  const items = page.locator('[data-chat-active]');
  await expect.poll(() => items.count(), { timeout: 15000 }).toBeGreaterThan(0);
  const count = await items.count();
  const item = items.nth(index % count);
  const t0 = await page.evaluate(() => performance.now());
  await item.click();
  return t0;
};

for (const vp of [{ width: 1440, height: 900 }, { width: 988, height: 838 }]) {
  test(`chat regression gate ${vp.width}x${vp.height}`, async ({ browser }) => {
    test.setTimeout(1500_000);
    const res = { viewport: vp, measuredAt: new Date().toISOString(), scenarios: {} };

    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript(installHook);
    const page = await ctx.newPage();
    const gateCdp = await ctx.newCDPSession(page);
    const gateGc = GATE_GC
      ? async () => { try { await gateCdp.send('HeapProfiler.enable'); await gateCdp.send('HeapProfiler.collectGarbage'); } catch { /* noop */ } }
      : async () => {};
    await apiLogin(page);
    await openChat(page);

    // Длинная история + гарантированные диалоги для переключений
    let longConvTitle = null;
    let longConvId = null;
    const switchConvIds = [];
    if (U2) {
      longConvTitle = `PERF-1000 ${Date.now().toString(36)}`;
      const req = page.request;
      const users = await (await req.get('/api/v1/chat/users')).json();
      const peer = (users.items || users).find((u) => u.username === U2);
      const me = await (await req.get('/api/v1/auth/me')).json();
      const mkConv = async (title) => {
        const r = await req.post('/api/v1/chat/conversations/group', {
          data: { title, member_user_ids: [peer.id] },
        });
        expect(r.ok(), `create conv ${title}`).toBeTruthy();
        return (await r.json()).id;
      };
      // Rate limit: не больше 5 новых бесед в минуту → 4 switch + 1 длинная;
      // остальные позиции списка занимают сидовые диалоги.
      longConvId = await mkConv(longConvTitle);
      for (let c = 0; c < 4; c += 1) {
        const cid = await mkConv(`PERF-switch-${c}`);
        switchConvIds.push(cid);
        await req.post(`/api/v1/chat/conversations/${cid}/messages`, {
          data: { body: `conv-marker-${c}`, body_format: 'plain' },
        });
      }
      const longId = longConvId;
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(CHAT_DB_PATH);
      const ts = (ms) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '000');
      try {
        db.exec('PRAGMA busy_timeout = 10000; BEGIN');
        const insLong = db.prepare(`INSERT INTO chat_messages (id, conversation_id, sender_user_id, kind,
          body_format, body, conversation_seq, client_message_id, reply_to_message_id, created_at, is_deleted)
          VALUES (?, ?, ?, 'text', 'plain', ?, ?, ?, NULL, ?, 0)`);
        const updC = db.prepare('UPDATE chat_conversations SET last_message_id = ?, last_message_seq = ?, last_message_at = ? WHERE id = ?');
        const startedAt = Date.now() - TOTAL_LONG * 90_000;
        let lastId = null;
        for (let i = 0; i < TOTAL_LONG; i += 1) {
          lastId = crypto.randomUUID();
          insLong.run(lastId, longId, i % 2 ? Number(peer.id) : Number(me.id),
            `perf-${String(i).padStart(5, '0')} история`, i + 1, `perf-${longId}-${i}`,
            ts(startedAt + i * 90_000));
        }
        updC.run(lastId, TOTAL_LONG, ts(startedAt + (TOTAL_LONG - 1) * 90_000), longId);
        db.exec('COMMIT');
      } finally { db.close(); }
      await page.reload();
      await openChat(page);
    }

    const composer = page.getByTestId('chat-composer-textarea');
    const emojiButton = page.getByTestId('chat-composer-emoji-button');
    const dock = page.getByTestId('chat-emoji-dock');
    const popover = page.getByTestId('chat-desktop-emoji-panel');
    const convItems = page.locator('[data-chat-active]');
    const convCount = await convItems.count();

    // ── conv_switch: переключение между диалогами ──
    // Готовность = URL ?conversation=<id> целевой беседы + видимый
    // контент именно этой переписки (сидовый marker conv-marker-N).
    {
      const targets = switchConvIds.map((id, i) => ({ id, title: `PERF-switch-${i}`, marker: `conv-marker-${i}` }));
      const useTargets = targets.length ? targets : [{ id: null, title: null, marker: null }];
      const samples = [];
      const bag = { timeouts: 0 };
      for (let i = 0; i < RUNS; i += 1) {
        const t = useTargets[i % useTargets.length];
        await gateGc();
        const t0 = await page.evaluate(() => performance.now());
        if (t.id) await openConvByTitle(page, t.title);
        else await clickConv(page, i + 1);
        const bound = 10000;
        const ready = t.id
          ? await waitMark(page, `() => location.search.includes('conversation=${t.id}') && document.querySelector('[data-testid="chat-thread-scroll"] [data-message-id]') && document.querySelector('[data-testid="chat-thread-scroll"]').innerText.includes(${JSON.stringify(t.marker)})`, bound)
          : await waitMark(page, `() => document.querySelector('[data-testid="chat-thread-scroll"] [data-message-id]') !== null`, bound);
        const w = await windowStats(page, t0);
        const ms = ready < 0 ? bound : ready - t0;
        if (ready < 0) bag.timeouts += 1;
        samples.push({ ms, ...w });
      }
      res.scenarios.conv_switch = { ms: stats(samples.map((s) => s.ms)), commits: stats(samples.map((s) => s.commits)), longTasks: samples.reduce((a, s) => a + s.longTasks, 0), timeouts: bag.timeouts };
      console.log(`[gate] conv_switch done ` + Date.now());
    }

    // ── history_load: контент переписки — marker внутри data-message-id ──
    if (switchConvIds.length) {
      const targets = switchConvIds.map((id, i) => ({ title: `PERF-switch-${i}`, marker: `conv-marker-${i}` }));
      const samples = [];
      const bag = { timeouts: 0 };
      for (let i = 0; i < RUNS; i += 1) {
        const prev = targets[(i + 1) % targets.length];
        const t = targets[i % targets.length];
        await openConvByTitle(page, prev.title);
        await waitMark(page, `() => document.querySelector('[data-testid="chat-composer-textarea"]') !== null`);
        await gateGc();
        const t0 = await page.evaluate(() => performance.now());
        await openConvByTitle(page, t.title);
        const bound = 10000;
        const ready = await waitMark(page, `() => [...document.querySelectorAll('[data-testid="chat-thread-scroll"] [data-message-id]')].some((el) => el.innerText.includes(${JSON.stringify(t.marker)}))`, bound);
        const w = await windowStats(page, t0);
        const ms = ready < 0 ? bound : ready - t0;
        if (ready < 0) bag.timeouts += 1;
        samples.push({ ms, ...w });
      }
      res.scenarios.history_load = { ms: stats(samples.map((s) => s.ms)), commits: stats(samples.map((s) => s.commits)), longTasks: samples.reduce((a, s) => a + s.longTasks, 0), timeouts: bag.timeouts };
      console.log(`[gate] history_load done ${Date.now()}`);
    }

    // ── history_1000: длинный диалог ──
    if (longConvTitle) {
      const samples = [];
      for (let i = 0; i < Math.min(RUNS, 8); i += 1) {
        await clickConv(page, 0);
        await waitMark(page, `() => document.querySelector('[data-testid="chat-composer-textarea"]') !== null`);
        const t0 = await page.evaluate(() => performance.now());
        await openConvByTitle(page, 'PERF-1000');
        const ready = await waitMark(page, `() => document.querySelector('[data-testid="chat-thread-scroll"] [data-message-id]') !== null`, 15000);
        const settled = await waitMark(page, `() => document.querySelector('[data-testid="chat-composer-textarea"]') !== null`, 15000);
        const w = await windowStats(page, t0);
        samples.push({ first: ready - t0, settled: settled - t0, ...w });
      }
      res.scenarios.history_1000 = {
        firstBubbleMs: stats(samples.map((s) => s.first)),
        settledMs: stats(samples.map((s) => s.settled)),
        commits: stats(samples.map((s) => s.commits)),
        longTasks: samples.reduce((a, s) => a + s.longTasks, 0),
      };
      console.log(`[gate] history_1000 done ${Date.now()}`);
    }

    // ── typing: задержка эха символа ──
    {
      const samples = [];
      for (let i = 0; i < RUNS; i += 1) {
        await composer.click();
        await page.evaluate(() => { window.__perf.keyT0 = null;
          document.addEventListener('keydown', (e) => { if (window.__perf.keyT0 === null) window.__perf.keyT0 = performance.now(); }, { capture: true, once: true }); });
        await page.keyboard.type('x', { delay: 0 });
        const ready = await waitMark(page, `() => document.querySelector('[data-testid="chat-composer-textarea"]')?.value?.includes('x')`, 3000);
        const kt0 = await page.evaluate(() => window.__perf.keyT0 ?? performance.now() - 20);
        samples.push(ready - kt0);
        await composer.fill('');
      }
      res.scenarios.typing_echo_ms = stats(samples);
      console.log(`[gate] typing done ${Date.now()}`);
    }

    // ── emoji: hover / pinned / вкладки ──
    {
      // warm-up
      await emojiButton.click();
      await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 20000 });
      await closeDock(page);
      await expect(dock).toBeHidden({ timeout: 10000 });

      const pinned = [];
      for (let i = 0; i < RUNS; i += 1) {
        const t0 = await page.evaluate(() => { window.__perf.t0 = performance.now(); return performance.now(); });
        await emojiButton.click();
        const ready = await waitMark(page, `() => { const d = document.querySelector('[data-testid="chat-emoji-dock"]'); return d && d.getBoundingClientRect().width > 0 && d.querySelector('.EmojiPickerReact button.epr-emoji img')?.complete; }`);
        const w = await windowStats(page, t0);
        pinned.push({ ms: ready < 0 ? 8000 : ready - t0, timedOut: ready < 0, ...w });
        await closeDock(page);
        await expect(dock).toBeHidden({ timeout: 10000 });
      }
      res.scenarios.emoji_pinned = { ms: stats(pinned.map((s) => s.ms)), commits: stats(pinned.map((s) => s.commits)), threadRendered: stats(pinned.map((s) => s.threadRendered)), longTasks: pinned.reduce((a, s) => a + s.longTasks, 0), timeouts: pinned.filter((s) => s.timedOut).length };

      const hover = [];
      const hoverBag = { timeouts: 0, missedEnter: 0 };
      for (let i = 0; i < RUNS; i += 1) {
        // pointerenter не всплывает и не ходит capture — слушатель вешаем
        // прямо на кнопку, t0 = момент события, без синтетики.
        await page.evaluate(() => {
          window.__perf.hoverT0 = null;
          const btn = document.querySelector('[data-testid="chat-composer-emoji-button"]');
          btn?.addEventListener('pointerenter', () => {
            if (window.__perf.hoverT0 === null) window.__perf.hoverT0 = performance.now();
          }, { once: true });
        });
        await emojiButton.hover();
        const bound = 6000;
        const ready = await waitMark(page, `() => { const p = document.querySelector('[data-testid="chat-desktop-emoji-panel"]'); return p && p.getBoundingClientRect().width > 0; }`, bound);
        const ht0 = await page.evaluate(() => window.__perf.hoverT0);
        // Без синтетического t0: pointerenter не пришёл → сэмпл недействителен,
        // считаем отдельно (missedEnter), в статистику не подставляем.
        if (ht0 === null || ready < 0) {
          if (ready < 0) hoverBag.timeouts += 1;
          if (ht0 === null) hoverBag.missedEnter += 1;
        } else {
          hover.push(ready - ht0);
        }
        // Отвод курсора в левый верхний угол — поповер занимает низ-право,
        // точка (700,300) на 988px попадает внутрь и hover не снимается.
        await page.mouse.move(60, 60);
        await page.keyboard.press('Escape').catch(() => {});
        await expect(popover).toBeHidden({ timeout: 6000 });
      }
      res.scenarios.emoji_hover_ms = { ...stats(hover), timeouts: hoverBag.timeouts, missedEnter: hoverBag.missedEnter };

      const tabs = { to: [], back: [] };
      await emojiButton.click();
      await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 20000 });
      for (let i = 0; i < RUNS; i += 1) {
        // Готовность вкладок = активная вкладка (aria-selected) + видимое
        // содержимое (rect>0), а не наличие скрытого keep-alive DOM.
        const t0 = await page.evaluate(() => performance.now());
        await dock.getByRole('tab', { name: 'Стикеры' }).click();
        const r1 = await waitMark(page, `() => { const d = document.querySelector('[data-testid="chat-emoji-dock"]'); if (!d) return false; const tab = d.querySelector('[role="tab"][aria-selected="true"]'); const s = d.querySelector('[data-sticker-section]') || d.querySelector('.MuiAlert-root'); return tab && /стикер/i.test(tab.textContent) && s && s.getBoundingClientRect().width > 0; }`, 8000);
        tabs.to.push(r1 - t0);
        const t1 = await page.evaluate(() => performance.now());
        await dock.getByRole('tab', { name: 'Эмодзи' }).click();
        const r2 = await waitMark(page, `() => { const d = document.querySelector('[data-testid="chat-emoji-dock"]'); if (!d) return false; const tab = d.querySelector('[role="tab"][aria-selected="true"]'); const s = d.querySelector('.EmojiPickerReact button.epr-emoji'); return tab && /эмодзи/i.test(tab.textContent) && s && s.getBoundingClientRect().width > 0; }`, 8000);
        tabs.back.push(r2 - t1);
      }
      res.scenarios.tab_to_stickers_ms = stats(tabs.to);
      res.scenarios.tab_to_emoji_ms = stats(tabs.back);
      await closeDock(page);
      await expect(dock).toBeHidden({ timeout: 10000 });
      console.log(`[gate] emoji done ${Date.now()}`);
    }

    // ── send: ввод + Enter → пузырь ──
    {
      const samples = [];
      let sendTimeouts = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const text = `perf-send-${i}-${Date.now().toString(36)}`;
        await composer.fill(text);
        const t0 = await page.evaluate(() => performance.now());
        await page.keyboard.press('Enter');
        const bound = 10000;
        const ready = await waitMark(page, `() => [...document.querySelectorAll('[data-testid="chat-thread-scroll"] [data-message-id]')].some((el) => el.textContent.includes(${JSON.stringify(text)}))`, bound);
        samples.push(ready < 0 ? bound : ready - t0);
        if (ready < 0) sendTimeouts += 1;
      }
      res.scenarios.send_echo_ms = { ...stats(samples), timeouts: sendTimeouts };
      console.log(`[gate] send done ${Date.now()}`);
    }

    // ── receive: сообщение от второго аккаунта ──
    if (U2 && P2) {
      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      await apiLogin(page2, U2, P2);
      const convs = await (await page2.request.get('/api/v1/chat/conversations')).json();
      const list = convs.items || convs;
      const target = list.find((c) => (c.title || '').includes('PERF-switch-0')) || list[0];
      // Открываем целевой диалог у первого пользователя — иначе входящее
      // сообщение попадает только в превью сайдбара. Диалог может быть
      // ниже окна списка → открываем напрямую по id.
      await page.goto(`/chat?conversation=${switchConvIds[0] || target.id}`);
      await waitMark(page, `() => document.querySelector('[data-testid="chat-composer-textarea"]') !== null`, 10000);
      const samples = [];
      let recvTimeouts = 0;
      for (let i = 0; i < Math.min(RUNS, 10); i += 1) {
        const text = `perf-recv-${i}-${Date.now().toString(36)}`;
        const t0 = await page.evaluate(() => performance.now());
        const resp = await page2.request.post(`/api/v1/chat/conversations/${target.id}/messages`, { data: { body: text, body_format: 'plain' } });
        if (!resp.ok()) break;
        const bound = 8000;
        const ready = await waitMark(page, `() => document.body.innerText.includes(${JSON.stringify(text)})`, bound);
        samples.push(ready < 0 ? bound : ready - t0);
        if (ready < 0) recvTimeouts += 1;
      }
      await ctx2.close();
      res.scenarios.receive_ms = { ...stats(samples), timeouts: recvTimeouts };
      console.log(`[gate] receive done ${Date.now()}`);
    }

    // ── memory: серии open/close с контролируемым GC через CDP ──
    {
      const heap = () => page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576));
      const cdp = await ctx.newCDPSession(page);
      const gc = async () => {
        try { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage'); } catch { /* noop */ }
      };
      for (let i = 0; i < 10; i += 1) {
        await emojiButton.click(); await expect(dock).toBeVisible(); await closeDock(page); await expect(dock).toBeHidden();
      }
      const series = [];
      for (let s = 0; s < 3; s += 1) {
        await gc();
        const before = await heap();
        for (let i = 0; i < 50; i += 1) {
          await emojiButton.click(); await expect(dock).toBeVisible({ timeout: 10000 }); await closeDock(page); await expect(dock).toBeHidden({ timeout: 10000 });
        }
        await gc();
        const after = await heap();
        series.push({ before, after, delta: after - before });
      }
      res.scenarios.memory_cycles_mb = { cyclesPerSeries: 50, series, meanDelta: Math.round(series.reduce((a, x) => a + x.delta, 0) / series.length) };
      console.log(`[gate] memory done ${Date.now()}`);
    }

    // ── chat_open cold: свежий контекст ──
    {
      const samples = [];
      let coldTimeouts = 0;
      for (let i = 0; i < COLD_RUNS; i += 1) {
        const c2 = await browser.newContext({ viewport: vp });
        const p2 = await c2.newPage();
        await apiLogin(p2);
        // Единые часы Date.now(): performance.now() сбрасывается при
        // навигации — t0 до goto и отметка после были бы из разных шкал.
        const t0 = Date.now();
        await p2.goto('/chat');
        const bound = 20000;
        const ready = await waitMarkDate(p2, `() => document.querySelector('[data-testid="chat-sidebar-list-scroll"]') && document.querySelector('[data-chat-active]')`, bound);
        if (ready < 0) { coldTimeouts += 1; samples.push(bound); }
        else samples.push(ready - t0);
        await c2.close();
      }
      res.scenarios.chat_open_cold_ms = { ...stats(samples), timeouts: coldTimeouts };
      console.log(`[gate] cold done ${Date.now()}`);
    }

    writeFileSync(`${SHOTS}/perf-chat-regression-${vp.width}x${vp.height}.json`, JSON.stringify(res, null, 2));
    console.log('chat-regression:', JSON.stringify(res, null, 2));
    await ctx.close();
  });
}
