import sessionConfig from './audit-session-cache.config.js';
import { fileURLToPath } from 'node:url';
export default {
  ...sessionConfig,
  testMatch: 'audit-upload-resume.spec.js',
  outputDir: fileURLToPath(new URL('../../../output/audit-20261019-upload-resume', import.meta.url)),
};
