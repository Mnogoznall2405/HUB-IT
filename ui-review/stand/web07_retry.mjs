// WEB-07 retry: edit mode + voice recording diagnostics.
import { createStand } from './web_driver.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots/after/web-parity/WEB-07');

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

// --- edit: context menu on the known outgoing bubble ---
const ownText = page.getByText('Таблица открылась, данные свежие', { exact: false }).last();
await ownText.click({ button: 'right' });
await page.waitForTimeout(800);
const menuItems = await page.locator('[role="menuitem"]').allTextContents().catch(() => []);
console.log('menu items:', JSON.stringify(menuItems));
const editItem = page.getByRole('menuitem', { name: 'Изменить' }).first();
if (await editItem.isVisible().catch(() => false)) {
  await editItem.click();
  await page.waitForTimeout(600);
  await stand.shot('web-dark-1024x600-composer-edit.png');
  await page.locator('[aria-label="Отменить редактирование"]').first().click().catch(() => {});
  await page.waitForTimeout(400);
} else {
  console.log('edit item still not visible');
  await page.keyboard.press('Escape');
}

// --- voice: button state diagnostics ---
const voiceBtn = page.getByTestId('chat-composer-voice-button');
console.log('voice count:', await voiceBtn.count(),
  'visible:', await voiceBtn.first().isVisible().catch(() => false));
const sendBtn = page.getByTestId('chat-composer-send-button');
console.log('send count:', await sendBtn.count(),
  'visible:', await sendBtn.first().isVisible().catch(() => false));
if (await voiceBtn.first().isVisible().catch(() => false)) {
  await voiceBtn.first().click();
  await page.waitForTimeout(2000);
  await stand.shot('web-dark-1024x600-composer-voice.png');
  const cancel = page.getByTestId('chat-composer-cancel-voice-button');
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
  } else {
    await page.keyboard.press('Escape');
  }
}

await stand.close();
console.log('retry done');
