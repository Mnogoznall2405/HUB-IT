// Issue #88: компактный benchmark ТЁПЛОГО повторного открытия панели эмодзи
// (keep-alive unhide) на production-сборке.
//
// Opt-in only: спек пропускается, пока явно не задан E2E_PERF=1 — в обычный
// e2e-прогон не входит. Запуск:
//   E2E_LOCAL=1 E2E_BUILD=1 E2E_PERF=1 npx playwright test e2e/chat-emoji-warm-reopen.spec.js
// Knobs: E2E_PERF_RUNS (default 20), E2E_PERF_COLD_RUNS (default 3),
//        E2E_PERF_LABEL (default current) — имя попадает в файл результата,
//        E2E_PERF_ARTIFACT_DIR, E2E_CLOSE_WAIT_MS (default 600 —
//        при короткой паузе хвост close-каскада наедает main-thread, см. #88).
//
// Сознательно БЕЗ fiber-инструментации и CDP-трейсов: обход fiber-дерева на
// каждый коммит сам стоит миллисекунды и завышает абсолютные числа (артефакт,
// установленный в #88), а сырые трейсы в репозитории не нужны. Замер чистый:
// t0 в capture-фазе клика + rAF-поллинг стадий готовности.
//
// Видимость — только через window.__emojiVis (e2e/perf/emoji-panel-visibility.js,
// та же реализация, что и в замере #80): после фикса #88 скрытый док имеет
// visibility:hidden и сохраняет геометрию. Для демонстрации ложноположительности
// старой проверки рядом пишутся legacy-стадии, повторяющие прежнюю логику #80
// (размеры/координаты без computed visibility): на сборке с фиксом они
// «измеряют» открытие за ~0 мс на ещё скрытой панели.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installEmojiPanelVisibility } from './perf/emoji-panel-visibility.js';

/* global window, document, performance, requestAnimationFrame, innerHeight, innerWidth, getComputedStyle, process */

const USERNAME = process.env.E2E_USERNAME || 'e2e_admin';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const RUNS = Number(process.env.E2E_PERF_RUNS || 20);
const COLD_RUNS = Number(process.env.E2E_PERF_COLD_RUNS || 3);
const LABEL = String(process.env.E2E_PERF_LABEL || 'current').replace(/[^a-z0-9_-]/gi, '-');
const OUT_DIR = process.env.E2E_PERF_ARTIFACT_DIR || 'e2e-artifacts/emoji-picker';
const OUT_FILE = `${OUT_DIR}/warm-reopen-${LABEL}.json`;
const CLOSE_WAIT = Number(process.env.E2E_CLOSE_WAIT_MS || 600);
const VIEWPORT = { width: 1440, height: 900 };

test.skip(process.env.E2E_PERF !== '1', 'perf benchmark is opt-in only: run with E2E_PERF=1 E2E_LOCAL=1 E2E_BUILD=1');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

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

// t0 ставится capture-обработчиком на самой кнопке непосредственно перед
// пользовательским click — протокольная задержка Playwright в замер не входит.
const armActionClick = async (locator) => {
  await locator.evaluate((element) => {
    window.__perf = window.__perf || {};
    element.addEventListener('click', () => {
      window.__perf.actionT0 = performance.now();
    }, { capture: true, once: true });
  });
};

