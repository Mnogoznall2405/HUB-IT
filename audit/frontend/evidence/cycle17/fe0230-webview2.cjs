const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5227';
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9229';
const SHOT = process.env.SHOT || 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17-fe0230.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith(BASE)) || ctx.pages()[0];
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 400)); });

  await ctx.addInitScript(() => {
    window.__auditHostReadyAt = null;
    window.__auditForced = false;
    const patch = () => {
      const wv = window.chrome && window.chrome.webview;
      if (!wv || wv.__auditPatched) return;
      const origPost = wv.postMessage.bind(wv);
      wv.postMessage = (msg) => {
        try {
          const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
          if (data && data.type === 'desktop.ready') {
            setTimeout(() => { try { origPost(msg); } catch (e) {} }, 8000);
            return;
          }
        } catch (e) {}
        return origPost(msg);
      };
      const origAdd = wv.addEventListener.bind(wv);
      wv.addEventListener = (type, listener, opts) => {
        if (type === 'message' && typeof listener === 'function') {
          const wrapped = (event) => {
            const before = document.documentElement.getAttribute('data-desktop-shell');
            listener(event);
            const after = document.documentElement.getAttribute('data-desktop-shell');
            if (!before && after === 'true') {
              window.__auditHostReadyAt = Date.now();
              if (!window.__auditForced) {
                window.__auditForced = true;
                const buttons = [...document.querySelectorAll('button')];
                const target = buttons.find((b) => b.innerText.includes('Обновить фоновую доставку'));
                window.__auditCardPresent = document.body.innerText.includes('Фоновая доставка чатов');
                if (target) {
                  window.__auditClicked = true;
                  target.click();
                }
              }
            }
          };
          return origAdd(type, wrapped, opts);
        }
        return origAdd(type, listener, opts);
      };
      wv.__auditPatched = true;
    };
    patch();
    const t = setInterval(patch, 5);
    setTimeout(() => clearInterval(t), 4000);
  });

  await page.goto(BASE + '/settings/notifications', { waitUntil: 'load' });
  await sleep(4000);
  const before = await page.evaluate(() => ({
    shell: document.documentElement.getAttribute('data-desktop-shell'),
    card: document.body.innerText.includes('Фоновая доставка чатов'),
    forced: window.__auditForced,
  }));
  console.log('BEFORE', JSON.stringify(before));

  let flipped = false;
  try {
    await page.waitForFunction(() => document.documentElement.getAttribute('data-desktop-shell') === 'true', { timeout: 15000 });
    flipped = true;
  } catch (e) {}
  await sleep(1500);
  let after = null;
  try {
    after = await page.evaluate(() => ({
      shell: document.documentElement.getAttribute('data-desktop-shell'),
      card: document.body.innerText.includes('Фоновая доставка чатов'),
      forced: window.__auditForced,
      cardPresentAtFlip: window.__auditCardPresent,
      clickedAtFlip: window.__auditClicked,
      hostReadyAt: window.__auditHostReadyAt,
      bodyStart: document.body.innerText.slice(0, 160),
    }));
  } catch (e) {
    after = { evaluateError: String(e.message || e).slice(0, 200) };
  }
  await page.screenshot({ path: SHOT }).catch(() => {});
  console.log('FLIPPED', flipped);
  console.log('AFTER', JSON.stringify(after));
  console.log('ERRORS', JSON.stringify(errors.slice(0, 10)));
  await browser.close();
})();
