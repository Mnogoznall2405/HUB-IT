import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1', 'Only the isolated local stack may create test dialogs');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0' });
    localStorage.removeItem('hubit:desktop-handoff');
    // Observe the OS handoff at the browser boundary without launching a real application.
    window.__protocolAttempts = [];
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href^="hubit:"]');
      if (!link) return;
      event.preventDefault();
      window.__protocolAttempts.push(link.href);
      if (window.__simulateAppOpen) window.dispatchEvent(new Event('pagehide'));
    }, true);
  });
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
});

async function login(page) {
  const form = page.getByTestId('password-auth-form');
  await expect(form).toBeVisible();
  await form.locator('[name=username]').fill(process.env.E2E_USERNAME);
  await form.locator('[name=password]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(form).toBeHidden({ timeout: 30000 });
}

for (const scenario of [
  { name: 'ordinary login', path: '/login', zone: 'internal' },
  { name: 'external portal login', path: '/chat/open#email=e2e_user%40example.com', zone: 'external' },
]) {
  test(`${scenario.name} does not start automatic Windows SSO`, async ({ page }) => {
    let starts = 0;
    await page.route('**/api/v1/auth/login-mode', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), network_zone: scenario.zone, windows_sso_enabled: true } });
    });
    await page.route('**/api/v1/auth/sso/begin', (route) => { starts++; return route.fulfill({ status: 403 }); });
    await page.goto(scenario.path);
    await expect(page.getByTestId('password-auth-form')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(starts).toBe(0);
  });
}

test('portal starts Windows SSO once, cancellation keeps password login and recipient', async ({ page }) => {
  let starts = 0;
  await page.route('**/api/v1/auth/login-mode', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), network_zone: 'internal', windows_sso_enabled: true } });
  });
  await page.route('**/api/v1/auth/sso/begin', (route) => {
    starts++;
    return route.fulfill({ status: 302, headers: { location: '/login?sso_error=denied' } });
  });
  await page.goto('/chat/open#email=e2e_user%40example.com');
  await expect(page).toHaveURL(/sso_error=denied/);
  await expect(page.getByText('Вход через Windows отменён — используйте логин и пароль.', { exact: true })).toBeVisible();
  await login(page);
  await expect(page).toHaveURL(/\/chat\?conversation=/, { timeout: 30000 });
  const id = new URL(page.url()).searchParams.get('conversation');
  const detail = await page.request.get(`/api/v1/chat/conversations/${id}`);
  expect(JSON.stringify(await detail.json())).toContain('e2e_user');
  expect(starts).toBe(1);
});

test('missing application falls back to the same browser conversation', async ({ page }) => {
  await page.goto('/chat/open#email=e2e_user%40example.com');
  await login(page);
  await expect(page).toHaveURL(/\/chat\?conversation=/, { timeout: 30000 });
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('conversation');
  expect(await page.evaluate(() => window.__protocolAttempts)).toEqual([`hubit://open/chat?conversation=${id}`]);
});

test('authenticated SSO landing on root restores the portal recipient', async ({ page }) => {
  await page.goto('/login');
  await login(page);
  await page.evaluate(() => sessionStorage.setItem('hubit.auth.return-to', '/chat/open#email=e2e_fresh%40example.com'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat\?conversation=/, { timeout: 30000 });
  const id = new URL(page.url()).searchParams.get('conversation');
  const detail = await page.request.get(`/api/v1/chat/conversations/${id}`);
  expect(JSON.stringify(await detail.json())).toContain('e2e_fresh');
  expect(await page.evaluate(() => sessionStorage.getItem('hubit.auth.return-to'))).toBeNull();
});

test('application handoff keeps the browser out of the conversation and offers explicit fallback', async ({ page }) => {
  await page.addInitScript(() => { window.__simulateAppOpen = true; });
  await page.goto('/chat/open#email=e2e_user%40example.com');
  await login(page);
  await expect(page.getByRole('button', { name: 'Продолжить в браузере', exact: true })).toBeVisible();
  await page.waitForTimeout(3000);
  expect(new URL(page.url()).pathname).toBe('/chat/open');
  await expect(page.getByTestId('chat-composer-textarea')).toHaveCount(0);
  const attempts = await page.evaluate(() => window.__protocolAttempts);
  expect(attempts).toHaveLength(1);
  await page.getByRole('button', { name: 'Продолжить в браузере', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\?conversation=/);
  expect(attempts[0]).toBe(`hubit://open/chat?conversation=${new URL(page.url()).searchParams.get('conversation')}`);
});

test('previous employee handoff timeout cannot replace the new recipient', async ({ page }) => {
  await page.goto('/chat/open#email=e2e_user%40example.com');
  await login(page);
  await expect.poll(() => page.evaluate(() => window.__protocolAttempts.length)).toBe(1);
  await page.evaluate(() => { window.location.hash = 'email=e2e_fresh%40example.com'; });
  await expect.poll(() => page.evaluate(() => window.__protocolAttempts.length)).toBe(2);
  await expect(page).toHaveURL(/\/chat\?conversation=/, { timeout: 30000 });
  const id = new URL(page.url()).searchParams.get('conversation');
  const detail = await page.request.get(`/api/v1/chat/conversations/${id}`);
  expect(JSON.stringify(await detail.json())).toContain('e2e_fresh');
  const attempts = await page.evaluate(() => window.__protocolAttempts);
  expect(attempts[1]).toBe(`hubit://open/chat?conversation=${id}`);
});
