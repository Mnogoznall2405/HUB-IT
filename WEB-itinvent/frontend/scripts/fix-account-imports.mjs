import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [
  path.join(root, 'src/pages/account/profile'),
  path.join(root, 'src/pages/account/admin'),
  path.join(root, 'src/pages/account/settings'),
];

const pattern = /from '\.\.\/\.\.\/(components|api|contexts|theme|lib)\//g;
const replacement = "from '../../../$1/";

for (const dir of dirs) {
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.jsx')) continue;
    const full = path.join(dir, file);
    const source = fs.readFileSync(full, 'utf8');
    const next = source.replace(pattern, replacement);
    if (next !== source) {
      fs.writeFileSync(full, next);
      console.log('fixed', full);
    }
  }
}
