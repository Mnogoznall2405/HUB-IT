import { test, expect, request } from '@playwright/test';
import { createHmac } from 'node:crypto';

// Remediation P0 browser checks on the dedicated 2FA stack (policy=all).
// Covers FE-0197/0198 (2FA + trusted-device post-auth flow) and
// FE-0059/0083 (multi-tab refresh rotation, lost-response grace, logout
// propagation). All data is synthetic — SQLite seed users only.

const ADMIN = { user: 'e2e_admin', pass: 'e2e-local-admin-pass' };
const FRESH = { user: 'e2e_fresh', pass: 'e2e-local-fresh-pass' };
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

// The remember-device dialog may appear right after login. WebAuthn is not
// available headless, so the prompt is either dismissible ('Не сейчас') or
// reported as unsupported ('Продолжить'). Either way it must be closed.
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
  // Fresh users land on the /about onboarding page (marketing shell), others on
  // the app shell — both mean authenticated. The shared marker is: off /login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
};

const submitTotpVerify = async (page, secret) => {
  const input = page.locator('#login-totp-verify');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  // Desktop viewport: no auto-submit — press 'Подтвердить вход'.
  await input.fill(totp(secret));
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
};

// Enroll a seed user for TOTP purely through the API so browser specs can log
// in with a code. Returns { secret, backupCodes }.
const enrollTotpViaApi = async ({ user, pass }) => {
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
  return { secret, backupCodes: verifyBody.backup_codes || [] };
};

// Browser login for a TOTP-enrolled user.
const loginWithTotp = async (page, { user, pass }, secret) => {
  await page.goto('/login');
  await fillCredentials(page, { user, pass });
  await submitTotpVerify(page, secret);
  await waitAuthed(page);
};

test('FE-0197/0198: полный 2FA flow — setup, backup-коды, повторный вход, reload без обхода', async ({ page }) => {
  // 1) Первичный логин: политика all → setup-required → totp_setup шаг.
  await page.goto('/login');
  await fillCredentials(page, FRESH);
  await page.locator('#login-totp-setup-code').waitFor({ state: 'visible', timeout: 15_000 });

  // Ручной ключ за <details> — открываем и читаем секрет.
  await page.getByText('QR-код и ручной ключ').click();
  const secret = (await page.locator('details .font-mono').first().innerText()).trim();
  expect(secret.length).toBeGreaterThanOrEqual(16);

  // 2) Подтверждение кода → setup_complete с backup-кодами.
  await page.locator('#login-totp-setup-code').fill(totp(secret));
  await page.getByRole('button', { name: 'Подтвердить код' }).click();
  await page.getByTestId('setup-complete-continue').waitFor({ state: 'visible', timeout: 15_000 });
  const backupCodes = await page.locator('div.grid .font-mono').allInnerTexts();
  expect(backupCodes.length).toBeGreaterThanOrEqual(4);
  const savedBackupCode = backupCodes[0].trim();

  // 3) Continue → (trusted-device prompt) → приложение.
  await page.getByTestId('setup-complete-continue').click();
  await waitAuthed(page);

  // 4) Повторный вход: totp_verify шаг. Reload во время челленджа НЕ обходит его.
  await page.context().clearCookies();
  await page.goto('/login');
  await fillCredentials(page, FRESH);
  await page.locator('#login-totp-verify').waitFor({ state: 'visible', timeout: 15_000 });
  await page.reload();
  // После reload — снова password-форма, приложение недоступно.
  await page.getByTestId('password-auth-form').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.getByTestId('main-layout-content')).toHaveCount(0);
  // Повторная подача пароля возвращает на totp_verify, код пускает внутрь.
  await fillCredentials(page, FRESH);
  await submitTotpVerify(page, secret);
  await waitAuthed(page);

  // 5) Вход по backup-коду — работает и код одноразовый.
  await page.context().clearCookies();
  await page.goto('/login');
  await fillCredentials(page, FRESH);
  await page.locator('#login-totp-verify').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Использовать backup-код' }).click();
  await page.locator('#login-totp-verify').fill(savedBackupCode);
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await waitAuthed(page);

  // 6) Повторное использование того же backup-кода отклоняется.
  await page.context().clearCookies();
  await page.goto('/login');
  await fillCredentials(page, FRESH);
  await page.locator('#login-totp-verify').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Использовать backup-код' }).click();
  await page.locator('#login-totp-verify').fill(savedBackupCode);
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expect(page.getByTestId('login-top-notice')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('main-layout-content')).toHaveCount(0);
});

