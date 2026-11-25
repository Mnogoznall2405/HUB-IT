import { test, expect, request } from '@playwright/test';
import { createHmac } from 'node:crypto';

// Extended FE-0083 multi-tab regression on the dedicated 2FA stack.
// Real backend, real cookie jar, real navigator.locks/localStorage unless a
// test deliberately removes them. Single-flight invariant: one rotation per
// 401 wave, zero extra rotations, consistent session state across tabs.

const MT_SWEEP = { user: 'e2e_mt', pass: 'e2e-local-mt-pass' };
const MT_NOLOCKS = { user: 'e2e_mt2', pass: 'e2e-local-mt2-pass' };
const MT_NOSTORAGE = { user: 'e2e_mt3', pass: 'e2e-local-mt3-pass' };
const MT_CLOSE = { user: 'e2e_mt4', pass: 'e2e-local-mt4-pass' };
const MT_LIFE_A = { user: 'e2e_mt5', pass: 'e2e-local-mt5-pass' };
const MT_LIFE_B = { user: 'e2e_mt6', pass: 'e2e-local-mt6-pass' };
const BACKEND = 'http://127.0.0.1:18002';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Decode = (input) => {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

const totp = (secret, offsetSteps = 0) => {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30000) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1000000).padStart(6, '0');
};

const fillCredentials = async (page, { user, pass }) => {
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(user);
  await form.locator('input[name="password"]').fill(pass);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
};

const dismissRememberDevicePrompt = async (page) => {
  const dialog = page.getByTestId('login-remember-device-dialog');
  try {
    await dialog.waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    return;
  }
  const skip = dialog.getByRole('button', { name: 'Не сейчас' });
  const cont = dialog.getByRole('button', { name: 'Продолжить' });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  } else if (await cont.isVisible().catch(() => false)) {
    await cont.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
};

const waitAuthed = async (page) => {
  await dismissRememberDevicePrompt(page);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
};

const submitTotpVerify = async (page, secret) => {
  const input = page.locator('#login-totp-verify');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(totp(secret));
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
};

// Enrollment is sticky on the seeded backend — memoize per spec run.
const enrollCache = new Map();
const enrollTotpViaApi = async ({ user, pass }) => {
  const cached = enrollCache.get(user);
  if (cached) return cached;
  const api = await request.newContext({ baseURL: BACKEND });
  const login = await api.post('/api/v1/auth/login', { data: { username: user, password: pass } });
  const loginBody = await login.json();
  if (loginBody.status !== '2fa_setup_required') {
    throw new Error(`expected 2fa_setup_required for ${user}, got ${loginBody.status}`);
  }
  const challengeId = loginBody.login_challenge_id;
  const setup = await api.post('/api/v1/auth/enable-2fa', { data: { login_challenge_id: challengeId } });
  const setupBody = await setup.json();
  const secret = setupBody.manual_entry_key;
  const verify = await api.post('/api/v1/auth/verify-2fa', {
    data: { login_challenge_id: challengeId, totp_code: totp(secret) },
  });
  const verifyBody = await verify.json();
  if (verifyBody.status !== 'authenticated') {
    throw new Error(`verify-2fa did not authenticate ${user}: ${JSON.stringify(verifyBody).slice(0, 300)}`);
  }
  await api.dispose();
  const result = { secret, backupCodes: verifyBody.backup_codes || [] };
  enrollCache.set(user, result);
  return result;
};

const loginWithTotp = async (page, { user, pass }, secret) => {
  await page.goto('/login');
  await fillCredentials(page, { user, pass });
  await submitTotpVerify(page, secret);
  await waitAuthed(page);
};

const SIDEBAR = 'chat-sidebar-list-scroll';

// В chat-shell account-футер живёт в overlay-drawer за ☰ «Открыть главное
// меню»; на страницах с постоянным рельсом кнопка видна сразу.
const logoutViaUi = async (page) => {
  const accountBtn = page.locator('[data-testid^="main-layout-account-button-"]:visible');
  if ((await accountBtn.count()) === 0) {
    await page.locator('[aria-label="Открыть главное меню"]:visible').first().click();
  }
  await accountBtn.first().click();
  await page.getByRole('menuitem', { name: 'Выход' }).click();
};

