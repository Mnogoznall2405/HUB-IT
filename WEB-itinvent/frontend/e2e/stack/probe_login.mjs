// Reproduce the harness login path exactly: init script + loginPage flow.
import { chromium } from 'playwright';

const INIT_SCRIPT = `
  window.__perf = { commits: 0, commitLog: [], longtasks: [], api: [], marks: {}, muts: [], mark(name) {
    this.marks[name] = performance.now(); this.muts = [];
  }, probe(name) {
    const t = this.marks[name] || 0;
    return { mark: t, first: this.muts.length ? this.muts[0].t - t : 0,
      last: this.muts.length ? this.muts[this.muts.length - 1].t - t : 0,
      mutations: this.muts.length };
  } };
  const hook = { checkDCE() {}, supportsFiber: true, inject: () => 1,
    onCommitFiberRoot() { window.__perf.commits += 1; window.__perf.commitLog.push(performance.now()); },
    onCommitFiberUnmount() {}, onScheduleFiberRoot() {} };
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook });
  new PerformanceObserver((list) => list.getEntries()
    .forEach((e) => window.__perf.longtasks.push(e.duration)))
    .observe({ entryTypes: ['longtask'] });
  new MutationObserver((list) => {
    const t = performance.now();
    window.__perf.muts.push({ t, n: list.length });
  }).observe(document.documentElement || document, {
    childList: true, subtree: true, attributes: true,
  });
`;

const base = 'http://localhost:5183';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript(INIT_SCRIPT);
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 200)));
await page.goto(`${base}/login`);
const form = page.getByTestId('password-auth-form');
const t0 = Date.now();
const formVisible = await form.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
console.log('form after 15s:', formVisible, Date.now() - t0, 'ms');
if (!formVisible) {
  const ids = await page.locator('[data-testid]').evaluateAll((els) => els.map((e) => e.dataset.testid).slice(0, 30));
  console.log('testids:', JSON.stringify(ids));
  console.log('url:', page.url());
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('body:', bodyText.slice(0, 300));
}
await browser.close();
