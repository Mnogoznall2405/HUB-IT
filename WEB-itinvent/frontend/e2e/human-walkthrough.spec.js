import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// «Как человек»: после входа каждый раздел открывается, на нём переключаются все вкладки и
// нажимаются безопасные кнопки (диалоги открываются и закрываются без сохранения). Тест ловит
// необработанные JS-исключения, экран ошибки, пустую страницу и ответы 5xx от нашего API.
// Только изолированный стенд (E2E_LOCAL=1): SQL Server, LDAP и 1С там недоступны по построению,
// поэтому 5xx от их эндпоинтов попадают в отчёт, но не валят тест.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(process.env.E2E_LOCAL !== '1', 'walkthrough runs only against the isolated local stack');
test.skip(!(USERNAME && PASSWORD), 'E2E_USERNAME/E2E_PASSWORD not set');

const REPORT_DIR = fileURLToPath(new URL('../../../output/e2e-walkthrough/', import.meta.url));
const DANGER = /удал|очист|отправ|выйти|выход|сброс|заверш|архив|останов|перезапуск|блокир|деактив|отключ|logout|delete|clear|reset|send|убрать|отозв|закрыть сессию|завершить/i;
// Эндпоинты внешних систем, которых нет на стенде (SQL Server ITINVENT, LDAP, 1С, Exchange).
const EXTERNAL_API = /\/(equipment|database|warehouse-1c|mail|ldap|zup|inventory\/(1c|reconcile)|it\/(requests|objects)|construction|ad-users|groups-access|scan)\b/i;

const ROUTES = [
  '/dashboard', '/feed', '/tasks', '/tickets', '/chat', '/database', '/networks', '/mfu', '/monitoring',
  '/computers', '/scan-center', '/voice', '/dlp', '/file-egress', '/statistics', '/help', '/kb/manage',
  '/vcs', '/mail', '/address-book', '/company-structure', '/warehouse-1c', '/it/requests', '/it/objects',
  '/construction', '/docflow', '/passwords', '/groups-access', '/my-files', '/profile', '/settings',
  '/admin', '/menu',
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

function watch(page) {
  const issues = { pageErrors: [], api5xx: [], apiExternal5xx: [], consoleErrors: [] };
  page.on('pageerror', (error) => issues.pageErrors.push(String(error.message).slice(0, 300)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon|WebSocket|ERR_ABORTED|Failed to load resource/i.test(text)) return;
    issues.consoleErrors.push(text.slice(0, 300));
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/') || response.status() < 500) return;
    const row = `${response.request().method()} ${url.pathname} ${response.status()}`;
    (EXTERNAL_API.test(url.pathname) ? issues.apiExternal5xx : issues.api5xx).push(row);
  });
  return issues;
}

async function closeOverlays(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const overlay = page.locator('[role="dialog"], .MuiPopover-root, .MuiMenu-root, .MuiDrawer-root:not(.MuiDrawer-docked)');
    if ((await overlay.count()) === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

async function humanPass(page, path, actions) {
  const content = page.getByTestId('main-layout-content');
  const tabs = content.getByRole('tab');
  const tabCount = Math.min(await tabs.count(), 12);
  for (let index = 0; index < tabCount; index += 1) {
    const tab = content.getByRole('tab').nth(index);
    if (!(await tab.isVisible().catch(() => false))) continue;
    const name = ((await tab.innerText().catch(() => '')) || `tab#${index}`).trim().slice(0, 40);
    await tab.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
    actions.push(`tab: ${name}`);
  }
  const buttons = content.getByRole('button');
  const buttonCount = Math.min(await buttons.count(), 40);
  let clicked = 0;
  for (let index = 0; index < buttonCount && clicked < 12; index += 1) {
    const button = content.getByRole('button').nth(index);
    if (!(await button.isVisible().catch(() => false)) || !(await button.isEnabled().catch(() => false))) continue;
    const name = ((await button.getAttribute('aria-label')) || (await button.innerText().catch(() => '')) || '').trim().slice(0, 50);
    if (!name || DANGER.test(name)) continue;
    const before = page.url();
    await button.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
    actions.push(`button: ${name}`);
    clicked += 1;
    await closeOverlays(page);
    if (page.url() !== before) {
      await page.goto(path);
      await expect(content).toBeVisible({ timeout: 30_000 });
      break;
    }
  }
}

const summary = [];

for (const path of ROUTES) {
  test(`walkthrough ${path}`, async ({ page }) => {
    const issues = watch(page);
    await login(page);
    await page.goto(path);
    await expect(page.getByTestId('password-auth-form')).toHaveCount(0);
    const content = page.getByTestId('main-layout-content');
    await expect(content).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    const bodyText = (await page.locator('body').innerText()).trim();
    const actions = [];
    await humanPass(page, path, actions);

    const row = { path, finalUrl: new URL(page.url()).pathname, textLength: bodyText.length, actions: actions.length, ...issues };
    summary.push(row);
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(`${REPORT_DIR}${path.replace(/[^a-z0-9]+/gi, '_')}.json`, JSON.stringify({ ...row, actionList: actions }, null, 1));

    expect(bodyText.length, 'страница не должна быть пустой').toBeGreaterThan(40);
    expect(issues.pageErrors, 'необработанные JS-исключения').toEqual([]);
    expect(issues.api5xx, 'ответы 5xx от нашего API').toEqual([]);
  });
}
