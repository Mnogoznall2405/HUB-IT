// WEB-01: baseline layout capture — web side.
// Direct chat "E2E Пользователь", right panel closed/open, dark+light, 1280×720 and 1024×600.
import { createStand } from './web_driver.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots/after/web-parity/WEB-01');

for (const scheme of ['dark', 'light']) {
  for (const [w, h] of [[1280, 720], [1024, 600]]) {
    const stand = await createStand({ width: w, height: h, scheme, outDir: OUT });
    await stand.login();
    await stand.openChat('E2E Пользователь');
    await stand.shot(`web-${scheme}-${w}x${h}-panel-closed.png`);
    const closed = await stand.saveMeasure(`web-${scheme}-${w}x${h}-panel-closed.json`);
    await stand.openContextPanel();
    await stand.shot(`web-${scheme}-${w}x${h}-panel-open.png`);
    const open = await stand.saveMeasure(`web-${scheme}-${w}x${h}-panel-open.json`);
    console.log(`${scheme} ${w}x${h}:`, JSON.stringify({
      closed: { sidebar: closed.sidebar?.w, thread: closed.thread?.w, composerH: closed.composerDock?.h },
      open: { thread: open.thread?.w, overlay: open.rightOverlay?.w, persistent: open.rightPersistent?.w },
    }));
    await stand.close();
  }
}
