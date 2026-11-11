import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');
const logPath = process.argv[2];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.test\.(js|jsx)$/.test(entry.name)) {
      acc.push(`src/${path.relative(root, full).replace(/\\/g, '/')}`);
    }
  }
  return acc;
}

const all = walk(root).sort();
const log = fs.readFileSync(logPath, 'utf8');
const passed = new Set();
for (const match of log.matchAll(/src\/[A-Za-z0-9_./-]+\.test\.(?:js|jsx)/g)) {
  passed.add(match[0]);
}
const missing = all.filter((file) => !passed.has(file));
console.log('all', all.length, 'passed', passed.size, 'missing', missing.length);
for (const file of missing) console.log(file);
