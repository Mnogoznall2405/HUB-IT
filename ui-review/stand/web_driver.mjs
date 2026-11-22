// Shared web-stand driver for WEB parity captures.
// Boots Chrome (installed channel) against the local E2E stack
// (backend http://127.0.0.1:18001, vite http://127.0.0.1:5174),
// logs in as the seed user and exposes scenario helpers.
//
// Usage from a scenario script:
//   import { createStand } from './web_driver.mjs';
//   const stand = await createStand({ width: 1280, height: 720, scheme: 'dark' });
//   await stand.openChat('E2E Пользователь');
//   await stand.shot('web-dark-1280x720-100.png');
//   await stand.close();

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const STAND_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_PKG = path.resolve(STAND_DIR, '../../WEB-itinvent/frontend/package.json');
const require = createRequire(FRONTEND_PKG);
const { chromium } = require('playwright-core');

const BASE_URL = process.env.WEB_BASE_URL || 'http://127.0.0.1:5174';
const USERNAME = process.env.E2E_USERNAME || 'e2e_admin';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-local-admin-pass';

export async function createStand({
  width = 1280,
  height = 720,
  scheme = 'dark',
  outDir = path.resolve(STAND_DIR, '../screenshots/after/web-parity'),
  username = USERNAME,
  password = PASSWORD,
  extraArgs = [],
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL || 'chrome',
    args: ['--disable-dev-shm-usage', '--disable-gpu', ...extraArgs],
  });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: scheme,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  async function login() {
    await page.goto('/login');
    const form = page.getByTestId('password-auth-form');
    await form.locator('input[name="username"]').fill(username);
    await form.locator('input[name="password"]').fill(password);
    await form.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
    await page.getByTestId('main-layout-content').waitFor({ state: 'visible', timeout: 30_000 });
  }

  async function openChat(conversationTitle, { folderTab } = {}) {
    await page.goto('/chat');
    const sidebar = page.getByTestId('chat-sidebar-list-scroll');
    await sidebar.waitFor({ state: 'visible', timeout: 30_000 });
    if (folderTab) {
      await page.getByRole('button', { name: folderTab, exact: true }).first().click();
    }
    if (conversationTitle) {
      const row = sidebar.getByText(conversationTitle, { exact: false }).first();
      await row.waitFor({ state: 'visible', timeout: 15_000 });
      await row.click();
      await page.getByTestId('chat-composer-textarea').waitFor({ state: 'visible', timeout: 15_000 });
      // Give history a moment to settle at the bottom.
      await page.waitForTimeout(1200);
    }
  }

  async function openContextPanel() {
    await page.locator('[aria-label="Информация о чате"]').first().click();
    await page.waitForTimeout(900);
  }

  async function shot(name) {
    const file = path.join(outDir, name);
    await page.screenshot({ path: file });
    return file;
  }

  async function measure() {
    return page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        shell: rect('[data-testid="chat-desktop-shell"]'),
        sidebar: rect('[data-testid="chat-sidebar-list-scroll"]'),
        thread: rect('[data-testid="chat-thread-root"]'),
        threadScroll: rect('[data-testid="chat-thread-scroll"]'),
        composerDock: rect('[data-testid="chat-composer-dock"]'),
        composerCapsule: rect('[data-testid="chat-composer-capsule"]'),
        composerTextarea: rect('[data-testid="chat-composer-textarea"]'),
        rightOverlay: rect('[data-testid="chat-desktop-right-panel-overlay"]'),
        rightPersistent: rect('[data-testid="chat-desktop-right-panel-persistent"]'),
        infoButton: rect('[aria-label="Информация о чате"]'),
      };
    });
  }

  return {
    browser, context, page, login, openChat, openContextPanel, shot, measure,
    outDir,
    async saveMeasure(name) {
      const m = await measure();
      const file = path.join(outDir, name);
      fs.writeFileSync(file, JSON.stringify(m, null, 2));
      return m;
    },
    async close() { await browser.close(); },
  };
}