const clearRefreshMarkers = (page) => page.evaluate(() => {
  window.localStorage.removeItem('hubit.auth.refresh_epoch');
  window.localStorage.removeItem('hubit.auth.refresh_claim');
});

// Первая GET-выдача conversations после reload → 401 → refresh-цепочка.
const armConversation401 = async (page) => {
  let fired = false;
  await page.route('**/api/v1/chat/conversations**', async (route) => {
    if (fired || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    fired = true;
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' });
  });
};

const openChatTab = async (context) => {
  const p = await context.newPage();
  await p.goto('/chat');
  await p.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });
  return p;
};

// Одна волна 401 во всех вкладках; возвращает счётчик реальных POST /auth/refresh.
const countRefreshPosts = async (context) => {
  const counter = { n: 0 };
  await context.route('**/api/v1/auth/refresh', async (route) => {
    counter.n += 1;
    await route.continue();
  });
  return counter;
};

const singleFlightWave = async (context, pages) => {
  const counter = await countRefreshPosts(context);
  // Login-эпоха (<10s) — shared на context — иначе вкладки легитимно пропустят
  // refresh и счётчик будет 0.
  await clearRefreshMarkers(pages[0]);
  await pages[0].waitForTimeout(300);
  for (const p of pages) await armConversation401(p);
  await Promise.all(pages.map((p) => p.reload()));
  for (const p of pages) {
    await p.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });
  }
  // Абсорб-полл до ~400ms — дожидаемся самого POST, а не тика.
  await expect.poll(() => counter.n, { timeout: 15_000 }).toBe(1);
  // Окно для регрессии dedup — дубли прилетели бы за ~1s.
  await pages[0].waitForTimeout(1500);
  expect(counter.n).toBe(1);
  await context.unroute('**/api/v1/auth/refresh');
  for (const p of pages) await p.unroute('**/api/v1/chat/conversations**');
  return counter.n;
};

test('FE-0083: sweep вкладок 2/3/5/10 — ровно одна ротация на волну 401', async ({ context }) => {
  test.setTimeout(300_000);
  const { secret } = await enrollTotpViaApi(MT_SWEEP);
  const page0 = await context.newPage();
  await loginWithTotp(page0, MT_SWEEP, secret);
  await page0.goto('/chat');
  await page0.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });

  const tabs = [page0];
  for (const n of [2, 3, 5, 10]) {
    while (tabs.length < n) tabs.push(await openChatTab(context));
    while (tabs.length > n) await tabs.pop().close();
    await singleFlightWave(context, tabs);
    for (const p of tabs) {
      expect(await p.evaluate(() => window.localStorage.getItem('user') !== null)).toBe(true);
    }
  }
});

test('FE-0083: navigator.locks недоступен (HTTP-интранет) — claim-путь держит single-flight', async ({ context }) => {
  test.setTimeout(180_000);
  // Plain-HTTP intranet deploys: Web Locks is secure-context only.
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true });
  });
  const { secret } = await enrollTotpViaApi(MT_NOLOCKS);
  const page0 = await context.newPage();
  await loginWithTotp(page0, MT_NOLOCKS, secret);
  await page0.goto('/chat');
  await page0.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });
  const pages = [page0, await openChatTab(context), await openChatTab(context)];
  const locked = await page0.evaluate(() => typeof navigator.locks?.request === 'function');
  expect(locked).toBe(false);
  await singleFlightWave(context, pages);
});

