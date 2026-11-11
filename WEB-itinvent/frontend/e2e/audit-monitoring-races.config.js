import base from './audit-session-cache.config.js';
import { fileURLToPath } from 'node:url';

if (process.env.E2E_LOCAL !== '1') throw new Error('Requires isolated E2E_LOCAL=1');
export default {
  ...base,
  testMatch: 'audit-monitoring-races.spec.js',
  timeout: 60000,
  outputDir: fileURLToPath(new URL('../../../output/audit-20261019-monitoring-races', import.meta.url)),
  webServer: process.env.E2E_AUDIT_EXTERNAL_STACK === '1' ? undefined : {
    ...base.webServer,
    command: 'node node_modules/vite/bin/vite.js --config e2e/audit-monitoring-races.vite.config.js',
  },
};
