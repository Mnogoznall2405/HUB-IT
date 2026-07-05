#!/usr/bin/env node
/**
 * Verifies that identifiers used in ChatPageContent.jsx are imported or destructured.
 * Catches post-refactor ReferenceError class (missing import / wrong alias).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const filePath = join(root, 'src/pages/chat/ChatPageContent.jsx');
const source = readFileSync(filePath, 'utf8');

const RESERVED = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'console', 'window', 'document', 'Math', 'Date', 'JSON', 'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean',
  'Error', 'Set', 'Map', 'RegExp', 'Intl', 'Symbol', 'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'void', 'typeof', 'new',
]);

const importNames = new Set();
const importRe = /import\s+(?:type\s+)?(?:(\w+)(?:\s*,\s*\{([^}]+)\})?|\{([^}]+)\}|(\w+)\s+from)/g;
let m;
while ((m = importRe.exec(source)) !== null) {
  if (m[1]) importNames.add(m[1]);
  if (m[4]) importNames.add(m[4]);
  const named = (m[2] || m[3] || '');
  named.split(',').forEach((part) => {
    const chunk = part.trim();
    if (!chunk) return;
    const aliasMatch = chunk.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
    if (aliasMatch) {
      importNames.add(aliasMatch[2] || aliasMatch[1]);
    }
  });
}

const fnBodyMatch = source.match(/export function ChatPageContent\(\)\s*\{([\s\S]*)\n\}/);
if (!fnBodyMatch) {
  console.error('Could not parse ChatPageContent function body');
  process.exit(1);
}
const body = fnBodyMatch[1];

const destructureRe = /(?:const|let)\s*\{([^}]+)\}\s*=/g;
while ((m = destructureRe.exec(body)) !== null) {
  m[1].split(',').forEach((part) => {
    const name = part.trim().split(':')[0].trim().split('=')[0].trim();
    if (name && /^[A-Za-z_$]/.test(name)) importNames.add(name);
  });
}

const hookCallRe = /\b(use[A-Z][A-Za-z0-9_]*)\s*\(/g;
const missing = new Set();
while ((m = hookCallRe.exec(body)) !== null) {
  const name = m[1];
  if (!importNames.has(name) && !RESERVED.has(name)) {
    missing.add(name);
  }
}

if (missing.size > 0) {
  console.error('ChatPageContent.jsx: possible missing imports for hook calls:');
  [...missing].sort().forEach((name) => console.error(`  - ${name}`));
  process.exit(1);
}

console.log('check-chat-page-imports: OK');