test('FE-0083: localStorage недоступен — деградация координации зафиксирована', async ({ context }) => {
  test.setTimeout(180_000);
  const { secret } = await enrollTotpViaApi(MT_NOSTORAGE);
  const page0 = await context.newPage();
  // Логин живой: storage умирает ТОЛЬКО для последующих навигаций — init-script
  // добавляется после входа и применяется на reload/новых страницах.
  await loginWithTotp(page0, MT_NOSTORAGE, secret);
  await page0.goto('/chat');
  await page0.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });

  await context.addInitScript(() => {
    for (const fn of ['getItem', 'setItem', 'removeItem']) {
      Storage.prototype[fn] = () => { throw new DOMException('denied', 'SecurityError'); };
    }
  });
  // Новые вкладки на мёртвом storage не дорендериваются (boot висит) — само по
  // себе наблюдение. Координацию гоняем напрямую через authAPI: модуль
  // импортируется на любой странице origin, UI не нужен.
  const pages = [page0];
  for (let i = 0; i < 2; i += 1) {
    const p = await context.newPage();
    await p.goto('/about');
    pages.push(p);
  }
  const bootState = await Promise.all(pages.map(async (p) => ({
    url: p.url(),
    hasSidebar: await p.getByTestId(SIDEBAR).isVisible().catch(() => false),
  })));
  console.log('[MT] dead-storage boot state:', JSON.stringify(bootState));

  let refreshPosts = 0;
  await context.route('**/api/v1/auth/refresh', async (route) => {
    refreshPosts += 1;
    await route.continue();
  });
  const refreshResults = await Promise.all(pages.map((p) => p.evaluate(async () => {
    let dead = false;
    try {
      window.localStorage.getItem('probe');
    } catch {
      dead = true;
    }
    try {
      const { authAPI } = await import('/src/api/auth.js');
      const data = await authAPI.refresh();
      return `${dead ? 'dead' : 'LIVE'}:${data?.skipped ? 'skipped' : 'posted'}`;
    } catch (e) {
      return `${dead ? 'dead' : 'LIVE'}:err:${e?.response?.status || e?.code || e?.message || 'unknown'}`;
    }
  })));
  await page0.waitForTimeout(1000);

  // Зафиксированная деградация: вкладки с мёртвым storage не могут ни
  // прочитать, ни записать epoch/claim → dedup невозможен, каждая шлёт свой
  // POST. Вкладка с живым storage (page0) dedup-ится как обычно — может
  // честно пропустить POST, поэтому счётчик ∈ [deadCount, pages.length].
  // navigator.locks сериализует POST → cookie обновляется между запросами →
  // серийные ротации, сессии живы, split-brain отсутствует.
  console.log(`[MT] dead-storage: posts=${refreshPosts}, results=${JSON.stringify(refreshResults)}`);
  expect(refreshResults.slice(1).every((r) => r === 'dead:posted')).toBe(true);
  expect(refreshResults[0].startsWith('LIVE:')).toBe(true);
  expect(refreshResults[0]).not.toContain('err');
  const deadCount = refreshResults.filter((r) => r.startsWith('dead:')).length;
  expect(refreshPosts).toBeGreaterThanOrEqual(deadCount);
  expect(refreshPosts).toBeLessThanOrEqual(pages.length);
  const meStates = await Promise.all(pages.map((p) => p.evaluate(async () =>
    (await fetch('/api/v1/auth/me', { credentials: 'include' })).status)));
  console.log('[MT] dead-storage /auth/me:', JSON.stringify(meStates));
  expect(meStates.every((s) => s === 200)).toBe(true);
});

test('FE-0083: закрытие вкладки mid-refresh + logout через UI во всех вкладках', async ({ context }) => {
  test.setTimeout(180_000);
  const { secret } = await enrollTotpViaApi(MT_CLOSE);
  const page0 = await context.newPage();
  await loginWithTotp(page0, MT_CLOSE, secret);
  await page0.goto('/chat');
  await page0.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });
  const pages = [page0, await openChatTab(context), await openChatTab(context)];

  // Закрываем третью вкладку в момент волны — locks освобождаются, дедуп жив.
  const counter = await countRefreshPosts(context);
  await clearRefreshMarkers(page0);
  await page0.waitForTimeout(300);
  for (const p of pages) await armConversation401(p);
  const closing = pages[2];
  await Promise.all([pages[0].reload(), pages[1].reload(), closing.reload()]);
  await closing.close();
  for (const p of [pages[0], pages[1]]) {
    await p.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });
  }
  await expect.poll(() => counter.n, { timeout: 15_000 }).toBe(1);
  await page0.waitForTimeout(1500);
  expect(counter.n).toBe(1);
  await context.unroute('**/api/v1/auth/refresh');
  await pages[0].unroute('**/api/v1/chat/conversations**');
  await pages[1].unroute('**/api/v1/chat/conversations**');

  // Logout через реальный UI в одной вкладке → остальные вкладки сами уходят
  // в разлогиненное состояние (storage event → invalidateSession → /login).
  await logoutViaUi(page0);
  await expect(page0).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(pages[1]).toHaveURL(/\/login/, { timeout: 30_000 });
  // Фактическое состояние UI, а не только shared localStorage.user:
  await expect(pages[1].getByTestId('password-auth-form')).toBeVisible({ timeout: 30_000 });
  await expect(page0.getByTestId('password-auth-form')).toBeVisible({ timeout: 30_000 });
  const sharedUser = await page0.evaluate(() => window.localStorage.getItem('user'));
  expect(sharedUser).toBeNull();
});

