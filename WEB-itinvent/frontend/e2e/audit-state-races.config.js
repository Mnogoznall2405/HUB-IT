import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config.js';

if (process.env.E2E_LOCAL !== '1') throw new Error('Audit race tests require E2E_LOCAL=1');

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'audit-state-races.spec.js',
  outputDir: fileURLToPath(new URL('../../../output/audit-20261018-browser', import.meta.url)),
  webServer: process.env.E2E_AUDIT_EXTERNAL_STACK === '1' ? undefined : base.webServer,
});
