import { test, expect } from '@playwright/test';

// Route-guard and login-error smoke against the real deployed build.
// The first three tests need no credentials and run anywhere the build is
// reachable. The deep-link test requires E2E_USERNAME/E2E_PASSWORD and a
// user that actually has access to /chat (same requirement as chat-smoke).

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

test('unauthenticated visit to /chat redirects to /login', async ({ page }) => {
  await page.goto('/chat');
  // toHaveURL polls — it survives the SPA history.replace redirect that
  // aborts a one-shot waitForURL on this app.
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeVisible();
});

test('unauthenticated visit to / redirects to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeVisible();
});

test('rejected credentials keep the user on /login and show an error', async ({ page }) => {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill('e2e-nonexistent-user');
  await form.locator('input[name="password"]').fill('e2e-wrong-password-1');
  await form.getByRole('button', { name: 'Войти', exact: true }).click();

  // The error toast appears and the app must not navigate anywhere.
  await expect(page.getByTestId('login-top-notice')).toBeVisible();
  expect(page.url()).toContain('/login');
});

test('after login the user returns to the originally requested page', async ({ page }) => {
  test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();

  // Deep link is remembered through the login roundtrip.
  await expect(page).toHaveURL(/\/chat/, { timeout: 30_000 });
  await expect(page.getByTestId('chat-sidebar-list-scroll')).toBeVisible();
  await expect(page).toHaveURL(/\/chat/);
});

const USERNAME2 = process.env.E2E_USERNAME2;
const PASSWORD2 = process.env.E2E_PASSWORD2;
const USERNAME3 = process.env.E2E_USERNAME3;
const PASSWORD3 = process.env.E2E_PASSWORD3;

test('non-admin is redirected out of the admin area', async ({ page }) => {
  test.skip(!USERNAME2 || !PASSWORD2, 'need a non-admin user (E2E_USERNAME2/E2E_PASSWORD2)');

  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME2);
  await form.locator('input[name="password"]').fill(PASSWORD2);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeHidden();
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
  const landing = new URL(page.url()).pathname;

  // AdminAreaRoute bounces non-admins to their first accessible route —
  // the same place a fresh login lands.
  await page.goto('/admin');
  await expect(page).toHaveURL(new RegExp(landing.replace(/[/.]/g, '\\$&') + '$'), { timeout: 30_000 });
  expect(new URL(page.url()).pathname).not.toContain('/admin');
});

test('first login lands on /about and completing onboarding returns to the deep link', async ({ page }) => {
  test.skip(!USERNAME3 || !PASSWORD3, 'need an unfinished-onboarding user (E2E_USERNAME3/E2E_PASSWORD3)');

  // Request a protected page, get bounced to login, then to /about.
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME3);
  await form.locator('input[name="password"]').fill(PASSWORD3);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();

  // The onboarding gate holds the user on /about, not the requested page.
  await expect(page).toHaveURL(/\/about/, { timeout: 30_000 });

  // «Перейти в HUB» completes onboarding and honours the stored return path.
  await page.getByRole('button', { name: 'Перейти в HUB' }).first().click();
  await expect(page).toHaveURL(/\/chat/, { timeout: 30_000 });
  await expect(page.getByTestId('chat-sidebar-list-scroll')).toBeVisible();
  await expect(page).toHaveURL(/\/chat/);
});
