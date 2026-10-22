import base from './audit-monitoring-races.config.js';
import { fileURLToPath } from 'node:url';

export default {
  ...base,
  testMatch: 'monitoring-performance.spec.js',
  timeout: 120000,
  outputDir: fileURLToPath(new URL(`../../../output/monitoring-performance-20261021/browser-${process.env.MONITORING_BENCHMARK_LABEL || 'checks'}`, import.meta.url)),
};
