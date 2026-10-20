import base from './audit-session-cache.vite.config.js';
import { defineConfig } from 'vite';
export default defineConfig({
  ...base,
  cacheDir: '../../output/audit-vite-monitoring-cache',
  optimizeDeps: { entries: ['index.html'] },
});