test('FE-0059/0083: multi-tab refresh — single-flight rotation, потеря ответа ≠ logout, отказ → logout', async ({ context }) => {
  test.setTimeout(120_000);
  const { secret } = await enrollTotpViaApi(ADMIN);

  const page1 = await context.newPage();
  await loginWithTotp(page1, ADMIN, secret);

  // Три вкладки на одной cookie jar, все на /chat (SQLite-данные, не SQL Server).
  const pages = [page1];
  for (let i = 0; i < 2; i += 1) {
    const p = await context.newPage();
    await p.goto('/chat');
    await p.getByTestId('chat-sidebar-list-scroll').waitFor({ state: 'visible', timeout: 30_000 });
    pages.push(p);
  }
  if (!page1.url().includes('/chat')) {
    await page1.goto('/chat');
    await page1.getByTestId('chat-sidebar-list-scroll').waitFor({ state: 'visible', timeout: 30_000 });
  }

  // Счётчик реальных POST /auth/refresh на бэкенд.
  let refreshCount = 0;
  await context.route('**/api/v1/auth/refresh', async (route) => {
    refreshCount += 1;
    await route.continue();
  });
  // Эпоха от интерактивного входа (verify-2fa) живёт 10s и shared на весь
  // context — если сетап быстрее окна, все вкладки легитимно пропустят
  // refresh и счётчик будет 0. Чистим маркеры, чтобы фаза гарантированно
  // требовала реальной ротации (та же техника, что и в финальной фазе теста).
  await page1.evaluate(() => {
    window.localStorage.removeItem('hubit.auth.refresh_epoch');
    window.localStorage.removeItem('hubit.auth.refresh_claim');
  });
  // Маркеры — shared per-origin storage; удаление должно успеть распространиться
  // во все вкладки до их 401.
  await page1.waitForTimeout(300);

  // Одновременный 401 в трёх вкладках на первый запрос /chat/conversations.
  for (const p of pages) {
    let fired = false;
    await p.route('**/api/v1/chat/conversations**', async (route) => {
      if (fired || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      fired = true;
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' });
    });
  }
  await Promise.all(pages.map((p) => p.reload()));
  for (const p of pages) {
    await p.getByTestId('chat-sidebar-list-scroll').waitFor({ state: 'visible', timeout: 30_000 });
  }
  // Single-flight: ровно одна ротация на все три вкладки. Координатор до
  // ~400ms поглощает лаг распространения epoch — sidebar может появиться
  // раньше POST, поэтому ждём саму ротацию, а не один тик.
  await expect.poll(() => refreshCount, { timeout: 15_000 }).toBe(1);
  // Дубли гонки (если бы dedup сломался) прилетели бы в пределах ~1s —
  // даём окно и проверяем, что ротация осталась одиночной.
  await page1.waitForTimeout(1500);
  expect(refreshCount).toBe(1);

  // Потеря ответа refresh (transport abort) — сессия НЕ разрушается.
  await pages[0].route('**/api/v1/auth/refresh', (route) => route.abort());
  let fired = false;
  await pages[0].route('**/api/v1/chat/conversations**', async (route) => {
    if (fired || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    fired = true;
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' });
  });
  await pages[0].reload();
  // Grace: клиент ретраит refresh (500ms) и не разлогинивает по transport-ошибке.
  await pages[0].waitForTimeout(4000);
  expect(pages[0].url()).toContain('/chat');
  const userStillCached = await pages[0].evaluate(() => window.localStorage.getItem('user') !== null);
  expect(userStillCached).toBe(true);
  // Восстановление сети — сессия продолжается без повторного логина.
  await pages[0].unroute('**/api/v1/auth/refresh');
  await pages[0].unroute('**/api/v1/chat/conversations**');
  await pages[0].reload();
  await pages[0].getByTestId('chat-sidebar-list-scroll').waitFor({ state: 'visible', timeout: 30_000 });
  expect(pages[0].url()).toContain('/chat');

  // Дефинитивный отказ refresh (401) → auth-required → logout.
  const page2 = pages[1];
  await context.unroute('**/api/v1/auth/refresh');
  // Эпоха/клейм из предыдущих фаз (<10s) могла бы замаскировать реальный refresh —
  // чистим маркеры, чтобы гарантировать запрос на бэкенд.
  await page2.evaluate(() => {
    window.localStorage.removeItem('hubit.auth.refresh_epoch');
    window.localStorage.removeItem('hubit.auth.refresh_claim');
  });
  await page2.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"refresh revoked"}' }));
  let fired2 = false;
  await page2.route('**/api/v1/auth/me', async (route) => {
    if (fired2 || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    fired2 = true;
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' });
  });
  await page2.reload();
  await expect(page2).toHaveURL(/\/login/, { timeout: 30_000 });
  // Разлогин в одной вкладке очищает shared localStorage.user.
  const sharedUser = await page2.evaluate(() => window.localStorage.getItem('user'));
  expect(sharedUser).toBeNull();
});

// ---------- FE-0059 strict lost rotation response ----------

test('FE-0059 strict: ротация закоммичена на сервере, ответ потерян — retry внутри grace восстанавливает, после grace — дефинитивный отказ', async ({ page, context }) => {
  test.setTimeout(120_000);
  const REFRESH_USER = { user: 'e2e_refresh', pass: 'e2e-local-refresh-pass' };
  const { secret } = await enrollTotpViaApi(REFRESH_USER);
  await page.goto('/login');
  await fillCredentials(page, REFRESH_USER);
  await submitTotpVerify(page, secret);
  await waitAuthed(page);
  await page.goto('/chat');
  await page.getByTestId('chat-sidebar-list-scroll').waitFor({ state: 'visible', timeout: 30_000 });

  const clearRefreshMarkers = () => page.evaluate(() => {
    window.localStorage.removeItem('hubit.auth.refresh_epoch');
    window.localStorage.removeItem('hubit.auth.refresh_claim');
  });
  // Первый GET conversations после reload отвечает 401 → клиентский refresh.
  const armConversation401 = async () => {
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
  // Настоящая «потеря ответа»: ротация выполняется НАПРЯМУЮ на бэкенде отдельным
  // request-контекстом с текущей refresh-cookie страницы. Бэкенд коммитит новую
  // пару, но страница её не получает — cookie jar держит уже consumed-токен.
  const rotateServerSide = async () => {
    const jar = await context.cookies();
    const refreshCookie = jar.find((c) => c.name === 'itinvent_refresh_token');
    expect(refreshCookie, 'refresh cookie в jar').toBeTruthy();
    const api = await request.newContext({
      baseURL: BACKEND,
      extraHTTPHeaders: { Cookie: `itinvent_refresh_token=${refreshCookie.value}` },
    });
    const rotated = await api.post('/api/v1/auth/refresh');
    expect(rotated.status()).toBe(200);
    const setCookie = rotated.headers()['set-cookie'] || '';
    expect(setCookie).toContain('itinvent_refresh_token');
    await api.dispose();
    return Date.now();
  };

  // --- Сценарий A: ротация на сервере закоммичена, ответ клиенту потерян,
  // клиент ретраит ВНУТРИ grace (3s на стенде) — grace-serve возвращает ту же
  // пару и сессия остаётся живой.
  await rotateServerSide();
  // Login-эпоха (<10s) замаскировала бы transport-ветку — чистим маркеры.
  await clearRefreshMarkers();
  let gracePosts = 0;
  await page.route('**/api/v1/auth/refresh', async (route) => {
    gracePosts += 1;
    await route.continue();
  });
  await armConversation401();
  await page.reload();
  // Ровно один клиентский POST — grace-serve старого jti (первая подача).
  await expect.poll(() => gracePosts, { timeout: 15_000 }).toBe(1);
  await expect(page.getByTestId('chat-sidebar-list-scroll')).toBeVisible({ timeout: 30_000 });
  // Жизнеспособность новой сессии: чистый reload без подмен — /auth/me 200,
  // приложение грузится, пользователь не разлогинен.
  await page.unroute('**/api/v1/chat/conversations**');
  await page.unroute('**/api/v1/auth/refresh');
  await page.reload();
  await expect(page.getByTestId('chat-sidebar-list-scroll')).toBeVisible({ timeout: 30_000 });
  const meOk = await page.evaluate(async () => (await fetch('/api/v1/auth/me', { credentials: 'include' })).ok);
  expect(meOk).toBe(true);

  // --- Сценарий B: ротация закоммичена, ответ потерян, реальный POST только
  // ПОСЛЕ истечения grace → дефинитивный отказ (ограничение протокола).
  const committedAt = await rotateServerSide();
  // Свежая эпоха сценария A (<10s) заставила бы lock-путь честно пропустить
  // refresh — чистим маркеры, чтобы клиент реально шёл на бэкенд.
  await clearRefreshMarkers();
  let abortedPosts = 0;
  await page.route('**/api/v1/auth/refresh', async (route) => {
    // Клиентский POST и его 500ms-retry теряются в транспорте — до бэкенда
    // не доходят, grace-hit не тратится (так «ответ потерян» остаётся потерянным).
    abortedPosts += 1;
    await route.abort();
  });
  await armConversation401();
  await page.reload();
  // Ждём пока клиентский retry сгорит и grace (10s на стенде) истечёт от
  // момента коммита ротации.
  await expect.poll(() => abortedPosts, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  const graceLeft = 11_000 - (Date.now() - committedAt);
  if (graceLeft > 0) await page.waitForTimeout(graceLeft);
  // Transport-потери — не дефинитивный отказ: logout НЕ должен был произойти.
  expect(page.url()).not.toContain('/login');
  expect(await page.evaluate(() => window.localStorage.getItem('user') !== null)).toBe(true);

  // Grace истёк: реальный POST со старой cookie → revoked_jti → дефинитивный 401.
  // Маркер эпохи после двойной потери стоит в будущем (+10s) — чистим, чтобы
  // запрос дошёл до бэкенда и показал настоящий ответ протокола.
  await page.unroute('**/api/v1/auth/refresh');
  await page.unroute('**/api/v1/chat/conversations**');
  await clearRefreshMarkers();
  let finalPosts = 0;
  await page.route('**/api/v1/auth/refresh', async (route) => {
    finalPosts += 1;
    await route.continue();
  });
  await armConversation401();
  await page.reload();
  await expect.poll(() => finalPosts, { timeout: 15_000 }).toBe(1);
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  expect(await page.evaluate(() => window.localStorage.getItem('user'))).toBeNull();
  // Ограничение протокола: rotated-пара на сервере жива, но клиент её никогда
  // не получил — восстановление невозможно без ослабления replay-защиты.
});

// ---------- FE-0198 strict trusted-device ----------

const addVirtualAuthenticator = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
};

const registerButton = (dialog) => dialog.getByRole("button", { name: /Через Windows Hello|Запомнить/ });
const skipButton = (dialog) => dialog.getByRole("button", { name: "Не сейчас" });
const continueButton = (dialog) => dialog.getByRole("button", { name: "Продолжить" });

// Пост-логин лендинг зависит от onboarding: /about («Перейти в HUB») либо
// сразу оболочка приложения. Дожидаемся любого и входим в HUB при необходимости.
// 앞쪽 테스트가 시드 계정 3개의 2FA를 모두 등록하므로, strict 테스트는 전용
// 시드 e2e_td(등록 안 됨)와 e2e_user(누구도 등록하지 않음)를 쓴다.
const TD_USER = { user: "e2e_td", pass: "e2e-local-td-pass" };
const TD_USER2 = { user: "e2e_user", pass: "e2e-local-user-pass" };

const enterHub = async (page) => {
  const main = page.getByTestId("main-layout-content");
  const hub = page.getByRole("button", { name: "Перейти в HUB" }).first();
  await main.or(hub).first().waitFor({ state: "visible", timeout: 30_000 });
  if (!(await main.isVisible().catch(() => false))) await hub.click();
  await expect(main).toBeVisible({ timeout: 30_000 });
};

test("FE-0198 strict: обязательный trusted-device prompt — регистрация, ошибки, reload, повторный вход", async ({ page, context }) => {
  test.setTimeout(180_000);
  // Loopback is in the stand's internal CIDRs (rate-limit exemption); the
  // required trusted-device prompt is external-only. Peer 127.0.0.1 is a
  // trusted proxy, so a forwarded public IP classifies the session external.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.51" });
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
  const { secret } = await enrollTotpViaApi(TD_USER);

  // 1) Логин → REQUIRED prompt обязан появиться (0 discoverable devices, external).
  await page.goto("/login");
  await fillCredentials(page, TD_USER);
  await submitTotpVerify(page, secret);
  const dialog = page.getByTestId("login-remember-device-dialog");
  await dialog.waitFor({ state: "visible", timeout: 20_000 }); // FAIL если диалог не появился

  // Hold удерживает /login, экземпляр Login жив, приложение не смонтировано.
  expect(page.url()).toContain("/login");
  await expect(page.getByTestId("main-layout-content")).toHaveCount(0);
  await expect(registerButton(dialog)).toBeVisible();
  // Required + supported: 'Не сейчас' скрыт политикой.
  await expect(skipButton(dialog)).toBeHidden();
  // Escape не закрывает обязательный диалог.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await expect(dialog).toBeVisible();

  // 2) Reload во время обязательного prompt: сессия уже зафиксирована —
  // /login честно редиректит на пост-логин страницу (сессия не теряется).
  await page.reload();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  // Авторизованный вход в HUB доступен — значит reload не разлогинил.
  await enterHub(page);
  // Новый вход — required prompt появляется снова (устройств всё ещё 0).
  await context.clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/login");
  await page.getByTestId("password-auth-form").waitFor({ state: "visible", timeout: 15_000 });
  await fillCredentials(page, TD_USER);
  await submitTotpVerify(page, secret);
  await dialog.waitFor({ state: "visible", timeout: 20_000 });

  // 3) Ошибка регистрации: бэкенд отклонил verify → ошибка в диалоге, остаёмся на /login.
  await page.route("**/api/v1/auth/trusted-devices/register/verify", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: '{"detail":"synthetic verify failure"}' }));
  await dialog.locator("#trusted-device-label").fill("E2E device");
  await registerButton(dialog).click();
  await expect(dialog.locator("text=synthetic verify failure")).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toBeVisible();
  expect(page.url()).toContain("/login");
  await page.unroute("**/api/v1/auth/trusted-devices/register/verify");

  // 4) Успешная регистрация через виртуальный аутентификатор → диалог закрыт → редирект с /login.
  await registerButton(dialog).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await enterHub(page);
  const devices = await page.evaluate(async () => {
    const r = await fetch("/api/v1/auth/trusted-devices", { credentials: "include" });
    return r.ok ? r.json() : { error: r.status };
  });
  expect(Array.isArray(devices) ? devices.length : -1).toBeGreaterThanOrEqual(1);

  // 5) Reload в приложении — сессия жива.
  await page.reload();
  await expect(page.getByTestId("main-layout-content")).toBeVisible({ timeout: 30_000 });
  expect(page.url()).not.toContain("/login");

  // 6) Повторный вход: >0 discoverable devices → OPTIONAL prompt, 'Не сейчас' доступен.
  // Зарегистрированный passkey в аутентификаторе включает авто-вход на /login —
  // подменяем его свежим аутентификатором без resident credentials для ручного входа.
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  // Access-token живёт в localStorage — одного clearCookies мало для разлогина.
  await context.clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/login");
  await fillCredentials(page, TD_USER);
  await submitTotpVerify(page, secret);
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  await expect(skipButton(dialog)).toBeVisible();
  await skipButton(dialog).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
});

test("FE-0198 strict: unsupported WebAuthn — required-подсказка, 'Продолжить' по политике", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.52" });
  const { secret } = await enrollTotpViaApi(TD_USER2);
  // Без виртуального аутентификатора WebAuthn недоступен headless.
  await page.goto("/login");
  await fillCredentials(page, TD_USER2);
  await submitTotpVerify(page, secret);
  const dialog = page.getByTestId("login-remember-device-dialog");
  // e2e_user: 0 discoverable devices → required-подсказка, но режим unsupported.
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  expect(page.url()).toContain("/login");
  await expect(page.getByTestId("main-layout-content")).toHaveCount(0);
  // Unsupported: только 'Продолжить' — регистрационной кнопки нет.
  await expect(continueButton(dialog)).toBeVisible();
  await expect(registerButton(dialog)).toHaveCount(0);
  await continueButton(dialog).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
});
