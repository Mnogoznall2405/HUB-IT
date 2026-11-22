// WEB-07: composer modes on a narrow window — web side.
// DM "E2E Пользователь" at 1024x600 dark: empty, long draft, reply,
// edit, voice recording (fake mic), file selection preview.
import { createStand } from './web_driver.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots/after/web-parity/WEB-07');
const FIXTURE = path.join(OUT, '_fixture-upload.png');
// Small valid PNG so setInputFiles has a real file.
fs.writeFileSync(FIXTURE, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAATSURBVBhXY/iPA4YUMDIy4iABAJpCAh0xEovZAAAAAElFTkSuQmCC',
  'base64'));

const LONG_DRAFT = 'Проверка длинного черновика композера. '.repeat(14);

const stand = await createStand({
  width: 1024,
  height: 600,
  scheme: 'dark',
  outDir: OUT,
  extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const page = stand.page;
await stand.login();
await stand.openChat('E2E Пользователь');

// 1) empty composer
await stand.shot('web-dark-1024x600-composer-empty.png');
console.log('empty:', JSON.stringify(await stand.saveMeasure('web-dark-1024x600-composer-empty.json')));

// 2) long draft — textarea grows
const textarea = page.getByTestId('chat-composer-textarea');
await textarea.fill(LONG_DRAFT);
await page.waitForTimeout(400);
await stand.shot('web-dark-1024x600-composer-longdraft.png');
console.log('longdraft:', JSON.stringify(await stand.saveMeasure('web-dark-1024x600-composer-longdraft.json')));
await textarea.fill('');

// 3) reply — hover a bubble, click "Ответить"
const bubble = page.locator('[data-chat-bubble-surface="true"]').last();
await bubble.hover();
await page.waitForTimeout(300);
const replyBtn = bubble.locator('[aria-label="Ответить"]').first();
if (await replyBtn.isVisible().catch(() => false)) {
  await replyBtn.click();
} else {
  await bubble.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ответить' }).first().click();
}
await page.waitForTimeout(500);
await stand.shot('web-dark-1024x600-composer-reply.png');
await page.locator('[aria-label="Отменить ответ"]').first().click().catch(() => {});
await page.waitForTimeout(300);

// 4) edit — context menu on an own (right-aligned) message
const ownBubble = page.locator('[data-chat-bubble-surface="true"]').last();
await ownBubble.click({ button: 'right' });
await page.waitForTimeout(300);
const editItem = page.getByRole('menuitem', { name: 'Изменить' }).first();
if (await editItem.isVisible().catch(() => false)) {
  await editItem.click();
  await page.waitForTimeout(500);
  await stand.shot('web-dark-1024x600-composer-edit.png');
  await page.locator('[aria-label="Отменить редактирование"]').first().click().catch(() => {});
  await page.waitForTimeout(300);
} else {
  await page.keyboard.press('Escape');
  console.log('edit menu item not visible');
}

// 5) voice recording — fake media device
const voiceBtn = page.getByTestId('chat-composer-voice-button');
if (await voiceBtn.isVisible().catch(() => false)) {
  await voiceBtn.click();
  await page.waitForTimeout(1500);
  await stand.shot('web-dark-1024x600-composer-voice.png');
  const cancel = page.getByTestId('chat-composer-cancel-voice-button');
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
  await page.waitForTimeout(300);
}

// 6) file selection preview — hidden media input
const mediaInput = page.getByTestId('chat-media-file-input');
await mediaInput.setInputFiles(FIXTURE);
await page.waitForTimeout(800);
await stand.shot('web-dark-1024x600-composer-files.png');
console.log('files:', JSON.stringify(await stand.saveMeasure('web-dark-1024x600-composer-files.json')));

await stand.close();
console.log('WEB-07 web captures done');
