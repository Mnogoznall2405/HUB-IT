import { test, expect } from '@playwright/test';

// Release-gate route sweep: one real login on the seeded local stack, then
// every main navigation route must render without RouteErrorBoundary, an
// uncaught pageerror or unexpected console errors. This complements the
// feature specs: it only proves each module mounts and paints real content.
//
// Env-blocked surfaces are recorded, not faked: /mail redirects away when the
// mail module/session is off (the seeded backend runs MAIL_MODULE_ENABLED=0),
// SQL-Server-backed pages still render their shell + error state.
//
// Console noise allowlist is intentionally narrow — it covers network-level
// failures the test stack legitimately produces (unseeded upstreams, proxied
// sockets). Anything else (TypeError, React errors, app console.error) fails.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(process.env.E2E_LOCAL !== '1', 'route sweep runs only against the seeded local stack');
test.skip(!USERNAME || !PASSWORD, 'E2E_USERNAME/E2E_PASSWORD not set');

const BOUNDARY_TEXT = /Не удалось отобразить раздел|Нужно обновить экран/;
const LOADER_TEXT = /Загружаем раздел|Подготавливаем интерфейс/;

const CONSOLE_NOISE = [
  /Failed to load resource/i,
  /net::ERR|ERR_CONNECTION|ERR_ABORTED|ERR_NAME/i,
  /WebSocket (connection|to).*(failed|closed|error)/i,
  /favicon/i,
  /ResizeObserver loop/i,
  /the server responded with a status/i,
  // Service worker / push subscription attempts against the throwaway stack.
  /service ?worker|push subscription|PushManager/i,
];

// Application-level console.error reports of failed API calls. The local stack
// deliberately leaves SQL Server, scan, mail and 1C upstreams unseeded, so the
// pages that depend on them log handled request failures. These are recorded
// as route notes ("degraded"), never silently dropped — a route that also
// misses its marker still fails.
const API_FAILURE_LOG = /AxiosError|Request failed with status code|API request failed|Network Error|Failed to fetch/i;

const isNoise = (text) => CONSOLE_NOISE.some((re) => re.test(text));

// marker candidates: {testid} or {text} — at least one must become visible.
const ROUTES = [
  { path: '/dashboard', markers: [{ testid: 'page-top-bar' }, { text: 'Главная' }] },
  { path: '/feed', markers: [{ text: 'Лента' }, { text: 'публикац' }] },
  { path: '/tickets', markers: [{ text: 'Билеты' }, { testid: 'page-top-bar' }] },
  { path: '/tasks', markers: [{ testid: 'tasks-create-fab' }, { text: 'Задач' }] },
  { path: '/chat', markers: [{ testid: 'chat-sidebar-list-scroll' }] },
  // Mail page mounts in a browser session (the enable/disable choice is a
  // Desktop-shell concept); the mail backend is off locally, so the page shows
  // its shell and logs API failures — feature-level mail stays env-blocked.
  { path: '/mail', markers: [{ testid: 'mail-list-panel' }, { text: 'Почта' }] },
  { path: '/my-files', markers: [{ testid: 'my-files-drop-zone' }] },
  { path: '/database', markers: [{ text: 'баз' }] },
  { path: '/networks', markers: [{ text: 'Сети' }] },
  { path: '/vcs', markers: [{ text: 'ВКС' }] },
  { path: '/mfu', markers: [{ text: 'МФУ' }] },
  { path: '/monitoring', markers: [{ testid: 'main-layout-content' }] },
  { path: '/computers', markers: [{ text: 'компьютер' }] },
  { path: '/scan-center', markers: [{ testid: 'main-layout-content' }] },
  { path: '/voice', markers: [{ testid: 'main-layout-content' }] },
  { path: '/file-egress', markers: [{ text: 'DLP' }, { testid: 'main-layout-content' }] },
  { path: '/statistics', markers: [{ text: 'Статистика' }] },
  { path: '/address-book', markers: [{ testid: 'address-book-tabs' }] },
  { path: '/company-structure', markers: [{ testid: 'company-structure-toolbar' }] },
  { path: '/warehouse-1c', markers: [{ text: 'Склад 1С' }] },
  { path: '/it/requests', markers: [{ text: 'Заявки на МПЗ' }] },
  { path: '/it/objects', markers: [{ text: 'Объекты ИТ' }] },
  { path: '/construction', markers: [{ text: 'Объекты строительства' }] },
  { path: '/docflow', markers: [{ text: 'Документооборот' }] },
  { path: '/passwords', markers: [{ testid: 'passwords-page' }, { text: 'Пароли' }] },
  { path: '/groups-access', markers: [{ text: 'Доступ к папкам' }] },
  { path: '/help', markers: [{ text: 'Чем помочь' }] },
  { path: '/profile', markers: [{ text: 'Профиль' }] },
  { path: '/settings', markers: [{ text: 'Профиль' }, { text: 'Настройки' }, { text: 'Внешний вид' }] },
  { path: '/admin', markers: [{ testid: 'main-layout-content' }] },
  { path: '/menu', markers: [{ testid: 'mobile-menu-app-grid' }] },
];

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

