import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';


const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..', '..');
const [sessionName, codeFile] = process.argv.slice(2);

if (!sessionName || !codeFile) {
  console.error('Usage: node run_cli_code.mjs <session> <code-file>');
  process.exit(2);
}

const npxRoot = join(homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
const candidates = existsSync(npxRoot)
  ? readdirSync(npxRoot)
    .map((entry) => join(npxRoot, entry, 'node_modules', '@playwright', 'cli', 'playwright-cli.js'))
    .filter((entry) => existsSync(entry))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  : [];

if (!candidates.length) {
  console.error('Playwright CLI is not present in the npm cache. Run it through npx first.');
  process.exit(3);
}

const sourcePath = resolve(projectRoot, codeFile);
const code = readFileSync(sourcePath, 'utf8').trim();
const result = spawnSync(
  process.execPath,
  [candidates[0], `-s=${sessionName}`, 'run-code', code],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(4);
}
process.exit(result.status ?? 1);
