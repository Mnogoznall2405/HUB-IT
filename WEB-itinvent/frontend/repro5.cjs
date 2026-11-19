const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 760, height: 760 } });
  await page.goto('http://127.0.0.1:5221/e2e/fixtures/mail-body-repro-harness.html');
  await page.waitForSelector('iframe[data-mail-html-sandbox]');
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const f = document.querySelector('iframe[data-mail-html-sandbox]');
    const d = f.contentDocument;
    const els = [...d.querySelectorAll('div,table,a,h1,p')].slice(0, 30).map(n => ({
      tag: n.tagName, text: (n.innerText||'').slice(0,40), bg: getComputedStyle(n).backgroundColor,
      color: getComputedStyle(n).color, h: Math.round(n.getBoundingClientRect().height),
      disp: getComputedStyle(n).display, vis: getComputedStyle(n).visibility,
    })).filter(e => e.text || e.h > 0);
    return {
      el: Math.round(f.getBoundingClientRect().height), style: f.style.height,
      bodyScroll: d?.body?.scrollHeight, rootScroll: d?.documentElement?.scrollHeight,
      textLen: d?.body?.innerText?.length,
      debug: window.__debug, els: els.slice(0, 18),
    };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 6000));
  await page.screenshot({ path: process.env.TEMP + '/hubit-mail-repro.png', fullPage: true });
  await browser.close();
})();
