import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_DECLARATIONS = Object.freeze({
  SW_VERSION: (buildId) => `build-${buildId}`,
  APP_SHELL_CACHE: (buildId) => `hubit-app-shell-v${buildId}`,
  APP_ASSET_CACHE: (buildId) => `hubit-app-assets-v${buildId}`,
});

function collectBuildInputs(outputDir) {
  const roots = ['index.html', 'manifest.webmanifest', '.vite/manifest.json', 'assets'];
  const files = [];
  const visit = (path) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(resolve(path, name));
      return;
    }
    files.push(path);
  };
  for (const root of roots) visit(resolve(outputDir, root));
  return files;
}

export function computeServiceWorkerBuildId(outputDir) {
  const hash = createHash('sha256');
  const files = collectBuildInputs(outputDir);
  if (!files.length) throw new Error(`No frontend build inputs found in ${outputDir}`);
  for (const path of files) {
    hash.update(relative(outputDir, path).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

export function applyServiceWorkerBuildId(source, buildId) {
  let next = String(source || '');
  for (const [constantName, getValue] of Object.entries(VERSION_DECLARATIONS)) {
    const pattern = new RegExp(`^const ${constantName} = '[^']*';`, 'm');
    if (!pattern.test(next)) throw new Error(`Service worker declaration not found: ${constantName}`);
    next = next.replace(pattern, `const ${constantName} = '${getValue(buildId)}';`);
  }
  return next;
}

export function stampServiceWorker(outputDir) {
  const swPath = resolve(outputDir, 'sw.js');
  if (!existsSync(swPath)) throw new Error(`Built service worker was not found: ${swPath}`);
  const buildId = computeServiceWorkerBuildId(outputDir);
  const source = readFileSync(swPath, 'utf8');
  const stamped = applyServiceWorkerBuildId(source, buildId);
  writeFileSync(swPath, stamped, 'utf8');
  return buildId;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const outputDir = resolve(process.cwd(), process.argv[2] || 'dist');
  process.stdout.write(`${stampServiceWorker(outputDir)}\n`);
}
