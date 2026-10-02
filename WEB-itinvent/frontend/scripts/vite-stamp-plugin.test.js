import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stampedServiceWorker } from './stamped-service-worker-plugin.mjs';

const SW_SOURCE = [
  "const SW_VERSION = 'old';",
  "const APP_SHELL_CACHE = 'shell-old';",
  "const APP_ASSET_CACHE = 'assets-old';",
].join('\n');

const makeOutput = (dir) => {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<html></html>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(dir, 'sw.js'), SW_SOURCE);
};

describe('hubit-stamped-service-worker plugin', () => {
  const roots = [];
  afterEach(() => {
    while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
  });

  it('stamps sw.js in the build outDir and leaves the project dist untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'hubit-stamp-'));
    roots.push(root);
    makeOutput(join(root, 'dist'));
    makeOutput(join(root, 'custom-out'));

    const plugin = stampedServiceWorker();

    plugin.configResolved({ root, build: { outDir: 'custom-out' } });
    plugin.closeBundle();

    expect(readFileSync(join(root, 'custom-out', 'sw.js'), 'utf8')).toMatch(/const SW_VERSION = 'build-[0-9a-f]{16}';/);
    expect(readFileSync(join(root, 'dist', 'sw.js'), 'utf8')).toBe(SW_SOURCE);
  });

  it('resolves an absolute outDir as is', () => {
    const root = mkdtempSync(join(tmpdir(), 'hubit-stamp-'));
    roots.push(root);
    const absolute = resolve(root, 'elsewhere');
    makeOutput(absolute);

    const plugin = stampedServiceWorker();
    plugin.configResolved({ root: join(root, 'unrelated'), build: { outDir: absolute } });
    plugin.closeBundle();

    expect(readFileSync(join(absolute, 'sw.js'), 'utf8')).toMatch(/build-[0-9a-f]{16}/);
  });
});
