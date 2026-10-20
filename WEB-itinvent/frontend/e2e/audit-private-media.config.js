import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.', testMatch: 'audit-private-media.spec.js', workers: 1, timeout: 30000,
  outputDir: fileURLToPath(new URL('../../../output/audit-20261018-private-media', import.meta.url)),
  use: { baseURL: 'http://127.0.0.1:5222', channel: 'chrome', serviceWorkers: 'allow',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.E2E_AUDIT_EXTERNAL_STACK === '1' ? undefined : {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node node_modules/vite/bin/vite.js --config e2e/audit-private-media.vite.config.js',
    url: 'http://127.0.0.1:5222', reuseExistingServer: false,
  },
});