test('FE-0083: смена пользователя, stale epoch/claim, offline→reconnect', async ({ context }) => {
  test.setTimeout(240_000);
  const { secret } = await enrollTotpViaApi(MT_LIFE_A);
  const { secret: secret2 } = await enrollTotpViaApi(MT_LIFE_B);
  const page0 = await context.newPage();
  await loginWithTotp(page0, MT_LIFE_A, secret);
  await page0.goto('/chat');
  await page0.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });
  const page1 = await openChatTab(context);

  // Stale epoch/claim (60s назад) — координатор обязан их игнорировать.
  await page0.evaluate(() => {
    const stale = Date.now() - 60_000;
    window.localStorage.setItem('hubit.auth.refresh_epoch', String(stale));
    window.localStorage.setItem('hubit.auth.refresh_claim', String(stale));
  });
  const counter = await countRefreshPosts(context);
  for (const p of [page0, page1]) await armConversation401(p);
  await Promise.all([page0.reload(), page1.reload()]);
  for (const p of [page0, page1]) {
    await p.getByTestId(SIDEBAR).waitFor({ state: 'visible', timeout: 30_000 });
  }
  await expect.poll(() => counter.n, { timeout: 15_000 }).toBe(1);
  await page0.waitForTimeout(1500);
  expect(counter.n).toBe(1);
  await context.unroute('**/api/v1/auth/refresh');

  // Offline → refresh — transport-ошибка, logout не происходит.
  // Маркеры чистим: свежая эпоха от предыдущей волны пропустила бы POST
  // до сети и refresh «решился» без запроса — не то, что проверяем.
  await context.setOffline(true);
  await clearRefreshMarkers(page0);
  const offlineResult = await page0.evaluate(async () => {
    try {
      const { authAPI } = await import('/src/api/auth.js');
      await authAPI.refresh();
      return 'resolved';
    } catch (e) {
      return `rejected:${e?.code || e?.message || 'unknown'}`;
    }
  });
  expect(offlineResult).toContain('rejected');
  expect(page0.url()).not.toContain('/login');
  expect(await page0.evaluate(() => window.localStorage.getItem('user') !== null)).toBe(true);

  // Reconnect — эпоха future-marked после двойной потери, чистим и обновляем.
  await context.setOffline(false);
  await clearRefreshMarkers(page0);
  const backOnline = await page0.evaluate(async () => {
    const { authAPI } = await import('/src/api/auth.js');
    await authAPI.refresh();
    return 'ok';
  });
  expect(backOnline).toBe('ok');

  // Смена пользователя: logout → login под вторым пользователем в одной
  // вкладке → соседняя вкладка сама уходит на /login, затем видит новую сессию.
  for (const p of [page0, page1]) await p.unroute('**/api/v1/chat/conversations**');
  await logoutViaUi(page0);
  await expect(page0).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page1).toHaveURL(/\/login/, { timeout: 30_000 });

  await loginWithTotp(page0, MT_LIFE_B, secret2);
  // page1 на /login: storage event (user: A→B) → verifySharedLogin → сессия
  // второго пользователя поднимается без повторного ввода.
  await page1.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  const seenUser = await page1.evaluate(() => window.localStorage.getItem('user'));
  expect(seenUser).toContain(MT_LIFE_B.user);
});
