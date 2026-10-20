import sessionConfig from './audit-session-cache.config.js';
import { fileURLToPath } from 'node:url';
export default {
  ...sessionConfig,
  testMatch: 'audit-file-drop.spec.js',
  outputDir: fileURLToPath(new URL('../../../output/audit-20261019-file-drop', import.meta.url)),
};
