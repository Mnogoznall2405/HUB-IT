import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config.js';

// A previously built isolated artifact: this config never runs a live build.
const frontend = fileURLToPath(new URL('..', import.meta.url));
const artifact = process.env.E2E_MONITORING_BUILT_DIR;
if (process.env.E2E_LOCAL !== '1' || !artifact) throw new Error('Requires E2E_LOCAL=1 and an isolated E2E_MONITORING_BUILT_DIR');

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'monitoring.spec.js',
  outputDir: fileURLToPath(new URL('../../../output/monitoring-implementation/browser-results', import.meta.url)),
  webServer: process.env.E2E_MONITORING_EXTERNAL_STACK === '1' ? undefined : base.webServer.map((server, index) => ({
    ...server, cwd: frontend,
    ...(index === 1 ? { command: `npx vite preview --outDir "${artifact}" --port ${process.env.E2E_FRONTEND_PORT || '5174'} --strictPort --host 127.0.0.1` } : {}),
  })),
});
