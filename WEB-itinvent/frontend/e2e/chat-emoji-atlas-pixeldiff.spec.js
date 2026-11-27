// Issue #89 итерация 2 — пиксельный паритет sprite-атласа против PNG-рендера
// и программный анализ «штрихов» между глифами. НЕ часть гейта: измерительный
// зонд, прогон точечно (E2E_LOCAL=1, production build).
//
// Метод: два холодных контекста в одинаковом состоянии (sprite / seam-plain),
// скриншоты панели при DPR=2 и DPR=1, сравнение попиксельно через pngjs:
//   - mean|diff| по RGB всей панели и по образцовым ячейкам разных листов
//     (включая ZWJ-эмодзи и крайние ячейки — максимальный сдвиг позиции);
//   - доля пикселей с сильным отличием (>48/255 на канал);
//   - скан строк-зазоров между рядами сетки: если геометрия фона смещена или
//     ячейки «текут» друг в друга, в зазорах появляются системные штрихи —
//     считаем их отдельно по sprite/plain (в plain зазоры чистые по построению,
//     там каждый глиф — свой img).
// Дополнительно сохраняются magnified-crops (nearest neighbor x4) для ручной
// проверки глазами при 100%+ масштабе.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/* global window, document, performance, requestAnimationFrame, innerHeight, innerWidth, Image */

const USERNAME = process.env.E2E_USERNAME || 'e2e_admin';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const OUT = 'e2e-artifacts/emoji-picker/atlas-pixeldiff';

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

// Образцы ячеек: края листов (максимальный сдвиг background-position),
// середина, ZWJ-последовательность, флаг (региональные индикаторы), keycap.
function pickSamples() {
  const dataFile = readFileSync('src/lib/chat/generated/emojiSpriteData.js', 'utf8');
  const packed = dataFile.match(/EMOJI_SPRITE_ORDER\s*=\s*'([^']+)'/)[1];
  const order = packed.split(' ');
  const zwj = order.find((u) => u.includes('200d') && u.split('-').length >= 5);
  const flag = order.find((u) => /^1f1e[6-f]-1f1e[6-f]$/.test(u));
  const keycap = order.find((u) => u.includes('20e3'));
  const picks = {
    top: [
      order[0], // sheet-0, x=0, y=0 — нулевой сдвиг
      order[31], // x=31 — максимальный сдвиг по оси X первого ряда
      zwj, // ZWJ в первой категории, если есть
    ].filter(Boolean),
    deep: [
      order[511], // последняя ячейка sheet-0 — максимальный сдвиг в листе
      order[512], // первая ячейка sheet-1
      order[1200], // sheet-2 середина
      order[order.length - 1], // последняя ячейка последнего листа
      flag,
      keycap,
    ].filter(Boolean),
    order,
  };
  picks.top = [...new Set(picks.top)];
  picks.deep = [...new Set(picks.deep)];
  return picks;
}

