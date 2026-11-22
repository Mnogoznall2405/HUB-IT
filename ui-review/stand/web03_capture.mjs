// WEB-03: right panel modes — web side.
// DM "E2E Пользователь", panel open at 1440 (persistent) + 1280 (overlay).
import { createStand } from './web_driver.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots/after/web-parity/WEB-03');

for (const [w, h] of [[1440, 800], [1280, 720], [1024, 600]]) {
  const stand = await createStand({ width: w, height: h, scheme: 'dark', outDir: OUT });
  await stand.login();
  await stand.openChat('E2E Пользователь');
  await stand.openContextPanel();
  await stand.shot(`web-dark-${w}x${h}-panel-open.png`);
  const m = await stand.saveMeasure(`web-dark-${w}x${h}-panel-open.json`);
  console.log(`${w}x${h}:`, JSON.stringify({
    thread: m.thread?.w, overlay: m.rightOverlay?.w, persistent: m.rightPersistent?.w,
  }));
  await stand.close();
}
