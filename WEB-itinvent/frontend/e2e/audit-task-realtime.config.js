import base from './audit-monitoring-races.config.js';
import { fileURLToPath } from 'node:url';
export default {
  ...base,
  testMatch: 'audit-task-realtime.spec.js',
  outputDir: fileURLToPath(new URL('../../../output/audit-20261019-task-realtime', import.meta.url)),
};