test('release smoke: every main route renders without crash', async ({ page }, testInfo) => {
  test.setTimeout(300_000);

  const pageErrors = [];
  const consoleErrors = [];
  const apiNoise = [];
  let routeTag = 'boot';
  page.on('pageerror', (error) => pageErrors.push({ route: routeTag, text: String(error) }));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isNoise(text)) return;
    if (API_FAILURE_LOG.test(text)) {
      apiNoise.push({ route: routeTag, text: text.split('\n')[0] });
      return;
    }
    consoleErrors.push({ route: routeTag, text });
  });

  await login(page);

  const matrix = [];

  for (const route of ROUTES) {
    routeTag = route.path;
    const pageErrorsBefore = pageErrors.length;
    const consoleErrorsBefore = consoleErrors.length;
    const apiNoiseBefore = apiNoise.length;

    await page.goto(route.path, { waitUntil: 'domcontentloaded' });

    let status = 'renders';
    const notes = [];
    try {
      // Suspense fallback must clear — a route stuck on the loader never mounted.
      await expect(page.getByText(LOADER_TEXT)).toHaveCount(0, { timeout: 20_000 });
    } catch {
      status = 'fail';
      notes.push('suspense loader did not clear');
    }

    const url = new URL(page.url());
    if (route.expectRedirect) {
      if (url.pathname === route.path) {
        notes.push('expected redirect away but stayed on route');
        status = 'fail';
      } else {
        status = 'env-blocked';
        notes.push(`redirected to ${url.pathname} (module unavailable on local stack)`);
      }
    } else if (url.pathname !== route.path) {
      status = 'fail';
      notes.push(`redirected to ${url.pathname}`);
    }

    if (status !== 'fail') {
      const boundaryHits = await page.getByText(BOUNDARY_TEXT).count();
      if (boundaryHits > 0) {
        status = 'fail';
        notes.push('RouteErrorBoundary visible');
      }
    }

    if (status === 'renders') {
      // Marker: any candidate visible within the window; otherwise require the
      // shell content to contain real text (catches white-screen shells).
      let markerHit = false;
      for (const marker of route.markers || []) {
        const locator = marker.testid
          ? page.getByTestId(marker.testid).first()
          : page.getByText(marker.text, { exact: false }).first();
        try {
          await locator.waitFor({ state: 'visible', timeout: 5_000 });
          markerHit = true;
          break;
        } catch { /* try next candidate */ }
      }
      if (!markerHit) {
        const text = await page.getByTestId('main-layout-content').innerText().catch(() => '');
        if (text.trim().length > 20) {
          markerHit = true;
          notes.push('no declared marker matched; content non-empty');
        }
      }
      if (!markerHit) {
        status = 'fail';
        notes.push('no marker matched and content empty');
      }
    }

    const newPageErrors = pageErrors.slice(pageErrorsBefore);
    const newConsoleErrors = consoleErrors.slice(consoleErrorsBefore);
    const newApiNoise = apiNoise.slice(apiNoiseBefore);
    if (newApiNoise.length && status === 'renders') {
      status = 'degraded';
      notes.push(`unseeded-upstream API errors: ${newApiNoise.map((e) => e.text).join(' | ')}`);
    }
    if (newPageErrors.length) {
      status = 'fail';
      notes.push(`pageerror: ${newPageErrors.map((e) => e.text).join(' | ')}`);
    }
    if (newConsoleErrors.length) {
      status = 'fail';
      notes.push(`console.error: ${newConsoleErrors.map((e) => e.text).join(' | ')}`);
    }

    matrix.push({ route: route.path, status, notes });
  }

  routeTag = 'teardown';
  for (const row of matrix) {
    // eslint-disable-next-line no-console
    console.log(`[release-smoke] ${row.status.padEnd(11)} ${row.route}${row.notes.length ? `  — ${row.notes.join('; ')}` : ''}`);
  }
  await testInfo.attach('route-matrix', {
    body: JSON.stringify(matrix, null, 2),
    contentType: 'application/json',
  });

  const failures = matrix.filter((row) => row.status === 'fail');
  expect(failures, `route failures: ${failures.map((f) => `${f.route} (${f.notes.join('; ')})`).join(', ')}`).toEqual([]);
});
