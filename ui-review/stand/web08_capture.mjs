// WEB-08: keyboard path — web side. Real Playwright keyboard.
// Chat at 1280x720 dark: Tab traversal, Ctrl+F search open/focus/Esc-close
// and focus return, draft preservation, Esc layering.
import { createStand } from './web_driver.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots/after/web-parity/WEB-08');
const LOG = path.join(OUT, 'web-keyboard-log.json');
const log = [];
const note = (step, data) => { log.push({ step, ...data }); console.log(step, JSON.stringify(data)); };
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName, testid: el.getAttribute('data-testid'), aria: el.getAttribute('aria-label'), cls: (el.className || '').toString().slice(0, 60) } : null;
});

const stand = await createStand({ width: 1280, height: 720, scheme: 'dark', outDir: OUT });
const page = stand.page;
await stand.login();
await stand.openChat('E2E Пользователь');
await page.waitForTimeout(500);

// --- Tab traversal: first 12 stops ---
const stops = [];
await page.keyboard.press('Tab');
for (let i = 0; i < 12; i++) {
  const f = await focused(page);
  stops.push(f);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
}
note('tab-stops', { stops });

// --- draft: type text, keep through layers ---
const textarea = page.getByTestId('chat-composer-textarea');
await textarea.click();
await page.keyboard.type('Черновик проверки клавиатуры');

// --- Ctrl+F opens search, focuses input ---
await page.keyboard.press('Control+f');
await page.waitForTimeout(600);
note('after-ctrlf', { focus: await focused(page) });
await stand.shot('web-dark-1280x720-search-open.png');

// --- Esc closes search, focus returns, draft intact ---
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const afterEsc = await focused(page);
const draft = await textarea.inputValue().catch(() => null);
note('after-esc', { focus: afterEsc, draft });
await stand.shot('web-dark-1280x720-after-esc.png');

// --- context panel via keyboard? check focus on info button then Enter ---
// (mouse path already covered; verify Esc on open panel)
await stand.openContextPanel();
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const m = await stand.measure();
note('after-panel-esc', { overlay: m.rightOverlay?.w ?? null, persistent: m.rightPersistent?.w ?? null });

fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
await stand.close();
console.log('WEB-08 web done');