// Ждём реальной дорисовки панели в обоих режимах и возвращаем прямоугольники
// кнопок образцов + дока в CSS-пикселях.
const settleAndCollect = (page, unifieds) => page.evaluate(async ({ unifieds: us }) => {
  const decodeSheets = async () => {
    const urls = new Set();
    document.querySelectorAll('.EmojiPickerReact button.epr-emoji').forEach((btn) => {
      const bg = window.getComputedStyle(btn).backgroundImage || '';
      const match = bg.match(/url\("?([^")]*sheet-[\w.-]+\.png)"?\)/);
      if (match) urls.add(match[1]);
    });
    await Promise.all([...urls].map((url) => {
      const im = new Image();
      im.src = url;
      return im.decode().catch(() => {});
    }));
    return urls.size;
  };
  const decodeImgs = async () => {
    const imgs = [...document.querySelectorAll('.EmojiPickerReact button.epr-emoji img')]
      .filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      });
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    return imgs.length;
  };
  // даём ленивой отрисовке раскрыться: 10 кадров после монтирования
  await new Promise((resolve) => {
    let frames = 0;
    const step = () => {
      frames += 1;
      if (frames >= 10) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const sheets = await decodeSheets();
  const imgs = await decodeImgs();
  const dock = document.querySelector('[data-testid="chat-emoji-dock"]');
  const dockRect = dock ? dock.getBoundingClientRect().toJSON() : null;
  const cells = {};
  us.forEach((u) => {
    const btn = [...document.querySelectorAll(`.EmojiPickerReact button.epr-emoji[data-unified="${u}"]`)]
      .find((b) => b.getBoundingClientRect().width > 0);
    if (btn) {
      cells[u] = btn.getBoundingClientRect().toJSON();
      const style = window.getComputedStyle(btn);
      cells[u].bgPos = style.backgroundPosition;
      cells[u].hasSheet = (style.backgroundImage || '').includes('sheet-');
    }
  });
  return { sheets, imgs, dockRect, cells, scrollX: window.scrollX, scrollY: window.scrollY };
}, { unifieds });

function diffPngs(bufA, bufB) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    return { error: `size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const n = a.width * a.height;
  let sum = 0;
  let strong = 0;
  let medium = 0;
  const rowStrong = new Array(a.height).fill(0);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const d = Math.max(
      Math.abs(a.data[o] - b.data[o]),
      Math.abs(a.data[o + 1] - b.data[o + 1]),
      Math.abs(a.data[o + 2] - b.data[o + 2]),
    );
    sum += d;
    const row = Math.floor(i / a.width);
    if (d > 16) medium += 1;
    if (d > 48) { strong += 1; rowStrong[row] += 1; }
  }
  return {
    width: a.width,
    height: a.height,
    meanAbsDiff: Math.round((sum / n) * 1000) / 1000,
    pctMedium: Math.round((medium / n) * 10000) / 100,
    pctStrong: Math.round((strong / n) * 100000) / 1000,
    strong,
    rowStrong,
  };
}

function cropDiff(bufA, bufB, rect, scale) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  const x0 = Math.round(rect.x * scale);
  const y0 = Math.round(rect.y * scale);
  const w = Math.round(rect.width * scale);
  const h = Math.round(rect.height * scale);
  let sum = 0;
  let strong = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      const o = (y * a.width + x) * 4;
      const d = Math.max(
        Math.abs(a.data[o] - b.data[o]),
        Math.abs(a.data[o + 1] - b.data[o + 1]),
        Math.abs(a.data[o + 2] - b.data[o + 2]),
      );
      sum += d;
      if (d > 48) strong += 1;
      n += 1;
    }
  }
  return {
    meanAbsDiff: Math.round((sum / (n || 1)) * 1000) / 1000,
    pctStrong: Math.round((strong / (n || 1)) * 10000) / 100,
  };
}

// Magnified crop (nearest neighbor) для ручной проверки глазами.
function saveMagnified(buf, rect, scale, zoom, path) {
  const src = PNG.sync.read(buf);
  const x0 = Math.max(0, Math.round(rect.x * scale));
  const y0 = Math.max(0, Math.round(rect.y * scale));
  const w = Math.min(src.width - x0, Math.round(rect.width * scale));
  const h = Math.min(src.height - y0, Math.round(rect.height * scale));
  const out = new PNG({ width: w * zoom, height: h * zoom });
  for (let y = 0; y < h * zoom; y += 1) {
    for (let x = 0; x < w * zoom; x += 1) {
      const sx = x0 + Math.floor(x / zoom);
      const sy = y0 + Math.floor(y / zoom);
      const so = (sy * src.width + sx) * 4;
      const oo = (y * out.width + x) * 4;
      for (let c = 0; c < 4; c += 1) out.data[oo + c] = src.data[so + c];
    }
  }
  writeFileSync(path, PNG.sync.write(out));
}

async function captureMode(browser, { spriteOff, dpr }) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: dpr,
  });
  const page = await ctx.newPage();
  if (spriteOff) {
    await page.addInitScript(() => { window.__HUBIT_EMOJI_SPRITE_OFF__ = true; });
  }
  await apiLogin(page);
  await openChat(page);
  await page.getByTestId('chat-composer-emoji-button').click();
  await expect(
    page.getByTestId('chat-emoji-dock').locator('.EmojiPickerReact button.epr-emoji').first(),
  ).toBeVisible({ timeout: 20_000 });
  return { ctx, page };
}

test.describe.configure({ mode: 'serial' });

// Скролл сетки до конкретного unified. Picker виртуализирует категории:
// кнопка не существует в DOM, пока её категория не приблизилась к вьюпорту,
// поэтому скроллим контейнер шагами, заставляя категории монтироваться,
// затем центрируем цель (scrollIntoView block:'center' детерминирован
// при одинаковом layout в обоих режимах).
const scrollEmojiIntoView = (page, unified) => page.evaluate(async (u) => {
  const scroller = document.querySelector('.EmojiPickerReact .epr-body');
  const sel = `.EmojiPickerReact button.epr-emoji[data-unified="${u}"]`;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Пolling на каждой позиции: scroll → React state → re-render занимает
  // несколько кадров; одиночный кадр недостаточен, и шаг вниз может
  // безвозвратно уйти мимо цели, которая ещё не успела смонтироваться.
  const pollBtn = async (frames) => {
    for (let i = 0; i < frames; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await frame();
      const found = document.querySelector(sel);
      if (found) return found;
    }
    return null;
  };
  let btn = document.querySelector(sel) || await pollBtn(4);
  if (!btn && scroller) {
    scroller.scrollTop = 0;
    btn = await pollBtn(8);
    for (let i = 0; i < 90 && !btn; i += 1) {
      scroller.scrollTop += 400;
      // eslint-disable-next-line no-await-in-loop
      btn = await pollBtn(3);
    }
  }
  if (btn) {
    btn.scrollIntoView({ block: 'center' });
    await pollBtn(4);
  }
  return Boolean(btn);
}, unified);

test('pixel parity sprite vs plain + stroke scan', async ({ browser }) => {
  test.setTimeout(420_000);
  mkdirSync(OUT, { recursive: true });
  const samples = pickSamples();
  const report = { samples: { top: samples.top, deep: samples.deep }, dpr2: {}, dpr1: {} };

  const comparePass = (spriteBuf, plainBuf, spriteInfo, plainInfo, group, dpr) => {
    const cells = {};
    group.forEach((u) => {
      const sr = spriteInfo.cells[u];
      const pr = plainInfo.cells[u];
      if (!sr || !pr) {
        cells[u] = { error: 'missing in one mode', sprite: Boolean(sr), plain: Boolean(pr) };
        return;
      }
      const posDelta = Math.max(
        Math.abs(sr.x - pr.x), Math.abs(sr.y - pr.y),
        Math.abs(sr.width - pr.width), Math.abs(sr.height - pr.height),
      );
      const d = cropDiff(spriteBuf, plainBuf, sr, dpr);
      cells[u] = {
        posDeltaCssPx: Math.round(posDelta * 100) / 100,
        meanAbsDiff: d.meanAbsDiff,
        pctStrong: d.pctStrong,
        spriteHasSheetBg: Boolean(sr.hasSheet),
        plainHasSheetBg: Boolean(pr.hasSheet),
        bgPosSprite: sr.bgPos,
      };
    });
    return cells;
  };

  for (const dpr of [2, 1]) {
    const key = dpr === 2 ? 'dpr2' : 'dpr1';
    const sprite = await captureMode(browser, { spriteOff: false, dpr });
    const spriteInfo = await settleAndCollect(sprite.page, samples.top);
    await sprite.page.waitForTimeout(500);
    const spriteBuf = await sprite.page.screenshot();
    writeFileSync(`${OUT}/panel-sprite-dpr${dpr}.png`, spriteBuf);

    const plain = await captureMode(browser, { spriteOff: true, dpr });
    const plainInfo = await settleAndCollect(plain.page, samples.top);
    await plain.page.waitForTimeout(500);
    const plainBuf = await plain.page.screenshot();
    writeFileSync(`${OUT}/panel-plain-dpr${dpr}.png`, plainBuf);

    // Контроль состояния: режимы действительно разные и сетка совпадает позиционно
    report[key].spriteSheetsDecoded = spriteInfo.sheets;
    report[key].plainSheetsDecoded = plainInfo.sheets;
    report[key].visibleImgs = { sprite: spriteInfo.imgs, plain: plainInfo.imgs };

    const full = diffPngs(spriteBuf, plainBuf);
    report[key].panel = {
      meanAbsDiff: full.meanAbsDiff,
      pctMedium: full.pctMedium,
      pctStrong: full.pctStrong,
      width: full.width,
      height: full.height,
      error: full.error,
    };

    // Рядовой анализ штрихов: строки с аномальной концентрацией сильных diff
    if (!full.error) {
      const rows = full.rowStrong
        .map((count, row) => ({ row, count }))
        .filter((r) => r.count > full.width * 0.02)
        .slice(0, 30);
      report[key].anomalousRows = rows;
    }

    // Позиционный паритет ячеек верхнего экрана
    report[key].cells = comparePass(spriteBuf, plainBuf, spriteInfo, plainInfo, samples.top, dpr);

    // ── Глубокий проход: каждый образец центрируем по очереди (виртуализация
    // picker'а не даёт захватить разнесённые категории одним скриншотом).
    // Скролл детерминирован одинаковым layout'ом — posDelta контролируется.
    report[key].deepCells = {};
    report[key].deepSheetsDecoded = { sprite: 0, plain: 0 };
    for (const u of samples.deep) {
      const foundS = await scrollEmojiIntoView(sprite.page, u);
      const foundP = await scrollEmojiIntoView(plain.page, u);
      if (!foundS || !foundP) {
        report[key].deepCells[u] = { error: 'not renderable (virtualization?)', sprite: foundS, plain: foundP };
        // eslint-disable-next-line no-continue
        continue;
      }
      const spriteDeep = await settleAndCollect(sprite.page, [u]);
      const plainDeep = await settleAndCollect(plain.page, [u]);
      await sprite.page.waitForTimeout(250);
      await plain.page.waitForTimeout(250);
      const spriteDeepBuf = await sprite.page.screenshot();
      const plainDeepBuf = await plain.page.screenshot();
      if (u === samples.deep[samples.deep.length - 1]) {
        writeFileSync(`${OUT}/panel-sprite-deep-dpr${dpr}.png`, spriteDeepBuf);
        writeFileSync(`${OUT}/panel-plain-deep-dpr${dpr}.png`, plainDeepBuf);
      }
      Object.assign(
        report[key].deepCells,
        comparePass(spriteDeepBuf, plainDeepBuf, spriteDeep, plainDeep, [u], dpr),
      );
      report[key].deepSheetsDecoded.sprite = Math.max(report[key].deepSheetsDecoded.sprite, spriteDeep.sheets);
      report[key].deepSheetsDecoded.plain = Math.max(report[key].deepSheetsDecoded.plain, plainDeep.sheets);
    }

    // Magnified crops для глаз: первый ряд сетки (включая зазоры) в обоих режимах
    const first = spriteInfo.cells[samples.top[0]];
    if (first) {
      const strip = {
        x: first.x - 4,
        y: first.y - 6,
        width: first.width * 6 + 12,
        height: first.height * 2 + 16,
      };
      saveMagnified(spriteBuf, strip, dpr, 4, `${OUT}/strip-sprite-dpr${dpr}-x4.png`);
      saveMagnified(plainBuf, strip, dpr, 4, `${OUT}/strip-plain-dpr${dpr}-x4.png`);
    }

    // Hover-контроль двухслойного фона (только dpr1): подсветка кнопки обязана
    // покрывать ВСЮ кнопку (padding-box), а не схлопываться в content-box клипом
    // листа. Замеряем цвет padding-кольца наведённой кнопки против ненаведённой.
    if (dpr === 1 && first) {
      // возвращаемся наверх и hover точно той ячейки, чей rect замерен
      await scrollEmojiIntoView(sprite.page, samples.top[0]);
      await sprite.page.waitForTimeout(300);
      const cur = await settleAndCollect(sprite.page, [samples.top[0]]);
      const rect = cur.cells[samples.top[0]];
      if (!rect) {
        report[key].hover = { error: 'top sample not remounted after deep scroll' };
      } else {
      await sprite.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await sprite.page.waitForTimeout(350); // transition background-color 0.2s
      const hoverBuf = await sprite.page.screenshot();
      writeFileSync(`${OUT}/hover-sprite-dpr1.png`, hoverBuf);
      const preHoverBuf = await (async () => {
        await sprite.page.mouse.move(5, 5);
        await sprite.page.waitForTimeout(350);
        return sprite.page.screenshot();
      })();
      const hoverProbe = (buf, r) => {
        const png = PNG.sync.read(buf);
        const at = (x, y) => {
          const o = (Math.round(y) * png.width + Math.round(x)) * 4;
          return [png.data[o], png.data[o + 1], png.data[o + 2]];
        };
        // центр padding-кольца слева (x+2) и угол кнопки — внутри padding-box,
        // но ВНЕ content-box: если клип листа схлопнет подсветку, они не изменятся
        return {
          ring: at(r.x + 2, r.y + r.height / 2),
          corner: at(r.x + 1, r.y + 1),
        };
      };
      report[key].hover = {
        unhovered: hoverProbe(preHoverBuf, rect),
        hovered: hoverProbe(hoverBuf, rect),
      };
      saveMagnified(hoverBuf, {
        x: rect.x - 4, y: rect.y - 4, width: rect.width + 8, height: rect.height + 8,
      }, 1, 6, `${OUT}/hover-sprite-x6.png`);
      }
    }

    await sprite.ctx.close();
    await plain.ctx.close();
    // инкрементальная запись: даже при падении hover/asser'тов данные не теряются
    writeFileSync(`${OUT}/pixeldiff-report.json`, JSON.stringify(report, null, 2));
  }

  writeFileSync(`${OUT}/pixeldiff-report.json`, JSON.stringify(report, null, 2));
  console.log('pixeldiff report:', JSON.stringify(report, null, 1));

  // Контрольные утверждения паритета (уровень шума антиалиасинга — из итерации 1):
  const dpr2 = report.dpr2;
  expect(dpr2.spriteSheetsDecoded, 'листы реально декодированы в sprite-режиме').toBeGreaterThan(0);
  expect(dpr2.plainSheetsDecoded, 'plain-режим без листов (seam работает)').toBe(0);
  expect(dpr2.panel.error).toBeUndefined();
  [...Object.entries(dpr2.cells), ...Object.entries(dpr2.deepCells)].forEach(([u, cell]) => {
    expect(cell.error, `cell ${u} present in both modes`).toBeUndefined();
    expect(cell.posDeltaCssPx, `cell ${u} layout position identical`).toBe(0);
    expect(cell.spriteHasSheetBg, `cell ${u} sprite mode carries sheet bg`).toBe(true);
    expect(cell.plainHasSheetBg, `cell ${u} plain mode has no sheet bg`).toBe(false);
    expect(cell.meanAbsDiff, `cell ${u} pixel parity mean|diff|`).toBeLessThan(5);
    expect(cell.pctStrong, `cell ${u} strong pixel diff pct`).toBeLessThan(2);
  });
  // hover: padding-кольцо и угол кнопки обязаны менять цвет (подсветка на всю кнопку)
  const hv = report.dpr1.hover;
  expect(hv, 'hover probe captured').toBeTruthy();
  expect(hv.error, 'hover probe remounted').toBeUndefined();
  const changed = hv.hovered.ring.some((v, i) => Math.abs(v - hv.unhovered.ring[i]) > 6)
    || hv.hovered.corner.some((v, i) => Math.abs(v - hv.unhovered.corner[i]) > 6);
  expect(changed, 'hover tint covers full button incl. padding ring').toBe(true);
});
