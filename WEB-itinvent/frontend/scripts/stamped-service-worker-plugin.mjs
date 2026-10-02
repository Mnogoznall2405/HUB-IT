import { resolve } from 'node:path';
import { stampServiceWorker } from './stamp-service-worker.mjs';

// Stamps sw.js inside the directory this build actually writes to (--outDir /
// build.outDir). It must never touch the live `dist` of another build.
export const stampedServiceWorker = () => {
  let outputDir = null;
  return {
    name: 'hubit-stamped-service-worker',
    apply: 'build',
    configResolved(resolvedConfig) {
      outputDir = resolve(resolvedConfig.root, resolvedConfig.build.outDir);
    },
    closeBundle() {
      if (outputDir) stampServiceWorker(outputDir);
    },
  };
};
