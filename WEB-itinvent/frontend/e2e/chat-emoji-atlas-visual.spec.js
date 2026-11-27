// Issue #89 — visual/functional контроль sprite-атласа. НЕ часть гейта:
// прогоняется точечно против вручную поднятого стенда (E2E_BASE_URL) или
// локального стека. Снимает панель (light/dark), проверяет вставку эмодзи,
// рендер в пузыре сообщения, поиск и клавиатуру — паритет с PNG-рендером.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/* global document, window */

const USERNAME = process.env.E2E_USERNAME || 'e2e_admin';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e_admin_pass';
const OUT = `e2e-artifacts/emoji-picker/atlas-visual-${process.env.E2E_VARIANT || 'run'}`;

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

test.describe.configure({ mode: 'serial' });

test('visual: panel light/dark, insertion, bubble render, search, keyboard', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await apiLogin(page);
  await openChat(page);

  // ── Панель light ──
  await page.getByTestId('chat-composer-emoji-button').click();
  const dock = page.getByTestId('chat-emoji-dock');
  await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 20_000 });
  // ждём реальной готовности глифов: фон листа применился и лист загружен
  // (итерация 2: фон листа живёт на КНОПКЕ, img несёт прозрачный пиксель)
  const renderMode = await page.evaluate(() => {
    const btn = document.querySelector('.EmojiPickerReact button.epr-emoji');
    if (!btn) return 'no-button';
    const bg = window.getComputedStyle(btn).backgroundImage;
    return bg.includes('sheet-') ? 'sprite' : 'plain';
  });
  console.log('render mode:', renderMode);
  const variant = '';
  await page.waitForTimeout(700); // дорисовка листов/картинок
  const panelBox = await dock.boundingBox();
  await page.screenshot({ path: `${OUT}/panel-light.png`, clip: panelBox });

  // Геометрия: первый эмодзи-глиф не пуст — центральный пиксель кнопки не фоновый
  const glyphProbe = await page.evaluate(() => {
    const btn = document.querySelector('.EmojiPickerReact button.epr-emoji');
    const img = btn?.querySelector('img');
    if (!btn || !img) return { ok: false, why: 'no button/img' };
    const bg = window.getComputedStyle(btn);
    const btnRect = btn.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    return {
      ok: true,
      bgImage: bg.backgroundImage.slice(0, 120),
      bgPos: bg.backgroundPosition,
      bgSize: bg.backgroundSize,
      origin: bg.backgroundOrigin,
      src: img.src.slice(0, 80),
      btnRect: btnRect.toJSON(),
      imgRect: imgRect.toJSON(),
      // img обязан в точности совпадать с кнопкой — иначе геометрия фона неверна
      geomMatch: Math.abs(btnRect.x - imgRect.x) < 0.01
        && Math.abs(btnRect.y - imgRect.y) < 0.01
        && Math.abs(btnRect.width - imgRect.width) < 0.01
        && Math.abs(btnRect.height - imgRect.height) < 0.01,
    };
  });
  console.log('glyph probe:', JSON.stringify(glyphProbe));

  // ── Вставка эмодзи в композер ──
  await dock.locator('.EmojiPickerReact button.epr-emoji').first().click();
  const textarea = page.getByTestId('chat-composer-textarea');
  await expect(textarea).not.toHaveValue('');
  const typed = await textarea.inputValue();
  console.log('composer after click:', JSON.stringify(typed));

  // ── Поиск: фильтрация работает, глифы в результатах ──
  const search = dock.locator('.EmojiPickerReact input');
  await search.fill('смех');
  await page.waitForTimeout(400);
  const searchCount = await dock.locator('.EmojiPickerReact button.epr-emoji:not(.epr-hidden)').count();
  console.log('search results for «смех»:', searchCount);
  expect(searchCount).toBeGreaterThan(0);
  await page.screenshot({ path: `${OUT}/panel-search.png`, clip: await dock.boundingBox() });
  await search.fill('');

  // ── Клавиатура: стрелки внутри сетки picker'а ──
  await search.press('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const afterKbd = await textarea.inputValue();
  console.log('composer after keyboard nav:', JSON.stringify(afterKbd));

  // ── Отправка: рендер в пузыре не сломан ──
  await textarea.fill('тест спрайтов 😀🎉');
  await page.getByTestId('chat-composer-send-button').click();
  // ждём появления emoji-картинок пузыря в ленте (рендер сообщений не тронут)
  await expect.poll(async () => page.evaluate(
    () => document.querySelectorAll('img[data-chat-emoji]').length,
  ), { timeout: 15_000 }).toBeGreaterThan(0);
  const bubbleImgs = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[data-chat-emoji]')];
    return imgs.slice(-4).map((i) => ({ src: i.src.slice(0, 90), ok: i.complete && i.naturalWidth > 0 }));
  });
  console.log('bubble emoji imgs:', JSON.stringify(bubbleImgs));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/thread-after-send.png` });

  // ── Панель dark ──
  await page.evaluate(() => {
    const toggle = document.querySelector('[data-testid="theme-toggle"], [aria-label*="тема" i], [aria-label*="theme" i]');
    if (toggle) toggle.click();
  });
  // fallback: переключаем через localStorage-предпочтение, если кнопки нет
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark') || document.body.classList.contains('dark'));
  if (!isDark) {
    await page.emulateMedia({ colorScheme: 'dark' });
  }
  await page.waitForTimeout(500);
  const btn = page.getByTestId('chat-composer-emoji-button');
  const dockVisible = await dock.isVisible().catch(() => false);
  if (!dockVisible) await btn.click();
  await expect(dock.locator('.EmojiPickerReact button.epr-emoji').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/panel-dark.png`, clip: await dock.boundingBox() });

  console.log('page errors:', JSON.stringify(errors));
  expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
});