// Поллер стадий запускается ДО клика и работает каждый кадр независимо от
// roundtrip'ов page.evaluate — иначе первый опрос начинается через десятки
// миллисекунд после клика и «схлопывает» все стадии в момент своего старта.
// Стадии пишутся как АБСОЛЮТНЫЕ performance.now() метки; относительные
// значения считаются против t0 capture-фазы клика уже в Node.
// corrected-* — через общий visibility helper; legacy-* — прежняя логика #80
// (геометрия без computed visibility). На сборке с фиксом #88 legacy-стадии
// срабатывают ДО клика (отрицательное время) — панель с visibility:hidden
// имеет полную геометрию; это и есть доказательство ложноположительности.
const startReopenPoller = (page) => page.evaluate(() => {
  window.__perf = window.__perf || {};
  window.__perf.actionT0 = null;
  window.__perf.stamps = {};
  window.__perf.pollerDone = false;
  const stamps = window.__perf.stamps;
  const vis = window.__emojiVis;
  const stamp = (key) => {
    if (stamps[key] !== undefined) return;
    stamps[key] = performance.now();
  };
  // Прежняя проверка #80 (anti-pattern): размеры/пересечение с viewport.
  // visibility:hidden элемент проходит её насквозь.
  const legacyVisible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < innerHeight
      && rect.right > 0 && rect.left < innerWidth;
  };
  const imgLoaded = (button) => {
    const img = button?.querySelector('img');
    return Boolean(img && img.complete && img.naturalWidth > 0);
  };
  const startedAt = performance.now();
  const poll = () => {
    const dock = document.querySelector('[data-testid="chat-emoji-dock"]');
    if (dock) {
      // legacy: «виден» = есть ширина (ложно на visibility:hidden).
      if (dock.getBoundingClientRect().width > 0) stamp('legacyDockVisible');
      if (vis.userVisible(dock)) stamp('dockVisible');
    }
    // corrected-стадии привязаны к видимости самого дока: input/кнопки пикера
    // могут иметь собственную динамику visibility (переходы/внутренние классы
    // emoji-picker-react), но «панель открыта» определяется доком.
    const firstButton = vis.firstVisibleEmojiButton();
    if (firstButton && imgLoaded(firstButton)) stamp('firstEmojiVisible');
    if (vis.interactiveSearchInput()) stamp('interactive');
    const button = dock?.querySelector('.EmojiPickerReact button.epr-emoji');
    if (button && !button.disabled && imgLoaded(button) && legacyVisible(button)) {
      stamp('legacyFirstEmoji');
    }
    const search = dock?.querySelector('.EmojiPickerReact input');
    if (search && !search.disabled && legacyVisible(search)) {
      stamp('legacyInteractive');
    }
    if (stamps.firstEmojiVisible !== undefined && stamps.interactive !== undefined) {
      window.__perf.pollerDone = true;
      return;
    }
    if (performance.now() - startedAt > 8000) {
      stamps.timedOut = 1;
      window.__perf.pollerDone = true;
      return;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
});

// Дожидается конца поллинга и возвращает стадии, пересчитанные от t0 клика
// (округление 0.1 мс). Отрицательные legacy-значения — ожидаемое доказательство
// ложноположительности, не ошибка.
const collectReopenStages = async (page) => {
  await page.waitForFunction(() => window.__perf?.pollerDone === true, undefined, { timeout: 12_000 });
  const raw = await page.evaluate(() => ({
    stamps: window.__perf.stamps,
    t0: window.__perf.actionT0,
  }));
  const t0 = raw.t0 ?? raw.stamps.dockVisible ?? 0;
  const marks = { t0Missing: raw.t0 == null };
  for (const [key, value] of Object.entries(raw.stamps)) {
    if (typeof value !== 'number' || key === 'timedOut') continue;
    marks[key] = Math.round((value - t0) * 10) / 10;
  }
  if (raw.stamps.timedOut) marks.timedOut = true;
  return marks;
};

const stats = (values) => {
  // Отрицательные значения сохраняются: у legacy-стадий на сборке с фиксом #88
  // они и есть доказательство — скрытая панель «видна» ещё до клика.
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
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

const stageStats = (samples, key) => stats(samples.map((m) => m[key]));

test('warm reopen benchmark: corrected vs legacy visibility detection', async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT_DIR, { recursive: true });

  const ctx = await browser.newContext({ viewport: VIEWPORT });
  await ctx.addInitScript(installEmojiPanelVisibility);
  const page = await ctx.newPage();
  await apiLogin(page);
  await openChat(page);
  const button = page.getByTestId('chat-composer-emoji-button');
  const dock = page.getByTestId('chat-emoji-dock');

  // Прогрев чанков/keep-alive: первое открытие+закрытие вне замера.
  await button.click();
  await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('chat-emoji-dock-close').click();
  await expect(dock).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(300);

  // Состояние скрытого keep-alive дока: непустая сетка = виртуализация жива
  // (фикс #88), пустая = каскад display:none её опустошил (baseline). Здесь же
  // прямое доказательство ложноположительности старой проверки: rectWidth > 0
  // при cssVisible === false.
  const hiddenProbe = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="chat-emoji-dock"]');
    if (!d) return null;
    const vis = window.__emojiVis;
    const input = d.querySelector('.EmojiPickerReact input');
    const button = d.querySelector('.EmojiPickerReact button.epr-emoji');
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    };
    return {
      emojiButtonsInDom: vis.emojiGridButtons(d).length,
      searchInputsInDom: d.querySelectorAll('.EmojiPickerReact input').length,
      cssVisible: vis.cssVisible(d),
      rectWidth: Math.round(d.getBoundingClientRect().width),
      computedVisibility: getComputedStyle(d).visibility,
      computedDisplay: getComputedStyle(d).display,
      dockRect: rectOf(d),
      inputRect: rectOf(input),
      firstButtonRect: rectOf(button),
    };
  });

  const iterations = [];
  for (let i = 0; i < RUNS; i += 1) {
    await startReopenPoller(page);
    await armActionClick(button);
    await button.click();
    const marks = await collectReopenStages(page);
    iterations.push(marks);
    await page.getByTestId('chat-emoji-dock-close').click();
    await expect(dock).toBeHidden({ timeout: 10_000 });
    await page.waitForTimeout(CLOSE_WAIT);
  }
  await ctx.close();

  // ── Контроль холодного открытия: свежие контексты, первый пользовательский
  // путь. Visibility detection здесь не влияет на результат (скрытого дока
  // ещё не существует) — контроль, что замер #80 не деградирует от правки.
  const cold = [];
  for (let i = 0; i < COLD_RUNS; i += 1) {
    const cctx = await browser.newContext({ viewport: VIEWPORT });
    await cctx.addInitScript(installEmojiPanelVisibility);
    const cpage = await cctx.newPage();
    await apiLogin(cpage);
    await openChat(cpage);
    const cbutton = cpage.getByTestId('chat-composer-emoji-button');
    await startReopenPoller(cpage);
    await armActionClick(cbutton);
    await cbutton.click();
    cold.push(await collectReopenStages(cpage));
    await cctx.close();
  }

  const report = {
    label: LABEL,
    runs: iterations.length,
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
    closeWaitMs: CLOSE_WAIT,
    hiddenProbe,
    warmReopen: {
      dockVisible: stageStats(iterations, 'dockVisible'),
      firstEmojiVisible: stageStats(iterations, 'firstEmojiVisible'),
      interactive: stageStats(iterations, 'interactive'),
      legacyDockVisible: stageStats(iterations, 'legacyDockVisible'),
      legacyFirstEmoji: stageStats(iterations, 'legacyFirstEmoji'),
      legacyInteractive: stageStats(iterations, 'legacyInteractive'),
      timedOut: iterations.filter((m) => m.timedOut).length,
      rawInteractive: iterations.map((m) => m.interactive ?? null),
      rawFirstEmojiVisible: iterations.map((m) => m.firstEmojiVisible ?? null),
      rawLegacyInteractive: iterations.map((m) => m.legacyInteractive ?? null),
    },
    coldOpen: {
      dockVisible: stageStats(cold, 'dockVisible'),
      firstEmojiVisible: stageStats(cold, 'firstEmojiVisible'),
      interactive: stageStats(cold, 'interactive'),
      rawInteractive: cold.map((m) => m.interactive ?? null),
    },
    measuredAt: new Date().toISOString(),
  };
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(`warm-reopen report written: ${OUT_FILE}`);
  console.log(JSON.stringify({
    hiddenProbe,
    warmP50interactive: report.warmReopen.interactive.p50,
    warmP50firstEmoji: report.warmReopen.firstEmojiVisible.p50,
    legacyP50interactive: report.warmReopen.legacyInteractive.p50,
    coldP50interactive: report.coldOpen.interactive.p50,
  }));

  expect(report.warmReopen.timedOut).toBe(0);
  expect(report.warmReopen.interactive.n).toBe(RUNS);
});
