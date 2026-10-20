import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.', testMatch: ['audit-mail-files.spec.js', 'audit-kb-links.spec.js', 'audit-task-canvas.spec.js'], workers: 1, timeout: 30000,
  outputDir: fileURLToPath(new URL('../../../output/audit-20261018-mail', import.meta.url)),
  use: {
    baseURL: 'http://127.0.0.1:5219', channel: 'chrome', serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { args: ['--disable-dev-shm-usage', '--disable-gpu'] },
  },
  webServer: process.env.E2E_AUDIT_EXTERNAL_STACK === '1' ? undefined : {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node node_modules/vite/bin/vite.js --config e2e/audit-mail-files.vite.config.js',
    url: 'http://127.0.0.1:5219', reuseExistingServer: false,
  },
});
