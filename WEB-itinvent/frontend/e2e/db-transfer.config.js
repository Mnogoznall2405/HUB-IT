import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// No backend is started: this harness intercepts all APIs in the browser.
export default defineConfig({
  testDir: '.', testMatch: 'db-transfer.spec.js', workers: 1, timeout: 60_000,
  outputDir: fileURLToPath(new URL('../../../output/playwright/db-transfer', import.meta.url)),
  use: {
    baseURL: 'http://127.0.0.1:5176', channel: process.env.PW_CHANNEL || 'chrome',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { args: ['--disable-dev-shm-usage', '--disable-gpu'] },
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node node_modules/vite/bin/vite.js --config e2e/db-transfer.vite.config.js',
    url: 'http://127.0.0.1:5176', reuseExistingServer: false, timeout: 60_000,
  },
});
