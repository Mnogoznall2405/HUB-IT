import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config.js';

if (process.env.E2E_LOCAL !== '1') throw new Error('Audit scan tests require E2E_LOCAL=1');

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const webServers = (Array.isArray(base.webServer) ? base.webServer : [base.webServer])
  .filter(Boolean)
  .map((server) => ({ ...server, cwd: server.cwd || frontendRoot }));

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'audit-scan-center.spec.js',
  outputDir: fileURLToPath(new URL('../../../output/audit-scan-center', import.meta.url)),
  webServer: process.env.E2E_AUDIT_EXTERNAL_STACK === '1' ? undefined : webServers,
});
